// Hand rankings and side pots for no-limit Hold'em.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, compareHands, handName, sidePots, awardPots, legalActions, normalize, perform, stakesOf, DEFAULT_STACK, DEFAULT_BLINDS } from '../src/poker/rules.js';
import { PokerGame } from '../src/poker/engine.js';
import { PokerAI, decideAction } from '../src/poker/ai.js';

const card = (rank, suit) => ({ rank, suit, key: `${suit}-${rank}` });
const C = (ranks, suit) => ranks.map((r) => card(r, suit));
const hole = (...cards) => cards;

function hand(cards) {
  const rank = evaluate(cards);
  return { rank, name: handName(rank) };
}

test('defaults are 1,000 chips and blinds 10/20', () => {
  const s = stakesOf({});
  assert.equal(s.stack, DEFAULT_STACK);
  assert.equal(s.stack, 1000);
  assert.deepEqual(DEFAULT_BLINDS, { small: 10, big: 20 });
  assert.equal(s.blinds, '10/20');
  assert.equal(stakesOf({ stack: 200, blinds: '25/50' }).blinds, '25/50');
  assert.equal(stakesOf({ stack: 999, blinds: 'nope' }).stack, 1000);
  assert.equal(stakesOf({ stack: 999, blinds: 'nope' }).blinds, '10/20');
});

test('categories rank in order and the wheel is the low straight', () => {
  const royal = hand([...C([14, 13, 12, 11, 10], 'spades')]);
  const kingSF = hand([...C([13, 12, 11, 10, 9], 'hearts')]);
  const wheelSF = hand([...C([14, 5, 4, 3, 2], 'clubs')]);
  const quads = hand([card(9, 'spades'), card(9, 'hearts'), card(9, 'clubs'), card(9, 'diamonds'), card(14, 'spades')]);
  const boat = hand([card(14, 'spades'), card(14, 'hearts'), card(14, 'clubs'), card(13, 'diamonds'), card(13, 'spades')]);
  const flush = hand([...C([14, 9, 7, 4, 2], 'diamonds')]);
  const straight = hand([card(10, 'spades'), card(9, 'hearts'), card(8, 'clubs'), card(7, 'diamonds'), card(6, 'spades')]);
  const wheel = hand([card(14, 'spades'), card(5, 'hearts'), card(4, 'clubs'), card(3, 'diamonds'), card(2, 'spades')]);
  const trips = hand([card(8, 'spades'), card(8, 'hearts'), card(8, 'clubs'), card(14, 'diamonds'), card(7, 'spades')]);
  const two = hand([card(14, 'spades'), card(14, 'hearts'), card(13, 'clubs'), card(13, 'diamonds'), card(2, 'spades')]);
  const pair = hand([card(14, 'spades'), card(14, 'hearts'), card(13, 'clubs'), card(9, 'diamonds'), card(4, 'spades')]);
  const high = hand([card(14, 'spades'), card(13, 'hearts'), card(9, 'clubs'), card(6, 'diamonds'), card(2, 'spades')]);

  const order = [royal, kingSF, wheelSF, quads, boat, flush, straight, wheel, trips, two, pair, high];
  for (let i = 0; i < order.length - 1; i++) {
    assert.equal(compareHands(order[i].rank, order[i + 1].rank), 1, `${order[i].name} should beat ${order[i + 1].name}`);
  }
  assert.equal(royal.name, 'a royal flush');
  assert.equal(wheelSF.name, 'a straight flush, Five high');
  assert.equal(wheel.name, 'a straight, Five high');
  assert.equal(compareHands(wheel.rank, hand([card(6, 'spades'), card(5, 'hearts'), card(4, 'clubs'), card(3, 'diamonds'), card(2, 'spades')]).rank), -1);
  assert.equal(compareHands(royal.rank, hand([...C([14, 13, 12, 11, 10], 'hearts')]).rank), 0);
});

