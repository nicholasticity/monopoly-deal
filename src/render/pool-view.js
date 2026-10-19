// The 8-ball table, laid out like the pool apps: a card for each side across the top
// (avatars with a ring that runs down the shot clock, and the group's seven balls,
// greyed out as they go down, then the 8), the table in the middle (lengthways on wide
// screens, upright on tall ones, the break end nearest you), the cue to pull back for
// power on its left and a wheel for fine aim on its right. Drag on the table to swing
// the aim round the cue ball, or tap to aim at a spot; with ball in hand, drag the cue
// ball itself. Shots are replayed from the engine's state.shot with the same physics,
// after the cue's stroke. Everyone else's cue shows too: an online player's as they
// aim (setRemoteAim), a bot's resting behind the cue ball while it thinks.
import { TableView, AVATARS, div, setBox, esc } from './view.js';
import { simulate, POCKETS, LENGTH, WIDTH, R, STROKE_MS } from '../pool/physics.js';
import { canPlace, targets, GROUPS, EIGHT, HEAD_SPOT, HEAD_STRING, FOOT_SPOT, teamOf, ballsLeft } from '../pool/rules.js';
import { sound } from '../ui/sound.js';

// Wood and cushion round the playing surface, in metres.
const RAIL = 0.11;
// Steps of the physics per recorded frame (the physics runs at 500 steps a second);
// the replay draws between frames, so this only needs to be fine enough for curves.
const FRAME_STEPS = 4;
// How long a potted ball takes to sink into its pocket (s).
const SINK = 0.18;
// A ball's own features (its axes): the number spots on z (both ends), and a stripe
// ball's band round y.
const SPOT = 0.88;
const BAND = 0.52;
// The light, from the top left (screen space, unit length), and the highlight halfway
// between it and the eye.
const LIGHT = norm3(-0.45, -0.55, 0.7);
const HALF = norm3(LIGHT[0], LIGHT[1], LIGHT[2] + 1);
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const RGB = {};
function norm3(x, y, z) {
  const l = Math.sqrt(x * x + y * y + z * z);
  return [x / l, y / l, z / l];
}
function rgb(hex) {
  if (!RGB[hex]) RGB[hex] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return RGB[hex];
}
// Turns orientation m (row-major; columns are the ball's axes on the table) by angle
// about the table axis (kx, ky, 0): Rodrigues' formula, then the rotation applied.
function turned(m, kx, ky, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const r = [c + t * kx * kx, t * kx * ky, s * ky, t * kx * ky, c + t * ky * ky, -s * kx, -s * ky, s * kx, c];
  const out = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] = r[i * 3] * m[j] + r[i * 3 + 1] * m[3 + j] + r[i * 3 + 2] * m[6 + j];
  return out;
}
// Squares up an orientation that has drifted (Gram–Schmidt on its columns).
function squared(m) {
  const col = (j) => [m[j], m[3 + j], m[6 + j]];
  const a = norm3(...col(0));
  let b = col(1);
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  b = norm3(b[0] - d * a[0], b[1] - d * a[1], b[2] - d * a[2]);
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]];
}
// Fine aim: radians per pixel on the wheel, and per arrow key press (Shift: 8 times).
const WHEEL = Math.PI / 3600;
const NUDGE = Math.PI / 720;
// A drag shorter than this (px) is a tap.
const TAP = 6;
const BALL_COLORS = { 1: '#f2c200', 2: '#1d4fcf', 3: '#d4231e', 4: '#5b2b8c', 5: '#f07a10', 6: '#118447', 7: '#7d1d1d', 8: '#141414' };
const colorOf = (i) => AVATARS[i % AVATARS.length];
const hypot = (x, y) => Math.sqrt(x * x + y * y);

export class PoolView extends TableView {
  constructor(container) {
    super(container);
    this.root.classList.add('pool');
    for (const { spot, label } of Object.values(this.spots)) {
      spot.classList.add('hidden');
      label.classList.add('hidden');
    }
    this.tray.classList.add('hidden');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pool-canvas hidden';
    this.panelLayer.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.cardsEl = div('pool-cards hidden', this.panelLayer);
    this.buildPower();
    this.buildWheel();
    this.hintEl = div('pool-hint hidden', this.panelLayer);
    // The shot being replayed.
    this.anim = null;
    this.played = 0;
    // The human's turn: { hand, cue, dir, pull (0–1 while the cue is drawn back),
    // power (for the keyboard), resolve }.
    this.aim = null;
    // A drag on the table: { mode: 'aim' | 'move', start, moved, fromAngle, dirAngle }.
    this.drag = null;
    // Online: the shot clock, { playerId, at (ms), total (ms) }.
    this.deadline = null;
    // Online: another player's cue as they aim, { seat, dir, pull, cue }.
    this.remote = null;
    // The cue as last drawn, { dir, cue }: a shot's stroke swings round from it.
    this.lastCue = null;
    // Each ball's orientation (turned as it rolls), where it was last drawn, and its
    // drawn picture, { canvas, key }.
    this.spins = new Map();
    this.lastAt = new Map();
    this.art = new Map();
    // Our aim as last sent to the others (online), to send only changes.
    this.sentAim = '';
    this.handlers.aim = () => {};
    this.raf = 0;
    this.tick = setInterval(() => this.deadline && !this.root.hidden && this.layoutCards(), 250);
    this.listen();
  }

  // ---------- controls ----------

