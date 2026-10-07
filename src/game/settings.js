// Settings shared by the browser and the multiplayer server.

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
export const TIMEOUTS = { turn: 90, payment: 45, justsayno: 30, discard: 45 };
