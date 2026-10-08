// End-to-end check of the multiplayer server: headless clients create and join a
// room, then play whole games over real WebSockets using the AI on their mirrored
// (redacted) state, Monopoly Deal and then Judgement. Also checks that no client
// ever sees a hidden card.
// Usage: node scripts/online-smoke.mjs
import http from 'node:http';
import { WebSocket } from 'ws';
import { attachGameServer } from '../server/hub.js';
import { MirrorGame } from '../src/net/mirror.js';
import { JudgementMirror } from '../src/net/judgement-mirror.js';
import { AIController } from '../src/game/ai.js';
import { JudgementAI } from '../src/judgement/ai.js';

const server = http.createServer();
// Scripted clients answer instantly, far faster than the per-socket message limit allows.
attachGameServer(server, { timeScale: 0, log: () => {}, limits: { messages: Infinity, roomEntries: Infinity } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `ws://127.0.0.1:${server.address().port}/ws`;

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

class Client {
  constructor(name) {
    this.name = name;
    this.clientId = `${name}-${Math.random().toString(36).slice(2)}`;
    this.ai = new AIController();
    this.jai = new JudgementAI();
    this.handlers = [];
    this.turns = [];
    this.rounds = [];
    this.requests = 0;
    this.snapshots = 0;
  }

  connect() {
    everyone.add(this);
    this.ws = new WebSocket(url);
    this.ws.on('message', (data) => this.onMessage(JSON.parse(data)));
    return new Promise((r) => this.ws.once('open', r));
  }

  send(type, data = {}) {
    this.ws.send(JSON.stringify({ type, ...data }));
  }

  // Resolves with the first message of `type` matching `pred`.
  next(type, pred = () => true, ms = 60_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name}: timed out waiting for ${type}`)), ms);
      this.handlers.push({ type, pred, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  }

  async onMessage(msg) {
    for (const h of this.handlers.slice()) {
      if (h.type === msg.type && h.pred(msg)) {
        this.handlers.splice(this.handlers.indexOf(h), 1);
        h.resolve(msg);
      }
    }
    switch (msg.type) {
      case 'hello':
        this.iceServers = msg.iceServers;
        break;
      case 'joined':
        this.memberId = msg.you;
        this.code = msg.code;
        break;
      case 'room':
        this.room = msg.room;
        break;
      case 'log':
        if (msg.text.includes('shuffled into a new deck')) reshuffles++;
        break;
      case 'waiting':
        if (msg.kind === 'justsayno' && msg.playerId !== this.mirror?.you) this.sawResponse(msg.playerId);
        break;
      case 'game':
        this.kind = msg.kind;
        this.mirror = msg.kind === 'judgement' ? new JudgementMirror(msg.seats, msg.you) : new MirrorGame(msg.seats, msg.you);
        this.turns = [];
        this.rounds = [];
        break;
      case 'turn':
        this.turns.push(msg.what);
        break;
      case 'round':
        this.rounds.push(msg);
        break;
      case 'state':
        this.mirror.apply(msg);
        this.snapshots++;
        this.checkHidden();
        break;
      case 'request':
        this.requests++;
        this.send('response', { reqId: msg.reqId, value: await this.answer(msg) });
        break;
      case 'error':
        if (!this.expectError) fail(`${this.name} got error: ${msg.message}`);
        break;
    }
  }

  answer({ kind, args }) {
    const g = this.mirror;
    const me = g.me;
    switch (kind) {
      case 'turn': return this.ai.chooseTurnAction(g, me);
      case 'payment': return this.ai.choosePayment(g, me, args.amount);
      case 'justsayno': return this.ai.chooseJustSayNo(g, me, g.justSayNoContext(args));
      case 'discard': return this.ai.chooseDiscards(g, me, args.count);
      case 'trump': return this.jai.chooseTrump(g, me);
      case 'bid': return this.jai.chooseBid(g, me, args);
      case 'play': return this.jai.choosePlay(g, me);
    }
    fail(`unknown request ${kind}`);
  }

  // Another player is responding to an action: tally whether they really hold a Just
  // Say No (from their own client), since everyone should see it either way.
  sawResponse(seat) {
    const target = [...everyone].find((c) => c !== this && c.code === this.code && c.ws.readyState === 1 && c.mirror?.you === seat);
    if (!target) return;
    const { players } = target.mirror.state;
    responses[players[seat].hand.some((c) => c.action === 'justsayno') ? 'holding' : 'without']++;
  }

  checkHidden() {
    if (this.kind === 'judgement') return this.checkHiddenJudgement();
    const { state, you } = this.mirror;
    for (const c of state.deck) if (!c.hidden || c.key) fail(`${this.name} can see a deck card`);
    for (const p of state.players) {
      for (const c of p.hand) {
        if (p.id === you && c.hidden) fail(`${this.name} can't see their own card`);
        if (p.id !== you && (!c.hidden || c.key)) fail(`${this.name} can see ${p.name}'s hand`);
      }
      for (const c of [...p.bank, ...p.piles.flatMap((x) => x.cards)]) if (c.hidden) fail(`${this.name} is missing a table card`);
    }
    const total = this.mirror.cards.size;
    if (total !== 106) fail(`${this.name} tracks ${total} cards`);
  }

  // Judgement: only your own hand and the cards played are face up.
  checkHiddenJudgement() {
    const { state, you } = this.mirror;
    for (const c of state.deck) if (!c.hidden || c.key) fail(`${this.name} can see a set-aside card`);
    for (const p of state.players) {
      for (const c of p.hand) {
        if (p.id === you && c.hidden) fail(`${this.name} can't see their own card`);
        if (p.id !== you && (!c.hidden || c.key)) fail(`${this.name} can see ${p.name}'s hand`);
      }
      for (const c of p.tricks) if (c.hidden) fail(`${this.name} is missing a won card`);
    }
    for (const t of state.trick) if (t.card.hidden) fail(`${this.name} is missing a played card`);
    const total = this.mirror.cards.size;
    if (total !== 52) fail(`${this.name} tracks ${total} cards`);
  }
}

