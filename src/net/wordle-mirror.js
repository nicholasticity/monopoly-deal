// Client-side copy of an online Wordle game, rebuilt from the server's snapshots,
// in the same shape as WordleGame so its table view and human controller work on it.
// Other players' guesses carry only their marks (word: null) until the word is over.
import { MirrorGame } from './mirror.js';

export class WordleMirror extends MirrorGame {
  constructor(seats, you) {
    super(seats, you);
    this.kind = 'wordle';
    this.state = {
      players: this.state.players.map(({ id, memberId, name, isHuman, tag }) => ({
        id, memberId, name, isHuman, tag,
        score: 0, guesses: [], solved: false, done: false,
      })),
      round: 0,
      rounds: 0,
      phase: 'setup',
      answer: null,
      endsAt: 0,
      roundWinner: null,
      history: [],
      winners: [],
      winner: null,
    };
  }

  apply(snap) {
    const { state } = this;
    for (const sp of snap.players) {
      const p = state.players[sp.id];
      p.score = sp.score;
      p.guesses = sp.guesses;
      p.solved = sp.solved;
      p.done = sp.done;
    }
    for (const key of ['round', 'rounds', 'phase', 'answer', 'history']) state[key] = snap[key];
    // The server says how long is left; the clock runs on this computer's time.
    state.endsAt = Date.now() + snap.remaining;
    state.roundWinner = snap.roundWinner == null ? null : state.players[snap.roundWinner];
    state.winners = snap.winners.map((id) => state.players[id]);
    state.winner = state.winners[0] ?? null;
  }
}
