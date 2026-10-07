// Voice chat for online rooms. Everyone in voice sends their microphone straight to
// everyone else in it (WebRTC); the room server only passes the connection offers
// along. Browsers allow the microphone on https pages and on localhost only.
const TALKING_LEVEL = 0.02; // loudness (RMS of the waveform) that counts as talking
const TALKING_HOLD_MS = 350; // keeps the light on through short pauses
const GATHER_MS = 2500; // longest wait for network routes before sending an offer
const REDIAL_MS = [2000, 5000, 10000]; // waits before calling again after a failure

export const voiceSupported = () => !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.RTCPeerConnection);

// Resolves once the connection has found its network routes (or after GATHER_MS), so
// each offer and answer goes out as one message with every route in it.
function gathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export class VoiceChat {
  // send(type, data) goes to the room server.
  constructor(send) {
    this.send = send;
    // Runs whenever who's in voice, muted or talking changes.
    this.onChange = () => {};
    // A problem worth telling the player about.
    this.onNotice = () => {};
    this.iceServers = [];
    this.selfId = null;
    this.members = [];
    this.stream = null;
    this.muted = false;
    this.peers = new Map(); // member id -> { id, sid, pc, audio, meter }
    this.failures = new Map(); // member id -> { n, at }: failed calls in a row, next try
    this.talking = new Set();
    this.unlock = () => this.resume();
  }

  get active() {
    return !!this.stream;
  }

  // 'off', 'on' or 'muted'.
  get state() {
    return !this.stream ? 'off' : this.muted ? 'muted' : 'on';
  }

  // Asks for the microphone and connects to everyone already in voice. Throws the
  // browser's error (e.g. NotAllowedError) if the microphone can't be used.
  async join() {
    if (this.stream || this.joining) return;
    this.joining = true;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } finally {
      this.joining = false;
    }
    if (this.closed) return stream.getTracks().forEach((t) => t.stop());
    this.stream = stream;
    this.muted = false;
    stream.getAudioTracks()[0]?.addEventListener('ended', () => {
      this.leave();
      this.onNotice('Your microphone was disconnected, so you left voice chat.');
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.selfMeter = this.meter(stream);
    this.timer = setInterval(() => this.listen(), 100);
    // Browsers hold back sound until the page is tapped, which may not have happened
    // yet when voice resumes after a reload; every tap retries.
    document.addEventListener('pointerdown', this.unlock, true);
    this.resume();
    this.announce();
    this.reconcile();
    this.onChange();
  }

  // quiet: don't tell the server (the connection is closing anyway).
  leave(quiet = false) {
    if (!this.stream) return;
    for (const id of [...this.peers.keys()]) this.hangUp(id);
    for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.muted = false;
    clearInterval(this.timer);
    this.ctx.close();
    document.removeEventListener('pointerdown', this.unlock, true);
    this.talking = new Set();
    this.failures.clear();
    if (!quiet) this.announce();
    this.onChange();
  }

  close() {
    this.closed = true;
    this.leave(true);
  }

  setMuted(muted) {
    if (!this.stream) return;
    this.muted = muted;
    for (const t of this.stream.getAudioTracks()) t.enabled = !muted;
    this.announce();
    this.onChange();
  }

  announce() {
    this.send('voice', { on: this.active, muted: this.muted });
  }

  // A fresh connection to the server (the first, or after a drop). The server
  // forgot we were in voice and the others hung up, so start over.
  joined(selfId) {
    this.selfId = selfId;
    if (!this.stream) return;
    for (const id of [...this.peers.keys()]) this.hangUp(id);
    this.announce();
  }

  // The room's member list changed.
  update(members) {
    this.members = members;
    this.reconcile();
    this.onChange();
  }

  // Calls whoever newly joined voice and hangs up on whoever left it.
  reconcile() {
    const others = this.stream ? this.members.filter((m) => m.voice && m.id !== this.selfId).map((m) => m.id) : [];
    const inVoice = new Set(others);
    for (const id of [...this.peers.keys()]) if (!inVoice.has(id)) this.hangUp(id);
    for (const id of [...this.failures.keys()]) if (!inVoice.has(id)) this.failures.delete(id);
    const now = Date.now();
    for (const id of inVoice) {
      const f = this.failures.get(id);
      // Only the lower member id of each pair calls, so two offers never cross.
      if (this.peers.has(id) || id < this.selfId || (f && (f.n > REDIAL_MS.length || now < f.at))) continue;
      this.call(id);
    }
  }

  async call(id) {
    const peer = this.dial(id, Math.random().toString(36).slice(2, 10));
    try {
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      await gathered(peer.pc);
      if (this.peers.get(id) === peer) this.send('rtc', { to: id, data: { sid: peer.sid, sdp: peer.pc.localDescription.toJSON() } });
    } catch (e) {
      console.warn('[voice] call failed', e);
      this.failed(peer);
    }
  }

  // An offer or answer from another member, passed on by the server.
  async signal(from, data) {
    const sdp = data?.sdp;
    if (!this.stream || !sdp) return;
    let peer = this.peers.get(from);
    try {
      if (sdp.type === 'offer') {
        this.hangUp(from);
        peer = this.dial(from, data.sid);
        await peer.pc.setRemoteDescription(sdp);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        await gathered(peer.pc);
        if (this.peers.get(from) === peer) this.send('rtc', { to: from, data: { sid: peer.sid, sdp: peer.pc.localDescription.toJSON() } });
      } else if (sdp.type === 'answer' && peer?.sid === data.sid && peer.pc.signalingState === 'have-local-offer') {
        await peer.pc.setRemoteDescription(sdp);
      }
    } catch (e) {
      console.warn('[voice] connection setup failed', e);
      if (peer) this.failed(peer);
    }
  }

  // A connection to one other member: sends our microphone and plays theirs.
  dial(id, sid) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer = { id, sid, pc, audio: new Audio(), meter: null };
    peer.audio.autoplay = true;
    // Some mobile browsers only play elements that are in the page.
    document.body.appendChild(peer.audio);
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      if (peer.audio.srcObject === stream) return;
      peer.audio.srcObject = stream;
      peer.audio.play().catch(() => {});
      peer.meter?.source.disconnect();
      peer.meter = this.meter(stream);
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== peer) return;
      if (pc.connectionState === 'connected') this.failures.delete(id);
      else if (pc.connectionState === 'failed') this.failed(peer);
    };
    this.peers.set(id, peer);
    return peer;
  }

  hangUp(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.pc.close();
    peer.audio.srcObject = null;
    peer.audio.remove();
    peer.meter?.source.disconnect();
  }

  // A call that couldn't be made, or dropped: try a few more times, then say so.
  failed(peer) {
    if (this.peers.get(peer.id) !== peer) return;
    this.hangUp(peer.id);
    const n = (this.failures.get(peer.id)?.n ?? 0) + 1;
    const wait = REDIAL_MS[n - 1];
    this.failures.set(peer.id, { n, at: Date.now() + (wait ?? 0) });
    if (wait != null) {
      setTimeout(() => this.reconcile(), wait);
    } else {
      const name = this.members.find((m) => m.id === peer.id)?.name ?? 'another player';
      this.onNotice(`Voice chat couldn’t connect to ${name}. One of your networks may be blocking it.`);
    }
  }

  meter(stream) {
    const source = this.ctx.createMediaStreamSource(stream);
    const analyser = this.ctx.createAnalyser();
    // About 90 ms of sound, so each check (every 100 ms) hears nearly all of it.
    analyser.fftSize = 4096;
    source.connect(analyser);
    return { source, analyser, buf: new Float32Array(analyser.fftSize), until: 0 };
  }

  // Who is talking: anyone whose microphone was loud enough a moment ago.
  listen() {
    const now = performance.now();
    const talking = new Set();
    const check = (id, m) => {
      if (!m) return;
      m.analyser.getFloatTimeDomainData(m.buf);
      let sum = 0;
      for (const v of m.buf) sum += v * v;
      if (Math.sqrt(sum / m.buf.length) > TALKING_LEVEL) m.until = now + TALKING_HOLD_MS;
      if (now < m.until) talking.add(id);
    };
    if (!this.muted) check(this.selfId, this.selfMeter);
    for (const [id, peer] of this.peers) check(id, peer.meter);
    if (talking.size !== this.talking.size || [...talking].some((id) => !this.talking.has(id))) {
      this.talking = talking;
      this.onChange();
    }
  }

  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    for (const peer of this.peers.values()) if (peer.audio.srcObject && peer.audio.paused) peer.audio.play().catch(() => {});
  }
}