  // The cue on the left: drag it down to draw back, let go to shoot.
  buildPower() {
    const el = (this.powerEl = div('pool-power hidden', this.panelLayer));
    this.powerFill = div('pp-fill', el);
    this.powerCue = div('pp-cue', el);
    this.powerText = div('pp-text', el);
    el.title = 'Pull the cue down to set the power, let go to shoot';
    let start = null;
    el.addEventListener('pointerdown', (e) => {
      if (!this.aim || this.drag) return;
      start = e.clientY;
      el.setPointerCapture(e.pointerId);
      this.setPull(0);
    });
    el.addEventListener('pointermove', (e) => {
      if (start == null || !this.aim) return;
      this.setPull((e.clientY - start) / (el.clientHeight * 0.85));
    });
    const release = (shoot) => {
      if (start == null) return;
      start = null;
      const pull = this.aim?.pull ?? 0;
      if (shoot && pull > 0.03) this.shoot(pull);
      else this.setPull(0);
    };
    el.addEventListener('pointerup', () => release(true));
    el.addEventListener('pointercancel', () => release(false));
  }

  // The wheel on the right: drag it up or down to turn the aim a fraction at a time.
  buildWheel() {
    const el = (this.wheelEl = div('pool-wheel hidden', this.panelLayer));
    el.title = 'Fine aim: drag up or down';
    let last = null;
    this.wheelTurn = 0;
    el.addEventListener('pointerdown', (e) => {
      if (!this.aim) return;
      last = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (last == null) return;
      const dy = e.clientY - last;
      last = e.clientY;
      this.turn(dy * WHEEL);
      this.wheelTurn += dy;
      el.style.setProperty('--turn', `${this.wheelTurn}px`);
    });
    const stop = () => (last = null);
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
  }

  listen() {
    const point = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return { ...this.toTable(e.clientX - r.left, e.clientY - r.top), px: e.clientX, py: e.clientY };
    };
    const angle = (p) => Math.atan2(p.y - this.aim.cue.y, p.x - this.aim.cue.x);
    this.canvas.addEventListener('pointerdown', (e) => {
      const a = this.aim;
      if (!a) return;
      const p = point(e);
      this.canvas.setPointerCapture(e.pointerId);
      // Ball in hand: grab the cue ball (a finger's width round it counts).
      const grab = Math.max(3 * R, 22 / this.geo.table.s);
      if (a.hand && hypot(p.x - a.cue.x, p.y - a.cue.y) < grab) {
        this.drag = { mode: 'move', start: p, moved: false };
        return;
      }
      const dirAngle = Math.atan2(a.dir.y, a.dir.x);
      this.drag = { mode: 'aim', start: p, moved: false, fromAngle: angle(p), dirAngle };
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const d = this.drag;
      const a = this.aim;
      if (!d || !a) return;
      const p = point(e);
      if (hypot(p.px - d.start.px, p.py - d.start.py) > TAP) d.moved = true;
      if (d.mode === 'move') {
        // The cue ball follows the finger wherever it may go.
        if (canPlace(this.game.state.balls, p.x, p.y, a.hand)) a.cue = { x: p.x, y: p.y };
        d.over = p;
        this.draw();
      } else if (d.moved) {
        // Swing the aim round the cue ball as far as the finger goes round it.
        const t = d.dirAngle + (angle(p) - d.fromAngle);
        a.dir = { x: Math.cos(t), y: Math.sin(t) };
        this.draw();
      }
    });
    const end = (e) => {
      const d = this.drag;
      const a = this.aim;
      this.drag = null;
      if (!d || !a) return;
      // A tap aims straight at that spot.
      if (d.mode === 'aim' && !d.moved) {
        const p = point(e);
        if (hypot(p.x - a.cue.x, p.y - a.cue.y) > R) a.dir = { x: p.x - a.cue.x, y: p.y - a.cue.y };
      }
      this.refresh();
      if (d.mode === 'move' && d.over && !canPlace(this.game.state.balls, d.over.x, d.over.y, a.hand)) {
        this.flashHint(a.hand === 'kitchen' ? 'The cue ball goes behind the line, clear of the other balls' : 'Clear of the other balls and the pockets');
      }
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', () => (this.drag = null));
    document.addEventListener('keydown', (e) => {
      if (!this.aim || this.root.hidden || e.target.closest?.('input, textarea') || document.querySelector('#modal-layer > .modal-backdrop:not(.hidden), body > .modal-backdrop.top')) return;
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') this.turn((k === 'ArrowLeft' ? -1 : 1) * NUDGE * (e.shiftKey ? 8 : 1));
      else if (k === 'ArrowUp' || k === 'ArrowDown') {
        this.aim.power = Math.max(0.05, Math.min(1, this.aim.power + (k === 'ArrowUp' ? 0.05 : -0.05)));
        this.flashHint(`Power ${Math.round(this.aim.power * 100)}% · Space to shoot`, false);
      } else if (k === ' ' || k === 'Enter') this.shoot(this.aim.power);
      else return;
      e.preventDefault();
    });
  }

  // ---------- other players' cues ----------

  // Online: another player's cue, as they line up.
  setRemoteAim({ seat, dx, dy, pull, cue }) {
    const state = this.game?.state;
    if (!state || state.phase !== 'aim' || state.current !== seat || seat === this.seat) return;
    this.remote = { seat, dir: { x: dx, y: dy }, pull, cue };
    if (!this.anim) this.draw();
  }

  // Whose cue to draw while nobody's shooting, and how: ours, an online player's, or
  // (a bot, or before their first move arrives) resting behind the cue ball, aimed at
  // the nearest ball they may hit. null: no cue (the cue ball isn't on the table).
  pose() {
    const { state } = this.game;
    if (this.aim) return { dir: this.aim.dir, cue: this.aim.cue, pull: this.aim.pull, mine: true };
    if (state.phase !== 'aim') return null;
    const r = this.remote;
    const cueBall = state.balls.find((b) => b.id === 0);
    if (r?.seat === state.current) return { dir: r.dir, cue: r.cue ?? cueBall, pull: r.pull, guide: true };
    if (cueBall.potted) return null;
    const shooter = state.players[state.current];
    const legal = targets(state.balls, state.groups[shooter?.team ?? 0]);
    let best = state.shots === 0 ? FOOT_SPOT : null;
    let bestD = Infinity;
    if (!best) {
      for (const b of state.balls) {
        if (b.potted || !legal.includes(b.id)) continue;
        const d = hypot(b.x - cueBall.x, b.y - cueBall.y);
        if (d < bestD) [best, bestD] = [b, d];
      }
    }
    best ??= FOOT_SPOT;
    return { dir: { x: best.x - cueBall.x, y: best.y - cueBall.y }, cue: cueBall, pull: 0 };
  }

