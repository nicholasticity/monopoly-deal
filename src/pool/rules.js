// 8-ball rules: the rack, whose balls are whose, and what a shot means. Balls 1–7 are
// solids, 9–15 stripes, 8 the eight ball, 0 the cue ball. Two players, or two teams of
// two taking turns round the table (seats 0 & 2 against 1 & 3); a team shares a group.
// House rules where tournaments differ: no called pockets, ball in hand anywhere after
// any foul, and an 8 potted on the break is put back.
import { LENGTH, WIDTH, R, fits } from './physics.js';

export const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
export const STRIPES = [9, 10, 11, 12, 13, 14, 15];
export const EIGHT = 8;
export const GROUPS = { solids: SOLIDS, stripes: STRIPES };
export const groupOf = (id) => (id >= 1 && id <= 7 ? 'solids' : id >= 9 ? 'stripes' : null);
export const otherGroup = (g) => (g === 'solids' ? 'stripes' : 'solids');

// The head string: the cue ball starts (and is placed for the break) behind it.
export const HEAD_STRING = LENGTH / 4;
export const FOOT_SPOT = { x: (3 * LENGTH) / 4, y: WIDTH / 2 };
export const HEAD_SPOT = { x: HEAD_STRING, y: WIDTH / 2 };

export const teamOf = (seat) => seat % 2;
// How many play: two, or four as two teams.
export const seatsFor = (count) => (count >= 4 ? 4 : 2);

const SQRT3 = 1.7320508075688772;

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// The triangle, apex on the foot spot: the 8 in the middle of the third row, a solid
// and a stripe in the back corners, the rest at random. The cue ball on the head spot.
export function rack(rng = Math.random) {
  const gap = 0.0002;
  const spots = [];
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) {
      spots.push({ x: FOOT_SPOT.x + row * (R * SQRT3 + gap), y: FOOT_SPOT.y + (k - row / 2) * (2 * R + gap), row, k });
    }
  }
  const solid = SOLIDS[Math.floor(rng() * 7)];
  const stripe = STRIPES[Math.floor(rng() * 7)];
  const [left, right] = rng() < 0.5 ? [solid, stripe] : [stripe, solid];
  const rest = shuffle([...SOLIDS, ...STRIPES].filter((id) => id !== solid && id !== stripe), rng);
  const balls = [{ id: 0, x: HEAD_SPOT.x, y: HEAD_SPOT.y, potted: false }];
  for (const s of spots) {
    const id = s.row === 2 && s.k === 1 ? EIGHT : s.row === 4 && s.k === 0 ? left : s.row === 4 && s.k === 4 ? right : rest.pop();
    balls.push({ id, x: s.x, y: s.y, potted: false });
  }
  return balls.sort((a, b) => a.id - b.id);
}

// Where the cue ball may go with ball in hand: 'kitchen' (behind the head string, for
// the break) or 'anywhere'.
export function canPlace(balls, x, y, where) {
  if (where === 'kitchen' && x > HEAD_STRING) return false;
  return fits(balls, x, y, 0);
}

// Puts a ball back on the foot spot, or the nearest free place behind it.
export function spot(balls, id) {
  const b = balls.find((x) => x.id === id);
  for (let x = FOOT_SPOT.x; x < LENGTH - R; x += R / 2) {
    if (fits(balls, x, FOOT_SPOT.y, id)) {
      Object.assign(b, { x, y: FOOT_SPOT.y, potted: false });
      return;
    }
  }
  Object.assign(b, { x: FOOT_SPOT.x, y: FOOT_SPOT.y, potted: false });
}

export const ballsLeft = (balls, group) => balls.filter((b) => !b.potted && GROUPS[group].includes(b.id)).length;

// The balls a team may hit first: their group, the 8 once that's cleared, or (table
// open) anything but the 8.
export function targets(balls, group) {
  if (!group) return balls.filter((b) => !b.potted && b.id !== 0 && b.id !== EIGHT).map((b) => b.id);
  const mine = balls.filter((b) => !b.potted && GROUPS[group].includes(b.id)).map((b) => b.id);
  return mine.length ? mine : [EIGHT];
}

// What a shot means. `before`: the balls as they were; `groups`: [team 0's, team 1's]
// group (null while the table is open); `team`: who shot; `brk`: the break.
// Returns { foul, why, win, lose, again (shoots again), assign (team 0's group, if the
// shot decided them), respot8 (on the break) }.
export function judgeShot({ before, events, groups, team, brk }) {
  const group = groups[team];
  const potted = events.pocketed.map((p) => p.id);
  const scratch = potted.includes(0);
  const eight = potted.includes(EIGHT);
  const objects = potted.filter((id) => id !== 0 && id !== EIGHT);
  const legal = targets(before, group);
  const onEight = legal.length === 1 && legal[0] === EIGHT;
  let why = null;
  if (scratch) why = 'scratch';
  else if (events.first == null) why = 'no ball hit';
  else if (!brk && !legal.includes(events.first)) why = events.first === EIGHT ? 'hit the 8 first' : 'hit the wrong ball first';
  else if (!brk && !potted.length && !events.rail) why = 'no ball hit a cushion';
  const foul = !!why;

  // The 8 on the break goes back on the spot; otherwise it ends the game.
  if (eight && brk) return { foul, why, win: false, lose: false, again: !foul && objects.length > 0, assign: null, respot8: true };
  if (eight) {
    const win = onEight && !foul;
    return { foul, why, win, lose: !win, again: false, assign: null, respot8: false };
  }
  // An open table is decided by the first ball potted legally (never on the break).
  let assign = null;
  let mine = group;
  if (!group && !brk && !foul && objects.length) {
    mine = groupOf(objects[0]);
    assign = team === 0 ? mine : otherGroup(mine);
  }
  const again = !foul && (brk ? objects.length > 0 : objects.some((id) => groupOf(id) === mine));
  return { foul, why, win: false, lose: false, again, assign, respot8: false };
}
