// DOM overlay: status bar, log, toasts, hover preview, popup menus and modals.
import { cardImageURL, isFlipped, MONEY_COLORS } from '../render/textures.js';
import { ACTIONS, buildDeck } from '../game/cards.js';
import * as R from '../game/rules.js';
import { buildDeck as playingDeck, SUIT_ORDER } from '../callbridge/cards.js';
import { DECK_STYLES, deckStyle, setDeckStyle, suitLook, rankName, restyle } from '../render/deck-style.js';
import { GAMES, TRICK_GAMES, PLAYING_CARD_GAMES } from '../game/settings.js';
import { buildDeck as leastCountDeck, ROUND_COUNTS, DEFAULT_ROUNDS, CAUGHT } from '../leastcount/rules.js';
import { STACKS, DEFAULT_STACK, BLINDS, DEFAULT_BLINDS, blindsKey } from '../poker/rules.js';
import { SCORING, DEFAULT_SCORING } from '../judgement/rules.js';
import { WORD_COUNTS } from '../wordle/rules.js';
import { LEVELS, DEFAULT_LEVEL, MAX_MISTAKES } from '../sudoku/rules.js';
import { sound } from './sound.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Phones and other tall screens; must match the portrait rules in style.css.
const PORTRAIT = matchMedia('(max-aspect-ratio: 1/1), (max-width: 640px)');
// Each game's name in the top bar and on its start screen. Call Bridge's has the four
// suits of the deck style in place of DEAL, in their text forms, not emoji.
const suitLogo = () => SUIT_ORDER.map((key) => `<i class="${key}">${suitLook(key).symbol}&#xFE0E;</i>`).join('');
const BRANDS = {
  deal: '<span class="logo">MONOPOLY</span><span class="deal">DEAL</span>',
  callbridge: () => `<span class="logo callbridge">CALL BRIDGE</span><span class="deal suits">${suitLogo()}</span>`,
  // Judgement: hands from 7 cards down to 1 and back.
  judgement: '<span class="logo judgement">JUDGEMENT</span><span class="deal judgement-mark">7·1·7</span>',
  // The aim is a hand worth nothing. "0 pts" reads as that, in the same gold type as
  // Judgement's 7·1·7; a bare gold coin of 0 looked like an empty count badge.
  leastcount: '<span class="logo leastcount">LEAST COUNT</span><span class="deal lc-mark" title="The aim: a hand worth 0">0<span class="lc-unit">pts</span></span>',
  poker: '<span class="logo poker">POKER</span><span class="deal poker-mark">HOLD’EM</span>',
  pool: '<span class="logo pool">POOL</span><span class="deal pool-mark"><i>8</i></span>',
  bingo: '<span class="logo bingo">BINGO</span><span class="deal bingo-mark">1–25</span>',
  wordle: '<span class="logo wordle">WORDLE</span><span class="deal wordle-mark"><i class="g"></i><i class="y"></i><i></i></span>',
  sudoku: '<span class="logo sudoku">SUDOKU</span><span class="deal sudoku-mark">9×9</span>',
};

const brand = (kind) => (typeof BRANDS[kind] === 'function' ? BRANDS[kind]() : BRANDS[kind]);

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

// A little crossed-off grid for Bingo's tile on the home screen.
function miniBingo() {
  const grid = el('span', 'tile-bingo');
  const nums = [7, 19, 3, 24, 11, 15, 1, 22, 9, 5, 20, 13, 25, 2, 17, 4, 23, 8, 14, 21, 12, 6, 18, 10, 16];
  const crossed = new Set([0, 6, 12, 18, 24, 3, 21]);
  grid.innerHTML = nums.map((n, i) => `<i class="${crossed.has(i) ? 'x' : ''}${i % 6 === 0 ? ' gold' : ''}">${n}</i>`).join('');
  return grid;
}

// A rack of balls for Pool's tile on the home screen.
function miniPool() {
  const rack = el('span', 'tile-pool');
  const rows = [[1], [9, 2], [3, 8, 10], [11, 4, 12, 5], [13, 6, 14, 7, 15]];
  rack.innerHTML = rows.map((row) => `<b>${row.map((n) => `<i class="pb${n >= 9 ? ' st' : ''}" style="--b: var(--ball${n >= 9 ? n - 8 : n})">${n}</i>`).join('')}</b>`).join('');
  return rack;
}

// Three marked guesses for Wordle's tile on the home screen.
function miniWordle() {
  const board = el('span', 'tile-wordle');
  const rows = [['crane', 'bybbg'], ['route', 'gbbbg'], ['ridge', 'ggggg']];
  board.innerHTML = rows.map(([word, mark]) => `<b>${[...word].map((c, i) => `<i class="${mark[i]}">${c}</i>`).join('')}</b>`).join('');
  return board;
}

// A box of a puzzle for Sudoku's tile on the home screen: some numbers given, some
// put in (m), some still to find (e).
function miniSudoku() {
  const box = el('span', 'tile-sudoku');
  const cells = [['5', ''], ['3', 'm'], ['', 'e'], ['6', ''], ['', 'e'], ['9', 'm'], ['', 'e'], ['8', ''], ['1', 'm']];
  box.innerHTML = cells.map(([d, cls]) => `<i class="${cls}">${d || '·'}</i>`).join('');
  return box;
}

// Set once "Don't show this again" is ticked on the fantasy deck's guide.
const GUIDE_OFF = 'md-fantasy-guide-off';
// One face card of each rank in a different suit, so the guide shows all four colours.
const GUIDE_FACES = [['clubs', 11], ['hearts', 12], ['diamonds', 13], ['spades', 14]];

// The fantasy deck next to the classic one: its face cards from lowest to highest (with
// the cards they stand for), and which suit is which.
function fantasyGuide() {
  const deck = playingDeck();
  const classic = DECK_STYLES.classic;
  const wrap = el('div', 'fantasy-guide');
  wrap.appendChild(el('p', 'modal-body', 'The cards rank just like a normal deck. From lowest to highest: <b>2 to 10</b>, then'));
  const row = wrap.appendChild(el('div', 'rank-order'));
  for (const [i, [suit, rank]] of GUIDE_FACES.entries()) {
    if (i) row.appendChild(el('span', 'rank-step', '›'));
    const item = row.appendChild(el('div', 'rank-card'));
    item.appendChild(thumb(deck.find((c) => c.key === `${suit}-${rank}`), { flipped: false }));
    item.appendChild(el('b', null, esc(rankName(rank))));
    item.appendChild(el('span', 'muted', `for the ${classic.ranks[rank][1].toLowerCase()}`));
  }
  wrap.appendChild(el('p', 'modal-body', 'So the <b>Phoenix</b> is the highest card of every suit. The suits are:'));
  const suits = wrap.appendChild(el('ul', 'suit-key'));
  for (const key of SUIT_ORDER) {
    const look = suitLook(key);
    suits.appendChild(el('li', null, `<span class="suit ${key}">${look.symbol}&#xFE0E;</span> <b>${look.name}</b> <span class="muted">for ${classic.suits[key].name.toLowerCase()}</span>`));
  }
  return wrap;
}

export function thumb(card, { flipped = isFlipped(card) } = {}) {
  const img = el('img', `thumb${flipped ? ' flipped' : ''}`);
  img.src = cardImageURL(card);
  img.alt = card.name;
  img.draggable = false;
  return img;
}

