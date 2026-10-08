// A multiplayer room: lobby, chat and one authoritative game at a time. Remote
// players answer the engine's decisions over their socket; bots, and humans who
// time out or drop, are played by the regular AI.
import { Game, GameAborted } from '../src/game/engine.js';
import { AIController } from '../src/game/ai.js';
import * as R from '../src/game/rules.js';
import { JudgementGame } from '../src/judgement/engine.js';
import { JudgementAI } from '../src/judgement/ai.js';
import { GAMES, DEFAULT_GAME, BOT_NAMES, SPEEDS, MAX_PLAYERS, TIMEOUTS } from '../src/game/settings.js';
import { Viewer } from './viewer.js';

const MAX_MEMBERS = MAX_PLAYERS + 3; // a few spectators may watch a running game
const CHAT_KEEP = 60;
const LOG_KEEP = 300;
// How long a dropped player keeps their seat before a bot takes over.
const RECONNECT_GRACE_MS = 15_000;
// How long a lobby member who dropped stays listed.
const LOBBY_GRACE_MS = 30_000;
// How long a room with nobody connected survives.
const EMPTY_ROOM_MS = 5 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ACTION_KINDS = new Set(['bank', 'property', 'moveWild', 'rent', 'action', 'end']);

// Names end up in the HTML of other players' screens, so keep them plain.
export function cleanName(raw) {
  const name = String(raw ?? '')
    .replace(/[\u0000-\u001f<>&"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16)
    .trim();
  return !name || /^you$/i.test(name) ? 'Player' : name;
}

export class Room {
  // timeScale shortens every pause and bot delay (tests use 0). game: which game
  // the room plays (the host can change it in the lobby).
  constructor(code, onClose, { timeScale = 1, game = DEFAULT_GAME } = {}) {
    this.code = code;
    this.onClose = onClose;
    this.timeScale = timeScale;
    this.members = [];
    this.hostId = null;
    this.kind = GAMES[game] ? game : DEFAULT_GAME;
    this.speed = 'normal';
    this.status = 'lobby';
    this.game = null;
    this.chat = [];
    this.log = [];
    this.waitingFor = null;
    this.seq = 0;
    this.reqSeq = 0;
    this.gameNo = 0;
    this.emptyTimer = null;
    this.closed = false;
  }

  // ---------- membership ----------

  get humans() {
    return this.members.filter((m) => m.kind === 'human');
  }

  member(id) {
    return this.members.find((m) => m.id === id) || null;
  }

  uniqueName(name, self = null) {
    const taken = (n) => this.members.some((m) => m !== self && !m.left && m.name.toLowerCase() === n.toLowerCase());
    if (!taken(name)) return name;
    for (let i = 2; ; i++) {
      const n = `${name.slice(0, 13)} ${i}`;
      if (!taken(n)) return n;
    }
  }

  // Returns the member, or an error string.
  join(conn, clientId, rawName) {
    const existing = this.members.find((m) => m.clientId === clientId && m.kind === 'human' && !m.left);
    if (existing) {
      this.attach(existing, conn);
      return existing;
    }
    if (this.humans.filter((m) => !m.left).length >= MAX_PLAYERS || this.members.length >= MAX_MEMBERS) return 'That room is full.';
    // A new player bumps a bot from the lobby if the table is full.
    if (this.status === 'lobby' && this.members.length >= MAX_PLAYERS) {
      const bot = this.members.findLast((m) => m.kind === 'bot');
      if (!bot) return 'That room is full.';
      this.remove(bot);
    }
    const m = {
      id: ++this.seq,
      clientId,
      kind: 'human',
      name: this.uniqueName(cleanName(rawName)),
      conn: null,
      seat: -1,
      away: false,
      left: false,
      pending: null,
      misses: 0,
      known: new Map(),
      dropTimer: null,
      chatTimes: [],
      voice: null, // in voice chat: 'on' or 'muted'
    };
    this.members.push(m);
    if (!this.hostId) this.hostId = m.id;
    this.attach(m, conn);
    this.system(`${m.name} joined${this.status === 'playing' ? ' and is watching — they’ll be dealt in next game' : ''}.`);
    return m;
  }

  attach(m, conn) {
    if (m.conn && m.conn !== conn) {
      // Same player opened the game again elsewhere; the newest tab wins.
      const old = m.conn;
      old.member = null;
      old.room = null;
      old.drop();
    }
    conn.member = m;
    conn.room = this;
    m.conn = conn;
    m.known = new Map();
    clearTimeout(m.dropTimer);
    clearTimeout(this.emptyTimer);
    const wasAway = m.away;
    m.away = false;
    // A new connection says again whether it's in voice chat.
    m.voice = null;
    m.misses = 0;
    conn.send({ type: 'joined', code: this.code, you: m.id });
    conn.send({ type: 'history', chat: this.chat, log: this.log });
    if (this.status === 'playing') {
      this.sendGame(m);
      this.sendState(m);
      if (m.pending) this.sendRequest(m);
      conn.send(this.waitingMessage());
      if (wasAway) this.system(`${m.name} is back.`);
    }
    this.broadcastRoom();
  }

  // Socket closed without saying goodbye: hold the seat for a while.
  disconnected(m) {
    m.conn = null;
    m.voice = null;
    clearTimeout(m.dropTimer);
    if (this.status === 'playing' && m.seat >= 0) {
      m.dropTimer = setTimeout(() => {
        if (m.conn) return;
        m.away = true;
        this.system(`${m.name} lost connection — a bot is playing for them.`);
        this.delegate(m);
        this.broadcastRoom();
      }, RECONNECT_GRACE_MS);
    } else {
      m.dropTimer = setTimeout(() => {
        if (!m.conn) this.leave(m, 'left');
      }, LOBBY_GRACE_MS);
    }
    this.broadcastRoom();
    this.checkEmpty();
  }

  leave(m, verb = 'left') {
    clearTimeout(m.dropTimer);
    m.voice = null;
    if (m.conn) {
      const conn = m.conn;
      m.conn = null;
      conn.member = null;
      conn.room = null;
    }
    if (this.status === 'playing' && m.seat >= 0) {
      // Keep the seat so the game can go on; a bot finishes it.
      m.left = true;
      m.away = true;
      this.delegate(m);
      this.system(`${m.name} ${verb} — a bot takes over their cards.`);
    } else {
      this.remove(m);
      this.system(`${m.name} ${verb}.`);
    }
    this.fixHost();
    this.broadcastRoom();
    this.checkEmpty();
  }

  remove(m) {
    this.members = this.members.filter((x) => x !== m);
  }

  fixHost() {
    const host = this.member(this.hostId);
    if (host && host.kind === 'human' && !host.left) return;
    const next = this.humans.find((m) => !m.left && m.conn) || this.humans.find((m) => !m.left);
    this.hostId = next ? next.id : null;
    if (next) this.system(`${next.name} is now the host.`);
  }

  checkEmpty() {
    clearTimeout(this.emptyTimer);
    if (this.humans.some((m) => m.conn)) return;
    this.emptyTimer = setTimeout(() => this.close(), EMPTY_ROOM_MS);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.emptyTimer);
    this.game?.abort();
    for (const m of this.members) {
      clearTimeout(m.dropTimer);
      this.delegate(m);
    }
    this.onClose(this);
  }

  // ---------- lobby commands ----------

  isHost(m) {
    return m.id === this.hostId;
  }

  addBot(m) {
    if (!this.isHost(m) || this.status !== 'lobby' || this.members.length >= MAX_PLAYERS) return;
    const used = new Set(this.members.map((x) => x.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || this.uniqueName('Bot');
    this.members.push({ id: ++this.seq, kind: 'bot', name, seat: -1, away: false, left: false });
    this.broadcastRoom();
  }

  kick(m, id) {
    const target = this.member(id);
    if (!this.isHost(m) || this.status !== 'lobby' || !target || target === m) return;
    if (target.kind === 'bot') {
      this.remove(target);
      this.broadcastRoom();
      return;
    }
    const conn = target.conn;
    conn?.send({ type: 'kicked' });
    this.leave(target, 'was removed by the host');
    conn?.drop();
  }

  setSpeed(m, speed) {
    if (!this.isHost(m) || this.status !== 'lobby' || !SPEEDS[speed]) return;
    this.speed = speed;
    this.broadcastRoom();
  }

  setGame(m, kind) {
    if (!this.isHost(m) || this.status !== 'lobby' || !GAMES[kind] || kind === this.kind) return;
    this.kind = kind;
    this.system(`${m.name} picked ${GAMES[kind].name}.`);
    this.broadcastRoom();
  }

  say(m, text) {
    const now = Date.now();
    m.chatTimes = m.chatTimes.filter((t) => now - t < 10_000);
    if (m.chatTimes.length >= 8) return;
    m.chatTimes.push(now);
    const clean = String(text ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
    if (clean) this.pushChat({ from: m.id, name: m.name, text: clean });
  }

  system(text) {
    this.pushChat({ system: true, text });
  }

  pushChat(msg) {
    const entry = { ...msg, at: Date.now() };
    this.chat.push(entry);
    if (this.chat.length > CHAT_KEEP) this.chat.shift();
    this.broadcast({ type: 'chat', ...entry });
  }

  // ---------- voice chat ----------

  setVoice(m, on, muted) {
    const voice = on ? (muted ? 'muted' : 'on') : null;
    if (m.voice === voice) return;
    m.voice = voice;
    this.broadcastRoom();
  }

  // Passes a voice connection offer or answer to another member in voice chat.
  // The audio itself goes directly between the players.
  relay(m, to, data) {
    const target = this.member(to);
    const sdp = data?.sdp;
    if (!m.voice || !target?.voice || target === m || typeof data.sid !== 'string') return;
    if (!sdp || (sdp.type !== 'offer' && sdp.type !== 'answer') || typeof sdp.sdp !== 'string') return;
    target.conn?.send({ type: 'rtc', from: m.id, data: { sid: data.sid.slice(0, 40), sdp: { type: sdp.type, sdp: sdp.sdp } } });
  }

  back(m) {
    if (!m.away || m.left) return;
    m.away = false;
    m.misses = 0;
    this.system(`${m.name} is back.`);
    this.broadcastRoom();
  }

  // ---------- the game ----------

  start(m) {
    if (!this.isHost(m) || this.status !== 'lobby') return;
    const seated = this.members.slice(0, MAX_PLAYERS);
    if (seated.length < 2) return;
    const speed = SPEEDS[this.speed];
    const judgement = this.kind === 'judgement';
    const Bot = judgement ? JudgementAI : AIController;
    const players = seated.map((s, i) => {
      s.seat = i;
      s.away = false;
      s.misses = 0;
      s.ai = new Bot({ delay: speed.delay * this.timeScale });
      return { name: s.name, controller: s.kind === 'bot' ? s.ai : new SeatController(this, s) };
    });
    for (const s of this.members.slice(MAX_PLAYERS)) s.seat = -1;
    this.viewers = seated.map((_, i) => new Viewer(i));
    this.spectator = new Viewer(-1);
    this.log = [];
    this.waitingFor = null;
    this.gameNo++;
    // The server has no renderer; the "view" just paces the game so clients can animate.
    const view = { sync: (g, ms) => sleep(ms * speed.pace * this.timeScale) };
    const game = judgement ? new JudgementGame({ players, view }) : new Game({ players, view });
    this.game = game;
    this.status = 'playing';
    game.on((type, data) => this.onGameEvent(game, type, data));
    for (const x of this.humans) {
      if (!x.conn) continue;
      x.known = new Map();
      this.sendGame(x);
    }
    // Anyone dealt in while offline gets the in-game reconnect grace.
    for (const s of seated) if (s.kind === 'human' && !s.conn) this.disconnected(s);
    this.broadcastRoom();
    game.run().then(
      () => this.finish(game),
      (e) => {
        if (!(e instanceof GameAborted)) {
          console.error(`[room ${this.code}]`, e);
          this.system('The game hit an error and was stopped. Sorry!');
        }
        this.finish(game);
      },
    );
  }

  // Host-only: abandon the running game and return everyone to the lobby.
  stop(m) {
    if (!this.isHost(m) || this.status !== 'playing') return;
    this.system(`${m.name} ended the game.`);
    this.game.abort();
    // Unblock a decision the engine is waiting on so it notices the abort.
    for (const x of this.members) if (x.pending) this.delegate(x);
  }

  finish(game) {
    if (this.game !== game) return;
    this.game = null;
    this.status = 'lobby';
    this.waitingFor = null;
    for (const m of this.members) {
      clearTimeout(m.pending?.timer);
      m.pending = null;
      m.seat = -1;
      m.away = false;
    }
    this.members = this.members.filter((m) => !m.left);
    // Spectators who joined mid-game take bots' places for the next one.
    while (this.members.length > MAX_PLAYERS) {
      const bot = this.members.findLast((m) => m.kind === 'bot');
      if (!bot) break;
      this.remove(bot);
    }
    this.fixHost();
    this.broadcast({ type: 'lobby' });
    this.broadcastRoom();
    this.checkEmpty();
  }

  onGameEvent(game, type, data) {
    if (this.game !== game) return;
    switch (type) {
      case 'state':
        for (const m of this.humans) this.sendState(m);
        break;
      case 'log':
        this.log.push(data);
        if (this.log.length > LOG_KEEP) this.log.shift();
        this.broadcast({ type: 'log', ...data });
        break;
      case 'toast':
        this.broadcast({ type: 'toast', ...data });
        break;
      case 'turn':
        this.broadcast({ type: 'turn', playerId: data.player.id, what: data.what ?? null });
        break;
      // Judgement: a round's scores.
      case 'round':
        this.broadcast({ type: 'round', round: data.round, results: data.results });
        break;
      case 'gameover': {
        const w = data.winner;
        if (game.kind === 'judgement') {
          this.broadcast({ type: 'gameover', winnerId: w.id, winnerIds: data.winners.map((p) => p.id) });
          break;
        }
        const sets = new Set(w.piles.filter(R.isComplete).map((p) => p.color)).size;
        this.broadcast({ type: 'gameover', winnerId: w.id, stats: `Finished on turn ${game.state.turn} with ${sets} complete sets.` });
        break;
      }
    }
  }

  viewerFor(m) {
    return m.seat >= 0 ? this.viewers[m.seat] : this.spectator;
  }

  // `gameNo` lets a reconnecting client keep its table; `reqId` is the decision
  // still waiting on this player, so the client can drop a stale prompt.
  sendGame(m) {
    const seats = this.members.filter((x) => x.seat >= 0).sort((a, b) => a.seat - b.seat);
    m.conn?.send({ type: 'game', kind: this.kind, gameNo: this.gameNo, you: m.seat, reqId: m.pending?.id ?? null, seats: seats.map((s) => ({ id: s.id, name: s.name })) });
  }

  sendState(m) {
    if (!m.conn || !this.game) return;
    m.conn.send({ type: 'state', ...this.viewerFor(m).snapshot(this.game, m.known) });
  }

  // ---------- remote decisions ----------

  ask(m, kind, args, fallback, parse) {
    if (m.away || this.status !== 'playing') return fallback();
    return new Promise((resolve) => {
      const ms = TIMEOUTS[kind] * 1000;
      const req = { id: ++this.reqSeq, kind, args, parse, resolve, fallback, deadline: Date.now() + ms };
      req.timer = setTimeout(() => {
        if (m.pending !== req) return;
        // A slow answer to a side prompt is covered once; a missed turn, or two
        // misses in a row, means they've stepped away.
        if (kind === 'turn' || ++m.misses >= 2) {
          m.away = true;
          this.system(`${m.name} ran out of time — a bot is playing for them until they’re back.`);
        } else {
          m.conn?.send({ type: 'toast', text: 'Time’s up — the bot answered that one for you.', kind: 'warn' });
        }
        this.delegate(m);
        this.broadcastRoom();
      }, ms);
      m.pending = req;
      this.waitingFor = { playerId: m.seat, kind, deadline: req.deadline };
      this.sendState(m);
      this.sendRequest(m);
      this.broadcast(this.waitingMessage());
    });
  }

  // Shows everyone else a decision `m` isn't really being asked: the same status and
  // clock as a real one, for about as long as a person takes to answer.
  async pretend(m, kind) {
    if (m.away || this.status !== 'playing') return m.ai.passJustSayNo?.();
    const send = (msg) => {
      for (const x of this.humans) if (x !== m) x.conn?.send(msg);
    };
    send({ type: 'waiting', playerId: m.seat, kind, remaining: TIMEOUTS[kind] * 1000 });
    await sleep((1500 + Math.random() * 2500) * this.timeScale);
    send(this.waitingMessage());
  }

  sendRequest(m) {
    const req = m.pending;
    m.conn?.send({ type: 'request', reqId: req.id, kind: req.kind, args: req.args, remaining: req.deadline - Date.now() });
  }

  waitingMessage() {
    const w = this.waitingFor;
    return w ? { type: 'waiting', playerId: w.playerId, kind: w.kind, remaining: w.deadline - Date.now() } : { type: 'waiting', playerId: null };
  }

  respond(m, reqId, value) {
    const req = m.pending;
    if (!req || req.id !== reqId) return;
    m.misses = 0;
    let parsed;
    try {
      parsed = req.parse(value);
    } catch {
      parsed = null;
    }
    this.settle(m, req, parsed);
  }

  settle(m, req, value) {
    clearTimeout(req.timer);
    m.pending = null;
    this.waitingFor = null;
    this.broadcast(this.waitingMessage());
    req.resolve(value);
  }

  // Let the bot answer whatever this player is being asked.
  delegate(m) {
    const req = m.pending;
    if (!req) return;
    m.conn?.send({ type: 'cancel', reqId: req.id });
    this.settle(m, req, req.fallback());
  }

  broadcast(msg) {
    for (const m of this.humans) m.conn?.send(msg);
  }

  broadcastRoom() {
    const room = {
      code: this.code,
      hostId: this.hostId,
      status: this.status,
      game: this.kind,
      speed: this.speed,
      max: MAX_PLAYERS,
      members: this.members.map((m) => ({
        id: m.id,
        name: m.name,
        kind: m.kind,
        connected: m.kind === 'bot' || !!m.conn,
        away: m.away,
        left: m.left,
        seat: m.seat,
        voice: m.voice ?? null,
      })),
    };
    this.broadcast({ type: 'room', room });
  }
}

// Engine controller for a human seat; translates between real card ids and the
// aliases that player's client knows.
class SeatController {
  constructor(room, member) {
    this.room = room;
    this.m = member;
  }

  get viewer() {
    return this.room.viewers[this.m.seat];
  }

  ids(value) {
    return Array.isArray(value) ? value.slice(0, 120).map((a) => this.viewer.real(a)) : null;
  }

  chooseTurnAction(game, me) {
    return this.room.ask(this.m, 'turn', {}, () => this.m.ai.chooseTurnAction(game, me), (v) => this.action(v));
  }

  choosePayment(game, me, amount, creditor, reason) {
    return this.room.ask(this.m, 'payment', { amount, creditorId: creditor.id, reason }, () => this.m.ai.choosePayment(game, me, amount), (v) => this.ids(v));
  }

  chooseJustSayNo(game, me, ctx) {
    const v = this.viewer;
    const args = {
      kind: ctx.kind,
      amount: ctx.amount ?? null,
      color: ctx.color ?? null,
      blocking: ctx.blocking,
      actorId: ctx.actor.id,
      targetId: ctx.target.id,
      card: v.visible(ctx.card),
      targetCard: v.visible(ctx.targetCard),
      giveCard: v.visible(ctx.giveCard),
      pileId: ctx.pile ? ctx.pile.id : null,
    };
    return this.room.ask(this.m, 'justsayno', args, () => this.m.ai.chooseJustSayNo(game, me, ctx), (x) => x === true);
  }

  // No Just Say No to play, so nothing to ask; the others still see them respond.
  passJustSayNo() {
    return this.room.pretend(this.m, 'justsayno');
  }

  chooseDiscards(game, me, count) {
    return this.room.ask(this.m, 'discard', { count }, () => this.m.ai.chooseDiscards(game, me, count), (v) => this.ids(v));
  }

  // Judgement. The engine checks the answers and has the bot decide if they won't do.
  chooseTrump(game, me) {
    return this.room.ask(this.m, 'trump', {}, () => this.m.ai.chooseTrump(game, me), (v) => (typeof v === 'string' ? v : null));
  }

  chooseBid(game, me, range) {
    return this.room.ask(this.m, 'bid', range, () => this.m.ai.chooseBid(game, me, range), (v) => (Number.isInteger(v) ? v : null));
  }

  choosePlay(game, me) {
    return this.room.ask(this.m, 'play', {}, () => this.m.ai.choosePlay(game, me), (v) => this.viewer.real(v));
  }

  // Rebuild a client's action from known fields only; the engine validates the rest.
  action(v) {
    if (!v || typeof v !== 'object' || !ACTION_KINDS.has(v.kind)) return { kind: 'end' };
    const real = (a) => this.viewer.real(a);
    const a = { kind: v.kind };
    if (v.cardId != null) a.cardId = real(v.cardId);
    if (typeof v.color === 'string') a.color = v.color;
    if (Number.isInteger(v.targetId)) a.targetId = v.targetId;
    if (Number.isInteger(v.pileId)) a.pileId = v.pileId;
    if (v.targetCardId != null) a.targetCardId = real(v.targetCardId);
    if (v.myCardId != null) a.myCardId = real(v.myCardId);
    if (Array.isArray(v.doubles)) a.doubles = v.doubles.slice(0, 2).map(real);
    return a;
  }
}
