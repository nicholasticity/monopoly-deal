// Settings shared by the browser and the multiplayer server.

// The games on offer. Each seats two to five players.
export const GAMES = {
  deal: { name: 'Monopoly Deal', tagline: 'Collect three full property sets of different colours to win.' },
  judgement: { name: 'Judgement', tagline: 'Bid the tricks you’ll take, then take at least that many — but not twice as many.' },
  bingo: { name: 'Bingo', tagline: 'Arrange 1–25 on your grid, take turns calling numbers, and be the first to cross off five lines.' },
  wordle: { name: 'Wordle', tagline: 'Everyone races to guess the same five-letter word. The first to get it scores a point.' },
};
export const DEFAULT_GAME = 'deal';

export const BOT_NAMES = ['Rich Uncle Pennybags', 'Lady Luck', 'The Baron', 'Madame Mortgage', 'Monty Mogul'];

// How fast every game goes. delay: AI thinking time per decision (ms); pace: multiplier
// on animation pauses (1 is the pauses as written in the engines). Wordle bots think
// slower (wordleDelay), at about a person's pace: some 50 s a word, so you can race them.
export const SPEED = { delay: 380, pace: 0.6, wordleDelay: 850 };

// A bot's thinking time per decision in this game (ms).
export const botDelay = (kind) => (kind === 'wordle' ? SPEED.wordleDelay : SPEED.delay);

// The table has room for five players.
export const MAX_PLAYERS = 5;

// Seconds an online player gets for each decision before a bot decides for them.
// Then Judgement's (calling trumps, bidding and playing a card) and Bingo's
// (arranging your grid and calling a number). A Wordle guess has as long as the word
// stays open (ROUND_SECONDS in wordle/rules.js); the word closes first.
export const TIMEOUTS = { turn: 90, payment: 45, justsayno: 30, discard: 45, trump: 45, bid: 45, play: 45, arrange: 60, call: 30, guess: 180 };
