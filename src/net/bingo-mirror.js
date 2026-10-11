// Client-side copy of an online Bingo game, rebuilt from the server's snapshots,
// in the same shape as BingoGame so its table view and human controller work on it.
// Other players' grids stay null until the game is over.
import { MirrorGame } from './mirror.js';

export class BingoMirror extends MirrorGame {
  constructor(seats, you) {
    super(seats, you);
    this.kind = 'bingo';
    this.state = {
      players: this.state.players.map(({ id, memberId, name, isHuman, tag }) => ({
        id, memberId, name, isHuman, tag,
        grid: null, ready: false, lines: 0,
      })),
      called: [],
      callers: [],
      first: 0,
      current: 0,
      phase: 'setup',
      winners: [],
      winner: null,
    };
  }

  apply(snap) {
    const { state } = this;
    for (const sp of snap.players) {
      const p = state.players[sp.id];
      p.grid = sp.grid;
      p.ready = sp.ready;
      p.lines = sp.lines;
    }
    for (const key of ['called', 'callers', 'first', 'current', 'phase']) state[key] = snap[key];
    state.winners = snap.winners.map((id) => state.players[id]);
    state.winner = state.winners[0] ?? null;
  }
}
