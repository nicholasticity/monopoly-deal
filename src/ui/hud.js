// DOM overlay: status bar, log, toasts, hover preview, popup menus and modals.
import { cardImageURL, isFlipped } from '../render/textures.js';
import * as R from '../game/rules.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Phones and other tall screens; must match the portrait rules in style.css.
const PORTRAIT = matchMedia('(max-aspect-ratio: 1/1), (max-width: 640px)');

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export function thumb(card, { flipped = isFlipped(card) } = {}) {
  const img = el('img', `thumb${flipped ? ' flipped' : ''}`);
  img.src = cardImageURL(card);
  img.alt = card.name;
  img.draggable = false;
  return img;
}

export class Hud {
  constructor() {
    this.hudEl = $('#hud');
    this.topbarEl = $('#topbar');
    this.logEl = $('#log');
    this.statusEl = $('#status');
    this.toastsEl = $('#toasts');
    this.previewEl = $('#preview');
    this.controlsEl = $('#turn-controls');
    this.playsEl = $('#plays');
    this.hintEl = $('#hint');
    this.popupLayer = $('#popup-layer');
    this.modalLayer = $('#modal-layer');
    this.chatDock = $('#chat-dock');
    this.chatBtn = $('#btn-chat');
    this.chatBadge = $('#chat-badge');
    this.chatPops = $('#chat-pops');
    this.bannerEl = $('#banner');
    this.newBtn = $('#btn-new');
    this.stopBtn = $('#btn-stop');
    this.online = false;
    this.unread = 0;
    this.cancelTop = null;
    this.onEndTurn = () => {};
    this.onNewGame = () => {};
    this.onStopGame = () => {};

    $('#btn-end').addEventListener('click', () => this.onEndTurn());
    this.newBtn.addEventListener('click', () => this.onNewGame());
    this.stopBtn.addEventListener('click', () => this.onStopGame());
    $('#btn-rules').addEventListener('click', () => this.showRules());
    $('#btn-log').addEventListener('click', () => this.logEl.classList.toggle('open'));
    this.chatBtn.addEventListener('click', () => this.setChatDock(!this.chatDock.classList.contains('open')));
    document.addEventListener('keydown', (e) => {
      // Typing in the chat or a name field isn't a shortcut.
      if (e.target.closest?.('input, textarea')) return;
      if (e.key === 'Escape' && this.cancelTop) this.cancelTop();
      else if ((e.key === 'e' || e.key === 'E') && !this.cancelTop && this.controlsEl.classList.contains('show')) this.onEndTurn();
      else if (e.key === 'Enter' && this.online && !this.chatBtn.classList.contains('hidden') && e.target === document.body) {
        e.preventDefault();
        this.setChatDock(true);
      }
    });
  }

  // ---------- online extras ----------

  // Screen space (CSS px) the HUD covers, for the 3D view to keep clear: the top bar,
  // and either the turn controls beside the hand or (portrait) the status row above it.
  insets() {
    const portrait = PORTRAIT.matches;
    return {
      portrait,
      top: this.topbarEl.getBoundingClientRect().bottom,
      bottom: portrait ? Math.max(this.statusEl.offsetHeight, this.controlsEl.offsetHeight) + 12 : 0,
      right: portrait ? 0 : this.controlsEl.offsetWidth + 30,
    };
  }

  setOnline(on) {
    this.online = on;
    this.newBtn.title = on ? 'Leave room' : 'New game';
    this.newBtn.querySelector('.ico').textContent = on ? '🚪' : '🔄';
    this.newBtn.querySelector('.txt').textContent = this.newBtn.title;
    this.chatBtn.classList.toggle('hidden', !on);
    if (!on) {
      this.setChatDock(false);
      this.chatPops.innerHTML = '';
    }
  }

  // Host-only "End game" button while an online game runs.
  setHost(on) {
    this.stopBtn.classList.toggle('hidden', !on);
  }

  setChatDock(open) {
    this.chatDock.classList.toggle('open', open);
    this.chatBtn.classList.toggle('on', open);
    if (open) {
      this.unread = 0;
      this.chatBadge.classList.add('hidden');
      this.chatPops.innerHTML = '';
      this.chatDock.querySelector('input')?.focus();
    }
  }

