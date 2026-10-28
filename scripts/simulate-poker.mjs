// Plays no-limit Hold'em between bots, at full speed, and checks that chips are
// never created or lost and that the biggest stack (or a tie) wins.
// Usage: node scripts/simulate-poker.mjs [games]
import { PokerGame } from '../src/poker/engine.js';
import { PokerAI } from '../src/poker/ai.js';

const GAMES = Number(process.argv[2]) || 8;
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

for (const n of [2, 3, 4, 6]) {
  let hands = 0;
  let showdowns = 0;
  for (let g = 0; g < GAMES; g++) {
    const players = Array.from({ length: n }, (_, i) => ({ name: `Bot ${i}`, controller: new PokerAI() }));
    const game = new PokerGame({ players, stack: 200, blinds: '25/50' });
    const total = n * 200;
    game.on((type) => {
      if (type !== 'state') return;
      const { state } = game;
      const held = state.players.reduce((s, p) => s + p.stack + (p.committed || 0), 0);
      if (held !== total) fail(`${n} players: chips ${held} !== ${total} on hand ${state.hand} (${state.phase})`);
      if (state.phase === 'showdown' && state.revealed) showdowns++;
    });
    await game.run();
    const { state } = game;
    hands += state.hand;
    const sum = state.players.reduce((s, p) => s + p.stack, 0);
    if (sum !== total) fail(`${n} players finished with ${sum} chips`);
    const best = Math.max(...state.players.map((p) => p.stack));
    if (state.winners.some((p) => p.stack !== best)) fail('a winner does not hold the biggest stack');
    if (state.players.filter((p) => p.stack === best).length !== state.winners.length) fail('a tied stack is missing from the winners');
    const capped = state.hand >= 2000;
    if (!capped && state.winners.length === 1 && state.players.filter((p) => p.stack > 0).length !== 1) fail('the game ended with more than one stack');
  }
  console.log(`${n} players: ${(hands / GAMES).toFixed(1)} hands a game · ${showdowns} showdowns over ${GAMES} games`);
}
console.log('PASS');
