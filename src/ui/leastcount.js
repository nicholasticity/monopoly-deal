// The human side of Least Count: the table view does the picking (leastcount-view.js):
// tap cards in your hand to choose a throw, then tap the deck or a card of the last
// throw to take it, which ends your turn; or press Show. Also the round scores, the score
// table, the status line and the game-over dialog, shared by solo and online play.
import { suitLook, rankText, deckStyle } from '../render/deck-style.js';
import { throwKind, handTotal, isZero, CAUGHT } from '../leastcount/rules.js';
import { AVATARS } from '../render/view.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const nameList = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const dot = (i) => `<i class="seat-dot" style="--c: ${AVATARS[i % AVATARS.length]}"></i>`;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

// A card in the current deck style: "Q♥", or the joker's name; with the wild rank, the
// cards worth nothing are marked.
export const jokerName = () => (deckStyle() === 'fantasy' ? 'Jester' : 'Joker');
export function cardMark(card, wild = null) {
  if (card.joker) return `<span class="lc-joker ${card.joker}">${jokerName()}</span>`;
  return `<span class="lc-card${isZero(card, wild) ? ' zero' : ''}"><b>${rankText(card.rank)}</b><span class="suit ${card.suit}">${suitLook(card.suit).symbol}&#xFE0E;</span></span>`;
}

export class LeastCountHuman {
  constructor(hud, view) {
    this.hud = hud;
    this.view = view;
    this.pending = null;
  }

  // Your turn: wait for a throw and a card to take (or Show).
  chooseThrow(game, me) {
    return new Promise((resolve) => {
      this.pending = { game, me, resolve };
      this.view.setPicking(true);
    });
  }

  onCardClick(card, zone) {
    const p = this.pending;
    if (!p) return;
    if (zone.zone === 'hand' && zone.playerId === p.me.id) this.view.toggle(card.id);
    else if (zone.zone === 'deck') this.take('deck');
    else if (zone.zone === 'last') this.take(card.id);
  }

  // Throw what's picked and take this ('deck', or a card of the last throw).
  take(take) {
    const p = this.pending;
    if (!p) return;
    const cards = p.me.hand.filter((c) => this.view.picked.has(c.id));
    if (!cards.length) return this.hud.toast('First pick what to throw: tap cards in your hand.', 'warn');
    if (!throwKind(cards)) return this.hud.toast('That’s not a throw: one card, two or more of a kind, or a run of three or more in one suit.', 'warn');
    this.finish({ throw: cards.map((c) => c.id), take });
  }

  // The Show button.
  show() {
    if (this.pending) this.finish({ show: true });
  }

  finish(value) {
    const p = this.pending;
    this.pending = null;
    this.view.setPicking(false);
    p.resolve(value);
  }

  cancel() {
    if (!this.pending) return;
    this.pending = null;
    this.view.setPicking(false);
  }

  endTurn() {}

  // Between rounds: the hands and scores, until "Next round".
  roundOver(game, results) {
    return new Promise((resolve) => {
      const { state } = game;
      const body = roundBoard(state, results, state.players.findIndex((p) => p.isHuman), state.caller, state.caught);
      const next = el('button', 'primary big', 'Next round');
      body.appendChild(next);
      const { close } = this.hud.modal({ title: `Round ${state.round} scores`, body, cancelable: false });
      next.addEventListener('click', () => {
        close();
        resolve();
      });
      next.focus();
    });
  }
}

// One round: everyone's hand and what it was worth, who called Show, and the totals.
export function roundBoard(state, results, seat = -1, caller = null, caught = false) {
  const body = el('div', 'jscores lcscores');
  const low = Math.min(...results.map((r) => r.score));
  const who = state.players[caller];
  const head = who ? `${caller === seat ? 'You' : `<b>${esc(who.name)}</b>`} called Show with ${plural(results.find((r) => r.id === caller).total, 'point')}${caught ? ` and ${caller === seat ? 'were' : 'was'} caught: ${CAUGHT} points.` : ', the least: 0 points.'}` : '';
  if (head) body.appendChild(el('p', `lc-verdict${caught ? ' caught' : ''}`, head));
  const rows = results.map((r) => {
    const p = state.players[r.id];
    const cls = [r.id === seat ? 'me' : '', r.score === low ? 'lead' : ''].join(' ');
    const tag = r.id === caller ? `<span class="lc-tag${caught ? ' caught' : ''}">${caught ? 'Caught' : 'Show'}</span>` : '';
    const hand = (r.cards ?? []).map((c) => cardMark(c, state.wild)).join(' ');
    return `<tr class="${cls}"><th>${dot(r.id)}${esc(p.name)}${tag}</th><td class="lc-hand">${hand}</td><td>${r.total}</td><td class="${r.points ? 'bad' : 'good'}">+${r.points}</td><td class="total">${r.score}</td></tr>`;
  });
  body.appendChild(el('div', 'score-scroll', `<table class="score-table"><thead><tr><th></th><th>Hand</th><th>Worth</th><th>Points</th><th>Total</th></tr></thead><tbody>${rows.join('')}</tbody></table>`));
  if (state.round < state.rounds) {
    const dealer = state.players[(state.dealer + 1) % state.players.length];
    body.appendChild(el('p', 'muted', `Next: round ${state.round + 1} of ${state.rounds} · ${dealer.id === seat ? 'you deal' : `${esc(dealer.name)} deals`}.`));
  }
  return body;
}