  // A shot's stroke, before the balls move (t in seconds, from -STROKE_MS to 0): the cue
  // swings round to the shot's line, draws back as far as its power and strikes.
  strokePose(t) {
    const a = this.anim;
    const f = 1 + (t * 1000) / STROKE_MS;
    const ang = (v) => Math.atan2(v.y, v.x);
    let from = ang(a.pre.from);
    const to = ang(a.pre.to);
    // The short way round.
    while (from - to > Math.PI) from -= 2 * Math.PI;
    while (to - from > Math.PI) from += 2 * Math.PI;
    const ease = (x) => x * x * (3 - 2 * x);
    const turn = Math.min(1, f / 0.35);
    const angle = from + (to - from) * ease(turn);
    const back = a.pre.power;
    const pull = f < 0.35 ? 0 : f < 0.82 ? back * ease((f - 0.35) / 0.47) : back * (1 - (f - 0.82) / 0.18) - 0.04;
    return { dir: { x: Math.cos(angle), y: Math.sin(angle) }, cue: a.pre.cue, pull };
  }

  // ---------- the human's turn ----------

  // Called by the human controller: aim (and with ball in hand, place) until the shot.
  startAim({ hand, resolve }) {
    const { state } = this.game;
    const cueBall = state.balls.find((b) => b.id === 0);
    // After a scratch the cue ball comes back where it may go (it can be dragged).
    const cue = cueBall.potted ? this.freeSpot(hand) : { x: cueBall.x, y: cueBall.y };
    this.aim = { hand, cue, dir: null, pull: 0, power: state.shots === 0 ? 0.9 : 0.5, resolve };
    this.aimDefault();
    this.refresh();
  }

  stopAim() {
    this.aim = null;
    this.drag = null;
    this.refresh();
  }

  // The head spot, or the nearest place to it the cue ball may go.
  freeSpot(hand) {
    const balls = this.game.state.balls;
    for (let r = 0; r < 1.2; r += 0.02) {
      for (let k = 0; k < 16; k++) {
        const t = (k / 16) * 2 * Math.PI;
        const x = HEAD_SPOT.x + r * Math.cos(t);
        const y = HEAD_SPOT.y + r * Math.sin(t);
        if (canPlace(balls, x, y, hand ?? 'anywhere')) return { x, y };
      }
    }
    return { x: HEAD_STRING / 2, y: WIDTH / 2 };
  }

  // Point at the nearest ball you may hit (on the break, at the rack).
  aimDefault() {
    const a = this.aim;
    const { state } = this.game;
    const legal = targets(state.balls, state.groups[teamOf(this.seat)]);
    let best = state.shots === 0 ? FOOT_SPOT : null;
    let bestD = Infinity;
    if (!best) {
      for (const b of state.balls) {
        if (b.potted || !legal.includes(b.id)) continue;
        const d = hypot(b.x - a.cue.x, b.y - a.cue.y);
        if (d < bestD) [best, bestD] = [b, d];
      }
    }
    best ??= FOOT_SPOT;
    a.dir = { x: best.x - a.cue.x, y: best.y - a.cue.y };
  }

  // Turns the aim by `t` radians (clockwise on screen, whichever way the table is
  // turned: both are rotations of its own axes).
  turn(t) {
    const a = this.aim;
    if (!a?.dir) return;
    const c = Math.cos(t);
    const s = Math.sin(t);
    a.dir = { x: a.dir.x * c - a.dir.y * s, y: a.dir.x * s + a.dir.y * c };
    this.draw();
  }

  setPull(v) {
    if (!this.aim) return;
    this.aim.pull = Math.max(0, Math.min(1, v));
    this.layoutPower();
    this.draw();
  }

  shoot(power) {
    const a = this.aim;
    if (!a?.dir || power < 0.03) return;
    const shot = { dx: a.dir.x, dy: a.dir.y, power: Math.min(1, power), cue: a.hand ? a.cue : null };
    const resolve = a.resolve;
    this.stopAim();
    resolve(shot);
  }

