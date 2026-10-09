// The Judgement table, built on the Monopoly Deal one: a header bar per player
// (score, tricks won of the bid), the trick in the middle with each card in front
// of whoever played it, and the local hand along the bottom.
import { TableView, RATIO, TRAY_PAD, TRAY_GAP, AVATARS, div, setBox, offsetIn, clamp, r1, esc } from './view.js';
import { cardImageURL, PLAYING_BACK } from './textures.js';
import { SUITS, SUIT_ORDER } from '../judgement/cards.js';
import { legalCards, trickWinner, bidState } from '../judgement/rules.js';

// Phases where someone is deciding something.
const DECIDING = new Set(['trump', 'bid', 'play']);
// Widest an opponent's header bar gets on wide screens (px).
const BAR_MAX = 300;
// A hand fans out in one row while each card shows at least this much of its width;
// past that it takes two rows, the back one showing this much of each card's height.
const ONE_ROW = 0.3;
const ROW_SHOW = 0.42;
// Width (px) of a won card where it goes into its winner's tricks count.
const WON_W = 16;

function* stateCards(state) {
  yield* state.deck;
  for (const t of state.trick) yield t.card;
  for (const p of state.players) {
    yield* p.hand;
    yield* p.tricks;
  }
}

export class JudgementView extends TableView {
  constructor(container) {
    super(container);
    this.root.classList.add('judgement');
    this.backURL = cardImageURL(PLAYING_BACK);
    for (const { spot, label } of Object.values(this.spots)) {
      spot.classList.add('hidden');
      label.classList.add('hidden');
    }
    this.trumpEl = div('trump-mark hidden', this.panelLayer);
    this.tags = [];
  }

  // No deck and discard counts in the HUD.
  showPiles() {}

  // Header-only panels; every player also gets a name tag for their card in the trick.
  buildPanels(game) {
    for (const p of this.panels) p.el.remove();
    for (const t of this.tags) t.remove();
    this.panels = game.state.players.map((p, i) => {
      const el = div('seat-panel', this.panelLayer);
      el.style.setProperty('--c', AVATARS[i % AVATARS.length]);
      return { el, head: div('seat-head', el), html: '', wonKey: '', wonAt: null };
    });
    this.tags = game.state.players.map((p, i) => {
      const tag = div('trick-tag hidden', this.cardLayer, p.name);
      tag.style.setProperty('--c', AVATARS[i % AVATARS.length]);
      return tag;
    });
  }

  detach() {
    for (const t of this.tags) t.remove();
    this.tags = [];
    this.trumpEl.classList.add('hidden');
    super.detach();
  }

  // Only cards in the local hand respond to the pointer.
  place(obj, x, y, w, opts) {
    super.place(obj, x, y, w, opts);
    if (obj.live && obj.zone?.zone !== 'hand') {
      obj.live = false;
      obj.el.classList.remove('live');
    }
  }

  // ---------- geometry ----------

