// The human side of Wordle: the table view does the typing (wordle-view.js), and
// this hands a finished word to the engine when it asks for one. Also the status
// line, the word counter in the top bar, the scores and the game-over dialog, shared
// by solo and online play.
import { MAX_GUESSES } from '../wordle/rules.js';
import { AVATARS } from '../render/view.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const nameList = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export class WordleHuman {
  constructor(hud, view) {
    this.hud = hud;
    this.view = view;
    this.pending = null;
  }

  // Waits for the next word from the view (or takes one typed while it waited).
  chooseGuess() {
    return new Promise((resolve) => {
      this.pending = resolve;
      const queued = this.view.takeQueued();
      if (queued) this.submit(queued);
    });
  }

  // From the view: a checked word. False if no guess is wanted right now.
  submit(word) {
    const resolve = this.pending;
    if (!resolve) return false;
    this.pending = null;
    resolve(word);
    return true;
  }

  // The word is over (or online, the server moved on): stop waiting.
  stopGuess() {
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

// The top bar's button: which word this is.
export const gameInfo = (state) => (state.round ? `Word ${state.round}/${state.rounds}` : '');

// Everyone's score, best first, and every word so far with who got it. On your own,
// just the words and how many guesses each took.
export function scoreTable(state, seat = -1) {
  const wrap = el('div', 'wscores');
  const alone = state.players.length === 1;
  const players = [...state.players].sort((a, b) => b.score - a.score || a.id - b.id);
  const best = Math.max(...players.map((p) => p.score));
  const rows = players
    .map((p) => `<tr class="${p.id === seat ? 'me' : ''}${state.phase === 'over' && p.score === best ? ' won' : ''}"><td><span class="dot" style="--c: ${AVATARS[p.id % AVATARS.length]}"></span>${esc(p.name)}</td><td class="num">${p.score}</td></tr>`)
    .join('');
  if (!alone) wrap.innerHTML = `<table class="wtable"><thead><tr><th>Player</th><th class="num">Words</th></tr></thead><tbody>${rows}</tbody></table>`;
  if (state.history.length) {
    const list = state.history
      .map((h, i) => {
        const w = h.winner == null ? null : state.players[h.winner];
        const tries = w && `${h.tries[h.winner]}/${MAX_GUESSES}`;
        const who = alone ? tries || 'missed' : w ? `${w.id === seat ? 'You' : esc(w.name)} · ${tries}` : 'nobody';
        return `<li><span class="n">${i + 1}</span><b class="${w ? '' : 'missed'}">${esc(h.word.toUpperCase())}</b><span class="muted">${who}</span></li>`;
      })
      .join('');
    wrap.appendChild(el('ol', 'wwords', list));
  } else if (alone) {
    wrap.appendChild(el('p', 'muted', 'No words finished yet.'));
  }
  return wrap;
}

// For the game-over dialog: did `seat` win, the headline, and the scores.
export function gameResult(state, seat = -1) {
  const winners = state.winners;
  const won = winners.some((p) => p.id === seat);
  const others = winners.filter((p) => p.id !== seat).map((p) => esc(p.name));
  const best = winners[0]?.score ?? 0;
  const of = `${plural(best, 'word')} of ${state.rounds}`;
  let title;
  let text;
  if (state.players.length === 1) {
    // On your own: how many you got, not who won.
    const got = `${best} of ${plural(state.rounds, 'word')}`;
    const title = best === state.rounds ? 'Every word!' : best ? got : 'No words this time';
    const text = best ? `You got ${got}.` : `You didn’t get any of the ${state.rounds} words.`;
    return { won: best > 0, title, text, extra: scoreTable(state, seat) };
  }
  if (!best) {
    title = 'Nobody scored';
    text = `Not one of the ${state.rounds} words was guessed.`;
  } else if (winners.length === 1) {
    title = won ? 'You win!' : `${others[0]} wins`;
    text = won ? `You got ${of} first.` : `${others[0]} got ${of} first.`;
  } else {
    title = won ? 'A shared win!' : 'A shared win';
    text = `${nameList(won ? ['You', ...others] : others)} each got ${of} first.`;
  }
  return { won, title, text, extra: scoreTable(state, seat) };
}

// The status line: what's happening, from `seat`'s point of view. Returns { text, mine }.
export function wordleStatus(state, seat) {
  const name = (p) => (p.id === seat && p.isHuman ? 'You' : `<b>${esc(p.name)}</b>`);
  const me = state.players[seat];
  switch (state.phase) {
    case 'over': {
      const best = state.winners[0]?.score ?? 0;
      if (state.players.length === 1) return { text: `You got ${best} of ${plural(state.rounds, 'word')}`, mine: false };
      if (!best) return { text: 'Nobody guessed a word', mine: false };
      const names = state.winners.map(name);
      return { text: `${nameList(names)} ${names.length > 1 ? 'shared the win' : 'won'} with ${plural(best, 'word')}`, mine: false };
    }
    case 'reveal': {
      const w = state.roundWinner;
      const word = `<b>${esc((state.answer ?? '').toUpperCase())}</b>`;
      const first = state.players.length > 1 ? ' first' : '';
      return { text: w ? `${name(w)} got ${word}${first}` : `The word was ${word}`, mine: false };
    }
    case 'guess': {
      if (!me?.isHuman) {
        const left = state.players.filter((p) => !p.done && !p.solved).length;
        return { text: `Word ${state.round} of ${state.rounds} · ${plural(left, 'player')} guessing`, mine: false };
      }
      if (me.done) return { text: 'Out of guesses · waiting for the others', mine: false };
      const n = me.guesses.length;
      return { text: `<b>Guess the word</b> · ${n ? `${MAX_GUESSES - n} of ${MAX_GUESSES} guesses left` : 'type a word and press Enter'}`, mine: true };
    }
    default:
      return { text: 'Picking a word…', mine: false };
  }
}

// No toast for a new word (the board says it); just the chime.
export const turnToast = () => null;
