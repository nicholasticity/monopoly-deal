// Bingo engine: owns state and runs the game. Same interface as the other engines
// (events, sync, ask, abort), so the view, server and HUD can drive it.
// Controllers answer arrangeGrid (everyone at once) and chooseCall (in turn).
import { GameAborted } from '../game/engine.js';
import * as R from './rules.js';
import { chooseCall } from './ai.js';

// Log grammar for a player named "You" (the human's default name).
const you = (p) => p.name === 'You';
const verb = (p, third, base) => (you(p) ? base : third);
// "A", "A and B", "A, B and C".
const listNames = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
export const spell = (lines) => R.LETTERS.slice(0, R.letters(lines)).join('-');

export class BingoGame {
  constructor({ players, view = null, rng = Math.random, firstPlayer = null }) {
    this.kind = 'bingo';
    this.view = view;
    this.rng = rng;
    this.aborted = false;
    this.listeners = new Set();
    const first = firstPlayer ?? Math.floor(rng() * players.length);
    this.state = {
      players: players.map((p, i) => ({
        id: i, name: p.name, isHuman: !!p.isHuman, controller: p.controller,
        grid: null, ready: false, lines: 0,
      })),
      // Numbers in the order they were called, and who called each.
      called: [],
      callers: [],
      first,
      current: first,
      phase: 'setup',
      winners: [],
      winner: null,
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

  playerById(id) {
    return this.state.players.find((p) => p.id === id);
  }

  async run() {
    const { state } = this;
    await this.sync(300);
    await this.arrange();
    const n = state.players.length;
    this.log(`${state.players[state.first].name} ${verb(state.players[state.first], 'calls', 'call')} first.`, 'turn');
    for (let i = 0; !state.winners.length; i = (i + 1) % n) {
      await this.callTurn(state.players[(state.first + i) % n]);
    }
    state.phase = 'over';
    state.winner = state.winners[0];
    const names = state.winners.map((p) => p.name);
    const wins = names.length === 1 ? verb(state.winner, 'wins', 'win') : 'share the win';
    this.log(`🏆 BINGO! ${listNames(names)} ${wins}.`, 'win');
    await this.sync(200);
    this.emit('gameover', { winner: state.winner, winners: state.winners });
    return state.winner;
  }

  // Everyone gets a shuffled grid and may rearrange it, all at the same time.
  async arrange() {
    const { state } = this;
    state.phase = 'arrange';
    for (const p of state.players) {
      p.grid = R.randomGrid(this.rng);
      p.ready = false;
    }
    await this.sync(300);
    for (const p of state.players) this.emit('turn', { player: p, what: 'arrange' });
    const arranging = state.players.map(async (p) => {
      const grid = await p.controller.arrangeGrid(this, p, { grid: p.grid.slice() });
      if (this.aborted) return;
      if (R.validGrid(grid)) p.grid = grid.slice();
      p.ready = true;
      this.emit('state');
    });
    await this.ask(Promise.all(arranging));
    state.phase = 'call';
    this.log('Every grid is ready.');
    await this.sync(500);
  }

  // `p` calls a number; it's crossed off on every grid.
  async callTurn(p) {
    const { state } = this;
    state.current = p.id;
    this.emit('turn', { player: p, what: 'call' });
    this.emit('state');
    const pick = await this.ask(p.controller.chooseCall(this, p));
    const n = R.validCall(pick, state.called) ? pick : chooseCall(p.grid, state.called, this.rng);
    state.called.push(n);
    state.callers.push(p.id);
    this.log(`${p.name} ${verb(p, 'calls', 'call')} ${n}.`, 'action');
    await this.sync(250);
    for (const q of state.players) {
      const lines = R.completedLines(q.grid, state.called).length;
      if (lines === q.lines) continue;
      const more = lines - q.lines;
      q.lines = lines;
      if (more && R.letters(lines) > R.letters(lines - more)) {
        const what = more === 1 ? 'a line' : `${more} lines`;
        this.log(`${q.name} ${verb(q, 'completes', 'complete')} ${what}: ${spell(lines)}.`, 'line');
      }
    }
    state.winners = state.players.filter((q) => q.lines >= R.TO_WIN);
    await this.sync(state.winners.length ? 600 : 500);
  }
}
