// The Wordle table, built on the Monopoly Deal one but with no cards: a bar per
// opponent (their score, and their guesses so far as coloured squares only), your
// bar with the clock, your six rows of guesses, and a keyboard along the bottom.
// Typing happens here, on the keyboard or the on-screen one; a finished word goes
// to the 'submit' handler (the human controller), which says whether it took it.
import { TableView, AVATARS, div, setBox, clamp, r1, esc } from './view.js';
import { LENGTH, MAX_GUESSES, isWord, letterMarks } from '../wordle/rules.js';

// Widest an opponent's bar gets on wide screens (px).
const BAR_MAX = 300;
// Biggest a letter square gets (px).
const TILE_MAX = 64;
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', '+zxcvbnm-'];
// How long the "not in word list" note stays up (ms).
const NOTE_MS = 1400;

const colorOf = (i) => AVATARS[i % AVATARS.length];
const clock = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
// A dialog is up (the lobby, a result, the rules): keys aren't for the game.
const dialogOpen = () => !!document.querySelector('#modal-layer > .modal-backdrop:not(.hidden), #lobby-layer > .modal-backdrop, body > .modal-backdrop.top');

export class WordleView extends TableView {
  constructor(container) {
    super(container);
    this.root.classList.add('wordle');
    for (const { spot, label } of Object.values(this.spots)) {
      spot.classList.add('hidden');
      label.classList.add('hidden');
    }
    this.tray.classList.add('hidden');
    this.handlers.submit = () => false;
    this.handlers.marked = () => {};
    // What you're typing, a word sent but not marked yet, and a word entered before
    // the game asked for one (sent as soon as it does). Online the next guess can be
    // typed and entered while the last is still on its way.
    this.entry = '';
    this.sent = null;
    this.queued = null;
    this.entryRound = 0;
    // Your guesses marked so far this word (to hear each new one turn over).
    this.marked = 0;

    this.boardEl = div('wordle-board hidden', this.panelLayer);
    this.rowEls = Array.from({ length: MAX_GUESSES }, () => {
      const row = div('wrow', this.boardEl);
      const tiles = Array.from({ length: LENGTH }, (_, i) => {
        const t = div('wtile', row);
        t.style.setProperty('--i', i);
        return t;
      });
      return { row, tiles };
    });
    this.noteEl = div('wordle-note hidden', this.panelLayer);
    this.revealEl = div('wordle-reveal hidden', this.panelLayer);
    this.revealKey = '';

    this.keysEl = div('wordle-keys hidden', this.panelLayer);
    this.keyEls = new Map();
    for (const letters of KEY_ROWS) {
      const row = div('krow', this.keysEl);
      for (const k of letters) {
        const b = document.createElement('button');
        b.className = `key${k === '+' || k === '-' ? ' wide' : ''}`;
        b.dataset.k = k === '+' ? 'Enter' : k === '-' ? 'Backspace' : k;
        b.textContent = k === '+' ? 'Enter' : k === '-' ? '⌫' : k;
        if (k === '-') b.title = 'Delete';
        row.appendChild(b);
        this.keyEls.set(k, b);
      }
    }
    this.keysEl.addEventListener('click', (e) => {
      const b = e.target.closest('.key');
      if (b) this.press(b.dataset.k);
    });
    document.addEventListener('keydown', (e) => {
      if (this.root.hidden || !this.game || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea') || dialogOpen()) return;
      const k = e.key === 'Enter' || e.key === 'Backspace' ? e.key : /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : null;
      if (!k) return;
      e.preventDefault();
      this.press(k);
    });
    // The clock in your bar.
    this.tick = setInterval(() => this.game && !this.root.hidden && this.layoutClock(), 250);
  }

  get me() {
    return this.game?.state.players[this.seat] ?? null;
  }

  // You're still in this word and may type.
  get canType() {
    const me = this.me;
    const { state } = this.game ?? {};
    return !!me?.isHuman && state?.phase === 'guess' && !me.solved && !me.done && me.guesses.length < MAX_GUESSES;
  }

  // Words entered but not marked yet: they fill the rows after your guesses.
  get ahead() {
    return [this.sent?.word, this.queued].filter(Boolean);
  }

  press(k) {
    const ahead = this.ahead.length;
    // No row left to type in.
    if (!this.canType || this.me.guesses.length + ahead >= MAX_GUESSES) return;
    if (k === 'Backspace') this.entry = this.entry.slice(0, -1);
    // Two words already on their way: this one waits for a mark first.
    else if (k === 'Enter') return ahead < 2 && this.submit();
    else if (this.entry.length < LENGTH) this.entry += k;
    this.layout();
  }

  submit() {
    const word = this.entry;
    if (word.length < LENGTH) return this.reject('Not enough letters');
    if (!isWord(word)) return this.reject('Not in word list');
    this.entry = '';
    // Online, between one guess and the server asking for the next, it waits.
    if (!this.sent && this.handlers.submit(word)) this.sent = { word, at: this.me.guesses.length };
    else this.queued = word;
    this.layout();
  }

  // The human controller has just been asked for a guess: one typed already?
  takeQueued() {
    const word = this.queued;
    this.queued = null;
    if (word) {
      this.sent = { word, at: this.me.guesses.length };
      this.layout();
    }
    return word;
  }

  reject(text) {
    const row = this.rowEls[this.me.guesses.length + this.ahead.length]?.row;
    if (row) {
      row.classList.remove('shake');
      void row.offsetWidth;
      row.classList.add('shake');
    }
    const pill = document.createElement('span');
    pill.textContent = text;
    this.noteEl.replaceChildren(pill);
    this.noteEl.classList.remove('hidden');
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => this.noteEl.classList.add('hidden'), NOTE_MS);
  }

