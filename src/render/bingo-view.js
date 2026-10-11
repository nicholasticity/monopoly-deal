// The Bingo table, built on the Monopoly Deal one but with no cards: a header bar per
// player (their B-I-N-G-O so far), the number just called in the middle with the ones
// before it, and your 5×5 grid along the bottom.
import { TableView, AVATARS, div, setBox, clamp, r1, esc } from './view.js';
import { LETTERS, LINES, SIZE, NUMBERS, completedLines, letters } from '../bingo/rules.js';

// Widest an opponent's header bar gets on wide screens (px).
const BAR_MAX = 300;
// Widest the grid gets (px).
const GRID_MAX = 460;
// The letters row over the grid, as a share of the grid's width.
const LETTERS_H = 0.12;

const colorOf = (i) => AVATARS[i % AVATARS.length];

export class BingoView extends TableView {
  constructor(container) {
    super(container);
    this.root.classList.add('bingo');
    for (const { spot, label } of Object.values(this.spots)) {
      spot.classList.add('hidden');
      label.classList.add('hidden');
    }
    this.tray.classList.add('hidden');
    this.handlers.cell = () => {};
    // Set by the human while arranging (a grid of their own) or picking a number.
    this.draft = null;
    this.selected = null;

    this.lettersEl = div('bingo-letters hidden', this.panelLayer);
    this.letterEls = LETTERS.map((l) => div('bingo-letter', this.lettersEl, l));
    this.gridEl = div('bingo-grid hidden', this.panelLayer);
    this.cellEls = Array.from({ length: NUMBERS }, (_, i) => {
      const b = document.createElement('button');
      b.className = 'bcell';
      b.dataset.i = i;
      b.appendChild(document.createElement('span'));
      this.gridEl.appendChild(b);
      return b;
    });
    this.lineEls = LINES.map(() => div('bline', this.gridEl));
    this.gridEl.addEventListener('click', (e) => {
      const cell = e.target.closest('.bcell');
      if (cell) this.handlers.cell(Number(cell.dataset.i));
    });

    this.callEl = div('bingo-call hidden', this.panelLayer);
    this.ballEl = div('bingo-ball', this.callEl);
    const side = div('call-side', this.callEl);
    this.whoEl = div('call-who', side);
    this.historyEl = div('call-history', side);
    this.callKey = '';
    this.ballKey = '';
    // A prompt from the human (arranging) takes the calls' place.
    this.promptEl = div('bingo-prompt hidden', this.panelLayer);
  }

  // Shows `body` where the calls go, or with null, takes it away.
  showPrompt(body) {
    this.promptEl.replaceChildren(...(body ? [body] : []));
    this.promptEl.classList.toggle('hidden', !body);
    this.layout();
  }

  // No deck and discard counts in the HUD.
  showPiles() {}

  // Header-only panels.
  buildPanels(game) {
    for (const p of this.panels) p.el.remove();
    this.panels = game.state.players.map((p, i) => {
      const el = div('seat-panel', this.panelLayer);
      el.style.setProperty('--c', colorOf(i));
      return { el, head: div('seat-head', el), html: '' };
    });
  }

  detach() {
    this.draft = null;
    this.selected = null;
    this.promptEl.replaceChildren();
    this.promptEl.classList.add('hidden');
    super.detach();
  }

  // The human's grid while arranging it, and the square picked (or null).
  setDraft(grid, selected = null) {
    this.draft = grid;
    this.selected = selected;
    this.layout();
  }

  // ---------- geometry ----------

  // Opponents' bars across the top (two to a row on tall screens), your grid at the
  // bottom with your bar above it, and the calls in between. On wide screens the
  // calls sit beside the grid instead.
  fit() {
    const { w, h } = this.size;
    const ins = this.inset;
    const portrait = ins.portrait;
    const n = this.game?.state.players.length ?? 4;
    const k = Math.max(1, n - 1);
    const small = w < 700 || h < 540;
    const pad = small ? 8 : 14;
    const gap = small ? 8 : 12;
    const inner = small ? 6 : 10;
    const head = small ? 30 : 36;
    const bottomGap = small ? 10 : 16;

    const x0 = pad;
    // No end-turn button to keep clear of (ins.right).
    const W = w - 2 * pad;
    const cols = portrait ? Math.min(k, 2) : k;
    const colW = Math.min((W - (cols - 1) * gap) / cols, portrait ? Infinity : BAR_MAX);
    const top = ins.top + 6;
    const bars = [];
    for (let i = 0; i < k; i++) {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, k - row * cols);
      const rowX = x0 + (W - (inRow * colW + (inRow - 1) * gap)) / 2;
      bars.push({ x: rowX + (i % cols) * (colW + gap), y: top + row * (head + gap), w: colW, h: head });
    }
    const oppBottom = top + Math.ceil(k / cols) * (head + gap) - gap;
    // Room between your bar (and the status row on tall screens) and the grid.
    const above = portrait ? ins.bottom : gap;
    const block = (S) => S * (1 + LETTERS_H);

