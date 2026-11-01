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
  // Suits are a colour and nothing else. Ranks keep the same order, with letters
  // for the face cards: D (jack), C (queen), B (king), A (ace, still highest).
  // ink/wash are the card face (dark ink on a pale ground). mark is the same suit
  // on a dark ground, where near-black would disappear: the black suit reads white.
  colours: {
    name: 'Colours',
    swatch: true,
    suits: {
      spades: { name: 'Blacks', one: 'Black', symbol: '●', ink: '#141414', wash: '#f2f2f3', mark: '#f4f4f5' },
      hearts: { name: 'Reds', one: 'Red', symbol: '●', ink: '#E10600', wash: '#ffe9e8', mark: '#ff3b30' },
      clubs: { name: 'Greens', one: 'Green', symbol: '●', ink: '#128A22', wash: '#e5f8ea', mark: '#3ddc6a' },
      diamonds: { name: 'Blues', one: 'Blue', symbol: '●', ink: '#0D6EFD', wash: '#e6f0ff', mark: '#4da3ff' },
    },
    ranks: { 11: ['D', 'D'], 12: ['C', 'C'], 13: ['B', 'B'], 14: ['A', 'A'] },
    words: { Jack: 'D', Jacks: 'Ds', Queen: 'C', Queens: 'Cs', King: 'B', Kings: 'Bs', Ace: 'A', Aces: 'As' },
  },
};

const KEY = 'md-deck';
let current = DECK_STYLES[globalThis.localStorage?.getItem(KEY)] ? localStorage.getItem(KEY) : 'classic';

function paintDeckClass() {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  for (const key of Object.keys(DECK_STYLES)) root.classList.toggle(`deck-${key}`, current === key);
}
paintDeckClass();

export const deckStyle = () => current;

export function setDeckStyle(style) {
  if (!DECK_STYLES[style]) return;
  current = style;
  globalThis.localStorage?.setItem(KEY, style);
  paintDeckClass();
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
  if (current === 'classic' || text == null) return text;
  const style = DECK_STYLES[current];
  // A card's short name first ("Q♥"), while its suit is still the classic one.
  text = String(text).replace(new RegExp(`\\b([JQKA])(?=[${SYMBOLS}])`, 'g'), (letter) => rankText(LETTERS[letter]));
  for (const [key, s] of CLASSIC) {
    const look = suitLook(key);
    if (style.swatch) {
      // Plain text can't carry a coloured dot, so the glyph becomes the colour's name.
      text = text.replace(new RegExp(`${s.symbol}\\s*(?:${s.name}|${s.one})\\b`, 'g'), look.name);
      text = text.replaceAll(s.symbol, ` ${look.one}`);
    } else {
      text = text.replaceAll(s.symbol, look.symbol);
    }
    text = text.replace(new RegExp(`\\b${s.name}\\b`, 'g'), look.name);
  }
  if (style.words) {
    for (const [from, to] of Object.entries(style.words)) {
      text = text.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
    }
  }
  return style.swatch ? text.replace(/[ \t]{2,}/g, ' ') : text;
}
