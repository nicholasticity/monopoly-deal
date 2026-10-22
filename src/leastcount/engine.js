// Least Count engine: owns state and runs the rounds. Same interface as the other
// engines (events, sync, ask, abort), so the view, server and HUD can drive it.
// Each round: seven cards each and a card turned up for the wild rank; then in turn,
// starting left of the dealer, each player either calls Show or throws (one card, a
// set or a run: chooseThrow) and takes a card from the deck or from what the player
// before them threw. A Show ends the round: hands are shown and scored (rules.js).
// After the last round the lowest total wins.
import { GameAborted } from '../game/engine.js';
import * as R from './rules.js';
import { decideThrow } from './ai.js';

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Log grammar for a player named "You" (the human's default name).
const you = (p) => p.name === 'You';
const verb = (p, third, base) => (you(p) ? base : third);
const listNames = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// A round that somehow nobody ends (players who never call Show) is called for the
// player on turn after this many turns.
const MAX_TURNS = 400;

export class LeastCountGame {
  // rounds: how many rounds a game is.
  constructor({ players, view = null, rng = Math.random, rounds = R.DEFAULT_ROUNDS, firstPlayer = null }) {
    this.kind = 'leastcount';
    this.view = view;
    this.rng = rng;
    this.aborted = false;
    this.listeners = new Set();
    const deck = R.buildDeck(R.decksFor(players.length));
    this.allCards = deck.slice();
    const dealer = firstPlayer ?? Math.floor(rng() * players.length);
    this.state = {
      kind: 'leastcount',
      players: players.map((p, i) => ({
        id: i, name: p.name, isHuman: !!p.isHuman, controller: p.controller,
        hand: [], score: 0, history: [],
        // The hand's total once it's shown (after a Show).
        total: null,
      })),
      deck,
      // Cards thrown earlier, face up; the last throw is apart, and can be taken from.
      discard: [],
      last: null, // { playerId (null: turned up at the start), cards }
      // The card turned up for the round, and its rank: every card of it is worth 0.
      wildCard: null,
      wild: null,
      round: 0,
      rounds: R.roundCount(rounds),
      handSize: R.HAND,
      dealer,
      current: dealer,
      phase: 'setup',
      // Who called Show this round, and whether someone had as few points or fewer.
      caller: null,
      caught: false,
      winners: [],
      winner: null,
    };
  }

  get current() {
    return this.state.players[this.state.current];
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

  async run() {
    const { state } = this;
    await this.sync(300);
    for (let r = 1; r <= state.rounds; r++) {
      state.round = r;
      await this.playRound();
      state.dealer = (state.dealer + 1) % state.players.length;
    }
    state.phase = 'over';
    const low = Math.min(...state.players.map((p) => p.score));
    state.winners = state.players.filter((p) => p.score === low);
    state.winner = state.winners[0];
    const names = state.winners.map((p) => p.name);
    const wins = names.length === 1 ? verb(state.winner, 'wins', 'win') : 'share the win';
    this.log(`🏆 ${listNames(names)} ${wins} with the least: ${plural(low, 'point')}.`, 'win');
    await this.sync(200);
    this.emit('gameover', { winner: state.winner, winners: state.winners });
    return state.winner;
  }

  // The next card from the deck; when it runs out, the thrown cards (all but the last
  // throw) are shuffled into a new one.
  draw() {
    const { state } = this;
    if (!state.deck.length && state.discard.length) {
      state.deck.push(...shuffle(state.discard.splice(0), this.rng));
      this.log('The deck ran out: the thrown cards are shuffled into a new one.');
    }
    return state.deck.pop() ?? null;
  }

  async playRound() {
    const { state } = this;
    const n = state.players.length;
    // Everything back in the deck.
    for (const p of state.players) {
      state.deck.push(...p.hand.splice(0));
      p.total = null;
    }
    state.deck.push(...state.discard.splice(0), ...(state.last?.cards ?? []));
    if (state.wildCard) state.deck.push(state.wildCard);
    state.last = null;
    state.wildCard = null;
    state.wild = null;
    state.caller = null;
    state.caught = false;
    shuffle(state.deck, this.rng);
    const dealer = state.players[state.dealer];
    this.log(`Round ${state.round} of ${state.rounds} · ${dealer.name} ${verb(dealer, 'deals', 'deal')}.`, 'turn');

    state.phase = 'deal';
    await this.sync(450);
    for (let k = 0; k < R.HAND; k++) {
      for (let i = 1; i <= n; i++) {
        state.players[(state.dealer + i) % n].hand.push(state.deck.pop());
        await this.sync(n * R.HAND > 40 ? 25 : 50);
      }
    }
    for (const p of state.players) R.sortHand(p.hand);
    // The wild card: a printed joker doesn't name a rank, so it goes back and another is turned.
    let wild = state.deck.pop();
    while (wild.joker) {
      state.deck.splice(Math.floor(this.rng() * state.deck.length), 0, wild);
      wild = state.deck.pop();
    }
    state.wildCard = wild;
    state.wild = wild.rank;
    // And one card to start the throws, so the first player can take it.
    state.last = { playerId: null, cards: [state.deck.pop()] };
    this.log(`Wild card: ${R.cardName(wild)}. All ${R.rankPlural(wild.rank)} count 0 this round, like the jokers.`);
    await this.sync(500);

    state.phase = 'turn';
    state.current = (state.dealer + 1) % n;
    for (let turn = 0; ; turn++) {
      const p = this.current;
      this.emit('turn', { player: p, what: 'throw' });
      this.emit('state');
      const move = turn >= MAX_TURNS ? { show: true } : this.check(p, await this.ask(p.controller.chooseThrow(this, p)));
      if (move.show) break;
      this.apply(p, move);
      await this.sync(450);
      state.current = (state.current + 1) % n;
    }
    await this.show(this.current);
  }

  // A move as the controller gave it (online, a client could send anything), checked:
  // { show: true }, or { cards, take } with real cards. Anything that won't do is played
  // by the AI instead.
  check(p, move) {
    if (move?.show === true) return { show: true };
    const ids = Array.isArray(move?.throw) ? move.throw : null;
    const cards = ids && [...new Set(ids)].map((id) => p.hand.find((c) => c.id === id));
    const take = move?.take === 'deck' ? 'deck' : this.state.last?.cards.find((c) => c.id === move?.take) ?? null;
    if (cards?.length && cards.length === ids.length && cards.every(Boolean) && R.throwKind(cards) && take) return { cards, take };
    const auto = decideThrow(this, p, this.rng);
    return auto.show ? auto : { cards: auto.throw.map((id) => p.hand.find((c) => c.id === id)), take: auto.take === 'deck' ? 'deck' : this.state.last.cards.find((c) => c.id === auto.take) };
  }

  // Throw, then take: from the deck, or one card of the throw before.
  apply(p, { cards, take }) {
    const { state } = this;
    for (const c of cards) p.hand.splice(p.hand.indexOf(c), 1);
    const before = state.last?.cards ?? [];
    let got;
    if (take === 'deck') {
      state.discard.push(...before);
      got = this.draw();
    } else {
      state.discard.push(...before.filter((c) => c !== take));
      got = take;
    }
    state.last = { playerId: p.id, cards: R.throwOrder(cards) };
    if (got) p.hand.push(got);
    R.sortHand(p.hand);
    const takes = `${verb(p, 'takes', 'take')} ${take === 'deck' ? 'from the deck' : R.cardName(take)}`;
    this.log(`${p.name} ${verb(p, 'throws', 'throw')} ${R.cardsName(state.last.cards)} and ${takes}.`);
  }

  // `caller` calls Show: everyone's hand is shown and scored.
  async show(caller) {
    const { state } = this;
    const totals = {};
    for (const p of state.players) totals[p.id] = p.total = R.handTotal(p.hand, state.wild);
    const { points, caught } = R.showPoints(totals, caller.id);
    state.phase = 'show';
    state.caller = caller.id;
    state.caught = caught;
    this.log(`${caller.name} ${verb(caller, 'calls', 'call')} Show with ${plural(totals[caller.id], 'point')}!`, 'turn');
    await this.sync(1600);
    if (caught) {
      const beat = state.players.filter((p) => p !== caller && totals[p.id] <= totals[caller.id]);
      this.log(`Caught! ${listNames(beat.map((p) => `${p.name} (${totals[p.id]})`))} ${beat.length > 1 || you(beat[0]) ? 'have' : 'has'} as few or fewer: ${caller.name} ${verb(caller, 'scores', 'score')} ${R.CAUGHT}.`, 'warn');
    } else {
      this.log(`${caller.name} ${verb(caller, 'has', 'have')} the least and ${verb(caller, 'scores', 'score')} 0.`, 'line');
    }
    state.phase = 'scoring';
    const results = state.players.map((p) => {
      p.score += points[p.id];
      p.history.push({ points: points[p.id], total: totals[p.id], show: p === caller, caught: p === caller && caught });
      return { id: p.id, total: totals[p.id], points: points[p.id], score: p.score, cards: p.hand.map(({ key, suit, rank, joker }) => ({ key, suit, rank, joker })) };
    });
    this.emit('round', { round: state.round, results, caller: caller.id, caught });
    await this.sync(600);
    if (state.round === state.rounds) return;
    // A player on this device holds the next round until they've read the scores;
    // otherwise (bots, online seats) there's a pause.
    const reading = state.players.map((p) => p.controller.roundOver?.(this, results)).filter(Boolean);
    if (reading.length) await this.ask(Promise.all(reading));
    else await this.sync(5000);
  }
}
