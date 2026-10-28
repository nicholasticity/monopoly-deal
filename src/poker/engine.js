// No-limit Texas Hold'em engine. Same interface as the other games (events, sync,
// ask, abort), so the table, the server and the HUD can drive it. The server is
// the only one who runs it online: a snapshot never includes another player's
// hole cards until showdown.
import { GameAborted } from '../game/engine.js';
import { buildDeck, shortName, stakesOf, chipText, handName, evaluate, sidePots, awardPots, normalize, perform, HAND_CAP } from './rules.js';
import { decideAction } from './ai.js';

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// `order` is a list of card keys dealt first (tests). They sit on top of the deck.
function stackDeck(deck, order) {
  const byKey = new Map(deck.map((c) => [c.key, c]));
  const top = [];
  for (const key of order) {
    const card = byKey.get(key);
    if (!card) throw new Error(`missing card ${key}`);
    byKey.delete(key);
    top.push(card);
  }
  return [...byKey.values(), ...top.reverse()];
}

const you = (p) => p.name === 'You';
const verb = (p, third, base) => (you(p) ? base : third);
const listNames = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

const STREETS = [
  { phase: 'preflop', deal: 0 },
  { phase: 'flop', deal: 3 },
  { phase: 'turn', deal: 1 },
  { phase: 'river', deal: 1 },
];

export class PokerGame {
  // stack / blinds: presets (rules.js). order: card keys to deal first, for tests.
  // maxHands: stop after this many hands (the safety cap, or 1 in a test).
  constructor({ players, view = null, rng = Math.random, stack, blinds, smallBlind, bigBlind, order = null, maxHands = HAND_CAP, button = null }) {
    this.kind = 'poker';
    this.view = view;
    this.rng = rng;
    this.order = order;
    this.maxHands = maxHands;
    this.aborted = false;
    this.listeners = new Set();
    const stakes = stakesOf({ stack, blinds, smallBlind, bigBlind });
    // The lobby only offers the presets. A smaller stack is still accepted when it
    // covers the big blind, so a test (or a short game) can run on fewer chips.
    const stack0 = Number.isInteger(stack) && stack > stakes.bigBlind ? stack : stakes.stack;
    const n = players.length;
    const button0 = Number.isInteger(button) ? ((button % n) + n) % n : Math.floor(rng() * n);
    this.state = {
      kind: 'poker',
      players: players.map((p, i) => ({
        id: i,
        name: p.name,
        isHuman: !!p.isHuman,
        controller: p.controller,
        hole: [],
        // A test may seat someone with a shorter stack (side pots).
        stack: Number.isInteger(p.stack) ? p.stack : stack0,
        bet: 0,
        committed: 0,
        folded: false,
        allIn: false,
        out: false,
        acted: false,
        canRaise: true,
        handName: null,
        won: 0,
      })),
      deck: [],
      board: [],
      button: button0,
      sb: null,
      bb: null,
      current: -1,
      phase: 'setup',
      pot: 0,
      toCall: 0,
      minRaise: stakes.bigBlind,
      hand: 0,
      smallBlind: stakes.smallBlind,
      bigBlind: stakes.bigBlind,
      stack0,
      revealed: false,
      result: null,
      winners: [],
      winner: null,
    };
  }

  get current() {
    return this.state.players[this.state.current] ?? null;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, data = {}) {
    for (const fn of this.listeners) fn(type, data);
  }

  log(text, kind = 'info') {
    this.emit('log', { text, kind });
  }

  toast(text, kind = 'info') {
    this.emit('toast', { text, kind });
  }

  abort() {
    this.aborted = true;
  }

  async sync(ms = 400) {
    if (this.aborted) throw new GameAborted();
    this.emit('state');
    if (this.view) await this.view.sync(this, ms);
    if (this.aborted) throw new GameAborted();
  }

  async ask(promise) {
    const result = await promise;
    if (this.aborted) throw new GameAborted();
    return result;
  }

  playerById(id) {
    return this.state.players.find((p) => p.id === id);
  }

