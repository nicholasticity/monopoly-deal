// 2D presentation of the game, built from plain DOM elements. Every layout() works
// out where each card belongs from the game state; CSS transitions glide it there.
import { cardImageURL, loadCardImage, isFlipped } from './textures.js';
import * as R from '../game/rules.js';

// Card elements are this size (px) and scaled to wherever they sit.
const W0 = 200;
const H0 = 280;
const RATIO = H0 / W0;
// How much of each covered pile card shows (of its height). Panels make room for
// piles STACK cards tall, up to STACK_MAX when there's height to spare; taller piles
// squeeze up.
const CASCADE = 0.21;
const stackHeight = (cards) => 1 + CASCADE * (cards - 1);
const STACK = 3;
const STACK_MAX = 4;
// When piles must overlap, at least this much of each shows (of a card's width).
const PILE_SHOW = 0.42;
// The bank's widest, in card widths (less in narrow panels). Its money fans out
// BANK_STEP of a card per card, so a small bank leaves the piles more room.
const bankWidth = (panelW) => (panelW < 280 ? 1.25 : 1.55);
const BANK_STEP = 0.3;
// Panels have room for this many piles side by side before they overlap.
const ROOM_FOR = 4;
// Widest a table card gets (px): on small screens, and otherwise.
const TABLE_MAX = [96, 124];
// The hand tray: padding round the cards, and the gap below it (px).
const TRAY_PAD = 8;
const TRAY_GAP = 10;
// Side bars (tall screens) shorter than this (px) squeeze up: one line for the name.
const SHORT_BAR = 100;
// How long a card takes to glide to a new spot (must match .card in style.css).
const MOVE_MS = 450;
const AVATARS = ['#f5b83d', '#4fb3ff', '#ff6b8b', '#5fd68a', '#b48cff'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r1 = (v) => Math.round(v * 10) / 10;

function div(cls, parent, text) {
  const e = document.createElement('div');
  e.className = cls;
  if (text != null) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

function face(cls, parent) {
  const img = document.createElement('img');
  img.className = `face ${cls}`;
  img.alt = '';
  img.draggable = false;
  parent.appendChild(img);
  return img;
}

// Positions an absolutely placed element; skips the style writes when nothing moved.
const boxes = new WeakMap();
function setBox(el, { x, y, w, h }) {
  const key = `${r1(x)},${r1(y)},${r1(w)},${r1(h)}`;
  if (boxes.get(el) === key) return;
  boxes.set(el, key);
  Object.assign(el.style, { left: `${r1(x)}px`, top: `${r1(y)}px`, width: `${r1(w)}px`, height: `${r1(h)}px` });
}

// Every card in a game state, wherever it is.
function* stateCards(state) {
  yield* state.deck;
  yield* state.discard;
  yield* state.showcase;
  for (const p of state.players) {
    yield* p.hand;
    yield* p.bank;
    for (const pile of p.piles) {
      yield* pile.cards;
      if (pile.house) yield pile.house;
      if (pile.hotel) yield pile.hotel;
    }
  }
}

// One card on the table: a two-faced element that flips when it turns over.
class CardEl {
  constructor(card, layer, backURL) {
    this.card = card;
    this.el = div('card down', layer);
    const flip = div('flip', this.el);
    this.front = face('front', flip);
    face('back', flip).src = backURL;
    this.key = null;
    this.zone = null;
    this.prevZone = null;
    this.tf = '';
    this.pos = null;
    this.z = 0;
    this.live = false;
    this.flying = 0;
  }
}

export class TableView {
  constructor(container) {
    this.container = container;
    this.root = div('board', container);
    this.panelLayer = div('panel-layer', this.root);
    this.cardLayer = div('card-layer', this.root);
    this.dim = div('show-dim', this.cardLayer);
    this.tray = div('hand-tray', this.panelLayer);
    this.spots = {};
    for (const kind of ['deck', 'discard']) this.spots[kind] = { spot: div('spot', this.panelLayer), label: div('spot-label', this.panelLayer) };
    this.backURL = cardImageURL(null);

    this.cards = new Map();
    this.byEl = new WeakMap();
    this.seen = new Set();
    this.rings = new Map();
    this.panels = [];
    this.seat = 0;
    this.game = null;
    this.pace = 1;
    this.hoverId = null;
    this.layoutKey = null;
    this.snapping = false;
    this.handlers = { hover: () => {}, click: () => {}, moves: () => {} };
    // Screen space (CSS px) the HUD covers; main.js hooks this up to the HUD.
    this.insets = () => ({ top: 0, bottom: 0, right: 320, portrait: false });

    const cardAt = (e) => this.byEl.get(e.target.closest?.('.card'));
    this.root.addEventListener('pointerover', (e) => e.pointerType !== 'touch' && this.setHover(cardAt(e), e));
    this.root.addEventListener('pointerleave', (e) => e.pointerType !== 'touch' && this.setHover(null, e));
    // Touch has no hover: a tap shows the card (preview, raised hand card) until the
    // next tap somewhere else.
    document.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && this.setHover(cardAt(e), e), true);
    this.root.addEventListener('click', (e) => {
      const obj = cardAt(e);
      if (obj?.zone) this.handlers.click(obj.card, obj.zone, e.clientX, e.clientY);
    });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  on(event, fn) {
    this.handlers[event] = fn;
  }

  // ---------- setup per game ----------

  // The local player (isHuman) sits at the bottom; the others follow in turn order.
  attach(game) {
    this.game = game;
    this.hoverId = null;
    for (const obj of this.cards.values()) obj.el.remove();
    this.cards.clear();
    for (const ring of this.rings.values()) ring.remove();
    this.rings.clear();
    this.seat = Math.max(0, game.state.players.findIndex((p) => p.isHuman));
    this.buildPanels(game);
    this.size = null;
    this.resize();
  }

  // A panel per player: a header (avatar, name, money, sets, cards in hand) over the
  // bank on the left and the property piles on the right. On tall screens the header is
  // a bar down the panel's left side instead.
  buildPanels(game) {
    for (const p of this.panels) p.el.remove();
    this.panels = game.state.players.map((p, i) => {
      const el = div('seat-panel', this.panelLayer);
      el.style.setProperty('--c', AVATARS[i % AVATARS.length]);
      const head = div('seat-head', el);
      const bank = div('area', el, 'Bank');
      const props = div('area', el, 'Properties');
      return { el, head, bank, props, html: '' };
    });
  }

  objFor(card) {
    let obj = this.cards.get(card.id);
    if (!obj) {
      obj = new CardEl(card, this.cardLayer, this.backURL);
      this.byEl.set(obj.el, obj);
      // Cards that appear mid-game (an online deck reshuffle) rise from the discard pile.
      const d = this.geo.discard;
      obj.el.style.transform = `translate(${r1(d.x - W0 / 2)}px, ${r1(d.y - H0 / 2)}px) scale(${(d.w / W0).toFixed(4)})`;
      this.cards.set(card.id, obj);
    }
    obj.card = card;
    this.seen.add(card.id);
    return obj;
  }

  // Shows a card's face once it is face up (hidden cards online have none yet).
  showFace(obj) {
    const key = obj.card.hidden ? null : obj.card.key;
    if (key === obj.key) return;
    obj.key = key;
    if (!key) {
      obj.front.removeAttribute('src');
      return;
    }
    loadCardImage(obj.card).then((url) => {
      if (obj.key === key) obj.front.src = url;
    });
  }

  // Table zone for player i: zone 0 is the bottom (local) seat.
  zoneIndex(i) {
    const n = this.game.state.players.length;
    return (i - this.seat + n) % n;
  }

  // ---------- geometry ----------

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    // A new window size snaps everything into place; HUD changes (the status line
    // growing) only nudge cards, which keep gliding.
    const snap = w !== this.size?.w || h !== this.size?.h;
    this.size = { w, h };
    this.inset = this.insets();
    this.fit();
    // The HUD keeps the status row and menus clear of the hand.
    document.documentElement.style.setProperty('--hand-h', `${Math.round(this.geo.hand.visible)}px`);
    if (snap) this.snap(() => this.layout());
    else this.layout();
  }

  // Runs a layout with transitions off, so cards jump straight to their spots.
  snap(fn) {
    this.snapping = true;
    this.root.classList.add('snap');
    fn();
    void this.root.offsetWidth;
    this.root.classList.remove('snap');
    this.snapping = false;
  }

  // Works out where everything goes on this screen: opponents' panels across the top
  // (one per row on tall screens), the local player's panel above the hand
  // tray, and the deck and discard beside the hand (wide) or beside that panel (tall).
  fit() {
    const { w, h } = this.size;
    const ins = this.inset;
    const portrait = ins.portrait;
    const n = this.game?.state.players.length ?? 4;
    const k = Math.max(1, n - 1);
    const small = w < 700 || h < 540;
    const pad = small ? 8 : 14;
    const gap = small ? 8 : 12;
    const inner = small ? 6 : 10;
    // On tall screens each panel's name and counts go in a bar down its left side,
    // which leaves the cards more height; otherwise they head the panel.
    const side = portrait ? (small ? 58 : 72) : 0;
    const head = side ? 0 : small ? 26 : 34;
    // Room above the cards in a panel.
    const lead = head || inner;

    const hw = portrait ? Math.min((0.18 * h) / RATIO, w * 0.21, 118) : Math.min(((h < 500 ? 0.18 : 0.17) * h) / RATIO, w * 0.085, 124);
    const trayH = hw * RATIO * 1.08 + 2 * TRAY_PAD;
    const trayTop = h - TRAY_GAP - trayH;
    const hand = { x0: pad, x1: w - pad, top: trayTop, h: trayH, cw: hw, visible: trayH + TRAY_GAP };

    // Opponents sit side by side on wide screens, and one per row on tall ones.
    const top = ins.top + 4;
    const bottom = portrait ? trayTop - ins.bottom : trayTop - gap;
    const W = w - 2 * pad;
    const cols = portrait ? 1 : k;
    const rows = Math.ceil(k / cols);
    const colW = (W - (cols - 1) * gap) / cols;
    const dw = portrait ? clamp(w * 0.11, 34, 56) : hw * 0.78;
    // On tall screens the deck and discard sit side by side at the right of your panel.
    const myW = portrait ? W - 2 * dw - 2 * gap : W;

    // Card heights: what's left after the headers, shared out evenly between the
    // tables, within limits. Cards are never taller than ROOM_FOR piles across their
    // panel allow; when that holds some panels back, the others get the height.
    const fitsAcross = (pw) => ((pw - side - 3 * inner) / (bankWidth(pw - side) + 1 + PILE_SHOW * (ROOM_FOR - 1))) * RATIO;
    const avail = Math.max(80, bottom - top - rows * gap - (rows + 1) * (lead + inner));
    const max = TABLE_MAX[small ? 0 : 1] * RATIO;
    const s = stackHeight(STACK);
    let och = Math.min(max, fitsAcross(colW), avail / ((rows + 1) * s));
    const mch = Math.min(max, fitsAcross(myW), avail / s - rows * och);
    och = Math.min(max, fitsAcross(colW), (avail / s - mch) / rows);
    // Height to spare lets taller piles spread out.
    const spare = Math.max(0, avail - (rows * och + mch) * s) / (rows + 1);
    const area = (ch) => Math.min(ch * stackHeight(STACK_MAX), ch * s + spare);

    // Every opponent's panel is the same size.
    const oppH = lead + inner + area(och);
    const meH = lead + inner + area(mch);
    const panels = [{ x: pad, y: bottom - meH, w: myW, h: meH, card: mch / RATIO, area: area(mch) }];
    for (let i = 0; i < k; i++) {
      panels.push({ x: pad + (i % cols) * (colW + gap), y: top + Math.floor(i / cols) * (oppH + gap), w: colW, h: oppH, card: och / RATIO, area: area(och) });
    }

    let deck, discard;
    if (portrait) {
      const pw = Math.min(dw, (meH - 2 * inner) / RATIO);
      const y = panels[0].y + meH / 2;
      deck = { x: pad + myW + gap + dw / 2, y, w: pw };
      discard = { x: w - pad - dw / 2, y, w: pw };
    } else {
      const y = trayTop + (trayH - 18) / 2;
      deck = { x: pad + dw / 2, y, w: dw };
      // Far enough apart for their labels.
      discard = { x: deck.x + Math.max(dw + 12, 76), y, w: dw };
      hand.x0 = discard.x + dw / 2 + gap * 2;
      hand.x1 = w - pad - ins.right;
    }
    const show = { y: (top + bottom) / 2, w: Math.min((0.3 * h) / RATIO, w * 0.42, 210) };
    this.geo = { portrait, head, side, lead, inner, panels, deck, discard, hand, show };
    this.layoutKey = `${portrait ? 'tall' : 'wide'}:${n}:${cols}`;
    this.root.style.setProperty('--head', `${head}px`);
    this.root.style.setProperty('--inner', `${inner}px`);
    this.root.style.setProperty('--side', `${side}px`);
    this.root.classList.toggle('small', small);
    this.root.classList.toggle('bars', side > 0);
  }

  // ---------- layout ----------

  sync(game, ms) {
    this.layout();
    return sleep(ms * this.pace);
  }

  layout() {
    const game = this.game;
    if (!game) return;
    const { state } = game;
    this.seen.clear();
    // New cards start at the discard pile; make the browser see them there first.
    let fresh = false;
    for (const card of stateCards(state)) {
      if (!this.cards.has(card.id)) fresh = true;
      this.objFor(card);
    }
    if (fresh && !this.snapping) void this.cardLayer.offsetWidth;
    this.ringsSeen = new Set();

    this.layoutDeck(state);
    state.players.forEach((p, i) => {
      const zi = this.zoneIndex(i);
      const m = this.layoutPanel(p, i, zi);
      // A spectator has no hand of their own: the bottom seat's cards lie face down.
      if (zi === 0) this.layoutHand(p, p.isHuman);
      else this.layoutOpponentHand(p, zi);
      this.layoutBank(p, m);
      this.layoutPiles(p, m);
    });
    this.layoutShowcase(state.showcase);
    const me = state.players[this.seat];
    this.root.classList.toggle('my-turn', !!me?.isHuman && state.current === this.seat && state.phase !== 'over');

    // Online, a reshuffle swaps the discard pile for freshly numbered deck cards.
    for (const [id, obj] of this.cards) {
      if (this.seen.has(id)) continue;
      obj.el.remove();
      this.cards.delete(id);
      if (this.hoverId === id) this.hoverId = null;
    }
    for (const [key, ring] of this.rings) {
      if (this.ringsSeen.has(key)) continue;
      this.rings.delete(key);
      ring.classList.add('out');
      setTimeout(() => ring.remove(), 300);
    }
    // A card that went face down or out of sight can't stay highlighted.
    const hovered = this.cards.get(this.hoverId);
    if (this.hoverId != null && !hovered?.live) {
      hovered?.el.classList.remove('hover');
      this.hoverId = null;
      this.handlers.hover(null, null);
    }
    this.reportMoves();
  }

  // Sends a card gliding to (x, y), its centre, at width w.
  place(obj, x, y, w, { rot = 0, z = 0, up = true, gone = false } = {}) {
    const el = obj.el;
    const zone = obj.zone?.zone;
    obj.live = up && !obj.card.hidden && zone !== 'deck' && zone !== 'ohand';
    if (up) this.showFace(obj);
    el.classList.toggle('down', !up);
    el.classList.toggle('gone', gone);
    el.classList.toggle('live', obj.live);
    const tf = `translate(${r1(x - W0 / 2)}px, ${r1(y - H0 / 2)}px) rotate(${r1(rot)}deg) scale(${(w / W0).toFixed(4)})`;
    const far = !this.snapping && obj.pos && Math.hypot(x - obj.pos.x, y - obj.pos.y) > 40;
    obj.pos = { x, y, w };
    obj.z = z;
    if (tf !== obj.tf) {
      obj.tf = tf;
      el.style.transform = tf;
    }
    if (far) {
      // Cards on the move pass over everything else until they land.
      clearTimeout(obj.flying);
      el.classList.add('flying');
      obj.flying = setTimeout(() => {
        obj.flying = 0;
        el.classList.remove('flying');
        el.style.zIndex = obj.z;
      }, MOVE_MS + 60);
    }
    el.style.zIndex = obj.flying ? 2000 + z : z;
  }

  layoutDeck(state) {
    const { deck, discard } = this.geo;
    state.deck.forEach((card, i) => {
      const obj = this.objFor(card);
      obj.zone = { zone: 'deck' };
      // The bottom cards step up a little, so the deck has some thickness.
      const lift = Math.min(i, 24) * 0.22;
      this.place(obj, deck.x - lift * 0.4, deck.y - lift, deck.w, { up: false, z: 10 + i });
    });
    state.discard.forEach((card, i) => {
      const obj = this.objFor(card);
      obj.zone = { zone: 'discard' };
      const jitter = 0.1 * discard.w;
      const x = discard.x + (hash(card.id + 7) - 0.5) * jitter;
      const y = discard.y + (hash(card.id + 3) - 0.5) * jitter;
      this.place(obj, x, y, discard.w, { rot: (hash(card.id) - 0.5) * 24, z: 200 + i });
    });
    // Labels go under the piles beside the hand; on tall screens a count sits on each.
    for (const [kind, spot, count] of [['deck', deck, state.deck.length], ['discard', discard, state.discard.length]]) {
      const { spot: el, label } = this.spots[kind];
      const ch = spot.w * RATIO;
      setBox(el, { x: spot.x - spot.w / 2, y: spot.y - ch / 2, w: spot.w, h: ch });
      label.title = kind === 'deck' ? 'Deck' : 'Discard pile';
      if (this.geo.portrait) {
        label.textContent = `${count}`;
        label.style.left = `${r1(spot.x)}px`;
        label.style.top = `${r1(spot.y + ch / 2 - 2)}px`;
        label.style.transform = 'translate(-50%, -100%)';
      } else {
        label.textContent = `${kind === 'deck' ? 'Deck' : 'Discard'} · ${count}`;
        label.style.left = `${r1(spot.x)}px`;
        label.style.top = `${r1(spot.y + ch / 2 + 4)}px`;
        label.style.transform = 'translateX(-50%)';
      }
    }
  }

  // Places a player's panel and fills in its header. Returns where the panel's cards
  // go: their width (smaller when there are many piles), the bank and the piles.
  layoutPanel(p, i, zi) {
    const g = this.geo;
    const r = g.panels[zi];
    const panel = this.panels[i];
    const { state } = this.game;
    setBox(panel.el, r);
    const mine = zi === 0;
    panel.el.classList.toggle('me', mine);
    panel.el.classList.toggle('active', state.current === i && state.phase !== 'over');
    panel.el.classList.toggle('winner', state.winner === p);
    panel.el.classList.toggle('compact', r.w < 280);
    panel.el.classList.toggle('short', g.side > 0 && r.h < SHORT_BAR);

    const sets = Math.min(R.completeColors(p).size, R.SETS_TO_WIN);
    const pips = Array.from({ length: R.SETS_TO_WIN }, (_, j) => `<i class="${j < sets ? 'on' : ''}"></i>`).join('');
    const you = mine && p.isHuman && p.name.trim().toLowerCase() !== 'you' ? '<span class="you">You</span>' : '';
    const hand = mine && p.isHuman ? '' : `<span class="chip" title="Cards in hand"><i class="mini-card"></i>${p.hand.length}</span>`;
    const tag = p.tag ? `<span class="tag">${p.tag}</span>` : '';
    const initial = [...p.name.trim()][0]?.toUpperCase() ?? '?';
    const html = `<span class="avatar">${esc(initial)}</span><span class="seat-name">${tag}${esc(p.name)}</span><span class="mic"></span>${you}<span class="chips"><span class="chip money" title="Bank">$${R.bankTotal(p)}M</span><span class="chip sets" title="Complete sets">${pips}</span>${hand}</span>`;
    if (html !== panel.html) {
      panel.head.innerHTML = html;
      panel.html = html;
    }

    const n = p.piles.length;
    const inside = r.w - g.side;
    const bw = Math.min(bankWidth(inside), 1 + BANK_STEP * Math.max(p.bank.length - 1, 0));
    const cw = Math.min(r.card, (inside - 3 * g.inner) / (bw + 1 + PILE_SHOW * Math.max(n - 1, 0)));
    const m = { cw, ch: cw * RATIO, x0: r.x + g.side + g.inner, top: r.y + g.lead, areaH: r.area, bankW: cw * bw };
    m.propsX0 = m.x0 + m.bankW + g.inner;
    m.propsX1 = r.x + r.w - g.inner;
    // Dashed outlines mark an empty bank or property area.
    setBox(panel.bank, { x: g.side + g.inner, y: g.lead, w: m.bankW, h: m.ch });
    setBox(panel.props, { x: m.propsX0 - r.x, y: g.lead, w: m.propsX1 - m.propsX0, h: m.ch });
    panel.bank.classList.toggle('empty', p.bank.length === 0);
    panel.props.classList.toggle('empty', n === 0);
    return m;
  }

  // Cards in the local hand sit in a fan on a tray along the bottom.
  layoutHand(p, mine) {
    const g = this.geo.hand;
    const cards = p.hand;
    const n = cards.length;
    const cw = g.cw;
    const ch = cw * RATIO;
    const step = n > 1 ? Math.min(cw * 0.86, (g.x1 - g.x0 - 2 * TRAY_PAD - cw) / (n - 1)) : 0;
    const span = cw + step * Math.max(n - 1, 0);
    // The tray hugs the fan (on tall screens it always spans the width).
    const trayW = this.geo.portrait ? g.x1 - g.x0 : Math.min(g.x1 - g.x0, Math.max(span, cw * 3) + 2 * TRAY_PAD);
    const cx = clamp(this.size.w / 2, g.x0 + trayW / 2, g.x1 - trayW / 2);
    setBox(this.tray, { x: cx - trayW / 2, y: g.top, w: trayW, h: g.h });
    cards.forEach((card, i) => {
      const t = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0;
      const x = cx - span / 2 + cw / 2 + i * step;
      let y = g.top + TRAY_PAD + ch / 2 + t * t * 0.04 * ch;
      let size = cw;
      let rot = t * 0.7 * Math.min(n, 8);
      let z = 600 + i;
      if (mine && card.id === this.hoverId) {
        y -= ch * (this.geo.portrait ? 0.24 : 0.3);
        size *= 1.15;
        rot = 0;
        z = 700;
      }
      const obj = this.objFor(card);
      obj.zone = { zone: mine ? 'hand' : 'ohand', playerId: p.id };
      this.place(obj, x, y, size, { rot, z, up: mine });
    });
  }

  // Opponents' hands aren't shown: their cards fly into (and out of) the avatar.
  layoutOpponentHand(p, zi) {
    const { panels, inner, head, side } = this.geo;
    const r = panels[zi];
    // The avatar heads the side bar (placed by .board.bars in style.css) or starts the header.
    const short = r.h < SHORT_BAR;
    const size = side ? (short ? 15 : 18) : head * 0.62;
    const x = side ? r.x + side / 2 : r.x + inner + 2 + size / 2;
    const y = side ? r.y + (short ? 13 : 18) : r.y + head / 2;
    p.hand.forEach((card, i) => {
      const obj = this.objFor(card);
      obj.zone = { zone: 'ohand', playerId: p.id };
      this.place(obj, x, y, size, { up: false, gone: true, z: 650 + i });
    });
  }

  layoutBank(p, m) {
    const cards = p.bank.slice().sort((a, b) => b.value - a.value || a.id - b.id);
    const n = cards.length;
    const step = n > 1 ? Math.min(m.cw * BANK_STEP, (m.bankW - m.cw) / (n - 1)) : 0;
    cards.forEach((card, i) => {
      const obj = this.objFor(card);
      obj.zone = { zone: 'bank', playerId: p.id };
      this.place(obj, m.x0 + m.cw / 2 + i * step, m.top + m.ch / 2, m.cw, { z: 400 + i });
    });
  }

  layoutPiles(p, m) {
    const n = p.piles.length;
    const step = n > 1 ? Math.min(m.cw * 1.08, (m.propsX1 - m.propsX0 - m.cw) / (n - 1)) : 0;
    p.piles.forEach((pile, j) => {
      const x = m.propsX0 + m.cw / 2 + j * step;
      const items = [...pile.cards, pile.house, pile.hotel].filter(Boolean);
      const casc = items.length > 1 ? Math.min(CASCADE * m.ch, (m.areaH - m.ch) / (items.length - 1)) : 0;
      const complete = R.isComplete(pile);
      if (complete) this.ring(`${p.id}:${pile.id}`, { x: x - m.cw / 2, y: m.top, w: m.cw, h: m.ch + casc * (items.length - 1) }, 399 + j * 10);
      items.forEach((card, k) => {
        const obj = this.objFor(card);
        obj.zone = { zone: 'pile', playerId: p.id, pileId: pile.id, complete };
        const rot = card.type === 'action' ? -7 : isFlipped(card) ? 180 : 0;
        this.place(obj, x, m.top + m.ch / 2 + k * casc, m.cw, { rot, z: 400 + j * 10 + k });
      });
    });
  }

  // A gold ring round every complete set; it fades out when the set breaks.
  ring(key, r, z) {
    let el = this.rings.get(key);
    if (!el) {
      el = div('set-ring', this.cardLayer);
      this.rings.set(key, el);
    }
    this.ringsSeen.add(key);
    setBox(el, { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 });
    el.style.zIndex = z;
  }

  // Cards being played are held up in the middle of the table, over a dimmed board.
  layoutShowcase(cards) {
    const n = cards.length;
    const { w } = this.size;
    const { show } = this.geo;
    const size = Math.min(show.w, (0.9 * w) / (1 + 0.8 * (n - 1)));
    cards.forEach((card, i) => {
      const off = i - (n - 1) / 2;
      const obj = this.objFor(card);
      obj.zone = { zone: 'showcase' };
      this.place(obj, w / 2 + off * size * 0.8, show.y, size, { rot: off * -3.4, z: 900 + i });
    });
    this.dim.classList.toggle('on', n > 0);
  }

  // Tells the 'moves' handler which cards changed zone since the last layout, and
  // how many sets were completed by them (for sound effects).
  reportMoves() {
    const moves = [];
    let completed = 0;
    for (const obj of this.cards.values()) {
      const from = obj.prevZone;
      const to = obj.zone;
      obj.prevZone = to;
      if (!from || (from.zone === to.zone && from.playerId === to.playerId && from.pileId === to.pileId)) continue;
      moves.push({ card: obj.card, from, to });
      if (to.complete && obj.card.type !== 'action' && !(from.zone === 'pile' && from.complete)) completed++;
    }
    if (moves.length) this.handlers.moves(moves, completed);
  }

  // ---------- input ----------

  setHover(obj, e) {
    const visible = obj?.live ? obj : null;
    const id = visible ? visible.card.id : null;
    if (id === this.hoverId) return;
    const prev = this.cards.get(this.hoverId);
    this.hoverId = id;
    prev?.el.classList.remove('hover');
    visible?.el.classList.add('hover');
    if (prev?.zone?.zone === 'hand' || visible?.zone?.zone === 'hand') this.layout();
    // The preview goes where it won't cover the card: the other side, or on tall
    // screens the other half.
    const { w, h } = this.size;
    const side = this.inset.portrait ? (e.clientY < h / 2 ? 'low' : 'high') : e.clientX > w * 0.625 ? 'left' : 'right';
    this.handlers.hover(visible?.card ?? null, visible?.zone ?? null, side);
  }

  // Voice chat for each player, by seat: '' (not in it), 'on', 'muted' or 'talking'.
  setVoice(states) {
    this.panels.forEach((panel, i) => {
      const s = states[i] || '';
      panel.el.classList.toggle('voice', !!s);
      panel.el.classList.toggle('mic-off', s === 'muted');
      panel.el.classList.toggle('talking', s === 'talking');
    });
  }

  // Screen-space centre of a card (CSS pixels); used for debugging and tests.
  screenPosition(cardId) {
    const obj = this.cards.get(cardId);
    if (!obj?.pos) return null;
    const rect = this.container.getBoundingClientRect();
    return { x: rect.left + obj.pos.x, y: rect.top + obj.pos.y };
  }
}
