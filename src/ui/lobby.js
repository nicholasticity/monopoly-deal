// Pre-game room screen: invite link, seats, host controls and chat.
import { GAMES } from '../game/settings.js';
import { WORD_COUNTS } from '../wordle/rules.js';
import { SCORING } from '../judgement/rules.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function inviteLink(code) {
  return `${location.origin}${location.pathname}?room=${code}`;
}

const isLocalHost = () => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);

async function copyText(text, input) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs https; fall back to selecting the field.
    input.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

export class Lobby {
  // actions: { addBot, kick(id), words(n), scoring(key), game(kind), start, leave, rules, voice(button) }
  constructor(chat, actions) {
    this.chat = chat;
    this.actions = actions;
    this.layer = document.getElementById('lobby-layer');
    this.room = null;
    this.you = null;
    this.rows = new Map(); // member id -> seat row
    this.build();
  }

  build() {
    const backdrop = el('div', 'modal-backdrop');
    const box = el('div', 'modal wide lobby');
    backdrop.appendChild(box);

    const head = el('div', 'lobby-head');
    const title = el('div', 'lobby-title');
    title.append(el('span', 'muted', 'Room'), (this.codeEl = el('span', 'room-code')), (this.gameEl = el('span', 'room-game muted')));
    const leave = el('button', 'ghost', 'Leave room');
    leave.addEventListener('click', () => this.actions.leave());
    const rules = el('button', 'ghost', 'How to play');
    rules.addEventListener('click', () => this.actions.rules());
    this.voiceBtn = el('button', 'ghost voice-btn');
    this.voiceBtn.addEventListener('click', () => this.actions.voice(this.voiceBtn));
    const headBtns = el('div', 'lobby-head-btns');
    headBtns.append(this.voiceBtn, rules, leave);
    head.append(title, headBtns);

    const invite = el('div', 'invite');
    this.linkInput = el('input');
    this.linkInput.readOnly = true;
    this.linkInput.addEventListener('focus', () => this.linkInput.select());
    const copy = el('button', 'primary', 'Copy invite link');
    copy.addEventListener('click', async () => {
      const ok = await copyText(this.linkInput.value, this.linkInput);
      copy.textContent = ok ? 'Copied!' : 'Press Ctrl+C';
      setTimeout(() => (copy.textContent = 'Copy invite link'), 1600);
    });
    invite.append(this.linkInput, copy);
    this.localNote = el('p', 'note warn', 'This link points at localhost, so it only works on this computer. To play with friends, open the game through your network address, a tunnel or a hosted server (see the README).');

    const cols = el('div', 'lobby-cols');
    const left = el('div', 'lobby-left');
    this.countEl = el('div', 'section-title');
    this.listEl = el('div', 'seats');
    this.addBotBtn = el('button', 'ghost add-bot', '+ Add a bot');
    this.addBotBtn.addEventListener('click', () => this.actions.addBot());
    const gameRow = el('div', 'opt-row');
    this.gameSeg = el('div', 'seg games');
    for (const [kind, g] of Object.entries(GAMES)) {
      const b = el('button', null, g.name);
      b.dataset.v = kind;
      b.addEventListener('click', () => this.isHost && this.actions.game(kind));
      this.gameSeg.appendChild(b);
    }
    // On phones a dropdown instead of the buttons, which wrap untidily there (style.css
    // shows one or the other).
    this.gameSelect = el('select', 'game-select');
    this.gameSelect.setAttribute('aria-label', 'Game');
    for (const [kind, g] of Object.entries(GAMES)) {
      const o = el('option', null, g.name);
      o.value = kind;
      this.gameSelect.appendChild(o);
    }
    this.gameSelect.addEventListener('change', () => this.isHost && this.actions.game(this.gameSelect.value));
    gameRow.append(el('span', null, 'Game'), this.gameSeg, this.gameSelect);
    // Wordle: how many words a game is.
    this.wordsRow = el('div', 'opt-row');
    this.wordsSeg = el('div', 'seg');
    for (const n of WORD_COUNTS) {
      const b = el('button', null, String(n));
      b.dataset.v = String(n);
      b.addEventListener('click', () => this.isHost && this.actions.words(n));
      this.wordsSeg.appendChild(b);
    }
    this.wordsRow.append(el('span', null, 'Words'), this.wordsSeg);
    // Judgement: how a round scores.
    this.scoringRow = el('div', 'opt-row');
    this.scoringSeg = el('div', 'seg');
    for (const [key, s] of Object.entries(SCORING)) {
      const b = el('button', null, s.name);
      b.dataset.v = key;
      b.title = s.hint;
      b.addEventListener('click', () => this.isHost && this.actions.scoring(key));
      this.scoringSeg.appendChild(b);
    }
    this.scoringRow.append(el('span', null, 'Scoring'), this.scoringSeg);
    this.scoringHint = el('p', 'muted small scoring-hint');
    // Pool: who plays.
    this.poolHint = el('p', 'muted small pool-hint', 'Pool is one on one, or two against two with four players (partners alternate). Anyone else watches.');
    this.startBtn = el('button', 'primary big', 'Start game');
    this.startBtn.addEventListener('click', () => this.actions.start());
    this.waitEl = el('p', 'muted waiting-host');
    left.append(this.countEl, this.listEl, this.addBotBtn, gameRow, this.wordsRow, this.scoringRow, this.scoringHint, this.poolHint, this.startBtn, this.waitEl);

    const right = el('div', 'lobby-right');
    right.appendChild(el('div', 'section-title', 'Chat'));
    this.chatSlot = el('div', 'chat-slot');
    right.appendChild(this.chatSlot);
    cols.append(left, right);

    this.noteEl = el('p', 'note');
    box.append(head, invite, this.localNote, this.noteEl, cols);
    this.setVoice('off', new Set());
    this.root = backdrop;
  }

