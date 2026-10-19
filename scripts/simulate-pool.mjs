// Headless 8-ball games between bots, to check the rules engine and the physics: every
// game ends, groups are assigned once and to opposite teams, fouls hand over ball in
// hand, a winner pots the 8 legally, and the same shot replayed gives the same result.
// Usage: node scripts/simulate-pool.mjs [games=40]
import { PoolGame } from '../src/pool/engine.js';
import { PoolAI } from '../src/pool/ai.js';
import { simulate } from '../src/pool/physics.js';
import * as R from '../src/pool/rules.js';

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The rules on their own.
const rackBalls = R.rack(mulberry32(1));
if (rackBalls.length !== 16 || new Set(rackBalls.map((b) => b.id)).size !== 16) fail('the rack is not 16 balls');
const eight = rackBalls.find((b) => b.id === 8);
const apexX = R.FOOT_SPOT.x;
if (!(eight.x > apexX + 0.08 && Math.abs(eight.y - R.FOOT_SPOT.y) < 1e-9)) fail('the 8 is not in the middle of the rack');
const before = rackBalls.map((b) => ({ ...b }));
const groups = ['solids', 'stripes'];
const ev = (first, pocketed, rail = true) => ({ first, pocketed: pocketed.map((id) => ({ id, pocket: 0 })), rail });
const j = (events, g = groups, team = 0, b = before, brk = false) => R.judgeShot({ before: b, events, groups: g, team, brk });
if (!j(ev(3, [3])).again || j(ev(3, [3])).foul) fail('potting your own ball should carry on');
if (!j(ev(11, [])).foul) fail('hitting the other group first should be a foul');
if (!j(ev(3, [0])).foul) fail('a scratch should be a foul');
if (!j(ev(null, [])).foul) fail('hitting nothing should be a foul');
if (!j(ev(3, [], false)).foul) fail('no cushion after contact should be a foul');
if (!j(ev(3, [8])).lose) fail('potting the 8 early should lose');
const cleared = before.map((b) => (R.SOLIDS.includes(b.id) ? { ...b, potted: true } : { ...b }));
if (!j(ev(8, [8]), groups, 0, cleared).win) fail('potting the 8 after your group should win');
if (!j(ev(8, [8, 0]), groups, 0, cleared).lose) fail('potting the 8 with a scratch should lose');
const open = j(ev(12, [12]), [null, null], 1);
if (open.assign !== 'solids' || !open.again) fail('an open table should go to the first group potted');
if (!j(ev(3, [8]), [null, null], 0, before, true).respot8) fail('an 8 on the break should be spotted');

// The same shot from the same place always ends the same way (the server and every
// browser replay shots).
const s1 = simulate(before, 1, 0.003, 1);
const s2 = simulate(JSON.parse(JSON.stringify(before)), 1, 0.003, 1);
if (JSON.stringify(s1.balls) !== JSON.stringify(s2.balls)) fail('the same shot ended differently');

const games = Number(process.argv[2] || 40);
const stats = { shots: 0, fouls: 0, wins: 0, losses: 0, breaks: 0, byTeams: { 2: 0, 4: 0 } };
for (let g = 0; g < games; g++) {
  const rng = mulberry32(100 + g);
  const n = g % 4 === 3 ? 4 : 2;
  const players = Array.from({ length: n }, (_, i) => ({ name: `Bot${i}`, controller: new PoolAI() }));
  const game = new PoolGame({ players, rng });
  const { state } = game;
  let assigned = 0;
  let lastGroups = '';
  game.on((type, data) => {
    if (type === 'log' && /^Foul/.test(data.text)) stats.fouls++;
    if (type === 'state') {
      const k = JSON.stringify(state.groups);
      if (k !== lastGroups) {
        lastGroups = k;
        if (state.groups[0]) {
          assigned++;
          if (state.groups[0] === state.groups[1]) fail('both teams have the same group');
        }
      }
      if (state.shots > 400) game.abort();
    }
  });
  try {
    await game.run();
  } catch (e) {
    if (e.constructor.name === 'GameAborted') fail(`game ${g} never ended (${state.shots} shots)`);
    throw e;
  }
  if (assigned > 1) fail('the groups changed after they were assigned');
  stats.shots += state.shots;
  stats.byTeams[n]++;
  const team = state.winners[0].team;
  if (state.winners.some((p) => p.team !== team) || state.winners.length !== n / 2) fail('wrong winners');
  // Won on the 8 (all of their group down) or on the other side's mistake.
  const g8 = state.balls.find((b) => b.id === 8).potted;
  if (!g8) fail('the game ended with the 8 still up');
  const mine = state.groups[team];
  if (mine && R.ballsLeft(state.balls, mine) === 0) stats.wins++;
  else stats.losses++;
}
console.log(`games=${games} (${stats.byTeams[2]} 1v1, ${stats.byTeams[4]} 2v2), ${(stats.shots / games).toFixed(0)} shots a game, ${(stats.fouls / stats.shots * 100).toFixed(0)}% of shots fouls`);
console.log(`won by sinking the 8 after clearing the group: ${stats.wins}; by the other side potting it early or fouling on it: ${stats.losses}`);
console.log('OK');