test('kickers and pairs break ties', () => {
  const acesKing = evaluate([card(14, 'spades'), card(14, 'hearts'), card(13, 'clubs'), card(9, 'diamonds'), card(4, 'spades')]);
  const acesQueen = evaluate([card(14, 'clubs'), card(14, 'diamonds'), card(12, 'hearts'), card(9, 'spades'), card(4, 'hearts')]);
  assert.equal(compareHands(acesKing, acesQueen), 1);
  const twoPairQ = evaluate([card(14, 'spades'), card(14, 'hearts'), card(13, 'clubs'), card(13, 'diamonds'), card(12, 'spades')]);
  const twoPairJ = evaluate([card(14, 'clubs'), card(14, 'diamonds'), card(13, 'spades'), card(13, 'hearts'), card(11, 'clubs')]);
  assert.equal(compareHands(twoPairQ, twoPairJ), 1);
  const boats = evaluate([card(14, 'spades'), card(14, 'hearts'), card(14, 'clubs'), card(13, 'diamonds'), card(13, 'spades')]);
  const boatsQueens = evaluate([card(14, 'spades'), card(14, 'hearts'), card(14, 'diamonds'), card(12, 'clubs'), card(12, 'hearts')]);
  assert.equal(compareHands(boats, boatsQueens), 1);
  assert.equal(handName(boats), 'a full house, Aces full of Kings');
  const quadsAce = evaluate([card(9, 'spades'), card(9, 'hearts'), card(9, 'clubs'), card(9, 'diamonds'), card(14, 'spades')]);
  const quadsKing = evaluate([card(9, 'spades'), card(9, 'hearts'), card(9, 'clubs'), card(9, 'diamonds'), card(13, 'hearts')]);
  assert.equal(compareHands(quadsAce, quadsKing), 1);
});

test('the best five of seven cards play, not the other two', () => {
  // Pair of twos in hand, aces full of kings on the board.
  const full = evaluate([
    card(2, 'clubs'), card(2, 'diamonds'),
    card(14, 'spades'), card(14, 'hearts'), card(14, 'clubs'), card(13, 'diamonds'), card(13, 'spades'),
  ]);
  assert.equal(handName(full), 'a full house, Aces full of Kings');
  // Hole cards don't play: the board is a royal flush.
  const royal = evaluate([
    card(2, 'clubs'), card(7, 'diamonds'),
    ...C([14, 13, 12, 11, 10], 'spades'),
  ]);
  assert.equal(handName(royal), 'a royal flush');
  // Ace-high straight uses the hole ace; a pair on board doesn't win.
  const straight = evaluate([
    card(14, 'hearts'), card(2, 'clubs'),
    card(13, 'spades'), card(12, 'diamonds'), card(11, 'clubs'), card(10, 'hearts'), card(3, 'spades'),
  ]);
  assert.equal(handName(straight), 'a straight, Ace high');
  assert.equal(evaluate([card(14, 'spades'), card(13, 'hearts')]), null);
});

test('side pots pay only up to what each player put in', () => {
  // A all-in 50, B all-in 100, C called 100. Main 150, side 100.
  const pots = sidePots([
    { id: 0, amount: 50, folded: false },
    { id: 1, amount: 100, folded: false },
    { id: 2, amount: 100, folded: false },
  ]);
  assert.deepEqual(pots, [
    { amount: 150, eligible: [0, 1, 2] },
    { amount: 100, eligible: [1, 2] },
  ]);
  const ranks = { 0: [6, 14, 13], 1: [2, 13, 10, 4], 2: [1, 12, 11, 9, 8] };
  // A has the best hand and takes the main; B beats C for the side.
  const paid = awardPots(pots, ranks, [1, 2, 0]);
  assert.equal(paid.payouts[0], 150);
  assert.equal(paid.payouts[1], 100);
  assert.equal(paid.payouts[2], undefined);
  assert.equal(paid.payouts[0] + paid.payouts[1], 250);

  // The short stack loses. B wins both.
  const bWins = awardPots(pots, { 0: [1, 10, 9, 8, 7], 1: [8, 14], 2: [4, 12] }, [0, 1, 2]);
  assert.equal(bWins.payouts[1], 250);
  assert.equal(bWins.payouts[0], undefined);
});

test('folded chips stay in the pot and a tie splits, odd chip left of the button', () => {
  // Blind folded for 10, two players put in 100. One pot, the folder is out of it.
  const pots = sidePots([
    { id: 0, amount: 10, folded: true },
    { id: 1, amount: 100, folded: false },
    { id: 2, amount: 100, folded: false },
  ]);
  assert.deepEqual(pots, [{ amount: 210, eligible: [1, 2] }]);
  // Same hand. Button is seat 0, so order left of the button is 1, 2, 0.
  // 210 / 2 = 105 even.
  const even = awardPots(pots, { 1: [1, 14, 13, 9, 4], 2: [1, 14, 13, 9, 4] }, [1, 2, 0]);
  assert.equal(even.payouts[1], 105);
  assert.equal(even.payouts[2], 105);
  // 211: seat 1 is first left of the button and takes the odd chip.
  const odd = awardPots([{ amount: 211, eligible: [1, 2] }], { 1: [4, 10], 2: [4, 10] }, [1, 2, 0]);
  assert.equal(odd.payouts[1], 106);
  assert.equal(odd.payouts[2], 105);
  // Seat 2 is first left of a button on seat 1.
  const other = awardPots([{ amount: 5, eligible: [0, 2] }], { 0: [0, 14], 2: [0, 14] }, [2, 0, 1]);
  assert.equal(other.payouts[2], 3);
  assert.equal(other.payouts[0], 2);
  // A folded player with a better "hand" still can't win.
  const denied = awardPots(pots, { 0: [8, 14], 1: [1, 8, 7, 6, 5], 2: [0, 14, 13, 9, 4] }, [1, 2, 0]);
  assert.equal(denied.payouts[1], 210);
  assert.equal(denied.payouts[0], undefined);
});

