// No-limit Texas Hold'em, shared by the browser and the server.
//
// Defaults (also the start-screen and lobby presets):
//   2–8 players, 1,000 play-money chips each, blinds 10 small / 20 big.
//   Other stacks: 200 (a short game), 500, 2,000.
//   Other blinds: 5/10 and 25/50. The big blind is always smaller than the stack.
//
// A hand: the button moves clockwise (heads-up, the button posts the small blind
// and acts first before the flop, last after it). Two cards each, then betting
// pre-flop, on the flop (3), turn (1) and river (1). No burn cards. Betting is
// no-limit: a bet is at least the big blind, a raise at least the size of the last
// full bet or raise, and a player may always push the rest of their stack in.
// An all-in for less than a full raise does not reopen raising for anyone who has
// already acted. Side pots pay players only up to the amount they put in. At
// showdown the best five cards from the two hole cards and the board win; a tie
// splits that pot, and an odd chip goes to the first of the winners sitting left
// of the button. Folded hands stay hidden. Play continues until one player has
// all the chips (a safety cap of HAND_CAP hands gives the rest to the biggest stack).

import { buildDeck, shortName } from '../callbridge/cards.js';

export { buildDeck, shortName };

export const STACKS = [200, 500, 1000, 2000];
export const DEFAULT_STACK = 1000;
export const BLINDS = [
  { small: 5, big: 10 },
  { small: 10, big: 20 },
  { small: 25, big: 50 },
];
export const DEFAULT_BLINDS = BLINDS[1];
// A stuck table (everyone folding forever) still ends.
export const HAND_CAP = 2000;

export const blindsKey = (b) => `${b.small}/${b.big}`;

// A preset stack and blind pair. Anything else falls back to the defaults.
export function stakesOf({ stack, blinds, smallBlind, bigBlind } = {}) {
  const stack0 = STACKS.includes(Number(stack)) ? Number(stack) : DEFAULT_STACK;
  const byKey = typeof blinds === 'string' ? BLINDS.find((b) => blindsKey(b) === blinds) : null;
  const byPair = BLINDS.find((b) => b.small === Number(smallBlind) && b.big === Number(bigBlind));
  const picked = byKey || byPair || DEFAULT_BLINDS;
  return { stack: stack0, smallBlind: picked.small, bigBlind: picked.big, blinds: blindsKey(picked) };
}

export const chipText = (n) => Number(n).toLocaleString('en-US');

const BETTING = new Set(['preflop', 'flop', 'turn', 'river']);

const WORD = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten',
  11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
};
const PLURAL = {
  2: 'Twos', 3: 'Threes', 4: 'Fours', 5: 'Fives', 6: 'Sixes', 7: 'Sevens', 8: 'Eights', 9: 'Nines', 10: 'Tens',
  11: 'Jacks', 12: 'Queens', 13: 'Kings', 14: 'Aces',
};

const rankWord = (r) => WORD[r] ?? String(r);
const rankPlural = (r) => PLURAL[r] ?? `${rankWord(r)}s`;

// Every way to choose k items, in index order.
function combinations(cards, k) {
  const out = [];
  const n = cards.length;
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    out.push(idx.map((i) => cards[i]));
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return out;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

// The high card of a 5-card straight, or 0. A wheel (A-2-3-4-5) is a five-high straight.
function straightHigh(ranksDesc) {
  const uniq = [...new Set(ranksDesc)];
  if (uniq.length !== 5) return 0;
  if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) return 5;
  return uniq[0] - uniq[4] === 4 ? uniq[0] : 0;
}

// A 5-card hand as a list of numbers, best first, so two hands compare left to right.
// Category: 8 straight flush, 7 quads, 6 full house, 5 flush, 4 straight, 3 trips,
// 2 two pair, 1 pair, 0 high card.
export function score5(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const straight = straightHigh(ranks);
  if (flush && straight) return [8, straight];
  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...ranks];
  if (straight) return [4, straight];
  if (groups[0][1] === 3) return [3, groups[0][0], ...groups.slice(1).map((g) => g[0])];
  if (groups[0][1] === 2 && groups[1][1] === 2) return [2, groups[0][0], groups[1][0], groups[2][0]];
  if (groups[0][1] === 2) return [1, groups[0][0], ...groups.slice(1).map((g) => g[0])];
  return [0, ...ranks];
}