export class Hud {
  constructor() {
    this.hudEl = $('#hud');
    this.topbarEl = $('#topbar');
    this.pilesEl = $('#piles');
    this.piles = { deck: $('#pile-deck'), discard: $('#pile-discard') };
    this.logEl = $('#log');
    this.statusEl = $('#status');
    this.toastsEl = $('#toasts');
    this.previewEl = $('#preview');
    this.controlsEl = $('#turn-controls');
    this.playsEl = $('#plays');
    this.hintEl = $('#hint');
    this.popupLayer = $('#popup-layer');
    this.modalLayer = $('#modal-layer');
    this.chatDock = $('#chat-dock');
    this.chatBtn = $('#btn-chat');
    this.chatBadge = $('#chat-badge');
    this.chatPops = $('#chat-pops');
    this.bannerEl = $('#banner');
    this.newBtn = $('#btn-new');
    this.stopBtn = $('#btn-stop');
    this.brandEl = $('#topbar .brand');
    this.infoEl = $('#game-info');
    this.title = document.title;
    this.game = 'deal';
    this.online = false;
    this.unread = 0;
    this.cancelTop = null;
    this.onEndTurn = () => {};
    this.onNewGame = () => {};
    this.onStopGame = () => {};
    this.onGameInfo = () => {};

    $('#btn-end').addEventListener('click', () => this.onEndTurn());
    this.newBtn.addEventListener('click', () => this.onNewGame());
    this.stopBtn.addEventListener('click', () => this.onStopGame());
    $('#btn-rules').addEventListener('click', () => this.showRules());
    this.infoEl.addEventListener('click', () => this.onGameInfo());
    document.addEventListener('visibilitychange', () => !document.hidden && (document.title = this.title));
    this.voiceBtn = $('#btn-voice');
    this.voiceBtn.addEventListener('click', () => this.onVoice(this.voiceBtn));
    this.onVoice = () => {};
    this.musicBtn = $('#btn-music');
    this.musicBtn.addEventListener('click', () => this.onMusic());
    this.onMusic = () => {};
    this.onMuteKey = () => {};
    this.soundBtn = $('#btn-sound');
    this.soundBtn.addEventListener('click', () => this.setMuted(!sound.muted));
    this.setMuted(sound.muted);
    $('#btn-log').addEventListener('click', () => this.logEl.classList.toggle('open'));
    this.chatBtn.addEventListener('click', () => this.setChatDock(!this.chatDock.classList.contains('open')));
    document.addEventListener('keydown', (e) => {
      // Typing in the chat or a name field isn't a shortcut, and in Wordle letters and
      // Enter are for your guess.
      if (e.target.closest?.('input, textarea')) return;
      if (e.key === 'Escape' && this.cancelTop) this.cancelTop();
      else if (this.game === 'wordle') return;
      else if ((e.key === 'e' || e.key === 'E') && !this.cancelTop && this.controlsEl.classList.contains('show')) this.onEndTurn();
      else if ((e.key === 'm' || e.key === 'M') && this.online) this.onMuteKey();
      else if (e.key === 'Enter' && this.online && !this.chatBtn.classList.contains('hidden') && e.target === document.body) {
        e.preventDefault();
        this.setChatDock(true);
      }
    });
  }

  // The game on the table: its name in the top bar and the tab, and the HUD pieces it uses.
  setGame(kind) {
    this.game = kind;
    this.brandEl.innerHTML = brand(kind);
    this.title = document.title = GAMES[kind].name;
    // Call Bridge and Judgement share their HUD pieces ("tricks").
    for (const k of ['tricks', 'bingo', 'wordle', 'pool', 'sudoku', 'leastcount', 'poker']) this.hudEl.classList.toggle(k, k === 'tricks' ? TRICK_GAMES.has(kind) : kind === k);
    // The deck and discard counts come back with the next Monopoly Deal game.
    this.pilesEl.classList.add('idle');
    this.setGameInfo('');
  }

  // A button by the logo with the state of play (Call Bridge and Judgement: trumps and the round).
  setGameInfo(html, title = '') {
    this.infoEl.classList.toggle('hidden', !html);
    if (this.infoEl.innerHTML !== html) this.infoEl.innerHTML = html;
    this.infoEl.title = title;
  }

  // ---------- online extras ----------

  // Screen space (CSS px) the HUD covers, for the table view to keep clear: the top bar,
  // and either the turn controls beside the hand or (portrait) the status row above it.
  // In portrait the deck and discard live in the top bar: where their little cards are.
  insets() {
    this.fitTopbar();
    const portrait = PORTRAIT.matches;
    const spot = (pile) => {
      const r = pile.querySelector('i').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
    };
    return {
      piles: portrait ? { deck: spot(this.piles.deck), discard: spot(this.piles.discard) } : null,
      portrait,
      top: this.topbarEl.getBoundingClientRect().bottom,
      bottom: portrait ? Math.max(this.statusEl.offsetHeight, this.controlsEl.offsetHeight) + 12 : 0,
      right: portrait ? 0 : this.controlsEl.offsetWidth + 30,
    };
  }

  setOnline(on) {
    this.online = on;
    this.newBtn.title = on ? 'Leave room' : 'New game';
    this.newBtn.querySelector('.ico').textContent = on ? '🚪' : '🔄';
    this.newBtn.querySelector('.txt').textContent = this.newBtn.title;
    this.chatBtn.classList.toggle('hidden', !on);
    this.voiceBtn.classList.toggle('hidden', !on);
    this.musicBtn.classList.toggle('hidden', !on);
    if (!on) {
      this.setChatDock(false);
      this.chatPops.innerHTML = '';
    }
  }

  // Host-only "End game" button while an online game runs.
  setHost(on) {
    this.stopBtn.classList.toggle('hidden', !on);
  }

  // Sound on/off; the choice is remembered for the next visit.
  setMuted(muted) {
    sound.setMuted(muted);
    this.soundBtn.querySelector('.ico').textContent = muted ? '🔇' : '🔊';
    this.soundBtn.querySelector('.txt').textContent = muted ? 'Muted' : 'Sound';
    this.soundBtn.title = muted ? 'Sound off' : 'Sound on';
  }

  // Voice chat button: 'off', 'on' or 'muted', lit while you're talking.
  setVoice(state, talking = false) {
    const b = this.voiceBtn;
    b.classList.toggle('on', state === 'on');
    b.classList.toggle('mic-off', state === 'muted');
    b.classList.toggle('talking', talking);
    b.querySelector('.txt').textContent = state === 'off' ? 'Voice' : state === 'muted' ? 'Mic off' : 'Mic on';
    b.title = state === 'off' ? 'Join voice chat' : state === 'muted' ? 'Voice chat · your mic is off (M)' : 'Voice chat · your mic is on (M)';
  }

  setChatDock(open) {
    this.chatDock.classList.toggle('open', open);
    this.chatBtn.classList.toggle('on', open);
    if (open) {
      this.unread = 0;
      this.chatBadge.classList.add('hidden');
      this.chatPops.innerHTML = '';
      this.chatDock.querySelector('input')?.focus();
    }
  }

  // A chat message arrived while the chat isn't on screen.
  chatUnseen(entry) {
    if (this.chatBtn.classList.contains('hidden')) return;
    if (!entry.system) {
      this.unread++;
      this.chatBadge.textContent = String(Math.min(this.unread, 99));
      this.chatBadge.classList.remove('hidden');
    }
    const pop = el('div', `chat-pop${entry.system ? ' system' : ''}`);
    if (!entry.system) pop.appendChild(el('b')).textContent = entry.name;
    pop.appendChild(document.createTextNode(entry.system ? entry.text : ` ${entry.text}`));
    pop.addEventListener('click', () => this.setChatDock(true));
    this.chatPops.appendChild(pop);
    while (this.chatPops.childElementCount > 3) this.chatPops.firstChild.remove();
    setTimeout(() => pop.classList.add('out'), 5000);
    setTimeout(() => pop.remove(), 5500);
  }

  // A strip under the top bar for connection trouble or "a bot is playing for you".
  setBanner(text, buttonLabel = null, onClick = null) {
    this.bannerEl.classList.toggle('hidden', !text);
    this.bannerEl.innerHTML = '';
    if (!text) return;
    this.bannerEl.appendChild(el('span')).textContent = text;
    if (buttonLabel) {
      const b = el('button', 'primary small');
      b.textContent = buttonLabel;
      b.addEventListener('click', onClick);
      this.bannerEl.appendChild(b);
    }
  }