  // Opponents' bars across the top (two to a row on tall screens), the local bar
  // above the hand, and the trick in between.
  fit() {
    const { w, h } = this.size;
    const ins = this.inset;
    const portrait = ins.portrait;
    const state = this.game?.state;
    const n = state?.players.length ?? 4;
    const k = Math.max(1, n - 1);
    const small = w < 700 || h < 540;
    const pad = small ? 8 : 14;
    const gap = small ? 8 : 12;
    const inner = small ? 6 : 10;
    const head = small ? 30 : 36;

    // The tray is sized for a full hand, so it stays put as the hand shrinks.
    const size = state?.handSize ?? 13;
    const hw = portrait ? Math.min((0.17 * h) / RATIO, w * 0.21, 112) : Math.min((0.17 * h) / RATIO, w * 0.085, 124);
    const ch = hw * RATIO;
    const x0 = pad;
    const x1 = w - pad - (portrait ? 0 : ins.right);
    const rows = this.handRows(size, x1 - x0, hw);
    const trayH = ch * (rows === 2 ? 1 + ROW_SHOW : 1.06) + 2 * TRAY_PAD;
    const trayTop = h - TRAY_GAP - trayH;
    const hand = { x0, x1, top: trayTop, h: trayH, cw: hw, visible: trayH + TRAY_GAP };

    const W = w - 2 * pad;
    const meBottom = portrait ? trayTop - ins.bottom : trayTop - gap;
    const meW = portrait ? W : Math.min(W, 560);
    const panels = [{ x: (w - meW) / 2, y: meBottom - head, w: meW, h: head }];
    const cols = portrait ? Math.min(k, 2) : k;
    const colW = Math.min((W - (cols - 1) * gap) / cols, portrait ? Infinity : BAR_MAX);
    const top = ins.top + 6;
    for (let i = 0; i < k; i++) {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, k - row * cols);
      const rowX = (w - (inRow * colW + (inRow - 1) * gap)) / 2;
      panels.push({ x: rowX + (i % cols) * (colW + gap), y: top + row * (head + gap), w: colW, h: head });
    }
    const oppBottom = top + Math.ceil(k / cols) * (head + gap) - gap;

