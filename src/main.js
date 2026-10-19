import './style.css';
import { TableView } from './render/view.js';
import { TrickView } from './render/trick-view.js';
import { BingoView } from './render/bingo-view.js';
import { WordleView } from './render/wordle-view.js';
import { PoolView } from './render/pool-view.js';
import { Hud } from './ui/hud.js';
import { HumanController } from './ui/human.js';
import { TrickHuman, trickStatus, gameInfo, gameResult, scoreTable, turnToast } from './ui/tricks.js';
import * as BingoUI from './ui/bingo.js';
import * as WordleUI from './ui/wordle.js';
import * as PoolUI from './ui/pool.js';
import { PoolGame } from './pool/engine.js';
import { PoolAI } from './pool/ai.js';
import { AIController } from './game/ai.js';
import { Game, GameAborted } from './game/engine.js';
import { CallBridgeGame } from './callbridge/engine.js';
import { CallBridgeAI } from './callbridge/ai.js';
import { BingoGame } from './bingo/engine.js';
import { BingoAI } from './bingo/ai.js';
import { WordleGame } from './wordle/engine.js';
import { WordleAI } from './wordle/ai.js';
import { JudgementGame } from './judgement/engine.js';
import { JudgementAI } from './judgement/ai.js';
import { DEFAULT_SCORING } from './judgement/rules.js';
import { JUDGEMENT_BACK } from './render/textures.js';
import { DEFAULT_WORDS } from './wordle/rules.js';
import * as R from './game/rules.js';
import { BOT_NAMES, GAMES, DEFAULT_GAME, TRICK_GAMES, botDelay, paceFor } from './game/settings.js';
import { OnlineSession, setRoomInURL } from './net/online.js';
import { cueMoves, cueLog, cueTricks, sound } from './ui/sound.js';

const hud = new Hud();
// A table for each game on the one stage; only the current game's is on show.
const stage = document.getElementById('stage');
const views = {
  deal: new TableView(stage),
  callbridge: new TrickView(stage),
  // Judgement plays on Call Bridge's table, with its own name on the card backs.
  judgement: new TrickView(stage, { back: JUDGEMENT_BACK }),
  bingo: new BingoView(stage),
  wordle: new WordleView(stage),
  pool: new PoolView(stage),
};
let kind = null;
let view = null;
// Solo play runs the engine here; online play mirrors the server's game.
let game = null;
let human = null;
let online = null;
// The last game played, as saved before the games' keys matched their names: 'judgement'
// was Call Bridge (and, while it was being built, 'ohhell' was Judgement). Moved once.
if (!localStorage.getItem('md-keys')) {
  const old = { judgement: 'callbridge', ohhell: 'judgement' }[localStorage.getItem('md-game')];
  if (old) localStorage.setItem('md-game', old);
  localStorage.setItem('md-keys', '2');
}
const lastGame = localStorage.getItem('md-game');
let settings = { game: GAMES[lastGame] ? lastGame : DEFAULT_GAME, mode: 'solo', name: localStorage.getItem('md-name') || '', opponents: 3, words: DEFAULT_WORDS, scoring: localStorage.getItem('md-scoring') || DEFAULT_SCORING, code: '' };

const activeHuman = () => (online ? online.human : human);

// The table fits around the HUD, so refit whenever the top bar or status changes size.
const refit = new ResizeObserver(() => view.resize());
for (const sel of ['#topbar', '#status', '#turn-controls', '#piles', '.top-actions']) refit.observe(document.querySelector(sel));
for (const v of Object.values(views)) {
  v.insets = () => hud.insets();
  v.on('click', (card, zone, x, y, armed) => activeHuman()?.onCardClick(card, zone, x, y, armed));
}
views.deal.on('hover', (card, zone, side) => hud.preview(card, zone, side));
views.deal.on('moves', cueMoves);
views.deal.on('piles', (deck, discard) => hud.setPiles(deck, discard));
views.callbridge.on('moves', cueTricks);
views.judgement.on('moves', cueTricks);
views.bingo.on('cell', (i) => activeHuman()?.onCell?.(i));
views.wordle.on('submit', (word) => !!activeHuman()?.submit?.(word));
views.wordle.on('marked', () => sound.play('flip'));
// Pool online: the others see our cue as we aim.
views.pool.on('aim', (aim) => online?.sendAim(aim));

