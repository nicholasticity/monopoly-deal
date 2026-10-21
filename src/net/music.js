// The room's music: everyone hears the same YouTube songs together. The server keeps
// the queue and where the song is (play, pause, skip, add, remove: anyone in the room
// may); each browser plays it in YouTube's own player and keeps to the room's place.
// Its controls are a card you can drag about, opened with the 🎵 buttons and put away
// with ▼ (the music plays on; nothing stays on screen). Only the sound is wanted, so the
// player itself is always out of sight. Volume, mute and "music off" are this browser's
// own.
import { videoId } from './youtube.js';

// How far (s) this player may drift from the room's place before it's put back.
const DRIFT = 2;
const TICK_MS = 1500;
// Tries at starting the song before deciding the browser wants a tap first.
const AUTOPLAY_TRIES = 3;
const KEYS = { volume: 'md-music-volume', muted: 'md-music-muted', off: 'md-music-off', pos: 'md-music-pos' };
// While someone in voice chat talks, the music dips to this share of your volume, and
// comes back up this long after they stop (so it doesn't pump between words), fading
// in steps each way.
const DUCK = 0.3;
const DUCK_RELEASE_MS = 800;
const FADE_STEP = 0.1;
const FADE_MS = 40;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// YouTube's IFrame API, loaded the first time there's music.
let api = null;
function youtubeAPI() {
  if (api) return api;
  api = new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const before = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      before?.();
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return api;
}

export class RoomMusic {
  // send(op, data): to the room. toast(text, kind): a note on screen.
  constructor({ send, toast }) {
    this.send = send;
    this.toast = toast;
    this.state = { queue: [], playing: false, pos: 0, at: 0 };
    this.on = localStorage.getItem(KEYS.off) !== '1';
    this.volume = Number(localStorage.getItem(KEYS.volume) ?? 70);
    this.muted = localStorage.getItem(KEYS.muted) === '1';
    this.expanded = false;
    this.someoneTalking = false;
    this.level = 1; // the share of your volume playing now (below 1 while ducked)
    this.player = null;
    this.ready = false;
    this.loadedKey = null;
    this.tries = 0;
    this.onChange = () => {};
    this.build();
    this.tick = setInterval(() => this.sync(), TICK_MS);
  }

  get current() {
    return this.state.queue[0] ?? null;
  }

  // Where the room's song is now (s).
  get position() {
    const { pos, playing, at } = this.state;
    return pos + (playing ? (Date.now() - at) / 1000 : 0);
  }

  // ---------- the card ----------