  // A chat message arrived while the chat isn't on screen.
  chatUnseen(entry) {
    if (this.chatBtn.classList.contains('hidden')) return;
    if (!entry.system) {
      this.unread++;
      this.chatBadge.textContent = String(Math.min(this.unread, 99));
      this.chatBadge.classList.remove('hidden');
    }
    const pop = el('div', `chat-pop${entry.system ? ' system' : ''}`);
    if (!entry.system) pop.appendChild(el('b')).textContent = entry.name;
    pop.appendChild(document.createTextNode(entry.system ? entry.text : ` ${entry.text}`));
    pop.addEventListener('click', () => this.setChatDock(true));
    this.chatPops.appendChild(pop);
    while (this.chatPops.childElementCount > 3) this.chatPops.firstChild.remove();
    setTimeout(() => pop.classList.add('out'), 5000);
    setTimeout(() => pop.remove(), 5500);
  }

  // A strip under the top bar for connection trouble or "a bot is playing for you".
  setBanner(text, buttonLabel = null, onClick = null) {
    this.bannerEl.classList.toggle('hidden', !text);
    this.bannerEl.innerHTML = '';
    if (!text) return;
    this.bannerEl.appendChild(el('span')).textContent = text;
    if (buttonLabel) {
      const b = el('button', 'primary small');
      b.textContent = buttonLabel;
      b.addEventListener('click', onClick);
      this.bannerEl.appendChild(b);
    }
  }

  // Yes/no question in the top layer, above any open prompt.
  confirm({ title, body, ok = 'OK', cancel = 'Cancel' }) {
    return new Promise((resolve) => {
      const prevCancel = this.cancelTop;
      const layer = el('div', 'modal-backdrop top');
      const box = el('div', 'modal');
      box.appendChild(el('h2')).textContent = title;
      if (body) box.appendChild(el('p', 'modal-body')).textContent = body;
      const row = el('div', 'confirm-row');
      const no = el('button', 'ghost');
      no.textContent = cancel;
      const yes = el('button', 'primary');
      yes.textContent = ok;
      row.append(no, yes);
      box.appendChild(row);
      layer.appendChild(box);
      document.body.appendChild(layer);
      const done = (v) => {
        layer.remove();
        this.cancelTop = prevCancel;
        resolve(v);
      };
      no.addEventListener('click', () => done(false));
      yes.addEventListener('click', () => done(true));
      layer.addEventListener('pointerdown', (e) => e.target === layer && done(false));
      this.cancelTop = () => done(false);
      yes.focus();
    });
  }

  // ---------- passive displays ----------

  clearLog() {
    this.logEl.innerHTML = '';
  }

  log(text, kind = 'info') {
    const line = el('div', `log-line ${kind}`);
    line.textContent = text;
    this.logEl.appendChild(line);
    while (this.logEl.childElementCount > 300) this.logEl.firstChild.remove();
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  toast(text, kind = 'info', ms = 2800) {
    const t = el('div', `toast ${kind}`);
    t.textContent = text;
    this.toastsEl.appendChild(t);
    while (this.toastsEl.childElementCount > 3) this.toastsEl.firstChild.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 500);
  }

  setStatus(html) {
    this.statusEl.innerHTML = html;
  }

  setTurnControls(visible, playsLeft = 0, hint = '') {
    this.controlsEl.classList.toggle('show', visible);
    this.hudEl.classList.toggle('my-turn', visible);
    this.playsEl.innerHTML = Array.from({ length: R.PLAYS_PER_TURN }, (_, i) => `<span class="pip ${i < playsLeft ? 'on' : ''}"></span>`).join('') + `<span class="plays-text">${playsLeft} play${playsLeft === 1 ? '' : 's'} left</span>`;
    this.hintEl.textContent = hint;
    this.hintEl.classList.toggle('show', visible && !!hint);
  }

  preview(card, zone, side = 'right') {
    if (!card) {
      this.previewEl.classList.remove('show');
      return;
    }
    this.previewEl.innerHTML = '';
    this.previewEl.appendChild(thumb(card, { flipped: zone?.zone === 'pile' && isFlipped(card) }));
    this.previewEl.classList.toggle('left', side === 'left');
    this.previewEl.classList.toggle('low', side === 'low');
    this.previewEl.classList.add('show');
  }

  // ---------- interactive prompts ----------

  closeAll() {
    this.popupLayer.innerHTML = '';
    this.modalLayer.innerHTML = '';
    this.cancelTop = null;
  }

