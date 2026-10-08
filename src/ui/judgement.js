// The human side of Judgement: calling trumps and bidding in a panel docked above the
// hand (so the cards stay in view), playing by clicking a card, and the scores between
// rounds. Also the score tables and status line, shared by solo and online play.
import { SUITS, SUIT_ORDER, rankLabel } from '../judgement/cards.js';
import * as R from '../judgement/rules.js';
import { AVATARS } from '../render/view.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const TOUCH = matchMedia('(pointer: coarse)').matches;
// Points with their sign, and a real minus.
export const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
// A total: a real minus, but no plus.
export const scoreText = (n) => (n < 0 ? `−${-n}` : `${n}`);
// A suit symbol in its colour (text style, not emoji).
export const suitMark = (key) => `<span class="suit ${key}">${SUITS[key].symbol}&#xFE0E;</span>`;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

const nameList = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

// What each bid pays: the tricks that make it, falling short, and going over by too much.
function bidOutcome(bid, size) {
  const top = Math.min(2 * bid - 1, size);
  const made = top > bid ? `Take ${bid}–${top}: ${signed(10 * bid)} to ${signed(R.roundPoints(bid, top))}` : `Take ${bid}: ${signed(10 * bid)}`;
  const parts = [`<span class="good">${made}</span>`, `<span class="bad">Fewer: ${signed(-10 * bid)}</span>`];
  if (2 * bid <= size) parts.push(`<span class="bad">${2 * bid} or more: ${signed(-11 * bid)} or worse</span>`);
  return parts.join('');
}

// Everyone's bid so far, in bidding order (from the den).
function bidsSoFar(state) {
  const n = state.players.length;
  const order = Array.from({ length: n }, (_, i) => state.players[(state.den + i) % n]);
  return order.filter((p) => p.bid != null);
}

export class JudgementHuman {
  constructor(hud) {
    this.hud = hud;
    this.pending = null;
  }

  // The den has seen half their cards: pick a suit, with what they hold in each.
  chooseTrump(game, me) {
    return new Promise((resolve) => {
      const body = el('div', 'jprompt');
      body.appendChild(el('p', 'modal-body', `You’ve seen ${me.hand.length} of your ${game.state.handSize} cards. The rest come after you call.`));
      const grid = el('div', 'suit-grid');
      for (const key of SUIT_ORDER) {
        const suit = SUITS[key];
        const held = me.hand.filter((c) => c.suit === key).sort((a, b) => b.rank - a.rank);
        const b = el('button', `suit-btn ${key}`);
        b.innerHTML = `<span class="sym">${suit.symbol}&#xFE0E;</span><span class="nm">${suit.name}</span><span class="held">${held.length ? `${held.map((c) => rankLabel(c.rank)).join(' ')}` : 'none'}</span>`;
        b.addEventListener('click', () => {
          close();
          resolve(key);
        });
        grid.appendChild(b);
      }
      body.appendChild(grid);
      const { close } = this.hud.modal({ title: 'Call trumps', body, cancelable: false, dock: true });
    });
  }

  // Pick a number, read what it pays, then confirm.
  chooseBid(game, me, { min, max }) {
    return new Promise((resolve) => {
      const { state } = game;
      const body = el('div', 'jprompt');
      const trumps = me.hand.filter((c) => c.suit === state.trump).length;
      const before = bidsSoFar(state);
      const total = before.reduce((s, p) => s + p.bid, 0);
      const info = el('div', 'bid-info');
      info.innerHTML = `<span>${suitMark(state.trump)} ${SUITS[state.trump].name} are trumps · you hold ${trumps}</span>`
        + `<span>${before.length ? `${before.map((p) => `${esc(p.name)} <b>${p.bid}</b>`).join(' · ')} — total <b>${total}</b> of ${state.handSize}` : `You bid first · ${state.handSize} tricks to play`}</span>`;
      body.appendChild(info);
      const grid = el('div', 'bid-grid');
      const explain = el('div', 'bid-explain', 'How many tricks will you take?');
      const confirm = el('button', 'primary big', 'Bid');
      confirm.disabled = true;
      let pick = null;
      for (let b = min; b <= max; b++) {
        const btn = el('button', 'bid-btn', String(b));
        btn.addEventListener('click', () => {
          pick = b;
          grid.querySelectorAll('.bid-btn').forEach((x) => x.classList.toggle('on', x === btn));
          explain.innerHTML = bidOutcome(b, state.handSize);
          confirm.textContent = `Bid ${b}`;
          confirm.disabled = false;
        });
        grid.appendChild(btn);
      }
      confirm.addEventListener('click', () => {
        if (pick == null) return;
        close();
        resolve(pick);
      });
      body.append(grid, explain, confirm);
      const { close } = this.hud.modal({ title: 'Your bid', body, cancelable: false, dock: true });
    });
  }

