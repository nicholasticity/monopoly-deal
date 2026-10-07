// Game engine: owns state and runs the turn loop. Decisions are delegated to
// controllers (human UI or AI); presentation is delegated to an optional view.
import { buildDeck, COLORS, describeCard } from './cards.js';
import * as R from './rules.js';
import { autoPayment } from './ai.js';

export class GameAborted extends Error {}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const money = (n) => `$${n}M`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Log grammar for a player named "You" (the human's default name).
const you = (p) => p.name === 'You';
const verb = (p, third, base) => (you(p) ? base : third);
const poss = (p) => (you(p) ? 'your' : `${p.name}'s`);
const obj = (p) => (you(p) ? 'you' : p.name);

export class Game {
  constructor({ players, view = null, rng = Math.random, firstPlayer = null }) {
    this.view = view;
    this.rng = rng;
    this.aborted = false;
    this.listeners = new Set();
    const deck = buildDeck();
    this.allCards = deck.slice();
    this.state = {
      players: players.map((p, i) => ({
        id: i, name: p.name, isHuman: !!p.isHuman, controller: p.controller,
        hand: [], bank: [], piles: [],
      })),
      deck,
      discard: [],
      showcase: [],
      current: firstPlayer ?? Math.floor(rng() * players.length),
      playsLeft: 0,
      turn: 0,
      winner: null,
      phase: 'setup',
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

  async run() {
    const { state } = this;
    shuffle(state.deck, this.rng);
    await this.sync(300);
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < state.players.length; i++) {
        this.draw(state.players[(state.current + i) % state.players.length], 1);
        await this.sync(70);
      }
    }
    this.log(`${this.current.name} ${verb(this.current, 'goes', 'go')} first.`, 'turn');
    await this.sync(350);
    while (!state.winner) {
      await this.playTurn();
      if (state.winner) break;
      state.current = (state.current + 1) % state.players.length;
    }
    state.phase = 'over';
    this.log(`🏆 ${state.winner.name} ${verb(state.winner, 'wins', 'win')} with three full sets!`, 'win');
    await this.sync(200);
    this.emit('gameover', { winner: state.winner });
    return state.winner;
  }

  draw(player, n) {
    const { state } = this;
    let drawn = 0;
    for (let i = 0; i < n; i++) {
      if (state.deck.length === 0) {
        if (state.discard.length === 0) break;
        state.deck = shuffle(state.discard.splice(0), this.rng);
        this.log('The discard pile was shuffled into a new deck.');
      }
      player.hand.push(state.deck.pop());
      drawn++;
    }
    return drawn;
  }

  async playTurn() {
    const { state } = this;
    const me = this.current;
    state.turn++;
    state.playsLeft = R.PLAYS_PER_TURN;
    state.phase = 'draw';
    this.emit('turn', { player: me });
    this.log(you(me) ? 'Your turn' : `${me.name}'s turn`, 'turn');
    const drawn = this.draw(me, me.hand.length === 0 ? 5 : 2);
    this.log(`${me.name} drew ${plural(drawn, 'card')}.`);
    await this.sync(450);

    state.phase = 'play';
    let invalid = 0;
    let freeMoves = 0;
    while (state.playsLeft > 0 && !state.winner) {
      this.emit('state');
      const action = await this.ask(me.controller.chooseTurnAction(this, me));
      if (!action || action.kind === 'end') break;
      const err = R.validateAction(this, me, action);
      if (err) {
        this.log(`${me.name}: ${err}.`, 'warn');
        if (++invalid > 5) break;
        continue;
      }
      if (action.kind === 'moveWild' && ++freeMoves > 12) break;
      await this.execute(me, action);
      this.checkWinner();
    }

    if (!state.winner && me.hand.length > R.HAND_LIMIT) {
      state.phase = 'discard';
      const excess = me.hand.length - R.HAND_LIMIT;
      const ids = await this.ask(me.controller.chooseDiscards(this, me, excess));
      const unique = [...new Set(ids || [])].filter((id) => me.hand.some((c) => c.id === id));
      const chosen = unique.length === excess ? unique : me.hand.slice(-excess).map((c) => c.id);
      for (const id of chosen) state.discard.push(R.takeCard(me, id));
      this.log(`${me.name} discarded ${plural(excess, 'card')} down to ${R.HAND_LIMIT}.`);
      await this.sync(400);
    }
    state.phase = 'idle';
  }

  checkWinner() {
    const { state } = this;
    const n = state.players.length;
    for (let i = 0; i < n; i++) {
      const p = state.players[(state.current + i) % n];
      if (R.hasWon(p)) {
        state.winner = p;
        return true;
      }
    }
    return false;
  }

  playerById(id) {
    return this.state.players.find((p) => p.id === id);
  }

  async execute(me, action) {
    const { state } = this;
    if (action.kind === 'moveWild') {
      const card = R.takeCard(me, action.cardId);
      R.addProperty(me, card, action.color);
      this.log(`${me.name} moved a wild card to ${COLORS[action.color].name}.`);
      await this.sync(350);
      return;
    }

    const card = R.takeCard(me, action.cardId);
    state.playsLeft--;
    switch (action.kind) {
      case 'bank':
        me.bank.push(card);
        this.log(`${me.name} banked ${card.type === 'money' ? money(card.value) : `${describeCard(card)} as ${money(card.value)}`}.`);
        await this.sync(400);
        return;
      case 'property':
        R.addProperty(me, card, action.color);
        this.log(`${me.name} played ${describeCard(card)}${card.type === 'wild' ? ` as ${COLORS[action.color].name}` : ''}.`);
        await this.sync(400);
        return;
      case 'rent':
        await this.playRent(me, card, action);
        return;
      case 'action':
        await this.playAction(me, card, action);
        return;
    }
  }

  async showcase(cards, ms = 900) {
    this.state.showcase.push(...cards);
    await this.sync(ms);
  }

  async clearShowcase(ms = 300) {
    this.state.discard.push(...this.state.showcase.splice(0));
    await this.sync(ms);
  }

  async playRent(me, card, action) {
    const { state } = this;
    const doubles = (action.doubles || []).map((id) => R.takeCard(me, id));
    state.playsLeft -= doubles.length;
    const amount = R.rentFor(me, action.color) * 2 ** doubles.length;
    const colorName = COLORS[action.color].name;
    const targets = card.anyColor ? [this.playerById(action.targetId)] : R.others(this, me);
    const who = card.anyColor ? obj(targets[0]) : 'everyone';
    const extra = doubles.length ? ` (doubled${doubles.length > 1 ? ' twice' : ''})` : '';
    this.log(`${me.name} ${verb(me, 'charges', 'charge')} ${colorName} rent of ${money(amount)}${extra} to ${who}.`, 'action');
    this.toast(`${me.name} ${verb(me, 'charges', 'charge')} ${money(amount)} ${colorName} rent to ${who}!`, 'action');
    await this.showcase([card, ...doubles], 1000);
    for (const target of targets) {
      const ok = await this.resolveNo(me, target, { kind: 'rent', amount, color: action.color, card });
      if (ok) await this.collect(target, me, amount, `${colorName} rent`);
    }
    await this.clearShowcase();
  }

  async playAction(me, card, action) {
    const target = action.targetId != null ? this.playerById(action.targetId) : null;
    switch (card.action) {
      case 'passgo': {
        this.log(`${me.name} played Pass Go.`, 'action');
        await this.showcase([card], 700);
        await this.clearShowcase(150);
        const n = this.draw(me, 2);
        this.log(`${me.name} drew ${plural(n, 'card')}.`);
        await this.sync(450);
        return;
      }
      case 'birthday': {
        this.log(`${me.name} played It's My Birthday! Everyone pays $2M.`, 'action');
        this.toast(`🎂 It's ${poss(me)} birthday! Everyone pays $2M.`, 'action');
        await this.showcase([card], 1000);
        for (const t of R.others(this, me)) {
          if (await this.resolveNo(me, t, { kind: 'birthday', amount: 2, card })) await this.collect(t, me, 2, 'birthday gift');
        }
        await this.clearShowcase();
        return;
      }
      case 'debtcollector': {
        this.log(`${me.name} played Debt Collector on ${obj(target)}.`, 'action');
        this.toast(`💼 ${me.name} ${verb(me, 'demands', 'demand')} $5M from ${obj(target)}!`, 'action');
        await this.showcase([card], 1000);
        if (await this.resolveNo(me, target, { kind: 'debtcollector', amount: 5, card })) await this.collect(target, me, 5, 'Debt Collector');
        await this.clearShowcase();
        return;
      }
      case 'slydeal': {
        const stolen = target.piles.flatMap((p) => p.cards).find((c) => c.id === action.targetCardId);
        this.log(`${me.name} played Sly Deal on ${poss(target)} ${describeCard(stolen)}.`, 'action');
        this.toast(`🦊 ${me.name} ${verb(me, 'tries', 'try')} to steal ${describeCard(stolen)} from ${obj(target)}!`, 'action');
        await this.showcase([card], 1000);
        if (await this.resolveNo(me, target, { kind: 'slydeal', card, targetCard: stolen })) {
          R.takeCard(target, stolen.id);
          R.addProperty(me, stolen, stolen.color);
          this.log(`${me.name} stole ${describeCard(stolen)}.`);
          await this.sync(600);
        }
        await this.clearShowcase();
        return;
      }
      case 'forceddeal': {
        const theirs = target.piles.flatMap((p) => p.cards).find((c) => c.id === action.targetCardId);
        const mine = me.piles.flatMap((p) => p.cards).find((c) => c.id === action.myCardId);
        this.log(`${me.name} played Forced Deal: ${describeCard(mine)} for ${poss(target)} ${describeCard(theirs)}.`, 'action');
        this.toast(`🔄 ${me.name} ${verb(me, 'wants', 'want')} to swap ${describeCard(mine)} for ${poss(target)} ${describeCard(theirs)}!`, 'action');
        await this.showcase([card], 1000);
        if (await this.resolveNo(me, target, { kind: 'forceddeal', card, targetCard: theirs, giveCard: mine })) {
          R.takeCard(target, theirs.id);
          R.takeCard(me, mine.id);
          R.addProperty(me, theirs, theirs.color);
          R.addProperty(target, mine, mine.color);
          this.log(`${me.name} and ${obj(target)} swapped properties.`);
          await this.sync(600);
        }
        await this.clearShowcase();
        return;
      }
      case 'dealbreaker': {
        const pile = target.piles.find((p) => p.id === action.pileId);
        const colorName = COLORS[pile.color].name;
        this.log(`${me.name} played Deal Breaker on ${poss(target)} ${colorName} set.`, 'action');
        this.toast(`💥 ${me.name} ${verb(me, 'wants', 'want')} ${poss(target)} ${colorName} set!`, 'action');
        await this.showcase([card], 1100);
        if (await this.resolveNo(me, target, { kind: 'dealbreaker', card, pile })) {
          target.piles = target.piles.filter((p) => p !== pile);
          me.piles.push(pile);
          R.normalize(me);
          R.normalize(target);
          this.log(`${me.name} took the ${colorName} set from ${obj(target)}.`);
          await this.sync(700);
        }
        await this.clearShowcase();
        return;
      }
      case 'house':
      case 'hotel': {
        const pile = me.piles.find((p) => p.id === action.pileId);
        pile[card.action] = card;
        this.log(`${me.name} built a ${card.action} on ${COLORS[pile.color].name}.`, 'action');
        await this.sync(500);
        return;
      }
    }
  }

  // Runs the Just Say No back-and-forth. Returns true if the action goes ahead.
  async resolveNo(actor, target, ctx) {
    const { state } = this;
    let proceed = true;
    let responder = target;
    let other = actor;
    for (;;) {
      const jsn = responder.hand.find((c) => c.action === 'justsayno');
      if (!jsn) return proceed;
      const use = await this.ask(responder.controller.chooseJustSayNo(this, responder, { ...ctx, actor, target, blocking: proceed }));
      if (!use) return proceed;
      R.takeCard(responder, jsn.id);
      this.log(`${responder.name} ${verb(responder, 'says', 'say')} "Just Say No!"`, 'action');
      this.toast(`✋ ${responder.name}: "Just Say No!"`, 'no');
      await this.showcase([jsn], 900);
      proceed = !proceed;
      [responder, other] = [other, responder];
    }
  }

  async collect(debtor, creditor, amount, reason) {
    const payable = R.payableCards(debtor);
    if (payable.length === 0) {
      this.log(`${debtor.name} ${verb(debtor, 'has', 'have')} nothing to pay.`);
      return;
    }
    let chosen;
    if (R.sum(payable) <= amount) {
      chosen = payable;
    } else {
      const ids = await this.ask(debtor.controller.choosePayment(this, debtor, amount, creditor, reason));
      const unique = [...new Set(ids || [])];
      const picked = unique.map((id) => payable.find((c) => c.id === id)).filter(Boolean);
      chosen = picked.length === unique.length && R.sum(picked) >= amount ? picked : autoPayment(debtor, amount);
    }
    for (const c of chosen) {
      const card = R.takeCard(debtor, c.id);
      if (R.isPropertyCard(card)) R.addProperty(creditor, card, card.color);
      else creditor.bank.push(card);
    }
    const paid = R.sum(chosen);
    this.log(`${debtor.name} paid ${obj(creditor)} ${money(paid)} for ${reason}: ${chosen.map(describeCard).join(', ')}.`, 'pay');
    await this.sync(600);
  }
}
