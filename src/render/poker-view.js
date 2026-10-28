// The Hold'em table, on the same card table as the trick games: a bar per player
// (stack, bet, button and blinds), your two cards along the bottom, everyone else's
// face down by their name, and the community cards with the pot in the middle.
// On your turn the buttons under your bar are fold, check or call, and a bet or raise.
import { TrickView } from './trick-view.js';
import { RATIO, MOVE_MS, div, setBox, offsetIn, clamp, r1, esc, AVATARS } from './view.js';
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
    this.resultEl = div('pk-result', this.panelLayer);
    this.resultEl.innerHTML = '<span class="pk-result-text"></span><button type="button" class="pk-next primary">Next hand</button>';
    this.resultText = this.resultEl.querySelector('.pk-result-text');
    this.nextBtn = this.resultEl.querySelector('.pk-next');
    this.holding = false;
    this.handlers.next = null;
    this.onNextKey = (e) => {
      if (!this.holding || this.nextBtn.disabled || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest?.('input, textarea')) return;
      if (document.querySelector('#modal-layer .modal-backdrop')) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      this.skipHold();
    };
    this.nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.skipHold();
    });
    this.actions = div('pk-actions', this.panelLayer);
    this.pendingCoins = 0;
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

  // Next hand sits where Fold was. A click that ends the hand can land on it, so
  // taps in the first moment are ignored and the result stays up to be read.
  skipHold() {
    if (!this.holding || this.nextBtn.disabled || Date.now() < this.holdArmedAt) return;
    this.handlers.next?.();
  }

  // The showdown is being read. Next hand (or Enter) deals again before the timer.
  setHolding(on) {
    this.holding = !!on;
    this.holdArmedAt = this.holding ? Date.now() + 700 : 0;
    if (!this.holding) this.handlers.next = null;
    this.nextBtn.disabled = false;
    this.nextBtn.textContent = 'Next hand';
    document.removeEventListener('keydown', this.onNextKey);
    if (this.holding) document.addEventListener('keydown', this.onNextKey);
    if (this.game) this.layout();
  }

  // Online, once you've tapped and the others haven't yet.
  noteNextSent() {
    this.nextBtn.disabled = true;
    this.nextBtn.textContent = 'Waiting…';
  }

  detach() {
    this.acting = false;
    this.actKey = '';
    this.pendingCoins = 0;
    this.holding = false;
    this.handlers.next = null;
    document.removeEventListener('keydown', this.onNextKey);
    this.actions.classList.remove('on');
    this.resultEl.classList.remove('on', 'hold');
    this.potEl.textContent = '';
    for (const el of this.cardLayer.querySelectorAll('.pk-fly')) el.remove();
    super.detach();
  }

  buildPanels(game) {
    for (const p of this.panels) p.el.remove();
    for (const t of this.tags) t.remove();
    this.tags = [];
    this.panels = game.state.players.map((_, i) => {
      const el = div('seat-panel', this.panelLayer);
      el.style.setProperty('--c', AVATARS[i % AVATARS.length]);
      return { el, head: div('seat-head', el), html: '', bet: null, won: null, betAt: null, stackAt: null, seen: false };
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
    const cw = clamp(Math.min(hw, (W - 24) / 7, (boardH - 28) / RATIO), 34, hw);
    // Five fixed community slots, centred. The turn and the river fill the next
    // slot; nothing already dealt slides over to make room.
    const boardGap = cw * 0.16;
    const span = 5 * cw + 4 * boardGap;
    const deckW = cw * 0.86;
    // Keep the deck fully on the felt. On a narrow window that shifts the five
    // slots right as a group, so a dealt card still has a fixed slot.
    let rowLeft = (w - span) / 2;
    let deckX = rowLeft - cw * 0.62;
    const minDeck = pad + deckW / 2 + 2;
    if (deckX < minDeck) {
      deckX = minDeck;
      rowLeft = Math.min(deckX + cw * 0.62, Math.max(pad, w - pad - span));
    }
    const board = { x: rowLeft + span / 2, y: boardTop + Math.min(boardH * 0.62, boardH - cw * RATIO * 0.55), w: cw, top: boardTop, h: boardH, gap: boardGap, left: rowLeft, span };
    // New cards are born at geo.discard (objFor). That is the deck, so a deal glides.
    const deck = { x: deckX, y: board.y, w: deckW };
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
    if (this.pendingCoins) {
      this.handlers.coin?.(this.pendingCoins);
      this.pendingCoins = 0;
    }
  }

  layoutBoard(state) {
    const { board, deck } = this.geo;
    const cards = state.board;
    const cw = board.w;
    const gathering = state.phase === 'between';
    if (gathering) {
      for (const card of cards) this.placeOnDeck(card, false);
    } else {
      cards.forEach((card, i) => {
        const obj = this.objFor(card);
        obj.zone = { zone: 'board' };
        const x = board.left + cw / 2 + i * (cw + board.gap);
        this.place(obj, x, board.y, cw, { z: 420 + i });
        obj.el.classList.remove('dim');
      });
    }
    // The stub stays in one place. It shows while cards are coming off it and
    // while bets are live, and fades out when the hand is being gathered.
    const showDeck = state.deck.length > 0 && (state.phase === 'deal' || BETTING.has(state.phase));
    state.deck.forEach((card, i) => {
      const obj = this.objFor(card);
      obj.zone = { zone: 'deck' };
      const lift = Math.min(i, 16) * 0.18;
      this.place(obj, deck.x - lift * 0.3, deck.y - lift, deck.w, { up: false, gone: !showDeck, z: 8 + i });
    });
    const feltW = Math.min(this.size.w - 16, board.span + cw * 2.6);
    const feltH = cw * RATIO + (this.geo.small ? 44 : 58);
    setBox(this.felt, { x: board.x - feltW / 2, y: board.y - feltH / 2, w: feltW, h: feltH });
  }

  // A card already on the table, sent back to the deck face down so it can fade there.
  placeOnDeck(card, faceUp) {
    const d = this.geo.deck;
    const obj = this.objFor(card);
    obj.zone = { zone: 'deck' };
    this.place(obj, d.x, d.y, d.w, { up: faceUp, gone: true, z: 80 });
  }

  layoutPanel(p, i, zi) {
    const r = this.geo.panels[zi];
    const panel = this.panels[i];
    const { state } = this.game;
    setBox(panel.el, r);
    const mine = zi === 0;
    const celebrating = state.phase === 'showdown' || state.phase === 'between';
    const wonPot = !!state.result?.pots?.some((pot) => pot.winners.includes(p.id));
    panel.el.classList.toggle('me', mine);
    panel.el.classList.toggle('active', state.current === i && BETTING.has(state.phase));
    panel.el.classList.toggle('winner', (state.phase === 'over' && state.winners.includes(p)) || (celebrating && wonPot));
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
    const won = celebrating && p.won ? `<span class="chip money" title="Collected this hand">+${chipText(p.won)}</span>` : '';
    const html = `<span class="avatar">${esc(initial)}</span><span class="seat-name">${tag}${esc(p.name)}</span><span class="mic"></span>${you}${dealer}${sb}${bb}${status}<span class="chips">${bet}${won}<span class="chip score" title="Stack">${chipText(p.stack)}</span></span>`;
    const fromBet = panel.betAt;
    const prevBet = panel.bet;
    const prevWon = panel.won;
    if (html !== panel.html) {
      panel.head.innerHTML = html;
      panel.html = html;
      panel.stackAt = this.chipAt(panel, '.chip.score');
      panel.betAt = this.chipAt(panel, '.chip.play');
    }
    // Chips glide the way banked money and taken tricks do: from the stack to the
    // bet, from the bet into the pot, and from the pot back to a winner.
    if (panel.seen && !this.snapping) {
      const added = p.bet - (prevBet || 0);
      if (added > 0 && panel.stackAt && panel.betAt) this.flyChip(panel.stackAt, panel.betAt, chipText(added));
      else if (added < 0 && fromBet) this.flyChip(fromBet, panel.betAt || this.potAt(), chipText(-added));
      const gained = (p.won || 0) - (prevWon || 0);
      if (gained > 0 && panel.stackAt) this.flyChip(this.potAt(), panel.stackAt, `+${chipText(gained)}`);
    }
    panel.seen = true;
    panel.bet = p.bet;
    panel.won = p.won || 0;
  }

  chipAt(panel, sel) {
    const chip = panel.head.querySelector(sel);
    if (!chip?.offsetWidth) return null;
    const at = offsetIn(chip, this.root);
    return { x: at.x + chip.offsetWidth / 2, y: at.y + chip.offsetHeight / 2 };
  }

  potAt() {
    const { board, small } = this.geo;
    const ch = board.w * RATIO;
    const potH = small ? 32 : 38;
    return { x: board.x, y: board.y - ch / 2 - 2 - potH / 2 };
  }

  // A chip token on the same glide as a card (MOVE_MS, the shared easing).
  flyChip(from, to, text) {
    if (!from || !to || Math.hypot(to.x - from.x, to.y - from.y) < 12) return;
    const el = div('pk-fly', this.cardLayer, text);
    const at = (p) => `translate(${r1(p.x)}px, ${r1(p.y)}px) translate(-50%, -50%)`;
    el.style.transition = 'none';
    el.style.transform = at(from);
    void el.offsetWidth;
    el.style.transition = '';
    el.style.transform = at(to);
    setTimeout(() => {
      el.style.opacity = '0';
    }, MOVE_MS - 90);
    setTimeout(() => el.remove(), MOVE_MS + 80);
    this.pendingCoins += 1;
  }

  layoutHand(p, show) {
    const g = this.geo.hand;
    const cards = p.hole;
    if (this.game.state.phase === 'between') {
      for (const card of cards) this.placeOnDeck(card, false);
    }
    const cw = g.cw;
    const ch = cw * RATIO;
    // Two fixed slots, so the first hole card stays put when the second arrives.
    const step = cw * 0.72;
    const span = cw + step;
    const trayW = this.geo.portrait ? g.x1 - g.x0 : Math.min(g.x1 - g.x0, Math.max(span, cw * 2.4) + 24);
    const cx = clamp(this.size.w / 2, g.x0 + trayW / 2, g.x1 - trayW / 2);
    setBox(this.tray, { x: cx - trayW / 2, y: g.top, w: trayW, h: g.h });
    const folded = p.folded;
    if (this.game.state.phase === 'between') return;
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
      this.place(obj, x, y, size, { rot: (i - 0.5) * 3, z: 640 + i, up: show });
      obj.el.classList.toggle('dim', folded);
    });
  }

  layoutOpp(p, zi) {
    const r = this.geo.panels[zi];
    const cards = p.hole;
    const { state } = this.game;
    const gathering = state.phase === 'between';
    const open = state.revealed && !p.folded && !gathering;
    const muck = !gathering && (p.folded || !cards.length);
    const cw = Math.min(this.geo.board.w * 0.62, r.w * 0.28, 46);
    const ch = cw * RATIO;
    const head = this.geo.head;
    const avatar = head * 0.66;
    const ax = r.x + this.geo.inner + avatar / 2;
    const ay = r.y + head / 2;
    cards.forEach((card, i) => {
      if (gathering) {
        this.placeOnDeck(card, false);
        return;
      }
      const obj = this.objFor(card);
      if (muck) {
        // Folded cards shrink into the avatar, the way an opponent's hand does
        // in Monopoly Deal and a taken trick does in Call Bridge.
        obj.zone = { zone: 'muck', playerId: p.id };
        this.place(obj, ax, ay, 16, { up: false, gone: true, z: 80 + i });
        return;
      }
      obj.zone = { zone: 'ohand', playerId: p.id };
      const x = r.x + r.w / 2 + (i - 0.5) * cw * 0.62;
      const y = r.y + r.h + ch * 0.42;
      this.place(obj, x, y, cw, { up: open && !card.hidden, gone: false, z: 500 + i });
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
    const settled = state.phase === 'showdown' || state.phase === 'between' || state.phase === 'over';
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

    const bar = panels[0];
    const result = settled && state.result?.text ? state.result.text : '';
    if (this.holding && state.phase !== 'showdown') {
      this.holding = false;
      this.handlers.next = null;
      this.nextBtn.disabled = false;
      this.nextBtn.textContent = 'Next hand';
      document.removeEventListener('keydown', this.onNextKey);
    }
    const hold = this.holding && state.phase === 'showdown';
    this.resultEl.classList.toggle('on', !!result);
    this.resultEl.classList.toggle('hold', hold);
    if (result && this.resultText.textContent !== result) {
      this.resultText.textContent = result;
      this.resultEl.title = result;
    }
    // The showdown line takes the button row, so it doesn't cover the name or the board.
    const rw = Math.min(bar.w, this.size.w - 24);
    setBox(this.resultEl, { x: bar.x + (bar.w - rw) / 2, y: this.geo.actionTop, w: rw, h: actionH - 6 });

    setBox(this.actions, { x: bar.x, y: this.geo.actionTop, w: bar.w, h: actionH - 6 });
    const betting = this.acting && BETTING.has(state.phase) && me && state.current === me.id;
    this.actions.classList.toggle('on', !!betting);
    if (!betting) return;
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
