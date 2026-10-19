// The 8-ball table, built on the Monopoly Deal view for the player bars: the table
// drawn on a canvas (lengthways on wide screens, upright on tall ones, the break end
// nearest you), shots replayed from the engine's state.shot with the same physics, and
// the aiming: drag on the table to point the cue, fine-tune with the arrows, set the
// power and shoot. With ball in hand, tap where the cue ball goes first.
import { TableView, AVATARS, div, setBox, r1, esc } from './view.js';
import { simulate, POCKETS, LENGTH, WIDTH, R } from '../pool/physics.js';
import { canPlace, targets, ballsLeft, HEAD_STRING, FOOT_SPOT, teamOf } from '../pool/rules.js';
import { sound } from '../ui/sound.js';

const BAR_MAX = 300;
// Wood and cushion round the playing surface, in metres.
const RAIL = 0.1;
// Steps of the physics per animation frame (the physics runs at 500 steps a second).
const FRAME_STEPS = 8;
// One fine-aim click, in radians (a quarter of a degree; Shift: two degrees).
const NUDGE = Math.PI / 720;
const BALL_COLORS = { 1: '#f2c200', 2: '#1d4fcf', 3: '#d4231e', 4: '#5b2b8c', 5: '#f07a10', 6: '#118447', 7: '#7d1d1d', 8: '#141414' };
const colorOf = (i) => AVATARS[i % AVATARS.length];

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
    this.controls = div('pool-controls hidden', this.panelLayer);
    this.buildControls();
    // The shot being replayed: { frames, dt, start, hits, drops, heard }.
    this.anim = null;
    this.played = 0;
    // The human's turn: { hand, cue (placed), placing, dir, power, resolve }.
    this.aim = null;
    this.hover = null;
    this.raf = 0;
    const point = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return this.toTable(e.clientX - r.left, e.clientY - r.top);
    };
    let dragging = false;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.aim) return;
      const p = point(e);
      if (this.aim.placing) {
        this.place(p);
        return;
      }
      dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.pointAt(p);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.aim) return;
      const p = point(e);
      if (this.aim.placing && e.pointerType !== 'touch') {
        this.hover = p;
        this.draw();
      } else if (dragging) this.pointAt(p);
    });
    const stop = () => (dragging = false);
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.draw();
    });
    document.addEventListener('keydown', (e) => {
      if (!this.aim || this.root.hidden || e.target.closest?.('input, textarea') || document.querySelector('#modal-layer > .modal-backdrop:not(.hidden), body > .modal-backdrop.top')) return;
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') this.nudge((k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 8 : 1));
      else if (k === 'ArrowUp' || k === 'ArrowDown') this.setPower(this.aim.power + (k === 'ArrowUp' ? 0.05 : -0.05));
      else if (k === ' ' || k === 'Enter') this.shoot();
      else return;
      e.preventDefault();
    });
  }

  buildControls() {
    const c = this.controls;
    this.hintEl = div('pool-hint', c);
    const row = div('pool-row', c);
    const btn = (cls, text, title, fn) => {
      const b = document.createElement('button');
      b.className = cls;
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', fn);
      row.appendChild(b);
      return b;
    };
    this.moveBtn = btn('ghost pool-move', '✋ Move', 'Move the cue ball', () => {
      if (!this.aim?.hand) return;
      this.aim.placing = true;
      this.refresh();
    });
    btn('ghost pool-nudge', '◀', 'Aim a little left (←)', () => this.nudge(-1));
    btn('ghost pool-nudge', '▶', 'Aim a little right (→)', () => this.nudge(1));
    const power = div('pool-power', row);
    power.appendChild(document.createElement('span')).textContent = 'Power';
    this.powerEl = document.createElement('input');
    this.powerEl.type = 'range';
    this.powerEl.min = '3';
    this.powerEl.max = '100';
    this.powerEl.addEventListener('input', () => this.setPower(Number(this.powerEl.value) / 100));
    power.appendChild(this.powerEl);
    this.powerText = power.appendChild(document.createElement('b'));
    this.shootBtn = btn('primary pool-shoot', 'Shoot', 'Shoot (Space)', () => this.shoot());
  }

  // ---------- the human's turn ----------

  // Called by the human controller: aim (and with ball in hand, place) until Shoot.
  startAim({ hand, resolve }) {
    const { state } = this.game;
    const cueBall = state.balls.find((b) => b.id === 0);
    // A scratch leaves nowhere to start from; otherwise the cue ball stays put until
    // moved (on the break, on the head spot).
    const placing = !!hand && cueBall.potted;
    this.aim = { hand, cue: placing ? null : { x: cueBall.x, y: cueBall.y }, placing, dir: null, power: state.shots === 0 ? 0.9 : 0.45, resolve };
    if (!placing) this.aimDefault();
    this.refresh();
  }

  stopAim() {
    this.aim = null;
    this.hover = null;
    this.refresh();
  }

  // Point at the nearest ball you may hit (on the break, at the rack).
  aimDefault() {
    const a = this.aim;
    const { state } = this.game;
    const legal = targets(state.balls, state.groups[teamOf(this.seat)]);
    const balls = state.balls.filter((b) => legal.includes(b.id) && !b.potted);
    let best = state.shots === 0 ? FOOT_SPOT : null;
    let bestD = Infinity;
    if (!best) {
      for (const b of balls) {
        const d = (b.x - a.cue.x) ** 2 + (b.y - a.cue.y) ** 2;
        if (d < bestD) [best, bestD] = [b, d];
      }
    }
    best ??= FOOT_SPOT;
    a.dir = { x: best.x - a.cue.x, y: best.y - a.cue.y };
  }

  place(p) {
    const a = this.aim;
    const { state } = this.game;
    if (!canPlace(state.balls, p.x, p.y, a.hand)) {
      this.flashHint(a.hand === 'kitchen' ? 'Behind the line, and clear of the other balls' : 'Clear of the other balls and the pockets');
      return;
    }
    a.cue = { x: p.x, y: p.y };
    a.placing = false;
    if (!a.dir) this.aimDefault();
    this.refresh();
  }

  pointAt(p) {
    const a = this.aim;
    if (!a?.cue) return;
    const dx = p.x - a.cue.x;
    const dy = p.y - a.cue.y;
    if (dx * dx + dy * dy < 1e-6) return;
    a.dir = { x: dx, y: dy };
    this.draw();
  }

  nudge(steps) {
    const a = this.aim;
    if (!a?.dir || a.placing) return;
    const t = steps * NUDGE;
    const c = Math.cos(t);
    const s = Math.sin(t);
    // Positive is clockwise on screen, whichever way the table is turned (both are
    // rotations of the table's own axes).
    a.dir = { x: a.dir.x * c - a.dir.y * s, y: a.dir.x * s + a.dir.y * c };
    this.draw();
  }

  setPower(v) {
    if (!this.aim) return;
    this.aim.power = Math.max(0.03, Math.min(1, v));
    this.refresh();
  }

  shoot() {
    const a = this.aim;
    if (!a || a.placing || !a.dir) return;
    const shot = { dx: a.dir.x, dy: a.dir.y, power: a.power, cue: a.hand ? a.cue : null };
    const resolve = a.resolve;
    this.stopAim();
    resolve(shot);
  }

  flashHint(text) {
    this.hintEl.textContent = text;
    this.hintEl.classList.add('warn');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.refresh(), 1600);
  }

  // The controls under the table, and a redraw.
  refresh() {
    const a = this.aim;
    this.controls.classList.toggle('hidden', !a);
    if (a) {
      this.hintEl.classList.remove('warn');
      this.hintEl.textContent = a.placing
        ? a.hand === 'kitchen' ? 'Ball in hand: tap behind the line to place the cue ball' : 'Ball in hand: tap anywhere to place the cue ball'
        : 'Drag on the table to aim · ◀ ▶ to fine-tune · set the power and shoot';
      this.moveBtn.classList.toggle('hidden', !a.hand);
      this.shootBtn.disabled = a.placing;
      const pct = Math.round(a.power * 100);
      this.powerEl.value = String(pct);
      this.powerText.textContent = `${pct}%`;
    }
    this.draw();
  }

  // ---------- setup ----------

  showPiles() {}

  buildPanels(game) {
    for (const p of this.panels) p.el.remove();
    this.panels = game.state.players.map((p, i) => {
      const el = div('seat-panel', this.panelLayer);
      el.style.setProperty('--c', colorOf(i));
      return { el, head: div('seat-head', el), html: '' };
    });
  }

  attach(game) {
    // A shot already over when we arrive isn't replayed.
    this.played = game.state.phase === 'shot' ? 0 : game.state.shot?.no ?? 0;
    this.anim = null;
    super.attach(game);
  }

  detach() {
    this.aim = null;
    this.anim = null;
    cancelAnimationFrame(this.raf);
    super.detach();
  }

  // ---------- geometry ----------

  // Everyone's bars across the top, the controls along the bottom, and the table as
  // big as fits in between: lengthways on wide screens, upright on tall ones.
  fit() {
    const { w, h } = this.size;
    const ins = this.inset;
    const portrait = ins.portrait;
    const n = this.game?.state.players.length ?? 2;
    const small = w < 700 || h < 540;
    const pad = small ? 8 : 14;
    const gap = small ? 8 : 12;
    const head = small ? 30 : 36;
    const W = w - 2 * pad;
    const cols = portrait ? Math.min(n, 2) : n;
    const colW = Math.min((W - (cols - 1) * gap) / cols, BAR_MAX);
    const top = ins.top + 6;
    const bars = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, n - row * cols);
      const rowX = pad + (W - (inRow * colW + (inRow - 1) * gap)) / 2;
      bars.push({ x: rowX + (i % cols) * (colW + gap), y: top + row * (head + gap), w: colW, h: head });
    }
    const barsBottom = top + Math.ceil(n / cols) * (head + gap) - gap;
    const controlsH = small ? 78 : 86;
    // Tall screens: the controls along the bottom and the status row (ins.bottom) just
    // above them, so the table fits above both. Wide ones: the controls right under the
    // table (the status is in the top bar).
    const pinned = portrait ? h - 8 - controlsH : null;
    const bottom = portrait ? pinned - ins.bottom : h - gap - controlsH;
    const areaTop = barsBottom + gap;
    const areaH = Math.max(120, bottom - gap - areaTop);
    const across = portrait ? WIDTH + 2 * RAIL : LENGTH + 2 * RAIL;
    const down = portrait ? LENGTH + 2 * RAIL : WIDTH + 2 * RAIL;
    const s = Math.min(W / across, areaH / down);
    const tw = across * s;
    const th = down * s;
    const table = { x: pad + (W - tw) / 2, y: areaTop + (areaH - th) / 2, w: tw, h: th, s };
    const controls = { x: pad + (W - Math.min(W, 620)) / 2, y: pinned ?? table.y + th + gap, w: Math.min(W, 620), h: controlsH };
    const hand = { x0: pad, x1: w - pad, top: controls.y, h: controlsH, cw: 0, visible: h - controls.y };
    const mid = { x: w / 2, y: h / 2, w: 0 };
    // The panels in seat order (not "you first"): partners and opponents alternate.
    this.geo = { portrait, head, side: 0, lead: head, inner: small ? 6 : 10, panels: bars, table, controls, hand, dock: h - controls.y, deck: mid, discard: mid };
    this.layoutKey = `pool:${portrait ? 'tall' : 'wide'}:${n}`;
    this.root.style.setProperty('--head', `${head}px`);
    this.root.style.setProperty('--inner', `${small ? 6 : 10}px`);
    this.root.style.setProperty('--side', '0px');
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
    this.canvas.classList.toggle('hidden', !game);
    if (!game) {
      this.controls.classList.add('hidden');
      return;
    }
    const { state } = game;
    const { table, controls } = this.geo;
    setBox(this.canvas, table);
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(table.w * dpr);
    const ch = Math.round(table.h * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    setBox(this.controls, controls);
    state.players.forEach((p, i) => this.layoutPanel(p, i));
    // A new shot: replay it.
    if (state.shot && state.shot.no !== this.played) {
      this.played = state.shot.no;
      const { from, dx, dy, power } = state.shot;
      const r = simulate(from, dx, dy, power, { record: FRAME_STEPS });
      this.anim = { frames: r.frames, dt: r.frameDt, start: performance.now(), hits: r.events.hits, drops: r.events.drops, heard: 0, dropped: 0, lastClack: -1 };
      if (this.aim) this.stopAim();
    }
    const me = state.players[this.seat];
    this.root.classList.toggle('my-turn', !!me?.isHuman && state.phase === 'aim' && state.current === this.seat);
    this.loop();
  }

  loop() {
    cancelAnimationFrame(this.raf);
    this.draw();
    if (this.anim) this.raf = requestAnimationFrame(() => this.loop());
  }

  // The balls on show: mid-replay, or where they are.
  shown() {
    const { state } = this.game;
    const a = this.anim;
    if (!a) return state.balls;
    const t = (performance.now() - a.start) / 1000;
    const i = Math.min(a.frames.length - 1, Math.floor(t / a.dt));
    // Knocks and drops as the replay reaches them.
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
    if (i >= a.frames.length - 1) this.anim = null;
    const row = a.frames[i];
    return state.balls.map((b) => {
      const x = row[2 * b.id];
      return Number.isNaN(x) || x == null ? { ...b, potted: true } : { id: b.id, x, y: row[2 * b.id + 1], potted: false };
    });
  }

  layoutPanel(p, i) {
    const r = this.geo.panels[i];
    const panel = this.panels[i];
    const { state } = this.game;
    setBox(panel.el, r);
    const mine = i === this.seat;
    panel.el.classList.toggle('me', mine);
    panel.el.classList.toggle('active', state.phase !== 'over' && state.current === i);
    panel.el.classList.toggle('winner', state.phase === 'over' && state.winners.includes(p));
    panel.el.classList.toggle('compact', r.w < 240);
    const you = mine && p.isHuman && p.name.trim().toLowerCase() !== 'you' ? '<span class="you">You</span>' : '';
    const tag = p.tag ? `<span class="tag">${p.tag}</span>` : '';
    const initial = [...p.name.trim()][0]?.toUpperCase() ?? '?';
    const group = state.groups[p.team];
    // Their group and how many are left (all of them while the table is open).
    let chip;
    if (!group) chip = '<span class="chip pgroup open" title="The table is open">Open</span>';
    else {
      const left = ballsLeft(state.balls, group);
      const label = left ? `${left} left` : 'on the 8';
      chip = `<span class="chip pgroup ${group}" title="${group === 'solids' ? 'Solids (1–7)' : 'Stripes (9–15)'}"><i class="pball ${group}"></i>${label}</span>`;
    }
    const team = state.players.length > 2 ? `<span class="chip pteam t${p.team}" title="Team ${p.team + 1}">T${p.team + 1}</span>` : '';
    const html = `<span class="avatar">${esc(initial)}</span><span class="seat-name">${tag}${esc(p.name)}</span><span class="mic"></span>${you}<span class="chips">${team}${chip}</span>`;
    if (html !== panel.html) {
      panel.head.innerHTML = html;
      panel.html = html;
    }
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
    const balls = this.shown();
    const a = this.aim;
    // With ball in hand, the cue ball sits where it was put (or follows the pointer).
    const cue = a?.hand ? (a.placing ? (this.hover && { x: this.hover.x, y: this.hover.y, ghost: true }) : a.cue) : null;
    for (const b of balls) {
      if (b.potted || (b.id === 0 && a?.hand)) continue;
      this.drawBall(ctx, b, s);
    }
    if (cue) {
      const ok = !cue.ghost || canPlace(this.game.state.balls, cue.x, cue.y, a.hand);
      ctx.globalAlpha = cue.ghost ? 0.55 : 1;
      this.drawBall(ctx, { id: 0, ...cue }, s, cue.ghost && !ok ? '#ff6b6b' : null);
      ctx.globalAlpha = 1;
    }
    if (a && !a.placing && a.dir && a.cue) this.drawAim(ctx, s, balls);
  }

  drawTable(ctx, s, w, h) {
    // Wood.
    ctx.fillStyle = '#5a3418';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, RAIL * s * 0.6);
    ctx.fill();
    // Cushions, then the cloth.
    const c0 = this.toScreen(-RAIL * 0.35, -RAIL * 0.35);
    const c1 = this.toScreen(LENGTH + RAIL * 0.35, WIDTH + RAIL * 0.35);
    ctx.fillStyle = '#0e5a35';
    ctx.fillRect(Math.min(c0.x, c1.x), Math.min(c0.y, c1.y), Math.abs(c1.x - c0.x), Math.abs(c1.y - c0.y));
    const f0 = this.toScreen(0, 0);
    const f1 = this.toScreen(LENGTH, WIDTH);
    const fx = Math.min(f0.x, f1.x);
    const fy = Math.min(f0.y, f1.y);
    const fw = Math.abs(f1.x - f0.x);
    const fh = Math.abs(f1.y - f0.y);
    const felt = ctx.createRadialGradient(fx + fw / 2, fy + fh / 2, 0, fx + fw / 2, fy + fh / 2, Math.max(fw, fh) * 0.7);
    felt.addColorStop(0, '#1f8a54');
    felt.addColorStop(1, '#14683e');
    ctx.fillStyle = felt;
    ctx.fillRect(fx, fy, fw, fh);
    // Diamonds on the rails.
    ctx.fillStyle = '#f4e3b5';
    for (let k = 1; k < 8; k++) {
      if (k === 4) continue;
      for (const y of [-RAIL * 0.7, WIDTH + RAIL * 0.7]) this.dot(ctx, (LENGTH * k) / 8, y, s * 0.012);
    }
    for (let k = 1; k < 4; k++) for (const x of [-RAIL * 0.7, LENGTH + RAIL * 0.7]) this.dot(ctx, x, (WIDTH * k) / 4, s * 0.012);
    // The head string and spot, and the foot spot.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    const a = this.toScreen(HEAD_STRING, 0);
    const b = this.toScreen(HEAD_STRING, WIDTH);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    this.dot(ctx, HEAD_STRING, WIDTH / 2, s * 0.006);
    this.dot(ctx, FOOT_SPOT.x, FOOT_SPOT.y, s * 0.006);
    // Ball in hand behind the line: the kitchen lit up.
    if (this.aim?.placing && this.aim.hand === 'kitchen') {
      const k1 = this.toScreen(HEAD_STRING, WIDTH);
      ctx.fillStyle = 'rgba(255, 215, 94, 0.08)';
      ctx.fillRect(Math.min(f0.x, k1.x), Math.min(f0.y, k1.y), Math.abs(k1.x - f0.x), Math.abs(k1.y - f0.y));
    }
    // Pockets.
    ctx.fillStyle = '#050505';
    for (const p of POCKETS) this.dot(ctx, p.x, p.y, p.r * s);
  }

  dot(ctx, x, y, r) {
    const p = this.toScreen(x, y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  drawBall(ctx, b, s, tint = null) {
    const p = this.toScreen(b.x, b.y);
    const r = R * s;
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.clip();
    const stripe = b.id >= 9;
    const color = b.id === 0 ? '#f7f3e8' : BALL_COLORS[stripe ? b.id - 8 : b.id];
    ctx.fillStyle = tint ?? (stripe ? '#f7f3e8' : color);
    ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
    if (stripe && !tint) {
      ctx.fillStyle = color;
      if (this.geo.portrait) ctx.fillRect(p.x - r * 0.55, p.y - r, r * 1.1, 2 * r);
      else ctx.fillRect(p.x - r, p.y - r * 0.55, 2 * r, r * 1.1);
    }
    // The number on a white spot.
    if (b.id && r > 5) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.48, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = `800 ${Math.max(6, r * 0.62)}px "Segoe UI", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(b.id), p.x, p.y + r * 0.04);
    }
    // Shine and shade.
    const g = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
    g.addColorStop(0.35, 'rgba(255, 255, 255, 0)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
    ctx.restore();
  }

  // The guide: the cue ball's path to the first thing it meets, a ghost ball where it
  // would touch an object ball and that ball's way on; and the cue stick, drawn back by
  // the power.
  drawAim(ctx, s, balls) {
    const a = this.aim;
    const from = a.cue;
    const l = Math.sqrt(a.dir.x * a.dir.x + a.dir.y * a.dir.y);
    const u = { x: a.dir.x / l, y: a.dir.y / l };
    // Distance to the first ball (centres 2R apart) or cushion along u.
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
    const end = { x: from.x + u.x * t, y: from.y + u.y * t };
    const p0 = this.toScreen(from.x, from.y);
    const p1 = this.toScreen(end.x, end.y);
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(p1.x, p1.y, R * s, 0, Math.PI * 2);
    ctx.stroke();
    if (hit) {
      // Where the object ball goes: along the line between the centres.
      const nx = hit.x - end.x;
      const ny = hit.y - end.y;
      const nl = Math.sqrt(nx * nx + ny * ny) || 1;
      const q0 = this.toScreen(hit.x, hit.y);
      const q1 = this.toScreen(hit.x + (nx / nl) * 0.25, hit.y + (ny / nl) * 0.25);
      const { state } = this.game;
      const legal = targets(state.balls, state.groups[teamOf(this.seat)]);
      ctx.strokeStyle = legal.includes(hit.id) ? 'rgba(255, 215, 94, 0.9)' : 'rgba(255, 107, 107, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(q0.x, q0.y);
      ctx.lineTo(q1.x, q1.y);
      ctx.stroke();
    }
    // The cue stick, behind the cue ball.
    const back = R * 1.6 + a.power * 0.12;
    const s0 = this.toScreen(from.x - u.x * back, from.y - u.y * back);
    const s1 = this.toScreen(from.x - u.x * (back + 1.1), from.y - u.y * (back + 1.1));
    const grad = ctx.createLinearGradient(s0.x, s0.y, s1.x, s1.y);
    grad.addColorStop(0, '#e9e2cf');
    grad.addColorStop(0.03, '#3a6ea5');
    grad.addColorStop(0.06, '#d9b47a');
    grad.addColorStop(0.7, '#a0662e');
    grad.addColorStop(1, '#2a160a');
    ctx.strokeStyle = grad;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(3, R * s * 0.5);
    ctx.beginPath();
    ctx.moveTo(s0.x, s0.y);
    ctx.lineTo(s1.x, s1.y);
    ctx.stroke();
    ctx.restore();
  }
}