  build() {
    const card = (this.el = el('div', 'music hidden'));
    // The bar: always on show while there's music.
    const head = el('div', 'music-head');
    head.append(el('span', 'music-ico', '🎵'), (this.titleEl = el('span', 'music-title')));
    this.playBtn = el('button', 'ghost small');
    this.playBtn.addEventListener('click', () => this.current && this.send(this.state.playing ? 'pause' : 'play'));
    this.skipBtn = el('button', 'ghost small', '⏭');
    this.skipBtn.title = 'Skip to the next song (for everyone)';
    this.skipBtn.addEventListener('click', () => this.current && this.send('skip', { key: this.current.key }));
    this.foldBtn = el('button', 'ghost small music-fold', '▼');
    this.foldBtn.title = 'Put away (the music plays on; 🎵 brings this back)';
    this.foldBtn.addEventListener('click', () => this.setExpanded(false));
    head.append(this.playBtn, this.skipBtn, this.foldBtn);
    this.tapBtn = el('button', 'primary small music-tap hidden', '▶ Tap to listen');
    this.tapBtn.addEventListener('click', () => {
      this.player?.unMute?.();
      this.applyVolume();
      this.player?.playVideo?.();
    });
    // The player, playing out of sight.
    this.screenEl = el('div', 'music-screen');
    this.playerEl = el('div', 'music-player');
    this.screenEl.append(this.playerEl);
    // Adding songs and the queue, and beside them your own volume: a vertical slider
    // over the mute button.
    const body = el('div', 'music-body');
    const more = el('div', 'music-more');
    const sound = el('div', 'music-sound');
    this.muteBtn = el('button', 'ghost small');
    this.muteBtn.addEventListener('click', () => {
      this.muted = !this.muted;
      localStorage.setItem(KEYS.muted, this.muted ? '1' : '0');
      this.applyVolume();
      this.render();
    });
    this.volumeEl = el('input', 'music-volume');
    Object.assign(this.volumeEl, { type: 'range', min: '0', max: '100', value: String(this.volume), title: 'Your volume' });
    this.volumeEl.setAttribute('orient', 'vertical');
    this.volumeEl.addEventListener('input', () => {
      this.volume = Number(this.volumeEl.value);
      this.muted = this.volume === 0;
      localStorage.setItem(KEYS.volume, String(this.volume));
      this.applyVolume();
      this.render();
    });
    sound.append(this.volumeEl, this.muteBtn);
    const form = el('form', 'music-add');
    this.input = el('input');
    Object.assign(this.input, { placeholder: 'Paste a YouTube link', autocomplete: 'off', spellcheck: false });
    const add = el('button', 'primary small', 'Add');
    form.append(this.input, add);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const url = this.input.value.trim();
      if (!url) return;
      if (!videoId(url)) return this.toast('That isn’t a YouTube link.', 'warn');
      this.send('add', { url });
      this.input.value = '';
    });
    this.queueEl = el('ol', 'music-queue');
    const off = el('button', 'ghost small music-off', 'Music off for me');
    off.title = 'Stop the music on this device (it carries on for everyone else)';
    off.addEventListener('click', () => this.setOn(false));
    more.append(form, this.queueEl, off);
    body.append(more, sound);
    card.append(head, this.tapBtn, this.screenEl, body);
    document.body.appendChild(card);
    this.draggable(head);
  }

  // Drag the card by its top line; where it was left is remembered.
  draggable(handle) {
    const card = this.el;
    const saved = JSON.parse(localStorage.getItem(KEYS.pos) || 'null');
    if (saved) Object.assign(card.style, { left: `${saved.x}px`, top: `${saved.y}px`, right: 'auto', bottom: 'auto' });
    let from = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = card.getBoundingClientRect();
      from = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!from) return;
      const x = Math.max(4, Math.min(window.innerWidth - card.offsetWidth - 4, e.clientX - from.dx));
      const y = Math.max(4, Math.min(window.innerHeight - 60, e.clientY - from.dy));
      Object.assign(card.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
    });
    handle.addEventListener('pointerup', () => {
      if (!from) return;
      from = null;
      const r = card.getBoundingClientRect();
      localStorage.setItem(KEYS.pos, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) }));
    });
  }

  // The 🎵 button: music back on, or the card opened (or put away again).
  toggle() {
    if (!this.on) return this.setOn(true, true);
    this.setExpanded(!this.expanded);
  }

  setExpanded(open) {
    this.expanded = open;
    this.render();
    if (open && !this.current) this.input.focus();
  }

  setOn(on, expand = false) {
    this.on = on;
    localStorage.setItem(KEYS.off, on ? '0' : '1');
    if (!on) {
      this.player?.destroy?.();
      this.player = null;
      this.ready = false;
      this.loadedKey = null;
      this.expanded = false;
      this.toast('Music is off on this device. 🎵 turns it back on.', 'info');
    } else {
      this.expanded = expand;
    }
    this.render();
    this.sync();
  }

  render() {
    const cur = this.current;
    this.el.classList.toggle('hidden', !this.on || !this.expanded);
    this.titleEl.textContent = cur ? cur.title ?? 'Loading…' : 'Music for the room';
    this.titleEl.title = cur ? `${cur.title ?? ''}${cur.by ? ` · added by ${cur.by}` : ''}` : '';
    this.playBtn.textContent = this.state.playing ? '⏸' : '▶';
    this.playBtn.title = this.state.playing ? 'Pause (for everyone)' : 'Play (for everyone)';
    this.playBtn.classList.toggle('hidden', !cur);
    this.skipBtn.classList.toggle('hidden', !cur);
    this.muteBtn.textContent = this.muted || this.volume === 0 ? '🔇' : '🔊';
    this.muteBtn.title = this.muted ? 'Unmute (just you)' : 'Mute (just you)';
    this.queueEl.replaceChildren(
      ...this.state.queue.map((s, i) => {
        const li = el('li', i === 0 ? 'now' : '');
        li.append(el('span', 'q-title', s.title ?? 'Loading…'), el('span', 'q-by', s.by));
        if (i > 0) {
          const x = el('button', 'ghost small', '✕');
          x.title = 'Take off the queue';
          x.addEventListener('click', () => this.send('remove', { key: s.key }));
          li.append(x);
        }
        return li;
      }),
    );
    if (!this.state.queue.length) this.queueEl.append(el('li', 'q-empty', 'The queue is empty.'));
    this.onChange();
  }

  // ---------- the room's music ----------

  // From the server: the queue and where the first song is.
  apply(msg) {
    this.state = { queue: msg.queue ?? [], playing: !!msg.playing, pos: Number(msg.pos) || 0, at: Date.now() };
    this.render();
    this.sync();
  }

  applyVolume() {
    if (!this.ready) return;
    this.player.setVolume(Math.round(this.volume * this.level));
    if (this.muted || this.volume === 0) this.player.mute();
    else this.player.unMute();
  }

  // Someone else in voice chat started or stopped talking: the music dips under them.
  setDuck(talking) {
    if (talking === this.someoneTalking) return;
    this.someoneTalking = talking;
    clearTimeout(this.releaseTimer);
    if (talking) this.fadeTo(DUCK);
    else this.releaseTimer = setTimeout(() => this.fadeTo(1), DUCK_RELEASE_MS);
  }

  // Eases the music to a share of your volume.
  fadeTo(level) {
    this.target = level;
    if (this.fadeTimer) return;
    const step = () => {
      const gap = this.target - this.level;
      this.level = Math.abs(gap) <= FADE_STEP ? this.target : this.level + Math.sign(gap) * FADE_STEP;
      this.applyVolume();
      this.fadeTimer = this.level === this.target ? null : setTimeout(step, FADE_MS);
    };
    step();
  }

  // Keeps this player to the room's song and place.
  async sync() {
    const cur = this.current;
    if (!this.on || !cur) {
      if (this.ready && !cur) this.player.stopVideo();
      this.loadedKey = null;
      this.tapBtn.classList.add('hidden');
      return;
    }
    if (!this.player) {
      this.player = 'loading';
      const YT = await youtubeAPI();
      if (!this.on) return (this.player = null);
      // A fresh element each time: the API swaps it for its iframe.
      const host = el('div');
      this.playerEl.replaceChildren(host);
      this.player = new YT.Player(host, {
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, rel: 0, fs: 0, iv_load_policy: 3, origin: location.origin },
        events: {
          onReady: () => {
            this.ready = true;
            this.applyVolume();
            this.sync();
          },
          onStateChange: (e) => this.onPlayerState(e.data),
          onError: (e) => this.onPlayerError(e.data),
        },
      });
      return;
    }
    if (!this.ready) return;
    const want = this.position;
    if (this.loadedKey !== cur.key) {
      this.loadedKey = cur.key;
      this.tries = 0;
      if (this.state.playing) this.player.loadVideoById({ videoId: cur.vid, startSeconds: want });
      else this.player.cueVideoById({ videoId: cur.vid, startSeconds: want });
      return;
    }
    const YTS = window.YT.PlayerState;
    const now = this.player.getPlayerState();
    if (this.state.playing) {
      if (now !== YTS.PLAYING && now !== YTS.BUFFERING) {
        // The browser may want a tap before it plays sound.
        // The card comes out for that, even if it was put away. (In the background a
        // phone may simply not play: that's not the browser wanting a tap.)
        if (!document.hidden && ++this.tries > AUTOPLAY_TRIES && this.tapBtn.classList.contains('hidden')) {
          this.tapBtn.classList.remove('hidden');
          this.setExpanded(true);
        }
        this.player.seekTo(want, true);
        this.player.playVideo();
      } else if (Math.abs(this.player.getCurrentTime() - want) > DRIFT) {
        this.player.seekTo(want, true);
      }
    } else if (now === YTS.PLAYING || now === YTS.BUFFERING) {
      this.player.pauseVideo();
      this.player.seekTo(this.state.pos, true);
    }
  }

  // The page is back from the background: catch up with the room straight away.
  wake() {
    this.tries = 0;
    this.sync();
  }

  onPlayerState(s) {
    const YTS = window.YT.PlayerState;
    if (s === YTS.PLAYING) {
      this.tries = 0;
      this.tapBtn.classList.add('hidden');
    }
    // The song's over: the room moves on (the first browser to say so decides).
    if (s === YTS.ENDED && this.current?.key === this.loadedKey) this.send('ended', { key: this.loadedKey });
  }

  // A video that won't play here (removed, private, or not allowed in other sites).
  onPlayerError(code) {
    if (!this.current || this.current.key !== this.loadedKey) return;
    if ([2, 5, 100, 101, 150].includes(code)) {
      this.toast('A song couldn’t play here, so it was skipped.', 'warn');
      this.send('ended', { key: this.loadedKey });
    }
  }

  destroy() {
    clearInterval(this.tick);
    clearTimeout(this.releaseTimer);
    clearTimeout(this.fadeTimer);
    if (this.player && this.player !== 'loading') this.player.destroy?.();
    this.player = null;
    this.el.remove();
  }
}
