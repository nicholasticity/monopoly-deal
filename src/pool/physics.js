// Pool table physics: balls sliding, then rolling to a stop, bouncing off each other
// and the cushions, and dropping into pockets. Deterministic: only + − × ÷ and
// Math.sqrt (no trig), which give the same results in every browser and on the server,
// so a shot replayed from the same positions and cue ball velocity ends the same
// everywhere.
//
// Each ball has a velocity v and a "roll" w: how fast its surface turns (its spin times
// its radius), so w = v is rolling naturally. A struck ball starts with w = 0, sliding;
// friction on the cloth works on the slip v − w until it rolls, at 5/7 of its speed.
// Balls trade only v when they meet, so a rolling cue ball that hits a ball full on
// stops, then its roll carries it on after it (follow); the ball it hit slides first.
// Units are metres and seconds; x runs along the table (head rail at 0, foot rail at
// LENGTH), y across it.

export const LENGTH = 2.54; // a 9-foot table's playing surface
export const WIDTH = 1.27;
export const R = 0.028575; // ball radius (2¼" balls)

// Pockets: the four corners and the middle of each long rail. A ball whose centre
// comes within `r` of a pocket drops.
// Corner mouths are a little over two balls wide, the sides a little less.
export const POCKETS = [
  { x: 0, y: 0, r: 0.064 },
  { x: LENGTH / 2, y: -0.012, r: 0.056 },
  { x: LENGTH, y: 0, r: 0.064 },
  { x: 0, y: WIDTH, r: 0.064 },
  { x: LENGTH / 2, y: WIDTH + 0.012, r: 0.056 },
  { x: LENGTH, y: WIDTH, r: 0.064 },
];

// How long the cue takes to swing round, draw back and strike before a shot plays out
// (ms): the view draws it, and the engine waits for it.
export const STROKE_MS = 650;

// The fastest cue ball (a full-power break), in m/s.
export const MAX_SPEED = 7;
export const DT = 1 / 500; // seconds per step
// Sliding friction on the cloth (m/s²: 0.2 g), and what rolling loses (m/s², and a
// little more in proportion to speed, 1/s).
const SLIDE = 1.96;
export const ROLL = 0.3;
export const DAMP = 0.1;
const BALL_E = 0.94; // ball-on-ball restitution
const RAIL_E = 0.74; // cushion restitution
// A cushion takes most of a ball's roll into it, and some of its roll along it.
const RAIL_ROLL_IN = 0.35;
const RAIL_ROLL_ALONG = 0.85;
const STOP = 0.005; // slower than this (m/s), and not slipping, is stopped
const MAX_TIME = 40; // no shot lasts longer (s)