    let S;
    let grid;
    let call;
    let me;
    if (portrait) {
      // Keep room in the middle for the calls.
      const middle = small ? 96 : 140;
      const room = h - bottomGap - (oppBottom + gap + middle + gap + head + above);
      S = Math.max(150, Math.min(W, GRID_MAX, room / (1 + LETTERS_H)));
      const blockTop = h - bottomGap - block(S);
      grid = { x: x0 + (W - S) / 2, y: blockTop + S * LETTERS_H, s: S };
      me = { x: x0, y: blockTop - above - head, w: W, h: head };
      const areaTop = oppBottom + gap;
      call = { x: x0, y: areaTop, w: W, h: Math.max(60, me.y - gap - areaTop), row: true };
    } else {
      const room = h - bottomGap - (oppBottom + gap + head + above);
      S = Math.max(150, Math.min(GRID_MAX, room / (1 + LETTERS_H), W * 0.58));
      const callW = Math.max(140, Math.min(W - S - 2 * gap, S * 0.8, 340));
      const total = S + 2 * gap + callW;
      const left = x0 + (W - total) / 2;
      const blockTop = h - bottomGap - block(S);
      grid = { x: left, y: blockTop + S * LETTERS_H, s: S };
      me = { x: left, y: blockTop - above - head, w: total, h: head };
      call = { x: left + S + 2 * gap, y: grid.y, w: callW, h: S, row: false };
    }
    const lettersBox = { x: grid.x, y: grid.y - S * LETTERS_H, w: S, h: S * LETTERS_H };
    // The status row (tall screens) sits just above the grid; prompts dock above your bar.
    const hand = { x0, x1: x0 + W, top: lettersBox.y, h: h - lettersBox.y, cw: 0, visible: h - lettersBox.y };
    const dock = h - me.y;
    const discard = { x: w / 2, y: h / 2, w: 0 };
    this.geo = { portrait, head, side: 0, lead: head, inner, panels: [me, ...bars], hand, grid, letters: lettersBox, call, dock, deck: discard, discard };
    this.layoutKey = `bingo:${portrait ? 'tall' : 'wide'}:${n}`;
    this.root.style.setProperty('--head', `${head}px`);
    this.root.style.setProperty('--inner', `${inner}px`);
    this.root.style.setProperty('--side', '0px');
    this.root.style.setProperty('--cell', `${r1(S / SIZE)}px`);
    this.root.classList.toggle('small', small);
    this.root.classList.remove('bars');
  }

  // ---------- layout ----------

  layout() {
    const game = this.game;
    // The base constructor lays out before this one has built the grid.
    if (!this.gridEl) return;
    const prompt = this.promptEl.hasChildNodes();
    for (const e of [this.gridEl, this.lettersEl]) e.classList.toggle('hidden', !game);
    this.callEl.classList.toggle('hidden', !game || prompt);
    if (!game) return;
    if (prompt) setBox(this.promptEl, this.geo.call);
    const { state } = game;
    state.players.forEach((p, i) => this.layoutPanel(p, i, this.zoneIndex(i)));
    this.layoutGrid(state);
    this.layoutCall(state);
    const me = state.players[this.seat];
    this.root.classList.toggle('my-turn', !!me?.isHuman && state.phase === 'call' && state.current === this.seat);
  }

  layoutPanel(p, i, zi) {
    const r = this.geo.panels[zi];
    const panel = this.panels[i];
    const { state } = this.game;
    setBox(panel.el, r);
    const mine = zi === 0;
    panel.el.classList.toggle('me', mine);
    panel.el.classList.toggle('active', state.phase === 'call' && state.current === i);
    panel.el.classList.toggle('winner', state.phase === 'over' && state.winners.includes(p));
    panel.el.classList.toggle('compact', r.w < 240);

    const you = mine && p.isHuman && p.name.trim().toLowerCase() !== 'you' ? '<span class="you">You</span>' : '';
    const tag = p.tag ? `<span class="tag">${p.tag}</span>` : '';
    const initial = [...p.name.trim()][0]?.toUpperCase() ?? '?';
    const lit = letters(p.lines);
    const word = LETTERS.map((l, j) => `<i class="${j < lit ? 'on' : ''}">${l}</i>`).join('');
    // While grids are arranged, who's ready instead (nobody has a line yet).
    const chip = state.phase === 'arrange' || state.phase === 'setup'
      ? `<span class="chip ready ${p.ready ? 'on' : ''}">${p.ready ? '✓ Ready' : 'Arranging…'}</span>`
      : `<span class="chip word" title="Lines crossed off">${word}</span>`;
    const html = `<span class="avatar">${esc(initial)}</span><span class="seat-name">${tag}${esc(p.name)}</span><span class="mic"></span>${you}<span class="chips">${chip}</span>`;
    if (html !== panel.html) {
      panel.head.innerHTML = html;
      panel.html = html;
    }
  }

  // Your grid: crossed-off numbers, finished lines struck through, and B-I-N-G-O above.
  layoutGrid(state) {
    const { grid: g, letters: lb } = this.geo;
    setBox(this.gridEl, { x: g.x, y: g.y, w: g.s, h: g.s });
    setBox(this.lettersEl, lb);
    const me = state.players[this.seat];
    const arranging = !!this.draft;
    const grid = this.draft ?? me?.grid ?? null;
    const called = new Set(state.called);
    const last = state.called.at(-1);
    const done = completedLines(grid, state.called);
    const inLine = new Set(done.flatMap((i) => LINES[i]));
    const calling = !!me?.isHuman && state.phase === 'call' && state.current === this.seat;
    this.gridEl.classList.toggle('arranging', arranging);
    this.gridEl.classList.toggle('calling', calling);
    this.gridEl.classList.toggle('blank', !grid);
    this.cellEls.forEach((cell, i) => {
      const n = grid?.[i] ?? null;
      const text = n == null ? '' : String(n);
      if (cell.firstChild.textContent !== text) cell.firstChild.textContent = text;
      const crossed = n != null && called.has(n);
      cell.classList.toggle('crossed', crossed);
      cell.classList.toggle('gold', inLine.has(i));
      cell.classList.toggle('last', crossed && n === last);
      cell.classList.toggle('selected', this.selected === i);
      cell.classList.toggle('open', calling && n != null && !crossed);
      cell.disabled = !(arranging || (calling && !crossed));
    });
    // A stroke through each finished line, from end to end.
    const c = g.s / SIZE;
    LINES.forEach((line, i) => {
      const el = this.lineEls[i];
      const on = done.includes(i);
      el.classList.toggle('on', on);
      if (!on) return;
      const at = (pos) => ({ x: ((pos % SIZE) + 0.5) * c, y: (Math.floor(pos / SIZE) + 0.5) * c });
      const a = at(line[0]);
      const b = at(line.at(-1));
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const ext = c * 0.3;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      el.style.left = `${r1(a.x - ux * ext)}px`;
      el.style.top = `${r1(a.y - uy * ext)}px`;
      el.style.width = `${r1(len + 2 * ext)}px`;
      el.style.transform = `rotate(${r1((Math.atan2(uy, ux) * 180) / Math.PI)}deg)`;
    });
    const lit = letters(me?.lines ?? 0);
    this.letterEls.forEach((el, j) => el.classList.toggle('on', j < lit));
  }

  // The number just called, big, in its caller's colour; the earlier ones beside it.
  layoutCall(state) {
    const { call } = this.geo;
    setBox(this.callEl, call);
    this.callEl.classList.toggle('row', call.row);
    const ball = clamp(Math.min(call.row ? call.h * 0.82 : call.w * 0.55, call.row ? call.w * 0.3 : call.h * 0.4), 44, 120);
    this.callEl.style.setProperty('--ball', `${r1(ball)}px`);
    const n = state.called.length;
    const last = state.called.at(-1);
    const by = state.callers.at(-1);
    const name = (i) => (i === this.seat && state.players[i]?.isHuman ? 'You' : esc(state.players[i]?.name ?? ''));
    let who;
    if (state.phase === 'arrange' || state.phase === 'setup') who = 'Everyone is arranging their grid…';
    else if (!n) who = `<b>${name(state.current)}</b> ${state.current === this.seat && state.players[this.seat]?.isHuman ? 'call' : 'calls'} first`;
    else who = `<b>${name(by)}</b> called <b>${last}</b> · ${n} of ${NUMBERS}`;
    const history = state.called.slice(0, -1).map((x, j) => `<i style="--c: ${colorOf(state.callers[j])}">${x}</i>`).reverse().join('');
    const key = `${who}|${history}`;
    if (key !== this.callKey) {
      this.callKey = key;
      this.whoEl.innerHTML = who;
      this.historyEl.innerHTML = history;
    }
    this.ballEl.classList.toggle('hidden', state.phase === 'arrange' || state.phase === 'setup');
    const ballKey = n ? `${last}:${by}` : '';
    if (ballKey !== this.ballKey) {
      this.ballKey = ballKey;
      this.ballEl.textContent = n ? String(last) : '?';
      this.ballEl.classList.toggle('empty', !n);
      this.ballEl.style.setProperty('--c', n ? colorOf(by) : 'rgba(255, 255, 255, 0.15)');
      // Pop the new number in.
      this.ballEl.classList.remove('pop');
      if (n) {
        void this.ballEl.offsetWidth;
        this.ballEl.classList.add('pop');
      }
    }
  }
}