// Messages from one socket are handled in order, so the bots exist before 'start'.
async function playRound(clients, addBots = 0) {
  const [host] = clients;
  for (let i = 0; i < addBots; i++) host.send('addBot');
  const games = clients.map((c) => c.next('game'));
  const overs = clients.map((c) => c.next('gameover', () => true, 120_000));
  const lobbies = clients.map((c) => c.next('lobby', () => true, 120_000));
  for (const c of clients) c.requests = 0;
  host.send('start');
  const [game] = await Promise.all(games);
  const results = await Promise.all(overs);
  await Promise.all(lobbies);
  const winner = game.seats[results[0].winnerId];
  if (results.some((r) => r.winnerId !== results[0].winnerId)) fail('clients disagree on the winner');
  if (!winner) fail('no winner');
  if (clients.some((c) => !c.requests)) fail('a player was never asked anything');
  let how = results[0].stats;
  if (game.kind === 'judgement') {
    const ids = results[0].winnerIds;
    if (!ids?.includes(results[0].winnerId)) fail('Judgement winners missing');
    if (clients.some((c) => c.rounds.length !== game.seats.length)) fail('round scores missing');
    if (clients.some((c) => !c.turns.includes('trump') || !c.turns.includes('bid') || !c.turns.includes('play'))) fail('turn kinds missing');
    const scores = clients[0].rounds.at(-1).results.map((r) => r.score);
    how = `${ids.length > 1 ? 'shared, ' : ''}scores ${scores.join('/')}`;
  }
  console.log(`  ${game.kind}: ${game.seats.map((x) => x.name).join(', ')}: ${winner.name} won (${how}); requests ${clients.map((c) => c.requests).join('/')}`);
  return game;
}

let reshuffles = 0;
const everyone = new Set();
const responses = { holding: 0, without: 0 };
const alice = new Client('Alice');
const bob = new Client('Bob');
const cara = new Client('Cara');
for (const c of [alice, bob, cara]) await c.connect();

const aliceJoined = alice.next('joined');
alice.send('create', { name: 'Alice', clientId: alice.clientId });
await aliceJoined;
console.log(`room ${alice.code}`);

bob.expectError = true;
const bobError = bob.next('error');
bob.send('join', { code: 'ZZZZ', name: 'Bob', clientId: bob.clientId });
await bobError;
bob.expectError = false;

const twoMembers = alice.next('room', (m) => m.room.members.length === 2);
const bobJoined = bob.next('joined');
bob.send('join', { code: alice.code.toLowerCase(), name: '<b>Bob</b>', clientId: bob.clientId });
await bobJoined;
await twoMembers;
const bobName = alice.room.members.find((m) => m.id === bob.memberId).name;
if (bobName !== 'bBob/b') fail(`name not sanitised: ${bobName}`);

const chatP = bob.next('chat', (m) => m.text === 'hi bob');
alice.send('chat', { text: 'hi bob' });
const chat = await chatP;
if (chat.name !== 'Alice') fail('chat sender wrong');

