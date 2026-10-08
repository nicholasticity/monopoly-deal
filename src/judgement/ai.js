// Computer opponents for Judgement. Trumps go to the strongest suit in view, bids
// come from playing the hand out against random deals, and each card is chosen to
// win tricks until the bid is made and to dodge them after that.
import { buildDeck, SUIT_ORDER } from './cards.js';
import { MIN_BID, legalCards, trickWinner, roundPoints } from './rules.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HONOURS = { 14: 4, 13: 3, 12: 2, 11: 1 };
// Random deals tried per bid.
const SAMPLES = 160;

export class JudgementAI {
  constructor({ delay = 0 } = {}) {
    this.delay = delay;
  }

  async wait(factor = 1) {
    if (this.delay) await sleep(this.delay * factor);
  }

  async chooseTrump(game, me) {
    await this.wait(1.2);
    return pickTrump(me.hand);
  }

  async chooseBid(game, me) {
    await this.wait(1);
    return chooseBid(game, me);
  }

  async choosePlay(game, me) {
    await this.wait(0.6);
    return chooseCard(game, me).id;
  }
}

// Length counts most, then honours.
export function pickTrump(hand) {
  let best = SUIT_ORDER[0];
  let bestScore = -1;
  for (const suit of SUIT_ORDER) {
    const cards = hand.filter((c) => c.suit === suit);
    const score = cards.length * 3 + cards.reduce((s, c) => s + (HONOURS[c.rank] ?? 0), 0);
    if (score > bestScore) {
      best = suit;
      bestScore = score;
    }
  }
  return best;
}

// Plays the round out many times with the unseen cards dealt at random, everyone
// trying to win every trick, and picks the bid with the best average score.
export function chooseBid(game, me, rng = Math.random) {
  const { state } = game;
  const n = state.players.length;
  const size = me.hand.length;
  const mine = new Set(me.hand.map((c) => c.key));
  const unseen = buildDeck().filter((c) => !mine.has(c.key));
  const counts = new Array(size + 1).fill(0);
  for (let s = 0; s < SAMPLES; s++) {
    shuffleInPlace(unseen, rng);
    const hands = [];
    for (let i = 0, k = 0; i < n; i++) hands.push(i === me.id ? me.hand.slice() : unseen.slice(k, (k += size)));
    counts[playOut(hands, state.trump, state.den)[me.id]]++;
  }
  let best = MIN_BID;
  let bestValue = -Infinity;
  for (let bid = MIN_BID; bid <= size; bid++) {
    let value = 0;
    counts.forEach((count, won) => (value += count * roundPoints(bid, won)));
    if (value > bestValue) {
      best = bid;
      bestValue = value;
    }
  }
  return best;
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Tricks each hand takes when everyone plays to win. Hands are consumed.
function playOut(hands, trump, leader) {
  const n = hands.length;
  const won = new Array(n).fill(0);
  const played = new Set();
  while (hands[leader].length) {
    const trick = [];
    for (let i = 0; i < n; i++) {
      const p = (leader + i) % n;
      const card = pick(hands[p], trick, trump, true, played, i === n - 1);
      hands[p].splice(hands[p].indexOf(card), 1);
      trick.push({ playerId: p, card });
    }
    for (const t of trick) played.add(t.card.key);
    leader = trickWinner(trick, trump).playerId;
    won[leader]++;
  }
  return won;
}

// The card a bot plays now.
export function chooseCard(game, me) {
  const { state } = game;
  const played = new Set();
  for (const p of state.players) for (const c of p.tricks) if (c.key) played.add(c.key);
  for (const t of state.trick) played.add(t.card.key);
  const last = state.trick.length === state.players.length - 1;
  return pick(me.hand, state.trick, state.trump, me.won < me.bid, played, last);
}

// The highest card of its suit still out: no one else can beat it in that suit.
function isMaster(card, hand, played) {
  for (let r = card.rank + 1; r <= 14; r++) {
    const key = `${card.suit}-${r}`;
    if (!played.has(key) && !hand.some((c) => c.key === key)) return false;
  }
  return true;
}

const lowest = (cards) => cards.reduce((a, b) => (b.rank < a.rank ? b : a));
const highest = (cards) => cards.reduce((a, b) => (b.rank > a.rank ? b : a));

function pick(hand, trick, trump, wantWin, played, last) {
  const legal = legalCards(hand, trick);
  if (legal.length === 1) return legal[0];
  const plain = (cards) => cards.filter((c) => c.suit !== trump);
  if (!trick.length) {
    if (wantWin) {
      const masters = legal.filter((c) => isMaster(c, hand, played));
      const sideMasters = plain(masters);
      if (sideMasters.length) return highest(sideMasters);
      if (masters.length) return highest(masters);
      return lowest(plain(legal).length ? plain(legal) : legal);
    }
    // Lead low, keeping trumps back.
    return lowest(plain(legal).length ? plain(legal) : legal);
  }
  const beats = (card) => trickWinner([...trick, { playerId: -1, card }], trump).playerId === -1;
  const winners = legal.filter(beats);
  const losers = legal.filter((c) => !beats(c));
  if (wantWin) {
    if (!winners.length) return lowest(plain(losers).length ? plain(losers) : losers);
    if (last) return lowest(winners);
    // Not last: play a card the rest can't beat if there is one, else the cheapest win.
    const sure = winners.filter((c) => c.suit === trump || isMaster(c, hand, played));
    const led = trick[0].card.suit;
    if (sure.some((c) => c.suit === led)) return lowest(sure.filter((c) => c.suit === led));
    return lowest(winners);
  }
  // Dodging: shed the most dangerous card that still loses.
  if (losers.length) {
    const side = plain(losers);
    return highest(side.length ? side : losers);
  }
  return last ? highest(winners) : lowest(winners);
}
