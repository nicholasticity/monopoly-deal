// Heuristic computer opponent. Each decision scores the legal options and picks the best.
import { COLORS } from './cards.js';
import * as R from './rules.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AIController {
  constructor({ delay = 0 } = {}) {
    this.delay = delay;
  }

  async wait(factor = 1) {
    if (this.delay) await sleep(this.delay * factor);
  }

  async chooseTurnAction(game, me) {
    await this.wait();
    return planAction(game, me);
  }

  async choosePayment(game, me, amount) {
    await this.wait(0.6);
    return autoPayment(me, amount).map((c) => c.id);
  }

  async chooseJustSayNo(game, me, ctx) {
    await this.wait(0.7);
    return decideJustSayNo(game, me, ctx);
  }

  // Holding no Just Say No: the same pause, so it doesn't give the hand away.
  async passJustSayNo() {
    await this.wait(0.7);
  }

  async chooseDiscards(game, me, count) {
    await this.wait(0.4);
    return chooseDiscards(me, count).map((c) => c.id);
  }
}

function incompletePile(me, color) {
  return me.piles.find((p) => p.color === color && !R.isComplete(p)) || null;
}

function hasCompleteColor(me, color) {
  return me.piles.some((p) => p.color === color && R.isComplete(p));
}

// How much does `me` want to receive `card` as `color`? >= 1000 means it wins the game.
export function gainValue(me, card, color) {
  if (hasCompleteColor(me, color)) return 4;
  const size = R.setSize(color);
  const cards = incompletePile(me, color)?.cards || [];
  const count = cards.length + 1;
  const anchored = !R.isMultiWild(card) || cards.some((c) => !R.isMultiWild(c));
  if (count >= size && anchored) {
    return R.completeColors(me).size + 1 >= R.SETS_TO_WIN ? 1000 : 120 + COLORS[color].rent[size - 1] * 3;
  }
  return 15 + (40 * count) / size + COLORS[color].rent[Math.min(count, size) - 1] * 2;
}

// How much does `me` lose if this table card leaves?
export function lossValue(me, card) {
  const pile = R.findPile(me, card.id);
  if (!pile) return 0;
  if (R.isComplete(pile)) return 100 + (pile.house ? 30 : 0) + (pile.hotel ? 40 : 0) + card.value;
  return 10 + (35 * pile.cards.length) / R.setSize(pile.color) + card.value;
}

function bestColorFor(me, card) {
  let best = null;
  for (const color of R.colorsForCard(card)) {
    const gain = gainValue(me, card, color);
    if (!best || gain > best.gain) best = { color, gain };
  }
  return best;
}

// Free action: move a wild out of an incomplete set if it completes another set.
function wildMove(me) {
  for (const pile of me.piles) {
    if (R.isComplete(pile)) continue;
    for (const card of pile.cards) {
      if (card.type !== 'wild') continue;
      for (const color of R.colorsForCard(card)) {
        if (color === pile.color) continue;
        if (gainValue(me, card, color) >= 120) return { kind: 'moveWild', cardId: card.id, color };
      }
    }
  }
  return null;
}

function rentOptions(game, me, card) {
  const out = [];
  const doubles = me.hand.filter((c) => c.action === 'doublerent');
  const plays = game.state.playsLeft;
  const opps = R.others(game, me);
  for (const color of R.rentColors(me, card)) {
    const base = R.rentFor(me, color);
    const groups = card.anyColor ? opps.map((o) => [o]) : [opps];
    for (const targets of groups) {
      for (let d = 0; d <= Math.min(doubles.length, plays - 1); d++) {
        const amount = base * 2 ** d;
        const expected = targets.reduce((s, o) => s + Math.min(R.totalAssets(o), amount), 0);
        if (expected <= 0) continue;
        out.push({
          score: 20 + expected * 6 - d * 18,
          action: {
            kind: 'rent', cardId: card.id, color,
            targetId: card.anyColor ? targets[0].id : undefined,
            doubles: doubles.slice(0, d).map((c) => c.id),
          },
        });
      }
    }
  }
  return out;
}

