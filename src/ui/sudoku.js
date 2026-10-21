// The human side of Sudoku: the table view does the picking (sudoku-view.js), and this
// hands each number put in to the engine when it asks for one. Also the status line,
// the level in the top bar and the game-over dialog, shared by solo and online play.
import { LEVELS, MAX_MISTAKES } from '../sudoku/rules.js';
import { clock } from '../sudoku/engine.js';
import { AVATARS } from '../render/view.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export class SudokuHuman {
  constructor(hud, view) {
    this.hud = hud;
    this.view = view;
    this.pending = null;
  }

  // Waits for the next number from the view (or takes one put in while it waited).
  chooseMove() {
    return new Promise((resolve) => {
      this.pending = resolve;
      const queued = this.view.takeQueued();
      if (queued) this.submit(queued);
    });
  }

  // From the view: { cell, digit }. False if no move is wanted right now.
  submit(move) {
    const resolve = this.pending;
    if (!resolve) return false;
    this.pending = null;
    resolve(move);
    return true;
  }

  // The race is over (or online, the server moved on): stop waiting.
  stopMove() {
    this.cancel();
  }

  cancel() {
    const resolve = this.pending;
    this.pending = null;
    resolve?.(null);
  }

  onCardClick() {}

  endTurn() {}
}

// The top bar's button: the puzzle's level.
export const gameInfo = (state) => (state.phase === 'setup' ? '' : LEVELS[state.level]?.name ?? '');

// How far everyone got, the winner first: cells filled, mistakes and time.
export function scoreTable(state, seat = -1) {
  const wrap = el('div', 'wscores');
  const order = [...state.players].sort((a, b) => Number(b.solved) - Number(a.solved) || b.filled - a.filled || a.mistakes - b.mistakes || a.id - b.id);
  const rows = order
    .map((p) => {
      const how = p.solved ? clock(p.time) : p.done ? 'out' : `${p.filled}/${state.empty}`;
      return `<tr class="${p.id === seat ? 'me' : ''}${p.solved ? ' won' : ''}"><td><span class="dot" style="--c: ${AVATARS[p.id % AVATARS.length]}"></span>${esc(p.name)}</td><td class="num">${how}</td><td class="num">${p.mistakes}</td></tr>`;
    })
    .join('');
  wrap.innerHTML = `<table class="wtable"><thead><tr><th>Player</th><th class="num">Progress</th><th class="num">Mistakes</th></tr></thead><tbody>${rows}</tbody></table>`;
  return wrap;
}

// For the game-over dialog: did `seat` win, the headline, and how everyone did.
export function gameResult(state, seat = -1) {
  const me = state.players[seat];
  const w = state.winners[0] ?? null;
  const level = LEVELS[state.level]?.name.toLowerCase() ?? '';
  if (!state.limited) {
    const mistakes = me?.mistakes ? ` with ${plural(me.mistakes, 'mistake')}` : ' without a single mistake';
    return { won: true, title: 'Solved!', text: `You solved the ${level} puzzle in <b>${clock(me?.time ?? 0)}</b>${mistakes}.` };
  }
  const extra = scoreTable(state, seat);
  if (!w) return { won: false, title: 'Nobody finished', text: `Everyone made ${MAX_MISTAKES} mistakes before filling the grid.`, extra };
  if (w.id === seat) return { won: true, title: 'You win!', text: `You filled the grid first, in <b>${clock(w.time)}</b>.`, extra };
  return { won: false, title: `${esc(w.name)} wins`, text: `${esc(w.name)} filled the grid first, in <b>${clock(w.time)}</b>.`, extra };
}

// The status line: what's happening, from `seat`'s point of view. Returns { text, mine }.
export function sudokuStatus(state, seat) {
  const me = state.players[seat];
  switch (state.phase) {
    case 'over': {
      const w = state.winners[0];
      if (!state.limited) return { text: 'Solved!', mine: false };
      if (!w) return { text: 'Nobody finished the puzzle', mine: false };
      return { text: `${w.id === seat && w.isHuman ? 'You' : `<b>${esc(w.name)}</b>`} filled the grid first`, mine: false };
    }
    case 'play': {
      if (!me?.isHuman) {
        const racing = state.players.filter((p) => !p.done && !p.solved).length;
        return { text: `${LEVELS[state.level].name} puzzle · ${plural(racing, 'player')} racing`, mine: false };
      }
      if (me.done) return { text: `Out: ${MAX_MISTAKES} mistakes · watching the race`, mine: false };
      const left = state.empty - me.filled;
      return { text: `<b>Fill the grid</b> · ${plural(left, 'cell')} to go`, mine: true };
    }
    default:
      return { text: 'Making a puzzle…', mine: false };
  }
}

// No toast when the race starts (the board says it); just the chime.
export const turnToast = () => null;