  // No deck and discard counts in the HUD.
  showPiles() {}

  // Header-only panels; opponents' have their squares on the right.
  buildPanels(game) {
    for (const p of this.panels) p.el.remove();
    this.panels = game.state.players.map((p, i) => {
      const el = div('seat-panel', this.panelLayer);
      el.style.setProperty('--c', colorOf(i));
      const head = div('seat-head', el);
      const mini = div('wmini', el);
      return { el, head, mini, html: '', miniKey: '' };
    });
  }

  detach() {
    this.entry = '';
    this.sent = this.queued = null;
    this.entryRound = 0;
    this.revealKey = '';
    super.detach();
    for (const e of [this.boardEl, this.keysEl, this.revealEl, this.noteEl]) e.classList.add('hidden');
  }

  // ---------- geometry ----------

  // Opponents' bars across the top (two to a row on tall screens), the keyboard along
  // the bottom, and in between your bar and your guesses. On tall screens the status
  // row sits between your guesses and the keyboard.
  fit() {
    const { w, h } = this.size;
    const ins = this.inset;
    const portrait = ins.portrait;
    const n = this.game?.state.players.length ?? 4;
    // Opponents: none in a practice game, and then your bar goes up top.
    const k = n - 1;
    const small = w < 700 || h < 540;
    const pad = small ? 8 : 14;
    const gap = small ? 8 : 12;
    const inner = small ? 6 : 10;
    const head = small ? 30 : 36;
    // Opponents' bars are taller, for six rows of squares.
    const bar = small ? 44 : 52;
    const bottomGap = small ? 8 : 14;

    const x0 = pad;
    const W = w - 2 * pad;
    const cols = Math.max(1, portrait ? Math.min(k, 2) : k);
    const colW = Math.min((W - (cols - 1) * gap) / cols, portrait ? Infinity : BAR_MAX);
    const top = ins.top + 6;
    const bars = [];
    for (let i = 0; i < k; i++) {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, k - row * cols);
      const rowX = x0 + (W - (inRow * colW + (inRow - 1) * gap)) / 2;
      bars.push({ x: rowX + (i % cols) * (colW + gap), y: top + row * (bar + gap), w: colW, h: bar });
    }
    const oppBottom = top + Math.ceil(k / cols) * (bar + gap) - gap;

    // The keyboard: ten keys across at most 560px, a little taller than wide.
    const kbW = Math.min(W, 560);
    const keyGap = small ? 5 : 6;
    const keyH = clamp(((kbW - 9 * keyGap) / 10) * 1.35, 38, 58);
    const kbH = 3 * keyH + 2 * keyGap;
    const keys = { x: x0 + (W - kbW) / 2, y: h - bottomGap - kbH, w: kbW, h: kbH, key: keyH, gap: keyGap };

