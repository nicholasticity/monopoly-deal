// The human side of 8-ball: the table view does the aiming (pool-view.js) and this
// hands the shot to the engine. Also the status line and the game-over dialog, shared
// by solo and online play.
import { ballsLeft } from '../pool/rules.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const nameList = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

export class PoolHuman {
  constructor(hud, view) {
    this.hud = hud;
    this.view = view;
  }

  chooseShot(game, me, { ballInHand }) {
    return new Promise((resolve) => this.view.startAim({ hand: ballInHand, resolve }));
  }

  // Online, the server moved on (a timeout): put the cue down.
  cancel() {
    this.view.stopAim();
  }

  onCardClick() {}

  endTurn() {}
}

// What the shooter has to do: their group's balls left, or the 8.
function task(state, p) {
  const group = state.groups[p.team];
  if (!group) return 'the table is open';
  const left = ballsLeft(state.balls, group);
  return left ? `${group}, ${left} left` : 'on the 8';
}

// The status line, from `seat`'s point of view. Returns { text, mine }.
export function poolStatus(state, seat) {
  const p = state.players[state.current];
  const mine = !!p && p.id === seat && state.players[seat]?.isHuman;
  const who = (q) => (q.id === seat ? 'You' : `<b>${esc(q.name)}</b>`);
  switch (state.phase) {
    case 'over': {
      const names = state.winners.map(who);
      return { text: `${nameList(names)} won${state.last ? ` · ${esc(state.last)}` : ''}`, mine: false };
    }
    case 'aim': {
      const first = state.shots === 0;
      const hand = state.ballInHand === 'anywhere' ? ' · ball in hand' : '';
      const last = state.last && !first ? `${esc(state.last)} · ` : '';
      if (mine) return { text: `${last}<b>Your shot</b> · ${first ? 'break' : task(state, p)}${hand}`, mine };
      return { text: `${last}${who(p)} ${first ? 'is breaking' : 'is lining up'}…`, mine };
    }
    case 'shot':
      return { text: `${who(p)} ${p.id === seat ? 'shoot' : 'shoots'}…`, mine: false };
    default:
      return { text: 'Racking up…', mine: false };
  }
}

// For the game-over dialog.
export function gameResult(state, seat = -1) {
  const won = state.winners.some((p) => p.id === seat);
  const names = state.winners.map((p) => (p.id === seat ? 'You' : esc(p.name)));
  const team = state.winners.length > 1;
  const title = won ? (team ? 'Your team wins!' : 'You win!') : `${nameList(names)} ${team ? 'win' : 'wins'}`;
  const text = state.last ? `${esc(state.last)}.` : '';
  return { won, title, text };
}

// The toast when it's your shot.
export const turnToast = () => 'Your shot!';