// Best five-card hand in `cards` (5, 6 or 7). null when there aren't five yet.
// The list compares with compareHands: bigger is better.
export function evaluate(cards) {
  if (!cards || cards.length < 5) return null;
  let best = null;
  const pool = cards.length === 5 ? [cards] : combinations(cards, 5);
  for (const five of pool) {
    const score = score5(five);
    if (!best || compareHands(score, best) > 0) best = score;
  }
  return best;
}

// 1 when a beats b, -1 when b beats a, 0 when they split.
export function compareHands(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// A phrase that reads after "with": "a pair of Aces", "two pair, Kings and Tens", "Ace high".
export function handName(rank) {
  if (!rank) return '';
  const [cat, a, b] = rank;
  switch (cat) {
    case 8: return a === 14 ? 'a royal flush' : `a straight flush, ${rankWord(a)} high`;
    case 7: return `four of a kind, ${rankPlural(a)}`;
    case 6: return `a full house, ${rankPlural(a)} full of ${rankPlural(b)}`;
    case 5: return `a flush, ${rankWord(a)} high`;
    case 4: return `a straight, ${rankWord(a)} high`;
    case 3: return `three of a kind, ${rankPlural(a)}`;
    case 2: return `two pair, ${rankPlural(a)} and ${rankPlural(b)}`;
    case 1: return `a pair of ${rankPlural(a)}`;
    default: return `${rankWord(a)} high`;
  }
}

// One pot per distinct amount put in. A folded player's chips stay in, but they
// can't win. Pots that the same players contest are joined into one.
// contributions: [{ id, amount, folded }]
// returns [{ amount, eligible: [id] }] in low-to-high order.
export function sidePots(contributions) {
  const left = contributions.filter((c) => c.amount > 0).map((c) => ({ id: c.id, amount: c.amount, folded: !!c.folded }));
  const raw = [];
  while (left.some((c) => c.amount > 0)) {
    const level = Math.min(...left.filter((c) => c.amount > 0).map((c) => c.amount));
    const pot = { amount: 0, eligible: [] };
    for (const c of left) {
      if (c.amount <= 0) continue;
      pot.amount += level;
      c.amount -= level;
      if (!c.folded) pot.eligible.push(c.id);
    }
    if (pot.amount) raw.push(pot);
  }
  const pots = [];
  for (const pot of raw) {
    const key = pot.eligible.join(',');
    const prev = pots.at(-1);
    if (prev && prev.eligible.join(',') === key) prev.amount += pot.amount;
    else pots.push({ amount: pot.amount, eligible: pot.eligible.slice() });
  }
  return pots;
}

// Pay each pot to the best hand among its eligible players. `ranks` maps id to an
// evaluate() list. `order` is seat order starting left of the button: the odd chip
// of a split goes to the first winner in that order, then the next, one each.
// Returns { payouts: { id: chips }, pots: [{ amount, winners, shares, hand }] }.
export function awardPots(pots, ranks, order) {
  const payouts = {};
  const awarded = [];
  for (const pot of pots) {
    let best = null;
    let winners = [];
    for (const id of pot.eligible) {
      const rank = ranks[id];
      if (!rank) continue;
      const cmp = best ? compareHands(rank, best) : 1;
      if (cmp > 0) {
        best = rank;
        winners = [id];
      } else if (cmp === 0) winners.push(id);
    }
    if (!winners.length || !pot.amount) continue;
    const share = Math.floor(pot.amount / winners.length);
    let rem = pot.amount - share * winners.length;
    const ordered = order.filter((id) => winners.includes(id));
    const shares = {};
    for (const id of ordered) {
      const extra = rem > 0 ? 1 : 0;
      if (extra) rem--;
      const get = share + extra;
      shares[id] = get;
      payouts[id] = (payouts[id] ?? 0) + get;
    }
    awarded.push({ amount: pot.amount, winners: ordered, shares, hand: handName(best) });
  }
  return { payouts, pots: awarded };
}

const inHand = (p) => !p.folded && !p.out && (p.hole?.length ?? 0) > 0;

// What `id` may do right now. bet is { min, max }: the total chips they will have
// put in this street (not the extra amount). allIn is that total when pushing the
// rest of the stack is legal (0 otherwise). call is the extra chips a call costs.
export function legalActions(state, id) {
  const none = { fold: false, check: false, call: 0, bet: null, allIn: 0 };
  const p = state.players[id];
  if (!p || state.current !== id || !BETTING.has(state.phase)) return none;
  if (p.folded || p.out || p.allIn || p.stack <= 0 || !(p.hole?.length)) return none;
  const owed = state.toCall - p.bet;
  const max = p.bet + p.stack;
  const opening = state.toCall === 0;
  const fullMin = opening ? state.bigBlind : state.toCall + state.minRaise;
  let bet = null;
  if (p.canRaise !== false && max > state.toCall) {
    bet = max >= fullMin ? { min: fullMin, max } : { min: max, max };
  }
  const allIn = owed >= p.stack || bet ? max : 0;
  return {
    fold: owed > 0,
    check: owed <= 0,
    call: owed > 0 ? Math.min(owed, p.stack) : 0,
    bet,
    allIn,
  };
}

// A client's action, or null when it isn't legal. A bet/raise `to` outside the
// range is rejected rather than quietly changed.
export function normalize(state, id, move) {
  const opts = legalActions(state, id);
  if (!move || typeof move !== 'object') return null;
  if (move.action === 'fold' && opts.fold) return { action: 'fold' };
  if (move.action === 'check' && opts.check) return { action: 'check' };
  if (move.action === 'call' && opts.call > 0) return { action: 'call' };
  if (move.action === 'allin' && opts.allIn) return { action: 'allin' };
  if ((move.action === 'bet' || move.action === 'raise') && opts.bet && Number.isInteger(move.to) && move.to >= opts.bet.min && move.to <= opts.bet.max) {
    return { action: state.toCall === 0 ? 'bet' : 'raise', to: move.to };
  }
  return null;
}

function commit(p, chips) {
  p.stack -= chips;
  p.bet += chips;
  p.committed = (p.committed ?? 0) + chips;
  if (p.stack === 0) p.allIn = true;
}

// Apply a legal action. Returns { kind, amount, to } for the log.
// kind: fold, check, call, bet, raise, allin.
export function perform(state, id, move) {
  const p = state.players[id];
  if (move.action === 'fold') {
    p.folded = true;
    p.acted = true;
    return { kind: 'fold', amount: 0, to: p.bet };
  }
  if (move.action === 'check') {
    p.acted = true;
    return { kind: 'check', amount: 0, to: p.bet };
  }
  if (move.action === 'call') {
    const pay = Math.min(state.toCall - p.bet, p.stack);
    commit(p, pay);
    p.acted = true;
    return { kind: p.allIn ? 'allin' : 'call', amount: pay, to: p.bet };
  }
  const to = move.action === 'allin' ? p.bet + p.stack : move.to;
  const pay = to - p.bet;
  if (to < state.toCall) {
    commit(p, pay);
    p.acted = true;
    return { kind: 'allin', amount: pay, to: p.bet };
  }
  if (to === state.toCall) {
    commit(p, pay);
    p.acted = true;
    return { kind: p.allIn ? 'allin' : 'call', amount: pay, to };
  }
  const opening = state.toCall === 0;
  const increment = to - state.toCall;
  const full = to >= (opening ? state.bigBlind : state.toCall + state.minRaise);
  commit(p, pay);
  if (full) state.minRaise = opening ? to : increment;
  state.toCall = to;
  for (const o of state.players) {
    if (o === p || !inHand(o) || o.allIn) continue;
    if (!full && o.bet >= state.toCall) continue;
    if (o.bet < state.toCall || full) {
      if (!full && o.acted) o.canRaise = false;
      if (full) o.canRaise = true;
      o.acted = false;
    }
  }
  p.acted = true;
  if (p.allIn) return { kind: 'allin', amount: pay, to };
  return { kind: opening ? 'bet' : 'raise', amount: pay, to };
}

// Suggested totals for the slider: the minimum, half the pot and the pot.
// `to` is a street total, matching legalActions().bet.
export function sizing(state, id) {
  const opts = legalActions(state, id);
  if (!opts.bet) return null;
  const p = state.players[id];
  const pot = state.pot + state.players.reduce((s, x) => s + x.bet, 0);
  const owed = Math.max(0, state.toCall - p.bet);
  const after = pot + owed;
  const clamp = (to) => Math.max(opts.bet.min, Math.min(opts.bet.max, to));
  return {
    min: opts.bet.min,
    max: opts.bet.max,
    half: clamp(state.toCall + Math.floor(after / 2)),
    pot: clamp(state.toCall + after),
  };
}
