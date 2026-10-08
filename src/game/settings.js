// Settings shared by the browser and the multiplayer server.

// The games on offer. Both seat two to five players.
export const GAMES = {
  deal: { name: 'Monopoly Deal', tagline: 'Collect three full property sets of different colours to win.' },
  judgement: { name: 'Judgement', tagline: 'Bid the tricks you’ll take, then take at least that many — but not twice as many.' },
};
export const DEFAULT_GAME = 'deal';

export const BOT_NAMES = ['Rich Uncle Pennybags', 'Lady Luck', 'The Baron', 'Madame Mortgage', 'Monty Mogul'];

// delay: AI thinking time per decision (ms); pace: multiplier on animation pauses.
export const SPEEDS = {
  slow: { delay: 1300, pace: 1.35 },
  normal: { delay: 850, pace: 1 },
  fast: { delay: 380, pace: 0.6 },
};

// The table has room for five players.
export const MAX_PLAYERS = 5;

// Seconds an online player gets for each decision before a bot decides for them.
// The last three are Judgement's: calling trumps, bidding and playing a card.
export const TIMEOUTS = { turn: 90, payment: 45, justsayno: 30, discard: 45, trump: 45, bid: 45, play: 45 };
