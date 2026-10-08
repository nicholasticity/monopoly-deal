import './style.css';
import { TableView } from './render/view.js';
import { JudgementView } from './render/judgement-view.js';
import { Hud } from './ui/hud.js';
import { HumanController } from './ui/human.js';
import { JudgementHuman, judgementStatus, gameInfo, gameResult, scoreTable, turnToast } from './ui/judgement.js';
import { AIController } from './game/ai.js';
import { Game, GameAborted } from './game/engine.js';
import { JudgementGame } from './judgement/engine.js';
import { JudgementAI } from './judgement/ai.js';
import * as R from './game/rules.js';
import { BOT_NAMES, SPEEDS, GAMES, DEFAULT_GAME } from './game/settings.js';
import { OnlineSession, setRoomInURL } from './net/online.js';
import { cueMoves, cueLog, cueTricks } from './ui/sound.js';

const hud = new Hud();
// A table for each game on the one stage; only the current game's is on show.
const stage = document.getElementById('stage');
const views = { deal: new TableView(stage), judgement: new JudgementView(stage) };
let kind = null;
let view = null;
// Solo play runs the engine here; online play mirrors the server's game.
let game = null;
let human = null;
let online = null;
const lastGame = localStorage.getItem('md-game');
let settings = { game: GAMES[lastGame] ? lastGame : DEFAULT_GAME, mode: 'solo', name: localStorage.getItem('md-name') || '', opponents: 3, speed: 'normal', code: '' };

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
views.judgement.on('moves', cueTricks);

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
  if (g?.kind === 'judgement') hud.overlay({ title: 'Scores', body: scoreTable(g.state, online ? online.seat : 0) });
};
hud.onNewGame = () => (online ? online.confirmLeave() : startFlow());
hud.onStopGame = () => online?.confirmStop();
hud.onVoice = (button) => online?.voiceButton(button);
hud.onMuteKey = () => online?.toggleMute();

function updateStatus() {
  if (!game) return;
  const { state } = game;
  if (game.kind === 'judgement') {
    const { text, mine } = judgementStatus(state, 0);
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
  const speed = SPEEDS[opts.speed];
  const judgement = kind === 'judgement';
  human = judgement ? new JudgementHuman(hud) : new HumanController(hud);
  const Bot = judgement ? JudgementAI : AIController;
  const players = [{ name: opts.name || 'You', isHuman: true, controller: human }];
  for (let i = 0; i < opts.opponents; i++) players.push({ name: BOT_NAMES[i], controller: new Bot({ delay: speed.delay }) });
  game = judgement ? new JudgementGame({ players, view }) : new Game({ players, view });
  view.pace = speed.pace;
  hud.clearLog();
  hud.setTurnControls(false);
  const current = game;
  game.on((type, data) => {
    if (current !== game) return;
    if (type === 'log') {
      hud.log(data.text, data.kind);
      cueLog(data.text, data.kind);
    } else if (type === 'toast') hud.toast(data.text, data.kind);
    // Judgement: no chime for every card you play.
    else if (type === 'turn' && data.player.isHuman) hud.yourTurn(data.what ? turnToast(data.what) : undefined, { quiet: data.what === 'play' });
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
  if (finished.kind === 'judgement') {
    await hud.showResult(gameResult(finished.state, 0));
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
  if (home) useGame(await hud.showHome(kind));
  const opts = await hud.showStart({ ...settings, notice });
  if (opts.mode === 'home') return startFlow(null, true);
  settings = { ...settings, ...opts, mode: opts.mode === 'solo' ? 'solo' : 'online' };
  if (opts.mode === 'solo') newGame(opts);
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
