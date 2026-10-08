// Headless AI-vs-AI Judgement games to sanity-check the rules engine.
// Usage: node scripts/simulate-judgement.mjs [games=200]
import { JudgementGame } from '../src/judgement/engine.js';
import { JudgementAI } from '../src/judgement/ai.js';
import * as R from '../src/judgement/rules.js';

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkCards(game) {
  const { state } = game;
  const seen = new Set();
  const note = (card, where) => {
    if (seen.has(card.id)) throw new Error(`${card.name} twice (${where})`);
    seen.add(card.id);
  };
  state.deck.forEach((c) => note(c, 'deck'));
  state.trick.forEach((t) => note(t.card, 'trick'));
  for (const p of state.players) {
    p.hand.forEach((c) => note(c, `${p.name}.hand`));
    p.tricks.forEach((c) => note(c, `${p.name}.tricks`));
    if (p.tricks.length !== p.won * state.players.length) throw new Error(`${p.name} has ${p.tricks.length} trick cards for ${p.won} tricks`);
  }
  if (seen.size !== 52) throw new Error(`card count ${seen.size}`);
}

// Checks every play against the hand it came from, before the engine applies it.
class CheckedAI extends JudgementAI {
  async choosePlay(game, me) {
    const id = await super.choosePlay(game, me);
    const card = me.hand.find((c) => c.id === id);
    if (!card || !R.legalCards(me.hand, game.state.trick).includes(card)) throw new Error(`${me.name} played an illegal card`);
    return id;
  }

  async chooseBid(game, me, range) {
    const bid = await super.chooseBid(game, me, range);
    if (!R.validBid(bid, game.state.handSize) || range.min !== R.MIN_BID || range.max !== game.state.handSize) throw new Error(`bad bid ${bid}`);
    return bid;
  }
}

// Spot checks of the scoring rule (bid 3 from the rules).
const expect = [[3, 3, 30], [3, 4, 31], [3, 5, 32], [3, 6, -33], [3, 7, -34], [3, 2, -30], [3, 0, -30], [2, 3, 21], [2, 4, -22]];
for (const [bid, won, points] of expect) {
  if (R.roundPoints(bid, won) !== points) throw new Error(`roundPoints(${bid}, ${won}) = ${R.roundPoints(bid, won)}, expected ${points}`);
}
const t = (suit, rank, playerId) => ({ playerId, card: { suit, rank } });
if (R.trickWinner([t('hearts', 5, 0), t('hearts', 14, 1), t('spades', 2, 2)], 'spades').playerId !== 2) throw new Error('trump should win');
if (R.trickWinner([t('hearts', 5, 0), t('clubs', 14, 1), t('hearts', 9, 2)], 'spades').playerId !== 2) throw new Error('led suit should win');

const games = Number(process.argv[2] || 200);
const stats = { byPlayers: {}, made: 0, bids: 0, busts: 0, bidSum: 0, wins: [], rounds: {}, deals: {} };
const started = Date.now();
for (let g = 0; g < games; g++) {
  const rng = mulberry32(g + 1);
  const n = 2 + (g % 4);
  const game = new JudgementGame({
    players: Array.from({ length: n }, (_, i) => ({ name: `Bot ${i + 1}`, controller: new CheckedAI() })),
    rng,
  });
  let rounds = 0;
  game.on((type, data) => {
    if (type === 'state') checkCards(game);
    // A deal counts once the den calls; bidding only starts once everyone holds a trump.
    if (type === 'turn' && data.what === 'trump') stats.deals[n] = (stats.deals[n] || 0) + 1;
    if (type === 'turn' && data.what === 'bid' && R.withoutTrumps(game.state.players, game.state.trump).length) throw new Error('bidding with someone out of trumps');
    if (type === 'round') {
      rounds++;
      const size = game.state.handSize;
      const won = data.results.reduce((s, r) => s + r.won, 0);
      if (won !== size) throw new Error(`${won} tricks won in a ${size}-trick round`);
      for (const r of data.results) {
        stats.bids++;
        stats.bidSum += r.bid;
        const state = R.bidState(r.bid, r.won);
        if (state === 'made') stats.made++;
        if (state === 'bust') stats.busts++;
      }
    }
  });
  const winner = await game.run();
  if (rounds !== n) throw new Error(`${rounds} rounds for ${n} players`);
  if (game.state.handSize !== R.cardsEach(n)) throw new Error('hand size');
  const top = Math.max(...game.state.players.map((p) => p.score));
  if (winner.score !== top || !game.state.winners.every((p) => p.score === top)) throw new Error('wrong winner');
  for (const p of game.state.players) {
    if (p.history.length !== n) throw new Error('history length');
    if (p.history.reduce((s, h) => s + h.points, 0) !== p.score) throw new Error('score total');
  }
  stats.byPlayers[n] = (stats.byPlayers[n] || 0) + 1;
  stats.rounds[n] = (stats.rounds[n] || 0) + rounds;
  stats.wins.push(top);
}
const pct = (a, b) => `${((100 * a) / b).toFixed(0)}%`;
console.log(`games=${games} in ${((Date.now() - started) / 1000).toFixed(1)}s, by player count:`, stats.byPlayers);
console.log('redeals per round:', Object.fromEntries(Object.keys(stats.rounds).map((k) => [k, pct(stats.deals[k] - stats.rounds[k], stats.rounds[k])])));
console.log(`bids made ${pct(stats.made, stats.bids)}, short ${pct(stats.bids - stats.made - stats.busts, stats.bids)}, bust ${pct(stats.busts, stats.bids)}; average bid ${(stats.bidSum / stats.bids).toFixed(1)}; average winning score ${(stats.wins.reduce((a, b) => a + b, 0) / games).toFixed(0)}`);
