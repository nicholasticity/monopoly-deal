// Bingo rules: a 5×5 grid holding 1–25, the twelve lines through it, and B-I-N-G-O.

export const SIZE = 5;
export const NUMBERS = SIZE * SIZE;
export const LETTERS = ['B', 'I', 'N', 'G', 'O'];
// Lines (rows, columns, diagonals) a player needs to win.
export const TO_WIN = LETTERS.length;

// Each line as the grid positions (0-24, row by row) it runs through.
export const LINES = (() => {
  const all = [];
  const range = [...Array(SIZE).keys()];
  for (const r of range) all.push(range.map((c) => r * SIZE + c));
  for (const c of range) all.push(range.map((r) => r * SIZE + c));
  all.push(range.map((i) => i * SIZE + i));
  all.push(range.map((i) => i * SIZE + SIZE - 1 - i));
  return all;
})();

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const randomGrid = (rng = Math.random) => shuffle(Array.from({ length: NUMBERS }, (_, i) => i + 1), rng);

// Holds each of 1–25 exactly once.
export function validGrid(grid) {
  if (!Array.isArray(grid) || grid.length !== NUMBERS) return false;
  const seen = new Set(grid);
  return seen.size === NUMBERS && grid.every((n) => Number.isInteger(n) && n >= 1 && n <= NUMBERS);
}

export const validCall = (n, called) => Number.isInteger(n) && n >= 1 && n <= NUMBERS && !called.includes(n);

export const openNumbers = (called) => Array.from({ length: NUMBERS }, (_, i) => i + 1).filter((n) => !called.includes(n));

// Indexes into LINES of the lines with every number called.
export function completedLines(grid, called) {
  if (!grid) return [];
  const crossed = new Set(called);
  return LINES.flatMap((line, i) => (line.every((pos) => crossed.has(grid[pos])) ? [i] : []));
}

// The lines that count: B-I-N-G-O stops at five.
export const letters = (lines) => Math.min(lines, TO_WIN);
