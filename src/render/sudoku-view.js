// The Sudoku table, built on the Monopoly Deal one but with no cards: a bar per
// opponent (how far they've got, and which cells they've filled as a tiny grid, without
// the numbers), your bar with the clock and your mistakes, your grid, and a number pad.
// Picking happens here: tap a cell, then a number (or type it). A number goes to the
// 'submit' handler (the human controller), which says whether it took it; the engine's
// answer (in, or a mistake) comes back in the state. Pencil notes stay in this browser.
import { TableView, AVATARS, div, setBox, clamp, r1, esc } from './view.js';
import { CELLS, PEERS, MAX_MISTAKES, rowOf, colOf, boxOf } from '../sudoku/rules.js';
import { clock } from '../sudoku/engine.js';

// Widest an opponent's bar gets on wide screens (px).
const BAR_MAX = 300;
// Biggest the grid gets (px).
const BOARD_MAX = 620;
// How long a wrong number stays up, in red (ms).
const WRONG_MS = 900;

const colorOf = (i) => AVATARS[i % AVATARS.length];
// A dialog is up (the lobby, a result, the rules): keys aren't for the game.
const dialogOpen = () => !!document.querySelector('#modal-layer > .modal-backdrop:not(.hidden), #lobby-layer > .modal-backdrop, body > .modal-backdrop.top');

export class SudokuView extends TableView {
  constructor(container) {
    super(container);
    this.root.classList.add('sudoku');
    for (const { spot, label } of Object.values(this.spots)) {
      spot.classList.add('hidden');
      label.classList.add('hidden');
    }
    this.tray.classList.add('hidden');
    this.handlers.submit = () => false;
    this.handlers.placed = () => {};
    this.handlers.wrong = () => {};
    this.reset();

    this.boardEl = div('sudoku-board hidden', this.panelLayer);
    this.cellEls = Array.from({ length: CELLS }, (_, i) => {
      const c = div(`scell r${rowOf(i)} c${colOf(i)}${(boxOf(i) % 2) ? ' alt' : ''}`, this.boardEl);
      c.dataset.i = i;
      const value = div('sval', c);
      const notes = div('snotes', c);
      const marks = Array.from({ length: 9 }, (_, d) => div('', notes, String(d + 1)));
      return { el: c, value, notes, marks, key: '' };
    });
    this.boardEl.addEventListener('pointerdown', (e) => {
      const c = e.target.closest('.scell');
      if (c) this.select(Number(c.dataset.i));
    });

    this.padEl = div('sudoku-pad hidden', this.panelLayer);
    this.digitsEl = div('sdigits', this.padEl);
    this.digitEls = Array.from({ length: 9 }, (_, d) => {
      const b = document.createElement('button');
      b.className = 'skey';
      b.dataset.d = d + 1;
      b.innerHTML = `<b>${d + 1}</b><small></small>`;
      this.digitsEl.appendChild(b);
      return b;
    });
    const tools = div('stools', this.padEl);
    this.notesBtn = document.createElement('button');
    this.notesBtn.className = 'stool';
    this.notesBtn.title = 'Pencil notes (N)';
    this.eraseBtn = document.createElement('button');
    this.eraseBtn.className = 'stool';
    this.eraseBtn.innerHTML = '⌫ <span>Erase</span>';
    this.eraseBtn.title = 'Clear the notes in this cell (Backspace)';
    tools.append(this.notesBtn, this.eraseBtn);
    this.padEl.addEventListener('click', (e) => {
      const k = e.target.closest('.skey');
      if (k) this.digit(Number(k.dataset.d));
      else if (e.target.closest('.stool') === this.notesBtn) this.toggleNotes();
      else if (e.target.closest('.stool') === this.eraseBtn) this.erase();
    });
    document.addEventListener('keydown', (e) => {
      if (this.root.hidden || !this.game || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea') || dialogOpen()) return;
      const arrows = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 };
      if (/^[1-9]$/.test(e.key)) this.digit(Number(e.key));
      else if (e.key in arrows) this.move(arrows[e.key]);
      else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') this.erase();
      else if (e.key === 'n' || e.key === 'N') this.toggleNotes();
      else return;
      e.preventDefault();
    });
    // The clock in your bar.
    this.tick = setInterval(() => this.game && !this.root.hidden && this.layoutClock(), 500);
  }

