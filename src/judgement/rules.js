// Judgement rules (kard.games' Judgement, also known as Kachuful or Oh Hell): hands
// shrink from 7 cards to 1 and grow back, trumps go round the suits with a no-trump
// round, and you score only for taking exactly the tricks you bid. Following suit and
// trick winners are the same as Call Bridge's, so they come from there.
import { DECK_SIZE } from '../callbridge/rules.js';

export { ledSuit, legalCards, trickWinner, sortHand, topScore } from '../callbridge/rules.js';

// The biggest hand: 7 cards, fewer when there aren't enough to go round (8 players: 6).
export const startCards = (players) => Math.min(7, Math.floor(DECK_SIZE / players));

// Cards per round: down to 1, then back up. 7 cards: 7 6 5 4 3 2 1 2 3 4 5 6 7.
export function handSizes(players) {
  const top = startCards(players);
  const sizes = [];
  for (let n = top; n >= 1; n--) sizes.push(n);
  for (let n = 2; n <= top; n++) sizes.push(n);
  return sizes;
}

// Trumps each round, in turn: spades, diamonds, clubs, hearts, then none.
export const TRUMP_ORDER = ['spades', 'diamonds', 'clubs', 'hearts', null];
export const trumpFor = (round) => TRUMP_ORDER[(round - 1) % TRUMP_ORDER.length];

// The bid the last bidder (the dealer) may not make: bids can't add up to the number
// of tricks, so someone always misses. null when no bid is ruled out (it'd be over the
// hand size, or under 0).
export function forbiddenBid(others, handSize) {
  const bid = handSize - others;
  return bid >= 0 && bid <= handSize ? bid : null;
}

export const validBid = (bid, handSize, forbidden = null) =>
  Number.isInteger(bid) && bid >= 0 && bid <= handSize && bid !== forbidden;

// The three ways to score. Only an exact bid scores; "high" also takes points off for
// a miss. The default is high, as on kard.games.
export const SCORING = {
  high: { name: 'High', hint: 'Made: (bid + 1) × 10 + bid. Missed: the same, taken off.' },
  medium: { name: 'Medium', hint: 'Made: 10 × bid. Missed: 0.' },
  low: { name: 'Low', hint: 'Made: bid × 2 + 5. Missed: 0.' },
};
export const DEFAULT_SCORING = 'high';
export const scoringKey = (key) => (SCORING[key] ? key : DEFAULT_SCORING);

export function roundPoints(bid, won, scoring = DEFAULT_SCORING) {
  const made = won === bid;
  switch (scoring) {
    case 'medium':
      return made ? 10 * bid : 0;
    case 'low':
      return made ? 2 * bid + 5 : 0;
    default: {
      const points = (bid + 1) * 10 + bid;
      return made ? points : -points;
    }
  }
}

// 'short' (under the bid so far), 'made' (exactly it) or 'bust' (over it).
export function bidState(bid, won) {
  if (bid == null || won < bid) return 'short';
  return won === bid ? 'made' : 'bust';
}
