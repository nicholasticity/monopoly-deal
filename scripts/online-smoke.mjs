// End-to-end check of the multiplayer server: headless clients create and join a
// room, then play whole games over real WebSockets using the AI on their mirrored
// (redacted) state: Monopoly Deal, then Call Bridge, Judgement, Bingo, Wordle, Sudoku, Least Count and Pool. Also
// checks that no client ever sees a hidden card (or someone else's Bingo grid, Wordle letters or
// Sudoku numbers).
// Usage: node scripts/online-smoke.mjs
import http from 'node:http';
import { WebSocket } from 'ws';
import { attachGameServer } from '../server/hub.js';
import { MAX_PLAYERS } from '../src/game/settings.js';
import { MirrorGame } from '../src/net/mirror.js';
import { TrickMirror } from '../src/net/trick-mirror.js';
import { AIController } from '../src/game/ai.js';
import { CallBridgeAI } from '../src/callbridge/ai.js';
import { JudgementAI } from '../src/judgement/ai.js';
import { handSizes, roundPoints, validBid } from '../src/judgement/rules.js';
import { BingoMirror } from '../src/net/bingo-mirror.js';
import { BingoAI } from '../src/bingo/ai.js';
import { completedLines, TO_WIN } from '../src/bingo/rules.js';
import { WordleMirror } from '../src/net/wordle-mirror.js';
import { WordleAI } from '../src/wordle/ai.js';
import { mark as markGuess, MAX_GUESSES } from '../src/wordle/rules.js';
import { PoolMirror } from '../src/net/pool-mirror.js';
import { PoolAI } from '../src/pool/ai.js';
import { SudokuMirror } from '../src/net/sudoku-mirror.js';
import { SudokuAI } from '../src/sudoku/ai.js';
import { MAX_MISTAKES } from '../src/sudoku/rules.js';
import { LeastCountMirror } from '../src/net/leastcount-mirror.js';
import { LeastCountAI } from '../src/leastcount/ai.js';
import { showPoints, throwKind } from '../src/leastcount/rules.js';

const MIRRORS = { leastcount: LeastCountMirror, deal: MirrorGame, callbridge: TrickMirror, judgement: TrickMirror, bingo: BingoMirror, wordle: WordleMirror, pool: PoolMirror, sudoku: SudokuMirror };

