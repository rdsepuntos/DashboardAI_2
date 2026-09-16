const ChatManager = (() => {
  let _session = {};
  let _busy = false;

  function _apiBase() {
    return location.protocol === 'file:' ? 'http://localhost:56231' : 'https://beta.whsmonitor.com.au/dashboardv2';
  }

  function _escape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _appendMessage(role, text) {
    const messages = document.getElementById('chatMessages');
    if (!messages) return null;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    bubble.innerHTML = _escape(text).replace(/\n/g, '<br>');
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }

  function _setBusy(busy) {
    _busy = busy;
    const input = document.getElementById('chatInput');
    const button = document.getElementById('chatSendBtn');
    if (input) input.disabled = busy;
    if (button) button.disabled = busy;
  }

  async function _send(message) {
    if (_busy || !message) return;

    const dashboard = DashboardEngine.getDashboard();
    if (!dashboard) {
      _appendMessage('assistant', 'The dashboard is still loading. Please try again in a moment.');
      return;
    }

    _appendMessage('user', message);
    const thinking = _appendMessage('assistant', 'Working...');
    _setBusy(true);

    try {
      const response = await fetch(_apiBase() + '/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dashboardId: dashboard.id,
          message,
          userId: _session.userId,
          storeId: _session.storeId,
          module: _session.module,
          sessionId: _session.sessionId,
          currentDashboard: dashboard
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Chat request failed.');

      if (thinking) thinking.innerHTML = _escape('Done.');
      DashboardEngine.applyCommands(data.commands || [], data.updatedDashboard || dashboard);
    } catch (error) {
      if (thinking) thinking.innerHTML = _escape(`Unable to update the dashboard: ${error.message}`);
    } finally {
      _setBusy(false);
      document.getElementById('chatInput')?.focus();
    }
  }

  function init(session) {
    _session = session || {};
    const form = document.getElementById('chatForm');
    const input = document.getElementById('chatInput');
    if (!form || !input) return;

    form.addEventListener('submit', event => {
      event.preventDefault();
      const message = input.value.trim();
      input.value = '';
      _send(message);
    });
  }

  return { init };
})();
