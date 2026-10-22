// Least Count rules: what cards are worth, what you may throw, and how a Show scores.
// Cards are the Call Bridge deck's (aces are rank 14 there, but count as 1 here and
// sit below the 2 in a run), plus two printed jokers per deck.
import { buildDeck as standardDeck, SUITS, rankLabel, SUIT_ORDER } from '../callbridge/cards.js';

// Cards dealt to each player.
export const HAND = 7;
// What calling Show costs if someone has as few points or fewer.
export const CAUGHT = 40;
// How many rounds a game is, and the usual.
export const ROUND_COUNTS = [5, 10, 15];
export const DEFAULT_ROUNDS = 10;
export const roundCount = (n) => (ROUND_COUNTS.includes(n) ? n : DEFAULT_ROUNDS);
// Bigger tables play with two decks.
export const decksFor = (players) => (players > 5 ? 2 : 1);

export function buildDeck(decks = 1) {
  const cards = [];
  let id = 1;
  for (let d = 0; d < decks; d++) {
    for (const c of standardDeck()) cards.push({ ...c, id: id++ });
    for (const color of ['red', 'black']) cards.push({ id: id++, type: 'playing', key: `joker-${color}`, suit: null, rank: 0, joker: color, name: 'Joker' });
  }
  return cards;
}

// Ace low: A = 1, 2–10 as marked, J 11, Q 12, K 13; a printed joker 0.
export const faceValue = (card) => (card.joker ? 0 : card.rank === 14 ? 1 : card.rank);
// Printed jokers, and every card of the round's wild rank, are worth nothing.
export const isZero = (card, wild) => !!card.joker || (wild != null && card.rank === wild);
export const value = (card, wild) => (isZero(card, wild) ? 0 : faceValue(card));
export const handTotal = (hand, wild) => hand.reduce((s, c) => s + value(c, wild), 0);

// What a throw is: one card ('single'); two or more of one rank ('set'); or three or more
// in a row in one suit, ace low ('run'), where printed jokers can stand in for any
// missing cards. null if it's none of those.
export function throwKind(cards) {
  if (!cards.length) return null;
  if (cards.length === 1) return 'single';
  const real = cards.filter((c) => !c.joker);
  const jokers = cards.length - real.length;
  if (!jokers && real.every((c) => c.rank === real[0].rank)) return 'set';
  if (!real.length) return 'set';
  if (cards.length < 3 || cards.length > 13 || !real.every((c) => c.suit === real[0].suit)) return null;
  const ranks = real.map(faceValue).sort((a, b) => a - b);
  if (new Set(ranks).size !== ranks.length) return null;
  const gaps = ranks.at(-1) - ranks[0] + 1 - ranks.length;
  return gaps <= jokers ? 'run' : null;
}

// A throw laid out for the table: a run in order with its jokers in the gaps (any left
// over at the ends), anything else as it is.
export function throwOrder(cards) {
  if (throwKind(cards) !== 'run') return cards.slice();
  const real = cards.filter((c) => !c.joker).sort((a, b) => faceValue(a) - faceValue(b));
  const jokers = cards.filter((c) => c.joker);
  const out = [];
  real.forEach((c, i) => {
    if (i) for (let v = faceValue(real[i - 1]) + 1; v < faceValue(c) && jokers.length; v++) out.push(jokers.shift());
    out.push(c);
  });
  // Spare jokers carry the run on upwards, or downwards once it's reached the King.
  let top = faceValue(real.at(-1));
  while (jokers.length) {
    if (top < 13) {
      out.push(jokers.shift());
      top++;
    } else out.unshift(jokers.shift());
  }
  return out;
}

// A hand in order: by suit, low to high, jokers last.
export function sortHand(hand) {
  return hand.sort((a, b) => (a.joker ? 1 : 0) - (b.joker ? 1 : 0) || SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit) || faceValue(a) - faceValue(b));
}

// A Show's points, given everyone's hand total: { [id]: points }. The caller scores 0 if
// they have strictly the fewest; if anyone has as few or fewer, the caller scores CAUGHT
// and they score 0. Everyone else scores their total.
export function showPoints(totals, callerId) {
  const mine = totals[callerId];
  const caught = Object.entries(totals).some(([id, t]) => Number(id) !== callerId && t <= mine);
  const points = {};
  for (const [id, t] of Object.entries(totals)) {
    const i = Number(id);
    points[i] = i === callerId ? (caught ? CAUGHT : 0) : caught && t <= mine ? 0 : t;
  }
  return { points, caught };
}

// Short form for logs, e.g. "Q♥", "Joker".
export const cardName = (card) => (card.joker ? 'Joker' : `${rankLabel(card.rank)}${SUITS[card.suit].symbol}`);
export const cardsName = (cards) => cards.map(cardName).join(' ');
// A rank in words, e.g. "7s", "Queens", for the wild card.
export const rankPlural = (rank) => ({ 11: 'Jacks', 12: 'Queens', 13: 'Kings', 14: 'Aces' })[rank] ?? `${rank}s`;