  // Yes/no question in the top layer, above any open prompt.
  confirm({ title, body, ok = 'OK', cancel = 'Cancel' }) {
    return new Promise((resolve) => {
      const prevCancel = this.cancelTop;
      const layer = el('div', 'modal-backdrop top');
      const box = el('div', 'modal');
      box.appendChild(el('h2')).textContent = title;
      if (body) box.appendChild(el('p', 'modal-body')).textContent = body;
      const row = el('div', 'confirm-row');
      const no = el('button', 'ghost');
      no.textContent = cancel;
      const yes = el('button', 'primary');
      yes.textContent = ok;
      row.append(no, yes);
      box.appendChild(row);
      layer.appendChild(box);
      document.body.appendChild(layer);
      const done = (v) => {
        layer.remove();
        this.cancelTop = prevCancel;
        resolve(v);
      };
      no.addEventListener('click', () => done(false));
      yes.addEventListener('click', () => done(true));
      layer.addEventListener('pointerdown', (e) => e.target === layer && done(false));
      this.cancelTop = () => done(false);
      yes.focus();
    });
  }

  // The fantasy deck's guide, at the start of a Call Bridge or Judgement game played with it, until
  // "Don't show this again". In the top layer, above any prompt. Resolves once closed.
  showFantasyGuide() {
    if (deckStyle() !== 'fantasy' || localStorage.getItem(GUIDE_OFF)) return Promise.resolve();
    return new Promise((resolve) => {
      const prevCancel = this.cancelTop;
      const layer = el('div', 'modal-backdrop top');
      const box = el('div', 'modal');
      box.appendChild(el('h2', null, 'The fantasy deck'));
      box.appendChild(fantasyGuide());
      const row = el('div', 'confirm-row guide-row');
      const off = el('label', 'dont-show', '<input type="checkbox"> Don’t show this again');
      const ok = el('button', 'primary', 'Got it');
      row.append(off, ok);
      box.appendChild(row);
      layer.appendChild(box);
      document.body.appendChild(layer);
      const done = () => {
        if (off.querySelector('input').checked) localStorage.setItem(GUIDE_OFF, '1');
        layer.remove();
        this.cancelTop = prevCancel;
        resolve();
      };
      ok.addEventListener('click', done);
      this.cancelTop = done;
      ok.focus();
    });
  }

  // ---------- passive displays ----------

  clearLog() {
    this.logEl.innerHTML = '';
  }

  log(text, kind = 'info') {
    const line = el('div', `log-line ${kind}`);
    line.textContent = PLAYING_CARD_GAMES.has(this.game) ? restyle(text) : text;
    this.logEl.appendChild(line);
    while (this.logEl.childElementCount > 300) this.logEl.firstChild.remove();
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  toast(text, kind = 'info', ms = 2800) {
    const t = el('div', `toast ${kind}`);
    t.textContent = PLAYING_CARD_GAMES.has(this.game) ? restyle(text) : text;
    this.toastsEl.appendChild(t);
    while (this.toastsEl.childElementCount > 3) this.toastsEl.firstChild.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 500);
  }

  clearToasts() {
    this.toastsEl.replaceChildren();
  }

  // The top bar also holds the pile counts in portrait: when the buttons leave no room,
  // the logo gives way (first DEAL or the suits, then the rest).
  fitTopbar() {
    const bar = this.topbarEl;
    bar.classList.remove('tight', 'tighter');
    for (const cls of ['tight', 'tighter']) if (bar.scrollWidth > bar.clientWidth) bar.classList.add(cls);
  }

  // Cards left in the deck and on the discard pile (shown in the top bar in portrait);
  // null hides them between games.
  setPiles(deck, discard) {
    this.pilesEl.classList.toggle('idle', deck == null);
    if (deck == null) return;
    for (const [pile, n] of [[this.piles.deck, deck], [this.piles.discard, discard]]) {
      const b = pile.querySelector('b');
      if (b.textContent !== String(n)) b.textContent = n;
    }
  }

  // `mine`: the status asks something of you, so it glows.
  setStatus(html, mine = false) {
    this.statusEl.innerHTML = html;
    this.statusEl.classList.toggle('mine', mine);
  }

  // The start of your turn: a toast and chime, a buzz on phones, and the tab title
  // while the game is in the background. text: null for no toast; quiet: no chime or buzz either.
  yourTurn(text = 'Your turn!', { quiet = false } = {}) {
    if (text) this.toast(text, 'turn', 1600);
    if (!quiet) {
      sound.play('turn');
      if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.([70, 60, 70]);
    }
    if (document.hidden) document.title = `🔔 ${text ?? 'Your turn'} · ${this.title}`;
  }

  setTurnControls(visible, playsLeft = 0, hint = '') {
    this.controlsEl.classList.toggle('show', visible);
    this.hudEl.classList.toggle('my-turn', visible);
    this.playsEl.innerHTML = Array.from({ length: R.PLAYS_PER_TURN }, (_, i) => `<span class="pip ${i < playsLeft ? 'on' : ''}"></span>`).join('') + `<span class="plays-text">${playsLeft} play${playsLeft === 1 ? '' : 's'} left</span>`;
    this.hintEl.textContent = hint;
    this.hintEl.classList.toggle('show', visible && !!hint);
  }

  preview(card, zone, side = 'right') {
    if (!card) {
      this.previewEl.classList.remove('show');
      return;
    }
    this.previewEl.innerHTML = '';
    this.previewEl.appendChild(thumb(card, { flipped: zone?.zone === 'pile' && isFlipped(card) }));
    this.previewEl.classList.toggle('left', side === 'left');
    this.previewEl.classList.toggle('low', side === 'low');
    this.previewEl.classList.add('show');
  }

  // ---------- interactive prompts ----------

  // The time left on your decision, in the title of a prompt docked above the hand (the
  // bid, trumps): null takes it away.
  setPromptClock(text, low = false) {
    const title = this.modalLayer.querySelector('.modal.dock h2');
    let el = title?.querySelector('.prompt-clock');
    if (!text) return el?.remove();
    if (!title) return;
    if (!el) {
      el = document.createElement('span');
      title.appendChild(el);
    }
    el.className = `prompt-clock${low ? ' low' : ''}`;
    const shown = `⏱ ${text}`;
    if (el.textContent !== shown) el.textContent = shown;
  }

  closeAll() {
    this.popupLayer.innerHTML = '';
    this.modalLayer.innerHTML = '';
    this.cancelTop = null;
  }

  // A popup above (x, y), or below it with { below: true }.
  menu(x, y, title, options, { below = false } = {}) {
    return new Promise((resolve) => {
      this.popupLayer.innerHTML = '';
      const backdrop = el('div', 'popup-backdrop');
      const box = el('div', 'popup');
      box.appendChild(el('div', 'popup-title', title));
      const done = (v) => {
        this.popupLayer.innerHTML = '';
        this.cancelTop = null;
        resolve(v);
      };
      for (const opt of options) {
        const b = el('button', `popup-item${opt.disabled ? ' disabled' : ''}`);
        if (opt.swatch) b.appendChild(el('span', 'swatch')).style.background = opt.swatch;
        b.appendChild(el('span', 'label', opt.label));
        if (opt.hint) b.appendChild(el('span', 'hint', opt.hint));
        if (!opt.disabled) b.addEventListener('click', () => done(opt.value));
        box.appendChild(b);
      }
      backdrop.addEventListener('pointerdown', () => done(null));
      this.popupLayer.append(backdrop, box);
      // Layout size, not getBoundingClientRect: the pop-in animation scales the box.
      const r = { width: box.offsetWidth, height: box.offsetHeight };
      // On phones, keep clear of the hand and the status row above it.
      const handH = parseFloat(document.documentElement.style.getPropertyValue('--hand-h')) || 0;
      if (PORTRAIT.matches) y = Math.min(y, window.innerHeight - handH - 56);
      box.style.left = `${Math.max(8, Math.min(x - r.width / 2, window.innerWidth - r.width - 8))}px`;
      const top = below ? y + 8 : y - r.height - 18;
      box.style.top = `${Math.max(8, Math.min(top, window.innerHeight - r.height - 8))}px`;
      this.cancelTop = () => done(null);
    });
  }

