// Sound effects, synthesised with the Web Audio API so there are no files to load.
// Browsers only allow audio after the first tap or key press, so the audio context
// starts then.
const KEY = 'md-muted';
const note = (midi) => 440 * 2 ** ((midi - 69) / 12);

// Each effect schedules its notes from time t; n is how many cards it is for.
const EFFECTS = {
  // Cards sliding off the deck.
  draw: (s, t, n) => {
    for (let i = 0; i < Math.min(n, 5); i++) s.noise(t + i * 0.07, { dur: 0.13, gain: 0.22, freq: 1500, to: 4500, q: 0.8 });
  },
  // A card laid on the felt.
  place: (s, t) => {
    s.noise(t, { dur: 0.08, gain: 0.4, type: 'lowpass', freq: 1000, to: 300 });
    s.tone(t, 150, { dur: 0.09, gain: 0.12, to: 90 });
  },
  // An action card held up for everyone to see.
  play: (s, t) => s.noise(t, { dur: 0.24, gain: 0.2, freq: 700, to: 3200, q: 1.2, attack: 0.06 }),
  // Money into a bank.
  coin: (s, t, n) => {
    for (let i = 0; i < Math.min(n, 3); i++) {
      const u = t + i * 0.09;
      s.tone(u, note(95), { type: 'triangle', dur: 0.1, gain: 0.1 });
      s.tone(u + 0.05, note(100), { type: 'triangle', dur: 0.4, gain: 0.1 });
    }
  },
  // A property changing hands.
  steal: (s, t) => {
    s.noise(t, { dur: 0.26, gain: 0.22, freq: 3500, to: 700, q: 1.5 });
    s.tone(t + 0.02, 700, { type: 'triangle', dur: 0.26, gain: 0.08, to: 350 });
  },
  // Rent, Debt Collector or a birthday: the till rings.
  charge: (s, t) => {
    s.noise(t, { dur: 0.05, gain: 0.25, type: 'highpass', freq: 2500 });
    s.tone(t + 0.05, note(84), { type: 'triangle', dur: 0.5, gain: 0.12 });
    s.tone(t + 0.05, note(91), { dur: 0.7, gain: 0.08 });
    s.tone(t + 0.14, note(96), { dur: 0.6, gain: 0.06 });
  },
  // Just Say No: a two-part buzzer.
  no: (s, t) => {
    s.tone(t, 196, { type: 'square', dur: 0.16, gain: 0.07, to: 180 });
    s.tone(t + 0.19, 165, { type: 'square', dur: 0.32, gain: 0.07, to: 140 });
  },
  // Your turn: ding-dong.
  turn: (s, t) => {
    s.tone(t, note(81), { dur: 0.6, gain: 0.16 });
    s.tone(t + 0.16, note(88), { dur: 0.9, gain: 0.16 });
    s.tone(t + 0.16, note(100), { type: 'triangle', dur: 0.4, gain: 0.03 });
  },
  // A set completed: a rising sparkle.
  set: (s, t) => {
    [72, 76, 79, 84, 88].forEach((m, i) => s.tone(t + i * 0.06, note(m), { type: 'triangle', dur: 0.4, gain: 0.1 }));
  },
  // The discard pile riffled into a new deck.
  shuffle: (s, t) => {
    for (let i = 0; i < 12; i++) s.noise(t + i * 0.032 + Math.random() * 0.01, { dur: 0.03, gain: 0.16, freq: 2800, q: 1.5 });
  },
  win: (s, t) => {
    for (const [m, at, dur] of [[72, 0, 0.16], [76, 0.15, 0.16], [79, 0.3, 0.16], [84, 0.45, 1.1]]) {
      s.tone(t + at, note(m), { type: 'triangle', dur, gain: 0.14 });
      s.tone(t + at, note(m), { type: 'square', dur, gain: 0.025 });
    }
    for (const m of [64, 67, 72]) s.tone(t + 0.45, note(m), { type: 'triangle', dur: 1.2, gain: 0.06 });
  },
  lose: (s, t) => {
    [67, 64, 60].forEach((m, i) => s.tone(t + i * 0.3, note(m), { type: 'triangle', dur: i === 2 ? 0.9 : 0.32, gain: 0.13, to: i === 2 ? note(59) : null }));
  },
};

class Sound {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem(KEY) === '1';
    this.lastAt = new Map();
    const unlock = () => {
      if (this.start()?.state !== 'running') return;
      for (const ev of ['pointerdown', 'keydown']) document.removeEventListener(ev, unlock, true);
    };
    for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, unlock, true);
  }

  start() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      const ctx = (this.ctx = new AC());
      this.out = ctx.createGain();
      this.out.gain.value = 0.6;
      this.out.connect(ctx.destination);
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setMuted(muted) {
    this.muted = muted;
    localStorage.setItem(KEY, muted ? '1' : '0');
  }

  // Plays a named effect; repeats of the same one a few milliseconds apart are dropped.
  play(name, n = 1) {
    const ctx = this.ctx;
    if (this.muted || !ctx || ctx.state !== 'running' || !EFFECTS[name]) return;
    const now = ctx.currentTime;
    if (now - (this.lastAt.get(name) ?? -1) < 0.04) return;
    this.lastAt.set(name, now);
    EFFECTS[name](this, now + 0.01, n);
  }

  envelope(t, gain, attack, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.out);
    return g;
  }

  // A pitched note, optionally sliding to another pitch.
  tone(t, freq, { type = 'sine', dur = 0.2, gain = 0.2, attack = 0.005, to = null } = {}) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    osc.connect(this.envelope(t, gain, attack, dur));
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Filtered noise, optionally sweeping the filter: swishes, thumps and riffles.
  noise(t, { dur = 0.1, gain = 0.2, type = 'bandpass', freq = 2000, to = null, q = 1, attack = 0.004 } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t);
    if (to) filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    src.connect(filter);
    filter.connect(this.envelope(t, gain, attack, dur));
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}

export const sound = new Sound();

const held = (z) => z.zone === 'hand' || z.zone === 'ohand';

// Sounds for the cards that changed zone in one layout of the table, and for sets
// that were just completed.
export function cueMoves(moves, completed) {
  const counts = new Map();
  for (const { from, to } of moves) {
    const other = from.playerId !== to.playerId;
    let cue = null;
    if (from.zone === 'deck' && held(to)) cue = 'draw';
    else if (to.zone === 'showcase') cue = 'play';
    else if (to.zone === 'bank') cue = held(from) || other ? 'coin' : null;
    else if (to.zone === 'pile') cue = other && (from.zone === 'pile' || from.zone === 'bank') ? 'steal' : 'place';
    else if (to.zone === 'discard' && held(from)) cue = 'place';
    if (cue) counts.set(cue, (counts.get(cue) ?? 0) + 1);
  }
  for (const [cue, n] of counts) sound.play(cue, n);
  if (completed) sound.play('set');
}

// Sounds for game events, read from their log lines (the same solo and online).
export function cueLog(text, kind) {
  if (/shuffled into a new deck/.test(text)) sound.play('shuffle');
  else if (kind !== 'action') return;
  else if (/Just Say No/.test(text)) sound.play('no');
  else if (/ rent |Birthday|Debt Collector/.test(text)) sound.play('charge');
}
