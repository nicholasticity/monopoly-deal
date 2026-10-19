// Client-side copy of an online 8-ball game, rebuilt from the server's snapshots, in
// the same shape as PoolGame's state so its table view and human controller work on
// it. Nothing is hidden in pool; state.shot lets the view replay each shot.
import { MirrorGame } from './mirror.js';

export class PoolMirror extends MirrorGame {
  constructor(seats, you) {
    super(seats, you);
    this.kind = 'pool';
    this.state = {
      kind: 'pool',
      players: this.state.players.map(({ id, memberId, name, isHuman, tag }) => ({ id, memberId, name, isHuman, tag, team: id % 2 })),
      balls: [],
      groups: [null, null],
      current: 0,
      phase: 'setup',
      ballInHand: null,
      shots: 0,
      shot: null,
      last: null,
      winners: [],
      winner: null,
    };
  }

  apply(snap) {
    const { state } = this;
    for (const key of ['balls', 'groups', 'current', 'phase', 'ballInHand', 'shots', 'shot', 'last']) state[key] = snap[key];
    state.winners = snap.winners.map((id) => state.players[id]);
    state.winner = state.winners[0] ?? null;
  }
}