  menu(x, y, title, options) {
    return new Promise((resolve) => {
      this.popupLayer.innerHTML = '';
      const backdrop = el('div', 'popup-backdrop');
      const box = el('div', 'popup');
      box.appendChild(el('div', 'popup-title', title));
      const done = (v) => {
        this.popupLayer.innerHTML = '';
        this.cancelTop = null;
        resolve(v);
      };
      for (const opt of options) {
        const b = el('button', `popup-item${opt.disabled ? ' disabled' : ''}`);
        if (opt.swatch) b.appendChild(el('span', 'swatch')).style.background = opt.swatch;
        b.appendChild(el('span', 'label', opt.label));
        if (opt.hint) b.appendChild(el('span', 'hint', opt.hint));
        if (!opt.disabled) b.addEventListener('click', () => done(opt.value));
        box.appendChild(b);
      }
      backdrop.addEventListener('pointerdown', () => done(null));
      this.popupLayer.append(backdrop, box);
      // Layout size, not getBoundingClientRect: the pop-in animation scales the box.
      const r = { width: box.offsetWidth, height: box.offsetHeight };
      // On phones, keep clear of the hand and the status row above it.
      const handH = parseFloat(document.documentElement.style.getPropertyValue('--hand-h')) || 0;
      if (PORTRAIT.matches) y = Math.min(y, window.innerHeight - handH - 56);
      box.style.left = `${Math.max(8, Math.min(x - r.width / 2, window.innerWidth - r.width - 8))}px`;
      box.style.top = `${Math.max(8, Math.min(y - r.height - 18, window.innerHeight - r.height - 8))}px`;
      this.cancelTop = () => done(null);
    });
  }

  modal({ title, body, cancelable = true, wide = false }) {
    this.modalLayer.innerHTML = '';
    const backdrop = el('div', 'modal-backdrop');
    const box = el('div', `modal${wide ? ' wide' : ''}`);
    box.appendChild(el('h2', null, title));
    if (body) box.appendChild(typeof body === 'string' ? el('p', 'modal-body', body) : body);
    backdrop.appendChild(box);
    this.modalLayer.appendChild(backdrop);
    const close = () => {
      this.modalLayer.innerHTML = '';
      this.cancelTop = null;
    };
    // A button that hides the dialog for a look at the table (hand, bank, sets)
    // until "Back" (or Escape) brings it back.
    const peekButton = () => {
      const look = el('button', 'ghost peek', '👀 Look at my cards first');
      const back = el('button', 'primary peek-back hidden', '↩ Back to decision');
      let prevCancel = null;
      const peek = (on) => {
        backdrop.classList.toggle('hidden', on);
        back.classList.toggle('hidden', !on);
        if (on) [prevCancel, this.cancelTop] = [this.cancelTop, () => peek(false)];
        else this.cancelTop = prevCancel;
      };
      look.addEventListener('click', () => peek(true));
      back.addEventListener('click', () => peek(false));
      this.modalLayer.appendChild(back);
      return look;
    };
    return { box, close, cancelable, peekButton };
  }

  choose({ title, body, options, cancel = true, cards = [], peek = false }) {
    return new Promise((resolve) => {
      const { box, close, peekButton } = this.modal({ title, body });
      if (cards.length) {
        const row = el('div', 'card-row');
        cards.forEach((c) => row.appendChild(thumb(c)));
        box.appendChild(row);
      }
      const list = el('div', 'choice-list');
      const done = (v) => {
        close();
        resolve(v);
      };
      for (const opt of options) {
        const b = el('button', `choice ${opt.primary ? 'primary' : ''}${opt.disabled ? ' disabled' : ''}`);
        if (opt.swatch) b.appendChild(el('span', 'swatch')).style.background = opt.swatch;
        b.appendChild(el('span', 'label', opt.label));
        if (opt.hint) b.appendChild(el('span', 'hint', opt.hint));
        if (!opt.disabled) b.addEventListener('click', () => done(opt.value));
        list.appendChild(b);
      }
      box.appendChild(list);
      if (peek) box.appendChild(peekButton());
      if (cancel) {
        const c = el('button', 'ghost cancel', 'Cancel');
        c.addEventListener('click', () => done(null));
        box.appendChild(c);
        this.cancelTop = () => done(null);
      }
    });
  }

