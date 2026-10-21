// WebSocket to the room server. Reconnects with backoff after a drop; the
// session re-sends its join on every (re)open so the server restores the seat.
const RETRY_MS = [500, 1000, 2000, 3000, 5000];
// How long a socket that looks open has to answer a ping after the page wakes up.
const PONG_MS = 3000;

export function serverURL() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export class Connection {
  constructor(url = serverURL()) {
    this.url = url;
    this.ws = null;
    this.closed = false;
    this.everOpened = false;
    this.attempt = 0;
    this.timer = null;
    this.onOpen = () => {};
    this.onMessage = () => {};
    // 'open' | 'reconnecting' | 'failed'
    this.onStatus = () => {};
  }

  open() {
    if (this.closed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.everOpened = true;
      this.onStatus('open');
      this.onOpen();
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === 'pong') return clearTimeout(this.pingTimer);
      this.onMessage(msg);
    };
    ws.onclose = (e) => this.dropped(ws, e.code);
  }

  // The socket closed (or was given up on): try again shortly, unless it's over.
  dropped(ws, code) {
    if (this.ws !== ws || this.closed) return;
    this.ws = null;
    clearTimeout(this.pingTimer);
    // 4000: this player opened the game in another tab, which now owns the seat.
    if (code === 4000) {
      this.closed = true;
      this.onStatus('replaced');
      return;
    }
    // Never reached the server at all: give up quickly rather than spin.
    if (!this.everOpened && this.attempt >= 2) {
      this.closed = true;
      this.onStatus('failed');
      return;
    }
    this.onStatus('reconnecting');
    const wait = RETRY_MS[Math.min(this.attempt++, RETRY_MS.length - 1)];
    this.timer = setTimeout(() => this.open(), wait);
  }

  // The page is back after being in the background (another app or tab), where a
  // phone may have dropped the socket or frozen it without closing it. Gone: connect
  // again now rather than after the retry wait. Looks open: it has to answer a ping,
  // or it's given up on and replaced.
  wake() {
    if (this.closed || !this.everOpened) return;
    const ws = this.ws;
    if (!ws) {
      clearTimeout(this.timer);
      this.attempt = 0;
      return this.open();
    }
    if (ws.readyState !== WebSocket.OPEN) return;
    clearTimeout(this.pingTimer);
    this.pingTimer = setTimeout(() => {
      ws.onclose = null;
      ws.close();
      this.attempt = 0;
      this.dropped(ws, 1006);
    }, PONG_MS);
    this.send('ping');
  }

  send(type, data = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type, ...data }));
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      // Let a final message (e.g. 'leave') flush before closing.
      if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close();
      else ws.close(1000);
    }
  }
}
