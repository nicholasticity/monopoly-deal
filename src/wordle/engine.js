// Wordle engine: owns state and runs the game. Same interface as the other engines
// (events, sync, ask, abort), so the view, server and HUD can drive it.
// Each word is a race: everyone guesses at once (chooseGuess, asked again after each
// guess), and the first to get it scores a point and ends the word for everyone.
// Then stopGuess tells every controller to drop the guess it was making.
import { GameAborted } from '../game/engine.js';
import * as R from './rules.js';

// Log grammar for a player named "You" (the human's default name).
const you = (p) => p.name === 'You';
const verb = (p, third, base) => (you(p) ? base : third);
const listNames = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const guessCount = (n) => `${n} guess${n === 1 ? '' : 'es'}`;
// A guess that won't do (online, a client could send anything) counts as a miss; a
// few in a row and that player sits the word out.
const MAX_MISSES = 3;

export class WordleGame {
  // rounds: how many words. roundMs: how long a word stays open (tests shorten it).
  constructor({ players, view = null, rng = Math.random, words = R.DEFAULT_WORDS, roundMs = R.ROUND_SECONDS * 1000 }) {
    this.kind = 'wordle';
    this.view = view;
    this.rng = rng;
    this.roundMs = roundMs;
    this.aborted = false;
    this.listeners = new Set();
    this.endWord = null;
    this.used = new Set();
    this.state = {
      players: players.map((p, i) => ({
        id: i, name: p.name, isHuman: !!p.isHuman, controller: p.controller,
        score: 0, guesses: [], solved: false, done: false,
      })),
      round: 0,
      rounds: R.wordCount(words),
      phase: 'setup',
      // The secret word; the server only shows it once the word is over.
      answer: null,
      // When the word closes if nobody gets it (Date.now() time).
      endsAt: 0,
      roundWinner: null,
      // Each word so far: { word, winner (player id or null), tries: guesses each took (null: didn't get it) }.
      history: [],
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
    this.endWord?.();
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
    for (let r = 1; r <= state.rounds; r++) await this.playWord(r);
    state.phase = 'over';
    const best = Math.max(...state.players.map((p) => p.score));
    state.winners = state.players.filter((p) => p.score === best);
    state.winner = state.winners[0];
    const names = listNames(state.winners.map((p) => p.name));
    const words = `${best} word${best === 1 ? '' : 's'}`;
    this.log(`🏆 ${names} ${state.winners.length > 1 ? 'share the win' : verb(state.winner, 'wins', 'win')} with ${words}.`, 'win');
    await this.sync(200);
    this.emit('gameover', { winner: state.winner, winners: state.winners });
    return state.winner;
  }

  // One word, raced until someone gets it, everyone is out of guesses, or time's up.
  async playWord(r) {
    const { state } = this;
    state.round = r;
    state.answer = R.pickAnswer(this.used, this.rng);
    this.used.add(state.answer);
    state.roundWinner = null;
    for (const p of state.players) {
      p.guesses = [];
      p.solved = false;
      p.done = false;
    }
    state.phase = 'guess';
    state.endsAt = Date.now() + this.roundMs;
    let over = false;
    let close;
    const closed = new Promise((resolve) => (close = resolve));
    this.endWord = () => {
      over = true;
      close();
    };
    const timer = setTimeout(this.endWord, this.roundMs);
    this.log(`Word ${r} of ${state.rounds}: go!`, 'turn');
    this.emit('state');
    for (const p of state.players) this.emit('turn', { player: p, what: 'guess' });
    const racing = state.players.map((p) => this.race(p, closed, () => over));
    await Promise.race([Promise.all(racing), closed]);
    clearTimeout(timer);
    this.endWord();
    this.endWord = null;
    for (const p of state.players) p.controller.stopGuess?.(this, p);
    await Promise.all(racing);
    if (this.aborted) throw new GameAborted();

    state.phase = 'reveal';
    const w = state.roundWinner;
    state.history.push({ word: state.answer, winner: w?.id ?? null, tries: state.players.map((p) => (p.solved ? p.guesses.length : null)) });
    const word = state.answer.toUpperCase();
    if (w) this.log(`${w.name} ${verb(w, 'gets', 'get')} ${word} in ${guessCount(w.guesses.length)}: a point.`, 'line');
    else this.log(`Nobody got ${word}.`, 'info');
    await this.sync(2800);
  }

  // `p` keeps guessing until the word is over or they've run out of guesses.
  async race(p, closed, isOver) {
    const { state } = this;
    let misses = 0;
    while (!isOver() && p.guesses.length < R.MAX_GUESSES && misses < MAX_MISSES) {
      const guess = await Promise.race([p.controller.chooseGuess(this, p), closed]);
      if (isOver() || this.aborted) return;
      const word = typeof guess === 'string' ? guess.toLowerCase() : null;
      if (!R.isWord(word)) {
        misses++;
        continue;
      }
      misses = 0;
      const mark = R.mark(word, state.answer);
      p.guesses.push({ word, mark });
      if (mark === R.SOLVED) {
        p.solved = true;
        // The first to get it takes the point; the word ends then and there.
        state.roundWinner = p;
        p.score++;
        this.endWord();
        return;
      }
      this.emit('state');
    }
    p.done = true;
    this.emit('state');
  }
}
