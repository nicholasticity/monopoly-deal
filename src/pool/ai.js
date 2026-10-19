// Computer opponents for 8-ball. A bot lines up every legal ball with every pocket
// ("ghost ball" aiming: send the cue ball to where it touches the object ball on the
// line to the pocket), keeps the clear, not too thin ones, plays the best few out with
// the real physics and takes the one that turns out best. Then it adds a little aiming
// error, so bots miss like people do. With ball in hand it puts the cue ball behind an
// easy pot.
import { simulate, POCKETS, R, LENGTH, WIDTH } from './physics.js';
import { targets, judgeShot, canPlace, teamOf, HEAD_STRING, FOOT_SPOT, EIGHT } from './rules.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// How far off a bot's aim may be, in radians (one standard deviation).
const AIM_ERROR = 0.014;
// Shots played out per decision (each at two strengths).
const TRIES = 6;

export class PoolAI {
  constructor({ delay = 0 } = {}) {
    this.delay = delay;
  }

  async chooseShot(game, me, { ballInHand }) {
    if (this.delay) await sleep(this.delay * 2.5);
    const cue = ballInHand ? placeCue(game, me, ballInHand) : null;
    return { ...planShot(game, me, cue), cue };
  }
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v) => Math.sqrt(v.x * v.x + v.y * v.y);
const unit = (v) => {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l };
};

// Whether a ball rolling from a to b passes clear of every other ball.
function clear(balls, a, b, skip) {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y || 1e-9;
  return balls.every((c) => {
    if (c.potted || skip.includes(c.id)) return true;
    const t = Math.max(0, Math.min(1, ((c.x - a.x) * ab.x + (c.y - a.y) * ab.y) / l2));
    const px = a.x + t * ab.x - c.x;
    const py = a.y + t * ab.y - c.y;
    return px * px + py * py >= 4 * R * R * 0.98;
  });
}

// Every pot the cue ball at `from` could try: { dx, dy, score, dist } (bigger score =
// easier: straighter and shorter).
function pots(balls, from, legal) {
  const out = [];
  for (const id of legal) {
    const b = balls.find((x) => x.id === id);
    for (const p of POCKETS) {
      // Aim a little inside the pocket's mouth rather than at its far edge.
      const mouth = { x: Math.min(LENGTH - R, Math.max(R, p.x)), y: Math.min(WIDTH - R, Math.max(R, p.y)) };
      const toPocket = unit(sub(mouth, b));
      const ghost = { x: b.x - toPocket.x * 2 * R, y: b.y - toPocket.y * 2 * R };
      const aim = sub(ghost, from);
      const d1 = len(aim);
      if (d1 < 2 * R) continue;
      const u = unit(aim);
      const cut = u.x * toPocket.x + u.y * toPocket.y;
      if (cut < 0.25) continue;
      if (!clear(balls, from, ghost, [0, id]) || !clear(balls, b, mouth, [0, id])) continue;
      const d2 = len(sub(mouth, b));
      out.push({ dx: aim.x, dy: aim.y, score: (cut * cut) / (0.5 + d1 + 1.5 * d2), dist: d1 + d2 });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

// What a shot is worth to `team`: winning or losing, a foul, carrying on.
function value(balls, shot, groups, team, brk) {
  const r = simulate(balls, shot.dx, shot.dy, shot.power);
  const j = judgeShot({ before: balls, events: r.events, groups, team, brk });
  if (j.win) return 1000;
  if (j.lose) return -1000;
  if (j.foul) return -60;
  const potted = r.events.pocketed.length;
  return j.again ? 40 + 4 * potted : potted ? 5 : 0;
}

// The shot to take from where the cue ball is (or will be placed: `cue`).
export function planShot(game, me, cue = null, rng = Math.random) {
  const { state } = game;
  const balls = state.balls.map((b) => (b.id === 0 && cue ? { ...b, ...cue, potted: false } : { ...b }));
  const from = balls.find((b) => b.id === 0);
  const team = teamOf(me.id);
  const brk = state.shots === 0;
  // The break: hard at the head ball, a touch off centre.
  if (brk) return jitter({ dx: FOOT_SPOT.x - from.x, dy: FOOT_SPOT.y - from.y + (rng() - 0.5) * 0.02, power: 1 }, rng);
  const legal = targets(balls, state.groups[team]);
  const tries = [];
  for (const c of pots(balls, from, legal).slice(0, TRIES)) {
    const power = Math.max(0.16, Math.min(0.85, 0.12 + 0.17 * c.dist));
    tries.push({ ...c, power }, { ...c, power: Math.min(1, power * 1.4) });
  }
  // Nothing to pot: hit a legal ball softly and get it to a cushion.
  if (!tries.length || tries.every((t) => t.score < 0.02)) {
    for (const id of legal) {
      const b = balls.find((x) => x.id === id);
      if (!clear(balls, from, b, [0, id])) continue;
      for (const power of [0.22, 0.4]) tries.push({ dx: b.x - from.x, dy: b.y - from.y, power });
    }
  }
  let best = null;
  let bestValue = -Infinity;
  for (const t of tries) {
    const v = value(balls, t, state.groups, team, brk);
    if (v > bestValue) {
      best = t;
      bestValue = v;
    }
  }
  // Still nothing: any direction at all that touches a legal ball.
  if (!best) {
    const b = balls.find((x) => x.id === legal[0]) ?? balls.find((x) => x.id === EIGHT);
    best = { dx: b.x - from.x, dy: b.y - from.y, power: 0.45 };
  }
  return jitter({ dx: best.dx, dy: best.dy, power: best.power }, rng);
}

// A person's aim is never perfect.
function jitter(shot, rng) {
  // A normal-ish error (sum of three uniforms).
  const e = (rng() + rng() + rng() - 1.5) * 2 * AIM_ERROR;
  const c = Math.cos(e);
  const s = Math.sin(e);
  return { dx: shot.dx * c - shot.dy * s, dy: shot.dx * s + shot.dy * c, power: shot.power };
}

// Ball in hand: straight behind the easiest pot, else somewhere free.
export function placeCue(game, me, where, rng = Math.random) {
  const { state } = game;
  const balls = state.balls;
  if (where === 'kitchen' && state.shots === 0) {
    const y = WIDTH / 2 + (rng() - 0.5) * 0.3;
    if (canPlace(balls, HEAD_STRING - 0.05, y, where)) return { x: HEAD_STRING - 0.05, y };
  }
  const legal = targets(balls, state.groups[teamOf(me.id)]);
  let best = null;
  let bestScore = -Infinity;
  for (const id of legal) {
    const b = balls.find((x) => x.id === id);
    for (const p of POCKETS) {
      const toPocket = unit(sub(p, b));
      for (const back of [0.2, 0.35, 0.55]) {
        const x = b.x - toPocket.x * (2 * R + back);
        const y = b.y - toPocket.y * (2 * R + back);
        if (!canPlace(balls, x, y, where)) continue;
        const top = pots(balls.map((q) => (q.id === 0 ? { ...q, x, y, potted: false } : q)), { x, y }, legal)[0];
        if (top && top.score > bestScore) {
          best = { x, y };
          bestScore = top.score;
        }
      }
    }
  }
  if (best) return best;
  for (let i = 0; i < 200; i++) {
    const x = R + rng() * ((where === 'kitchen' ? HEAD_STRING : LENGTH) - 2 * R);
    const y = R + rng() * (WIDTH - 2 * R);
    if (canPlace(balls, x, y, where)) return { x, y };
  }
  return { x: HEAD_STRING / 2, y: WIDTH / 2 };
}