const server = http.createServer();
// Scripted clients answer instantly, far faster than the per-socket message limit allows.
// Song titles come from a stand-in for YouTube: 'deadvideo00' is one it won't let other sites play.
const titleOf = async (id) => (id === 'deadvideo00' ? false : `Song ${id}`);
attachGameServer(server, { timeScale: 0, log: () => {}, limits: { messages: Infinity, roomEntries: Infinity }, titleOf });
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
    this.cbai = new CallBridgeAI();
    this.jai = new JudgementAI();
    this.bai = new BingoAI();
    this.wai = new WordleAI();
    this.pai = new PoolAI();
    this.sai = new SudokuAI();
    this.lai = new LeastCountAI();
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
      case 'music':
        this.musicQueue = msg.queue;
        break;
      case 'log':
        if (msg.text.includes('shuffled into a new deck')) reshuffles++;
        break;
      case 'waiting':
        if (msg.kind === 'justsayno' && msg.playerId !== this.mirror?.you) this.sawResponse(msg.playerId);
        break;
      case 'game':
        this.kind = msg.kind;
        this.mirror = new MIRRORS[msg.kind](msg.seats, msg.you, msg.kind);
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
      case 'trump': return this.cbai.chooseTrump(g, me);
      case 'bid':
        if (this.kind !== 'judgement') return this.cbai.chooseBid(g, me, args);
        // Judgement: only the dealer can have a ruled-out bid (none when the others' bids
        // are already over the tricks), and it's the one that makes them add up.
        if (args.forbidden != null) {
          const others = g.state.players.reduce((s, p) => s + (p.bid ?? 0), 0);
          if (me.id !== g.state.den) fail('a player other than the dealer has a ruled-out bid');
          if (others + args.forbidden !== me.hand.length) fail('the dealer\'s ruled-out bid is wrong');
        }
        return this.jai.chooseBid(g, me, args);
      case 'play': return this.cbai.choosePlay(g, me);
      case 'arrange': return this.bai.arrangeGrid(g, me, args);
      case 'call': return this.bai.chooseCall(g, me);
      case 'guess': return this.wai.chooseGuess(g, me);
      case 'shot': return this.pai.chooseShot(g, me, args);
      case 'cell': return this.sai.chooseMove(g, me);
      case 'throw': {
        const move = this.lai.chooseThrow(g, me);
        return move.then((m) => {
          if (!m.show && !throwKind(m.throw.map((id) => me.hand.find((c) => c.id === id)))) fail('a client made an illegal throw');
          // Now and then something that won't do: the server has the bot play instead.
          return Math.random() < 0.02 ? { throw: [123456], take: 'deck' } : m;
        });
      }
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

  // Least Count: only your own hand until a Show, then every hand; thrown cards and the
  // wild card face up; the deck always face down.
  checkHiddenLeastCount() {
    const { state, you } = this.mirror;
    const open = ['show', 'scoring', 'over'].includes(state.phase);
    for (const c of state.deck) if (!c.hidden) fail(`${this.name} can see a deck card`);
    for (const c of [...state.discard, ...(state.last?.cards ?? []), ...(state.wildCard ? [state.wildCard] : [])]) if (c.hidden) fail(`${this.name} can't see a thrown card`);
    for (const p of state.players) {
      for (const c of p.hand) {
        if (p.id === you || open) {
          if (c.hidden) fail(`${this.name} can't see a card they should`);
        } else if (!c.hidden || c.key) fail(`${this.name} can see ${p.name}'s hand`);
      }
      if (!open && p.total != null) fail(`${this.name} was told ${p.name}'s total`);
    }
  }

  checkHiddenSudoku() {
    checkSudoku(this);
  }

  checkHidden() {
    if (this.kind === 'callbridge' || this.kind === 'judgement') return this.checkHiddenTricks();
    if (this.kind === 'bingo') return this.checkHiddenBingo();
    if (this.kind === 'wordle') return this.checkHiddenWordle();
    if (this.kind === 'sudoku') return this.checkHiddenSudoku();
    if (this.kind === 'leastcount') return this.checkHiddenLeastCount();
    // Nothing is hidden at the pool table: just all sixteen balls.
    if (this.kind === 'pool') return this.mirror.state.balls.length === 16 || fail(`${this.name} sees ${this.mirror.state.balls.length} balls`);
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

  // Call Bridge and Judgement: only your own hand and the cards played are face up.
  checkHiddenTricks() {
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

  // Bingo: only your own grid, until the game is over and every grid is shown.
  checkHiddenBingo() {
    const { state, you } = this.mirror;
    const over = state.phase === 'over';
    for (const p of state.players) {
      if (p.id === you && state.phase !== 'setup' && !p.grid) fail(`${this.name} can't see their own grid`);
      if (p.id !== you && !over && p.grid) fail(`${this.name} can see ${p.name}'s grid`);
      if (over && !p.grid) fail(`${this.name} can't see ${p.name}'s grid after the game`);
    }
  }

  // Wordle: while a word is on, your own letters and only the others' marks, and not
  // the word itself; once it's over, everything.
  checkHiddenWordle() {
    const { state, you } = this.mirror;
    const open = state.phase === 'reveal' || state.phase === 'over';
    if (state.phase === 'guess' && state.answer) fail(`${this.name} was sent the word`);
    if (state.phase === 'reveal' && !state.answer) fail(`${this.name} wasn't shown the word`);
    for (const p of state.players) {
      if (p.guesses.length > MAX_GUESSES) fail(`${p.name} has too many guesses`);
      for (const g of p.guesses) {
        if (!/^[gyb]{5}$/.test(g.mark)) fail(`${this.name} got a bad mark`);
        if (p.id === you || open) {
          if (!g.word) fail(`${this.name} can't see a guess they should`);
          if (open && state.answer && markGuess(g.word, state.answer) !== g.mark) fail('a guess was marked wrong');
        } else if (g.word) fail(`${this.name} can see ${p.name}'s letters`);
      }
    }
  }
}

// Sudoku: while the race is on, your own numbers and only which cells the others have
// filled, and not the answer; once it's over, everything. Only right numbers go in.
function checkSudoku(client) {
  const { state, you } = client.mirror;
  const over = state.phase === 'over';
  if (!over && state.solution) fail(`${client.name} was sent the answer`);
  if (over && !state.solution) fail(`${client.name} wasn't shown the answer`);
  for (const p of state.players) {
    const filled = p.grid.filter(Boolean).length;
    if (p.id === you || over) {
      if (filled !== p.filled) fail(`${client.name} sees the wrong count for ${p.name}`);
      if (over && p.grid.some((d, i) => d && d !== state.solution[i])) fail(`a wrong number went into ${p.name}'s grid`);
      if (p.grid.some((d, i) => d && state.puzzle[i])) fail('a number went over a given one');
    } else {
      if (filled) fail(`${client.name} can see ${p.name}'s numbers`);
      if (p.mask?.length !== 81 || [...p.mask].filter((x) => x === '1').length !== p.filled) fail(`${client.name} got a bad mask for ${p.name}`);
    }
    if (p.id !== you && p.wrong) fail(`${client.name} can see ${p.name}'s mistakes' numbers`);
    if (state.limited && p.mistakes > MAX_MISTAKES) fail(`${p.name} kept going past ${MAX_MISTAKES} mistakes`);
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
  if (game.kind === 'callbridge') {
    const ids = results[0].winnerIds;
    if (!ids?.includes(results[0].winnerId)) fail('Call Bridge winners missing');
    if (clients.some((c) => c.rounds.length !== game.seats.length)) fail('round scores missing');
    if (clients.some((c) => !c.turns.includes('trump') || !c.turns.includes('bid') || !c.turns.includes('play'))) fail('turn kinds missing');
    const scores = clients[0].rounds.at(-1).results.map((r) => r.score);
    how = `${ids.length > 1 ? 'shared, ' : ''}scores ${scores.join('/')}`;
  }
  if (game.kind === 'judgement') {
    const ids = results[0].winnerIds;
    const n = game.seats.length;
    const sizes = handSizes(n);
    const { scoring } = clients[0].mirror.state;
    if (!ids?.includes(results[0].winnerId)) fail('Judgement winners missing');
    if (clients.some((c) => c.rounds.length !== sizes.length)) fail(`played ${clients[0].rounds.length} rounds, expected ${sizes.length}`);
    if (clients.some((c) => c.turns.includes('trump') || !c.turns.includes('bid') || !c.turns.includes('play'))) fail('turn kinds wrong');
    clients[0].rounds.forEach((r, i) => {
      if (r.results.reduce((s, x) => s + x.bid, 0) === sizes[i]) fail(`round ${i + 1}: bids add up to the tricks`);
      if (r.results.reduce((s, x) => s + x.won, 0) !== sizes[i]) fail(`round ${i + 1}: tricks don't add up`);
      for (const x of r.results) if (!validBid(x.bid, sizes[i]) || x.points !== roundPoints(x.bid, x.won, scoring)) fail(`round ${i + 1}: wrong points`);
    });
    const scores = clients[0].rounds.at(-1).results.map((r) => r.score);
    how = `${scoring} scoring, ${ids.length > 1 ? 'shared, ' : ''}scores ${scores.join('/')}`;
  }
  if (game.kind === 'bingo') {
    const ids = results[0].winnerIds;
    if (!ids?.includes(results[0].winnerId)) fail('Bingo winners missing');
    if (clients.some((c) => !c.turns.includes('arrange') || !c.turns.includes('call'))) fail('turn kinds missing');
    // Every winner really has five lines on the numbers called, and nobody else does.
    const { players, called } = clients[0].mirror.state;
    for (const p of players) {
      const done = completedLines(p.grid, called).length >= TO_WIN;
      if (done !== ids.includes(p.id)) fail(`${p.name}'s grid doesn't match the result`);
    }
    how = `${ids.length > 1 ? 'shared, ' : ''}${called.length} calls`;
  }
  if (game.kind === 'pool') {
    const ids = results[0].winnerIds;
    const { state } = clients[0].mirror;
    const team = state.players[ids[0]].team;
    if (ids.length !== game.seats.length / 2 || ids.some((id) => state.players[id].team !== team)) fail('wrong pool winners');
    if (!state.balls.find((b) => b.id === 8).potted) fail('the pool game ended with the 8 still up');
    how = `${game.seats.length === 4 ? '2 vs 2, ' : ''}${state.shots} shots`;
  }
  if (game.kind === 'leastcount') {
    const ids = results[0].winnerIds;
    const { state } = clients[0].mirror;
    if (clients.some((c) => c.rounds.length !== state.rounds)) fail(`played ${clients[0].rounds.length} of ${state.rounds} rounds`);
    if (clients.some((c) => !c.turns.includes('throw'))) fail('turn kinds missing');
    // Every Show scored by the rules, the totals adding up, and the lowest winning.
    for (const r of clients[0].rounds) {
      const totals = Object.fromEntries(r.results.map((x) => [x.id, x.total]));
      const { points, caught } = showPoints(totals, r.caller);
      if (caught !== r.caught || r.results.some((x) => x.points !== points[x.id])) fail('a Show was scored wrong');
    }
    for (const p of state.players) if (p.score !== p.history.reduce((t, h) => t + h.points, 0)) fail(`${p.name}'s score is off`);
    const low = Math.min(...state.players.map((p) => p.score));
    if (state.players.some((p) => (p.score === low) !== ids.includes(p.id))) fail('wrong Least Count winners');
    const caughtN = clients[0].rounds.filter((r) => r.caught).length;
    how = `${state.rounds} rounds, ${caughtN} Show${caughtN === 1 ? '' : 's'} caught, scores ${state.players.map((p) => p.score).join('/')}`;
  }
  if (game.kind === 'sudoku') {
    const ids = results[0].winnerIds ?? [];
    const { state } = clients[0].mirror;
    if (clients.some((c) => !c.turns.includes('solve'))) fail('turn kinds missing');
    const w = state.players.find((p) => p.solved);
    if (w ? ids.length !== 1 || ids[0] !== w.id || w.filled !== state.empty : ids.length) fail('wrong Sudoku winner');
    if (state.players.filter((p) => p.solved).length > 1) fail('more than one Sudoku winner');
    for (const c of clients) checkSudoku(c);
    how = `${state.level}, ${state.empty} cells, ${state.players.map((p) => `${p.filled}${p.mistakes ? `✕${p.mistakes}` : ''}`).join('/')}`;
  }
  if (game.kind === 'wordle') {
    const ids = results[0].winnerIds;
    if (!ids?.includes(results[0].winnerId)) fail('Wordle winners missing');
    if (clients.some((c) => !c.turns.includes('guess'))) fail('turn kinds missing');
    const { players, history, rounds } = clients[0].mirror.state;
    if (history.length !== rounds) fail(`played ${history.length} of ${rounds} words`);
    // Scores add up to the words won, and the winners have the most.
    for (const p of players) if (p.score !== history.filter((h) => h.winner === p.id).length) fail(`${p.name}'s score is off`);
    const best = Math.max(...players.map((p) => p.score));
    if (players.some((p) => (p.score === best) !== ids.includes(p.id))) fail('wrong Wordle winners');
    how = `${ids.length > 1 ? 'shared, ' : ''}scores ${players.map((p) => p.score).join('/')} over ${rounds} words`;
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

// Music: anyone queues YouTube songs, everyone gets the same queue and place, and only
// the song playing can be skipped (so two people skipping at once skip one song).
const music = (pred) => bob.next('music', pred);
const firstSong = music((m) => m.queue.length === 1 && m.queue[0].title === 'Song dQw4w9WgXcQ');
const addedLine = bob.next('chat', (m) => m.text.includes('Song dQw4w9WgXcQ'));
alice.send('music', { op: 'add', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10' });
const song1 = await firstSong;
if (!song1.playing || song1.queue[0].by !== 'Alice') fail('first song not playing');
await addedLine;
const notYT = alice.next('toast', (m) => m.text.includes('YouTube link'));
alice.send('music', { op: 'add', url: 'https://evil.example/watch?v=dQw4w9WgXcQ' });
await notYT;
const twoSongs = music((m) => m.queue.length === 2 && m.queue[1].title);
bob.send('music', { op: 'add', url: 'youtu.be/9bZkp7q19f0' });
await twoSongs;
const deadToast = bob.next('toast', (m) => m.text.includes('can’t be played'));
const deadGone = alice.next('music', (m) => m.queue.length === 2 && !m.queue.some((x) => x.vid === 'deadvideo00'));
bob.send('music', { op: 'add', url: 'deadvideo00' });
await Promise.all([deadToast, deadGone]);
const paused = music((m) => !m.playing);
bob.send('music', { op: 'pause' });
await paused;
const resumed = music((m) => m.playing);
alice.send('music', { op: 'play' });
await resumed;
const skipped = music((m) => m.queue.length === 1 && m.queue[0].vid === '9bZkp7q19f0');
alice.send('music', { op: 'skip', key: song1.queue[0].key });
bob.send('music', { op: 'skip', key: song1.queue[0].key });
const song2 = await skipped;
await new Promise((r) => setTimeout(r, 200));
if (alice.musicQueue?.length !== 1) fail('a second skip skipped another song');
// A playlist goes in at once, with one chat line; bad ids are ignored and songs YouTube
// won't let other sites play come out again, with one note.
const many = music((m) => m.queue.length === 4 && m.queue.every((x) => x.title));
const manyLine = bob.next('chat', (m) => m.text.includes('added 4 songs from a playlist'));
const manyDead = alice.next('toast', (m) => m.text.includes('1 song from the playlist'));
alice.send('music', { op: 'addMany', ids: ['aaaaaaaaaaa', 'deadvideo00', 'bbbbbbbbbbb', 'bad id!', 'ccccccccccc'] });
await Promise.all([many, manyLine, manyDead]);
// The talk button: while anyone holds it, everyone is told who (and the music goes down).
const talkOn = bob.next('music', (m) => m.talking?.length === 1 && m.talking[0].name === 'Alice');
alice.send('music', { op: 'talk', on: true });
await talkOn;
const talkOff = bob.next('music', (m) => Array.isArray(m.talking) && !m.talking.length);
alice.send('music', { op: 'talk', on: false });
await talkOff;
console.log('  music: a shared queue, titles, bad links refused, pause/play and one skip at a time, playlists, talk button');
// Left playing: Cara, joining later, hears it too.

// Non-hosts can't start or add bots.
bob.send('addBot');
bob.send('start');
await new Promise((r) => setTimeout(r, 200));
if (alice.room.members.length !== 2 || alice.room.status !== 'lobby') fail('non-host controlled the lobby');

await playRound([alice, bob], 0);
await playRound([alice, bob], 2);

// A full table (2 humans + 6 bots: eight seats) plays, then Cara joins and bumps a bot.
await playRound([alice, bob], MAX_PLAYERS - 4);
const caraJoined = cara.next('joined');
const caraMusic = cara.next('music', (m) => m.queue[0]?.key === song2.queue[0].key);
cara.send('join', { code: alice.code, name: 'Cara', clientId: cara.clientId });
await caraJoined;
const bumped = alice.next('room', (m) => m.room.members.some((x) => x.name === 'Cara'));
if ((await bumped).room.members.length !== MAX_PLAYERS) fail('Cara did not bump a bot');
await caraMusic;
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

// Claim: Cara drops and comes back from another device (a new client id) under the
// same name. A name whose player is still connected claims nothing.
const over2 = [alice, bob2].map((c) => c.next('gameover', () => true, 120_000));
const caraPlaying = cara.next('request');
alice.send('start');
await caraPlaying;
const caraGone = alice.next('room', (m) => !m.room.members.find((x) => x.id === cara.memberId).connected);
cara.ws.terminate();
await caraGone;
const eve = new Client('Eve');
await eve.connect();
const eveJoined = eve.next('joined');
eve.send('join', { code: alice.code, name: 'ALICE', clientId: eve.clientId });
if ((await eveJoined).you === alice.memberId) fail('a connected player’s seat was claimed');
eve.send('leave');
const cara2 = new Client('Cara');
await cara2.connect();
const claimed = cara2.next('joined');
const reclaimGame = cara2.next('game');
// Cara's game over too, so the next round doesn't hear this one's.
over2.push(cara2.next('gameover', () => true, 120_000));
cara2.send('join', { code: alice.code, name: 'cara', clientId: cara2.clientId });
if ((await claimed).you !== cara.memberId) fail('the same name did not claim the dropped seat');
if ((await reclaimGame).you < 0) fail('the claimed seat came back as a spectator');
await Promise.all(over2);
if (!cara2.requests) fail('the player who claimed a seat never got a request');
console.log(`  claim: Cara took her seat back from a new device and answered ${cara2.requests} requests`);

// Long games run the deck dry; keep playing until a reshuffle has been seen.
for (let i = 0; i < 8 && !reshuffles; i++) await playRound([alice, bob2, cara2], 2);
if (!reshuffles) fail('no deck reshuffle happened, so hidden aliases were not exercised');
console.log(`  ${reshuffles} reshuffle log lines seen across clients`);
// Players without a Just Say No still seem to respond, so others can't tell who has one.
if (!responses.without) fail('nobody saw a player without a Just Say No respond to an action');
console.log(`  Just Say No moments seen by others: ${responses.holding} holding one, ${responses.without} without`);

// Call Bridge: only the host picks the game, and only in the lobby.
const clients = [alice, bob2, cara2];
bob2.send('game', { game: 'callbridge' });
await new Promise((r) => setTimeout(r, 200));
if (alice.room.game !== 'deal') fail('non-host changed the game');
const toCallBridge = alice.next('room', (m) => m.room.game === 'callbridge');
alice.send('game', { game: 'callbridge' });
await toCallBridge;
if ((await playRound(clients)).kind !== 'callbridge') fail('the game did not switch');
await playRound(clients, 2);
// A room can be created for Call Bridge straight away.
const dan = new Client('Dan');
await dan.connect();
const danRoom = dan.next('room');
dan.send('create', { name: 'Dan', clientId: dan.clientId, game: 'callbridge' });
if ((await danRoom).room.game !== 'callbridge') fail('new room ignored its game');
const danGame = dan.next('game');
dan.send('addBot');
await playRound([dan]);
if ((await danGame).kind !== 'callbridge') fail('wrong game in a new Call Bridge room');

// Judgement: only the host sets the scoring, and the game plays by it.
const toJudgement = alice.next('room', (m) => m.room.game === 'judgement');
alice.send('game', { game: 'judgement' });
await toJudgement;
if (alice.room.scoring !== 'high') fail('Judgement should start on high scoring');
bob2.send('scoring', { scoring: 'low' });
alice.send('scoring', { scoring: 'nonsense' });
await new Promise((r) => setTimeout(r, 200));
if (alice.room.scoring !== 'high') fail('the scoring changed when it should not have');
await playRound(clients);
const toMedium = alice.next('room', (m) => m.room.scoring === 'medium');
alice.send('scoring', { scoring: 'medium' });
await toMedium;
if ((await playRound(clients, 2)).kind !== 'judgement') fail('the game did not switch to Judgement');
if (clients[0].mirror.state.scoring !== 'medium') fail('the game ignored the scoring');

// Bingo: everyone arranges at once, then calls in turn.
const toBingo = alice.next('room', (m) => m.room.game === 'bingo');
alice.send('game', { game: 'bingo' });
await toBingo;
// The two bots from the Call Bridge and Judgement rounds are still seated; then just the three of them.
for (let i = 0; i < 4; i++) {
  if (i === 2) {
    const noBots = alice.next('room', (m) => !m.room.members.some((x) => x.kind === 'bot'));
    for (const m of alice.room.members.filter((x) => x.kind === 'bot')) alice.send('kick', { id: m.id });
    await noBots;
  }
  if ((await playRound(clients)).kind !== 'bingo') fail('the game did not switch to Bingo');
}

// Wordle: everyone races on the same word. Only the host sets how many words.
const toWordle = alice.next('room', (m) => m.room.game === 'wordle');
alice.send('game', { game: 'wordle' });
await toWordle;
bob2.send('words', { words: 20 });
alice.send('words', { words: 7 });
await new Promise((r) => setTimeout(r, 200));
if (alice.room.words !== 10) fail('the word count changed when it should not have');
const fiveWords = alice.next('room', (m) => m.room.words === 5);
alice.send('words', { words: 5 });
await fiveWords;
await playRound(clients);
await playRound(clients, 2);

// Sudoku: everyone races on the same puzzle. Only the host sets the level.
const toSudoku = alice.next('room', (m) => m.room.game === 'sudoku');
alice.send('game', { game: 'sudoku' });
if ((await toSudoku).room.level !== 'medium') fail('Sudoku should start at medium');
bob2.send('level', { level: 'hard' });
alice.send('level', { level: 'impossible' });
await new Promise((r) => setTimeout(r, 200));
if (alice.room.level !== 'medium') fail('the level changed when it should not have');
const easy = alice.next('room', (m) => m.room.level === 'easy');
alice.send('level', { level: 'easy' });
await easy;
await playRound(clients);
const hard = alice.next('room', (m) => m.room.level === 'hard');
alice.send('level', { level: 'hard' });
await hard;
await playRound(clients);

// Least Count: rounds of throwing and calling Show. Only the host sets how many rounds.
const toLeastCount = alice.next('room', (m) => m.room.game === 'leastcount');
alice.send('game', { game: 'leastcount' });
if ((await toLeastCount).room.rounds !== 10) fail('Least Count should start at 10 rounds');
bob2.send('rounds', { rounds: 15 });
alice.send('rounds', { rounds: 7 });
await new Promise((r) => setTimeout(r, 200));
if (alice.room.rounds !== 10) fail('the round count changed when it should not have');
const fiveRounds = alice.next('room', (m) => m.room.rounds === 5);
alice.send('rounds', { rounds: 5 });
await fiveRounds;
await playRound(clients);

// Pool: two play, or four as two teams; anyone else watches. Three humans and two bots
// make two teams of two (a bot sits out); then without the bots, two play and Cara watches.
const toPool = alice.next('room', (m) => m.room.game === 'pool');
alice.send('game', { game: 'pool' });
const poolRoom = (await toPool).room;
if (poolRoom.max !== 4 || poolRoom.seats !== 4) fail(`pool should seat 4 of 5 (got ${poolRoom.seats} of max ${poolRoom.max})`);
if ((await playRound(clients)).seats.length !== 4) fail('pool did not seat two teams');
const poolBotsGone = alice.next('room', (m) => !m.room.members.some((x) => x.kind === 'bot'));
for (const m of alice.room.members.filter((x) => x.kind === 'bot')) alice.send('kick', { id: m.id });
await poolBotsGone;
if (alice.room.seats !== 2) fail('three in a pool room should be two players and one watching');
const caraWatches = cara2.next('game');
cara2.requests = 0;
await playRound([alice, bob2]);
if ((await caraWatches).you !== -1) fail('Cara should have watched');
if (cara2.requests) fail('the player watching was asked to shoot');

console.log('PASS');
process.exit(0);