  // dock: a panel above the hand that leaves the table in view and usable.
  modal({ title, body, cancelable = true, wide = false, dock = false }) {
    this.modalLayer.innerHTML = '';
    const backdrop = el('div', `modal-backdrop${dock ? ' dock' : ''}`);
    const box = el('div', `modal${wide ? ' wide' : ''}${dock ? ' dock' : ''}`);
    box.appendChild(el('h2', null, title));
    if (body) box.appendChild(typeof body === 'string' ? el('p', 'modal-body', body) : body);
    backdrop.appendChild(box);
    this.modalLayer.appendChild(backdrop);
    const close = () => {
      this.modalLayer.innerHTML = '';
      this.cancelTop = null;
    };
    // A button that hides the dialog for a look at the table (hand, bank, sets)
    // until "Back" (or Escape) brings it back.
    const peekButton = () => {
      const look = el('button', 'ghost peek', '👀 Look at my cards first');
      const back = el('button', 'primary peek-back hidden', '↩ Back to decision');
      let prevCancel = null;
      const peek = (on) => {
        backdrop.classList.toggle('hidden', on);
        back.classList.toggle('hidden', !on);
        if (on) [prevCancel, this.cancelTop] = [this.cancelTop, () => peek(false)];
        else this.cancelTop = prevCancel;
      };
      look.addEventListener('click', () => peek(true));
      back.addEventListener('click', () => peek(false));
      this.modalLayer.appendChild(back);
      return look;
    };
    return { box, close, cancelable, peekButton };
  }

  choose({ title, body, options, cancel = true, cards = [], peek = false }) {
    return new Promise((resolve) => {
      const { box, close, peekButton } = this.modal({ title, body });
      if (cards.length) {
        const row = el('div', 'card-row');
        cards.forEach((c) => row.appendChild(thumb(c)));
        box.appendChild(row);
      }
      const list = el('div', 'choice-list');
      const done = (v) => {
        close();
        resolve(v);
      };
      for (const opt of options) {
        const b = el('button', `choice ${opt.primary ? 'primary' : ''}${opt.disabled ? ' disabled' : ''}`);
        if (opt.swatch) b.appendChild(el('span', 'swatch')).style.background = opt.swatch;
        b.appendChild(el('span', 'label', opt.label));
        if (opt.hint) b.appendChild(el('span', 'hint', opt.hint));
        if (!opt.disabled) b.addEventListener('click', () => done(opt.value));
        list.appendChild(b);
      }
      box.appendChild(list);
      if (peek) box.appendChild(peekButton());
      if (cancel) {
        const c = el('button', 'ghost cancel', 'Cancel');
        c.addEventListener('click', () => done(null));
        box.appendChild(c);
        this.cancelTop = () => done(null);
      }
    });
  }

  // A payment at a glance: the amount owed, big, and what `player` has to pay it with
  // (each bank card as a chip, the table's value and the total). For a modal body.
  dueBox({ label, amount, to, reason, icon = '', swatch = null, player, note = '', text = '' }) {
    const wrap = el('div', 'due-wrap');
    const due = el('div', 'due');
    due.innerHTML = `<div class="due-amount"><span class="due-label">${esc(label)}</span><b>${amount}M</b></div>`;
    const what = el('div', 'due-what');
    what.appendChild(el('span', 'due-to', `to <b>${esc(to)}</b>`));
    const mark = swatch ? `<span class="swatch" style="background: ${esc(swatch)}"></span>` : icon ? `${icon} ` : '';
    what.appendChild(el('span', 'due-for', `for ${mark}${esc(reason)}`));
    due.appendChild(what);
    wrap.appendChild(due);

    const bank = R.bankTotal(player);
    const total = R.totalAssets(player);
    const have = el('div', 'have');
    have.innerHTML = `<div class="have-stats">
      <span class="have-stat"><span>Your bank</span><b>${bank}M</b></span>
      <span class="have-stat"><span>Your table</span><b>${total - bank}M</b></span>
      <span class="have-stat total${total < amount ? ' short' : ''}"><span>Total</span><b>${total}M</b></span>
    </div>`;
    const cash = el('div', 'cash-list');
    const cards = [...player.bank].sort((a, b) => b.value - a.value);
    for (const c of cards) {
      const chip = el('span', `cash${c.type === 'money' ? '' : ' act'}`, `${c.value}M${c.type === 'action' ? ` ${ACTIONS[c.action].icon}` : ''}`);
      chip.title = c.name;
      if (MONEY_COLORS[c.value] && c.type === 'money') {
        chip.style.setProperty('--bg', MONEY_COLORS[c.value][0]);
        chip.style.setProperty('--ink', MONEY_COLORS[c.value][1]);
      }
      cash.appendChild(chip);
    }
    if (!cards.length) cash.appendChild(el('span', 'muted', 'Your bank is empty.'));
    have.appendChild(cash);
    wrap.appendChild(have);
    if (note) wrap.appendChild(el('p', 'note info', esc(note)));
    if (text) wrap.appendChild(el('p', 'modal-body', esc(text)));
    return wrap;
  }

  // groups: [{ label, items: [{ card, value, selectable, flipped, note, tag }] }]
  // mode 'single' resolves on first click; 'multi' needs validate(values) -> { ok, text }.
  pickCards({ title, body, groups, mode = 'single', validate, confirmLabel = 'Confirm', cancel = true, suggest = null }) {
    return new Promise((resolve) => {
      const { box, close } = this.modal({ title, body, wide: true });
      box.classList.add('picker');
      const selected = new Set();
      const done = (v) => {
        close();
        resolve(v);
      };
      const footer = el('div', 'pick-footer');
      const info = el('span', 'pick-info');
      const confirm = el('button', 'primary', confirmLabel);
      const tiles = [];
      const refresh = () => {
        for (const t of tiles) t.el.classList.toggle('selected', selected.has(t.value));
        if (mode === 'multi') {
          const v = validate([...selected]);
          info.textContent = v.text;
          info.classList.toggle('ok', v.ok);
          confirm.disabled = !v.ok;
        }
      };
      const scroller = el('div', 'pick-groups');
      for (const g of groups) {
        if (!g.items.length) continue;
        const group = el('div', 'pick-group');
        group.appendChild(el('div', 'pick-label', g.label));
        const row = el('div', 'pick-row');
        for (const item of g.items) {
          const tile = el('div', `pick-tile${item.selectable === false ? ' locked' : ''}`);
          tile.appendChild(thumb(item.card, { flipped: item.flipped ?? isFlipped(item.card) }));
          if (item.note) tile.appendChild(el('span', 'tile-note', item.note));
          if (item.tag) tile.appendChild(el('span', 'tile-tag', item.tag));
          if (item.selectable !== false) {
            tile.addEventListener('click', () => {
              if (mode === 'single') return done(item.value);
              if (selected.has(item.value)) selected.delete(item.value);
              else selected.add(item.value);
              refresh();
            });
          }
          tiles.push({ el: tile, value: item.value });
          row.appendChild(tile);
        }
        group.appendChild(row);
        scroller.appendChild(group);
      }
      box.appendChild(scroller);
      if (mode === 'multi') {
        footer.appendChild(info);
        if (suggest) {
          const auto = el('button', 'ghost', 'Auto-select');
          auto.addEventListener('click', () => {
            selected.clear();
            suggest().forEach((v) => selected.add(v));
            refresh();
          });
          footer.appendChild(auto);
        }
        confirm.addEventListener('click', () => done([...selected]));
        footer.appendChild(confirm);
      }
      if (cancel) {
        const c = el('button', 'ghost', 'Cancel');
        c.addEventListener('click', () => done(null));
        footer.appendChild(c);
        this.cancelTop = () => done(null);
      }
      box.appendChild(footer);
      refresh();
    });
  }

