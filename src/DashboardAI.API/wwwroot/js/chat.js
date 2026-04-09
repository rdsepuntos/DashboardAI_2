/**
 * ChatManager
 * Manages the chat sidebar: sends messages to /api/chat/message,
 * displays AI responses, and delegates commands to DashboardEngine.
 */
// API_BASE is declared in dashboard-engine.js which is loaded first
const ChatManager = (() => {

  let _session = {};

  function init(session) {
    _session = session;

    $('#chatForm').on('submit', async function(e) {
      e.preventDefault();
      const input = $('#chatInput').val().trim();
      if (!input) return;
      $('#chatInput').val('');
      await sendMessage(input);
    });

    // Allow Shift+Enter for newlines, Enter alone to submit
    $('#chatInput').on('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        $('#chatForm').trigger('submit');
      }
    });
  }

  async function sendMessage(message) {
    _addBubble(message, 'user');

    const thinkingEl = _addBubble('<span class="dot-typing"><span></span><span></span><span></span></span>', 'assistant thinking', true);
    $('#chatSendBtn').prop('disabled', true);

    try {
      const dashboard = DashboardEngine.getDashboard();
      if (!dashboard) throw new Error('Dashboard not loaded yet.');

      const res = await fetch(API_BASE + '/api/chat/message', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          dashboardId:      dashboard.id,
          message:          message,
          userId:           _session.userId,
          storeId:          _session.storeId,
          currentDashboard: dashboard
        })
      });

      const data = await res.json();
      thinkingEl.remove();

      if (!res.ok) throw new Error(data.error || 'Chat error.');

      const commands = data.commands || [];

      // Show AI explanation bubbles
      if (commands.length === 0) {
        _addBubble("I couldn't determine what changes to make. Could you rephrase?", 'assistant');
      } else {
        const explanations = commands
          .filter(c => c.explanation)
          .map(c => `<span class="chat-command-tag">${_actionLabel(c.action)}</span> ${c.explanation}`)
          .join('<br/>');
        _addBubble(explanations || 'Done! Dashboard updated.', 'assistant', true);
      }

      // Apply commands to the live canvas
      DashboardEngine.applyCommands(commands, data.updatedDashboard);

    } catch(err) {
      thinkingEl.remove();
      _addBubble(`⚠ ${err.message}`, 'assistant');
    } finally {
      $('#chatSendBtn').prop('disabled', false);
      $('#chatInput').focus();
    }
  }

  function _addBubble(html, classes, isHtml = false) {
    const msgs = document.getElementById('chatMessages');
    const div  = document.createElement('div');
    div.className = `chat-bubble ${classes}`;

    if (isHtml) div.innerHTML = html;
    else        div.textContent = html;

    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  function _actionLabel(action) {
    const map = {
      'add_widget':          '+ Widget',
      'update_widget':       '✎ Widget',
      'remove_widget':       '✕ Widget',
      'add_filter':          '+ Filter',
      'update_filter':       '✎ Filter',
      'remove_filter':       '✕ Filter',
      'update_filter_value': '⏱ Filter',
      'update_title':        '✎ Title'
    };
    return map[action] || action;
  }

  return { init, sendMessage };

})();
