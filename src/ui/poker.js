// The human side of Hold'em: the buttons live on the table (poker-view.js). Also
// the status line, the stack list and the game-over dialog, shared by solo and online.
import { legalActions, chipText } from '../poker/rules.js';
import { AVATARS } from '../render/view.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const nameList = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const dot = (i) => `<i class="seat-dot" style="--c: ${AVATARS[i % AVATARS.length]}"></i>`;
const BETTING = new Set(['preflop', 'flop', 'turn', 'river']);

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export class PokerHuman {
  constructor(hud, view) {
    this.hud = hud;
    this.view = view;
    this.pending = null;
    this.listening = false;
    this.onKey = (e) => this.key(e);
  }

  chooseAction(game, me) {
    return new Promise((resolve) => {
      this.pending = { resolve, me };
      this.view.handlers.action = (move) => this.finish(move);
      this.view.setActing(true);
      this.listen();
    });
  }

  listen() {
    if (this.listening) return;
    this.listening = true;
    document.addEventListener('keydown', this.onKey);
  }

  silence() {
    if (!this.listening) return;
    this.listening = false;
    document.removeEventListener('keydown', this.onKey);
  }

  // F folds, C checks or calls, A is all-in, R raises the minimum. Left and right
  // nudge the bet. Ignored while typing.
  key(e) {
    const p = this.pending;
    if (!p || e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea')) return;
    const opts = legalActions(p.me ? this.view.game.state : {}, p.me.id);
    const k = e.key.toLowerCase();
    if (k === 'f' && opts.fold) this.finish({ action: 'fold' });
    else if (k === 'c' && opts.check) this.finish({ action: 'check' });
    else if (k === 'c' && opts.call) this.finish({ action: 'call' });
    else if (k === 'a' && opts.allIn) this.finish({ action: 'allin' });
    else if (k === 'r' && opts.bet) this.finish({ action: this.view.raiseKind, to: opts.bet.min });
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && opts.bet) {
      const step = e.shiftKey ? Math.max(1, Math.round((opts.bet.max - opts.bet.min) / 10)) : this.view.game.state.bigBlind;
      const next = Number(this.view.slider.value) + (e.key === 'ArrowRight' ? step : -step);
      this.view.setSlider(next);
      e.preventDefault();
    } else return;
    if (k === 'f' || k === 'c' || k === 'a' || k === 'r') e.preventDefault();
  }

  finish(move) {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.silence();
    this.view.setActing(false);
    p.resolve(move);
  }

  cancel() {
    if (!this.pending) return;
    this.pending = null;
    this.silence();
    this.view.setActing(false);
  }

  endTurn() {}

  onCardClick() {}

  // The cards stay on the table. Next hand deals again before the timer.
  handOver() {
    const view = this.view;
    view.setHolding(true);
    return new Promise((resolve) => {
      view.handlers.next = () => {
        view.setHolding(false);
        resolve();
      };
    });
  }
}

// Stacks, highest first once the game is over.
export function stackTable(state, seat = -1, final = false) {
  const body = el('div', 'jscores');
  const players = [...state.players];
  if (final) players.sort((a, b) => b.stack - a.stack);
  const best = Math.max(...state.players.map((p) => p.stack));
  const rows = players.map((p) => {
    const cls = [p.id === seat ? 'me' : '', final && p.stack === best ? 'lead' : ''].join(' ');
    const note = p.out || p.stack === 0 ? 'out' : '';
    return `<tr class="${cls}"><th>${dot(p.id)}${esc(p.name)}</th><td class="total">${chipText(p.stack)}</td><td>${note}</td></tr>`;
  });
  body.innerHTML = `<div class="score-scroll"><table class="score-table"><thead><tr><th></th><th>Stack</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  return body;
}

export function gameResult(state, seat = -1) {
  const winners = state.winners ?? [];
  const won = winners.some((p) => p.id === seat);
  const chips = winners[0]?.stack ?? 0;
  const others = winners.filter((p) => p.id !== seat).map((p) => esc(p.name));
  let title;
  let text;
  const alone = winners.length === 1 && state.players.every((p) => p.stack === 0 || p.id === winners[0].id);
  if (winners.length === 1) {
    title = won ? 'You win the table!' : `${others[0]} wins the table`;
    text = won ? (alone ? `Every chip: ${chipText(chips)}.` : `You finish with ${chipText(chips)}.`) : `${others[0]} finishes with ${chipText(chips)}.`;
  } else {
    title = won ? 'A shared win!' : 'A shared win';
    text = `${nameList(won ? ['You', ...others] : others)} tie with ${chipText(chips)}.`;
  }
  return { won, title, text, extra: stackTable(state, seat, true) };
}

export function gameInfo(state) {
  if (!state.hand) return '';
  return `Hand ${state.hand} · ${chipText(state.smallBlind)}/${chipText(state.bigBlind)}`;
}

export function pokerStatus(state, seat) {
  const name = (i) => (i === seat ? 'You' : `<b>${esc(state.players[i]?.name ?? '')}</b>`);
  const mine = state.current === seat && BETTING.has(state.phase) && !!state.players[seat]?.isHuman;
  if (state.phase === 'over') {
    const names = (state.winners ?? []).map((p) => name(p.id));
    return { text: names.length === 1 ? `${names[0]} won the table` : `${nameList(names)} split the table`, mine: false };
  }
  if (state.phase === 'showdown' || state.phase === 'between') return { text: esc(state.result?.text ?? 'Showdown'), mine: false };
  if (mine) {
    const opts = legalActions(state, seat);
    const what = opts.call ? `call ${chipText(opts.call)}, raise or fold` : 'check or bet';
    return { text: `<b>Your turn</b> · ${what}`, mine: true };
  }
  if (BETTING.has(state.phase) && state.current >= 0) {
    const who = state.current === seat ? 'You are' : `${name(state.current)} is`;
    return { text: `${who} to act`, mine: false };
  }
  if (state.phase === 'deal' || state.phase === 'blinds') return { text: state.hand ? `Hand ${state.hand} · dealing` : 'Dealing…', mine: false };
  return { text: state.hand ? `Hand ${state.hand}` : 'Shuffling…', mine: false };
}

// The chime is enough; the buttons are already on the table.
export const turnToast = () => null;
