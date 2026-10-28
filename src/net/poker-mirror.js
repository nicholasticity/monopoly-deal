// Client-side copy of an online Hold'em game, rebuilt from the server's snapshots,
// in the same shape as PokerGame's state so the table and the buttons work on it.
// Other players' hole cards are placeholders until showdown, and folded hands stay hidden.
import { MirrorGame } from './mirror.js';

export class PokerMirror extends MirrorGame {
  constructor(seats, you) {
    super(seats, you);
    this.kind = 'poker';
    this.state = {
      kind: 'poker',
      players: this.state.players.map(({ id, memberId, name, isHuman, tag }) => ({
        id, memberId, name, isHuman, tag,
        hole: [], stack: 0, bet: 0, committed: 0, folded: false, allIn: false, out: false,
        acted: false, canRaise: true, handName: null, won: 0,
      })),
      deck: [],
      board: [],
      button: 0,
      sb: null,
      bb: null,
      current: -1,
      phase: 'setup',
      pot: 0,
      toCall: 0,
      minRaise: 0,
      hand: 0,
      smallBlind: 0,
      bigBlind: 0,
      stack0: 0,
      revealed: false,
      result: null,
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
      p.hole = sp.hole.map(ref);
      p.stack = sp.stack;
      p.bet = sp.bet;
      p.folded = sp.folded;
      p.allIn = sp.allIn;
      p.out = sp.out;
      p.canRaise = sp.canRaise;
      p.handName = sp.handName;
      p.won = sp.won;
    }
    state.deck = snap.deck.map(ref);
    state.board = snap.board.map(ref);
    for (const key of ['button', 'sb', 'bb', 'current', 'phase', 'pot', 'toCall', 'minRaise', 'hand', 'smallBlind', 'bigBlind', 'revealed', 'result']) state[key] = snap[key];
    state.winners = (snap.winners ?? []).map((id) => state.players[id]);
    state.winner = state.winners[0] ?? null;
    for (const id of this.cards.keys()) if (!live.has(id)) this.cards.delete(id);
  }
}