    // The trick: cards on an ellipse round the middle, the local player's at the bottom
    // and the rest clockwise in turn order.
    const tagH = small ? 16 : 18;
    const areaTop = oppBottom + gap;
    const areaH = Math.max(80, panels[0].y - gap - areaTop);
    const areaW = W;
    const tw = Math.max(30, Math.min(hw * 1.05, (areaH - tagH) / (RATIO * 2.1), areaW / 4.2));
    const tch = tw * RATIO;
    const trick = {
      x: w / 2,
      y: areaTop + (areaH - tagH) / 2,
      w: tw,
      rx: Math.min((areaW - tw) / 2, tw * 1.3),
      ry: Math.max(0, Math.min((areaH - tch - tagH) / 2, tch * 0.6)),
    };
    const deck = { x: trick.x, y: trick.y, w: tw * 0.9 };
    // Prompts dock above your panel, so your bid and tricks stay in view.
    const dock = h - panels[0].y;
    this.geo = { portrait, head, side: 0, lead: head, inner, panels, deck, discard: deck, hand, trick, dock };
    this.layoutKey = `judgement:${portrait ? 'tall' : 'wide'}:${n}:${rows}`;
    this.root.style.setProperty('--head', `${head}px`);
    this.root.style.setProperty('--inner', `${inner}px`);
    this.root.style.setProperty('--side', '0px');
    this.root.classList.toggle('small', small);
    this.root.classList.remove('bars');
  }

  handRows(cards, width, cw) {
    return cards > 8 && (width - 2 * TRAY_PAD - cw) / (cards - 1) < ONE_ROW * cw ? 2 : 1;
  }

  // ---------- layout ----------

  layout() {
    const game = this.game;
    if (!game) return;
    const { state } = game;
    this.seen.clear();
    // New cards start at the deck; make the browser see them there first.
    let fresh = false;
    for (const card of stateCards(state)) {
      if (!this.cards.has(card.id)) fresh = true;
      this.objFor(card);
    }
    if (fresh && !this.snapping) void this.cardLayer.offsetWidth;
    this.ringsSeen = new Set();

    const deciding = DECIDING.has(state.phase);
    this.layoutDeck(state);
    state.players.forEach((p, i) => {
      const zi = this.zoneIndex(i);
      const won = this.layoutPanel(p, i, zi, deciding);
      if (zi === 0) this.layoutHand(p, p.isHuman);
      else this.layoutOpponentHand(p, zi);
      // Taken tricks go into the count in their winner's header.
      p.tricks.forEach((card, j) => {
        const obj = this.objFor(card);
        obj.zone = { zone: 'won', playerId: p.id };
        this.place(obj, won.x, won.y, WON_W, { gone: true, z: 300 + j });
      });
    });
    this.layoutTrick(state);
    this.layoutTrump(state);
    const me = state.players[this.seat];
    this.root.classList.toggle('my-turn', !!me?.isHuman && state.current === this.seat && deciding);
    this.finishLayout();
  }

  // The deck sits in the middle while cards are dealt; the cards set aside stay there out of sight.
  layoutDeck(state) {
    const { deck } = this.geo;
    const shown = state.phase === 'deal' || state.phase === 'setup';
    state.deck.forEach((card, i) => {
      const obj = this.objFor(card);
      obj.zone = { zone: 'deck' };
      const lift = Math.min(i, 24) * 0.22;
      this.place(obj, deck.x - lift * 0.4, deck.y - lift, deck.w, { up: false, gone: !shown, z: 10 + i });
    });
  }

  // Places a player's header bar and fills it in. Returns the centre of the tricks
  // count, where won cards go.
  layoutPanel(p, i, zi, deciding) {
    const r = this.geo.panels[zi];
    const panel = this.panels[i];
    const { state } = this.game;
    setBox(panel.el, r);
    const mine = zi === 0;
    panel.el.classList.toggle('me', mine);
    panel.el.classList.toggle('active', state.current === i && deciding);
    panel.el.classList.toggle('winner', state.phase === 'over' && state.winners.includes(p));
    panel.el.classList.toggle('den', state.den === i);
    panel.el.classList.toggle('compact', r.w < 240);

    const you = mine && p.isHuman && p.name.trim().toLowerCase() !== 'you' ? '<span class="you">You</span>' : '';
    const tag = p.tag ? `<span class="tag">${p.tag}</span>` : '';
    const initial = [...p.name.trim()][0]?.toUpperCase() ?? '?';
    const tricks = p.bid == null ? (p.won ? `${p.won}` : '–') : `${p.won}/${p.bid}`;
    const made = p.bid == null ? '' : bidState(p.bid, p.won);
    const den = state.den === i ? '<span class="den-pill" title="The den calls trumps and leads first">Den</span>' : '';
    const html = `<span class="avatar">${esc(initial)}</span><span class="seat-name">${tag}${esc(p.name)}</span><span class="mic"></span>${you}${den}<span class="chips"><span class="chip score" title="Score">${p.score < 0 ? `−${-p.score}` : p.score}<small> pts</small></span><span class="chip tricks ${made}" title="Tricks won / bid"><i class="mini-card"></i>${tricks}</span></span>`;
    if (html !== panel.html) {
      panel.head.innerHTML = html;
      panel.html = html;
    }
    const wonKey = `${html}|${r.w}|${r.h}`;
    if (panel.wonKey !== wonKey) {
      panel.wonKey = wonKey;
      const chip = panel.head.querySelector('.tricks');
      const at = offsetIn(chip, panel.el);
      panel.wonAt = { x: at.x + chip.offsetWidth / 2, y: at.y + chip.offsetHeight / 2 };
    }
    return { x: r.x + panel.wonAt.x, y: r.y + panel.wonAt.y };
  }

  // The local hand: a fan on the tray, in two rows when it's long. While you're
  // choosing a card, the ones you can't play are dimmed.
  layoutHand(p, mine) {
    const g = this.geo.hand;
    const { state } = this.game;
    const cards = p.hand;
    const n = cards.length;
    const cw = g.cw;
    const ch = cw * RATIO;
    const rows = this.handRows(n, g.x1 - g.x0, cw);
    const perRow = Math.ceil(n / rows);
    const step = perRow > 1 ? Math.min(cw * 0.86, (g.x1 - g.x0 - 2 * TRAY_PAD - cw) / (perRow - 1)) : 0;
    const span = cw + step * Math.max(perRow - 1, 0);
    const trayW = this.geo.portrait ? g.x1 - g.x0 : Math.min(g.x1 - g.x0, Math.max(span, cw * 3) + 2 * TRAY_PAD);
    const cx = clamp(this.size.w / 2, g.x0 + trayW / 2, g.x1 - trayW / 2);
    setBox(this.tray, { x: cx - trayW / 2, y: g.top, w: trayW, h: g.h });
    const choosing = mine && state.phase === 'play' && state.current === p.id;
    const legal = new Set(choosing ? legalCards(cards, state.trick).map((c) => c.id) : []);
    cards.forEach((card, idx) => {
      const row = idx < perRow ? 0 : 1;
      const i = idx - row * perRow;
      const m = row ? n - perRow : Math.min(n, perRow);
      const x = cx - (cw + step * (m - 1)) / 2 + cw / 2 + i * step;
      const t = m > 1 ? (i - (m - 1) / 2) / ((m - 1) / 2) : 0;
      let y;
      let rot = 0;
      if (rows === 2) y = row ? g.top + g.h - TRAY_PAD - ch / 2 : g.top + TRAY_PAD + ch / 2;
      else {
        y = g.top + g.h / 2 + (t * t - 0.5) * 0.04 * ch;
        rot = t * 0.7 * Math.min(m, 8);
      }
      let size = cw;
      let z = 600 + row * 40 + i;
      if (mine && card.id === this.hoverId) {
        y -= ch * (this.geo.portrait ? 0.24 : 0.3);
        size *= 1.15;
        rot = 0;
        z = 700;
      }
      const obj = this.objFor(card);
      obj.zone = { zone: mine ? 'hand' : 'ohand', playerId: p.id };
      this.place(obj, x, y, size, { rot, z, up: mine });
      obj.el.classList.toggle('dim', choosing && !legal.has(card.id));
    });
  }

  // Each card in the trick lies in front of whoever played it, with their name under
  // it; a gold ring marks the card that's winning.
  layoutTrick(state) {
    const { trick } = this.geo;
    const n = state.players.length;
    const ch = trick.w * RATIO;
    const best = state.trick.length ? trickWinner(state.trick, state.trump) : null;
    const tagged = new Set();
    state.trick.forEach((entry, k) => {
      const a = Math.PI / 2 + (this.zoneIndex(entry.playerId) * 2 * Math.PI) / n;
      const x = trick.x + trick.rx * Math.cos(a);
      const y = trick.y + trick.ry * Math.sin(a);
      const obj = this.objFor(entry.card);
      obj.zone = { zone: 'trick', playerId: entry.playerId };
      this.place(obj, x, y, trick.w, { z: 800 + k * 2 });
      const tag = this.tags[entry.playerId];
      tagged.add(tag);
      tag.style.left = `${r1(x)}px`;
      tag.style.top = `${r1(y + ch / 2 + 3)}px`;
      tag.style.zIndex = 801 + k * 2;
      if (entry === best) this.ring('trick', { x: x - trick.w / 2, y: y - ch / 2, w: trick.w, h: ch }, 790);
    });
    for (const tag of this.tags) tag.classList.toggle('hidden', !tagged.has(tag));
  }

  // A large faint trump suit behind the trick.
  layoutTrump(state) {
    const suit = state.trump && SUITS[state.trump];
    this.trumpEl.classList.toggle('hidden', !suit);
    if (!suit) return;
    const { trick } = this.geo;
    const size = Math.min(2 * trick.ry + trick.w * RATIO, 2 * trick.rx + trick.w) * 0.6;
    const text = `${suit.symbol}\uFE0E`;
    if (this.trumpEl.textContent !== text) this.trumpEl.textContent = text;
    for (const key of SUIT_ORDER) this.trumpEl.classList.toggle(key, key === state.trump);
    this.trumpEl.style.fontSize = `${r1(size)}px`;
    setBox(this.trumpEl, { x: trick.x - size / 2, y: trick.y - size / 2, w: size, h: size });
  }
}
