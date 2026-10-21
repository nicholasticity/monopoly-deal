// Client-side copy of an online Sudoku game, rebuilt from the server's snapshots, in the
// same shape as SudokuGame so its table view and human controller work on it. Other
// players' grids are just which cells they've filled (mask) until the race is over.
import { MirrorGame } from './mirror.js';
import { CELLS, DEFAULT_LEVEL } from '../sudoku/rules.js';

export class SudokuMirror extends MirrorGame {
  constructor(seats, you) {
    super(seats, you);
    this.kind = 'sudoku';
    this.state = {
      players: this.state.players.map(({ id, memberId, name, isHuman, tag }) => ({
        id, memberId, name, isHuman, tag,
        grid: Array(CELLS).fill(0), mask: null,
        filled: 0, mistakes: 0, solved: false, done: false, time: null, wrong: null,
      })),
      level: DEFAULT_LEVEL,
      puzzle: Array(CELLS).fill(0),
      empty: 0,
      solution: null,
      limited: true,
      phase: 'setup',
      startedAt: 0,
      endedAt: 0,
      winners: [],
      winner: null,
    };
  }

  apply(snap) {
    const { state } = this;
    for (const sp of snap.players) {
      const p = state.players[sp.id];
      p.grid = sp.grid ?? Array(CELLS).fill(0);
      p.mask = sp.mask;
      for (const key of ['filled', 'mistakes', 'solved', 'done', 'time', 'wrong']) p[key] = sp[key];
    }
    for (const key of ['level', 'puzzle', 'empty', 'limited', 'phase', 'solution']) state[key] = snap[key];
    // The clock runs on this computer's time, from how long the server says it's been.
    const now = Date.now();
    state.startedAt = state.phase === 'setup' ? 0 : now - snap.elapsed;
    state.endedAt = state.phase === 'over' ? now : 0;
    state.winners = snap.winners.map((id) => state.players[id]);
    state.winner = state.winners[0] ?? null;
  }
}
