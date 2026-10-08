// Client-side copy of an online game, rebuilt from the server's snapshots. It has
// the same shape as Game (state, allCards, current, playerById) so the table view
// and the human controller work on it unchanged. Cards this player can't see are
// placeholders ({ id, hidden: true }) until the server reveals them.
export class MirrorGame {
  constructor(seats, you) {
    this.you = you;
    this.cards = new Map();
    this.state = {
      players: seats.map((s, i) => ({
        id: i,
        memberId: s.id,
        name: s.name,
        isHuman: i === you,
        tag: '',
        hand: [],
        bank: [],
        piles: [],
      })),
      deck: [],
      discard: [],
      showcase: [],
      current: 0,
      playsLeft: 0,
      play: 0,
      turn: 0,
      winner: null,
      phase: 'setup',
    };
  }

  get allCards() {
    return [...this.cards.values()];
  }

  get current() {
    return this.state.players[this.state.current];
  }

  get me() {
    return this.state.players[this.you] ?? null;
  }

  playerById(id) {
    return this.state.players.find((p) => p.id === id) ?? null;
  }

  card(id) {
    let c = this.cards.get(id);
    if (!c) {
      c = { id, hidden: true };
      this.cards.set(id, c);
    }
    return c;
  }

  apply(snap) {
    for (const info of snap.cards) {
      const c = this.card(info.id);
      delete c.hidden;
      Object.assign(c, info);
    }
    const live = new Set();
    const ref = (id) => {
      live.add(id);
      return this.card(id);
    };
    const opt = (id) => (id == null ? null : ref(id));
    const { state } = this;
    for (const sp of snap.players) {
      // Player objects are kept so anything holding `me` stays current.
      const p = state.players[sp.id];
      p.hand = sp.hand.map(ref);
      p.bank = sp.bank.map(ref);
      p.piles = sp.piles.map((pile) => ({ id: pile.id, color: pile.color, cards: pile.cards.map(ref), house: opt(pile.house), hotel: opt(pile.hotel) }));
    }
    state.deck = snap.deck.map(ref);
    state.discard = snap.discard.map(ref);
    state.showcase = snap.showcase.map(ref);
    state.current = snap.current;
    state.playsLeft = snap.playsLeft;
    state.play = snap.play ?? 0;
    state.turn = snap.turn;
    state.phase = snap.phase;
    state.winner = snap.winner == null ? null : state.players[snap.winner];
    for (const id of this.cards.keys()) if (!live.has(id)) this.cards.delete(id);
  }

  // Rebuilds a Just Say No prompt's context from the ids the server sent.
  justSayNoContext(args) {
    const target = this.playerById(args.targetId);
    return {
      ...args,
      actor: this.playerById(args.actorId),
      target,
      card: args.card == null ? null : this.card(args.card),
      targetCard: args.targetCard == null ? null : this.card(args.targetCard),
      giveCard: args.giveCard == null ? null : this.card(args.giveCard),
      pile: args.pileId == null ? null : target.piles.find((p) => p.id === args.pileId) ?? null,
    };
  }
}
