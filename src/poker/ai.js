// Computer opponents for no-limit Hold'em. A bot only looks at its own hole cards
// and the board (never anyone else's hand). It folds weak hands to a bet, calls
// with a medium one, and bets or raises with a strong one; short stacks push more
// often so a game doesn't stall.
import { evaluate, legalActions } from './rules.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class PokerAI {
  // delay: thinking time per decision (ms).
  constructor({ delay = 0, rng = Math.random } = {}) {
    this.delay = delay;
    this.rng = rng;
  }

  async chooseAction(game, me) {
    if (this.delay) await sleep(this.delay * (0.6 + this.rng() * 0.8));
    return decideAction(game.state, me.id, this.rng);
  }
}

// 0–1, higher is better. Pre-flop is a rough reading of the two cards; from the
// flop on it's the made hand.
export function strengthOf(hole, board) {
  if (!hole || hole.length < 2) return 0;
  if (!board?.length) {
    const [a, b] = [...hole].sort((x, y) => y.rank - x.rank);
    const pair = a.rank === b.rank;
    const suited = a.suit === b.suit;
    const gap = a.rank - b.rank;
    let s = (a.rank + b.rank) / 40;
    if (pair) s += 0.32 + a.rank / 80;
    if (suited) s += 0.05;
    if (gap === 1) s += 0.04;
    if (a.rank >= 14) s += 0.06;
    return Math.max(0, Math.min(0.95, s));
  }
  const rank = board.length + hole.length >= 5 ? evaluate([...hole, ...board]) : null;
  if (!rank) return 0.3;
  const cat = rank[0];
  if (cat === 0) return Math.min(0.34, 0.12 + rank[1] / 70);
  if (cat === 1) return Math.min(0.62, 0.36 + rank[1] / 70);
  if (cat === 2) return 0.66;
  return Math.min(0.98, 0.72 + cat / 40);
}

// A legal action for this player, from legalActions.
export function decideAction(state, id, rng = Math.random) {
  const opts = legalActions(state, id);
  const p = state.players[id];
  if (!p) return { action: 'check' };
  const strength = strengthOf(p.hole, state.board);
  const pot = state.pot + state.players.reduce((s, x) => s + x.bet, 0);
  const price = opts.call > 0 ? opts.call / (pot + opts.call) : 0;
  const short = p.stack > 0 && p.stack <= state.bigBlind * 10;

  const betTo = (frac) => {
    const span = opts.bet.max - opts.bet.min;
    return opts.bet.min + Math.round(span * frac);
  };

  if (opts.check) {
    const stab = opts.bet && (strength > 0.6 || (strength > 0.4 && rng() < 0.5) || (short && strength > 0.34));
    if (stab) {
      if ((short && strength > 0.48 && rng() < 0.65) || (strength > 0.9 && rng() < 0.4)) return { action: 'allin' };
      return { action: 'bet', to: betTo(strength > 0.75 ? 0.7 : 0.3) };
    }
    return { action: 'check' };
  }

  if (opts.fold && strength + 0.08 < price && strength < 0.48 && rng() < 0.82) return { action: 'fold' };
  if (opts.bet && (strength > 0.76 || (short && strength > 0.5 && rng() < 0.7))) {
    if (rng() < 0.5 || short || opts.bet.min === opts.bet.max) return { action: 'allin' };
    return { action: 'raise', to: betTo(0.55) };
  }
  if (opts.call) return { action: 'call' };
  if (opts.allIn) return { action: 'allin' };
  if (opts.fold) return { action: 'fold' };
  return { action: 'check' };
}
