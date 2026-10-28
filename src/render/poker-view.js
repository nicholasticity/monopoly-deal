// The Hold'em table, on the same card table as the trick games: a bar per player
// (stack, bet, button and blinds), your two cards along the bottom, everyone else's
// face down by their name, and the community cards with the pot in the middle.
// On your turn the buttons under your bar are fold, check or call, and a bet or raise.
import { TrickView } from './trick-view.js';
import { RATIO, div, setBox, clamp, esc, AVATARS } from './view.js';
import { POKER_BACK } from './textures.js';
import { legalActions, sizing, chipText } from '../poker/rules.js';

const BETTING = new Set(['preflop', 'flop', 'turn', 'river']);
const STREET = { blinds: 'Blinds', deal: 'Dealing', preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' };

export class PokerView extends TrickView {
  constructor(container) {
    super(container, { back: POKER_BACK });
    this.root.classList.add('poker');
    this.acting = false;
    this.actKey = '';
    this.handlers.action = () => {};
    this.felt = div('pk-felt', this.panelLayer);
    this.potEl = div('pk-pot', this.panelLayer);
    this.resultEl = div('pk-result hidden', this.panelLayer);
    this.actions = div('pk-actions hidden', this.panelLayer);
    this.actions.innerHTML = `
      <div class="pk-row">
        <button type="button" data-act="fold" class="ghost">Fold</button>
        <button type="button" data-act="check">Check</button>
        <button type="button" data-act="call" class="primary">Call</button>
        <button type="button" data-act="allin">All-in</button>
      </div>
      <div class="pk-row pk-bet">
        <button type="button" data-act="min" class="ghost">Min</button>
        <button type="button" data-act="half" class="ghost">½</button>
        <input type="range" data-act="slider" min="0" max="1" step="1" aria-label="Bet size">
        <button type="button" data-act="pot" class="ghost">Pot</button>
        <b class="pk-amt"></b>
        <button type="button" data-act="raise" class="primary">Raise</button>
      </div>`;
    this.foldBtn = this.actions.querySelector('[data-act="fold"]');
    this.checkBtn = this.actions.querySelector('[data-act="check"]');
    this.callBtn = this.actions.querySelector('[data-act="call"]');
    this.allInBtn = this.actions.querySelector('[data-act="allin"]');
    this.betRow = this.actions.querySelector('.pk-bet');
    this.slider = this.actions.querySelector('[data-act="slider"]');
    this.amtEl = this.actions.querySelector('.pk-amt');
    this.raiseBtn = this.actions.querySelector('[data-act="raise"]');
    this.minBtn = this.actions.querySelector('[data-act="min"]');
    this.halfBtn = this.actions.querySelector('[data-act="half"]');
    this.potBtn = this.actions.querySelector('[data-act="pot"]');
    this.actions.addEventListener('click', (e) => this.onAction(e));
    this.slider.addEventListener('input', () => this.showAmount());
  }

  setActing(on) {
    this.acting = on;
    if (!on) this.actKey = '';
    this.layout();
  }

  onAction(e) {
    if (!this.acting) return;
    const btn = e.target.closest('button');
    if (!btn) return;
    const act = btn.dataset.act;
    const to = Number(this.slider.value);
    if (act === 'fold') this.handlers.action({ action: 'fold' });
    else if (act === 'check') this.handlers.action({ action: 'check' });
    else if (act === 'call') this.handlers.action({ action: 'call' });
    else if (act === 'allin') this.handlers.action({ action: 'allin' });
    else if (act === 'raise') this.handlers.action({ action: this.raiseKind, to });
    else if (act === 'min' || act === 'half' || act === 'pot') this.setSlider(this.sizes?.[act] ?? to);
  }

  setSlider(to) {
    const min = Number(this.slider.min);
    const max = Number(this.slider.max);
    this.slider.value = String(clamp(to, min, max));
    this.showAmount();
  }

  showAmount() {
    const to = Number(this.slider.value);
    const text = chipText(to);
    if (this.amtEl.textContent !== text) this.amtEl.textContent = text;
    const single = Number(this.slider.min) === Number(this.slider.max);
    const label = single ? `All-in ${text}` : `${this.raiseKind === 'bet' ? 'Bet' : 'Raise'} ${text}`;
    if (this.raiseBtn.textContent !== label) this.raiseBtn.textContent = label;
  }

  detach() {
    this.acting = false;
    this.actKey = '';
    this.actions.classList.add('hidden');
    this.resultEl.classList.add('hidden');
    this.potEl.textContent = '';
    super.detach();
  }

  buildPanels(game) {
    for (const p of this.panels) p.el.remove();
    for (const t of this.tags) t.remove();
    this.tags = [];
    this.panels = game.state.players.map((_, i) => {
      const el = div('seat-panel', this.panelLayer);
      el.style.setProperty('--c', AVATARS[i % AVATARS.length]);
      return { el, head: div('seat-head', el), html: '' };
    });
  }

  // Opponents across the top, you along the bottom, the board between, and room
  // under your bar for the buttons so they don't cover the cards.
  fit() {
    const { w, h } = this.size;
    const ins = this.inset;
    const portrait = ins.portrait;
    const n = this.game?.state.players.length ?? 4;
    const k = Math.max(1, n - 1);
    const small = w < 700 || h < 540;
    const pad = small ? 8 : 14;
    const gap = small ? 6 : 10;
    const head = small ? 30 : 36;
    const actionH = small || portrait ? 76 : 74;

    const hw = portrait ? Math.min((0.15 * h) / RATIO, w * 0.2, 92) : Math.min((0.18 * h) / RATIO, w * 0.11, 116);
    const ch = hw * RATIO;
    const trayH = ch + 14;
    const x0 = pad;
    const x1 = w - pad - (portrait ? 0 : ins.right);
    const trayTop = h - 8 - trayH;
    // Buttons sit just above your cards. On a phone the status line is a row of its
    // own between your name and those buttons (ins.bottom is that row's height).
    const statusGap = portrait ? ins.bottom : 0;
    const actionTop = trayTop - actionH;
    const hand = { x0, x1, top: trayTop, h: trayH, cw: hw, visible: trayH + actionH + (portrait ? 0 : 12) };

    const W = w - 2 * pad;
    const meBottom = actionTop - statusGap - 4;
    const meW = portrait ? W : Math.min(W, 560);
    const panels = [{ x: (w - meW) / 2, y: meBottom - head, w: meW, h: head }];
    const cols = portrait ? Math.min(k, 2) : k > 4 ? Math.ceil(k / 2) : k;
    const colW = Math.min((W - (cols - 1) * gap) / cols, portrait ? Infinity : 300);
    const top = ins.top + 6;
    for (let i = 0; i < k; i++) {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, k - row * cols);
      const rowX = (w - (inRow * colW + (inRow - 1) * gap)) / 2;
      panels.push({ x: rowX + (i % cols) * (colW + gap), y: top + row * (head + gap), w: colW, h: head });
    }
    const oppBottom = top + Math.ceil(k / cols) * (head + gap);
    // Hole cards hang under each opponent's bar; keep the board clear of them.
    const boardTop = oppBottom + (small ? 48 : 62);
    const boardBottom = panels[0].y - 8;
    const boardH = Math.max(64, boardBottom - boardTop);
    const cw = clamp(Math.min(hw, (W - 48) / 6.2, (boardH - 28) / RATIO), 34, hw);
    const board = { x: w / 2, y: boardTop + Math.min(boardH * 0.62, boardH - cw * RATIO * 0.55), w: cw, top: boardTop, h: boardH };
    const deck = { x: board.x, y: board.y, w: cw * 0.86 };
    this.geo = { portrait, small, head, inner: small ? 6 : 10, panels, hand, board, actionH, actionTop, deck, discard: deck, dock: h - panels[0].y };
    this.layoutKey = `poker:${portrait ? 'tall' : 'wide'}:${n}:${small}`;
    this.root.style.setProperty('--head', `${head}px`);
    this.root.style.setProperty('--inner', `${this.geo.inner}px`);
    this.root.style.setProperty('--side', '0px');
    this.root.classList.toggle('small', small);
    this.root.classList.remove('bars');
  }

  talkSpot() {
    return this.geo.portrait ? { top: this.barsBottom() + 8 } : { bottom: this.geo.hand.visible + 16 };
  }

  layout() {
    const game = this.game;
    if (!game) return;
    const { state } = game;
    this.seen.clear();
    const cards = [...state.deck, ...state.board, ...state.players.flatMap((p) => p.hole)];
    let fresh = false;
    for (const card of cards) {
      if (!this.cards.has(card.id)) fresh = true;
      this.objFor(card);
    }
    if (fresh && !this.snapping) void this.cardLayer.offsetWidth;
    this.ringsSeen = new Set();

    this.layoutBoard(state);
    const me = state.players[this.seat];
    state.players.forEach((p, i) => {
      const zi = this.zoneIndex(i);
      this.layoutPanel(p, i, zi);
      if (zi === 0) this.layoutHand(p, !p.hole.some((c) => c.hidden));
      else this.layoutOpp(p, zi);
    });
    this.layoutChrome(state, me);
    const betting = BETTING.has(state.phase);
    this.root.classList.toggle('my-turn', this.acting && betting && state.current === this.seat);
    this.finishLayout();
  }

  layoutBoard(state) {
    const { board } = this.geo;
    const cards = state.board;
    const n = cards.length;
    const cw = board.w;
    const gap = cw * 0.14;
    const span = n ? n * cw + Math.max(0, n - 1) * gap : 0;
    const left = board.x - span / 2;
    cards.forEach((card, i) => {
      const obj = this.objFor(card);
      obj.zone = { zone: 'board' };
      this.place(obj, left + cw / 2 + i * (cw + gap), board.y, cw, { z: 420 + i });
      obj.live = false;
      obj.el.classList.remove('live');
      obj.el.classList.remove('dim');
    });
    const showDeck = state.deck.length > 0 && state.phase !== 'over';
    const dx = n ? left - cw * 0.85 : board.x;
    state.deck.forEach((card, i) => {
      const obj = this.objFor(card);
      obj.zone = { zone: 'deck' };
      const lift = Math.min(i, 16) * 0.18;
      this.place(obj, dx - lift * 0.3, board.y - lift, cw * 0.82, { up: false, gone: !showDeck, z: 8 + i });
    });
    const feltW = Math.min(this.size.w - 24, Math.max(span + cw * 2.4, cw * 5.2));
    const feltH = cw * RATIO + (this.geo.small ? 36 : 52);
    setBox(this.felt, { x: board.x - feltW / 2, y: board.y - feltH / 2, w: feltW, h: feltH });
  }

  layoutPanel(p, i, zi) {
    const r = this.geo.panels[zi];
    const panel = this.panels[i];
    const { state } = this.game;
    setBox(panel.el, r);
    const mine = zi === 0;
    const wonPot = !!state.result?.pots?.some((pot) => pot.winners.includes(p.id));
    panel.el.classList.toggle('me', mine);
    panel.el.classList.toggle('active', state.current === i && BETTING.has(state.phase));
    panel.el.classList.toggle('winner', (state.phase === 'over' && state.winners.includes(p)) || (state.phase === 'showdown' && wonPot));
    panel.el.classList.toggle('folded', p.folded);
    panel.el.classList.toggle('out', p.out);
    panel.el.classList.toggle('compact', r.w < 220);

    const you = mine && p.isHuman && p.name.trim().toLowerCase() !== 'you' ? '<span class="you">You</span>' : '';
    const tag = p.tag ? `<span class="tag">${p.tag}</span>` : '';
    const initial = [...p.name.trim()][0]?.toUpperCase() ?? '?';
    const dealer = state.button === i ? '<span class="den-pill" title="Dealer button">D</span>' : '';
    const sb = state.sb === i ? '<span class="den-pill pk-blind" title="Small blind">SB</span>' : '';
    const bb = state.bb === i ? '<span class="den-pill pk-blind" title="Big blind">BB</span>' : '';
    const status = p.out ? '<span class="den-pill pk-out">Out</span>' : p.folded ? '<span class="den-pill pk-fold">Fold</span>' : p.allIn ? '<span class="den-pill pk-allin">All-in</span>' : '';
    const bet = p.bet ? `<span class="chip play" title="In front this street">${chipText(p.bet)}</span>` : '';
    const won = state.phase === 'showdown' && p.won ? `<span class="chip money" title="Collected this hand">+${chipText(p.won)}</span>` : '';
    const html = `<span class="avatar">${esc(initial)}</span><span class="seat-name">${tag}${esc(p.name)}</span><span class="mic"></span>${you}${dealer}${sb}${bb}${status}<span class="chips">${bet}${won}<span class="chip score" title="Stack">${chipText(p.stack)}</span></span>`;
    if (html !== panel.html) {
      panel.head.innerHTML = html;
      panel.html = html;
    }
  }

  layoutHand(p, show) {
    const g = this.geo.hand;
    const cards = p.hole;
    const n = cards.length;
    const cw = g.cw;
    const ch = cw * RATIO;
    const step = cw * 0.72;
    const span = n ? cw + step * Math.max(n - 1, 0) : cw * 2;
    const trayW = this.geo.portrait ? g.x1 - g.x0 : Math.min(g.x1 - g.x0, Math.max(span, cw * 2.4) + 24);
    const cx = clamp(this.size.w / 2, g.x0 + trayW / 2, g.x1 - trayW / 2);
    setBox(this.tray, { x: cx - trayW / 2, y: g.top, w: trayW, h: g.h });
    const folded = p.folded;
    cards.forEach((card, i) => {
      const x = cx - span / 2 + cw / 2 + i * step;
      let y = g.top + g.h / 2;
      let size = cw;
      if (!folded && card.id === this.hoverId) {
        y -= ch * 0.12;
        size *= 1.06;
      }
      const obj = this.objFor(card);
      obj.zone = { zone: 'hand', playerId: p.id };
      this.place(obj, x, y, size, { rot: (i - (n - 1) / 2) * 3, z: 640 + i, up: show });
      obj.el.classList.toggle('dim', folded);
    });
  }

  layoutOpp(p, zi) {
    const r = this.geo.panels[zi];
    const cards = p.hole;
    const { state } = this.game;
    const open = state.revealed && !p.folded;
    const muck = p.folded || !cards.length;
    const cw = Math.min(this.geo.board.w * 0.62, r.w * 0.28, 46);
    const ch = cw * RATIO;
    cards.forEach((card, i) => {
      const obj = this.objFor(card);
      obj.zone = { zone: 'ohand', playerId: p.id };
      const x = r.x + r.w / 2 + (i - (cards.length - 1) / 2) * cw * 0.62;
      const y = r.y + r.h + ch * 0.42;
      this.place(obj, x, y, cw, { up: open && !card.hidden, gone: muck, z: 500 + i });
      obj.el.classList.toggle('dim', false);
    });
    if (open && state.result?.pots?.some((pot) => pot.winners.includes(p.id)) && cards.length) {
      const span = cw + cw * 0.62 * (cards.length - 1);
      this.ring(`win-${p.id}`, { x: r.x + r.w / 2 - span / 2, y: r.y + r.h + ch * 0.42 - ch / 2, w: span, h: ch }, 490);
    }
  }

  layoutChrome(state, me) {
    const { board, panels, actionH } = this.geo;
    const inFront = state.players.reduce((s, p) => s + p.bet, 0);
    const settled = state.phase === 'showdown' || state.phase === 'over';
    const total = settled ? state.pot : state.pot + inFront;
    const street = STREET[state.phase] ?? '';
    const potLine = state.hand ? `Pot ${chipText(total)}` : 'Pot';
    const sub = !settled && inFront && state.pot ? `${chipText(state.pot)} + ${chipText(inFront)} in bets` : street;
    const potHtml = `<b>${potLine}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`;
    if (this.potEl.innerHTML !== potHtml) this.potEl.innerHTML = potHtml;
    const ch = board.w * RATIO;
    const potW = Math.min(this.size.w - 24, this.geo.small ? 168 : 200);
    const potH = this.geo.small ? 32 : 38;
    setBox(this.potEl, { x: board.x - potW / 2, y: board.y - ch / 2 - potH - 2, w: potW, h: potH });

    const result = (state.phase === 'showdown' || state.phase === 'over') && state.result?.text ? state.result.text : '';
    this.resultEl.classList.toggle('hidden', !result);
    if (result && this.resultEl.textContent !== result) this.resultEl.textContent = result;
    if (result) {
      const rw = Math.min(this.size.w - 24, 480);
      const rh = this.geo.small ? 48 : 40;
      setBox(this.resultEl, { x: board.x - rw / 2, y: board.y + ch / 2 + 6, w: rw, h: rh });
    }

    const betting = this.acting && BETTING.has(state.phase) && me && state.current === me.id;
    this.actions.classList.toggle('hidden', !betting);
    if (!betting) return;
    const bar = panels[0];
    setBox(this.actions, { x: bar.x, y: this.geo.actionTop, w: bar.w, h: actionH - 6 });
    const opts = legalActions(state, me.id);
    this.foldBtn.hidden = !opts.fold;
    this.checkBtn.hidden = !opts.check;
    this.callBtn.hidden = !opts.call;
    if (opts.call) {
      const callIsAllIn = opts.allIn === me.bet + opts.call;
      const label = `${callIsAllIn ? 'All-in' : 'Call'} ${chipText(opts.call)}`;
      if (this.callBtn.textContent !== label) this.callBtn.textContent = label;
      this.callBtn.dataset.allin = callIsAllIn ? '1' : '';
    }
    const single = !!(opts.bet && opts.bet.min === opts.bet.max);
    const showAllIn = !!opts.allIn && !single && !(opts.call && opts.allIn === me.bet + opts.call);
    this.allInBtn.hidden = !showAllIn;
    if (showAllIn) {
      const label = `All-in ${chipText(opts.allIn - me.bet)}`;
      if (this.allInBtn.textContent !== label) this.allInBtn.textContent = label;
    }
    this.betRow.hidden = !opts.bet;
    this.raiseKind = state.toCall === 0 ? 'bet' : 'raise';
    if (opts.bet) {
      const sizes = sizing(state, me.id);
      this.sizes = sizes;
      const key = `${opts.bet.min}:${opts.bet.max}:${state.toCall}`;
      if (key !== this.actKey) {
        this.actKey = key;
        this.slider.min = String(opts.bet.min);
        this.slider.max = String(opts.bet.max);
        this.slider.value = String(opts.bet.min);
      }
      this.slider.hidden = single;
      this.minBtn.hidden = single;
      this.halfBtn.hidden = single;
      this.potBtn.hidden = single;
      this.amtEl.hidden = single;
      this.showAmount();
    }
  }
}