  nextIndex(from) {
    const { players } = this.state;
    return (from + 1) % players.length;
  }

  // The next player who still has chips, or null.
  nextWithChips(from) {
    const { players } = this.state;
    for (let i = 1; i <= players.length; i++) {
      const p = players[(from + i) % players.length];
      if (p.stack > 0) return p.id;
    }
    return null;
  }

  live() {
    return this.state.players.filter((p) => p.stack > 0);
  }

  async run() {
    const { state } = this;
    await this.sync(300);
    while (this.live().length >= 2 && state.hand < this.maxHands) {
      await this.playHand();
      const next = this.nextWithChips(state.button);
      if (next == null) break;
      state.button = next;
    }
    state.phase = 'over';
    state.current = -1;
    const best = Math.max(...state.players.map((p) => p.stack));
    state.winners = state.players.filter((p) => p.stack === best);
    state.winner = state.winners[0];
    const names = state.winners.map((p) => p.name);
    const wins = names.length === 1 ? verb(state.winner, 'wins', 'win') : 'share the win';
    const capped = state.hand >= this.maxHands && this.live().length >= 2;
    this.log(`🏆 ${listNames(names)} ${wins} the table with ${chipText(best)}.${capped ? ' Hand limit reached.' : ''}`, 'win');
    await this.sync(200);
    this.emit('gameover', { winner: state.winner, winners: state.winners });
    return state.winner;
  }

  async playHand() {
    const { state } = this;
    const n = state.players.length;
    for (const p of state.players) {
      p.hole = [];
      p.bet = 0;
      p.committed = 0;
      p.folded = false;
      p.allIn = false;
      p.acted = false;
      p.canRaise = true;
      p.out = p.stack <= 0;
      p.handName = null;
      p.won = 0;
    }
    state.board = [];
    state.pot = 0;
    state.toCall = 0;
    state.minRaise = state.bigBlind;
    state.revealed = false;
    state.result = null;
    state.sb = null;
    state.bb = null;
    state.current = -1;
    state.hand += 1;
    let deck = buildDeck();
    if (this.order) {
      deck = stackDeck(deck, this.order);
      this.order = null;
    } else shuffle(deck, this.rng);
    state.deck = deck;

    const seated = state.players.filter((p) => p.stack > 0);
    if (seated.length < 2) return;
    const dealer = state.players[state.button];
    this.log(`Hand ${state.hand} · ${dealer.name} ${verb(dealer, 'deals', 'deal')} · blinds ${chipText(state.smallBlind)}/${chipText(state.bigBlind)}.`, 'turn');
    state.phase = 'blinds';
    this.postBlinds(seated);
    await this.sync(320);

    state.phase = 'deal';
    this.dealHoles(seated);
    await this.sync(380);

    for (const street of STREETS) {
      if (street.deal) {
        if (!this.bettingPossible()) {
          await this.finishHand(true);
          return;
        }
        this.sweep();
        this.dealBoard(street.deal);
        state.phase = street.phase;
        this.logBoard();
        await this.sync(420);
      } else {
        state.phase = 'preflop';
      }
      const start = street.phase === 'preflop' ? this.nextIndex(state.bb) : this.nextIndex(state.button);
      const outcome = await this.bettingRound(start);
      if (outcome === 'uncontested') {
        await this.finishHand(false);
        return;
      }
    }
    await this.finishHand(true);
  }

  postBlinds(seated) {
    const { state } = this;
    const hu = seated.length === 2;
    const sb = hu ? state.players[state.button] : state.players[this.nextWithChips(state.button)];
    const bb = state.players[this.nextWithChips(sb.id)];
    state.sb = sb.id;
    state.bb = bb.id;
    this.post(sb, state.smallBlind, 'small blind');
    this.post(bb, state.bigBlind, 'big blind');
    state.toCall = Math.max(sb.bet, bb.bet);
    state.minRaise = state.bigBlind;
  }

