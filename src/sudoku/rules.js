// Sudoku rules: a 9×9 grid of nine 3×3 boxes, where every row, column and box holds
// 1–9 once each. Cells are numbered 0–80 along the rows; 0 is an empty cell. Also the
// puzzle maker: a full grid, then numbers taken away (in pairs, mirrored through the
// centre, as printed puzzles do) for as long as the puzzle still has just one answer.

export const CELLS = 81;
// How hard a puzzle is: how many numbers it starts with, and whether it can be solved
// one number at a time by looking for the only place (or the only number) left.
export const LEVELS = {
  easy: { name: 'Easy', givens: 38, singles: true, hint: 'Plenty of numbers to start with.' },
  medium: { name: 'Medium', givens: 30, singles: true, hint: 'Fewer numbers, but each one can still be found by looking.' },
  hard: { name: 'Hard', givens: 25, singles: false, hint: 'As few numbers as it takes: some need thinking ahead.' },
};
export const DEFAULT_LEVEL = 'medium';
export const levelOf = (key) => (LEVELS[key] ? key : DEFAULT_LEVEL);
// Wrong numbers each player may make in a race before they're out of it.
export const MAX_MISTAKES = 3;

export const rowOf = (i) => Math.floor(i / 9);
export const colOf = (i) => i % 9;
export const boxOf = (i) => 3 * Math.floor(rowOf(i) / 3) + Math.floor(colOf(i) / 3);

// The cells in each row, column and box ("units"), and the 20 cells that share one with each cell.
export const UNITS = [
  ...Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => r * 9 + c)),
  ...Array.from({ length: 9 }, (_, c) => Array.from({ length: 9 }, (_, r) => r * 9 + c)),
  ...Array.from({ length: 9 }, (_, b) => Array.from({ length: 9 }, (_, k) => (3 * Math.floor(b / 3) + Math.floor(k / 3)) * 9 + 3 * (b % 3) + (k % 3))),
];
export const PEERS = Array.from({ length: CELLS }, (_, i) => {
  const peers = new Set();
  for (const unit of UNITS) if (unit.includes(i)) for (const j of unit) if (j !== i) peers.add(j);
  return [...peers];
});

const bits = (mask) => {
  let n = 0;
  for (let m = mask; m; m &= m - 1) n++;
  return n;
};
export const digitsOf = (mask) => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => mask & (1 << d));

// The numbers cell i could still take (a bit mask: bit d for number d).
export function candidates(grid, i) {
  let used = 0;
  for (const j of PEERS[i]) used |= 1 << grid[j];
  return ~used & 0x3fe;
}

// Fills the empty cells of `grid` (in place) with the first answer found, trying numbers
// in the order `order` gives. The cell with the fewest options goes first. Returns
// how many answers there are, stopping at `limit`; with limit 1 the grid keeps the answer.
function search(grid, limit, order) {
  let best = -1;
  let bestMask = 0;
  let fewest = 10;
  for (let i = 0; i < CELLS; i++) {
    if (grid[i]) continue;
    const mask = candidates(grid, i);
    const n = bits(mask);
    if (!n) return 0;
    if (n < fewest) {
      fewest = n;
      best = i;
      bestMask = mask;
      if (n === 1) break;
    }
  }
  if (best < 0) return 1;
  let count = 0;
  for (const d of order()) {
    if (!(bestMask & (1 << d))) continue;
    grid[best] = d;
    count += search(grid, limit - count, order);
    if (count >= limit) return count;
    grid[best] = 0;
  }
  return count;
}

const ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// How many answers a puzzle has (0, 1, or 2 meaning "more than one").
export function countSolutions(puzzle) {
  return search(puzzle.slice(), 2, () => ORDER);
}

// The puzzle's answer, or null if it has none.
export function solve(puzzle) {
  const grid = puzzle.slice();
  return search(grid, 1, () => ORDER) ? grid : null;
}

function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A full, random, valid grid.
export function fullGrid(rng = Math.random) {
  const grid = Array(CELLS).fill(0);
  search(grid, 1, () => shuffled(ORDER, rng));
  return grid;
}

// Can the puzzle be solved one number at a time: a cell with only one number left, or
// a number with only one cell left in a row, column or box? Returns the cells filled
// that way (the whole puzzle, if it can).
export function fillSingles(puzzle) {
  const grid = puzzle.slice();
  for (let progress = true; progress; ) {
    progress = false;
    for (let i = 0; i < CELLS; i++) {
      if (grid[i]) continue;
      const mask = candidates(grid, i);
      if (bits(mask) === 1) {
        grid[i] = digitsOf(mask)[0];
        progress = true;
      }
    }
    for (const unit of UNITS) {
      for (let d = 1; d <= 9; d++) {
        if (unit.some((i) => grid[i] === d)) continue;
        const spots = unit.filter((i) => !grid[i] && candidates(grid, i) & (1 << d));
        if (spots.length === 1) {
          grid[spots[0]] = d;
          progress = true;
        }
      }
    }
  }
  return grid;
}

export const isFull = (grid) => grid.every(Boolean);

// A puzzle of this level and its answer: { puzzle, solution, givens }. A number only
// comes off if the puzzle keeps one answer (and, for the easier levels, can still be
// solved one number at a time), so every puzzle is fair; a few tries find one with
// about as few numbers as the level wants.
export function makePuzzle(level = DEFAULT_LEVEL, rng = Math.random) {
  const { givens, singles } = LEVELS[levelOf(level)];
  // Solvable one number at a time means one answer too, and is quicker to check.
  const fair = (puzzle) => (singles ? isFull(fillSingles(puzzle)) : countSolutions(puzzle) === 1);
  let best = null;
  for (let attempt = 0; attempt < 8 && !(best && best.givens <= givens); attempt++) {
    const solution = fullGrid(rng);
    const puzzle = solution.slice();
    let left = CELLS;
    for (const i of shuffled([...Array(41).keys()], rng)) {
      if (left <= givens) break;
      const pair = i === 40 ? [40] : [i, 80 - i];
      const saved = pair.map((j) => puzzle[j]);
      for (const j of pair) puzzle[j] = 0;
      if (fair(puzzle)) left -= pair.length;
      else pair.forEach((j, k) => (puzzle[j] = saved[k]));
    }
    if (!best || left < best.givens) best = { puzzle, solution, givens: left };
  }
  return best;
}