    // Your guesses fill what's left, under your bar.
    const tg = small ? 5 : 6;
    const below = portrait ? ins.bottom + 4 : gap;
    const meTop = oppBottom + gap;
    const boardTop = meTop + head + gap;
    const room = keys.y - below - boardTop;
    const T = Math.max(24, Math.min(TILE_MAX, (room - (MAX_GUESSES - 1) * tg) / MAX_GUESSES, (W - (LENGTH - 1) * tg) / LENGTH));
    const bw = LENGTH * T + (LENGTH - 1) * tg;
    const bh = MAX_GUESSES * T + (MAX_GUESSES - 1) * tg;
    // Centred in its room, but kept close under your bar.
    const by = boardTop + Math.max(0, Math.min((room - bh) / 2, 24));
    const board = { x: x0 + (W - bw) / 2, y: by, w: bw, h: bh, tile: T, gap: tg };
    const meW = Math.min(W, Math.max(bw, 340));
    const me = { x: x0 + (W - meW) / 2, y: by - gap - head, w: meW, h: head };

    // The status row (tall screens) sits just above the keyboard.
    const hand = { x0, x1: x0 + W, top: keys.y, h: h - keys.y, cw: 0, visible: h - keys.y };
    const discard = { x: w / 2, y: h / 2, w: 0 };
    this.geo = { portrait, head, bar, side: 0, lead: head, inner, panels: [me, ...bars], hand, board, keys, dock: h - me.y, deck: discard, discard };
    this.layoutKey = `wordle:${portrait ? 'tall' : 'wide'}:${n}`;
    this.root.style.setProperty('--head', `${head}px`);
    this.root.style.setProperty('--inner', `${inner}px`);
    this.root.style.setProperty('--side', '0px');
    this.root.style.setProperty('--tile', `${r1(T)}px`);
    this.root.style.setProperty('--tgap', `${tg}px`);
    this.root.style.setProperty('--key-h', `${r1(keyH)}px`);
    this.root.style.setProperty('--key-gap', `${keyGap}px`);
    this.root.style.setProperty('--mini', `${Math.floor((bar - 10 - 5) / 6)}px`);
    this.root.classList.toggle('small', small);
    this.root.classList.remove('bars');
  }

  // ---------- layout ----------

  layout() {
    const game = this.game;
    // The base constructor lays out before this one has built the board.
    if (!this.boardEl) return;
    for (const e of [this.boardEl, this.keysEl]) e.classList.toggle('hidden', !game);
    if (!game) return;
    const { state } = game;
    // A new word: start typing afresh.
    if (state.round !== this.entryRound) {
      this.entryRound = state.round;
      this.entry = '';
      this.sent = this.queued = null;
      this.marked = 0;
      this.noteEl.classList.add('hidden');
    }
    const me = this.me;
    if (!me || state.phase !== 'guess') this.sent = this.queued = null;
    else if (this.sent && me.guesses.length > this.sent.at) this.sent = null;
    state.players.forEach((p, i) => this.layoutPanel(p, i, this.zoneIndex(i)));
    this.layoutBoard(state, me);
    this.layoutKeys(me);
    this.layoutReveal(state);
    this.layoutClock();
    this.root.classList.toggle('my-turn', this.canType);
  }

  layoutPanel(p, i, zi) {
    const r = this.geo.panels[zi];
    const panel = this.panels[i];
    const { state } = this.game;
    setBox(panel.el, r);
    const mine = zi === 0;
    panel.el.classList.toggle('me', mine);
    panel.el.classList.toggle('winner', state.phase === 'over' ? state.winners.includes(p) : state.roundWinner === p);
    panel.el.classList.toggle('compact', r.w < 240);
    panel.el.classList.toggle('wbar', !mine);

    const you = mine && p.isHuman && p.name.trim().toLowerCase() !== 'you' ? '<span class="you">You</span>' : '';
    const tag = p.tag ? `<span class="tag">${p.tag}</span>` : '';
    const initial = [...p.name.trim()][0]?.toUpperCase() ?? '?';
    const live = state.phase === 'guess';
    const how = p.solved ? '<span class="chip got">✓ Got it</span>' : live && p.done ? '<span class="chip out">✗ Out</span>' : '';
    const clockChip = mine ? '<span class="chip wclock"></span>' : '';
    const score = `<span class="chip score" title="Words won">★ ${p.score}</span>`;
    const html = `<span class="avatar">${esc(initial)}</span><span class="seat-name">${tag}${esc(p.name)}</span><span class="mic"></span>${you}<span class="chips">${how}${clockChip}${score}</span>`;
    if (html !== panel.html) {
      panel.head.innerHTML = html;
      panel.html = html;
      panel.clockEl = panel.head.querySelector('.wclock');
    }
    // Opponents' guesses as squares, without the letters (online they're not sent).
    panel.mini.classList.toggle('hidden', mine);
    if (mine) return;
    const marks = p.guesses.map((g) => g.mark);
    const key = marks.join(',');
    if (key !== panel.miniKey) {
      panel.miniKey = key;
      const rows = Array.from({ length: MAX_GUESSES }, (_, j) => `<b>${[...(marks[j] ?? '     ')].map((m) => `<i class="${m.trim()}"></i>`).join('')}</b>`);
      panel.mini.innerHTML = rows.join('');
    }
    // Once the word's over, their guesses on hover.
    const words = p.guesses.map((g) => g.word).filter(Boolean);
    panel.el.title = words.length ? words.join(', ').toUpperCase() : '';
  }

  // Your guesses, marked, then any entered but not marked yet, the word you're typing,
  // and empty rows.
  layoutBoard(state, me) {
    const g = this.geo.board;
    setBox(this.boardEl, g);
    setBox(this.noteEl, { x: g.x, y: g.y + 4, w: g.w, h: 40 });
    const guesses = me?.guesses ?? [];
    const live = state.phase === 'guess';
    const ahead = live ? this.ahead : [];
    this.rowEls.forEach(({ row, tiles }, r) => {
      const done = guesses[r];
      const waiting = done ? null : ahead[r - guesses.length] ?? null;
      const current = live && r === guesses.length + ahead.length;
      row.classList.toggle('current', current && this.canType);
      row.classList.toggle('sent', !!waiting);
      tiles.forEach((t, i) => {
        const letter = done ? done.word?.[i] ?? '' : waiting ? waiting[i] : current ? this.entry[i] ?? '' : '';
        if (t.textContent !== letter) t.textContent = letter;
        const m = done ? done.mark[i] : '';
        for (const c of ['g', 'y', 'b']) t.classList.toggle(c, m === c);
        // Marked squares turn over once, one after another.
        t.classList.toggle('rev', !!done);
        t.classList.toggle('filled', !done && !!letter);
      });
    });
    if (guesses.length > this.marked && !this.snapping) this.handlers.marked(guesses.at(-1).mark);
    this.marked = guesses.length;
    // Your winning row bounces.
    const won = me?.solved ? guesses.length - 1 : -1;
    this.rowEls.forEach(({ row }, r) => row.classList.toggle('won', r === won));
  }

  layoutKeys(me) {
    const k = this.geo.keys;
    setBox(this.keysEl, k);
    const marks = letterMarks(me?.isHuman ? me.guesses : []);
    for (const [key, b] of this.keyEls) {
      const m = marks[key] ?? '';
      for (const c of ['g', 'y', 'b']) b.classList.toggle(c, m === c);
    }
    this.keysEl.classList.toggle('off', !this.canType);
  }

  // Between words: the answer, and who got it first.
  layoutReveal(state) {
    const show = state.phase === 'reveal' && !!state.answer;
    this.revealEl.classList.toggle('hidden', !show);
    if (!show) {
      this.revealKey = '';
      return;
    }
    const g = this.geo.board;
    setBox(this.revealEl, { x: g.x - 10, y: g.y + g.h / 2 - 70, w: g.w + 20, h: 140 });
    const w = state.roundWinner;
    const key = `${state.round}:${state.answer}:${w?.id ?? ''}`;
    if (key === this.revealKey) return;
    this.revealKey = key;
    const mine = w && w.id === this.seat && w.isHuman;
    const n = w?.guesses.length ?? 0;
    const caption = !w ? 'Nobody got it' : mine ? `You got it in ${n}! <b>+1</b>` : `<b>${esc(w.name)}</b> got it in ${n}`;
    const tiles = [...state.answer].map((c, i) => `<i style="--i: ${i}">${c}</i>`).join('');
    this.revealEl.innerHTML = `<div class="wanswer${w ? '' : ' missed'}">${tiles}</div><div class="wcaption">${caption}</div>`;
  }

  // The time left on this word, in your bar; it turns red near the end.
  layoutClock() {
    const el = this.panels[this.seat]?.clockEl;
    if (!el) return;
    const { state } = this.game;
    const live = state.phase === 'guess' && state.endsAt;
    const left = live ? Math.max(0, state.endsAt - Date.now()) : 0;
    const text = live ? `⏱ ${clock(left)}` : '';
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('hidden', !live);
    el.classList.toggle('low', live && left <= 30_000);
  }
}