// Voice chat: the room lists who's in it, and passes connection offers only
// between members who are.
if (!alice.iceServers?.length) fail('no ICE servers sent');
const offer = { sid: 'abc', sdp: { type: 'offer', sdp: 'v=0' } };
const notRelayed = bob.next('rtc', () => true, 300).then(() => fail('offer reached a member not in voice'), () => {});
alice.send('voice', { on: true, muted: false });
alice.send('rtc', { to: bob.memberId, data: offer });
await notRelayed;
const bothIn = alice.next('room', (m) => m.room.members.every((x) => x.voice));
bob.send('voice', { on: true, muted: true });
await bothIn;
if (alice.room.members.find((x) => x.id === bob.memberId).voice !== 'muted') fail('muted mic not listed');
const relayed = bob.next('rtc');
alice.send('rtc', { to: bob.memberId, data: { ...offer, extra: 'x' } });
const rtc = await relayed;
if (rtc.from !== alice.memberId || rtc.data.sdp.sdp !== 'v=0' || rtc.data.extra) fail('offer not passed on cleanly');
const bothOut = alice.next('room', (m) => !m.room.members.some((x) => x.voice));
alice.send('voice', { on: false });
bob.send('voice', { on: false });
await bothOut;
console.log('  voice chat: offers passed between members in voice only');

// Non-hosts can't start or add bots.
bob.send('addBot');
bob.send('start');
await new Promise((r) => setTimeout(r, 200));
if (alice.room.members.length !== 2 || alice.room.status !== 'lobby') fail('non-host controlled the lobby');

await playRound([alice, bob], 0);
await playRound([alice, bob], 2);

// Cara joins a full table (2 humans + 3 bots) and bumps a bot.
await playRound([alice, bob], 1);
const caraJoined = cara.next('joined');
cara.send('join', { code: alice.code, name: 'Cara', clientId: cara.clientId });
await caraJoined;
const bumped = alice.next('room', (m) => m.room.members.some((x) => x.name === 'Cara'));
if ((await bumped).room.members.length !== 5) fail('Cara did not bump a bot');
const kicked = alice.next('room', (m) => !m.room.members.some((x) => x.kind === 'bot'));
for (const m of alice.room.members.filter((x) => x.kind === 'bot')) alice.send('kick', { id: m.id });
await kicked;
await playRound([alice, bob, cara]);

// Reconnect: Bob drops mid-game and comes back to the same seat.
const over = [alice, cara].map((c) => c.next('gameover', () => true, 120_000));
const bobPlaying = bob.next('request');
alice.send('start');
await bobPlaying;
bob.ws.terminate();
const bob2 = new Client('Bob');
bob2.clientId = bob.clientId;
await bob2.connect();
const rejoined = bob2.next('joined');
const regame = bob2.next('game');
bob2.send('join', { code: alice.code, name: 'Bob', clientId: bob.clientId });
if ((await rejoined).you !== bob.memberId) fail('reconnect did not restore the seat');
await regame;
await Promise.all(over);
if (!bob2.requests) fail('reconnected player never got a request');
console.log(`  reconnect: Bob resumed his seat and answered ${bob2.requests} requests`);

// Long games run the deck dry; keep playing until a reshuffle has been seen.
for (let i = 0; i < 8 && !reshuffles; i++) await playRound([alice, bob2, cara], 2);
if (!reshuffles) fail('no deck reshuffle happened, so hidden aliases were not exercised');
console.log(`  ${reshuffles} reshuffle log lines seen across clients`);
// Players without a Just Say No still seem to respond, so others can't tell who has one.
if (!responses.without) fail('nobody saw a player without a Just Say No respond to an action');
console.log(`  Just Say No moments seen by others: ${responses.holding} holding one, ${responses.without} without`);

// Judgement: only the host picks the game, and only in the lobby.
const clients = [alice, bob2, cara];
bob2.send('game', { game: 'judgement' });
await new Promise((r) => setTimeout(r, 200));
if (alice.room.game !== 'deal') fail('non-host changed the game');
const toJudgement = alice.next('room', (m) => m.room.game === 'judgement');
alice.send('game', { game: 'judgement' });
await toJudgement;
if ((await playRound(clients)).kind !== 'judgement') fail('the game did not switch');
await playRound(clients, 2);
// A room can be created for Judgement straight away.
const dan = new Client('Dan');
await dan.connect();
const danRoom = dan.next('room');
dan.send('create', { name: 'Dan', clientId: dan.clientId, game: 'judgement' });
if ((await danRoom).room.game !== 'judgement') fail('new room ignored its game');
const danGame = dan.next('game');
dan.send('addBot');
await playRound([dan]);
if ((await danGame).kind !== 'judgement') fail('wrong game in a new Judgement room');

console.log('PASS');
process.exit(0);