  // The first screen: which game to play. Resolves its key.
  showHome(current) {
    return new Promise((resolve) => {
      this.closeAll();
      const body = el('div', 'home');
      body.appendChild(el('p', 'tagline', 'Pick a game. Each one plays against the computer or online with friends.'));
      const deal = buildDeck();
      const playing = playingDeck();
      const looks = {
        deal: ['Boardwalk', 'Deal Breaker', '$5M'].map((name) => deal.find((c) => c.name === name)),
        callbridge: ['spades-14', 'hearts-13', 'diamonds-12'].map((key) => playing.find((c) => c.key === key)),
        judgement: ['clubs-7', 'diamonds-11', 'hearts-14'].map((key) => playing.find((c) => c.key === key)),
        leastcount: ['hearts-14', 'spades-2', 'joker-red'].map((key) => leastCountDeck().find((c) => c.key === key)),
        poker: ['spades-14', 'hearts-14', 'diamonds-13'].map((key) => playing.find((c) => c.key === key)),
      };
      for (const [kind, info] of Object.entries(GAMES)) {
        const tile = el('button', `game-tile${kind === current ? ' last' : ''}`);
        const fan = tile.appendChild(el('span', 'tile-fan'));
        if (looks[kind]) for (const card of looks[kind]) fan.appendChild(thumb(card, { flipped: false }));
        else fan.appendChild({ wordle: miniWordle, pool: miniPool, sudoku: miniSudoku }[kind]?.() ?? miniBingo());
        tile.appendChild(el('span', 'start-logo', brand(kind)));
        tile.appendChild(el('span', 'tile-text', esc(info.tagline)));
        // Wordle and Sudoku can be played alone too.
        const players = kind === 'wordle' || kind === 'sudoku' ? '1–5 players, up to 8 online' : '2–5 players, up to 8 online';
        tile.appendChild(el('span', 'tile-meta muted', kind === 'pool' ? '2 or 4 players (1 vs 1 or 2 vs 2)' : players));
        tile.addEventListener('click', () => {
          close();
          resolve(kind);
        });
        body.appendChild(tile);
      }
      const { close } = this.modal({ title: 'What shall we play?', body, cancelable: false });
    });
  }