  // groups: [{ label, items: [{ card, value, selectable, flipped, note }] }]
  // mode 'single' resolves on first click; 'multi' needs validate(values) -> { ok, text }.
  pickCards({ title, body, groups, mode = 'single', validate, confirmLabel = 'Confirm', cancel = true, suggest = null }) {
    return new Promise((resolve) => {
      const { box, close } = this.modal({ title, body, wide: true });
      const selected = new Set();
      const done = (v) => {
        close();
        resolve(v);
      };
      const footer = el('div', 'pick-footer');
      const info = el('span', 'pick-info');
      const confirm = el('button', 'primary', confirmLabel);
      const tiles = [];
      const refresh = () => {
        for (const t of tiles) t.el.classList.toggle('selected', selected.has(t.value));
        if (mode === 'multi') {
          const v = validate([...selected]);
          info.textContent = v.text;
          confirm.disabled = !v.ok;
        }
      };
      const scroller = el('div', 'pick-groups');
      for (const g of groups) {
        if (!g.items.length) continue;
        const group = el('div', 'pick-group');
        group.appendChild(el('div', 'pick-label', g.label));
        const row = el('div', 'pick-row');
        for (const item of g.items) {
          const tile = el('div', `pick-tile${item.selectable === false ? ' locked' : ''}`);
          tile.appendChild(thumb(item.card, { flipped: item.flipped ?? isFlipped(item.card) }));
          if (item.note) tile.appendChild(el('span', 'tile-note', item.note));
          if (item.selectable !== false) {
            tile.addEventListener('click', () => {
              if (mode === 'single') return done(item.value);
              if (selected.has(item.value)) selected.delete(item.value);
              else selected.add(item.value);
              refresh();
            });
          }
          tiles.push({ el: tile, value: item.value });
          row.appendChild(tile);
        }
        group.appendChild(row);
        scroller.appendChild(group);
      }
      box.appendChild(scroller);
      if (mode === 'multi') {
        footer.appendChild(info);
        if (suggest) {
          const auto = el('button', 'ghost', 'Auto-select');
          auto.addEventListener('click', () => {
            selected.clear();
            suggest().forEach((v) => selected.add(v));
            refresh();
          });
          footer.appendChild(auto);
        }
        confirm.addEventListener('click', () => done([...selected]));
        footer.appendChild(confirm);
      }
      if (cancel) {
        const c = el('button', 'ghost', 'Cancel');
        c.addEventListener('click', () => done(null));
        footer.appendChild(c);
        this.cancelTop = () => done(null);
      }
      box.appendChild(footer);
      refresh();
    });
  }

