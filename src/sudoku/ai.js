// Computer opponents for Sudoku. A bot works the way a person does: it looks for the
// cell with the fewest numbers left (often just one) and fills that in, taking a
// person's time over each, longer on harder puzzles. Now and then, on a cell with a
// choice, it guesses wrong and makes a mistake.
import { CELLS, candidates, digitsOf, solve } from './rules.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Thinking time per cell, in multiples of the bot's delay (Sudoku's bot pace, 1 s): an
// unhurried player's pace, some 6 minutes for an easy puzzle, 10 for a medium and 16 for a hard one.
const PACE = { easy: 10, medium: 14, hard: 20 };
// How often a bot gets a cell with a choice wrong.
const SLIP = 0.04;

export class SudokuAI {
  // delay: the bots' thinking time unit (ms); a cell takes several of those.
  constructor({ delay = 0, rng = Math.random } = {}) {
    this.delay = delay;
    this.rng = rng;
    this.answer = null;
    this.answerFor = null;
  }

  async chooseMove(game, me) {
    const { puzzle, level } = game.state;
    const move = pickMove(puzzle, me.grid, this.solutionOf(puzzle), this.rng);
    if (!move) return null;
    // Even with no thinking time (tests), wait a tick: a bot fills dozens of cells, and
    // the other players' moves (from their sockets) must get a look in.
    await sleep(this.delay * thinkTime(level, move.options, this.rng));
    return { cell: move.cell, digit: move.digit };
  }

  // The bot works the answer out once a puzzle (it can see the puzzle, as everyone can).
  solutionOf(puzzle) {
    const key = puzzle.join('');
    if (this.answerFor !== key) {
      this.answerFor = key;
      this.answer = solve(puzzle);
    }
    return this.answer;
  }
}

// How long a cell takes, in delay units: longer on harder puzzles, and for cells with
// more numbers left to rule out.
export const thinkTime = (level, options, rng = Math.random) => (PACE[level] ?? PACE.medium) * (0.4 + rng() * 0.9) * (0.7 + 0.3 * options);

// The next cell to fill: one of those with the fewest numbers left, and its number (now
// and then a wrong one, where there's a choice). { cell, digit, options } or null.
export function pickMove(puzzle, grid, answer, rng = Math.random) {
  if (!answer) return null;
  const board = puzzle.map((d, i) => d || grid[i]);
  let fewest = 10;
  let cells = [];
  for (let i = 0; i < CELLS; i++) {
    if (board[i]) continue;
    const n = digitsOf(candidates(board, i)).length;
    if (n < fewest) {
      fewest = n;
      cells = [i];
    } else if (n === fewest) cells.push(i);
  }
  if (!cells.length) return null;
  const cell = cells[Math.floor(rng() * cells.length)];
  const right = answer[cell];
  const wrong = digitsOf(candidates(board, cell)).filter((d) => d !== right);
  const digit = wrong.length && rng() < SLIP ? wrong[Math.floor(rng() * wrong.length)] : right;
  return { cell, digit, options: Math.max(1, fewest) };
}