  // A new puzzle: no selection, notes or numbers on their way.
  reset() {
    this.selected = -1;
    this.notesMode = false;
    this.notes = new Map(); // cell -> bit mask of noted numbers
    this.pending = new Map(); // cell -> number sent (or queued) but not answered yet
    this.queued = [];
    this.wrongSeen = 0;
    this.wrongShown = null; // { cell, digit, until }
    this.seenGrid = null;
    this.puzzleKey = '';
  }

  get me() {
    return this.game?.state.players[this.seat] ?? null;
  }

  // You're still in the race and may fill in cells.
  get canPlay() {
    const me = this.me;
    const { state } = this.game ?? {};
    return !!me?.isHuman && state?.phase === 'play' && !me.solved && !me.done;
  }

  // What's in each cell for you: the puzzle's numbers and yours.
  board() {
    const { puzzle } = this.game.state;
    const grid = this.me?.grid ?? [];
    return puzzle.map((d, i) => d || grid[i] || 0);
  }

  select(i) {
    if (!this.game || this.game.state.phase === 'setup') return;
    this.selected = i;
    this.layout();
  }

  move(step) {
    if (this.selected < 0) return this.select(40);
    const r = rowOf(this.selected);
    const c = colOf(this.selected);
    const next = Math.abs(step) === 1 ? r * 9 + ((c + step + 9) % 9) : ((r + Math.sign(step) + 9) % 9) * 9 + c;
    this.select(next);
  }

  toggleNotes() {
    this.notesMode = !this.notesMode;
    this.layout();
  }

  // A number for the selected cell: a note in notes mode, otherwise your answer.
  digit(d) {
    const i = this.selected;
    if (!this.canPlay || i < 0 || this.board()[i] || this.pending.has(i)) return;
    if (this.notesMode) {
      this.notes.set(i, (this.notes.get(i) ?? 0) ^ (1 << d));
      return this.layout();
    }
    const move = { cell: i, digit: d };
    this.pending.set(i, d);
    if (!this.handlers.submit(move)) this.queued.push(move);
    this.layout();
  }

  erase() {
    if (this.selected < 0 || !this.notes.has(this.selected)) return;
    this.notes.delete(this.selected);
    this.layout();
  }

  // The human controller has just been asked for a number: one put in already?
  takeQueued() {
    return this.queued.shift() ?? null;
  }

  // No deck and discard counts in the HUD.
  showPiles() {}

  // Header-only panels; opponents' have their tiny grids on the right.
  buildPanels(game) {
    for (const p of this.panels) p.el.remove();
    this.panels = game.state.players.map((p, i) => {
      const el = div('seat-panel', this.panelLayer);
      el.style.setProperty('--c', colorOf(i));
      const head = div('seat-head', el);
      const mini = div('smini', el);
      mini.innerHTML = '<i></i>'.repeat(CELLS);
      return { el, head, mini, html: '', miniKey: '' };
    });
  }

  attach(game) {
    this.reset();
    super.attach(game);
  }

  detach() {
    this.reset();
    super.detach();
    for (const e of [this.boardEl, this.padEl]) e.classList.add('hidden');
  }

  // ---------- geometry ----------