function actor(id, extra = {}) {
  return {
    id,
    hole: [{}, {}],
    stack: 200,
    bet: 0,
    committed: 0,
    folded: false,
    allIn: false,
    out: false,
    acted: false,
    canRaise: true,
    ...extra,
  };
}

function street(players, extra = {}) {
  return { phase: 'flop', current: 0, toCall: 0, minRaise: 20, bigBlind: 20, pot: 60, players, ...extra };
}

test('betting: check, bet, raise, call, short all-in does not reopen', () => {
  const players = [actor(0), actor(1), actor(2)];
  const state = street(players);
  state.current = 0;
  let opts = legalActions(state, 0);
  assert.equal(opts.check, true);
  assert.equal(opts.fold, false);
  assert.deepEqual(opts.bet, { min: 20, max: 200 });
  perform(state, 0, { action: 'bet', to: 50 });
  assert.equal(state.toCall, 50);
  assert.equal(state.minRaise, 50);
  assert.equal(players[0].acted, true);
  assert.equal(players[1].acted, false);
  assert.equal(players[1].canRaise, true);

  state.current = 1;
  // A raise under the minimum is rejected.
  assert.equal(normalize(state, 1, { action: 'raise', to: 70 }), null);
  perform(state, 1, normalize(state, 1, { action: 'raise', to: 100 }));
  assert.equal(state.toCall, 100);
  assert.equal(players[0].acted, false);
  assert.equal(players[0].canRaise, true);

  // Seat 2 pushes 130, only 30 more than 100, short of a full raise (50).
  state.current = 2;
  players[2].stack = 130;
  const short = perform(state, 2, { action: 'allin' });
  assert.equal(short.kind, 'allin');
  assert.equal(state.toCall, 130);
  assert.equal(state.minRaise, 50);
  // Seat 1 had acted, so the short all-in does not let them raise again.
  assert.equal(players[1].canRaise, false);
  assert.equal(players[1].acted, false);
  // Seat 0 had not acted since the raise to 100... wait, the raise to 100 set seat 0 acted false.
  // Seat 0 had acted false, so they may still raise.
  assert.equal(players[0].canRaise, true);
  state.current = 0;
  const closed = legalActions(state, 1);
  state.current = 1;
  assert.equal(legalActions(state, 1).bet, null);
  assert.equal(legalActions(state, 1).call, 30);
  assert.equal(closed.bet, null);
  state.current = 0;
  assert.equal(legalActions(state, 0).bet.min, 180);
});

test('an all-in for less than a call is not a raise', () => {
  const players = [actor(0, { bet: 20, stack: 30, committed: 20 }), actor(1, { bet: 80, stack: 100, committed: 80 })];
  const state = street(players, { phase: 'preflop', current: 0, toCall: 80, minRaise: 40, pot: 0 });
  const opts = legalActions(state, 0);
  assert.equal(opts.call, 30);
  assert.equal(opts.bet, null);
  assert.equal(opts.allIn, 50);
  const result = perform(state, 0, { action: 'call' });
  assert.equal(result.kind, 'allin');
  assert.equal(players[0].stack, 0);
  assert.equal(state.toCall, 80);
  assert.equal(players[1].acted, false);
});

function queue(moves) {
  return { async chooseAction() { return moves.shift(); } };
}

function total(game) {
  return game.state.players.reduce((s, p) => s + p.stack, 0);
}

test('the table is asked to move on after a hand', async () => {
  let asked = 0;
  const you = {
    async chooseAction() { return { action: 'fold' }; },
    handOver() {
      asked++;
      return Promise.resolve();
    },
  };
  const game = new PokerGame({
    button: 0,
    stack: 200,
    smallBlind: 10,
    bigBlind: 20,
    maxHands: 1,
    players: [
      { name: 'You', isHuman: true, controller: you },
      { name: 'B', controller: queue([{ action: 'fold' }]) },
    ],
  });
  await game.run();
  assert.equal(asked, 1);
  assert.equal(game.state.phase, 'over');
});