// `balls`: [{ id, x, y, potted }], id 0 the cue ball. The cue ball leaves along
// (dx, dy) (normalised here) at `power` (0–1) of MAX_SPEED.
// Returns { balls (where they end up), time, events, frames? }:
//   events.first: the first ball the cue ball touched (id, or null)
//   events.pocketed: [{ id, pocket }] in the order they dropped
//   events.rail: whether any ball touched a cushion after the cue ball's first contact
//   events.hits: [{ t, speed }] ball-on-ball knocks and events.drops: [{ t, id }], for sounds
// With record: n, `frames` holds every ball's position every n steps:
// [[x0, y0, x1, y1, …] per ball id, NaN while potted].
export function simulate(balls, dx, dy, power, { record = 0 } = {}) {
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const speed = Math.max(0, Math.min(1, power)) * MAX_SPEED;
  const live = balls.map((b) => ({ id: b.id, x: b.x, y: b.y, vx: 0, vy: 0, wx: 0, wy: 0, potted: !!b.potted }));
  const cue = live.find((b) => b.id === 0);
  cue.vx = (dx / len) * speed;
  cue.vy = (dy / len) * speed;
  const events = { first: null, pocketed: [], rail: false, hits: [], drops: [] };
  const frames = record ? [] : null;
  const snap = () => {
    const row = [];
    for (const b of live) {
      row[2 * b.id] = b.potted ? NaN : b.x;
      row[2 * b.id + 1] = b.potted ? NaN : b.y;
    }
    frames.push(row);
  };
  if (record) snap();
  let t = 0;
  let step = 0;
  for (; t < MAX_TIME; t += DT, step++) {
    let moving = false;
    for (const b of live) {
      if (b.potted || (b.vx === 0 && b.vy === 0 && b.wx === 0 && b.wy === 0)) continue;
      const sx = b.vx - b.wx;
      const sy = b.vy - b.wy;
      const slip = Math.sqrt(sx * sx + sy * sy);
      if (slip > 1e-4) {
        // Sliding: friction against the slip slows the ball and turns its roll (the
        // roll gains 5/2 as much, for a solid ball), until they match.
        const dv = SLIDE * DT;
        if (slip <= 3.5 * dv) {
          // This step it starts rolling: at the speed that keeps its momentum about the
          // point touching the cloth.
          b.vx = b.wx = (5 * b.vx + 2 * b.wx) / 7;
          b.vy = b.wy = (5 * b.vy + 2 * b.wy) / 7;
        } else {
          const ux = sx / slip;
          const uy = sy / slip;
          b.vx -= dv * ux;
          b.vy -= dv * uy;
          b.wx += 2.5 * dv * ux;
          b.wy += 2.5 * dv * uy;
        }
      } else {
        // Rolling: it slows gently, and stops once slow enough.
        const v = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        const slower = v - (ROLL + DAMP * v) * DT;
        if (slower <= STOP) {
          b.vx = b.vy = b.wx = b.wy = 0;
          continue;
        }
        b.vx *= slower / v;
        b.vy *= slower / v;
        b.wx = b.vx;
        b.wy = b.vy;
      }
      b.x += b.vx * DT;
      b.y += b.vy * DT;
      moving = true;
    }
    if (!moving) break;
    // Pockets first, so a ball heading into one drops rather than bouncing off its jaws.
    for (const b of live) {
      if (b.potted) continue;
      for (let p = 0; p < POCKETS.length; p++) {
        const q = POCKETS[p];
        const ex = b.x - q.x;
        const ey = b.y - q.y;
        if (ex * ex + ey * ey < q.r * q.r) {
          b.potted = true;
          b.vx = b.vy = b.wx = b.wy = 0;
          events.pocketed.push({ id: b.id, pocket: p });
          events.drops.push({ t, id: b.id });
          break;
        }
      }
    }
    // Ball on ball: equal masses, so they swap the part of their velocity along the
    // line between their centres (less a little lost). Their roll stays with them.
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      if (a.potted) continue;
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j];
        if (b.potted) continue;
        const nx = b.x - a.x;
        const ny = b.y - a.y;
        const d2 = nx * nx + ny * ny;
        if (d2 >= 4 * R * R) continue;
        const d = Math.sqrt(d2) || 1e-9;
        const ux = nx / d;
        const uy = ny / d;
        const closing = (a.vx - b.vx) * ux + (a.vy - b.vy) * uy;
        if (closing > 0) {
          const j2 = ((1 + BALL_E) / 2) * closing;
          a.vx -= j2 * ux;
          a.vy -= j2 * uy;
          b.vx += j2 * ux;
          b.vy += j2 * uy;
          if (events.first == null && (a.id === 0 || b.id === 0)) events.first = a.id === 0 ? b.id : a.id;
          events.hits.push({ t, speed: closing });
        }
        // Never left overlapping.
        const push = (2 * R - d) / 2;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
      }
    }
    // Cushions.
    for (const b of live) {
      if (b.potted) continue;
      let bounced = false;
      // Off a cushion: back out across it, losing some speed; most of the roll into the
      // cushion goes, so the ball slides away and picks up its roll again.
      const offX = () => {
        b.vx = -b.vx * RAIL_E;
        b.wx = -b.wx * RAIL_ROLL_IN;
        b.wy *= RAIL_ROLL_ALONG;
        bounced = true;
      };
      const offY = () => {
        b.vy = -b.vy * RAIL_E;
        b.wy = -b.wy * RAIL_ROLL_IN;
        b.wx *= RAIL_ROLL_ALONG;
        bounced = true;
      };
      if (b.x < R) { b.x = R; if (b.vx < 0) offX(); }
      else if (b.x > LENGTH - R) { b.x = LENGTH - R; if (b.vx > 0) offX(); }
      if (b.y < R) { b.y = R; if (b.vy < 0) offY(); }
      else if (b.y > WIDTH - R) { b.y = WIDTH - R; if (b.vy > 0) offY(); }
      if (bounced && events.first != null) events.rail = true;
    }
    if (record && step % record === 0) snap();
  }
  if (record) snap();
  return {
    balls: live.map((b) => ({ id: b.id, x: b.x, y: b.y, potted: b.potted })),
    time: t,
    events,
    frames,
    frameDt: record * DT,
  };
}

// Whether a ball at (x, y) would sit on the table without touching another.
export function fits(balls, x, y, ignore = 0) {
  if (!(x >= R && x <= LENGTH - R && y >= R && y <= WIDTH - R)) return false;
  const near = (ax, ay, d) => (ax - x) * (ax - x) + (ay - y) * (ay - y) < d * d;
  if (POCKETS.some((p) => near(p.x, p.y, p.r + R))) return false;
  return balls.every((b) => b.potted || b.id === ignore || !near(b.x, b.y, 2 * R));
}