  // Opponents' bars across the top (two to a row on tall screens), then your bar over
  // your grid. The number pad goes under the grid on tall screens (one row of numbers)
  // and beside it on wide ones (three rows), whichever leaves the grid bigger.
  fit() {
    const { w, h } = this.size;
    const ins = this.inset;
    const portrait = ins.portrait;
    const n = this.game?.state.players.length ?? 4;
    const k = n - 1;
    const small = w < 700 || h < 540;
    const pad = small ? 8 : 14;
    const gap = small ? 8 : 12;
    const inner = small ? 6 : 10;
    const head = small ? 30 : 36;
    const bar = small ? 44 : 52;
    const bottomGap = small ? 8 : 14;

    const x0 = pad;
    const W = w - 2 * pad;
    const cols = Math.max(1, portrait ? Math.min(k, 2) : k > 4 ? Math.ceil(k / 2) : k);
    const colW = Math.min((W - (cols - 1) * gap) / cols, portrait ? Infinity : BAR_MAX);
    const top = ins.top + 6;
    const bars = [];
    for (let i = 0; i < k; i++) {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, k - row * cols);
      const rowX = x0 + (W - (inRow * colW + (inRow - 1) * gap)) / 2;
      bars.push({ x: rowX + (i % cols) * (colW + gap), y: top + row * (bar + gap), w: colW, h: bar });
    }
    const oppBottom = k ? top + Math.ceil(k / cols) * (bar + gap) - gap : top - gap;
    const meTop = oppBottom + gap;
    const boardTop = meTop + head + gap;
    const below = portrait ? ins.bottom + 4 : 0;

    // Under: a row of nine numbers and a row of tools.
    const keyH = clamp((Math.min(W, BOARD_MAX) / 9) * 1.15, 40, 62);
    const toolH = small ? 34 : 38;
    const underH = keyH + gap / 2 + toolH;
    const underS = Math.min(W, BOARD_MAX, h - bottomGap - underH - below - gap - boardTop);
    // Beside: three rows of three, and the tools under them.
    const sideW = clamp(W * 0.3, 150, 250);
    const sideS = Math.min(W - sideW - 2 * gap, BOARD_MAX, h - bottomGap - boardTop);
    const beside = !portrait && sideS > underS + 20;
    const S = Math.max(180, beside ? sideS : underS);
    let board;
    let padBox;
    if (beside) {
      const x = x0 + (W - (S + 2 * gap + sideW)) / 2;
      board = { x, y: boardTop, w: S, h: S };
      const sideKey = (sideW - 2 * (gap / 2)) / 3;
      const padH = Math.min(S, 3 * sideKey + 2 * (gap / 2) + gap + toolH);
      padBox = { x: x + S + 2 * gap, y: boardTop + Math.max(0, (S - padH) / 2), w: sideW, h: padH, key: Math.min(sideKey, (padH - gap - toolH - gap) / 3) };
    } else {
      const padY = h - bottomGap - underH;
      // Centred in the room between the bars and the pad (your bar moves down with it).
      board = { x: x0 + (W - S) / 2, y: boardTop + Math.max(0, (padY - below - gap - boardTop - S) / 2), w: S, h: S };
      const pw = Math.min(W, Math.max(S, 320));
      padBox = { x: x0 + (W - pw) / 2, y: padY, w: pw, h: underH, key: keyH };
    }
    const meW = Math.min(W, Math.max(S, 300));
    const me = { x: board.x + (S - meW) / 2, y: board.y - gap - head, w: meW, h: head };
    if (beside) me.x = board.x;

