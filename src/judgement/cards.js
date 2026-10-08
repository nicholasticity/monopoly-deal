// The standard 52-card deck for Judgement. Aces are high (rank 14).

// A four-colour deck (black spades, red hearts, green clubs, blue diamonds), so no two
// suits look alike. The colours are in textures.js and style.css, by suit name.
export const SUITS = {
  spades:   { name: 'Spades',   symbol: '♠' },
  hearts:   { name: 'Hearts',   symbol: '♥' },
  clubs:    { name: 'Clubs',    symbol: '♣' },
  diamonds: { name: 'Diamonds', symbol: '♦' },
};

// Each suit next to differently coloured ones in a sorted hand.
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
