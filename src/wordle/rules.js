// Wordle rules: five-letter words, six guesses each, and how a guess is marked.
// A mark is a string with one letter per square: g (right letter, right place),
// y (in the word, somewhere else) or b (not in the word, or not that many times).
import { ANSWERS } from './answers.js';
import { GUESSES } from './guesses.js';

export const LENGTH = 5;
export const MAX_GUESSES = 6;
export const SOLVED = 'g'.repeat(LENGTH);
// How many words a game can be, and the usual.
export const WORD_COUNTS = [5, 10, 20];
export const DEFAULT_WORDS = 10;
// Longest a word stays open if nobody gets it (seconds).
export const ROUND_SECONDS = 180;

const VALID = new Set([...ANSWERS, ...GUESSES]);

export const wordCount = (n) => (WORD_COUNTS.includes(n) ? n : DEFAULT_WORDS);

export const isWord = (w) => typeof w === 'string' && VALID.has(w);

// Marks `guess` against `answer`. Greens first, so a repeated letter only lights as
// often as the answer has it: SPEED against ABIDE is b b y b y.
export function mark(guess, answer) {
  const out = Array(LENGTH).fill('b');
  const left = {};
  for (let i = 0; i < LENGTH; i++) {
    if (guess[i] === answer[i]) out[i] = 'g';
    else left[answer[i]] = (left[answer[i]] ?? 0) + 1;
  }
  for (let i = 0; i < LENGTH; i++) {
    if (out[i] === 'g' || !left[guess[i]]) continue;
    out[i] = 'y';
    left[guess[i]]--;
  }
  return out.join('');
}

// Could `word` be the answer, given these guesses and their marks?
export const fits = (word, guesses) => guesses.every((g) => mark(g.word, word) === g.mark);

// The best each letter has done in these guesses, for the keyboard: { a: 'g', … }.
export function letterMarks(guesses) {
  const rank = { b: 0, y: 1, g: 2 };
  const best = {};
  for (const { word, mark: m } of guesses) {
    if (!word) continue;
    for (let i = 0; i < LENGTH; i++) {
      const c = word[i];
      if (best[c] == null || rank[m[i]] > rank[best[c]]) best[c] = m[i];
    }
  }
  return best;
}

// A secret word not used yet this game.
export function pickAnswer(used, rng = Math.random) {
  const open = ANSWERS.filter((w) => !used.has(w));
  const pool = open.length ? open : ANSWERS;
  return pool[Math.floor(rng() * pool.length)];
}
