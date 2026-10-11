// The human side of Bingo: arranging your grid (tap two squares to swap them) with
// a panel in the middle of the table, and calling a number by tapping it on your grid. Also the
// status line and the game-over grids, shared by solo and online play.
import * as R from '../bingo/rules.js';
import { AVATARS } from '../render/view.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const TOUCH = matchMedia('(pointer: coarse)').matches;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

const nameList = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

export class BingoHuman {
  constructor(hud, view) {
    this.hud = hud;
    this.view = view;
    // What we're waiting for: { kind: 'arrange' | 'call', ... }.
    this.pending = null;
  }

  // Starts from the grid you were dealt; Shuffle deals another, Ready keeps it.
  arrangeGrid(game, me, { grid }) {
    return new Promise((resolve) => {
      const draft = R.validGrid(grid) ? grid.slice() : R.randomGrid();
      const body = el('div', 'bprompt');
      body.appendChild(el('h2', null, 'Arrange your grid'));
      body.appendChild(el('p', null, 'Tap two squares to swap them. Only you see your grid.'));
      const row = el('div', 'bprompt-buttons');
      const shuffle = el('button', null, '🔀 Shuffle');
      const ready = el('button', 'primary', 'Ready');
      row.append(shuffle, ready);
      body.appendChild(row);
      // In the middle of the table, where the calls go once play starts.
      const close = () => this.view.showPrompt(null);
      this.view.showPrompt(body);
      this.pending = { kind: 'arrange', draft, selected: null, close };
      shuffle.addEventListener('click', () => {
        R.shuffle(draft);
        this.pending.selected = null;
        this.view.setDraft(draft);
      });
      ready.addEventListener('click', () => {
        close();
        this.pending = null;
        // Shown straight away (online, the server's copy follows).
        me.grid = draft.slice();
        this.view.setDraft(null);
        resolve(draft.slice());
      });
      this.view.setDraft(draft);
    });
  }

  // Waits for a tap on an open number on your grid (on touch: a tap picks it, a
  // second calls it).
  chooseCall(game, me) {
    return new Promise((resolve) => {
      this.pending = { kind: 'call', game, me, resolve };
      if (TOUCH && !BingoHuman.tapTold) {
        BingoHuman.tapTold = true;
        this.hud.toast('Tap a number to pick it, then tap it again to call it.', 'info', 4000);
      }
    });
  }

  onCell(i) {
    const p = this.pending;
    if (!p) return;
    if (p.kind === 'arrange') {
      if (p.selected == null) p.selected = i;
      else {
        if (p.selected !== i) [p.draft[p.selected], p.draft[i]] = [p.draft[i], p.draft[p.selected]];
        p.selected = null;
      }
      this.view.setDraft(p.draft, p.selected);
      return;
    }
    const n = p.me.grid?.[i];
    if (!R.validCall(n, p.game.state.called)) return;
    if (TOUCH && this.view.selected !== i) {
      this.view.setDraft(null, i);
      return;
    }
    this.pending = null;
    this.view.setDraft(null);
    p.resolve(n);
  }

  // The server decided for us (out of time): drop the half-arranged grid.
  cancel() {
    this.pending?.close?.();
    this.pending = null;
    this.view.setDraft(null);
  }

  onCardClick() {}

  endTurn() {}
}

// A small copy of a player's grid, for the game-over dialog.
function miniGrid(p, called, winner) {
  const crossed = new Set(called);
  const done = R.completedLines(p.grid, called);
  const gold = new Set(done.flatMap((i) => R.LINES[i]));
  const lit = R.letters(p.lines);
  const cells = (p.grid ?? []).map((n, i) => `<i class="${crossed.has(n) ? 'x' : ''} ${gold.has(i) ? 'gold' : ''}">${n}</i>`).join('');
  const word = R.LETTERS.map((l, j) => `<b class="${j < lit ? 'on' : ''}">${l}</b>`).join('');
  return `<div class="bmini${winner ? ' won' : ''}" style="--c: ${AVATARS[p.id % AVATARS.length]}"><div class="bmini-name">${esc(p.name)}</div><div class="bmini-word">${word}</div><div class="bmini-grid">${cells}</div></div>`;
}

// For the game-over dialog: did `seat` win, the headline, and everyone's grid.
export function gameResult(state, seat = -1) {
  const winners = state.winners;
  const won = winners.some((p) => p.id === seat);
  const others = winners.filter((p) => p.id !== seat).map((p) => esc(p.name));
  const calls = `${state.called.length} numbers`;
  let title;
  let text;
  if (winners.length === 1) {
    title = won ? 'BINGO! You win!' : `${others[0]} wins`;
    text = won ? `You crossed off five lines in ${calls}.` : `${others[0]} crossed off five lines in ${calls}.`;
  } else {
    title = won ? 'A shared win!' : 'A shared win';
    text = `${nameList(won ? ['You', ...others] : others)} reached BINGO on the same call, after ${calls}.`;
  }
  const extra = el('div', 'bminis');
  const players = [...state.players].sort((a, b) => (a.id === seat ? -1 : b.id === seat ? 1 : b.lines - a.lines));
  extra.innerHTML = players.filter((p) => p.grid).map((p) => miniGrid(p, state.called, winners.includes(p))).join('');
  return { won, title, text, extra };
}

// The status line: what's happening, from `seat`'s point of view. Returns { text, mine }.
export function bingoStatus(state, seat) {
  const name = (p) => `<b>${esc(p.name)}</b>`;
  const me = state.players[seat];
  switch (state.phase) {
    case 'over': {
      const names = state.winners.map((p) => (p.id === seat ? 'You' : name(p)));
      return { text: `BINGO! ${names.length === 1 ? `${names[0]} won` : `${nameList(names)} shared the win`}`, mine: false };
    }
    case 'arrange': {
      if (me && !me.ready) return { text: '<b>Arrange your grid</b> · tap two squares to swap', mine: true };
      const waiting = state.players.filter((p) => !p.ready);
      return { text: waiting.length ? `Waiting for ${nameList(waiting.map(name))}…` : 'Every grid is ready', mine: false };
    }
    case 'call': {
      if (state.current === seat) return { text: '<b>Your call</b> · tap a number on your grid', mine: true };
      return { text: `${name(state.players[state.current])} is calling…`, mine: false };
    }
    default:
      return { text: 'Dealing grids…', mine: false };
  }
}

// The toast when it's your turn.
export const turnToast = (what) => ({ arrange: 'Arrange your grid!', call: 'Your call!' })[what] ?? null;
