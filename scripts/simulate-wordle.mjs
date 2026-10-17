// Checks Wordle's marking and word lists, how well the bots guess (every secret
// word), and runs whole headless races between bots to sanity-check the engine.
// Usage: node scripts/simulate-wordle.mjs [games=40]
import { WordleGame } from '../src/wordle/engine.js';
import { WordleAI, pickGuess } from '../src/wordle/ai.js';
import { ANSWERS } from '../src/wordle/answers.js';
import { GUESSES } from '../src/wordle/guesses.js';
import * as R from '../src/wordle/rules.js';

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const fail = (msg) => {
  throw new Error(msg);
};

// Marking, repeated letters included.
for (const [guess, answer, want] of [
  ['crane', 'crane', 'ggggg'],
  ['speed', 'abide', 'bbyby'],
  ['allee', 'eagle', 'yybyg'],
  ['geese', 'these', 'bbggg'],
  ['llama', 'hello', 'yybbb'],
  ['vivid', 'civic', 'bgggb'],
]) {
  if (R.mark(guess, answer) !== want) fail(`${guess} vs ${answer}: ${R.mark(guess, answer)}, not ${want}`);
}
const marks = R.letterMarks([{ word: 'crane', mark: 'bybbg' }, { word: 'arise', mark: 'ggbbg' }]);
if (marks.a !== 'g' || marks.r !== 'g' || marks.c !== 'b' || marks.e !== 'g') fail('keyboard marks');

// The word lists.
if (new Set(ANSWERS).size !== ANSWERS.length) fail('a secret word is listed twice');
for (const w of [...ANSWERS, ...GUESSES]) if (!/^[a-z]{5}$/.test(w)) fail(`bad word ${w}`);
if (GUESSES.some((w) => ANSWERS.includes(w))) fail('guesses.js repeats a secret word');
if (!R.isWord('crane') || R.isWord('zzzzz') || R.isWord('CRANE') || R.isWord(null)) fail('isWord');
for (let i = 0; i < 20; i++) if (!R.isWord(pickGuess([], Math.random))) fail('an opener is not a word');
console.log(`${ANSWERS.length} secret words, ${ANSWERS.length + GUESSES.length} accepted guesses`);

// How many guesses a bot takes, over every secret word.
const rng = mulberry32(7);
const tries = [];
for (const answer of ANSWERS) {
  const guesses = [];
  while (guesses.at(-1)?.mark !== R.SOLVED && guesses.length < 12) {
    const word = pickGuess(guesses, rng);
    if (!R.isWord(word)) fail(`the bot guessed ${word}`);
    guesses.push({ word, mark: R.mark(word, answer) });
  }
  tries.push(guesses.length);
}
const avg = tries.reduce((a, b) => a + b, 0) / tries.length;
const within = tries.filter((n) => n <= R.MAX_GUESSES).length / tries.length;
const pct = (x) => `${(100 * x).toFixed(1)}%`;
console.log(`bots: ${avg.toFixed(2)} guesses on average, ${pct(within)} solved within ${R.MAX_GUESSES}`);
if (avg < 3 || avg > 5.2 || within < 0.85) fail('the bots guess too well or too badly');

// Never answers: the word has to close on its timer.
class Silent {
  chooseGuess() {
    return new Promise(() => {});
  }
}

// Whole games. Bots think a few milliseconds a guess, so the races are real.
const games = Number(process.argv[2] ?? 40);
const stats = { words: 0, solved: 0, timedOut: 0, stopped: 0 };
for (let g = 0; g < games; g++) {
  const rng = mulberry32(g + 1);
  const n = 2 + (g % 4);
  const silent = g % 10 === 9;
  const players = Array.from({ length: n }, (_, i) => {
    const bot = new WordleAI({ delay: 1, rng });
    const controller = silent ? new Silent() : bot;
    // Count the stopGuess calls at the end of each word.
    controller.stopGuess = () => stats.stopped++;
    return { name: `P${i}`, controller };
  });
  const words = R.WORD_COUNTS[g % R.WORD_COUNTS.length];
  const game = new WordleGame({ players, rng, words, roundMs: silent ? 30 : 5000 });
  await game.run();
  const { state } = game;
  if (state.history.length !== words || state.round !== words) fail('wrong number of words');
  if (new Set(state.history.map((h) => h.word)).size !== words) fail('a word came up twice');
  for (const h of state.history) {
    stats.words++;
    if (h.winner == null) {
      if (silent) stats.timedOut++;
      continue;
    }
    stats.solved++;
    if (!(h.tries[h.winner] >= 1 && h.tries[h.winner] <= R.MAX_GUESSES)) fail('a winner took too many guesses');
  }
  for (const p of state.players) {
    if (p.score !== state.history.filter((h) => h.winner === p.id).length) fail('score off');
    if (p.guesses.length > R.MAX_GUESSES) fail('too many guesses');
    for (const x of p.guesses) if (x.mark !== R.mark(x.word, state.answer)) fail('a guess was marked wrong');
  }
  const best = Math.max(...state.players.map((p) => p.score));
  if (!state.winners.length || state.winners.some((p) => p.score !== best)) fail('bad winner');
  if (silent && state.history.some((h) => h.winner != null)) fail('a silent player scored');
}
if (stats.stopped !== players(games)) fail(`stopGuess was called ${stats.stopped} times`);
console.log(`${games} games, ${stats.words} words: ${pct(stats.solved / stats.words)} solved by someone, ${stats.timedOut} closed on the clock`);

// On your own with no clock: a slow player still gets every guess (a word only ends
// when it's solved or the guesses run out), and no word has a closing time.
class Slow {
  constructor() {
    this.bot = new WordleAI({ rng: mulberry32(7) });
  }

  // Misses the first word on purpose (always a wrong word), then plays it straight.
  async chooseGuess(game, me) {
    await new Promise((r) => setTimeout(r, 40));
    if (game.state.round === 1) return game.state.answer === 'crane' ? 'slate' : 'crane';
    return this.bot.chooseGuess(game, me);
  }
}
const solo = new WordleGame({ players: [{ name: 'You', controller: new Slow() }], rng: mulberry32(99), words: 5, roundMs: 0 });
const closing = [];
// Each word's end: was it solved, and how many guesses had been made.
const ends = [];
solo.on((type) => {
  if (type !== 'state') return;
  const { phase, endsAt, players: [me] } = solo.state;
  if (phase === 'guess') closing.push(endsAt);
  if (phase === 'reveal' && ends.length < solo.state.history.length) ends.push({ solved: me.solved, guesses: me.guesses.length });
});
await solo.run();
if (closing.some((t) => t !== 0)) fail('a word on your own had a clock');
if (ends.length !== 5 || solo.state.winners[0] !== solo.state.players[0]) fail('solo game went wrong');
if (ends.some((e) => !e.solved && e.guesses !== R.MAX_GUESSES)) fail('a word on your own ended before the guesses ran out');
const missed = ends.filter((e) => !e.solved).length;
console.log(`on your own, untimed: ${solo.state.players[0].score} of 5 words, ${missed} missed after all ${R.MAX_GUESSES} guesses`);
console.log('OK');

// stopGuess calls expected: one per player per word.
function players(count) {
  let total = 0;
  for (let g = 0; g < count; g++) total += (2 + (g % 4)) * R.WORD_COUNTS[g % R.WORD_COUNTS.length];
  return total;
}