  // Resolves { mode: 'solo' | 'create' | 'join' | 'home', name, opponents, words, code }.
  showStart(defaults) {
    return new Promise((resolve) => {
      this.closeAll();
      // Wordle and Sudoku can be played alone, with no bots (and in Wordle no clock);
      // pool is one on one, or two against two (you and a bot partner); the other games
      // need opponents.
      const pool = this.game === 'pool';
      const sudoku = this.game === 'sudoku';
      const counts = this.game === 'wordle' || sudoku ? [0, 1, 2, 3, 4] : pool ? [1, 3] : [1, 2, 3, 4];
      const opponents = pool ? (defaults.poolOpponents === 3 ? 3 : 1) : counts.includes(defaults.opponents) ? defaults.opponents : 3;
      const oppLabel = (n) => (pool ? (n === 1 ? '1 vs 1' : '2 vs 2') : n || 'None');
      const oppTitle = (n) => (!n ? ` title="${sudoku ? 'Just you, with no limit on mistakes' : 'Just you, with no clock'}"` : pool && n === 3 ? ' title="You and a bot partner against two bots"' : '');
      const level = LEVELS[defaults.level] ? defaults.level : DEFAULT_LEVEL;
      const body = el('div', 'start');
      body.innerHTML = `
        <button class="ghost back-home" id="opt-home" title="Choose another game">← Games</button>
        <div class="start-logo">${brand(this.game)}</div>
        <p class="tagline">${esc(GAMES[this.game].tagline)}</p>
        <p class="note warn" id="opt-notice"></p>
        <div class="seg mode" id="opt-mode"><button data-v="solo">🤖 Vs computer</button><button data-v="online">🌐 Online with friends</button></div>
        <label>Your name <input id="opt-name" maxlength="16" placeholder="Your name" autocomplete="nickname"></label>
        <div class="opt-row" id="opt-deck-row"><span>Cards</span><div class="seg" id="opt-deck">${Object.entries(DECK_STYLES).map(([k, d]) => `<button data-v="${k}" class="${k === deckStyle() ? 'on' : ''}">${d.name}</button>`).join('')}</div></div>
        <div class="start-solo">
          <div class="opt-row"><span>${pool ? 'Players' : 'Opponents'}</span><div class="seg" id="opt-opp">${counts.map((n) => `<button data-v="${n}" class="${n === opponents ? 'on' : ''}"${oppTitle(n)}>${oppLabel(n)}</button>`).join('')}</div></div>
          <div class="opt-row" id="opt-scoring-row"><span>Scoring</span><div class="seg" id="opt-scoring">${Object.entries(SCORING).map(([k, s]) => `<button data-v="${k}" class="${k === (SCORING[defaults.scoring] ? defaults.scoring : DEFAULT_SCORING) ? 'on' : ''}" title="${s.hint}">${s.name}</button>`).join('')}</div></div>
          <p class="muted small" id="opt-scoring-hint"></p>
          <div class="opt-row" id="opt-words-row"><span>Words</span><div class="seg" id="opt-words">${WORD_COUNTS.map((n) => `<button data-v="${n}" class="${n === defaults.words ? 'on' : ''}">${n}</button>`).join('')}</div></div>
          <div class="opt-row" id="opt-rounds-row"><span>Rounds</span><div class="seg" id="opt-rounds">${ROUND_COUNTS.map((n) => `<button data-v="${n}" class="${n === (ROUND_COUNTS.includes(defaults.rounds) ? defaults.rounds : DEFAULT_ROUNDS) ? 'on' : ''}">${n}</button>`).join('')}</div></div>
          <div class="opt-row" id="opt-stack-row"><span>Stack</span><div class="seg" id="opt-stack">${STACKS.map((n) => `<button data-v="${n}" class="${n === (STACKS.includes(defaults.stack) ? defaults.stack : DEFAULT_STACK) ? 'on' : ''}">${n.toLocaleString('en-US')}</button>`).join('')}</div></div>
          <div class="opt-row" id="opt-blinds-row"><span>Blinds</span><div class="seg" id="opt-blinds">${BLINDS.map((b) => `<button data-v="${blindsKey(b)}" class="${blindsKey(b) === (BLINDS.some((x) => blindsKey(x) === defaults.blinds) ? defaults.blinds : blindsKey(DEFAULT_BLINDS)) ? 'on' : ''}">${blindsKey(b)}</button>`).join('')}</div></div>
          <div class="opt-row" id="opt-level-row"><span>Level</span><div class="seg" id="opt-level">${Object.entries(LEVELS).map(([k, l]) => `<button data-v="${k}" class="${k === level ? 'on' : ''}" title="${l.hint}">${l.name}</button>`).join('')}</div></div>
          <button class="primary big" id="opt-start">${pool ? 'Rack them up' : this.game === 'poker' ? 'Shuffle up' : ['bingo', 'wordle', 'sudoku'].includes(this.game) ? 'Start the game' : 'Deal the cards'}</button>
        </div>
        <div class="start-online">
          <button class="primary big" id="opt-create">Create a room</button>
          <div class="or"><span>or join a friend’s room</span></div>
          <div class="join-row"><input id="opt-code" maxlength="4" placeholder="CODE" autocomplete="off" spellcheck="false"><button id="opt-join">Join room</button></div>
          <p class="muted small">Create a room and send the invite link to your friends. Up to 8 players; empty seats can be filled with bots.</p>
        </div>
        <p class="start-error" id="opt-error"></p>
        <button class="ghost" id="opt-rules">How to play</button>`;
      const { close } = this.modal({ title: '', body, cancelable: false });
      const $b = (sel) => body.querySelector(sel);
      const seg = (id) => {
        const root = $b(id);
        root.addEventListener('click', (e) => {
          const btn = e.target.closest('button');
          if (!btn) return;
          root.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
          root.dispatchEvent(new Event('change'));
        });
        return () => root.querySelector('.on').dataset.v;
      };
      const opp = seg('#opt-opp');
      const words = seg('#opt-words');
      $b('#opt-words-row').hidden = this.game !== 'wordle';
      // Sudoku: how hard the puzzle is.
      const levelPick = seg('#opt-level');
      $b('#opt-level-row').hidden = !sudoku;
      // Least Count: how many rounds.
      const roundsPick = seg('#opt-rounds');
      $b('#opt-rounds-row').hidden = this.game !== 'leastcount';
      // Poker: starting stack and blinds.
      const stackPick = seg('#opt-stack');
      const blindsPick = seg('#opt-blinds');
      $b('#opt-stack-row').hidden = $b('#opt-blinds-row').hidden = this.game !== 'poker';
      // Judgement: how a round scores, with a line on what the choice means.
      const scoring = seg('#opt-scoring');
      const showScoring = () => ($b('#opt-scoring-hint').textContent = SCORING[scoring()].hint);
      $b('#opt-scoring').addEventListener('change', showScoring);
      showScoring();
      $b('#opt-scoring-row').hidden = $b('#opt-scoring-hint').hidden = this.game !== 'judgement';
      // The deck style (Call Bridge and Judgement) is this browser's own, solo or online, and shows at once.
      const deck = seg('#opt-deck');
      $b('#opt-deck-row').hidden = !PLAYING_CARD_GAMES.has(this.game);
      $b('#opt-deck').addEventListener('change', () => {
        setDeckStyle(deck());
        $b('.start-logo').innerHTML = this.brandEl.innerHTML = brand(this.game);
      });
      const mode = seg('#opt-mode');
      const nameInput = $b('#opt-name');
      const codeInput = $b('#opt-code');
      const errorEl = $b('#opt-error');
      nameInput.value = defaults.name ?? '';
      codeInput.value = defaults.code ?? '';
      $b('#opt-notice').textContent = defaults.notice ?? '';
      const online = defaults.mode !== 'solo';
      $b(`#opt-mode [data-v="${online ? 'online' : 'solo'}"]`).classList.add('on');
      const showMode = () => {
        body.classList.toggle('online', mode() === 'online');
        errorEl.textContent = '';
      };
      $b('#opt-mode').addEventListener('change', showMode);
      showMode();
      // With a code from an invite link, joining is the obvious next step.
      if (online && codeInput.value) {
        $b('#opt-join').classList.add('primary');
        $b('#opt-create').classList.remove('primary');
      }
      codeInput.addEventListener('input', () => {
        codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
      });

      const finish = (choice) => {
        close();
        resolve({ name: nameInput.value.trim(), opponents: Number(opp()), words: Number(words()), scoring: scoring(), level: levelPick(), rounds: Number(roundsPick()), stack: Number(stackPick()), blinds: blindsPick(), code: codeInput.value, ...choice });
      };
      const onlineName = () => {
        const name = nameInput.value.trim();
        const problem = !name ? 'Enter a name so your friends know who you are.' : /^you$/i.test(name) ? 'Pick a name other than “You”.' : /[<>&"'`\\]/.test(name) ? 'Names can’t contain < > & " \' ` or \\.' : '';
        errorEl.textContent = problem;
        if (problem) nameInput.focus();
        return !problem;
      };
      const create = () => onlineName() && finish({ mode: 'create' });
      const join = () => {
        if (!onlineName()) return;
        if (!/^[A-Z]{4}$/.test(codeInput.value)) {
          errorEl.textContent = 'Room codes are 4 letters — check the invite link.';
          codeInput.focus();
          return;
        }
        finish({ mode: 'join' });
      };
      $b('#opt-home').addEventListener('click', () => finish({ mode: 'home' }));
      $b('#opt-start').addEventListener('click', () => finish({ mode: 'solo' }));
      $b('#opt-create').addEventListener('click', create);
      $b('#opt-join').addEventListener('click', join);
      codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && join());
      nameInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (mode() === 'solo') $b('#opt-start').click();
        else if (codeInput.value) join();
        else create();
      });
      $b('#opt-rules').addEventListener('click', () => this.showRules());
    });
  }

  showGameOver(winner, isHuman, stats, buttonLabel = 'Play again') {
    return this.showResult({
      won: isHuman,
      title: isHuman ? 'You win!' : `${esc(winner.name)} wins`,
      text: isHuman ? 'You collected three full sets. Congratulations, tycoon!' : `${esc(winner.name)} collected three full sets.`,
      extra: el('p', 'muted', stats),
      buttonLabel,
    });
  }

  // The end of a game: a win or loss fanfare, the headline (HTML) and any details
  // (an element), until the button.
  showResult({ won, title, text, extra = null, buttonLabel = 'Play again' }) {
    sound.play(won ? 'win' : 'lose');
    return new Promise((resolve) => {
      const body = el('div', 'gameover');
      body.innerHTML = `<div class="trophy">${won ? '🏆' : '🎲'}</div><p>${text}</p>`;
      if (extra) body.appendChild(extra);
      const again = el('button', 'primary big', buttonLabel);
      body.appendChild(again);
      const { close } = this.modal({ title, body });
      again.addEventListener('click', () => {
        close();
        resolve();
      });
    });
  }

  // A dialog in its own layer above any open prompt, which stays intact underneath.
  // Resolves when it's closed.
  overlay({ title, body, button = 'Got it', wide = false }) {
    return new Promise((resolve) => {
      const ok = el('button', 'primary', button);
      body.appendChild(ok);
      const prevCancel = this.cancelTop;
      const layer = el('div', 'modal-backdrop top');
      const box = el('div', `modal${wide ? ' wide' : ''}`);
      box.appendChild(el('h2', null, title));
      box.appendChild(body);
      layer.appendChild(box);
      document.body.appendChild(layer);
      const close = () => {
        layer.remove();
        this.cancelTop = prevCancel;
        resolve();
      };
      ok.addEventListener('click', close);
      layer.addEventListener('pointerdown', (e) => e.target === layer && close());
      this.cancelTop = close;
    });
  }

  showRules() {
    const body = el('div', 'rules');
    body.innerHTML = { callbridge: CALLBRIDGE_RULES, judgement: JUDGEMENT_RULES, bingo: BINGO_RULES, wordle: WORDLE_RULES, pool: POOL_RULES, sudoku: SUDOKU_RULES, leastcount: LEASTCOUNT_RULES, poker: POKER_RULES }[this.game] ?? DEAL_RULES;
    if (this.game === 'poker') body.querySelector('.pk-ranks-slot')?.replaceWith(handRankings());
    // The fantasy deck's guide stays here after "Don't show this again".
    if ((TRICK_GAMES.has(this.game) || this.game === 'poker') && deckStyle() === 'fantasy') {
      body.appendChild(el('p', null, '<b>The fantasy deck</b>'));
      body.appendChild(fantasyGuide());
    }
    this.overlay({ title: 'How to play', body, wide: true });
  }
}

const DEAL_RULES = `
      <p><b>Goal:</b> be the first to collect <b>3 complete property sets</b> of different colours.</p>
      <ul>
        <li>Start of your turn: draw 2 cards (5 if your hand is empty).</li>
        <li>Play up to <b>3 cards</b> per turn: bank money or action cards, lay down properties, or play actions.</li>
        <li>Click (or tap) a card in your hand to see what you can do with it. Click a wild property on your table to move it to another colour (free).</li>
        <li>Rent: two-colour rent charges <i>everyone</i>; wild rent charges one player. Add <b>Double The Rent</b> to multiply it.</li>
        <li>Paying debts: use bank and/or properties on the table. No change is given. Cards in hand can never be used to pay.</li>
        <li><b>Sly Deal</b> and <b>Forced Deal</b> can't touch complete sets — but <b>Deal Breaker</b> can.</li>
        <li><b>Just Say No</b> cancels an action against you, and can itself be cancelled by another Just Say No.</li>
        <li>Houses (+$3M) and hotels (+$4M) go on complete sets (not railroads or utilities). If a set is broken, its buildings go to its owner's bank.</li>
        <li>End your turn with at most 7 cards in hand; extras are discarded.</li>
      </ul>
      <p class="muted">Tip: hover any face-up card to see it up close. Press <b>E</b> to end your turn.</p>`;

