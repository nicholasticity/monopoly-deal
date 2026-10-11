// Headless AI-vs-AI Bingo games to sanity-check the rules engine, and to check the
// bots' calling beats picking numbers at random.
// Usage: node scripts/simulate-bingo.mjs [games=2000]
import { BingoGame } from '../src/bingo/engine.js';
import { BingoAI } from '../src/bingo/ai.js';
import * as R from '../src/bingo/rules.js';

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Calls any open number.
class RandomCaller extends BingoAI {
  async chooseCall(game) {
    const open = R.openNumbers(game.state.called);
    return open[Math.floor(this.rng() * open.length)];
  }
}

// Checks every answer before the engine applies it.
class Checked extends BingoAI {
  async chooseCall(game, me) {
    const n = await super.chooseCall(game, me);
    if (!R.validCall(n, game.state.called)) throw new Error(`${me.name} called ${n}`);
    return n;
  }
}

if (R.LINES.length !== 12 || new Set(R.LINES.flat()).size !== 25) throw new Error('lines are wrong');
const grid = Array.from({ length: 25 }, (_, i) => i + 1);
if (R.completedLines(grid, [1, 2, 3, 4, 5]).join() !== '0') throw new Error('row check');
if (R.completedLines(grid, [1, 7, 13, 19, 25, 5, 9, 17, 21]).join() !== '10,11') throw new Error('diagonal check');
if (R.validGrid([1, ...grid.slice(0, 24)]) || !R.validGrid(R.randomGrid())) throw new Error('validGrid');

const games = Number(process.argv[2] ?? 2000);
const stats = { calls: 0, shared: 0, smartWins: 0, smartSeats: 0, randomWins: 0, randomSeats: 0, longest: 0 };
for (let g = 0; g < games; g++) {
  const rng = mulberry32(g + 1);
  const n = 2 + (g % 4);
  // Seat 0 calls at random; the rest play to their lines.
  const players = Array.from({ length: n }, (_, i) => ({ name: `P${i}`, controller: i === 0 ? new RandomCaller({ rng }) : new Checked({ rng }) }));
  const game = new BingoGame({ players, rng });
  await game.run();
  const { state } = game;
  for (const p of state.players) {
    if (!R.validGrid(p.grid) || !p.ready) throw new Error('grid not set up');
    if (p.lines !== R.completedLines(p.grid, state.called).length) throw new Error('line count off');
  }
  if (new Set(state.called).size !== state.called.length) throw new Error('a number was called twice');
  if (!state.winners.length || state.winners.some((p) => p.lines < R.TO_WIN)) throw new Error('bad winner');
  stats.calls += state.called.length;
  stats.longest = Math.max(stats.longest, state.called.length);
  if (state.winners.length > 1) stats.shared++;
  const share = 1 / state.winners.length;
  for (const p of state.players) {
    const won = state.winners.includes(p) ? share : 0;
    if (p.id === 0) {
      stats.randomWins += won;
      stats.randomSeats++;
    } else {
      stats.smartWins += won;
      stats.smartSeats++;
    }
  }
}
const pct = (x) => `${(100 * x).toFixed(1)}%`;
console.log(`${games} games: ${(stats.calls / games).toFixed(1)} calls on average (longest ${stats.longest}), ${pct(stats.shared / games)} shared wins`);
console.log(`win share per seat: bots ${pct(stats.smartWins / stats.smartSeats)}, random caller ${pct(stats.randomWins / stats.randomSeats)}`);
if (stats.smartWins / stats.smartSeats <= stats.randomWins / stats.randomSeats) throw new Error('the bots do no better than calling at random');
console.log('OK');