function candidatesFor(game, me, card) {
  const out = [];
  const plays = game.state.playsLeft;
  const opps = R.others(game, me);
  const bankFallback = (base) => ({ score: R.bankTotal(me) < 4 ? base + card.value : 0, action: { kind: 'bank', cardId: card.id } });

  if (card.type === 'money') {
    out.push({ score: 30 + card.value * 2, action: { kind: 'bank', cardId: card.id } });
    return out;
  }
  if (card.type === 'property' || card.type === 'wild') {
    const best = bestColorFor(me, card);
    out.push({ score: 100 + best.gain, action: { kind: 'property', cardId: card.id, color: best.color } });
    return out;
  }
  if (card.type === 'rent') {
    out.push(...rentOptions(game, me, card));
    out.push(bankFallback(12));
    return out;
  }

  const act = (extra, score) => out.push({ score, action: { kind: 'action', cardId: card.id, ...extra } });
  switch (card.action) {
    case 'passgo': {
      const handAfter = me.hand.length - 1 + 2;
      act({}, plays >= 2 ? 95 : handAfter > R.HAND_LIMIT ? 5 : 30);
      break;
    }
    case 'birthday': {
      const expected = opps.reduce((s, o) => s + Math.min(R.totalAssets(o), 2), 0);
      if (expected > 0) act({}, 25 + expected * 5);
      out.push(bankFallback(12));
      break;
    }
    case 'debtcollector': {
      let best = null;
      for (const o of opps) {
        const take = Math.min(R.totalAssets(o), 5);
        if (take > 0 && (!best || take > best.take)) best = { o, take };
      }
      if (best) act({ targetId: best.o.id }, 35 + best.take * 6);
      out.push(bankFallback(14));
      break;
    }
    case 'slydeal': {
      for (const o of opps) {
        for (const c of R.stealableCards(o)) {
          const gain = gainValue(me, c, c.color);
          const score = gain >= 1000 ? 2000 : 35 + gain * 0.8 + lossValue(o, c) * 0.2;
          act({ targetId: o.id, targetCardId: c.id }, score);
        }
      }
      out.push(bankFallback(10));
      break;
    }
    case 'forceddeal': {
      const mine = me.piles.filter((p) => !R.isComplete(p)).flatMap((p) => p.cards);
      for (const give of mine) {
        for (const o of opps) {
          for (const take of R.stealableCards(o)) {
            if (take.color === give.color) continue;
            const gain = gainValue(me, take, take.color);
            const net = gain - lossValue(me, give);
            if (net > 15) act({ targetId: o.id, targetCardId: take.id, myCardId: give.id }, gain >= 1000 ? 1900 : 30 + net * 0.7);
          }
        }
      }
      out.push(bankFallback(10));
      break;
    }
    case 'dealbreaker': {
      for (const o of opps) {
        for (const pile of o.piles.filter(R.isComplete)) {
          const newColor = !hasCompleteColor(me, pile.color);
          const wins = newColor && R.completeColors(me).size + 1 >= R.SETS_TO_WIN;
          const score = wins ? 3000 : newColor ? 150 + R.sum(pile.cards) * 3 + R.pileRent(pile) * 4 : 40;
          act({ targetId: o.id, pileId: pile.id }, score);
        }
      }
      break;
    }
    case 'house':
    case 'hotel': {
      const targets = R.buildingTargets(me, card.action);
      if (targets.length) {
        const pile = targets.reduce((a, b) => (R.pileRent(b) > R.pileRent(a) ? b : a));
        act({ pileId: pile.id }, 60);
      }
      out.push(bankFallback(10));
      break;
    }
    case 'doublerent':
      out.push({ score: R.bankTotal(me) < 3 ? 6 : 0, action: { kind: 'bank', cardId: card.id } });
      break;
    case 'justsayno':
      break;
  }
  return out;
}

export function planAction(game, me) {
  const move = wildMove(me);
  if (move) return move;
  const cands = me.hand.flatMap((card) => candidatesFor(game, me, card));
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  return best && best.score > 0 ? best.action : { kind: 'end' };
}