const CALLBRIDGE_RULES = `
      <p><b>Goal:</b> the highest score after every player has been the <b>den</b> once (one round each).</p>
      <ul>
        <li>Each round the whole deck is dealt out evenly (26, 17, 13, 10, 8, 7 or 6 cards each for 2–8 players); any left over are set aside unseen.</li>
        <li>The den sees only the first half of their cards, then calls <b>trumps</b>. The rest of the cards are dealt after that.</li>
        <li>If anyone ends up with no trumps, the cards are shuffled and dealt again, and the den calls trumps again.</li>
        <li>Starting with the den, everyone <b>bids</b> how many tricks they'll take: at least 2, at most the number of cards in hand.</li>
        <li>The den leads the first trick, and whoever wins a trick leads the next. Follow the suit that was led if you can; if not, play anything.</li>
        <li>The highest trump wins the trick; with no trumps in it, the highest card of the suit led. Aces are high.</li>
      </ul>
      <p><b>Scoring</b> (extra tricks are the ones over your bid):</p>
      <ul>
        <li>Fewer tricks than you bid: <b>−10 × bid</b>.</li>
        <li>Your bid, with fewer extra tricks than you bid: <b>10 × bid + extras</b>. Bid 3 and take 5: +32.</li>
        <li>As many extra tricks as you bid, or more: <b>−(10 × bid + extras)</b>. Bid 3 and take 6: −33.</li>
      </ul>
      <p class="muted">Tip: cards you can't play are dimmed. The round counter in the top bar shows everyone's scores.</p>`;

// Judgement, as on kard.games.
const JUDGEMENT_RULES = `
      <p><b>Goal:</b> take <b>exactly</b> the number of tricks you bid, round after round. The highest total at the end wins.</p>
      <ul>
        <li>The first round deals <b>7 cards</b> each (<b>6</b> with 8 players). Each round deals one card fewer, down to <b>1</b>, then one more each round back up again: 13 rounds in all (11 with 8 players). The rest of the deck is set aside unseen.</li>
        <li>Trumps go round in turn: <b>spades, diamonds, clubs, hearts</b>, then a round with <b>no trumps</b>, and again from spades.</li>
        <li>The deal moves round the table. Starting on the dealer’s left, everyone <b>bids</b> how many tricks they’ll take, from 0 up to the cards in hand.</li>
        <li>The dealer bids last and <b>can’t</b> make the bids add up to the number of tricks, so someone always misses.</li>
        <li>The player on the dealer’s left leads the first trick, and whoever wins a trick leads the next. Follow the suit that was led if you can; if not, play a trump to win it or throw anything.</li>
        <li>The highest trump wins the trick; with no trumps in it (or in a no-trump round), the highest card of the suit led. Aces are high.</li>
      </ul>
      <p><b>Scoring</b> (only an exact bid scores; pick one on the start screen or in the lobby):</p>
      <ul>
        <li><b>High</b> (the usual): made, <b>(bid + 1) × 10 + bid</b>; missed, the same taken off. Bid 3 and take 3: +43; take 2 or 4: −43. Bid 0 and take none: +10.</li>
        <li><b>Medium</b>: made, <b>10 × bid</b>; missed, 0.</li>
        <li><b>Low</b>: made, <b>bid × 2 + 5</b>; missed, 0.</li>
      </ul>
      <p class="muted">Tip: cards you can't play are dimmed. The round counter in the top bar shows the trumps and everyone's scores.</p>`;

const BINGO_RULES = `
      <p><b>Goal:</b> be the first to cross off <b>five lines</b> on your grid: one letter of <b>B-I-N-G-O</b> for each.</p>
      <ul>
        <li>Everyone gets a 5×5 grid holding the numbers 1 to 25. Before play starts, arrange yours: tap two squares to swap them, or shuffle. Nobody else sees your grid.</li>
        <li>Players take turns to <b>call</b> a number that hasn't been called yet. Tap it on your grid (on a phone: tap to pick it, tap again to call it).</li>
        <li>Every called number is crossed off on <i>every</i> grid, so a call helps the others too.</li>
        <li>A full row, column or diagonal (5 crossed-off numbers) is a <b>line</b>. There are 12 lines in all, and one number can finish more than one.</li>
        <li>The first to 5 lines wins. If a call takes several players to 5 at once, they share the win.</li>
      </ul>
      <p class="muted">Tip: call the numbers that finish your own lines, and think about where they sit when you arrange: a number in the middle is on four lines.</p>`;

const POOL_RULES = `
      <p><b>Goal:</b> pot all seven of your balls, <b>solids</b> (1–7) or <b>stripes</b> (9–15), then sink the <b>8</b>. One on one, or two against two (partners take turns and share a group).</p>
      <ul>
        <li>The cue ball starts behind the line for the <b>break</b>. After the break the table is <b>open</b>: the first player to pot a ball (legally) takes that group, and the other side gets the other.</li>
        <li>Pot one of your own balls and you shoot again. Miss, and it’s the other side’s turn.</li>
        <li><b>Fouls</b>: potting the cue ball (a scratch), hitting nothing, hitting the wrong ball first (on an open table, the 8 first), or no ball reaching a cushion after the hit with nothing potted. After a foul the other side has <b>ball in hand</b>: they put the cue ball anywhere.</li>
        <li>Once your group is cleared, go for the 8. Sink it and you win. Sink it too early, or with a foul (a scratch), and you lose. An 8 potted on the break is put back.</li>
      </ul>
      <p><b>How to shoot:</b> drag on the table to swing the cue round the cue ball, or tap a ball to aim straight at it. The guide shows the cue ball’s path to a ghost ball where it hits, then which way each ball goes (red with a cross if that ball isn’t yours to hit first). Fine-tune with the <b>wheel</b> on the right (or ← →). To shoot, <b>pull the cue</b> on the left down as far as the power you want and let go (or set the power with ↑ ↓ and press Space). With ball in hand (a ✋ on the cue ball), drag the cue ball where you want it.</p>
      <p class="muted">Each card shows a side’s balls still to pot, greyed out as they drop, then the 8. Online, a ring round the shooter’s avatar runs down their 60 seconds.</p>
      <p class="muted">House rules: no called pockets, and ball in hand anywhere after any foul.</p>`;

const LEASTCOUNT_RULES = `
      <p><b>Goal:</b> the <b>fewest points</b> after the last round (5, 10 or 15 rounds).</p>
      <ul>
        <li>Everyone gets 7 cards. Cards are worth: <b>Ace 1</b>, 2–10 as marked, <b>Jack 11, Queen 12, King 13</b>, and <b>jokers 0</b>.</li>
        <li><b>Wild card:</b> each round a card is turned up beside the deck. Every card of its rank counts <b>0</b> that round, like the jokers.</li>
        <li><b>Your turn:</b> throw one card, a <b>set</b> (two or more of a rank), or a <b>run</b> (three or more in a row in one suit, ace low; a joker can fill a gap). Then take one card: the top of the deck, or one of the cards the player before you just threw.</li>
        <li>To play: tap the cards to throw (they lift), then tap the deck or a card of the last throw.</li>
        <li><b>Show:</b> instead of throwing, call Show when you think your hand is the lowest. Everyone's hand is shown. If you have strictly the fewest points you score <b>0</b> and everyone else scores what their hand is worth. If anyone has as few or fewer, you're <b>caught</b>: you score <b>${CAUGHT}</b>, they score 0, and the rest score their hands.</li>
        <li>When the deck runs out, the thrown cards are shuffled into a new one.</li>
      </ul>
      <p class="muted">Tip: the fewer cards the others hold, the riskier a Show. Your hand's worth shows in your bar, and the round counter in the top bar opens the scores.</p>`;

