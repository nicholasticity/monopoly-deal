// Judgement engine: owns state and runs the rounds. Same interface as the other
// engines (events, sync, ask, abort), so the view, server and HUD can drive it.
// Controllers answer chooseBid and choosePlay; there's no trump to call.
// The state has Call Bridge's shape (src/callbridge/engine.js), so that game's table
// view, mirror and prompts work on it; `den` is the dealer here.
import { GameAborted } from '../game/engine.js';
import { buildDeck, SUITS, shortName } from '../callbridge/cards.js';
import * as R from './rules.js';
import { chooseBid, chooseCard } from './ai.js';

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
// Log grammar for a player named "You" (the human's default name).
const you = (p) => p.name === 'You';
const verb = (p, third, base) => (you(p) ? base : third);
// "A", "A and B", "A, B and C".
const listNames = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

export class JudgementGame {
  // scoring: 'high', 'medium' or 'low' (rules.js).
  constructor({ players, view = null, rng = Math.random, firstPlayer = null, scoring }) {
    this.kind = 'judgement';
    this.view = view;
    this.rng = rng;
    this.aborted = false;
    this.listeners = new Set();
    const deck = buildDeck();
    this.allCards = deck.slice();
    const dealer = firstPlayer ?? Math.floor(rng() * players.length);
    const sizes = R.handSizes(players.length);
    this.state = {
      kind: 'judgement',
      scoring: R.scoringKey(scoring),
      players: players.map((p, i) => ({
        id: i, name: p.name, isHuman: !!p.isHuman, controller: p.controller,
        hand: [], tricks: [], bid: null, won: 0, score: 0, history: [],
      })),
      deck,
      trick: [],
      trump: null,
      den: dealer,
      round: 0,
      rounds: sizes.length,
      sizes,
      handSize: sizes[0],
      current: dealer,
      leader: dealer,
      phase: 'setup',
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
      state.den = (state.den + 1) % state.players.length;
    }
    state.den = -1;
    state.phase = 'over';
    const top = R.topScore(state.players);
    state.winners = state.players.filter((p) => p.score === top);
    state.winner = state.winners[0];
    const names = state.winners.map((p) => p.name);
    const wins = names.length === 1 ? verb(state.winner, 'wins', 'win') : 'share the win';
    this.log(`🏆 ${listNames(names)} ${wins} with ${top} points!`, 'win');
    await this.sync(200);
    this.emit('gameover', { winner: state.winner, winners: state.winners });
    return state.winner;
  }

  // One card each at a time, starting left of the dealer.
  async deal(count) {
    const { state } = this;
    const n = state.players.length;
    for (let k = 0; k < count; k++) {
      for (let i = 1; i <= n; i++) {
        state.players[(state.den + i) % n].hand.push(state.deck.pop());
        await this.sync(n * count > 40 ? 30 : 60);
      }
    }
  }

  async playRound() {
    const { state } = this;
    const n = state.players.length;
    const size = state.sizes[state.round - 1];
    const dealer = state.players[state.den];
    const first = (dealer.id + 1) % n;

    for (const p of state.players) {
      state.deck.push(...p.hand.splice(0), ...p.tricks.splice(0));
      p.bid = null;
      p.won = 0;
    }
    state.deck.push(...state.trick.splice(0).map((t) => t.card));
    state.handSize = size;
    state.trump = R.trumpFor(state.round);
    state.current = state.leader = first;
    const trumps = state.trump ? `${SUITS[state.trump].symbol} ${SUITS[state.trump].name} are trumps` : 'no trumps';
    this.log(`Round ${state.round} of ${state.rounds} · ${plural(size, 'card')} each, ${trumps} · ${dealer.name} ${verb(dealer, 'deals', 'deal')}.`, 'turn');

    shuffle(state.deck, this.rng);
    state.phase = 'deal';
    await this.sync(450);
    await this.deal(size);
    for (const p of state.players) R.sortHand(p.hand, state.trump);
    await this.sync(300);

    // Everyone bids from the dealer's left; the dealer bids last, and can't make the
    // bids add up to the number of tricks.
    state.phase = 'bid';
    let total = 0;
    for (let i = 0; i < n; i++) {
      const p = state.players[(first + i) % n];
      const forbidden = i === n - 1 ? R.forbiddenBid(total, size) : null;
      state.current = p.id;
      this.emit('turn', { player: p, what: 'bid' });
      this.emit('state');
      const bid = await this.ask(p.controller.chooseBid(this, p, { min: 0, max: size, forbidden }));
      p.bid = R.validBid(bid, size, forbidden) ? bid : chooseBid(this, p, forbidden, this.rng);
      total += p.bid;
      this.log(`${p.name} ${verb(p, 'bids', 'bid')} ${p.bid}.`);
      await this.sync(300);
    }
    const over = total > size ? `${total - size} more than there are` : `${size - total} fewer than there are`;
    this.log(`Bids total ${total} for ${plural(size, 'trick')}: ${over}.`);

    for (let t = 0; t < size; t++) {
      state.phase = 'play';
      for (let i = 0; i < n; i++) {
        const p = state.players[(state.leader + i) % n];
        state.current = p.id;
        this.emit('turn', { player: p, what: 'play' });
        this.emit('state');
        const id = await this.ask(p.controller.choosePlay(this, p));
        const card = R.legalCards(p.hand, state.trick).find((c) => c.id === id) ?? chooseCard(this, p);
        p.hand.splice(p.hand.indexOf(card), 1);
        state.trick.push({ playerId: p.id, card });
        await this.sync(i === n - 1 ? 250 : 380);
      }
      const best = R.trickWinner(state.trick, state.trump);
      const winner = state.players[best.playerId];
      state.phase = 'trick';
      state.current = winner.id;
      this.log(`${winner.name} ${verb(winner, 'takes', 'take')} the trick with ${shortName(best.card)}.`);
      await this.sync(1000);
      winner.tricks.push(...state.trick.splice(0).map((x) => x.card));
      winner.won++;
      state.leader = winner.id;
      await this.sync(450);
    }

    state.phase = 'scoring';
    const results = state.players.map((p) => {
      const points = R.roundPoints(p.bid, p.won, state.scoring);
      p.score += points;
      p.history.push({ bid: p.bid, won: p.won, points });
      this.log(`${p.name}: bid ${p.bid}, won ${p.won} → ${signed(points)} (${p.score}).`, p.won === p.bid ? 'info' : 'warn');
      return { id: p.id, bid: p.bid, won: p.won, points, score: p.score };
    });
    this.emit('round', { round: state.round, results });
    await this.sync(600);
    if (state.round === state.rounds) return;
    // A player on this device holds the next round until they've read the scores;
    // otherwise (bots, online seats) there's a pause.
    const reading = state.players.map((p) => p.controller.roundOver?.(this, results)).filter(Boolean);
    if (reading.length) await this.ask(Promise.all(reading));
    else await this.sync(5000);
  }
}