// Smallest-overpay subset of bank cards (fewest cards on ties).
function bestSubset(cards, amount) {
  let dp = new Map([[0, []]]);
  cards.forEach((c, i) => {
    const next = new Map(dp);
    for (const [s, idx] of dp) {
      const ns = s + c.value;
      if (!next.has(ns) || next.get(ns).length > idx.length + 1) next.set(ns, [...idx, i]);
    }
    dp = next;
  });
  let best = null;
  for (const [s, idx] of dp) {
    if (s >= amount && (!best || s < best.s || (s === best.s && idx.length < best.idx.length))) best = { s, idx };
  }
  return best ? best.idx.map((i) => cards[i]) : cards.slice();
}

// Cost of each $1M handed over beyond the debt (no change is given).
const OVERPAY_COST = 6;

export function autoPayment(me, amount) {
  if (R.bankTotal(me) >= amount) return bestSubset(me.bank, amount);
  const pool = me.bank.map((c) => ({ card: c, cost: 2 * c.value }));
  for (const pile of me.piles) {
    const complete = R.isComplete(pile);
    const size = R.setSize(pile.color);
    for (const c of pile.cards) {
      if (c.value > 0) pool.push({ card: c, cost: (complete ? 100 : 10 + (30 * pile.cards.length) / size) + c.value });
    }
    if (pile.hotel) pool.push({ card: pile.hotel, cost: 50 });
    if (pile.house) pool.push({ card: pile.house, cost: pile.hotel ? 95 : 55 });
  }
  // Knapsack over the total paid (capped), keeping the cheapest pick for each total.
  const cap = amount + 10;
  let dp = new Map([[0, { cost: 0, items: [] }]]);
  for (const item of pool) {
    const next = new Map(dp);
    for (const [s, e] of dp) {
      const ns = Math.min(s + item.card.value, cap);
      const cost = e.cost + item.cost;
      if (!next.has(ns) || cost < next.get(ns).cost) next.set(ns, { cost, items: [...e.items, item] });
    }
    dp = next;
  }
  let best = null;
  for (const [s, e] of dp) {
    const score = e.cost + OVERPAY_COST * (s - amount);
    if (s >= amount && (!best || score < best.score)) best = { score, items: e.items };
  }
  const picked = (best ? best.items : pool).map((i) => i.card);
  // A house can't go while its hotel stays.
  for (const card of picked.slice()) {
    if (card.action === 'house') {
      const pile = me.piles.find((p) => p.house === card);
      if (pile?.hotel && !picked.includes(pile.hotel)) picked.push(pile.hotel);
    }
  }
  return picked;
}

export function decideJustSayNo(game, me, ctx) {
  const jsnCount = me.hand.filter((c) => c.action === 'justsayno').length;
  if (!ctx.blocking) {
    // We are the actor, deciding whether to reinstate our own action.
    switch (ctx.kind) {
      case 'dealbreaker': return true;
      case 'slydeal':
      case 'forceddeal': return gainValue(me, ctx.targetCard, ctx.targetCard.color) >= 100;
      default: return ctx.amount >= 5;
    }
  }
  const generous = jsnCount >= 2;
  switch (ctx.kind) {
    case 'dealbreaker':
      return true;
    case 'slydeal':
    case 'forceddeal': {
      const threat = gainValue(ctx.actor, ctx.targetCard, ctx.targetCard.color) >= 120;
      return threat || lossValue(me, ctx.targetCard) >= (generous ? 25 : 32);
    }
    default: {
      const bank = R.bankTotal(me);
      const assets = R.totalAssets(me);
      const losesProperty = ctx.amount > bank && assets > bank;
      return ctx.amount >= (generous ? 4 : 6) || (losesProperty && ctx.amount >= 3);
    }
  }
}

const KEEP = {
  justsayno: 100, dealbreaker: 95, slydeal: 70, forceddeal: 60, debtcollector: 50,
  house: 45, hotel: 45, birthday: 40, passgo: 30, doublerent: 25,
};

export function chooseDiscards(me, count) {
  const keep = (c) => {
    if (c.type === 'property') return 80 + c.value;
    if (c.type === 'wild') return 85;
    if (c.type === 'rent') return 35 + (R.rentColors(me, c).length ? 20 : 0);
    if (c.type === 'money') return 20 + c.value * 3;
    return KEEP[c.action] ?? 30;
  };
  return me.hand.slice().sort((a, b) => keep(a) - keep(b)).slice(0, count);
}
