// How Call Bridge's and Judgement's cards look on this screen. The suits are the same underneath
// (the rules, bots and server only know spades, hearts, clubs and diamonds); a
// style changes their names, symbols and colours (and the face cards' names) here, so online each player sees
// the deck they picked. Colours are in textures.js and style.css, by suit key.
import { SUITS } from '../callbridge/cards.js';

export const DECK_STYLES = {
  classic: {
    name: 'Classic',
    suits: {
      spades: { ...SUITS.spades, one: 'Spade' },
      hearts: { ...SUITS.hearts, one: 'Heart' },
      clubs: { ...SUITS.clubs, one: 'Club' },
      diamonds: { ...SUITS.diamonds, one: 'Diamond' },
    },
    ranks: { 11: ['J', 'Jack'], 12: ['Q', 'Queen'], 13: ['K', 'King'], 14: ['A', 'Ace'] },
  },
  fantasy: {
    name: 'Fantasy',
    suits: {
      spades: { name: 'Moons', one: 'Moon', symbol: '☾' },
      hearts: { name: 'Suns', one: 'Sun', symbol: '☀' },
      clubs: { name: 'Clovers', one: 'Clover', symbol: '☘' },
      diamonds: { name: 'Stars', one: 'Star', symbol: '★' },
    },
    // Each a step up in power, with its own letter.
    ranks: { 11: ['E', 'Elf'], 12: ['W', 'Wizard'], 13: ['D', 'Dragon'], 14: ['P', 'Phoenix'] },
  },
};

const KEY = 'md-deck';
let current = DECK_STYLES[globalThis.localStorage?.getItem(KEY)] ? localStorage.getItem(KEY) : 'classic';
document.documentElement.classList.toggle('deck-fantasy', current === 'fantasy');

export const deckStyle = () => current;

export function setDeckStyle(style) {
  if (!DECK_STYLES[style]) return;
  current = style;
  localStorage.setItem(KEY, style);
  document.documentElement.classList.toggle('deck-fantasy', style === 'fantasy');
}

// A suit's name, singular and symbol in the current style: { name, one, symbol }.
export const suitLook = (key) => DECK_STYLES[current].suits[key];

// A rank's corner letter (or number) and name in the current style: 'W', 'Wizard'.
export const rankText = (rank) => DECK_STYLES[current].ranks[rank]?.[0] ?? String(rank);
export const rankName = (rank) => DECK_STYLES[current].ranks[rank]?.[1] ?? String(rank);

// Game text (logs, toasts) is written with the classic suits, by the server when
// online; this puts it in the current style.
const CLASSIC = Object.entries(DECK_STYLES.classic.suits);
const SYMBOLS = CLASSIC.map(([, s]) => s.symbol).join('');
const LETTERS = Object.fromEntries(Object.entries(DECK_STYLES.classic.ranks).map(([rank, [letter]]) => [letter, Number(rank)]));
export function restyle(text) {
  if (current === 'classic') return text;
  // A card's short name first ("Q♥"), while its suit is still the classic one.
  text = text.replace(new RegExp(`\\b([JQKA])(?=[${SYMBOLS}])`, 'g'), (letter) => rankText(LETTERS[letter]));
  for (const [key, s] of CLASSIC) {
    const look = suitLook(key);
    text = text.replaceAll(s.symbol, look.symbol).replace(new RegExp(`\\b${s.name}\\b`, 'g'), look.name);
  }
  return text;
}
