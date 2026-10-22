// Plays many Least Count games between bots, at full speed, to check the engine (every
// card accounted for, only legal throws, Shows scored right) and see how rounds go.
// Usage: node scripts/simulate-leastcount.mjs [games]
import { LeastCountGame } from '../src/leastcount/engine.js';
import { LeastCountAI } from '../src/leastcount/ai.js';
import * as R from '../src/leastcount/rules.js';

const GAMES = Number(process.argv[2]) || 200;
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

// A bot that checks every move it's asked for against the rules, and counts them.
class CheckedAI extends LeastCountAI {
  constructor(stats) {
    super();
    this.stats = stats;
  }

  async chooseThrow(game, me) {
    const move = await super.chooseThrow(game, me);
    const { state } = game;
    // Every card is somewhere, once.
    const all = [...state.deck, ...state.discard, ...(state.last?.cards ?? []), state.wildCard, ...state.players.flatMap((p) => p.hand)];
    if (all.length !== game.allCards.length || new Set(all.map((c) => c.id)).size !== all.length) fail(`cards lost or doubled (${all.length} of ${game.allCards.length})`);
    if (!move.show) {
      const cards = move.throw.map((id) => me.hand.find((c) => c.id === id));
      if (cards.some((c) => !c) || !R.throwKind(cards)) fail('a bot made an illegal throw');
      this.stats.kinds[R.throwKind(cards)]++;
      if (move.take !== 'deck') this.stats.pickups++;
    }
    this.stats.turns++;
    return move;
  }
}

for (const n of [2, 4, 6]) {
  const stats = { turns: 0, pickups: 0, kinds: { single: 0, set: 0, run: 0 }, rounds: 0, caught: 0, callerTotal: 0, winScore: 0 };
  for (let g = 0; g < GAMES; g++) {
    const players = Array.from({ length: n }, (_, i) => ({ name: `Bot ${i}`, controller: new CheckedAI(stats) }));
    const game = new LeastCountGame({ players, rounds: 5 });
    game.on((type, data) => {
      if (type !== 'round') return;
      stats.rounds++;
      if (data.caught) stats.caught++;
      const caller = data.results.find((r) => r.id === data.caller);
      stats.callerTotal += caller.total;
      // The Show is scored as the rules say.
      const totals = Object.fromEntries(data.results.map((r) => [r.id, r.total]));
      const { points } = R.showPoints(totals, data.caller);
      for (const r of data.results) if (r.points !== points[r.id]) fail('a Show was scored wrong');
    });
    await game.run();
    const { state } = game;
    if (state.players.some((p) => p.history.length !== 5)) fail('a player missed a round');
    for (const p of state.players) if (p.score !== p.history.reduce((s, h) => s + h.points, 0)) fail('scores do not add up');
    const low = Math.min(...state.players.map((p) => p.score));
    if (state.winners.some((p) => p.score !== low) || state.players.some((p) => p.score === low && !state.winners.includes(p))) fail('wrong winners');
    stats.winScore += low;
  }
  const per = (x) => (x / stats.rounds).toFixed(1);
  const k = stats.kinds;
  const throws = k.single + k.set + k.run;
  console.log(
    `${n} players: ${per(stats.turns / n)} turns each a round · Show caught ${((stats.caught / stats.rounds) * 100).toFixed(0)}% · caller's hand ${per(stats.callerTotal)} · ` +
      `throws ${((k.single / throws) * 100).toFixed(0)}% single, ${((k.set / throws) * 100).toFixed(0)}% sets, ${((k.run / throws) * 100).toFixed(0)}% runs · took the last throw ${((stats.pickups / throws) * 100).toFixed(0)}% · winning total ${(stats.winScore / GAMES).toFixed(0)} over 5 rounds`,
  );
}
console.log('PASS');