// Five-card examples, strongest first. The pictures are this screen's deck.
const HAND_RANKS = [
  { name: 'Royal flush', blurb: 'Ace, king, queen, jack and ten, all one suit.', cards: [[14, 'spades'], [13, 'spades'], [12, 'spades'], [11, 'spades'], [10, 'spades']] },
  { name: 'Straight flush', blurb: 'Five in a row, all one suit.', cards: [[9, 'hearts'], [8, 'hearts'], [7, 'hearts'], [6, 'hearts'], [5, 'hearts']] },
  { name: 'Four of a kind', blurb: 'All four cards of one rank.', cards: [[9, 'spades'], [9, 'hearts'], [9, 'diamonds'], [9, 'clubs'], [13, 'spades']] },
  { name: 'Full house', blurb: 'Three of a kind, plus a pair.', cards: [[13, 'spades'], [13, 'hearts'], [13, 'diamonds'], [4, 'clubs'], [4, 'spades']] },
  { name: 'Flush', blurb: 'Five of one suit, not in a row.', cards: [[14, 'diamonds'], [11, 'diamonds'], [8, 'diamonds'], [4, 'diamonds'], [2, 'diamonds']] },
  { name: 'Straight', blurb: 'Five in a row, any suits. A-2-3-4-5 is the lowest.', cards: [[8, 'clubs'], [7, 'spades'], [6, 'diamonds'], [5, 'hearts'], [4, 'clubs']] },
  { name: 'Three of a kind', blurb: 'Three cards of one rank.', cards: [[7, 'spades'], [7, 'hearts'], [7, 'diamonds'], [13, 'clubs'], [2, 'spades']] },
  { name: 'Two pair', blurb: 'Two different pairs.', cards: [[12, 'spades'], [12, 'hearts'], [8, 'diamonds'], [8, 'clubs'], [14, 'clubs']] },
  { name: 'One pair', blurb: 'Two cards of one rank.', cards: [[14, 'spades'], [14, 'hearts'], [13, 'diamonds'], [7, 'clubs'], [3, 'spades']] },
  { name: 'High card', blurb: 'Nothing paired. The highest card wins.', cards: [[14, 'spades'], [11, 'diamonds'], [9, 'clubs'], [6, 'hearts'], [2, 'spades']] },
];

function handRankings() {
  const byKey = new Map(playingDeck().map((c) => [c.key, c]));
  const wrap = el('div', 'pk-ranks');
  wrap.appendChild(el('p', null, '<b>Hand rankings</b> · strongest first'));
  HAND_RANKS.forEach((row, i) => {
    const item = el('div', 'pk-rank');
    item.appendChild(el('span', 'pk-rank-n', String(i + 1)));
    const cards = el('div', 'pk-rank-cards');
    for (const [rank, suit] of row.cards) cards.appendChild(thumb(byKey.get(`${suit}-${rank}`)));
    const copy = el('div', 'pk-rank-copy');
    copy.appendChild(el('b', null, esc(row.name)));
    copy.appendChild(el('span', 'muted', esc(row.blurb)));
    item.appendChild(cards);
    item.appendChild(copy);
    wrap.appendChild(item);
  });
  return wrap;
}

const POKER_RULES = `
      <p><b>Goal:</b> win every chip. No-limit Texas Hold’em, with play money.</p>
      <ul>
        <li><b>Defaults:</b> 1,000 chips each, blinds 10 small / 20 big. Other stacks are 200, 500 and 2,000; other blinds are 5/10 and 25/50. Pick them on the start screen, or in the lobby online. Two to five play against the computer; up to eight online.</li>
        <li>The <b>button</b> deals and moves one seat clockwise each hand (heads-up, the button posts the small blind and acts first before the flop, last after it). With three or more, the small blind is left of the button and the big blind left of that.</li>
        <li>Two cards each, then betting <b>pre-flop</b>, on the <b>flop</b> (3 cards), the <b>turn</b> (1) and the <b>river</b> (1). No burn cards.</li>
        <li><b>Check</b> when nothing is owed. <b>Call</b> to match the bet. <b>Bet</b> at least the big blind, or <b>raise</b> by at least the last full bet or raise. <b>All-in</b> pushes the rest of your stack. A short all-in does not reopen raising for anyone who has already acted. <b>Fold</b> gives up the hand.</li>
        <li><b>Side pots:</b> you can only win as much as you put in. A tie splits that pot, and an odd chip goes to the first of the winners sitting left of the button. Folded hands stay hidden.</li>
        <li>At <b>showdown</b> the best five cards from your two hole cards and the board win. The hands are ranked below, strongest first. Ace is high, and the wheel (A-2-3-4-5) is the lowest straight.</li>
        <li>A player with no chips is out. The last stack wins; a tie shares it. Online, you have 45 seconds to act. After a hand, <b>Next hand</b> deals again; otherwise the cards stay up for a few seconds so everyone can read them.</li>
      </ul>
      <div class="pk-ranks-slot"></div>
      <p class="muted">On your turn: Fold, Check or Call, and a slider for the bet (Min, ½ pot, Pot). F folds, C checks or calls, R bets the minimum, A is all-in, and ← → move the slider. The hand counter in the top bar opens the stacks.</p>`;

const SUDOKU_RULES = `
      <p><b>Goal:</b> fill the grid so that every <b>row</b>, every <b>column</b> and every <b>3×3 box</b> has each number from 1 to 9 exactly once.</p>
      <ul>
        <li>Tap a cell, then a number (or type 1–9; the arrow keys move around). Each puzzle has one answer, and you can always find it by reasoning: no guessing needed.</li>
        <li>A right number goes in. A wrong one doesn't: it flashes red and counts as a <b>mistake</b>.</li>
        <li><b>✏️ Notes</b> turn the numbers into pencil marks, for the ones a cell could still be. Only you see them, and they tidy themselves up as you fill cells in.</li>
        <li><b>Racing</b> (against bots or friends): everyone gets the same puzzle. The first to fill the grid wins. ${MAX_MISTAKES} mistakes and you're out of the race. You see how far the others have got, but not their numbers.</li>
        <li><b>On your own:</b> no limit on mistakes and no rush; the clock just shows how long you've taken.</li>
        <li>Levels: <b>Easy</b> and <b>Medium</b> can be solved one number at a time, by looking for the only place a number fits (or the only number a cell can take). <b>Hard</b> starts with fewer numbers and needs more thinking ahead.</li>
      </ul>
      <p class="muted">Tip: the small number on each key is how many of that number are still to place.</p>`;

const WORDLE_RULES = `
      <p><b>Goal:</b> guess the most words <b>first</b>. A game is 5, 10 or 20 words.</p>
      <ul>
        <li>Everyone guesses the <i>same</i> secret five-letter word at the same time, with six guesses each.</li>
        <li>Type a word and press <b>Enter</b> (or use the keyboard on screen). It has to be a real word.</li>
        <li>Each letter is marked: <b class="wg">green</b> is in the word in that spot, <b class="wy">yellow</b> is in the word somewhere else, and grey isn't in it (or not as many times as you used it).</li>
        <li>The first to get the word scores a point, and the word ends for everyone. If nobody gets it in six guesses, or within three minutes, nobody scores.</li>
        <li>You see the others' coloured squares as they guess, but not their letters until the word is over.</li>
        <li>The most points after the last word wins; a tie is a shared win.</li>
      </ul>
      <p class="muted">Tip: speed matters as much as guessing well. The word counter in the top bar shows the scores so far.</p>`;
