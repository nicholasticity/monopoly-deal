// The standard 52-card deck for Judgement. Aces are high (rank 14).

export const SUITS = {
  spades:   { name: 'Spades',   symbol: '♠', red: false },
  hearts:   { name: 'Hearts',   symbol: '♥', red: true },
  clubs:    { name: 'Clubs',    symbol: '♣', red: false },
  diamonds: { name: 'Diamonds', symbol: '♦', red: true },
};

// Alternating colours, so neighbouring suits in a sorted hand are easy to tell apart.
export const SUIT_ORDER = Object.keys(SUITS);

const RANK_NAMES = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
const RANK_LABELS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export const rankLabel = (rank) => RANK_LABELS[rank] ?? String(rank);

export function buildDeck() {
  const cards = [];
  let id = 1;
  for (const suit of SUIT_ORDER) {
    for (let rank = 2; rank <= 14; rank++) {
      cards.push({ id: id++, type: 'playing', key: `${suit}-${rank}`, suit, rank, name: `${RANK_NAMES[rank] ?? rank} of ${SUITS[suit].name}` });
    }
  }
  return cards;
}

// Short form for logs and prompts, e.g. "Q♥".
export function shortName(card) {
  return `${rankLabel(card.rank)}${SUITS[card.suit].symbol}`;
}
