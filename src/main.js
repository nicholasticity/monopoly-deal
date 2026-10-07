import './style.css';
import { TableView } from './render/view.js';
import { Hud } from './ui/hud.js';
import { HumanController } from './ui/human.js';
import { AIController } from './game/ai.js';
import { Game, GameAborted } from './game/engine.js';
import * as R from './game/rules.js';
import { BOT_NAMES, SPEEDS } from './game/settings.js';
import { OnlineSession, setRoomInURL } from './net/online.js';

const view = new TableView(document.getElementById('stage'));
const hud = new Hud();
// Solo play runs the engine here; online play mirrors the server's game.
let game = null;
let human = null;
let online = null;
let settings = { mode: 'solo', name: localStorage.getItem('md-name') || '', opponents: 3, speed: 'normal', code: '' };

const activeHuman = () => (online ? online.human : human);

view.on('hover', (card, zone, side) => hud.preview(card, zone, side));
view.on('click', (card, zone, x, y) => activeHuman()?.onCardClick(card, zone, x, y));
hud.onEndTurn = () => activeHuman()?.endTurn();
hud.onNewGame = () => (online ? online.confirmLeave() : startFlow());
hud.onStopGame = () => online?.confirmStop();

function updateStatus() {
  if (!game) return;
  const { state } = game;
  const p = game.current;
  if (state.phase === 'over') {
    hud.setStatus(`<b>${state.winner.name}</b> won the game`);
  } else if (state.turn === 0) {
    hud.setStatus('Dealing…');
  } else if (p.isHuman) {
    hud.setStatus(`<b>Your turn</b> · ${state.playsLeft} play${state.playsLeft === 1 ? '' : 's'} left`);
  } else {
    hud.setStatus(`<b>${p.name}</b> is playing…`);
  }
}

function newGame(opts) {
  const speed = SPEEDS[opts.speed];
  human = new HumanController(hud);
  const players = [{ name: opts.name || 'You', isHuman: true, controller: human }];
  for (let i = 0; i < opts.opponents; i++) players.push({ name: BOT_NAMES[i], controller: new AIController({ delay: speed.delay }) });
  game = new Game({ players, view });
  view.pace = speed.pace;
  hud.clearLog();
  hud.setTurnControls(false);
  const current = game;
  game.on((type, data) => {
    if (current !== game) return;
    if (type === 'log') hud.log(data.text, data.kind);
    else if (type === 'toast') hud.toast(data.text, data.kind);
    else if (type === 'turn' && data.player.isHuman) hud.toast('Your turn!', 'turn', 1600);
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
  const sets = winner.piles.filter(R.isComplete).map((p) => p.color);
  const stats = `Finished on turn ${finished.state.turn} with ${[...new Set(sets)].length} complete sets.`;
  await hud.showGameOver(winner, winner.isHuman, stats);
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
    hud,
    name,
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

async function startFlow(notice = null) {
  stopSolo();
  if (online) {
    online.close();
    online = null;
  }
  hud.closeAll();
  hud.setTurnControls(false);
  hud.setStatus('');
  const opts = await hud.showStart({ ...settings, notice });
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
  startFlow();
}

// Handy for debugging from the console.
window.__md = { get game() { return online?.mirror ?? game; }, get online() { return online; }, view, hud };
