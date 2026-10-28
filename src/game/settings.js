// Settings shared by the browser and the multiplayer server.

// The games on offer. Each seats two to five players against the computer, and up to
// eight in an online room.
export const GAMES = {
  deal: { name: 'Monopoly Deal', tagline: 'Collect three full property sets of different colours to win.' },
  callbridge: { name: 'Call Bridge', tagline: 'Bid the tricks you’ll take, then take at least that many — but not twice as many.' },
  judgement: { name: 'Judgement', tagline: 'Bid exactly the tricks you’ll take. Hands go from 7 cards down to 1 and back up.' },
  leastcount: { name: 'Least Count', tagline: 'Throw your high cards, keep the low ones, and call Show when your hand is the smallest.' },
  poker: { name: 'Poker', tagline: 'No-limit Texas Hold’em. Bet, raise or fold through the community cards; the last stack wins.' },
  bingo: { name: 'Bingo', tagline: 'Arrange 1–25 on your grid, take turns calling numbers, and be the first to cross off five lines.' },
  wordle: { name: 'Wordle', tagline: 'Everyone races to guess the same five-letter word. The first to get it scores a point.' },
  sudoku: { name: 'Sudoku', tagline: 'Fill the grid so every row, column and box has 1 to 9. Race the others on the same puzzle.' },
  // 8-ball: two players, or four as two teams.
  pool: { name: 'Pool', tagline: 'Eight-ball: pot all your solids or stripes, then sink the 8. One on one, or two against two.' },
};
export const DEFAULT_GAME = 'deal';

// The trick-taking games: Call Bridge and Judgement share a table, prompts and deck.
export const TRICK_GAMES = new Set(['callbridge', 'judgement']);
// The games played with the 52-card deck, in the deck style picked (classic or fantasy).
export const PLAYING_CARD_GAMES = new Set([...TRICK_GAMES, 'leastcount', 'poker']);

// Enough for a full online room (seven besides the host); solo play has up to four.
export const BOT_NAMES = ['Rich Uncle Pennybags', 'Lady Luck', 'The Baron', 'Madame Mortgage', 'Monty Mogul', 'Penny Profit', 'Captain Cash', 'Duke of Deeds'];

// How fast every game goes. delay: AI thinking time per decision (ms); pace: multiplier
// on animation pauses (1 is the pauses as written in the engines). Wordle bots think
// slower (wordleDelay), at about a person's pace: some 50 s a word, so you can race them.
// Sudoku bots too (sudokuDelay, a unit of their time per cell, src/sudoku/ai.js).
export const SPEED = { delay: 380, pace: 0.6, wordleDelay: 850, sudokuDelay: 1000 };

// A bot's thinking time per decision in this game (ms).
export const botDelay = (kind) => ({ wordle: SPEED.wordleDelay, sudoku: SPEED.sudokuDelay })[kind] ?? SPEED.delay;

// Pool's shots play out in real time, and Wordle's and Sudoku's pauses stay put: the
// speed's pace (shorter pauses) is for the other games.
export const paceFor = (kind) => (kind === 'wordle' || kind === 'pool' || kind === 'sudoku' ? 1 : SPEED.pace);

// Most seats a game has in an online room: pool is two players, or four as two teams.
export const maxFor = (kind) => (kind === 'pool' ? 4 : MAX_PLAYERS);

// Most players an online room seats (solo play has up to four bots, src/ui/hud.js).
export const MAX_PLAYERS = 8;

// Seconds an online player gets for each decision before a bot decides for them.
// Then Call Bridge's and Judgement's (calling trumps and bidding: 2 minutes; playing a
// card: 90 s), Bingo's
// (arranging your grid and calling a number). A Wordle guess has as long as the word
// stays open (ROUND_SECONDS in wordle/rules.js); the word closes first. A Sudoku player
// has five minutes for each number they put in (cell) before a bot fills in for them, and
// a Least Count player 45 s to throw (or call Show), and a Poker player 45 s to act.
export const TIMEOUTS = { turn: 90, payment: 45, justsayno: 30, discard: 45, trump: 120, bid: 120, play: 90, arrange: 60, call: 30, guess: 180, shot: 60, cell: 300, throw: 45, act: 45 };