  // Waits for a click on a card in the hand (on touch: a tap lifts it, a second plays it).
  choosePlay(game, me) {
    return new Promise((resolve) => {
      this.pending = { game, me, resolve };
      if (TOUCH && !JudgementHuman.tapTold) {
        JudgementHuman.tapTold = true;
        this.hud.toast('Tap a card to lift it, then tap it again to play it.', 'info', 4000);
      }
    });
  }

  onCardClick(card, zone, x, y, armed = true) {
    const p = this.pending;
    if (!p || zone.zone !== 'hand' || zone.playerId !== p.me.id || !armed) return;
    const { state } = p.game;
    if (!R.legalCards(p.me.hand, state.trick).some((c) => c.id === card.id)) {
      const led = SUITS[R.ledSuit(state.trick)];
      this.hud.toast(`Follow suit: play a ${led.symbol}\uFE0E ${led.name.slice(0, -1)}.`, 'warn');
      return;
    }
    this.pending = null;
    p.resolve(card.id);
  }

  endTurn() {}

  // Between rounds: the scores, until "Next round".
  roundOver(game, results) {
    return new Promise((resolve) => {
      const body = roundBoard(game.state, results, game.state.players.findIndex((p) => p.isHuman));
      const next = el('button', 'primary big', 'Next round');
      body.appendChild(next);
      const { close } = this.hud.modal({ title: `Round ${game.state.round} scores`, body, cancelable: false });
      next.addEventListener('click', () => {
        close();
        resolve();
      });
      next.focus();
    });
  }
}

const dot = (i) => `<i class="seat-dot" style="--c: ${AVATARS[i % AVATARS.length]}"></i>`;

// One round's results, and who calls trumps next.
export function roundBoard(state, results, seat = -1) {
  const body = el('div', 'jscores');
  const best = Math.max(...results.map((r) => r.score));
  const rows = results.map((r) => {
    const p = state.players[r.id];
    const how = R.bidState(r.bid, r.won);
    const cls = [r.id === seat ? 'me' : '', r.score === best ? 'lead' : ''].join(' ');
    return `<tr class="${cls}"><th>${dot(r.id)}${esc(p.name)}</th><td>${r.bid}</td><td>${r.won}</td><td class="${how}">${signed(r.points)}</td><td class="total">${scoreText(r.score)}</td></tr>`;
  });
  body.innerHTML = `<table class="score-table"><thead><tr><th></th><th>Bid</th><th>Won</th><th>Points</th><th>Total</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  if (state.round < state.rounds) {
    const den = state.players[(state.den + 1) % state.players.length];
    body.appendChild(el('p', 'muted', `Next: round ${state.round + 1} of ${state.rounds} · ${den.id === seat ? 'you are' : `${esc(den.name)} is`} the den.`));
  }
  return body;
}

// Every round so far: points (and tricks won / bid) per player, with totals.
// final: ranked by score, for the end of the game.
export function scoreTable(state, seat = -1, final = false) {
  const body = el('div', 'jscores');
  const players = [...state.players];
  if (final) players.sort((a, b) => b.score - a.score);
  const best = R.topScore(state.players);
  const rounds = Array.from({ length: state.rounds }, (_, i) => i);
  const head = rounds.map((r) => `<th class="${r + 1 === state.round && state.phase !== 'over' ? 'now' : ''}">R${r + 1}</th>`).join('');
  const rows = players.map((p) => {
    const cells = rounds.map((r) => {
      const h = p.history[r];
      if (h) return `<td class="${R.bidState(h.bid, h.won)}">${signed(h.points)}<small>${h.won}/${h.bid}</small></td>`;
      // The round being played: tricks so far.
      if (r + 1 === state.round && state.phase !== 'over' && p.bid != null) return `<td class="now"><small>${p.won}/${p.bid}</small></td>`;
      return '<td></td>';
    });
    const cls = [p.id === seat ? 'me' : '', p.score === best && state.round > 0 ? 'lead' : ''].join(' ');
    return `<tr class="${cls}"><th>${dot(p.id)}${esc(p.name)}</th>${cells.join('')}<td class="total">${scoreText(p.score)}</td></tr>`;
  });
  body.innerHTML = `<div class="score-scroll"><table class="score-table full"><thead><tr><th></th>${head}<th>Total</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  return body;
}

