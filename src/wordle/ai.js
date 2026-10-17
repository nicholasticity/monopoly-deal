// Computer opponents for Wordle. A bot opens with a common starting word, then
// guesses a word that fits every mark so far, much as a good player does. Like a
// person, it doesn't only think of the common words the answer comes from: now and
// then it tries a rarer word that fits. It also takes a person's time over each
// guess, so humans can win the race.
import { ANSWERS } from './answers.js';
import { GUESSES } from './guesses.js';
import { fits } from './rules.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OPENERS = ['crane', 'slate', 'trace', 'stare', 'raise', 'arise', 'later', 'alert', 'roast', 'least', 'react', 'learn', 'heart', 'audio', 'adieu', 'stone'];
// How often a bot reaches for any word that fits, not just a common one.
const RARE = 0.6;

export class WordleAI {
  // delay: the bots' thinking time per decision (ms); a guess takes several of those.
  constructor({ delay = 0, rng = Math.random } = {}) {
    this.delay = delay;
    this.rng = rng;
  }

  async chooseGuess(game, me) {
    const first = !me.guesses.length;
    // At Wordle's bot pace (850 ms): a few seconds for the opener, 9–22 s for each guess after it.
    if (this.delay) await sleep(this.delay * (first ? 3 + this.rng() * 4 : 10 + this.rng() * 16));
    return pickGuess(me.guesses, this.rng);
  }
}

export function pickGuess(guesses, rng = Math.random) {
  const pick = (list) => list[Math.floor(rng() * list.length)];
  if (!guesses.length) return pick(OPENERS);
  const tried = new Set(guesses.map((g) => g.word));
  const common = ANSWERS.filter((w) => !tried.has(w) && fits(w, guesses));
  if (common.length > 1 && rng() < RARE) {
    const rare = GUESSES.filter((w) => !tried.has(w) && fits(w, guesses));
    if (rare.length) return pick(rare);
  }
  return common.length ? pick(common) : pick(ANSWERS.filter((w) => !tried.has(w)));
}