    const hand = beside ? { x0, x1: x0 + W, top: h - bottomGap, h: bottomGap, cw: 0, visible: bottomGap } : { x0, x1: x0 + W, top: padBox.y, h: h - padBox.y, cw: 0, visible: h - padBox.y };
    const discard = { x: w / 2, y: h / 2, w: 0 };
    this.geo = { portrait, head, bar, side: 0, lead: head, inner, panels: [me, ...bars], hand, board, pad: padBox, beside, dock: h - me.y, deck: discard, discard };
    this.layoutKey = `sudoku:${beside ? 'side' : 'under'}:${n}`;
    this.root.style.setProperty('--head', `${head}px`);
    this.root.style.setProperty('--inner', `${inner}px`);
    this.root.style.setProperty('--side', '0px');
    this.root.style.setProperty('--cell', `${r1(S / 9)}px`);
    this.root.style.setProperty('--skey', `${r1(padBox.key)}px`);
    this.root.style.setProperty('--stool', `${toolH}px`);
    this.root.style.setProperty('--smini', `${Math.max(2, Math.floor((bar - 10 - 8) / 9))}px`);
    this.root.classList.toggle('small', small);
    this.root.classList.remove('bars');
  }

  // ---------- layout ----------

  layout() {
    const game = this.game;
    // The base constructor lays out before this one has built the board.
    if (!this.boardEl) return;
    for (const e of [this.boardEl, this.padEl]) e.classList.toggle('hidden', !game);
    if (!game) return;
    const { state } = game;
    const key = state.puzzle.join('');
    if (key !== this.puzzleKey) {
      this.reset();
      this.puzzleKey = key;
    }
    this.settle(state);
    state.players.forEach((p, i) => this.layoutPanel(p, i, this.zoneIndex(i)));
    this.layoutBoard(state);
    this.layoutPad(state);
    this.layoutClock();
    this.root.classList.toggle('my-turn', this.canPlay);
  }

  // The engine's answers to the numbers sent: in (a right one: its notes, and that
  // number in the notes around it, go), or a mistake (shown in red for a moment).
  settle(state) {
    const me = this.me;
    if (!me) return;
    const grid = me.grid;
    if (this.seenGrid) {
      for (let i = 0; i < CELLS; i++) {
        if (!grid[i] || this.seenGrid[i]) continue;
        this.notes.delete(i);
        for (const j of PEERS[i]) {
          const m = this.notes.get(j);
          if (m) this.notes.set(j, m & ~(1 << grid[i]));
        }
        if (this.pending.get(i) === grid[i]) {
          this.pending.delete(i);
          if (!this.snapping) this.handlers.placed();
        }
      }
    }
    this.seenGrid = grid.slice();
    const wrong = me.wrong;
    if (wrong && wrong.n > this.wrongSeen) {
      if (this.wrongSeen || this.pending.has(wrong.cell)) {
        this.wrongShown = { cell: wrong.cell, digit: wrong.digit, until: Date.now() + WRONG_MS };
        this.handlers.wrong();
        clearTimeout(this.wrongTimer);
        this.wrongTimer = setTimeout(() => this.layout(), WRONG_MS + 20);
      }
      this.pending.delete(wrong.cell);
    }
    this.wrongSeen = wrong?.n ?? 0;
    // Over (or out): nothing more is on its way.
    if (state.phase !== 'play' || me.done || me.solved) {
      this.pending.clear();
      this.queued = [];
    }
  }

  layoutPanel(p, i, zi) {
    const r = this.geo.panels[zi];
    const panel = this.panels[i];
    const { state } = this.game;
    setBox(panel.el, r);
    const mine = zi === 0;
    panel.el.classList.toggle('me', mine);
    panel.el.classList.toggle('winner', state.phase === 'over' && state.winners.includes(p));
    panel.el.classList.toggle('compact', r.w < 240);
    panel.el.classList.toggle('sbar', !mine);

    const you = mine && p.isHuman && p.name.trim().toLowerCase() !== 'you' ? '<span class="you">You</span>' : '';
    const tag = p.tag ? `<span class="tag">${p.tag}</span>` : '';
    const initial = [...p.name.trim()][0]?.toUpperCase() ?? '?';
    const status = p.solved ? '<span class="chip got">✓ Done</span>' : p.done ? '<span class="chip out">✗ Out</span>' : '';
    const progress = !mine && !p.solved ? `<span class="chip" title="Cells filled">${p.filled}/${state.empty}</span>` : '';
    const limit = state.limited ? `/${MAX_MISTAKES}` : '';
    const mistakes = state.phase === 'setup' ? '' : `<span class="chip smiss${p.mistakes ? ' some' : ''}" title="Mistakes">✕ ${p.mistakes}${mine ? limit : ''}</span>`;
    const clockChip = mine ? '<span class="chip wclock"></span>' : '';
    const html = `<span class="avatar">${esc(initial)}</span><span class="seat-name">${tag}${esc(p.name)}</span><span class="mic"></span>${you}<span class="chips">${status}${progress}${mistakes}${clockChip}</span>`;
    if (html !== panel.html) {
      panel.head.innerHTML = html;
      panel.html = html;
      panel.clockEl = panel.head.querySelector('.wclock');
    }
    // Opponents' filled cells as a tiny grid, without the numbers (online they're not sent).
    panel.mini.classList.toggle('hidden', mine);
    if (mine) return;
    const mask = p.mask ?? p.grid.map((d) => (d ? 1 : 0)).join('');
    const key = `${state.puzzle.join('')}|${mask}`;
    if (key !== panel.miniKey) {
      panel.miniKey = key;
      [...panel.mini.children].forEach((c, j) => {
        c.className = state.puzzle[j] ? 'g' : mask[j] === '1' ? 'f' : '';
      });
    }
  }

  layoutBoard(state) {
    setBox(this.boardEl, this.geo.board);
    const board = this.board();
    const live = state.phase === 'play';
    const sel = this.selected;
    const selDigit = sel >= 0 ? board[sel] || this.pending.get(sel) || 0 : 0;
    const wrong = this.wrongShown && this.wrongShown.until > Date.now() ? this.wrongShown : null;
    const answer = state.phase === 'over' ? state.solution : null;
    this.cellEls.forEach((c, i) => {
      const given = !!state.puzzle[i];
      const pend = this.pending.get(i) ?? 0;
      const shownWrong = wrong?.cell === i ? wrong.digit : 0;
      // Once it's over, the answer fills in the cells you didn't get to.
      const missing = !board[i] && answer ? answer[i] : 0;
      const value = board[i] || shownWrong || pend || missing || '';
      const notes = !value && live ? this.notes.get(i) ?? 0 : 0;
      const peer = sel >= 0 && i !== sel && (rowOf(i) === rowOf(sel) || colOf(i) === colOf(sel) || boxOf(i) === boxOf(sel));
      const same = !!selDigit && (board[i] === selDigit || (pend && pend === selDigit));
      const cls = [given ? 'given' : board[i] ? 'mine' : '', pend && !shownWrong ? 'pend' : '', shownWrong ? 'wrong' : '', missing ? 'missing' : '', i === sel ? 'sel' : '', peer ? 'peer' : '', same ? 'same' : ''].filter(Boolean).join(' ');
      const key = `${value}|${notes}|${cls}`;
      if (key === c.key) return;
      c.key = key;
      c.el.className = `scell r${rowOf(i)} c${colOf(i)}${boxOf(i) % 2 ? ' alt' : ''} ${cls}`;
      c.value.textContent = value;
      c.notes.classList.toggle('hidden', !notes);
      if (notes) c.marks.forEach((m, d) => m.classList.toggle('on', !!(notes & (1 << (d + 1)))));
    });
  }

  layoutPad(state) {
    const g = this.geo.pad;
    setBox(this.padEl, g);
    this.padEl.classList.toggle('beside', this.geo.beside);
    const board = this.board();
    const counts = Array(10).fill(0);
    for (const d of board) counts[d]++;
    const sel = this.selected;
    const open = this.canPlay && sel >= 0 && !board[sel] && !this.pending.has(sel);
    this.digitEls.forEach((b, k) => {
      const d = k + 1;
      const left = 9 - counts[d];
      b.classList.toggle('done', left <= 0);
      b.classList.toggle('noted', open && this.notesMode && !!((this.notes.get(sel) ?? 0) & (1 << d)));
      b.querySelector('small').textContent = left > 0 ? left : '';
    });
    this.padEl.classList.toggle('off', !this.canPlay);
    this.padEl.classList.toggle('notes', this.notesMode);
    this.notesBtn.classList.toggle('on', this.notesMode);
    this.notesBtn.innerHTML = `✏️ <span>Notes ${this.notesMode ? 'on' : 'off'}</span>`;
  }

  // How long the puzzle's been going, in your bar.
  layoutClock() {
    const el = this.panels[this.seat]?.clockEl;
    if (!el) return;
    const { state } = this.game;
    const live = state.startedAt > 0;
    const me = this.me;
    const end = me?.solved ? state.startedAt + me.time : state.endedAt || Date.now();
    const text = live ? `⏱ ${clock(Math.max(0, end - state.startedAt))}` : '';
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('hidden', !live);
  }
}