// Puts a game's table on show (and its name in the top bar). Returns its view.
function useGame(k) {
  if (k === kind) return view;
  kind = settings.game = k;
  view = views[k];
  localStorage.setItem('md-game', k);
  hud.preview(null);
  hud.setGame(k);
  for (const v of Object.values(views)) if (v !== view) v.setShown(false);
  view.setShown(true);
  return view;
}
useGame(settings.game);

hud.onEndTurn = () => activeHuman()?.endTurn();
// The round counter in the top bar opens the scores so far.
hud.onGameInfo = () => {
  const g = online?.mirror ?? game;
  if (TRICK_GAMES.has(g?.kind)) hud.overlay({ title: 'Scores', body: scoreTable(g.state, online ? online.seat : 0) });
  if (g?.kind === 'wordle') hud.overlay({ title: 'Scores', body: WordleUI.scoreTable(g.state, online ? online.seat : 0) });
};
hud.onNewGame = () => (online ? online.confirmLeave() : startFlow());
hud.onStopGame = () => online?.confirmStop();
hud.onVoice = (button) => online?.voiceButton(button);
hud.onMuteKey = () => online?.toggleMute();

function updateStatus() {
  if (!game) return;
  const { state } = game;
  if (game.kind === 'pool') {
    const { text, mine } = PoolUI.poolStatus(state, 0);
    hud.setStatus(text, mine);
    return;
  }
  if (game.kind === 'wordle') {
    const { text, mine } = WordleUI.wordleStatus(state, 0);
    hud.setStatus(text, mine);
    hud.setGameInfo(WordleUI.gameInfo(state), 'Scores');
    return;
  }
  if (game.kind === 'bingo') {
    const { text, mine } = BingoUI.bingoStatus(state, 0);
    hud.setStatus(text, mine);
    return;
  }
  if (TRICK_GAMES.has(game.kind)) {
    const { text, mine } = trickStatus(state, 0);
    hud.setStatus(text, mine);
    hud.setGameInfo(gameInfo(state), 'Scores');
    return;
  }
  const p = game.current;
  if (state.phase === 'over') {
    hud.setStatus(`<b>${state.winner.name}</b> won the game`);
  } else if (state.turn === 0) {
    hud.setStatus('Dealing…');
  } else if (p.isHuman) {
    hud.setStatus(`<b>Your turn</b> · ${state.playsLeft} play${state.playsLeft === 1 ? '' : 's'} left`, true);
  } else {
    const play = R.playNumber(state);
    hud.setStatus(play ? `<b>${p.name}</b> is on play ${play} of ${R.PLAYS_PER_TURN}` : `<b>${p.name}</b> is playing…`);
  }
}

function newGame(opts) {
  const [Engine, Bot, Human] = {
    deal: [Game, AIController, HumanController],
    callbridge: [CallBridgeGame, CallBridgeAI, TrickHuman],
    judgement: [JudgementGame, JudgementAI, TrickHuman],
    bingo: [BingoGame, BingoAI, BingoUI.BingoHuman],
    wordle: [WordleGame, WordleAI, WordleUI.WordleHuman],
    pool: [PoolGame, PoolAI, PoolUI.PoolHuman],
  }[kind];
  human = new Human(hud, view);
  const players = [{ name: opts.name || 'You', isHuman: true, controller: human }];
  for (let i = 0; i < opts.opponents; i++) players.push({ name: BOT_NAMES[i], controller: new Bot({ delay: botDelay(kind) }) });
  // Wordle on your own has no clock: a word lasts until you get it or run out of guesses.
  const untimed = kind === 'wordle' && !opts.opponents;
  game = new Engine({ players, view, words: opts.words, scoring: opts.scoring, ...(untimed && { roundMs: 0 }) });
  // In Wordle the speed is only how fast the bots think, and pool's shots play out in real time.
  view.pace = paceFor(kind);
  hud.clearLog();
  hud.setTurnControls(false);
  const current = game;
  game.on((type, data) => {
    if (current !== game) return;
    if (type === 'log') {
      hud.log(data.text, data.kind);
      cueLog(data.text, data.kind);
    } else if (type === 'toast') hud.toast(data.text, data.kind);
    // Call Bridge and Judgement: no chime for every card you play.
    else if (type === 'turn' && data.player.isHuman) hud.yourTurn(data.what ? ({ bingo: BingoUI.turnToast, wordle: WordleUI.turnToast, pool: PoolUI.turnToast }[kind] ?? turnToast)(data.what) : undefined, { quiet: data.what === 'play' });
    // Bingo: players get ready one by one while everyone arranges. Wordle: guesses
    // come in from everyone at once.
    else if (type === 'state' && (current.kind === 'bingo' || current.kind === 'wordle')) view.layout();
    else if (type === 'gameover') onGameOver(data.winner);
    updateStatus();
  });
  view.attach(game);
  game.run().catch((e) => {
    if (!(e instanceof GameAborted)) {
      console.error(e);
      if (current === game) hud.toast(`Something went wrong: ${e.message}`, 'warn', 6000);
    }
  });
}

