// Settings shared by the browser and the multiplayer server.

// The games on offer. Each seats two to five players against the computer, and up to
// eight in an online room.
export const GAMES = {
  deal: { name: 'Monopoly Deal', tagline: 'Collect three full property sets of different colours to win.' },
  callbridge: { name: 'Call Bridge', tagline: 'Bid the tricks you’ll take, then take at least that many — but not twice as many.' },
  judgement: { name: 'Judgement', tagline: 'Bid exactly the tricks you’ll take. Hands go from 7 cards down to 1 and back up.' },
  bingo: { name: 'Bingo', tagline: 'Arrange 1–25 on your grid, take turns calling numbers, and be the first to cross off five lines.' },
  wordle: { name: 'Wordle', tagline: 'Everyone races to guess the same five-letter word. The first to get it scores a point.' },
  // 8-ball: two players, or four as two teams.
  pool: { name: 'Pool', tagline: 'Eight-ball: pot all your solids or stripes, then sink the 8. One on one, or two against two.' },
};
export const DEFAULT_GAME = 'deal';

// The trick-taking games: Call Bridge and Judgement share a table, prompts and deck.
export const TRICK_GAMES = new Set(['callbridge', 'judgement']);

// Enough for a full online room (seven besides the host); solo play has up to four.
export const BOT_NAMES = ['Rich Uncle Pennybags', 'Lady Luck', 'The Baron', 'Madame Mortgage', 'Monty Mogul', 'Penny Profit', 'Captain Cash', 'Duke of Deeds'];

// How fast every game goes. delay: AI thinking time per decision (ms); pace: multiplier
// on animation pauses (1 is the pauses as written in the engines). Wordle bots think
// slower (wordleDelay), at about a person's pace: some 50 s a word, so you can race them.
export const SPEED = { delay: 380, pace: 0.6, wordleDelay: 850 };

// A bot's thinking time per decision in this game (ms).
export const botDelay = (kind) => (kind === 'wordle' ? SPEED.wordleDelay : SPEED.delay);

// Pool's shots play out in real time, and Wordle's pauses stay put: the speed's pace
// (shorter pauses) is for the other games.
export const paceFor = (kind) => (kind === 'wordle' || kind === 'pool' ? 1 : SPEED.pace);

// Most seats a game has in an online room: pool is two players, or four as two teams.
export const maxFor = (kind) => (kind === 'pool' ? 4 : MAX_PLAYERS);

// Most players an online room seats (solo play has up to four bots, src/ui/hud.js).
export const MAX_PLAYERS = 8;

// Seconds an online player gets for each decision before a bot decides for them.
// Then Call Bridge's and Judgement's (calling trumps, bidding and playing a card), Bingo's
// (arranging your grid and calling a number). A Wordle guess has as long as the word
// stays open (ROUND_SECONDS in wordle/rules.js); the word closes first.
export const TIMEOUTS = { turn: 90, payment: 45, justsayno: 30, discard: 45, trump: 45, bid: 45, play: 45, arrange: 60, call: 30, guess: 180, shot: 60 };