  get isHost() {
    return this.room && this.room.hostId === this.you;
  }

  show() {
    if (!this.root.isConnected) this.layer.appendChild(this.root);
    this.chat.mount(this.chatSlot);
  }

  hide() {
    this.root.remove();
  }

  get shown() {
    return this.root.isConnected;
  }

  update(room, you) {
    this.room = room;
    this.you = you;
    const host = this.isHost;
    this.codeEl.textContent = room.code;
    this.gameEl.textContent = GAMES[room.game]?.name ?? '';
    this.linkInput.value = inviteLink(room.code);
    this.localNote.style.display = isLocalHost() ? '' : 'none';

    const seated = room.members.filter((m) => !m.left);
    const players = seated.length;
    this.countEl.textContent = `Players ${Math.min(players, room.max)}/${room.max}`;
    this.listEl.innerHTML = '';
    this.rows.clear();
    // Who'd sit out: past the table's size, or (pool with three) past two.
    const seats = room.seats ?? room.max;
    seated.forEach((m, i) => {
      const row = el('div', `seat${m.id === you ? ' me' : ''}${i >= seats ? ' bench' : ''}`);
      const icon = m.kind === 'bot' ? '🤖' : m.id === room.hostId ? '👑' : '🙂';
      row.appendChild(el('span', 'seat-icon', icon));
      const name = el('span', 'seat-name', m.name);
      row.appendChild(name);
      if (m.voice) {
        row.classList.add('voice');
        row.classList.toggle('mic-off', m.voice === 'muted');
        const mic = row.appendChild(el('span', 'mic'));
        mic.title = m.voice === 'muted' ? 'In voice chat (muted)' : 'In voice chat';
      }
      this.rows.set(m.id, row);
      const tags = [];
      if (m.id === you) tags.push('you');
      if (m.id === room.hostId) tags.push('host');
      if (m.kind === 'bot') tags.push('computer');
      if (m.kind === 'human' && !m.connected) tags.push('reconnecting…');
      if (i >= room.max) tags.push('next game');
      else if (i >= seats) tags.push('watches');
      if (tags.length) row.appendChild(el('span', 'seat-tags', tags.join(' · ')));
      if (host && m.id !== you) {
        const kick = el('button', 'ghost small', 'Remove');
        kick.addEventListener('click', () => this.actions.kick(m.id));
        row.appendChild(kick);
      }
      this.listEl.appendChild(row);
    });
    for (let i = players; i < room.max; i++) this.listEl.appendChild(el('div', 'seat empty', host ? 'Empty seat — invite a friend or add a bot' : 'Empty seat'));

    this.addBotBtn.style.display = host && room.status === 'lobby' && players < room.max ? '' : 'none';
    const wordle = room.game === 'wordle';
    this.wordsRow.style.display = wordle ? '' : 'none';
    this.poolHint.style.display = room.game === 'pool' ? '' : 'none';
    const judgement = room.game === 'judgement';
    this.scoringRow.style.display = this.scoringHint.style.display = judgement ? '' : 'none';
    this.scoringHint.textContent = SCORING[room.scoring]?.hint ?? '';
    for (const [seg, value] of [[this.gameSeg, room.game], [this.wordsSeg, String(room.words)], [this.scoringSeg, room.scoring]]) {
      for (const b of seg.children) {
        b.classList.toggle('on', b.dataset.v === value);
        b.disabled = (!host || room.status !== 'lobby') && b.dataset.v !== value;
      }
      seg.classList.toggle('readonly', !host);
    }
    this.gameSelect.value = room.game;
    this.gameSelect.disabled = !host || room.status !== 'lobby';
    this.startBtn.style.display = host ? '' : 'none';
    this.startBtn.disabled = players < 2 || room.status !== 'lobby';
    const hostName = room.members.find((m) => m.id === room.hostId)?.name ?? 'the host';
    this.waitEl.textContent = host
      ? players < 2 ? 'You need at least one more player — invite a friend or add a bot.' : ''
      : room.status === 'playing' ? 'A game is in progress…' : `Waiting for ${hostName} to start the game…`;
  }

  // The voice chat button, and who in the list is talking right now.
  setVoice(state, talking) {
    this.voiceBtn.textContent = state === 'off' ? '🎙️ Join voice' : state === 'muted' ? '🎙️ Mic off' : '🎙️ Mic on';
    this.voiceBtn.classList.toggle('on', state === 'on');
    this.voiceBtn.classList.toggle('mic-off', state === 'muted');
    for (const [id, row] of this.rows) row.classList.toggle('talking', talking.has(id));
  }

  notice(text, kind = 'warn') {
    this.noteEl.textContent = text;
    this.noteEl.className = `note ${kind === 'warn' ? 'warn' : 'info'}`;
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => (this.noteEl.textContent = ''), 8000);
  }
}