async function onGameOver(winner) {
  const finished = game;
  if (TRICK_GAMES.has(finished.kind)) {
    await hud.showResult(gameResult(finished.state, 0));
  } else if (finished.kind === 'bingo') {
    await hud.showResult(BingoUI.gameResult(finished.state, 0));
  } else if (finished.kind === 'wordle') {
    await hud.showResult(WordleUI.gameResult(finished.state, 0));
  } else if (finished.kind === 'pool') {
    await hud.showResult(PoolUI.gameResult(finished.state, 0));
  } else {
    const sets = winner.piles.filter(R.isComplete).map((p) => p.color);
    const stats = `Finished on turn ${finished.state.turn} with ${[...new Set(sets)].length} complete sets.`;
    await hud.showGameOver(winner, winner.isHuman, stats);
  }
  if (finished === game) startFlow();
}

function stopSolo() {
  if (game) game.abort();
  game = null;
  human = null;
}

function goOnline({ name, mode, code }) {
  stopSolo();
  hud.clearLog();
  hud.setStatus('');
  localStorage.setItem('md-name', name);
  const session = new OnlineSession({
    view,
    useGame,
    hud,
    name,
    game: kind,
    code: mode === 'join' ? code : null,
    onExit: (notice) => {
      if (online !== session) return;
      online = null;
      startFlow(notice);
    },
  });
  online = session;
  session.start();
}

// home: pick the game first (on arrival, or from the start screen's "← Games").
async function startFlow(notice = null, home = false) {
  stopSolo();
  if (online) {
    online.close();
    online = null;
  }
  hud.closeAll();
  hud.setTurnControls(false);
  hud.setStatus('');
  hud.setGameInfo('');
  hud.clearToasts();
  for (const v of Object.values(views)) v.detach();
  if (home) useGame(await hud.showHome(kind));
  const opts = await hud.showStart({ ...settings, notice });
  if (opts.mode === 'home') return startFlow(null, true);
  // Pool's 1 vs 1 or 2 vs 2 is its own setting, not the other games' number of opponents.
  const own = kind === 'pool' ? { opponents: settings.opponents, poolOpponents: opts.opponents } : {};
  settings = { ...settings, ...opts, ...own, mode: opts.mode === 'solo' ? 'solo' : 'online' };
  localStorage.setItem('md-scoring', settings.scoring);
  if (opts.mode === 'solo') {
    // Solo, the fantasy deck's guide comes before the deal, so nothing goes on behind it.
    if (TRICK_GAMES.has(kind)) await hud.showFantasyGuide();
    newGame(opts);
  }
  else goOnline(opts);
}

// An invite link (?room=CODE) opens the online tab with the code filled in. If
// this tab was already in that room (a refresh), go straight back in.
const roomParam = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
if (roomParam && sessionStorage.getItem('md-room') === roomParam && settings.name) {
  settings = { ...settings, mode: 'online', code: roomParam };
  goOnline({ name: settings.name, mode: 'join', code: roomParam });
} else {
  if (roomParam) settings = { ...settings, mode: 'online', code: roomParam };
  else setRoomInURL(null);
  // An invite skips the game picker: the room decides the game.
  startFlow(null, !roomParam);
}

// Handy for debugging from the console.
window.__md = { get game() { return online?.mirror ?? game; }, get online() { return online; }, get view() { return view; }, views, hud, useGame };
