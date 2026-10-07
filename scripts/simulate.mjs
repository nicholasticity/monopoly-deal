// Headless AI-vs-AI simulation to sanity-check the rules engine.
// Usage: node scripts/simulate.mjs [games=300]
import { Game } from '../src/game/engine.js';
import { AIController } from '../src/game/ai.js';
import * as R from '../src/game/rules.js';

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkInvariants(game) {
  const seen = new Map();
  const note = (card, where) => {
    if (seen.has(card.id)) throw new Error(`card ${card.id} (${card.name}) in ${seen.get(card.id)} and ${where}`);
    seen.set(card.id, where);
  };
  const { state } = game;
  state.deck.forEach((c) => note(c, 'deck'));
  state.discard.forEach((c) => note(c, 'discard'));
  state.showcase.forEach((c) => note(c, 'showcase'));
  for (const p of state.players) {
    p.hand.forEach((c) => note(c, `${p.name}.hand`));
    p.bank.forEach((c) => note(c, `${p.name}.bank`));
    for (const pile of p.piles) {
      if (pile.cards.length === 0) throw new Error('empty pile');
      if (pile.cards.length > R.setSize(pile.color)) throw new Error('overfull pile');
      pile.cards.forEach((c) => {
        if (!R.colorsForCard(c).includes(pile.color)) throw new Error(`${c.name} in ${pile.color} pile`);
        if (c.color !== pile.color) throw new Error(`${c.name} colour mismatch`);
        note(c, `${p.name}.pile`);
      });
      if (pile.house) note(pile.house, 'house');
      if (pile.hotel) note(pile.hotel, 'hotel');
      if ((pile.house || pile.hotel) && !R.isComplete(pile)) throw new Error('building on incomplete set');
      if (pile.hotel && !pile.house) throw new Error('hotel without house');
    }
    if (p.hand.length > R.HAND_LIMIT && state.phase === 'idle') throw new Error('hand over limit');
  }
  if (seen.size !== game.allCards.length) throw new Error(`card count ${seen.size} != ${game.allCards.length}`);
}

const games = Number(process.argv[2] || 300);
const MAX_TURNS = 600;
const stats = { finished: 0, stalled: 0, turns: [], byPlayers: {}, events: {} };

for (let g = 0; g < games; g++) {
  const n = 2 + (g % 4);
  const rng = mulberry32(1000 + g);
  const players = Array.from({ length: n }, (_, i) => ({ name: `AI${i}`, controller: new AIController() }));
  const game = new Game({ players, rng });
  game.on((type, data) => {
    if (type === 'state') checkInvariants(game);
    if (type === 'log' && data.kind === 'action') {
      const key = data.text.replace(/^AI\d /, '').split(/[ .!]/).slice(0, 2).join(' ');
      stats.events[key] = (stats.events[key] || 0) + 1;
    }
    if (type === 'turn' && game.state.turn > MAX_TURNS) game.abort();
  });
  try {
    await game.run();
    stats.finished++;
    stats.turns.push(game.state.turn);
    stats.byPlayers[n] = (stats.byPlayers[n] || 0) + 1;
  } catch (e) {
    if (e.constructor.name === 'GameAborted') stats.stalled++;
    else {
      console.error(`Game ${g} (seed ${1000 + g}, ${n} players) crashed:`, e);
      process.exit(1);
    }
  }
}

const avg = stats.turns.reduce((a, b) => a + b, 0) / Math.max(1, stats.turns.length);
console.log(`games=${games} finished=${stats.finished} stalled=${stats.stalled} avgTurns=${avg.toFixed(1)} maxTurns=${Math.max(...stats.turns)}`);
console.log('finished by player count:', stats.byPlayers);
console.log('action plays:', Object.entries(stats.events).sort((a, b) => b[1] - a[1]).slice(0, 14));
