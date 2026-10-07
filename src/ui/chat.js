// Room chat. One panel is moved between the lobby and the in-game dock, so the
// conversation carries over. Everything is rendered as text, never as HTML.
const MAX_LINES = 120;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class ChatPanel {
  constructor({ onSend }) {
    this.selfId = null;
    this.el = el('div', 'chat');
    this.list = el('div', 'chat-list');
    const form = el('form', 'chat-form');
    this.input = el('input');
    this.input.maxLength = 200;
    this.input.placeholder = 'Say something…';
    this.input.autocomplete = 'off';
    const send = el('button', 'ghost', 'Send');
    send.type = 'submit';
    form.append(this.input, send);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      onSend(text);
      this.input.value = '';
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.input.blur();
      e.stopPropagation();
    });
    this.el.append(this.list, form);
    // Called with each new message that arrives while the panel isn't on screen.
    this.onUnseen = () => {};
  }

  mount(parent) {
    if (this.el.parentElement !== parent) parent.appendChild(this.el);
    this.scroll();
  }

  get visible() {
    return this.el.isConnected && this.el.getClientRects().length > 0;
  }

  reset(entries) {
    this.list.innerHTML = '';
    for (const e of entries) this.render(e);
    this.scroll();
  }

  add(entry) {
    this.render(entry);
    this.scroll();
    if (!this.visible) this.onUnseen(entry);
  }

  render(entry) {
    const line = el('div', `chat-line${entry.system ? ' system' : ''}${entry.from === this.selfId ? ' mine' : ''}`);
    if (entry.system) line.textContent = entry.text;
    else line.append(el('b', null, entry.name), document.createTextNode(` ${entry.text}`));
    this.list.appendChild(line);
    while (this.list.childElementCount > MAX_LINES) this.list.firstChild.remove();
  }

  scroll() {
    this.list.scrollTop = this.list.scrollHeight;
  }

  focus() {
    this.input.focus();
  }
}