  post(p, amount, label) {
    const pay = Math.min(amount, p.stack);
    p.stack -= pay;
    p.bet += pay;
    p.committed += pay;
    if (p.stack === 0) p.allIn = true;
    this.log(`${p.name} ${verb(p, 'posts', 'post')} the ${label}, ${chipText(pay)}.${p.allIn ? ' All-in.' : ''}`);
  }

  dealHoles(seated) {
    const { state } = this;
    const ids = new Set(seated.map((p) => p.id));
    let seat = state.button;
    for (let r = 0; r < 2; r++) {
      for (let k = 0; k < state.players.length; k++) {
        seat = (seat + 1) % state.players.length;
        if (!ids.has(seat)) continue;
        state.players[seat].hole.push(state.deck.pop());
      }
    }
  }

  dealBoard(k) {
    for (let i = 0; i < k; i++) this.state.board.push(this.state.deck.pop());
  }

  logBoard() {
    const { state } = this;
    const label = { flop: 'Flop', turn: 'Turn', river: 'River' }[state.phase] ?? 'Board';
    this.log(`${label}: ${state.board.map(shortName).join(' ')}.`);
  }

  // Two or more players can still put chips in.
  bettingPossible() {
    const inHand = this.state.players.filter((p) => !p.folded && p.hole.length);
    if (inHand.length < 2) return false;
    return inHand.filter((p) => !p.allIn && p.stack > 0).length >= 2;
  }

  remain() {
    return this.state.players.filter((p) => !p.folded && p.hole.length);
  }

  async bettingRound(startId) {
    const { state } = this;
    if (this.remain().length < 2) return 'uncontested';
    for (const p of state.players) {
      p.canRaise = true;
      p.acted = p.folded || !p.hole.length || p.allIn;
    }
    const canAct = () => state.players.filter((p) => !p.folded && p.hole.length && !p.allIn && p.stack > 0);
    const actors = canAct();
    if (actors.length === 0) return this.remain().length < 2 ? 'uncontested' : 'done';
    // Nobody left who could answer a raise, and the last player has already matched.
    if (actors.length === 1 && actors[0].bet >= state.toCall) return 'done';

    const n = state.players.length;
    let idx = startId;
    // A raise reopens the action, so the cap is in actions, not seats. Stacks run
    // out long before this; it's only here so a broken round can't spin forever.
    for (let guard = 0; state.players.some((p) => !p.acted); guard++) {
      if (guard > 5000) throw new Error('betting round did not end');
      let p = null;
      for (let k = 0; k < n; k++) {
        const cand = state.players[(idx + k) % n];
        if (!cand.acted) {
          p = cand;
          break;
        }
      }
      if (!p) break;
      idx = (p.id + 1) % n;
      state.current = p.id;
      this.emit('turn', { player: p, what: 'act' });
      const move = this.check(p, await this.ask(p.controller.chooseAction(this, p)));
      const result = perform(state, p.id, move);
      this.logAction(p, result);
      await this.sync(260);
      if (this.remain().length < 2) return 'uncontested';
    }
    state.current = -1;
    return 'done';
  }

  // A move as the controller gave it. Anything illegal is played by the bot instead.
  check(p, move) {
    const norm = normalize(this.state, p.id, move);
    if (norm) return norm;
    const auto = normalize(this.state, p.id, decideAction(this.state, p.id, this.rng));
    if (auto) return auto;
    const owed = this.state.toCall - p.bet;
    if (owed <= 0) return { action: 'check' };
    if (p.stack > 0) return { action: 'call' };
    return { action: 'fold' };
  }

  logAction(p, result) {
    const name = p.name;
    if (result.kind === 'fold') this.log(`${name} ${verb(p, 'folds', 'fold')}.`);
    else if (result.kind === 'check') this.log(`${name} ${verb(p, 'checks', 'check')}.`);
    else if (result.kind === 'call') this.log(`${name} ${verb(p, 'calls', 'call')} ${chipText(result.amount)}.`);
    else if (result.kind === 'bet') this.log(`${name} ${verb(p, 'bets', 'bet')} ${chipText(result.to)}.`);
    else if (result.kind === 'raise') this.log(`${name} ${verb(p, 'raises', 'raise')} to ${chipText(result.to)}.`);
    else this.log(`${name} ${verb(p, 'is', 'are')} all-in for ${chipText(result.to)}.`);
  }