  // Resolves { mode: 'solo' | 'create' | 'join', name, opponents, speed, code }.
  showStart(defaults) {
    return new Promise((resolve) => {
      this.closeAll();
      const body = el('div', 'start');
      body.innerHTML = `
        <div class="start-logo"><span class="logo">MONOPOLY</span><span class="deal">DEAL</span><span class="three">3D</span></div>
        <p class="tagline">Collect three full property sets of different colours to win.</p>
        <p class="note warn" id="opt-notice"></p>
        <div class="seg mode" id="opt-mode"><button data-v="solo">🤖 Vs computer</button><button data-v="online">🌐 Online with friends</button></div>
        <label>Your name <input id="opt-name" maxlength="16" placeholder="Your name" autocomplete="nickname"></label>
        <div class="start-solo">
          <div class="opt-row"><span>Opponents</span><div class="seg" id="opt-opp">${[1, 2, 3, 4].map((n) => `<button data-v="${n}" class="${n === defaults.opponents ? 'on' : ''}">${n}</button>`).join('')}</div></div>
          <div class="opt-row"><span>Game speed</span><div class="seg" id="opt-speed">${['slow', 'normal', 'fast'].map((s) => `<button data-v="${s}" class="${s === defaults.speed ? 'on' : ''}">${s}</button>`).join('')}</div></div>
          <button class="primary big" id="opt-start">Deal the cards</button>
        </div>
        <div class="start-online">
          <button class="primary big" id="opt-create">Create a room</button>
          <div class="or"><span>or join a friend’s room</span></div>
          <div class="join-row"><input id="opt-code" maxlength="4" placeholder="CODE" autocomplete="off" spellcheck="false"><button id="opt-join">Join room</button></div>
          <p class="muted small">Create a room and send the invite link to your friends. Up to 5 players; empty seats can be filled with bots.</p>
        </div>
        <p class="start-error" id="opt-error"></p>
        <button class="ghost" id="opt-rules">How to play</button>`;
      const { close } = this.modal({ title: '', body, cancelable: false });
      const $b = (sel) => body.querySelector(sel);
      const seg = (id) => {
        const root = $b(id);
        root.addEventListener('click', (e) => {
          const btn = e.target.closest('button');
          if (!btn) return;
          root.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
          root.dispatchEvent(new Event('change'));
        });
        return () => root.querySelector('.on').dataset.v;
      };
      const opp = seg('#opt-opp');
      const speed = seg('#opt-speed');
      const mode = seg('#opt-mode');
      const nameInput = $b('#opt-name');
      const codeInput = $b('#opt-code');
      const errorEl = $b('#opt-error');
      nameInput.value = defaults.name ?? '';
      codeInput.value = defaults.code ?? '';
      $b('#opt-notice').textContent = defaults.notice ?? '';
      const online = defaults.mode !== 'solo';
      $b(`#opt-mode [data-v="${online ? 'online' : 'solo'}"]`).classList.add('on');
      const showMode = () => {
        body.classList.toggle('online', mode() === 'online');
        errorEl.textContent = '';
      };
      $b('#opt-mode').addEventListener('change', showMode);
      showMode();
      // With a code from an invite link, joining is the obvious next step.
      if (online && codeInput.value) {
        $b('#opt-join').classList.add('primary');
        $b('#opt-create').classList.remove('primary');
      }
      codeInput.addEventListener('input', () => {
        codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
      });

      const finish = (choice) => {
        close();
        resolve({ name: nameInput.value.trim(), opponents: Number(opp()), speed: speed(), code: codeInput.value, ...choice });
      };
      const onlineName = () => {
        const name = nameInput.value.trim();
        const problem = !name ? 'Enter a name so your friends know who you are.' : /^you$/i.test(name) ? 'Pick a name other than “You”.' : /[<>&"'`\\]/.test(name) ? 'Names can’t contain < > & " \' ` or \\.' : '';
        errorEl.textContent = problem;
        if (problem) nameInput.focus();
        return !problem;
      };
      const create = () => onlineName() && finish({ mode: 'create' });
      const join = () => {
        if (!onlineName()) return;
        if (!/^[A-Z]{4}$/.test(codeInput.value)) {
          errorEl.textContent = 'Room codes are 4 letters — check the invite link.';
          codeInput.focus();
          return;
        }
        finish({ mode: 'join' });
      };
      $b('#opt-start').addEventListener('click', () => finish({ mode: 'solo' }));
      $b('#opt-create').addEventListener('click', create);
      $b('#opt-join').addEventListener('click', join);
      codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && join());
      nameInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (mode() === 'solo') $b('#opt-start').click();
        else if (codeInput.value) join();
        else create();
      });
      $b('#opt-rules').addEventListener('click', () => this.showRules());
    });
  }

  showGameOver(winner, isHuman, stats, buttonLabel = 'Play again') {
    return new Promise((resolve) => {
      const body = el('div', 'gameover');
      body.innerHTML = `<div class="trophy">${isHuman ? '🏆' : '🎲'}</div>
        <p>${isHuman ? 'You collected three full sets. Congratulations, tycoon!' : `${esc(winner.name)} collected three full sets.`}</p>
        <p class="muted">${stats}</p>`;
      const again = el('button', 'primary big', buttonLabel);
      body.appendChild(again);
      const { close } = this.modal({ title: isHuman ? 'You win!' : `${esc(winner.name)} wins`, body });
      again.addEventListener('click', () => {
        close();
        resolve();
      });
    });
  }

  // Rules sit in their own layer above any open prompt, which stays intact underneath.
  showRules() {
    const body = el('div', 'rules');
    body.innerHTML = `
      <p><b>Goal:</b> be the first to collect <b>3 complete property sets</b> of different colours.</p>
      <ul>
        <li>Start of your turn: draw 2 cards (5 if your hand is empty).</li>
        <li>Play up to <b>3 cards</b> per turn: bank money or action cards, lay down properties, or play actions.</li>
        <li>Click (or tap) a card in your hand to see what you can do with it. Click a wild property on your table to move it to another colour (free).</li>
        <li>Rent: two-colour rent charges <i>everyone</i>; wild rent charges one player. Add <b>Double The Rent</b> to multiply it.</li>
        <li>Paying debts: use bank and/or properties on the table. No change is given. Cards in hand can never be used to pay.</li>
        <li><b>Sly Deal</b> and <b>Forced Deal</b> can't touch complete sets — but <b>Deal Breaker</b> can.</li>
        <li><b>Just Say No</b> cancels an action against you, and can itself be cancelled by another Just Say No.</li>
        <li>Houses (+$3M) and hotels (+$4M) go on complete sets (not railroads or utilities). If a set is broken, its buildings go to its owner's bank.</li>
        <li>End your turn with at most 7 cards in hand; extras are discarded.</li>
      </ul>
      <p class="muted">Tip: hover any face-up card to see it up close. Press <b>E</b> to end your turn.</p>`;
    const ok = el('button', 'primary', 'Got it');
    body.appendChild(ok);
    const prevCancel = this.cancelTop;
    const layer = el('div', 'modal-backdrop top');
    const box = el('div', 'modal wide');
    box.appendChild(el('h2', null, 'How to play'));
    box.appendChild(body);
    layer.appendChild(box);
    document.body.appendChild(layer);
    const close = () => {
      layer.remove();
      this.cancelTop = prevCancel;
    };
    ok.addEventListener('click', close);
    this.cancelTop = close;
  }
}
