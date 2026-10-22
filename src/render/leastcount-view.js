// The Least Count table, built on Call Bridge's: a header bar per player (score, cards
// in hand), your hand along the bottom, and in the middle the deck with the wild card
// tucked under it, the cards thrown so far, and the last throw spread out, which the
// next player can take a card from. On your turn you pick cards in your hand to throw
// (they lift), then tap the deck or a card of the last throw; or press Show. After a
// Show everyone's hand is laid out under their bar.
import { TrickView } from './trick-view.js';
import { RATIO, TRAY_PAD, div, setBox, clamp, r1, esc } from './view.js';
import { LEASTCOUNT_BACK } from './textures.js';
import { rankName } from './deck-style.js';
import { handTotal, isZero, throwKind, value } from '../leastcount/rules.js';

// Phases where every hand is face up.
const OPEN = new Set(['show', 'scoring', 'over']);
// How much of each card in the last throw shows (of its width).
const FAN = 0.42;

// The wild rank in words, in the deck style: "7s", "Queens", "Elves".
const PLURALS = { Elf: 'Elves', Phoenix: 'Phoenixes' };
const wildRanks = (rank) => {
  const name = rankName(rank);
  return PLURALS[name] ?? `${name}s`;
};

const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export class LeastCountView extends TrickView {
  constructor(container) {
    super(container, { back: LEASTCOUNT_BACK });
    this.root.classList.add('leastcount');
    this.picked = new Set();
    this.picking = false;
    this.handlers.show = () => {};
    this.labels = { deck: div('lc-label hidden', this.panelLayer), wild: div('lc-label wild hidden', this.panelLayer), last: div('lc-label hidden', this.panelLayer) };
    this.actionsEl = div('lc-actions hidden', this.panelLayer);
    this.hintEl = div('lc-hint', this.actionsEl);
    this.showBtn = document.createElement('button');
    this.showBtn.className = 'primary lc-show';
    this.showBtn.addEventListener('click', () => this.handlers.show());
    this.actionsEl.appendChild(this.showBtn);
  }

  // Your turn (or not): cards in your hand can be picked.
  setPicking(on) {
    this.picking = on;
    this.picked.clear();
    this.layout();
  }

  toggle(id) {
    if (!this.picking) return;
    if (this.picked.has(id)) this.picked.delete(id);
    else this.picked.add(id);
    this.layout();
  }

  detach() {
    for (const l of Object.values(this.labels)) l.classList.add('hidden');
    this.actionsEl.classList.add('hidden');
    this.picking = false;
    this.picked.clear();
    super.detach();
  }

  // ---------- geometry ----------

  // Call Bridge's layout, with the middle split: the deck on the left, then the cards
  // thrown so far, and the last throw spread out on the right.
  fit() {
    super.fit();
    const t = this.geo.trick;
    const W = this.size.w - 24;
    const w = Math.min(t.w, W / 5.2);
    const x0 = t.x - 0.2 * w;
    this.geo.lc = {
      w,
      deck: { x: x0 - 1.35 * w, y: t.y },
      discard: { x: x0 + 0.1 * w, y: t.y },
      last: { x: x0 + 1.55 * w, y: t.y },
    };
  }

  // ---------- layout ----------

  layout() {
    const game = this.game;
    if (!game) return;
    const { state } = game;
    this.seen.clear();
    const cards = [...state.deck, ...state.discard, ...(state.last?.cards ?? []), ...(state.wildCard ? [state.wildCard] : []), ...state.players.flatMap((p) => p.hand)];
    let fresh = false;
    for (const card of cards) {
      if (!this.cards.has(card.id)) fresh = true;
      this.objFor(card);
    }
    if (fresh && !this.snapping) void this.cardLayer.offsetWidth;
    this.ringsSeen = new Set();
    // Picked cards that have left the hand (the throw went) are dropped.
    const me = state.players[this.seat];
    for (const id of this.picked) if (!me?.hand.some((c) => c.id === id)) this.picked.delete(id);

    this.layoutMiddle(state);
    state.players.forEach((p, i) => {
      const zi = this.zoneIndex(i);
      this.layoutPanel(p, i, zi);
      if (zi === 0) this.layoutHand(p, p.isHuman);
      else this.layoutOpponentHand(p, zi);
    });
    this.layoutActions(state, me);
    this.root.classList.toggle('my-turn', this.picking);
    this.finishLayout();
  }

  layoutMiddle(state) {
    const { w, deck, discard, last } = this.geo.lc;
    const ch = w * RATIO;
    const live = state.phase === 'turn';
    state.deck.forEach((card, i) => {
      const obj = this.objFor(card);
      obj.zone = { zone: 'deck' };
      const lift = Math.min(i, 24) * 0.22;
      this.place(obj, deck.x - lift * 0.4, deck.y - lift, w, { up: false, z: 20 + i });
      obj.el.classList.toggle('pickable', this.picking && i === state.deck.length - 1);
    });
    // The wild card lies across under the deck, half showing.
    if (state.wildCard) {
      const obj = this.objFor(state.wildCard);
      obj.zone = { zone: 'wild' };
      this.place(obj, deck.x + 0.42 * w, deck.y + 0.1 * ch, w, { rot: 90, z: 10 });
    }
    // Earlier throws in a heap; the last one spread out on top of its own spot.
    state.discard.forEach((card, i) => {
      const obj = this.objFor(card);
      obj.zone = { zone: 'discard' };
      const j = 0.12 * w;
      this.place(obj, discard.x + (hash(card.id + 7) - 0.5) * j, discard.y + (hash(card.id + 3) - 0.5) * j, w * 0.92, { rot: (hash(card.id) - 0.5) * 30, z: 100 + i });
    });
    const thrown = state.last?.cards ?? [];
    const span = w * (1 + FAN * Math.max(thrown.length - 1, 0));
    thrown.forEach((card, k) => {
      const obj = this.objFor(card);
      obj.zone = { zone: 'last' };
      this.place(obj, last.x - span / 2 + w / 2 + k * FAN * w, last.y, w, { z: 400 + k });
      obj.el.classList.toggle('pickable', this.picking);
    });

    // Labels under the deck (with the wild rank) and the last throw.
    const label = (el, text, x, y) => {
      el.classList.toggle('hidden', !text);
      if (!text) return;
      if (el.textContent !== text) el.textContent = text;
      el.style.left = `${r1(x)}px`;
      el.style.top = `${r1(y)}px`;
    };
    const below = deck.y + ch / 2 + 6;
    label(this.labels.deck, live || state.phase === 'deal' ? `Deck · ${state.deck.length}` : '', deck.x, below);
    label(this.labels.wild, state.wild ? `Wild: ${wildRanks(state.wild)} count 0` : '', deck.x, below + 18);
    const by = state.last?.playerId != null ? state.players[state.last.playerId] : null;
    const lastText = !thrown.length ? '' : by ? `Thrown by ${by.id === this.seat && by.isHuman ? 'you' : by.name}` : 'Turned up';
    label(this.labels.last, lastText, last.x, below);
  }

  layoutPanel(p, i, zi) {
    const r = this.geo.panels[zi];
    const panel = this.panels[i];
    const { state } = this.game;
    setBox(panel.el, r);
    const mine = zi === 0;
    panel.el.classList.toggle('me', mine);
    panel.el.classList.toggle('active', state.current === i && state.phase === 'turn');
    panel.el.classList.toggle('winner', state.phase === 'over' && state.winners.includes(p));
    panel.el.classList.toggle('compact', r.w < 240);

    const you = mine && p.isHuman && p.name.trim().toLowerCase() !== 'you' ? '<span class="you">You</span>' : '';
    const tag = p.tag ? `<span class="tag">${p.tag}</span>` : '';
    const initial = [...p.name.trim()][0]?.toUpperCase() ?? '?';
    const dealer = state.dealer === i && state.phase !== 'over' ? '<span class="den-pill" title="Deals this round">Dealer</span>' : '';
    const open = OPEN.has(state.phase);
    const called = state.caller === i && open ? `<span class="den-pill lc-called${state.caught ? ' caught' : ''}">${state.caught ? 'Caught' : 'Show'}</span>` : '';
    // Your own hand's worth while you play; everyone's once a Show lays them out.
    const worth = open && p.total != null ? p.total : mine && p.isHuman && state.phase === 'turn' ? handTotal(p.hand, state.wild) : null;
    const worthChip = worth == null ? '' : `<span class="chip lc-worth" title="What the hand is worth">= ${worth}</span>`;
    const count = mine && p.isHuman ? '' : `<span class="chip" title="Cards in hand"><i class="mini-card"></i>${p.hand.length}</span>`;
    const html = `<span class="avatar">${esc(initial)}</span><span class="seat-name">${tag}${esc(p.name)}</span><span class="mic"></span>${you}${dealer}${called}<span class="chips">${worthChip}${count}<span class="chip score" title="Points so far (fewest wins)">${p.score}<small> pts</small></span></span>`;
    if (html !== panel.html) {
      panel.head.innerHTML = html;
      panel.html = html;
    }
  }

  // Your hand: a fan on the tray. Picked cards stand up; cards worth nothing this round
  // (jokers, and the wild rank) are marked.
  layoutHand(p, mine) {
    const g = this.geo.hand;
    const { state } = this.game;
    const cards = p.hand;
    const n = cards.length;
    const cw = g.cw;
    const ch = cw * RATIO;
    const step = n > 1 ? Math.min(cw * 0.86, (g.x1 - g.x0 - 2 * TRAY_PAD - cw) / (n - 1)) : 0;
    const span = cw + step * Math.max(n - 1, 0);
    const trayW = this.geo.portrait ? g.x1 - g.x0 : Math.min(g.x1 - g.x0, Math.max(span, cw * 3) + 2 * TRAY_PAD);
    const cx = clamp(this.size.w / 2, g.x0 + trayW / 2, g.x1 - trayW / 2);
    setBox(this.tray, { x: cx - trayW / 2, y: g.top, w: trayW, h: g.h });
    const show = mine || OPEN.has(state.phase);
    cards.forEach((card, i) => {
      const t = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0;
      const x = cx - span / 2 + cw / 2 + i * step;
      let y = g.top + g.h / 2 + (t * t - 0.5) * 0.04 * ch;
      let rot = t * 0.7 * Math.min(n, 8);
      let z = 600 + i;
      const picked = mine && this.picked.has(card.id);
      if (picked) {
        // Less on tall screens, where the status line sits just above the hand.
        y -= ch * (this.geo.portrait ? 0.12 : 0.2);
        rot = 0;
      } else if (mine && card.id === this.hoverId) {
        y -= ch * 0.08;
      }
      if (picked) z = 650 + i;
      const obj = this.objFor(card);
      obj.zone = { zone: mine ? 'hand' : 'ohand', playerId: p.id };
      this.place(obj, x, y, cw, { rot, z, up: show });
      obj.el.classList.toggle('picked', picked);
      obj.el.classList.toggle('zero', show && !card.hidden && isZero(card, state.wild));
    });
  }

  // Opponents' hands go into their avatar, until a Show lays them out face up under their bar.
  layoutOpponentHand(p, zi) {
    const { state } = this.game;
    if (!OPEN.has(state.phase)) {
      super.layoutOpponentHand(p, zi);
      return;
    }
    const r = this.geo.panels[zi];
    const n = p.hand.length;
    const cw = clamp(r.w / (1 + 0.55 * Math.max(n - 1, 0)), 18, 44);
    const ch = cw * RATIO;
    const span = cw * (1 + 0.55 * Math.max(n - 1, 0));
    p.hand.forEach((card, i) => {
      const obj = this.objFor(card);
      obj.zone = { zone: 'shown', playerId: p.id };
      this.place(obj, r.x + (r.w - span) / 2 + cw / 2 + i * 0.55 * cw, r.y + r.h + ch / 2 + 3, cw, { z: 900 + i });
      obj.el.classList.toggle('zero', !card.hidden && isZero(card, state.wild));
    });
  }

  // On your turn, over your bar: what you've picked, and the Show button with your total.
  layoutActions(state, me) {
    const on = this.picking && !!me;
    this.actionsEl.classList.toggle('hidden', !on);
    if (!on) return;
    const bar = this.geo.panels[0];
    const h = 40;
    setBox(this.actionsEl, { x: bar.x, y: bar.y - h - 6, w: bar.w, h });
    const cards = me.hand.filter((c) => this.picked.has(c.id));
    const kind = throwKind(cards);
    const worth = cards.reduce((s, c) => s + value(c, state.wild), 0);
    const hint = !cards.length
      ? 'Tap cards to throw (one, a set, or a run of 3+ in a suit)'
      : !kind
        ? 'That’s not a throw: one card, a set of one rank, or a run of 3+ in one suit'
        : `Throwing ${worth} · now tap the deck, or a card of the last throw to take it`;
    if (this.hintEl.textContent !== hint) this.hintEl.textContent = hint;
    this.hintEl.classList.toggle('bad', !!cards.length && !kind);
    this.hintEl.classList.toggle('ready', !!kind);
    const total = handTotal(me.hand, state.wild);
    const text = `Show · ${total}`;
    if (this.showBtn.textContent !== text) this.showBtn.textContent = text;
    this.showBtn.title = `Call Show with ${total} points: if anyone has as few or fewer, you score 40`;
  }
}