// For the game-over dialog: did `seat` win, the headline, and the final table.
export function gameResult(state, seat = -1) {
  const winners = state.winners;
  const won = winners.some((p) => p.id === seat);
  const top = scoreText(winners[0]?.score ?? 0);
  const others = winners.filter((p) => p.id !== seat).map((p) => esc(p.name));
  let title;
  let text;
  if (winners.length === 1) {
    title = won ? 'You win!' : `${others[0]} wins`;
    text = won ? `Top score with ${top} points. Well judged!` : `${others[0]} finished on ${top} points.`;
  } else {
    title = won ? 'A shared win!' : 'A shared win';
    text = `${nameList(won ? ['You', ...others] : others)} tied on ${top} points.`;
  }
  return { won, title, text, extra: scoreTable(state, seat, true) };
}

// The round and trumps, for the top bar.
export function gameInfo(state) {
  if (!state.round) return '';
  const trump = state.trump ? suitMark(state.trump) : '<span class="suit none">?</span>';
  return `${trump}<span>R${state.round}/${state.rounds}</span>`;
}

// The status line: what's happening, from `seat`'s point of view. Returns { text, mine }.
export function judgementStatus(state, seat) {
  const name = (i) => `<b>${esc(state.players[i]?.name ?? '')}</b>`;
  const mine = state.current === seat;
  switch (state.phase) {
    case 'over': {
      const names = state.winners.map((p) => (p.id === seat ? 'You' : `<b>${esc(p.name)}</b>`));
      return { text: names.length === 1 ? `${names[0]} won the game` : `${nameList(names)} shared the win`, mine: false };
    }
    case 'trump':
      return mine ? { text: '<b>Call trumps</b> · pick a suit', mine } : { text: `${name(state.current)} is calling trumps…`, mine };
    case 'bid':
      return mine ? { text: `<b>Your bid</b> · ${suitMark(state.trump)} trumps`, mine } : { text: `${name(state.current)} is bidding…`, mine };
    case 'play': {
      if (!mine) return { text: `${name(state.current)} is playing…`, mine };
      const led = R.ledSuit(state.trick);
      const me = state.players[seat];
      const follow = led && me.hand.some((c) => c.suit === led) ? ` · follow ${suitMark(led)}` : '';
      return { text: `<b>Your turn</b> · play a card${follow}`, mine };
    }
    case 'trick':
      return { text: `${state.current === seat ? '<b>You</b> take' : `${name(state.current)} takes`} the trick`, mine: false };
    case 'scoring':
      return { text: `Round ${state.round} scores`, mine: false };
    default:
      return { text: state.round ? `Round ${state.round} of ${state.rounds} · dealing…` : 'Dealing…', mine: false };
  }
}

// The toast when it's your turn: none for each card you play.
export const turnToast = (what) => ({ trump: 'Call trumps!', bid: 'Your bid!' })[what] ?? null;