  flashHint(text, warn = true) {
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle('warn', warn);
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.refresh(), 1800);
  }

  // The hint, the cue and the wheel, and a redraw.
  refresh() {
    const a = this.aim;
    this.root.classList.toggle('aiming', !!a);
    this.hintEl.classList.remove('warn');
    const short = this.root.classList.contains('small');
    const how = short ? 'Drag to aim · pull the cue down to shoot' : 'Drag on the table to aim, or tap a ball · pull the cue down to shoot';
    this.hintEl.textContent = !a ? '' : `${how}${a.hand ? (short ? ' · drag the cue ball' : ' · ball in hand: drag the cue ball') : ''}`;
    this.layoutPower();
    this.draw();
  }

  layoutPower() {
    const pull = this.aim?.pull ?? 0;
    this.powerEl.style.setProperty('--pull', pull.toFixed(3));
    this.powerText.textContent = pull > 0 ? `${Math.round(pull * 100)}%` : '';
  }

  // ---------- setup ----------

  showPiles() {}

  // A card per side: avatars (one per player: the base view's voice rings go on these),
  // names and the group's balls. Yours (or your team's) on the left.
  buildPanels(game) {
    this.cardsEl.replaceChildren();
    const players = game.state.players;
    const mine = teamOf(this.seat);
    this.sides = [mine, 1 - mine].map((team, k) => {
      const card = div(`pool-card ${k ? 'right' : 'left'}`, this.cardsEl);
      const avatars = div('pc-avatars', card);
      const text = div('pc-text', card);
      const names = div('pc-names', text);
      const balls = div('pc-balls', text);
      return { team, card, avatars, names, balls, key: '' };
    });
    this.vsEl = div('pool-vs', this.cardsEl, 'VS');
    this.panels = players.map((p, i) => {
      const side = this.sides.find((s) => s.team === p.team);
      const el = div('pc-player', side.avatars);
      el.style.setProperty('--c', colorOf(i));
      div('pc-initial', el, [...p.name.trim()][0]?.toUpperCase() ?? '?');
      div('mic', el);
      return { el, html: '' };
    });
  }

  attach(game) {
    this.remote = null;
    this.lastCue = null;
    this.spins.clear();
    this.lastAt.clear();
    // A shot already over when we arrive isn't replayed.
    this.played = game.state.phase === 'shot' ? 0 : game.state.shot?.no ?? 0;
    this.anim = null;
    this.deadline = null;
    super.attach(game);
  }

  detach() {
    this.aim = null;
    this.drag = null;
    this.anim = null;
    this.deadline = null;
    cancelAnimationFrame(this.raf);
    super.detach();
    for (const e of [this.cardsEl, this.powerEl, this.wheelEl, this.hintEl]) e.classList.add('hidden');
  }

  // ---------- geometry ----------

  // The cards across the top, then the table as big as fits with the cue on its left
  // and the wheel on its right, and a line of hints under it.
  fit() {
    const { w, h } = this.size;
    const ins = this.inset;
    const portrait = ins.portrait;
    const n = this.game?.state.players.length ?? 2;
    const small = w < 700 || h < 540;
    const pad = small ? 8 : 14;
    const gap = small ? 6 : 12;
    const W = w - 2 * pad;
    const cardH = small ? 58 : 66;
    const vsW = small ? 30 : 56;
    const cardW = Math.min((W - vsW - 2 * gap) / 2, 400);
    const top = ins.top + 6;
    const cardsX = pad + (W - (2 * cardW + vsW + 2 * gap)) / 2;
    const cards = { x: cardsX, y: top, w: 2 * cardW + vsW + 2 * gap, h: cardH, cardW, vsW, gap };
    const side = small ? 34 : 46;
    const hintH = small ? 18 : 22;
    const areaTop = top + cardH + gap;
    // Tall screens keep the status row clear at the bottom (ins.bottom).
    const areaBottom = h - (portrait ? Math.max(ins.bottom, 8) : pad) - hintH;
    const areaH = Math.max(120, areaBottom - areaTop);
    const areaW = W - 2 * (side + gap);
    const across = portrait ? WIDTH + 2 * RAIL : LENGTH + 2 * RAIL;
    const down = portrait ? LENGTH + 2 * RAIL : WIDTH + 2 * RAIL;
    const s = Math.min(areaW / across, areaH / down);
    const tw = across * s;
    const th = down * s;
    const table = { x: pad + (W - tw) / 2, y: areaTop + (areaH - th) / 2, w: tw, h: th, s };
    const barH = th * 0.82;
    const power = { x: table.x - gap - side, y: table.y + (th - barH) / 2, w: side, h: barH };
    const wheel = { x: table.x + tw + gap, y: table.y + (th - barH) / 2, w: side, h: barH };
    const hint = { x: pad, y: table.y + th + 2, w: W, h: hintH };
    // No hand tray: the status row (tall screens) sits at the very bottom.
    const hand = { x0: pad, x1: w - pad, top: h, h: 0, cw: 0, visible: 0 };
    const mid = { x: w / 2, y: h / 2, w: 0 };
    this.geo = { portrait, head: cardH, side: 0, lead: cardH, inner: 8, panels: [], cards, table, power, wheel, hint, hand, dock: h - hint.y, deck: mid, discard: mid };
    this.layoutKey = `pool:${portrait ? 'tall' : 'wide'}:${n}`;
    this.root.classList.toggle('small', small);
    this.root.classList.remove('bars');
  }

  // Table metres to canvas pixels, and back (canvas pixels from its top left).
  toScreen(x, y) {
    const { s, h } = this.geo.table;
    return this.geo.portrait ? { x: (RAIL + y) * s, y: h - (RAIL + x) * s } : { x: (RAIL + x) * s, y: (RAIL + y) * s };
  }

  toTable(px, py) {
    const { s, h } = this.geo.table;
    return this.geo.portrait ? { x: (h - py) / s - RAIL, y: px / s - RAIL } : { x: px / s - RAIL, y: py / s - RAIL };
  }

  // ---------- layout ----------

  sync(game, ms) {
    this.layout();
    return new Promise((r) => setTimeout(r, ms * this.pace));
  }

  layout() {
    const game = this.game;
    if (!this.canvas) return;
    for (const e of [this.canvas, this.cardsEl, this.powerEl, this.wheelEl, this.hintEl]) e.classList.toggle('hidden', !game);
    if (!game) return;
    const { state } = game;
    const { table, cards, power, wheel, hint } = this.geo;
    setBox(this.canvas, table);
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(table.w * dpr);
    const ch = Math.round(table.h * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    setBox(this.cardsEl, cards);
    setBox(this.powerEl, power);
    setBox(this.wheelEl, wheel);
    setBox(this.hintEl, hint);
    this.cardsEl.style.setProperty('--card-w', `${cards.cardW}px`);
    this.cardsEl.style.setProperty('--vs-w', `${cards.vsW}px`);
    this.layoutCards();
    // A new shot: replay it.
    if (state.shot && state.shot.no !== this.played) {
      this.played = state.shot.no;
      const { from, dx, dy, power: pw } = state.shot;
      const r = simulate(from, dx, dy, pw, { record: FRAME_STEPS });
      const cue = from.find((b) => b.id === 0);
      const pre = { from: this.lastCue?.dir ?? { x: dx, y: dy }, to: { x: dx, y: dy }, cue: { x: cue.x, y: cue.y }, power: pw };
      // Each potted ball: when it dropped, where it was last seen, and its pocket.
      const sinks = new Map();
      r.events.pocketed.forEach((pk, k) => {
        const t = r.events.drops[k].t;
        let i = Math.min(r.frames.length - 1, Math.floor(t / r.frameDt));
        while (i > 0 && Number.isNaN(r.frames[i][2 * pk.id])) i--;
        sinks.set(pk.id, { t, x: r.frames[i][2 * pk.id], y: r.frames[i][2 * pk.id + 1], pocket: POCKETS[pk.pocket] });
      });
      this.anim = { frames: r.frames, dt: r.frameDt, start: performance.now() + STROKE_MS, pre, from, sinks, hits: r.events.hits, drops: r.events.drops, heard: 0, dropped: 0, lastClack: -1 };
      this.remote = null;
      if (this.aim) this.stopAim();
    }
    // Someone else's turn now: their cue starts from rest.
    if (this.remote && (state.phase !== 'aim' || state.current !== this.remote.seat)) this.remote = null;
    const me = state.players[this.seat];
    this.root.classList.toggle('my-turn', !!me?.isHuman && state.phase === 'aim' && state.current === this.seat);
    this.loop();
  }

  loop() {
    cancelAnimationFrame(this.raf);
    this.draw();
    // The cards' balls follow the replay (a ball greys out as it drops).
    if (this.anim) {
      this.layoutCards();
      this.raf = requestAnimationFrame(() => this.loop());
    }
  }

  // The balls on show: mid-replay, or where they are.
  shown() {
    const { state } = this.game;
    const a = this.anim;
    if (!a) return state.balls;
    const t = (performance.now() - a.start) / 1000;
    if (t < 0) return a.from;
    const i = Math.min(a.frames.length - 1, Math.floor(t / a.dt));
    while (a.heard < a.hits.length && a.hits[a.heard].t <= t) {
      const hit = a.hits[a.heard++];
      if (hit.speed > 0.15 && t - a.lastClack > 0.04) {
        sound.play('clack');
        a.lastClack = t;
      }
    }
    while (a.dropped < a.drops.length && a.drops[a.dropped].t <= t) {
      a.dropped++;
      sound.play('pocket');
    }
    const last = a.frames.length - 1;
    // The replay runs on after the last frame for the last ball to finish sinking.
    const sunk = [...a.sinks.values()].every((k) => t >= k.t + SINK);
    if (i >= last && sunk) this.anim = null;
    // Where each ball is between two frames.
    const f = Math.min(1, t / a.dt - i);
    const row = a.frames[i];
    const next = a.frames[Math.min(last, i + 1)];
    return state.balls.map((b) => {
      const x = row[2 * b.id];
      if (Number.isNaN(x) || x == null) {
        // Just dropped: sinking into the pocket, smaller and fainter.
        const k = a.sinks.get(b.id);
        const u = k ? (t - k.t) / SINK : 1;
        if (u < 1) return { id: b.id, x: k.x + (k.pocket.x - k.x) * u, y: k.y + (k.pocket.y - k.y) * u, potted: false, sink: Math.max(0, u) };
        return { ...b, potted: true };
      }
      const x1 = next[2 * b.id];
      if (Number.isNaN(x1)) return { id: b.id, x, y: row[2 * b.id + 1], potted: false };
      return { id: b.id, x: x + (x1 - x) * f, y: row[2 * b.id + 1] + (next[2 * b.id + 1] - row[2 * b.id + 1]) * f, potted: false };
    });
  }

  // Turns each ball as far as it rolled since it was last drawn: rolling a distance d
  // along u turns it by d / R about the axis across u. Not when it jumped (placed, or
  // put back on the spot).
  turnBalls(balls) {
    for (const b of balls) {
      if (b.potted || b.sink) continue;
      const was = this.lastAt.get(b.id);
      this.lastAt.set(b.id, { x: b.x, y: b.y });
      if (!was) continue;
      const dx = b.x - was.x;
      const dy = b.y - was.y;
      const d = hypot(dx, dy);
      if (d < 1e-7 || d > 0.3) continue;
      const prev = this.spins.get(b.id) ?? IDENTITY;
      const m = turned(prev, -dy / d, dx / d, d / R);
      const n = (prev.n ?? 0) + 1;
      const kept = n % 64 ? m : squared(m);
      kept.n = n;
      this.spins.set(b.id, kept);
    }
  }

  // Both cards: who's at the table, whose shot it is (with the clock), and the balls.
  layoutCards() {
    if (!this.game || !this.sides) return;
    const { state } = this.game;
    const balls = this.anim ? this.shown() : state.balls;
    const live = state.phase !== 'over';
    const clock = this.deadline && live ? this.deadline : null;
    const left = clock ? Math.max(0, clock.at - Date.now()) / clock.total : 1;
    state.players.forEach((p, i) => {
      const el = this.panels[i]?.el;
      if (!el) return;
      const on = live && state.current === i;
      el.classList.toggle('on', on);
      el.classList.toggle('winner', state.phase === 'over' && state.winners.includes(p));
      el.classList.toggle('timed', on && !!clock && clock.playerId === i);
      el.style.setProperty('--left', left.toFixed(3));
      el.classList.toggle('low', on && !!clock && left < 0.25);
    });
    for (const s of this.sides) {
      const members = state.players.filter((p) => p.team === s.team);
      const group = state.groups[s.team];
      const turn = live && state.players[state.current]?.team === s.team;
      s.card.classList.toggle('on', turn);
      s.card.classList.toggle('winner', state.phase === 'over' && state.winners.some((p) => p.team === s.team));
      const names = members.map((p) => {
        const you = p.id === this.seat && p.isHuman && p.name.trim().toLowerCase() !== 'you' ? ' (you)' : '';
        const tag = p.tag ? `${p.tag} ` : '';
        return `<span class="${live && state.current === p.id ? 'now' : ''}">${tag}${esc(p.name)}${you}</span>`;
      }).join('<i>&amp;</i>');
      // Seven slots: the group's balls (dim once potted) or, while the table's open,
      // blanks. Then the 8, lit when it's theirs to shoot.
      const down = (id) => balls.find((b) => b.id === id)?.potted;
      const slots = group ? GROUPS[group].map((id) => ball(id, down(id))) : Array.from({ length: 7 }, () => '<i class="pc-ball blank"></i>');
      const onEight = !!group && ballsLeft(balls, group) === 0;
      slots.push(ball(EIGHT, !onEight && !down(EIGHT), 'eight'));
      const key = `${names}|${slots.join('')}|${group}`;
      if (key !== s.key) {
        s.key = key;
        s.names.innerHTML = names;
        s.balls.innerHTML = slots.join('');
        s.card.dataset.group = group ?? 'open';
      }
    }
    this.vsEl.textContent = state.groups[0] ? 'VS' : 'OPEN';
  }

  // ---------- drawing ----------

  draw() {
    if (!this.game || !this.geo?.table) return;
    const ctx = this.ctx;
    const { s, w, h } = this.geo.table;
    const dpr = this.canvas.width / w;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.drawTable(ctx, s, w, h);
    const a = this.aim;
    const stroke = this.anim && performance.now() < this.anim.start;
    // Whose cue, and where: a shot's stroke, our aim, or the shooter's.
    const pose = stroke ? this.strokePose((performance.now() - this.anim.start) / 1000) : this.anim ? null : this.pose();
    // With ball in hand the cue ball is wherever it's been dragged (by us, or online by
    // whoever's shot it is).
    const balls = this.shown().map((b) => (b.id === 0 && pose?.cue && !stroke ? { ...b, x: pose.cue.x, y: pose.cue.y, potted: false } : b));
    const up = balls.filter((b) => !b.potted);
    this.turnBalls(up);
    for (const b of up) if (!b.sink) this.drawShadow(ctx, b, s);
    if (pose?.dir && (pose.mine || pose.guide)) this.drawGuide(ctx, s, balls, pose, !pose.mine);
    for (const b of up) this.drawBall(ctx, b, s);
    if (a?.hand) this.drawHand(ctx, a.cue, s);
    if (pose?.dir) this.drawCue(ctx, s, pose);
    // Online: our aim, for the others to watch (only when it changes).
    if (a?.dir) {
      const aim = { dx: +a.dir.x.toFixed(5), dy: +a.dir.y.toFixed(5), pull: +a.pull.toFixed(3), cue: a.hand ? { x: +a.cue.x.toFixed(5), y: +a.cue.y.toFixed(5) } : null };
      const key = JSON.stringify(aim);
      if (key !== this.sentAim) {
        this.sentAim = key;
        this.handlers.aim(aim);
      }
    }
  }

  drawTable(ctx, s, w, h) {
    // Wood, polished.
    const wood = ctx.createLinearGradient(0, 0, w, h);
    wood.addColorStop(0, '#7a4322');
    wood.addColorStop(0.5, '#5a2f15');
    wood.addColorStop(1, '#3f200c');
    ctx.fillStyle = wood;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, RAIL * s * 0.75);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 220, 170, 0.25)';
    ctx.lineWidth = Math.max(1, s * 0.006);
    ctx.beginPath();
    ctx.roundRect(s * 0.012, s * 0.012, w - s * 0.024, h - s * 0.024, RAIL * s * 0.65);
    ctx.stroke();
    // The cushions, then the cloth.
    const box = (x0, y0, x1, y1) => {
      const p = this.toScreen(x0, y0);
      const q = this.toScreen(x1, y1);
      return [Math.min(p.x, q.x), Math.min(p.y, q.y), Math.abs(q.x - p.x), Math.abs(q.y - p.y)];
    };
    const c = RAIL * 0.42;
    ctx.fillStyle = '#0d4f8b';
    ctx.fillRect(...box(-c, -c, LENGTH + c, WIDTH + c));
    const [fx, fy, fw, fh] = box(0, 0, LENGTH, WIDTH);
    const felt = ctx.createRadialGradient(fx + fw / 2, fy + fh / 2, 0, fx + fw / 2, fy + fh / 2, Math.max(fw, fh) * 0.62);
    felt.addColorStop(0, '#3a9be0');
    felt.addColorStop(0.6, '#2479c4');
    felt.addColorStop(1, '#155a9c');
    ctx.fillStyle = felt;
    ctx.fillRect(fx, fy, fw, fh);
    // The cushions' lit edge.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fh - 1);
    // Diamonds on the rails.
    ctx.fillStyle = '#f2e6c8';
    const d = s * 0.011;
    const diamond = (x, y) => {
      const p = this.toScreen(x, y);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - d);
      ctx.lineTo(p.x + d, p.y);
      ctx.lineTo(p.x, p.y + d);
      ctx.lineTo(p.x - d, p.y);
      ctx.fill();
    };
    for (let k = 1; k < 8; k++) if (k !== 4) for (const y of [-RAIL * 0.72, WIDTH + RAIL * 0.72]) diamond((LENGTH * k) / 8, y);
    for (let k = 1; k < 4; k++) for (const x of [-RAIL * 0.72, LENGTH + RAIL * 0.72]) diamond(x, (WIDTH * k) / 4);
    // The head string, faintly, while the cue ball goes behind it.
    if (this.aim?.hand === 'kitchen') {
      const [kx, ky, kw, kh] = box(0, 0, HEAD_STRING, WIDTH);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.fillRect(kx, ky, kw, kh);
      const p = this.toScreen(HEAD_STRING, 0);
      const q = this.toScreen(HEAD_STRING, WIDTH);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Pockets: chrome rims round the holes.
    for (const p of POCKETS) {
      const q = this.toScreen(p.x, p.y);
      const r = p.r * s;
      const rim = ctx.createRadialGradient(q.x - r * 0.3, q.y - r * 0.3, r * 0.2, q.x, q.y, r * 1.3);
      rim.addColorStop(0, '#f4f4f4');
      rim.addColorStop(0.6, '#9a9a9a');
      rim.addColorStop(1, '#4a4a4a');
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r * 1.28, 0, Math.PI * 2);
      ctx.fill();
      const hole = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, r);
      hole.addColorStop(0, '#000');
      hole.addColorStop(0.75, '#050505');
      hole.addColorStop(1, '#2a2a2a');
      ctx.fillStyle = hole;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawShadow(ctx, b, s) {
    const p = this.toScreen(b.x, b.y);
    const r = R * s;
    ctx.fillStyle = 'rgba(0, 20, 50, 0.35)';
    ctx.beginPath();
    ctx.ellipse(p.x + r * 0.28, p.y + r * 0.38, r * 1.02, r * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // A ball, as a lit sphere turned however it has rolled (its number spots and stripe
  // turn with it), and its number on whichever spot faces up. Sinking: smaller, fainter.
  drawBall(ctx, b, s) {
    const p = this.toScreen(b.x, b.y);
    const r = R * s * (1 - 0.45 * (b.sink ?? 0));
    const dpr = this.canvas.width / this.geo.table.w;
    const size = Math.max(4, Math.ceil(2 * r * dpr));
    const m = this.spins.get(b.id) ?? IDENTITY;
    ctx.save();
    ctx.globalAlpha = 1 - 0.75 * (b.sink ?? 0);
    ctx.drawImage(this.paintBall(b.id, size, m), p.x - r, p.y - r, 2 * r, 2 * r);
    if (b.id && r > 5) {
      // The spot facing up (z > 0 of the two), seen from above.
      const sign = m[8] >= 0 ? 1 : -1;
      const up = sign * m[8];
      if (up > 0.3) {
        const o = this.toScreenDir(sign * m[2], sign * m[5]);
        ctx.globalAlpha *= Math.min(1, (up - 0.3) / 0.3);
        ctx.fillStyle = '#111';
        ctx.font = `800 ${Math.max(5, r * 0.6 * Math.sqrt(up))}px "Segoe UI", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(b.id), p.x + o.x * r, p.y + o.y * r + r * 0.04);
      }
    }
    ctx.restore();
  }

  // A table direction (x, y) on screen.
  toScreenDir(x, y) {
    return this.geo.portrait ? { x: y, y: -x } : { x, y };
  }

  // A ball's picture, `size` pixels across, turned by m: every pixel of the disc is a
  // point on the sphere, coloured by where it is on the ball (spot, stripe or not) and
  // lit. Cached until the ball turns.
  paintBall(id, size, m) {
    let art = this.art.get(id);
    if (!art) {
      const canvas = document.createElement('canvas');
      art = { canvas, ctx: canvas.getContext('2d'), key: '' };
      this.art.set(id, art);
    }
    const portrait = this.geo.portrait;
    const key = `${size}|${portrait}|${m.map((v) => v.toFixed(3)).join(',')}`;
    if (art.key === key) return art.canvas;
    art.key = key;
    if (art.canvas.width !== size) art.canvas.width = art.canvas.height = size;
    const img = art.ctx.createImageData(size, size);
    const px = img.data;
    const stripe = id >= 9;
    const white = rgb('#f7f3e8');
    const color = id === 0 ? white : rgb(BALL_COLORS[stripe ? id - 8 : id]);
    const half = size / 2;
    for (let j = 0; j < size; j++) {
      const Y = (j + 0.5 - half) / half;
      for (let i = 0; i < size; i++) {
        const X = (i + 0.5 - half) / half;
        const d2 = X * X + Y * Y;
        if (d2 >= 1) continue;
        const Z = Math.sqrt(1 - d2);
        // The point on the table's axes, then on the ball's own.
        const tx = portrait ? -Y : X;
        const ty = portrait ? X : Y;
        const qy = m[1] * tx + m[4] * ty + m[7] * Z;
        const qz = m[2] * tx + m[5] * ty + m[8] * Z;
        const spot = qz > SPOT || qz < -SPOT;
        const base = id === 0 || spot ? white : stripe ? (qy < BAND && qy > -BAND ? color : white) : color;
        const diffuse = Math.max(0, X * LIGHT[0] + Y * LIGHT[1] + Z * LIGHT[2]);
        const h = Math.max(0, X * HALF[0] + Y * HALF[1] + Z * HALF[2]);
        const spec = h ** 48 * 0.8 + h ** 8 * 0.12;
        const shade = 0.42 + 0.7 * diffuse;
        const k = (j * size + i) * 4;
        px[k] = Math.min(255, base[0] * shade + 255 * spec);
        px[k + 1] = Math.min(255, base[1] * shade + 255 * spec);
        px[k + 2] = Math.min(255, base[2] * shade + 255 * spec);
        // A soft edge, a pixel wide.
        px[k + 3] = Math.min(255, (1 - Math.sqrt(d2)) * half * 255);
      }
    }
    art.ctx.putImageData(img, 0, 0);
    return art.canvas;
  }

  // Ball in hand: a hand on the cue ball, to show it can be moved.
  drawHand(ctx, cue, s) {
    const p = this.toScreen(cue.x, cue.y);
    const r = R * s;
    const ok = !this.drag?.over || canPlace(this.game.state.balls, this.drag.over.x, this.drag.over.y, this.aim.hand);
    ctx.strokeStyle = ok ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 90, 90, 0.95)';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `${Math.max(12, r * 1.3)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✋', p.x + r * 1.5, p.y - r * 1.5);
  }

  // Where the cue ball first meets a ball (the ghost ball: centres 2R apart) or a
  // cushion, along u from `from`.
  contact(balls, from, u) {
    let t = Infinity;
    let hit = null;
    for (const b of balls) {
      if (b.potted || b.id === 0) continue;
      const fx = b.x - from.x;
      const fy = b.y - from.y;
      const along = fx * u.x + fy * u.y;
      if (along <= 0) continue;
      const off2 = fx * fx + fy * fy - along * along;
      if (off2 > 4 * R * R) continue;
      const d = along - Math.sqrt(4 * R * R - off2);
      if (d < t) [t, hit] = [d, b];
    }
    const wall = (p, v, lo, hi) => (v > 0 ? (hi - p) / v : v < 0 ? (lo - p) / v : Infinity);
    const tw = Math.min(wall(from.x, u.x, R, LENGTH - R), wall(from.y, u.y, R, WIDTH - R));
    if (tw < t) [t, hit] = [tw, null];
    return { t, hit, at: { x: from.x + u.x * t, y: from.y + u.y * t } };
  }

  // The guide, as in the apps: the cue ball's path to a ghost ball, then the object
  // ball's path and the cue ball's, longer for the one that takes more of the hit.
  // Red where the first ball isn't one you may hit.
  // faint: someone else's (online), drawn lighter.
  drawGuide(ctx, s, balls, pose, faint = false) {
    const from = pose.cue;
    const l = hypot(pose.dir.x, pose.dir.y);
    const u = { x: pose.dir.x / l, y: pose.dir.y / l };
    const { hit, at } = this.contact(balls, from, u);
    const { state } = this.game;
    const team = faint ? state.players[state.current]?.team ?? 0 : teamOf(this.seat);
    const legal = targets(state.balls, state.groups[team]);
    const bad = hit && !legal.includes(hit.id);
    const white = 'rgba(255, 255, 255, 0.9)';
    ctx.globalAlpha = faint ? 0.5 : 1;
    const red = 'rgba(255, 90, 90, 0.95)';
    const line = (p0, p1, color, width = 1.6) => {
      const a0 = this.toScreen(p0.x, p0.y);
      const a1 = this.toScreen(p1.x, p1.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      ctx.lineTo(a1.x, a1.y);
      ctx.stroke();
    };
    ctx.save();
    ctx.lineCap = 'round';
    line({ x: from.x + u.x * R, y: from.y + u.y * R }, at, white);
    // The ghost ball.
    const g = this.toScreen(at.x, at.y);
    ctx.strokeStyle = bad ? red : white;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(g.x, g.y, R * s, 0, Math.PI * 2);
    ctx.stroke();
    if (hit) {
      const n = { x: (hit.x - at.x) / (2 * R), y: (hit.y - at.y) / (2 * R) };
      const full = Math.max(0, u.x * n.x + u.y * n.y);
      const reach = 0.5;
      line(hit, { x: hit.x + n.x * reach * full, y: hit.y + n.y * reach * full }, bad ? red : white, 2);
      // The cue ball goes off at right angles to the object ball's line.
      let tx = -n.y;
      let ty = n.x;
      if (tx * u.x + ty * u.y < 0) [tx, ty] = [-tx, -ty];
      const glance = Math.sqrt(Math.max(0, 1 - full * full));
      line(at, { x: at.x + tx * reach * glance, y: at.y + ty * reach * glance }, 'rgba(255, 255, 255, 0.55)', 1.4);
      if (bad) {
        const q = this.toScreen(hit.x, hit.y);
        const k = R * s * 0.7;
        ctx.strokeStyle = red;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(q.x - k, q.y - k);
        ctx.lineTo(q.x + k, q.y + k);
        ctx.moveTo(q.x + k, q.y - k);
        ctx.lineTo(q.x - k, q.y + k);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // A cue behind the cue ball (pose: { dir, cue, pull }), drawn back by pull: ours as the
  // power cue is pulled, someone else's as they aim or strike.
  drawCue(ctx, s, pose) {
    this.lastCue = { dir: pose.dir, cue: pose.cue };
    const a = pose;
    const l = hypot(a.dir.x, a.dir.y);
    const u = { x: a.dir.x / l, y: a.dir.y / l };
    const back = R * 1.5 + a.pull * 0.32;
    const tip = { x: a.cue.x - u.x * back, y: a.cue.y - u.y * back };
    const butt = { x: tip.x - u.x * 1.45, y: tip.y - u.y * 1.45 };
    const p0 = this.toScreen(tip.x, tip.y);
    const p1 = this.toScreen(butt.x, butt.y);
    const g = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
    g.addColorStop(0, '#dfe8f2');
    g.addColorStop(0.012, '#2f6fb8');
    g.addColorStop(0.03, '#f4ead7');
    g.addColorStop(0.05, '#e8c98f');
    g.addColorStop(0.62, '#c08a4b');
    g.addColorStop(0.64, '#1b1b1b');
    g.addColorStop(0.7, '#c9a227');
    g.addColorStop(0.72, '#1b1b1b');
    g.addColorStop(1, '#0d0d0d');
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = Math.max(4, R * s * 0.62);
    ctx.beginPath();
    ctx.moveTo(p0.x + 3, p0.y + 4);
    ctx.lineTo(p1.x + 3, p1.y + 4);
    ctx.stroke();
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(3, R * s * 0.5);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.restore();
  }
}

// A little ball for the cards: its colour (striped for 9–15) and number; `out` dims it.
function ball(id, out, cls = '') {
  const base = id >= 9 ? id - 8 : id;
  return `<i class="pc-ball${id >= 9 ? ' st' : ''}${out ? ' out' : ''}${cls ? ` ${cls}` : ''}" style="--b: var(--ball${base})">${id}</i>`;
}
