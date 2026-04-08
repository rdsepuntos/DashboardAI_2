/**
 * MarkdownWidget
 * Renders static markdown/HTML content blocks (notes, descriptions, dividers).
 * config keys: content (raw text or simple markdown)
 */
const MarkdownWidget = (() => {

  function render(el, config) {
    config = config || {};
    const raw = config.content || '_No content defined._';

    // Simple markdown → HTML conversion (no external dependency)
    const html = _parseMarkdown(raw);

    el.innerHTML = `<div class="markdown-body">${html}</div>`;
  }

  function _parseMarkdown(text) {
    return text
      // Headings
      .replace(/^### (.+)$/gm,  '<h3>$1</h3>')
      .replace(/^## (.+)$/gm,   '<h2>$1</h2>')
      .replace(/^# (.+)$/gm,    '<h1>$1</h1>')
      // Bold / Italic
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,     '<em>$1</em>')
      // Inline code
      .replace(/`(.+?)`/g,       '<code>$1</code>')
      // Horizontal rule
      .replace(/^---$/gm,        '<hr/>')
      // Unordered list
      .replace(/^\- (.+)$/gm,    '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      // Paragraphs (double newline)
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(.+)$/gm, (line) => {
        if (/^<[h1-6ul]|<hr/.test(line)) return line;
        return line;
      });
  }

  return { render };

})();
