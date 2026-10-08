// Client-side copy of an online Judgement game, rebuilt from the server's snapshots,
// in the same shape as JudgementGame so its table view and human controller work on it.
import { MirrorGame } from './mirror.js';

export class JudgementMirror extends MirrorGame {
  constructor(seats, you) {
    super(seats, you);
    this.kind = 'judgement';
    this.state = {
      players: this.state.players.map(({ id, memberId, name, isHuman, tag }) => ({
        id, memberId, name, isHuman, tag,
        hand: [], tricks: [], bid: null, won: 0, score: 0, history: [],
      })),
      deck: [],
      trick: [],
      trump: null,
      den: 0,
      round: 0,
      rounds: seats.length,
      handSize: 0,
      current: 0,
      leader: 0,
      phase: 'setup',
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
      p.tricks = sp.tricks.map(ref);
      p.bid = sp.bid;
      p.won = sp.won;
      p.score = sp.score;
      p.history = sp.history;
    }
    state.deck = snap.deck.map(ref);
    state.trick = snap.trick.map((t) => ({ playerId: t.playerId, card: ref(t.card) }));
    for (const key of ['trump', 'den', 'round', 'rounds', 'handSize', 'current', 'leader', 'phase']) state[key] = snap[key];
    state.winners = snap.winners.map((id) => state.players[id]);
    state.winner = state.winners[0] ?? null;
    for (const id of this.cards.keys()) if (!live.has(id)) this.cards.delete(id);
  }
}
