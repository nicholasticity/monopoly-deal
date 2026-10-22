// Client-side copy of an online Least Count game, rebuilt from the server's snapshots,
// in the same shape as LeastCountGame's state so its table view and human controller
// work on it. Other players' cards are placeholders until a Show.
import { MirrorGame } from './mirror.js';
import { HAND } from '../leastcount/rules.js';

export class LeastCountMirror extends MirrorGame {
  constructor(seats, you) {
    super(seats, you);
    this.kind = 'leastcount';
    this.state = {
      kind: 'leastcount',
      players: this.state.players.map(({ id, memberId, name, isHuman, tag }) => ({
        id, memberId, name, isHuman, tag,
        hand: [], score: 0, history: [], total: null,
      })),
      deck: [],
      discard: [],
      last: null,
      wildCard: null,
      wild: null,
      round: 0,
      rounds: 0,
      handSize: HAND,
      dealer: 0,
      current: 0,
      phase: 'setup',
      caller: null,
      caught: false,
      winners: [],
      winner: null,
    };
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
    const { state } = this;
    for (const sp of snap.players) {
      const p = state.players[sp.id];
      p.hand = sp.hand.map(ref);
      p.score = sp.score;
      p.history = sp.history;
      p.total = sp.total;
    }
    state.deck = snap.deck.map(ref);
    state.discard = snap.discard.map(ref);
    state.last = snap.last && { playerId: snap.last.playerId, cards: snap.last.cards.map(ref) };
    state.wildCard = snap.wildCard == null ? null : ref(snap.wildCard);
    for (const key of ['wild', 'round', 'rounds', 'handSize', 'dealer', 'current', 'phase', 'caller', 'caught']) state[key] = snap[key];
    state.winners = snap.winners.map((id) => state.players[id]);
    state.winner = state.winners[0] ?? null;
    for (const id of this.cards.keys()) if (!live.has(id)) this.cards.delete(id);
  }
}