// Every round so far: points per player (S: called Show, ✕: caught), with totals.
// final: ranked, lowest first, for the end of the game.
export function scoreTable(state, seat = -1, final = false) {
  const body = el('div', 'jscores');
  const players = [...state.players];
  if (final) players.sort((a, b) => a.score - b.score);
  const low = Math.min(...state.players.map((p) => p.score));
  const rounds = Array.from({ length: state.rounds }, (_, i) => i);
  const head = rounds.map((r) => `<th class="${r + 1 === state.round && state.phase !== 'over' ? 'now' : ''}">R${r + 1}</th>`).join('');
  const rows = players.map((p) => {
    const cells = rounds.map((r) => {
      const h = p.history[r];
      if (!h) return '<td></td>';
      const mark = h.show ? `<small>${h.caught ? '✕ caught' : 'Show'}</small>` : '';
      return `<td class="${h.points ? (h.caught ? 'bust' : '') : 'made'}">${h.points}${mark}</td>`;
    });
    const cls = [p.id === seat ? 'me' : '', p.score === low && state.round > 0 ? 'lead' : ''].join(' ');
    return `<tr class="${cls}"><th>${dot(p.id)}${esc(p.name)}</th>${cells.join('')}<td class="total">${p.score}</td></tr>`;
  });
  body.innerHTML = `<div class="score-scroll"><table class="score-table full"><thead><tr><th></th>${head}<th>Total</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  return body;
}

// For the game-over dialog: did `seat` win, the headline, and the final table.
export function gameResult(state, seat = -1) {
  const winners = state.winners;
  const won = winners.some((p) => p.id === seat);
  const low = winners[0]?.score ?? 0;
  const others = winners.filter((p) => p.id !== seat).map((p) => esc(p.name));
  let title;
  let text;
  if (winners.length === 1) {
    title = won ? 'You win!' : `${others[0]} wins`;
    text = won ? `The least points: ${low}. Well counted!` : `${others[0]} finished with the least: ${plural(low, 'point')}.`;
  } else {
    title = won ? 'A shared win!' : 'A shared win';
    text = `${nameList(won ? ['You', ...others] : others)} tied with ${plural(low, 'point')}.`;
  }
  return { won, title, text, extra: scoreTable(state, seat, true) };
}

// The wild rank and the round, for the top bar.
export function gameInfo(state) {
  if (!state.round) return '';
  const wild = state.wild ? `<span class="lc-wild" title="Cards of this rank count 0 this round">Wild ${rankText(state.wild)}</span>` : '';
  return `${wild}<span>R${state.round}/${state.rounds}</span>`;
}

// The status line: what's happening, from `seat`'s point of view. Returns { text, mine }.
export function leastCountStatus(state, seat) {
  const name = (i) => (i === seat ? 'You' : `<b>${esc(state.players[i]?.name ?? '')}</b>`);
  const mine = state.current === seat && state.phase === 'turn' && !!state.players[seat]?.isHuman;
  switch (state.phase) {
    case 'over': {
      const names = state.winners.map((p) => name(p.id));
      return { text: names.length === 1 ? `${names[0]} won with the least points` : `${nameList(names)} shared the win`, mine: false };
    }
    case 'turn': {
      if (!mine) return { text: `${name(state.current)} ${state.current === seat ? 'are' : 'is'} playing…`, mine: false };
      const total = handTotal(state.players[seat].hand, state.wild);
      return { text: `<b>Your turn</b> · throw, then take a card · or <b>Show</b> with ${total}`, mine: true };
    }
    case 'show':
      return { text: `${name(state.caller)} called <b>Show</b>!`, mine: false };
    case 'scoring':
      return { text: `Round ${state.round} scores`, mine: false };
    default:
      return { text: state.round ? `Round ${state.round} of ${state.rounds} · dealing…` : 'Dealing…', mine: false };
  }
}

// No toast for each turn; just the chime.
export const turnToast = () => null;
