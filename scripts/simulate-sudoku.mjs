// Plays many Sudoku races between bots, at full speed, to check the engine and the
// puzzles, and works out how long the bots would take at their real pace.
// Usage: node scripts/simulate-sudoku.mjs [games per level]
import { SudokuGame } from '../src/sudoku/engine.js';
import { SudokuAI, pickMove, thinkTime } from '../src/sudoku/ai.js';
import * as R from '../src/sudoku/rules.js';
import { botDelay } from '../src/game/settings.js';

const GAMES = Number(process.argv[2]) || 40;
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

// A bot that adds up the time it would have taken (ms), without waiting for it.
class TimedAI extends SudokuAI {
  constructor() {
    super();
    this.spent = 0;
  }

  async chooseMove(game, me) {
    const { puzzle, level } = game.state;
    const move = pickMove(puzzle, me.grid, this.solutionOf(puzzle), this.rng);
    if (!move) return null;
    this.spent += botDelay('sudoku') * thinkTime(level, move.options, this.rng);
    return { cell: move.cell, digit: move.digit };
  }
}

for (const level of Object.keys(R.LEVELS)) {
  let solved = 0;
  let outs = 0;
  let mistakes = 0;
  const times = [];
  const givens = [];
  for (let g = 0; g < GAMES; g++) {
    const players = [0, 1, 2].map((i) => ({ name: `Bot ${i}`, controller: new TimedAI() }));
    const game = new SudokuGame({ players, level });
    const w = await game.run();
    const { state } = game;
    givens.push(R.CELLS - state.empty);
    // The answer is a valid grid that fits the puzzle, and the grids only hold right numbers.
    if (state.solution.some((d, i) => state.puzzle[i] && state.puzzle[i] !== d)) fail('answer does not fit the puzzle');
    for (const unit of R.UNITS) if (new Set(unit.map((i) => state.solution[i])).size !== 9) fail('answer is not a valid grid');
    for (const p of state.players) {
      if (p.grid.some((d, i) => d && d !== state.solution[i])) fail('a wrong number went in');
      if (p.filled !== p.grid.filter(Boolean).length) fail('filled count is off');
      outs += p.done ? 1 : 0;
      mistakes += p.mistakes;
      // Each bot played on alone too: its whole time to fill the grid.
      if (!p.done) times.push(p.controller.spent);
    }
    if (w) {
      solved++;
      if (!w.solved || w.filled !== state.empty) fail('the winner did not fill the grid');
    }
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const min = (ms) => (ms / 60000).toFixed(1);
  console.log(
    `${level.padEnd(6)} givens ${Math.min(...givens)}-${Math.max(...givens)} · won ${solved}/${GAMES} · bots out ${((outs / (GAMES * 3)) * 100).toFixed(0)}% · ` +
      `${(mistakes / (GAMES * 3)).toFixed(2)} mistakes a bot · a bot's time when its race ended ~${min(avg(times))} min`,
  );
}

// A whole puzzle on its own, at a bot's pace: how long a bot takes to solve one.
for (const level of Object.keys(R.LEVELS)) {
  const times = [];
  for (let g = 0; g < GAMES; g++) {
    const { puzzle } = R.makePuzzle(level);
    const answer = R.solve(puzzle);
    const grid = Array(R.CELLS).fill(0);
    let ms = 0;
    for (let move; (move = pickMove(puzzle, grid, answer)); ) {
      ms += botDelay('sudoku') * thinkTime(level, move.options);
      if (move.digit === answer[move.cell]) grid[move.cell] = move.digit;
    }
    times.push(ms);
  }
  times.sort((a, b) => a - b);
  const q = (f) => (times[Math.floor(f * (times.length - 1))] / 60000).toFixed(1);
  console.log(`${level.padEnd(6)} a bot solving alone: fastest ${q(0)} · median ${q(0.5)} · slowest ${q(1)} min`);
}
console.log('PASS');