  // Pull the chips in front of each player into the pot.
  sweep() {
    const { state } = this;
    for (const p of state.players) {
      state.pot += p.bet;
      p.bet = 0;
    }
    state.toCall = 0;
    state.minRaise = state.bigBlind;
  }

  async dealRemaining() {
    const { state } = this;
    if (state.board.length < 3) {
      this.dealBoard(3 - state.board.length);
      state.phase = 'flop';
      this.logBoard();
      await this.sync(420);
    }
    if (state.board.length < 4) {
      this.dealBoard(1);
      state.phase = 'turn';
      this.logBoard();
      await this.sync(360);
    }
    if (state.board.length < 5) {
      this.dealBoard(1);
      state.phase = 'river';
      this.logBoard();
      await this.sync(360);
    }
  }

  // revealed: show the hole cards and name the hands. Otherwise someone folded out.
  async finishHand(wantShow) {
    const { state } = this;
    this.sweep();
    const remain = this.remain();
    const revealed = wantShow && remain.length >= 2;
    if (revealed && state.board.length < 5) await this.dealRemaining();
    const result = this.award(revealed);
    state.phase = 'showdown';
    state.revealed = revealed;
    state.current = -1;
    state.result = result;
    this.log(result.text, revealed ? 'win' : 'line');
    await this.sync(revealed ? 2000 : 1100);
  }

  award(revealed) {
    const { state } = this;
    const contribs = state.players.filter((p) => p.committed > 0).map((p) => ({ id: p.id, amount: p.committed, folded: p.folded || !p.hole.length }));
    const pots = sidePots(contribs);
    const ranks = {};
    for (const p of state.players) {
      if (p.folded || !p.hole.length) continue;
      if (revealed) {
        const rank = evaluate([...p.hole, ...state.board]);
        p.handName = handName(rank);
        ranks[p.id] = rank;
      } else ranks[p.id] = [0];
    }
    const order = [];
    for (let i = 1; i <= state.players.length; i++) order.push(state.players[(state.button + i) % state.players.length].id);
    const { payouts, pots: awarded } = awardPots(pots, ranks, order);
    let total = 0;
    for (const p of state.players) {
      const win = payouts[p.id] ?? 0;
      p.won = win;
      p.stack += win;
      total += p.committed;
      p.committed = 0;
      p.bet = 0;
    }
    state.pot = total;
    const text = describe(awarded, state.players, revealed);
    return {
      text,
      revealed,
      pots: awarded.map((pot) => ({ amount: pot.amount, winners: pot.winners, shares: pot.shares, hand: revealed ? pot.hand : '' })),
    };
  }
}

function describe(awarded, players, revealed) {
  const label = (id) => (players[id].name === 'You' ? 'You' : players[id].name);
  const verb = (ids) => (ids.length === 1 && players[ids[0]].name === 'You' ? 'win' : 'wins');
  if (!awarded.length) return 'The hand is over.';
  if (!revealed) {
    const id = awarded[0].winners[0];
    const amount = awarded.reduce((s, pot) => s + pot.amount, 0);
    return `${label(id)} ${verb([id])} ${chipText(amount)}.`;
  }
  return awarded.map((pot) => {
    const names = pot.winners.map(label);
    const hand = pot.hand ? ` with ${pot.hand}` : '';
    if (pot.winners.length === 1) return `${names[0]} ${verb(pot.winners)} ${chipText(pot.amount)}${hand}.`;
    const shares = pot.winners.map((id) => `${label(id)} ${chipText(pot.shares[id])}`).join(', ');
    return `${listNames(names)} split ${chipText(pot.amount)}${hand} (${shares}).`;
  }).join(' ');
}