test('folding to the big blind pays them the small blind', async () => {
  const game = new PokerGame({
    button: 0,
    stack: 200,
    smallBlind: 10,
    bigBlind: 20,
    maxHands: 1,
    players: [
      { name: 'A', controller: queue([{ action: 'fold' }]) },
      { name: 'B', controller: queue([{ action: 'fold' }]) },
      { name: 'C', controller: queue([]) },
    ],
  });
  await game.run();
  // Button A, SB B, BB C. A and B fold. C wins the 30.
  assert.deepEqual(game.state.players.map((p) => p.stack), [200, 190, 210]);
  assert.equal(total(game), 600);
  assert.equal(game.state.revealed, false);
  assert.match(game.state.result.text, /^C wins 30/);
});

test('a rigged showdown awards the best hand and hides nothing once it is shown', async () => {
  // Button 0. Deal order left of the button: P1, P2, P0, then again, then the board.
  // P1 2♣ 7♦, P2 K♦ Q♥, P0 A♥ A♦. Board 9♠ 8♥ 4♣ 3♦ 2♠. P0's aces win.
  const order = ['clubs-2', 'diamonds-13', 'hearts-14', 'diamonds-7', 'hearts-12', 'diamonds-14', 'spades-9', 'hearts-8', 'clubs-4', 'diamonds-3', 'spades-2'];
  const game = new PokerGame({
    button: 0,
    stack: 100,
    smallBlind: 10,
    bigBlind: 20,
    order,
    maxHands: 1,
    players: [
      { name: 'A', controller: queue([{ action: 'allin' }]) },
      { name: 'B', controller: queue([{ action: 'allin' }]) },
      { name: 'C', controller: queue([{ action: 'allin' }]) },
    ],
  });
  await game.run();
  assert.equal(game.state.revealed, true);
  assert.equal(game.state.players[0].stack, 300);
  assert.equal(game.state.players[1].stack, 0);
  assert.equal(game.state.players[2].stack, 0);
  assert.equal(game.state.players[0].handName, 'a pair of Aces');
  assert.match(game.state.result.text, /A wins 300 with a pair of Aces/);
  assert.equal(game.state.winners[0].id, 0);
  assert.equal(total(game), 300);
});

test('the board plays for everyone and an even pot splits', async () => {
  // Heads-up, button is the small blind. First card goes to the big blind.
  // Junk hole cards, royal flush on the board.
  const order = ['clubs-2', 'diamonds-4', 'hearts-3', 'spades-5', 'spades-14', 'spades-13', 'spades-12', 'spades-11', 'spades-10'];
  const game = new PokerGame({
    button: 0,
    stack: 100,
    smallBlind: 10,
    bigBlind: 20,
    order,
    maxHands: 1,
    players: [
      { name: 'A', controller: queue([{ action: 'allin' }]) },
      { name: 'B', controller: queue([{ action: 'call' }]) },
    ],
  });
  await game.run();
  assert.equal(game.state.players[0].handName, 'a royal flush');
  assert.equal(game.state.players[1].handName, 'a royal flush');
  assert.deepEqual(game.state.players.map((p) => p.stack), [100, 100]);
  assert.match(game.state.result.text, /split 200/);
  assert.equal(game.state.winners.length, 2);
});

test('bots play to one winner and chips are conserved', async () => {
  const rng = mulberry32(7);
  const n = 4;
  const stack = 200;
  const players = Array.from({ length: n }, (_, i) => ({ name: `P${i}`, controller: new PokerAI({ rng: mulberry32(20 + i) }) }));
  const game = new PokerGame({ players, rng, stack, smallBlind: 25, bigBlind: 50 });
  await game.run();
  assert.equal(total(game), n * stack);
  assert.equal(game.state.players.filter((p) => p.stack > 0).length, 1);
  assert.ok(game.state.hand < 80, `took ${game.state.hand} hands`);
  // Every decision the bots return is legal at the moment it's made: covered by
  // the engine rejecting anything else, and by a direct check here.
  const sample = street([actor(0, { hole: [card(14, 'spades'), card(14, 'hearts')] }), actor(1), actor(2)], { current: 0, board: [] });
  const move = decideAction(sample, 0, () => 0);
  assert.ok(normalize(sample, 0, move));
});

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
