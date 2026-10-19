// Headless AI-vs-AI Judgement games to check the rules engine:
// the hand sizes and trumps round by round, the dealer's restricted bid, and the
// scores under each scoring system.
// Usage: node scripts/simulate-judgement.mjs [games=120]
import { JudgementGame } from '../src/judgement/engine.js';
import { JudgementAI } from '../src/judgement/ai.js';
import * as R from '../src/judgement/rules.js';

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};
const eq = (a, b, what) => JSON.stringify(a) === JSON.stringify(b) || fail(`${what}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The rules as written on kard.games.
eq(R.handSizes(4), [7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7], '4 players: hand sizes');
eq(R.startCards(7), 7, '7 players start with 7');
eq(R.startCards(8), 6, '8 players start with 6');
eq([1, 2, 3, 4, 5, 6].map(R.trumpFor), ['spades', 'diamonds', 'clubs', 'hearts', null, 'spades'], 'trump order');
eq([R.roundPoints(3, 3, 'high'), R.roundPoints(3, 2, 'high'), R.roundPoints(0, 0, 'high'), R.roundPoints(0, 1, 'high')], [43, -43, 10, -10], 'high scoring');
eq([R.roundPoints(3, 3, 'medium'), R.roundPoints(3, 4, 'medium'), R.roundPoints(0, 0, 'medium')], [30, 0, 0], 'medium scoring');
eq([R.roundPoints(3, 3, 'low'), R.roundPoints(3, 1, 'low'), R.roundPoints(0, 0, 'low')], [11, 0, 5], 'low scoring');
eq([R.forbiddenBid(2, 5), R.forbiddenBid(7, 5), R.forbiddenBid(0, 3)], [3, null, 3], 'the dealer\'s ruled-out bid');

// Watches a controller's decisions: the prompt it's given, and the bids it makes.
class CheckedAI extends JudgementAI {
  async chooseBid(game, me, range) {
    const { state } = game;
    const n = state.players.length;
    const lastToBid = me.id === state.den;
    const others = state.players.filter((p) => p !== me && p.bid != null).reduce((s, p) => s + p.bid, 0);
    if (range.min !== 0 || range.max !== me.hand.length) fail('wrong bid range');
    if (lastToBid) {
      if (state.players.filter((p) => p.bid != null).length !== n - 1) fail('the dealer did not bid last');
      if (range.forbidden !== R.forbiddenBid(others, me.hand.length)) fail('wrong ruled-out bid for the dealer');
    } else if (range.forbidden != null) fail('only the dealer has a ruled-out bid');
    // Sometimes try the ruled-out bid (as a careless person might): the engine must not take it.
    if (lastToBid && range.forbidden != null && this.rng() < 0.3) return range.forbidden;
    return super.chooseBid(game, me, range);
  }
}

const games = Number(process.argv[2] || 120);
const stats = { rounds: 0, made: 0, bids: 0, zero: 0, noTrump: 0, byScoring: {} };
for (let g = 0; g < games; g++) {
  const n = 2 + (g % 4);
  const scoring = Object.keys(R.SCORING)[g % 3];
  const rng = mulberry32(500 + g);
  const players = Array.from({ length: n }, (_, i) => {
    const ai = new CheckedAI();
    ai.rng = rng;
    return { name: `AI${i}`, controller: ai };
  });
  const game = new JudgementGame({ players, rng, scoring });
  const { state } = game;
  const sizes = R.handSizes(n);
  let round = 0;
  const expected = new Array(n).fill(0);
  game.on((type, data) => {
    if (type === 'state' && state.phase === 'bid' && state.round !== round) {
      round = state.round;
      if (state.handSize !== sizes[round - 1]) fail(`round ${round}: ${state.handSize} cards, expected ${sizes[round - 1]}`);
      if (state.trump !== R.trumpFor(round)) fail(`round ${round}: wrong trump`);
      for (const p of state.players) if (p.hand.length !== state.handSize) fail(`round ${round}: ${p.name} holds ${p.hand.length}`);
      if (state.trump === null) stats.noTrump++;
    }
    if (type === 'round') {
      stats.rounds++;
      const total = data.results.reduce((s, r) => s + r.bid, 0);
      if (total === state.handSize) fail(`round ${data.round}: bids add up to the tricks`);
      if (data.results.reduce((s, r) => s + r.won, 0) !== state.handSize) fail('tricks don\'t add up');
      for (const r of data.results) {
        const points = R.roundPoints(r.bid, r.won, scoring);
        if (r.points !== points) fail(`wrong points for bid ${r.bid}, won ${r.won}`);
        expected[r.id] += points;
        if (r.score !== expected[r.id]) fail('running score off');
        stats.bids++;
        if (r.bid === r.won) stats.made++;
        if (r.bid === 0) stats.zero++;
      }
    }
  });
  await game.run();
  if (round !== sizes.length) fail(`played ${round} rounds, expected ${sizes.length}`);
  const top = Math.max(...expected);
  if (state.winners.some((p) => p.score !== top) || !state.winners.length) fail('wrong winner');
  const s = (stats.byScoring[scoring] ??= { games: 0, top: 0 });
  s.games++;
  s.top += top;
}

const pct = (x) => `${(100 * x).toFixed(0)}%`;
console.log(`games=${games}, rounds=${stats.rounds} (${stats.noTrump} without trumps)`);
console.log(`bids made exactly ${pct(stats.made / stats.bids)}; ${pct(stats.zero / stats.bids)} of bids were 0`);
for (const [k, s] of Object.entries(stats.byScoring)) console.log(`  ${k} scoring: average winning score ${(s.top / s.games).toFixed(0)}`);
console.log('OK');
