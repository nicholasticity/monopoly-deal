// Browser side of an online room. The server runs the game; this mirrors it onto
// the table view and turns the server's prompts into the usual HUD dialogs.
import { Connection } from './connection.js';
import { MirrorGame } from './mirror.js';
import { JudgementMirror } from './judgement-mirror.js';
import { HumanController } from '../ui/human.js';
import { JudgementHuman, judgementStatus, gameInfo, gameResult, roundBoard, turnToast } from '../ui/judgement.js';
import { ChatPanel } from '../ui/chat.js';
import { Lobby } from '../ui/lobby.js';
import { cueLog } from '../ui/sound.js';
import { VoiceChat, voiceSupported } from './voice.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}
const DOING = { turn: 'playing', payment: 'choosing how to pay', justsayno: 'deciding whether to Just Say No', discard: 'discarding' };
// The countdown only shows once a decision is running short.
const CLOCK_FROM_S = 30;
// Set while this tab is in voice chat, so a reload rejoins it.
const VOICE_KEY = 'md-voice';

// Identifies this tab to the server so a refresh or dropped connection gets the
// same seat back. Per tab, so two tabs are two players.
function clientId() {
  let id = sessionStorage.getItem('md-client');
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem('md-client', id);
  }
  return id;
}

export function setRoomInURL(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

export class OnlineSession {
  // code: room to join, or null to create one; game: what a new room plays.
  // useGame(kind) puts that game's table on show and returns its view.
  // onExit(message) runs once the session is over (left, kicked, or the room is gone).
  constructor({ view, useGame, hud, name, game, code, onExit }) {
    this.view = view;
    this.useGame = useGame;
    this.kind = game;
    this.hud = hud;
    this.name = name;
    this.code = code;
    this.onExit = onExit;
    this.memberId = null;
    this.room = null;
    this.mirror = null;
    this.gameNo = null;
    this.seat = -1;
    this.needsAttach = false;
    this.inGame = false;
    this.gameoverOpen = false;
    this.justJoined = false;
    this.req = null;
    this.human = null;
    this.waiting = null;
    this.netDown = false;
    this.closed = false;

    this.chat = new ChatPanel({ onSend: (text) => this.send('chat', { text }) });
    this.chat.onUnseen = (entry) => this.hud.chatUnseen(entry);
    this.lobby = new Lobby(this.chat, {
      addBot: () => this.send('addBot'),
      kick: (id) => this.send('kick', { id }),
      speed: (speed) => this.send('speed', { speed }),
      game: (game) => this.send('game', { game }),
      start: () => this.send('start'),
      leave: () => this.confirmLeave(),
      rules: () => this.hud.showRules(),
      voice: (anchor) => this.voiceButton(anchor),
    });
    this.voice = new VoiceChat((type, data) => this.send(type, data));
    this.voice.onChange = () => this.showVoice();
    this.voice.onNotice = (text) => this.notice(text);

    this.conn = new Connection();
    this.conn.onOpen = () => this.join();
    this.conn.onMessage = (msg) => this.onMessage(msg);
    this.conn.onStatus = (s) => this.onStatus(s);
    this.tick = setInterval(() => this.updateStatus(), 1000);
  }

  start() {
    this.hud.setOnline(true);
    this.hud.setStatus('Connecting…');
    this.conn.open();
  }

  send(type, data) {
    this.conn.send(type, data);
  }

  join() {
    const id = clientId();
    if (this.code) this.send('join', { code: this.code, name: this.name, clientId: id });
    else this.send('create', { name: this.name, clientId: id, game: this.kind });
  }

  get me() {
    return this.room?.members.find((m) => m.id === this.memberId) ?? null;
  }

  get isHost() {
    return !!this.room && this.room.hostId === this.memberId;
  }

  onStatus(status) {
    if (status === 'failed') return this.exit('Couldn’t reach the game server. Online play needs the game’s own server — run it with "npm run dev" or "npm start" (see the README).');
    if (status === 'replaced') return this.exit('You opened this room in another tab, so this one was disconnected.');
    this.netDown = status === 'reconnecting';
    this.refreshBanner();
  }

  onMessage(msg) {
    if (this.closed) return;
    switch (msg.type) {
      case 'hello':
        this.voice.iceServers = msg.iceServers;
        break;
      case 'joined':
        this.memberId = msg.you;
        this.voice.joined(msg.you);
        this.resumeVoice();
        this.code = msg.code;
        this.chat.selfId = msg.you;
        this.justJoined = true;
        sessionStorage.setItem('md-room', msg.code);
        localStorage.setItem('md-name', this.name);
        setRoomInURL(msg.code);
        break;
      case 'history':
        this.chat.reset(msg.chat);
        this.hud.clearLog();
        for (const l of msg.log) this.hud.log(l.text, l.kind);
        break;
      case 'room':
        this.onRoom(msg.room);
        break;
      case 'game':
        this.onGame(msg);
        break;
      case 'state':
        this.onState(msg);
        break;
      case 'log':
        this.hud.log(msg.text, msg.kind);
        cueLog(msg.text, msg.kind);
        break;
      case 'toast':
        this.hud.toast(msg.text, msg.kind);
        break;
      case 'turn':
        if (msg.playerId === this.seat) this.hud.yourTurn(msg.what ? turnToast(msg.what) : undefined);
        break;
      case 'round':
        this.onRound(msg);
        break;
      case 'waiting':
        this.waiting = msg.playerId == null ? null : { ...msg, deadline: Date.now() + msg.remaining };
        this.updateStatus();
        break;
      case 'request':
        this.onRequest(msg);
        break;
      case 'cancel':
        if (this.req?.id === msg.reqId) this.dropRequest();
        break;
      case 'gameover':
        this.onGameOver(msg);
        break;
      case 'lobby':
        this.onLobby();
        break;
      case 'chat':
        this.chat.add(msg);
        break;
      case 'rtc':
        this.voice.signal(msg.from, msg.data);
        break;
      case 'kicked':
        this.exit('The host removed you from the room.');
        break;
      case 'error':
        if (msg.fatal) this.exit(msg.message);
        else this.hud.toast(msg.message, 'warn');
        break;
    }
  }

  // ---------- room & lobby ----------

  onRoom(room) {
    this.room = room;
    this.justJoined = false;
    // The game may have ended while we were disconnected.
    if (room.status === 'lobby' && this.inGame) this.endGame();
    // Between games the top bar (and the rules) follow the host's pick.
    if (!this.inGame && !this.gameoverOpen) this.setKind(room.game);
    this.lobby.update(room, this.memberId);
    this.voice.update(room.members);
    if (room.status === 'lobby' && !this.gameoverOpen) this.showLobby();
    if (room.status === 'playing' && !this.inGame) this.showLobby();
    this.hud.setHost(this.inGame && this.isHost);
    this.applyTags();
    if (this.mirror && !this.needsAttach && this.inGame) this.view.layout();
    this.refreshBanner();
    this.updateStatus();
  }

  setKind(kind = 'deal') {
    this.kind = kind;
    this.view = this.useGame(kind);
  }

  showLobby() {
    if (this.closed || this.inGame) return;
    if (this.room) this.setKind(this.room.game);
    this.hud.closeAll();
    this.hud.setChatDock(false);
    this.lobby.show();
  }

  onLobby() {
    const ended = this.inGame && !this.gameoverOpen;
    this.endGame();
    if (ended) {
      this.hud.toast('The game was ended.', 'warn');
      this.showLobby();
    }
  }

  endGame() {
    if (!this.inGame) return;
    this.inGame = false;
    this.waiting = null;
    this.dropRequest();
    this.hud.setHost(false);
    this.updateStatus();
  }

  // ---------- the game ----------

  onGame(msg) {
    // A stale prompt from before a reconnect: the server moved on without us.
    if (this.req && this.req.id !== msg.reqId) this.dropRequest();
    const sameGame = this.mirror && this.gameNo === msg.gameNo;
    if (!sameGame) {
      this.gameNo = msg.gameNo;
      this.seat = msg.you;
      this.setKind(msg.kind);
      this.mirror = this.kind === 'judgement' ? new JudgementMirror(msg.seats, msg.you) : new MirrorGame(msg.seats, msg.you);
      this.needsAttach = true;
      this.waiting = null;
      this.hud.closeAll();
      this.hud.setTurnControls(false);
      // On a fresh start the log belongs to the last game; on a (re)join the
      // server has just sent this game's log as history.
      if (!this.justJoined) this.hud.clearLog();
    }
    this.inGame = true;
    this.gameoverOpen = false;
    this.lobby.hide();
    this.chat.mount(this.hud.chatDock);
    this.hud.setHost(this.isHost);
    this.applyTags();
  }

  onState(snap) {
    if (!this.mirror) return;
    this.mirror.apply(snap);
    this.applyTags();
    if (this.needsAttach) {
      this.needsAttach = false;
      this.view.attach(this.mirror);
      this.showVoice();
    } else {
      this.view.layout();
    }
    this.updateStatus();
  }

  // Seat labels show who is a bot, offline, away or gone.
  applyTags() {
    if (!this.mirror) return;
    for (const p of this.mirror.state.players) {
      const m = this.room?.members.find((x) => x.id === p.memberId);
      p.tag = !m ? '' : m.kind === 'bot' ? '🤖' : m.left ? '🚪' : !m.connected ? '📴' : m.away ? '💤' : '';
    }
  }

  async onRequest(msg) {
    if (!this.mirror || this.needsAttach) return;
    // Re-sent after a reconnect while the prompt is still open here.
    if (this.req?.id === msg.reqId) return;
    this.dropRequest();
    const g = this.mirror;
    const human = g.kind === 'judgement' ? new JudgementHuman(this.hud) : new HumanController(this.hud);
    const req = { id: msg.reqId, kind: msg.kind };
    this.req = req;
    this.human = human;
    const me = g.me;
    const a = msg.args;
    let value;
    switch (msg.kind) {
      case 'turn':
        value = await human.chooseTurnAction(g, me);
        break;
      case 'payment':
        value = await human.choosePayment(g, me, a.amount, g.playerById(a.creditorId), a.reason);
        break;
      case 'justsayno':
        value = await human.chooseJustSayNo(g, me, g.justSayNoContext(a));
        break;
      case 'discard':
        value = await human.chooseDiscards(g, me, a.count);
        break;
      case 'trump':
        value = await human.chooseTrump(g, me);
        break;
      case 'bid':
        value = await human.chooseBid(g, me, a);
        break;
      case 'play':
        value = await human.choosePlay(g, me);
        break;
      default:
        return;
    }
    if (this.req !== req || this.closed) return;
    this.req = null;
    this.human = null;
    this.send('response', { reqId: req.id, value });
  }

  // Close whatever we were asking the player; the server has decided for them.
  dropRequest() {
    if (!this.req) return;
    this.req = null;
    this.human = null;
    this.hud.closeAll();
    this.hud.setTurnControls(false);
  }

  // Judgement: the round's scores while the next one is dealt. The next prompt (or
  // Continue) closes them; the last round's are in the game-over table instead.
  onRound(msg) {
    const state = this.mirror?.state;
    if (!state || this.req || msg.round >= state.rounds) return;
    const body = roundBoard({ ...state, round: msg.round }, msg.results, this.seat);
    const ok = el('button', 'primary big', 'Continue');
    body.appendChild(ok);
    const { close } = this.hud.modal({ title: `Round ${msg.round} scores`, body });
    ok.addEventListener('click', close);
    this.hud.cancelTop = close;
  }

  async onGameOver(msg) {
    this.dropRequest();
    this.waiting = null;
    const state = this.mirror?.state;
    const winner = state?.players[msg.winnerId];
    if (!winner) return;
    this.gameoverOpen = true;
    if (this.mirror.kind === 'judgement') {
      state.winners = msg.winnerIds.map((id) => state.players[id]);
      state.phase = 'over';
      await this.hud.showResult({ ...gameResult(state, this.seat), buttonLabel: 'Back to lobby' });
    } else {
      await this.hud.showGameOver(winner, winner.id === this.seat, msg.stats, 'Back to lobby');
    }
    // If the host already started the next game, the modal was closed for us.
    this.gameoverOpen = false;
    if (!this.closed && this.room?.status === 'lobby') this.showLobby();
  }

  // ---------- voice chat ----------

  // The 🎙️ button: join voice chat, or once in it, mute or leave.
  async voiceButton(anchor) {
    if (!voiceSupported()) {
      return this.notice(
        window.isSecureContext
          ? 'This browser can’t do voice chat.'
          : 'Voice chat needs a secure address: browsers only allow the microphone on https pages or localhost. See the README for ways to host the game.',
      );
    }
    if (!this.voice.active) return this.joinVoice();
    const others = (this.room?.members ?? []).filter((m) => m.voice && m.id !== this.memberId).map((m) => m.name);
    const r = anchor.getBoundingClientRect();
    const pick = await this.hud.menu(
      r.left + r.width / 2,
      r.bottom,
      'Voice chat',
      [
        { label: others.length ? `With ${others.join(', ')}` : 'Nobody else is in voice yet', value: null, disabled: true },
        { label: this.voice.muted ? 'Unmute my mic' : 'Mute my mic', value: 'mute' },
        { label: 'Leave voice chat', value: 'leave' },
      ],
      { below: true },
    );
    if (pick === 'mute') this.voice.setMuted(!this.voice.muted);
    else if (pick === 'leave') {
      this.voice.leave();
      sessionStorage.removeItem(VOICE_KEY);
    }
  }

  // The M key.
  toggleMute() {
    if (!this.voice.active) return;
    this.voice.setMuted(!this.voice.muted);
    this.hud.toast(this.voice.muted ? 'Mic muted' : 'Mic on', 'info', 1200);
  }

  // auto: rejoining after a reload, so stay quiet if it doesn't work.
  async joinVoice(auto = false) {
    try {
      await this.voice.join();
    } catch (e) {
      sessionStorage.removeItem(VOICE_KEY);
      if (auto) return;
      const why = {
        NotAllowedError: 'Microphone access is blocked. Allow it for this site (see the address bar), then try again.',
        NotFoundError: 'No microphone was found.',
        NotReadableError: 'The microphone is busy in another app.',
      }[e.name];
      this.notice(why ?? `Couldn’t start voice chat (${e.message}).`);
      return;
    }
    if (!this.voice.active) return;
    sessionStorage.setItem(VOICE_KEY, '1');
    if (!auto) this.notice('You’re in voice chat. Use the 🎙️ button to mute or leave.', 'info');
  }

  // After a reload, back into voice chat if this tab was in it and the browser
  // still allows the microphone without asking.
  async resumeVoice() {
    if (this.voice.active || sessionStorage.getItem(VOICE_KEY) !== '1' || !voiceSupported()) return;
    sessionStorage.removeItem(VOICE_KEY);
    try {
      const mic = await navigator.permissions.query({ name: 'microphone' });
      if (mic.state === 'granted' && !this.closed) this.joinVoice(true);
    } catch {
      // This browser can't say without asking; the player can tap the button.
    }
  }

  // Mic badges and talking lights in the top bar, the lobby and on the table.
  showVoice() {
    if (this.closed) return;
    const { state, talking } = this.voice;
    const members = this.room?.members ?? [];
    this.hud.setVoice(state, talking.has(this.memberId));
    this.lobby.setVoice(state, talking);
    if (!this.mirror || this.needsAttach) return;
    this.view.setVoice(
      this.mirror.state.players.map((p) => {
        const m = members.find((x) => x.id === p.memberId);
        return !m?.voice ? '' : talking.has(m.id) ? 'talking' : m.voice;
      }),
    );
  }

  // Lobby notes and in-game toasts: the lobby covers the toasts.
  notice(text, kind = 'warn') {
    if (this.lobby.shown) this.lobby.notice(text, kind);
    else this.hud.toast(text, kind, 5000);
  }

  // ---------- status line & banners ----------

  updateStatus() {
    if (this.closed) return;
    if (!this.inGame || !this.mirror) {
      this.hud.setStatus(this.room ? `Room <b>${this.room.code}</b> · ${this.room.status === 'playing' ? 'game in progress' : 'lobby'}` : 'Connecting…');
      this.hud.setGameInfo('');
      return;
    }
    const { state } = this.mirror;
    const w = this.waiting;
    const secs = w ? Math.max(0, Math.ceil((w.deadline - Date.now()) / 1000)) : null;
    const clock = secs != null && secs <= CLOCK_FROM_S ? ` <span class="clock${secs <= 10 ? ' low' : ''}">⏱ ${secs}s</span>` : '';
    const watching = this.seat < 0 ? 'Watching · ' : '';
    if (this.mirror.kind === 'judgement') {
      const { text, mine } = judgementStatus(state, this.seat);
      this.hud.setStatus((mine || state.phase === 'over' ? '' : watching) + text + (state.phase === 'over' ? '' : clock), mine);
      this.hud.setGameInfo(gameInfo(state), 'Scores');
      return;
    }
    const nameOf = (i) => `<b>${esc(state.players[i]?.name ?? '')}</b>`;
    if (state.phase === 'over' && state.winner) {
      this.hud.setStatus(`${nameOf(state.winner.id)} won the game`);
      return;
    }
    if (state.turn === 0) {
      this.hud.setStatus('Dealing…');
      return;
    }
    const plays = `${state.playsLeft} play${state.playsLeft === 1 ? '' : 's'} left`;
    let text;
    const mine = w ? w.playerId === this.seat : !!this.mirror.current?.isHuman;
    if (w && w.playerId === this.seat) {
      text = {
        turn: `<b>Your turn</b> · ${plays}`,
        payment: '<b>You owe money</b> · choose how to pay',
        justsayno: '<b>Just Say No?</b>',
        discard: '<b>Too many cards</b> · discard down to 7',
      }[w.kind];
    } else if (w) {
      text = `${watching}${nameOf(w.playerId)} is ${DOING[w.kind]}…`;
    } else if (this.mirror.current?.isHuman) {
      text = `<b>Your turn</b> · ${plays}`;
    } else {
      text = `${watching}${nameOf(state.current)} is playing…`;
    }
    this.hud.setStatus(text + clock, mine);
  }

  refreshBanner() {
    if (this.closed) return;
    const me = this.me;
    if (this.netDown) this.hud.setBanner('📡 Connection lost — reconnecting…');
    else if (this.inGame && me?.away && !me.left) this.hud.setBanner('💤 A bot is playing for you while you’re away.', 'I’m back', () => this.send('back'));
    else this.hud.setBanner(null);
  }

  // ---------- leaving ----------

  async confirmLeave() {
    const ok = await this.hud.confirm({
      title: 'Leave the room?',
      body: this.inGame && this.seat >= 0 ? 'A bot will take over your cards for the rest of this game.' : 'You can come back with the room code while the room is open.',
      ok: 'Leave',
    });
    if (ok && !this.closed) {
      this.send('leave');
      this.exit(null);
    }
  }

  async confirmStop() {
    const ok = await this.hud.confirm({ title: 'End this game?', body: 'Everyone goes back to the lobby.', ok: 'End game' });
    if (ok && !this.closed) this.send('stop');
  }

  // Tear down without notifying anyone (used when switching to another game).
  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.tick);
    this.voice.close();
    sessionStorage.removeItem(VOICE_KEY);
    this.conn.close();
    this.lobby.hide();
    this.chat.el.remove();
    this.hud.closeAll();
    this.hud.setTurnControls(false);
    this.hud.setBanner(null);
    this.hud.setHost(false);
    this.hud.setOnline(false);
    this.hud.setVoice('off');
    sessionStorage.removeItem('md-room');
    setRoomInURL(null);
  }

  exit(message) {
    if (this.closed) return;
    this.close();
    this.onExit(message);
  }
}
