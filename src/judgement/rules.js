// Judgement rules: dealing, bidding, following suit, trick winners and scoring.
import { SUIT_ORDER } from './cards.js';

export const DECK_SIZE = 52;
export const MIN_BID = 2;

// The whole deck is shared out evenly every round; the rest is set aside unseen.
export const cardsEach = (players) => Math.floor(DECK_SIZE / players);

// The den calls trumps after seeing only this many of their cards.
export const denSees = (handSize) => Math.floor(handSize / 2);

export const validBid = (bid, handSize) => Number.isInteger(bid) && bid >= MIN_BID && bid <= handSize;

export const ledSuit = (trick) => (trick.length ? trick[0].card.suit : null);

// Cards that may be played to the trick: follow the led suit if you can.
export function legalCards(hand, trick) {
  const led = ledSuit(trick);
  const follow = led ? hand.filter((c) => c.suit === led) : [];
  return follow.length ? follow : hand;
}

// The highest trump wins, otherwise the highest card of the led suit.
export function trickWinner(trick, trump) {
  let best = trick[0];
  for (const t of trick.slice(1)) {
    if (t.card.suit === best.card.suit ? t.card.rank > best.card.rank : t.card.suit === trump) best = t;
  }
  return best;
}

// Points for a round. Short of the bid loses 10 per trick bid; making it scores 10
// per trick bid plus 1 per extra trick, until the extras reach the bid, which loses
// all of that instead.
export function roundPoints(bid, won) {
  if (won < bid) return -10 * bid;
  const extra = won - bid;
  return extra < bid ? 10 * bid + extra : -(10 * bid + extra);
}

// 'short' (still under the bid), 'made' or 'bust' (too many extras).
export function bidState(bid, won) {
  if (bid == null || won < bid) return 'short';
  return won - bid < bid ? 'made' : 'bust';
}

// Hands sort by suit (trumps first once known), highest card first.
export function sortHand(hand, trump = null) {
  const start = trump ? SUIT_ORDER.indexOf(trump) : 0;
  const order = (s) => (SUIT_ORDER.indexOf(s) - start + SUIT_ORDER.length) % SUIT_ORDER.length;
  hand.sort((a, b) => order(a.suit) - order(b.suit) || b.rank - a.rank);
  return hand;
}

// The players holding no card of the trump suit; any at all means a fresh deal.
export const withoutTrumps = (players, trump) => players.filter((p) => !p.hand.some((c) => c.suit === trump));

export function topScore(players) {
  return Math.max(...players.map((p) => p.score));
}
