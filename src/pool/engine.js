// 8-ball engine: owns state and runs the game. Same interface as the other engines
// (events, sync, ask, abort), so the view, server and HUD can drive it.
// Controllers answer chooseShot(game, me, { ballInHand }) with { dx, dy, power,
// cue? }: the cue ball's direction and power (0–1), and with ball in hand where to put
// it. The engine runs the shot (physics.js) and keeps it in state.shot, so a view can
// replay it from the same positions while the engine waits for it to finish.
import { GameAborted } from '../game/engine.js';
import { simulate } from './physics.js';
import * as R from './rules.js';
import { planShot, placeCue } from './ai.js';

// Log grammar for a player named "You" (the human's default name).
const you = (p) => p.name === 'You';
const verb = (p, third, base) => (you(p) ? base : third);
const listNames = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const ballList = (ids) => listNames(ids.map((id) => `the ${id}`));
// After a shot, a moment before the next.
const SETTLE_MS = 700;

export class PoolGame {
  constructor({ players, view = null, rng = Math.random, firstPlayer = null }) {
    this.kind = 'pool';
    this.view = view;
    this.rng = rng;
    this.aborted = false;
    this.listeners = new Set();
    const first = firstPlayer ?? Math.floor(rng() * players.length);
    this.state = {
      kind: 'pool',
      players: players.map((p, i) => ({
        id: i, name: p.name, isHuman: !!p.isHuman, controller: p.controller, team: R.teamOf(i),
      })),
      balls: R.rack(rng),
      // Each team's group, 'solids' or 'stripes'; null while the table is open.
      groups: [null, null],
      current: first,
      phase: 'setup',
      // Where the shooter may place the cue ball: 'kitchen' (the break), 'anywhere'
      // (after a foul) or null.
      ballInHand: 'kitchen',
      shots: 0,
      // The last shot: { no, from (the balls before it), dx, dy, power, time (s) }.
      shot: null,
      // What the last shot did, for the status line.
      last: null,
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

  // The players on a team ("Ann", or "Ann and Ben").
  teamNames(team) {
    return listNames(this.state.players.filter((p) => p.team === team).map((p) => p.name));
  }

  async run() {
    const { state } = this;
    await this.sync(300);
    this.log(`${this.current.name} ${verb(this.current, 'breaks', 'break')}.`, 'turn');
    while (state.phase !== 'over') await this.takeShot();
    const team = state.winners[0].team;
    state.winner = state.winners[0];
    const names = this.teamNames(team);
    this.log(`🏆 ${names} ${state.winners.length > 1 ? 'win' : verb(state.winner, 'wins', 'win')}!`, 'win');
    await this.sync(200);
    this.emit('gameover', { winner: state.winner, winners: state.winners });
    return state.winner;
  }

  // A shot, checked: a bad answer is played by the bot instead.
  async chooseShot(p) {
    const { state } = this;
    const hand = state.ballInHand;
    const shot = await this.ask(p.controller.chooseShot(this, p, { ballInHand: hand }));
    const ok = shot && Number.isFinite(shot.dx) && Number.isFinite(shot.dy) && (shot.dx !== 0 || shot.dy !== 0) && Number.isFinite(shot.power);
    const placed = !hand || (shot?.cue && Number.isFinite(shot.cue.x) && Number.isFinite(shot.cue.y) && R.canPlace(state.balls, shot.cue.x, shot.cue.y, hand));
    if (ok && placed) return { dx: shot.dx, dy: shot.dy, power: Math.max(0.03, Math.min(1, shot.power)), cue: hand ? shot.cue : null };
    const cue = hand ? (placed ? shot.cue : placeCue(this, p, hand, this.rng)) : null;
    return { ...planShot(this, p, cue, this.rng), cue };
  }

  async takeShot() {
    const { state } = this;
    const p = this.current;
    const team = p.team;
    state.phase = 'aim';
    this.emit('turn', { player: p, what: 'shot' });
    await this.sync(0);
    const { dx, dy, power, cue } = await this.chooseShot(p);
    const cueBall = state.balls.find((b) => b.id === 0);
    if (cue) Object.assign(cueBall, { x: cue.x, y: cue.y, potted: false });
    const brk = state.shots === 0;
    const before = state.balls.map((b) => ({ ...b }));
    const result = simulate(before, dx, dy, power);
    state.shots++;
    state.shot = { no: state.shots, from: before, dx, dy, power, time: result.time };
    state.balls = result.balls;
    state.ballInHand = null;
    state.phase = 'shot';
    await this.sync(result.time * 1000 + SETTLE_MS);

    const judged = R.judgeShot({ before, events: result.events, groups: state.groups, team, brk });
    const potted = result.events.pocketed.map((x) => x.id).filter((id) => id !== 0);
    const name = p.name;
    if (potted.length) this.log(`${name} ${verb(p, 'pots', 'pot')} ${ballList(potted)}.`, 'action');
    if (judged.respot8) {
      R.spot(state.balls, R.EIGHT);
      this.log('The 8 went down on the break, so it goes back on the spot.');
    }
    if (judged.assign) {
      state.groups = [judged.assign, R.otherGroup(judged.assign)];
      const mine = state.groups[team];
      this.log(`${this.teamNames(team)} ${state.players.filter((x) => x.team === team).length > 1 ? 'take' : verb(p, 'takes', 'take')} ${mine}.`, 'line');
    }
    if (judged.win || judged.lose) {
      const winTeam = judged.win ? team : 1 - team;
      state.winners = state.players.filter((x) => x.team === winTeam);
      state.phase = 'over';
      state.last = judged.win ? `${name} sank the 8` : `${name} lost on the 8${judged.why ? ` (${judged.why})` : ''}`;
      if (judged.lose) this.log(`${name} ${verb(p, 'pots', 'pot')} the 8 ${judged.foul ? `with a foul (${judged.why})` : 'too early'}, and ${this.teamNames(team)} lose.`, 'warn');
      return;
    }
    const n = state.players.length;
    if (judged.foul) {
      state.current = (state.current + 1) % n;
      state.ballInHand = 'anywhere';
      const next = this.current;
      state.last = `Foul: ${judged.why}`;
      this.log(`Foul by ${name}: ${judged.why}. ${next.name} ${verb(next, 'has', 'have')} ball in hand.`, 'warn');
      this.toast(`Foul: ${judged.why}. Ball in hand for ${next.name}.`, 'warn');
    } else if (judged.again) {
      state.last = `${name} potted ${ballList(potted)}`;
    } else {
      state.current = (state.current + 1) % n;
      state.last = potted.length ? `${name} potted ${ballList(potted)}` : `${name} missed`;
    }
    await this.sync(0);
  }
}
