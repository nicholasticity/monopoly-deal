// Sudoku engine: owns state and runs the game. Same interface as the other engines
// (events, sync, ask, abort), so the view, server and HUD can drive it.
// One puzzle, raced: everyone fills in the same grid at once (chooseMove, asked again
// after each move). A right number goes in; a wrong one doesn't, and counts as a
// mistake (in a race, MAX_MISTAKES and you're out). The first to fill the grid wins
// and the race ends there; stopMove then tells every controller to stop.
import { GameAborted } from '../game/engine.js';
import * as R from './rules.js';

// Log grammar for a player named "You" (the human's default name).
const you = (p) => p.name === 'You';
const verb = (p, third, base) => (you(p) ? base : third);
// A move that won't do (online, a client could send anything) is ignored; this many in a
// row and that player sits the puzzle out.
const MAX_MISSES = 20;

export const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
};

export class SudokuGame {
  constructor({ players, view = null, rng = Math.random, level = R.DEFAULT_LEVEL }) {
    this.kind = 'sudoku';
    this.view = view;
    this.rng = rng;
    this.aborted = false;
    this.listeners = new Set();
    this.endRace = null;
    this.solution = null;
    this.state = {
      players: players.map((p, i) => ({
        id: i, name: p.name, isHuman: !!p.isHuman, controller: p.controller,
        // The numbers this player has put in (only right ones go in), 0 elsewhere.
        grid: Array(R.CELLS).fill(0),
        filled: 0, mistakes: 0, solved: false, done: false,
        // How long they took, once they've filled the grid (ms).
        time: null,
        // Their last wrong number: { cell, digit, n } (n counts them, so each one shows).
        wrong: null,
      })),
      level: R.levelOf(level),
      // The starting numbers (0: empty), and how many cells there are to fill.
      puzzle: Array(R.CELLS).fill(0),
      empty: 0,
      // The answer; the server only shows it once the race is over.
      solution: null,
      // In a race (more than one player) mistakes are limited.
      limited: players.length > 1,
      phase: 'setup',
      startedAt: 0,
      endedAt: 0,
      winners: [],
      winner: null,
    };
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
    this.endRace?.();
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
    const { puzzle, solution } = R.makePuzzle(state.level, this.rng);
    state.puzzle = puzzle;
    state.empty = puzzle.filter((d) => !d).length;
    this.solution = solution;
    await this.sync(300);

    state.phase = 'play';
    state.startedAt = Date.now();
    let over = false;
    let close;
    const closed = new Promise((resolve) => (close = resolve));
    this.endRace = () => {
      over = true;
      close();
    };
    const name = R.LEVELS[state.level].name.toLowerCase();
    const puzzleName = `${name === 'easy' ? 'An' : 'A'} ${name} puzzle`;
    this.log(state.limited ? `${puzzleName}: go! First to fill the grid wins.` : `${puzzleName}. Take your time.`, 'turn');
    this.emit('state');
    for (const p of state.players) this.emit('turn', { player: p, what: 'solve' });
    const racing = state.players.map((p) => this.race(p, closed, () => over));
    await Promise.race([Promise.all(racing), closed]);
    this.endRace();
    this.endRace = null;
    for (const p of state.players) p.controller.stopMove?.(this, p);
    await Promise.all(racing);
    if (this.aborted) throw new GameAborted();

    state.phase = 'over';
    state.endedAt = Date.now();
    state.solution = solution;
    const w = state.players.find((p) => p.solved) ?? null;
    state.winners = w ? [w] : [];
    state.winner = w;
    const mistakes = (n) => (n ? ` with ${n} mistake${n === 1 ? '' : 's'}` : ' without a mistake');
    if (w && !state.limited) this.log(`🏆 ${w.name} ${verb(w, 'solves', 'solve')} it in ${clock(w.time)}${mistakes(w.mistakes)}.`, 'win');
    else if (w) this.log(`🏆 ${w.name} ${verb(w, 'fills', 'fill')} the grid first, in ${clock(w.time)}, and ${verb(w, 'wins', 'win')}.`, 'win');
    else this.log('Everyone made too many mistakes: nobody wins.', 'info');
    await this.sync(200);
    this.emit('gameover', { winner: w ?? state.players[0], winners: state.winners });
    return w;
  }

  // `p` keeps filling in cells until the race is over, they've filled the grid, or
  // (in a race) they've made too many mistakes.
  async race(p, closed, isOver) {
    const { state } = this;
    let misses = 0;
    while (!isOver() && !p.solved && !p.done) {
      const move = await Promise.race([p.controller.chooseMove(this, p), closed]);
      if (isOver() || this.aborted) return;
      const cell = move?.cell;
      const digit = move?.digit;
      const ok = Number.isInteger(cell) && cell >= 0 && cell < R.CELLS && Number.isInteger(digit) && digit >= 1 && digit <= 9 && !state.puzzle[cell] && !p.grid[cell];
      if (!ok) {
        if (++misses >= MAX_MISSES) p.done = true;
        continue;
      }
      misses = 0;
      if (digit === this.solution[cell]) {
        p.grid[cell] = digit;
        p.filled++;
        if (p.filled === state.empty) {
          p.solved = true;
          p.time = Date.now() - state.startedAt;
          this.endRace();
          return;
        }
      } else {
        p.mistakes++;
        p.wrong = { cell, digit, n: p.mistakes };
        if (state.limited && p.mistakes >= R.MAX_MISTAKES) {
          p.done = true;
          this.log(`${p.name} ${verb(p, 'is', 'are')} out: ${R.MAX_MISTAKES} mistakes.`, 'info');
        }
      }
      this.emit('state');
    }
    this.emit('state');
  }
}
