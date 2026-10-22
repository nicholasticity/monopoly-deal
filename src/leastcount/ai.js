// Computer opponents for Least Count. On its turn a bot calls Show when its hand is
// low for how few cards the others hold (fewer cards, fewer points: the riskier a Show).
// Otherwise it looks at every throw it could make (a card, a set, a run) and every card
// it could take after it, and picks the one that leaves its hand lowest, counting a card
// from the deck at an average value, and a card that pairs with one it keeps a little
// lower (it can throw them together later).
import { faceValue, handTotal, throwKind, value, isZero } from './rules.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// What a card from the deck is worth on average (with the jokers and the wild rank at 0).
const DECK_GUESS = 6;

export class LeastCountAI {
  // delay: the bots' thinking time per decision (ms).
  constructor({ delay = 0, rng = Math.random } = {}) {
    this.delay = delay;
    this.rng = rng;
  }

  async chooseThrow(game, me) {
    if (this.delay) await sleep(this.delay * (1.4 + this.rng() * 1.6));
    return decideThrow(game, me, this.rng);
  }
}

// Every throw the hand can make: each card, each set (all of a rank you hold, and every
// pair or more of it), and each run in a suit, with printed jokers filling gaps.
export function throwOptions(hand) {
  const options = hand.map((c) => [c]);
  const real = hand.filter((c) => !c.joker);
  const jokers = hand.filter((c) => c.joker);
  const byRank = new Map();
  for (const c of real) byRank.set(c.rank, [...(byRank.get(c.rank) ?? []), c]);
  for (const group of byRank.values()) for (let k = 2; k <= group.length; k++) options.push(group.slice(0, k));
  const suits = new Map();
  for (const c of real) suits.set(c.suit, [...(suits.get(c.suit) ?? []), c]);
  for (const cards of suits.values()) {
    const sorted = [...cards].sort((a, b) => faceValue(a) - faceValue(b));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i; j < sorted.length; j++) {
        const part = sorted.slice(i, j + 1);
        if (new Set(part.map(faceValue)).size !== part.length) continue;
        const span = faceValue(sorted[j]) - faceValue(sorted[i]) + 1;
        const need = span - part.length + Math.max(0, 3 - span);
        if (need > jokers.length) continue;
        const run = [...part, ...jokers.slice(0, need)];
        if (throwKind(run) === 'run') options.push(run);
      }
    }
  }
  return options;
}

// How low a hand should be before a Show, given the fewest cards anyone else holds.
const showLimit = (fewest) => Math.min(10, 2.6 * fewest - 1.5);

export function decideThrow(game, me, rng = Math.random) {
  const { state } = game;
  const wild = state.wild;
  const total = handTotal(me.hand, wild);
  const others = state.players.filter((p) => p !== me);
  const fewest = Math.min(...others.map((p) => p.hand.length));
  if (total <= showLimit(fewest) + (rng() - 0.5) * 2 || total === 0) return { show: true };

  const takes = ['deck', ...(state.last?.cards ?? [])];
  let best = null;
  for (const option of throwOptions(me.hand)) {
    const thrown = option.reduce((s, c) => s + value(c, wild), 0);
    // Throwing away cards that are worth nothing gains nothing.
    if (!thrown && option.length < me.hand.length) continue;
    const kept = me.hand.filter((c) => !option.includes(c));
    const keptTotal = total - thrown;
    for (const take of takes) {
      let got;
      if (take === 'deck') got = DECK_GUESS;
      else {
        got = value(take, wild);
        // A card that pairs with one kept can go out with it later.
        if (got && !isZero(take, wild) && kept.some((c) => !c.joker && c.rank === take.rank)) got *= 0.4;
      }
      const score = keptTotal + got - option.length * 0.01 + rng() * 0.001;
      if (!best || score < best.score) best = { score, option, take };
    }
  }
  return { throw: best.option.map((c) => c.id), take: best.take === 'deck' ? 'deck' : best.take.id };
}
