// Three.js presentation of the game. Every sync() recomputes a target transform
// for each card from the game state; cards ease toward their targets each frame.
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { cardCanvas, isFlipped, TEX_W, TEX_H, TEX_RADIUS } from './textures.js';
import { buildTable } from './table.js';
import * as R from '../game/rules.js';

export const CARD_W = 2.4;
export const CARD_H = (CARD_W * TEX_H) / TEX_W;
const THICK = 0.014;
const CORNER = (CARD_W * TEX_RADIUS) / TEX_W;
const BASE_FOV = 38;
const HAND_DEPTH = 10;
const SHOW_DEPTH = 9;
// Screen width (CSS px) reserved for the turn controls beside the hand.
const CONTROLS_PX = 320;

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const FLAT = new THREE.Quaternion().setFromAxisAngle(X_AXIS, -Math.PI / 2);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Where cards that appear mid-game (an online deck reshuffle) come from.
const SPAWN = new THREE.Vector3(1.8, 0.3, -5.5);
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function roundedShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function makeGeometries() {
  const shape = roundedShape(CARD_W, CARD_H, CORNER);
  const face = new THREE.ShapeGeometry(shape, 5);
  const pos = face.attributes.position;
  const uv = face.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / CARD_W + 0.5, pos.getY(i) / CARD_H + 0.5);
  const edge = new THREE.ExtrudeGeometry(shape, { depth: THICK, bevelEnabled: false, curveSegments: 5 });
  edge.translate(0, 0, -THICK / 2);
  return { face, edge };
}

function canvasTexture(canvas, anisotropy) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

// Flat-on-table orientation, optionally spun in-plane and/or face down.
function tableQuat(spin = 0, faceUp = true) {
  const q = FLAT.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, spin));
  if (!faceUp) q.multiply(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI));
  return q;
}

class CardObject {
  constructor(card, geo, frontMat, backMat, edgeMats) {
    this.card = card;
    this.group = new THREE.Group();
    this.front = new THREE.Mesh(geo.face, frontMat);
    this.front.position.z = THICK / 2 + 0.0004;
    this.back = new THREE.Mesh(geo.face, backMat);
    this.back.rotation.y = Math.PI;
    this.back.position.z = -THICK / 2 - 0.0004;
    this.edge = new THREE.Mesh(geo.edge, edgeMats);
    this.front.castShadow = this.back.castShadow = true;
    for (const m of [this.front, this.back, this.edge]) {
      m.userData.cardId = card.id;
      this.group.add(m);
    }
    this.base = new THREE.Vector3();
    this.scale = 1;
    this.target = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1, shadow: true };
    this.zone = null;
  }

  setTarget(pos, quat, scale, shadow = true) {
    this.target.pos.copy(pos);
    this.target.quat.copy(quat);
    this.target.scale = scale;
    this.target.shadow = shadow;
  }

  snap() {
    this.base.copy(this.target.pos);
    this.group.quaternion.copy(this.target.quat);
    this.scale = this.target.scale;
    this.apply(0);
  }

  apply(lift) {
    this.group.position.copy(this.base);
    this.group.position.y += lift;
    this.group.scale.setScalar(this.scale);
    this.front.castShadow = this.back.castShadow = this.target.shadow;
  }

  step(k) {
    const dist = this.base.distanceTo(this.target.pos);
    this.base.lerp(this.target.pos, k);
    this.group.quaternion.slerp(this.target.quat, k);
    this.scale += (this.target.scale - this.scale) * k;
    // Cards travelling across the table arc upward a little.
    this.apply(this.target.shadow ? Math.min(dist, 10) * 0.16 : 0);
  }
}

export class TableView {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'label-layer';
    container.appendChild(this.labelRenderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.5, 200);
    this.camera.position.set(0, 33, 19);
    this.camera.lookAt(0, 0, -3.2);
    this.scene.add(this.camera);

    this.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    buildTable(this.scene, this.renderer);

    this.geo = makeGeometries();
    this.textures = new Map();
    this.backMat = new THREE.MeshStandardMaterial({ map: canvasTexture(cardCanvas(null), this.anisotropy), roughness: 0.65 });
    this.edgeMats = [new THREE.MeshBasicMaterial({ visible: false }), new THREE.MeshStandardMaterial({ color: 0xf1ede2, roughness: 0.8 })];

    this.cards = new Map();
    this.seen = new Set();
    this.seat = 0;
    this.cardRoot = new THREE.Group();
    this.scene.add(this.cardRoot);
    this.zoneRoot = new THREE.Group();
    this.scene.add(this.zoneRoot);
    this.glowTex = glowTexture();
    this.glows = new Map();
    this.labels = [];
    this.game = null;
    this.pace = 1;
    this.hoverId = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-10, -10);
    this.pointerDirty = false;
    this.handlers = { hover: () => {}, click: () => {} };

    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerleave', () => this.setPointer(-10, -10));
    el.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.timer = new THREE.Timer();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  on(event, fn) {
    this.handlers[event] = fn;
  }

  // ---------- setup per game ----------

  texture(card) {
    let tex = this.textures.get(card.key);
    if (!tex) {
      tex = canvasTexture(cardCanvas(card), this.anisotropy);
      this.textures.set(card.key, tex);
    }
    return tex;
  }

  // The local player (isHuman) sits at the bottom; the others follow in turn order.
  attach(game) {
    this.game = game;
    this.hoverId = null;
    for (const obj of this.cards.values()) this.dropCard(obj);
    this.cards.clear();
    this.seat = Math.max(0, game.state.players.findIndex((p) => p.isHuman));
    for (const card of game.allCards) this.objFor(card);
    this.buildZones(game.state.players.length);
    this.buildLabels(game);
    for (const g of this.glows.values()) g.material.opacity = g.userData.opacity = 0;
    this.layout();
    for (const obj of this.cards.values()) obj.snap();
  }

  // Card object for a card, created on first sight. Hidden cards (other players'
  // hands online) wear the card back on both faces until the server reveals them.
  objFor(card) {
    let obj = this.cards.get(card.id);
    if (!obj) {
      const mat = new THREE.MeshStandardMaterial({ map: this.backMat.map, roughness: 0.6 });
      obj = new CardObject(card, this.geo, mat, this.backMat, this.edgeMats);
      obj.key = null;
      obj.base.copy(SPAWN);
      obj.group.quaternion.copy(tableQuat(0, false));
      obj.scale = 0.9;
      obj.apply(0);
      this.cards.set(card.id, obj);
      this.cardRoot.add(obj.group);
    }
    obj.card = card;
    const key = card.hidden ? null : card.key;
    if (obj.key !== key) {
      obj.key = key;
      obj.front.material.map = key ? this.texture(card) : this.backMat.map;
    }
    this.seen.add(card.id);
    return obj;
  }

  dropCard(obj) {
    this.cardRoot.remove(obj.group);
    obj.front.material.dispose();
  }

  // Table zone for player i: zone 0 is the bottom (local) seat.
  zoneIndex(i) {
    const n = this.game.state.players.length;
    return (i - this.seat + n) % n;
  }

  buildZones(n) {
    for (const child of [...this.zoneRoot.children]) {
      this.zoneRoot.remove(child);
      child.geometry.dispose();
      child.material.map?.dispose();
      child.material.dispose();
    }
    const zones = [];
    zones.push({
      human: true,
      scale: 1.05,
      hand: { x: 0, z: 3.6 },
      bank: { x0: -20.4, x1: -13.2, z: -0.4 },
      props: { x0: -12.2, x1: 20.6, z: -0.4 },
      rect: { x0: -21.2, x1: 21.2, z0: -2.7, z1: 5.6 },
      label: new THREE.Vector3(-17.2, 0, -2.7),
    });
    const k = n - 1;
    const gap = 0.9;
    const left = -21.2, right = 21.2;
    const w = (right - left - gap * (k - 1)) / k;
    const scale = [0, 1.05, 1, 0.92, 0.78][k];
    for (let i = 0; i < k; i++) {
      const x0 = left + i * (w + gap);
      const x1 = x0 + w;
      const cw = CARD_W * scale;
      const bankW = Math.min(Math.max(cw * 1.6, w * 0.24), cw * 2.6);
      zones.push({
        human: false,
        scale,
        hand: { x: (x0 + x1) / 2, z: -18.7 },
        bank: { x0: x0 + 0.5, x1: x0 + 0.5 + bankW, z: -14.3 },
        props: { x0: x0 + 1.0 + bankW, x1: x1 - 0.5, z: -14.3 },
        rect: { x0, x1, z0: -20.4, z1: -8.6 },
        label: new THREE.Vector3((x0 + x1) / 2, 0, -20.4),
      });
    }
    this.zones = zones;
    this.zoneMeshes = zones.map((z) => {
      const mesh = zonePlane(z.rect);
      this.zoneRoot.add(mesh);
      return mesh;
    });
  }

  buildLabels(game) {
    for (const l of this.labels) l.obj.removeFromParent();
    this.labels = game.state.players.map((p, i) => {
      const div = document.createElement('div');
      div.className = `plabel ${p.isHuman ? 'human' : ''}`;
      const obj = new CSS2DObject(div);
      obj.position.copy(this.zones[this.zoneIndex(i)].label);
      this.scene.add(obj);
      return { div, obj };
    });
    const deckDiv = document.createElement('div');
    deckDiv.className = 'pile-label';
    const deckObj = new CSS2DObject(deckDiv);
    this.scene.add(deckObj);
    const discardDiv = document.createElement('div');
    discardDiv.className = 'pile-label';
    const discardObj = new CSS2DObject(discardDiv);
    this.scene.add(discardObj);
    this.labels.push({ div: deckDiv, obj: deckObj, deck: true }, { div: discardDiv, obj: discardObj, discard: true });
  }

  // ---------- layout ----------

  sync(game, ms) {
    this.layout();
    return sleep(ms * this.pace);
  }

  layout() {
    const game = this.game;
    if (!game) return;
    const { state } = game;
    this.seen.clear();
    const at = (card, zone, playerId = null) => {
      const obj = this.objFor(card);
      obj.zone = { zone, playerId };
      return obj;
    };

    // Deck and discard in the middle of the table.
    const deckPos = new THREE.Vector3(-1.8, 0, -5.5);
    const discardPos = new THREE.Vector3(1.8, 0, -5.5);
    state.deck.forEach((card, i) => {
      at(card, 'deck').setTarget(new THREE.Vector3(deckPos.x, 0.01 + i * 0.016, deckPos.z), tableQuat(0, false), 0.9);
    });
    state.discard.forEach((card, i) => {
      const spin = (hash(card.id) - 0.5) * 0.5;
      const pos = new THREE.Vector3(discardPos.x + (hash(card.id + 7) - 0.5) * 0.3, 0.01 + i * 0.016, discardPos.z + (hash(card.id + 3) - 0.5) * 0.3);
      at(card, 'discard').setTarget(pos, tableQuat(spin), 0.9);
    });
    this.positionPileLabel('deck', deckPos, -1, `Deck · ${state.deck.length}`);
    this.positionPileLabel('discard', discardPos, 1, `Discard · ${state.discard.length}`);

    state.players.forEach((p, i) => {
      const zi = this.zoneIndex(i);
      const zone = this.zones[zi];
      // A spectator has no hand of their own: the bottom seat's cards lie face down.
      if (zi === 0 && p.isHuman) this.layoutHumanHand(p);
      else this.layoutOpponentHand(p, zone);
      this.layoutBank(p, zone);
      this.layoutPiles(p, zone);
      this.updateLabel(p, i);
      const active = i === state.current && state.phase !== 'over';
      this.zoneMeshes[zi].material.opacity = active ? 0.95 : 0.35;
      this.zoneMeshes[zi].material.color.set(active ? 0xffd75e : 0xffffff);
    });

    this.layoutShowcase(state.showcase);

    // Online, a reshuffle swaps the discard pile for freshly numbered deck cards.
    for (const [id, obj] of this.cards) {
      if (this.seen.has(id)) continue;
      this.dropCard(obj);
      this.cards.delete(id);
      if (this.hoverId === id) this.hoverId = null;
    }
  }

  // A soft gold glow under every complete set; it fades out when the set breaks.
  glowFor(key) {
    let g = this.glows.get(key);
    if (!g) {
      const mat = new THREE.MeshBasicMaterial({ map: this.glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
      g = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      g.rotation.x = -Math.PI / 2;
      g.userData = { opacity: 0, pos: new THREE.Vector3(), size: new THREE.Vector2(1, 1), fresh: true };
      this.glows.set(key, g);
      this.zoneRoot.add(g);
    }
    return g;
  }

  // Labels sit beside their piles: deck to the left, discard to the right.
  positionPileLabel(kind, pos, side, text) {
    const l = this.labels.find((x) => x[kind]);
    if (!l) return;
    l.obj.position.set(pos.x + side * (CARD_W * 0.45 + 1.9), 0, pos.z);
    // HTML labels draw above the canvas, so hide them while cards are showcased.
    l.obj.visible = this.game.state.showcase.length === 0;
    l.div.textContent = text;
  }

  updateLabel(p, i) {
    const { div } = this.labels[i];
    const zi = this.zoneIndex(i);
    const sets = R.completeColors(p).size;
    const active = this.game.state.current === i && this.game.state.phase !== 'over';
    div.classList.toggle('active', active);
    div.classList.toggle('winner', this.game.state.winner === p);
    const hand = p.isHuman ? '' : `<span title="Cards in hand">🂠 ${p.hand.length}</span>`;
    const tag = p.tag ? `<span class="tag">${p.tag}</span>` : '';
    div.innerHTML = `<b>${tag}${esc(p.name)}</b><span class="stats"><span title="Bank">💰 $${R.bankTotal(p)}M</span><span title="Complete sets">🏘️ ${sets}/${R.SETS_TO_WIN}</span>${hand}</span>`;
    // Opponent labels wrap onto two lines when their zone is narrow on screen.
    if (zi !== 0) {
      const { x0, x1, z0 } = this.zones[zi].rect;
      const room = this.screenSpan(x0, x1, z0);
      div.style.maxWidth = `${Math.max(120, room - 8)}px`;
      div.classList.toggle('compact', room < 280);
    }
  }

  // On-screen width (CSS px) of a segment along the table's x axis.
  screenSpan(x0, x1, z) {
    const a = new THREE.Vector3(x0, 0, z).project(this.camera);
    const b = new THREE.Vector3(x1, 0, z).project(this.camera);
    return ((b.x - a.x) / 2) * this.container.clientWidth;
  }

  cameraFrame(depth) {
    const halfH = depth * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    return { halfH, halfW: halfH * this.camera.aspect };
  }

  // Cards in the human hand float in front of the camera like a held fan.
  layoutHumanHand(p) {
    const cards = p.hand;
    const n = cards.length;
    const { halfH, halfW } = this.cameraFrame(HAND_DEPTH);
    const scale = Math.min((halfH * 0.46) / CARD_H, (halfW * 0.2) / CARD_W);
    const cw = CARD_W * scale;
    // Keep the fan clear of the turn controls in the bottom-right corner.
    const width = this.container.clientWidth || 1;
    const maxRight = halfW * Math.max(0, Math.min(0.5, 1 - (2 * CONTROLS_PX) / width));
    const minLeft = -halfW * 0.96;
    const span = Math.min(halfW * 1.24, maxRight - minLeft, cw * 0.92 * Math.max(n - 1, 0) + cw);
    const step = n > 1 ? (span - cw) / (n - 1) : 0;
    const cx = Math.min(-halfW * 0.12, maxRight - span / 2);
    const camQ = this.camera.quaternion;
    cards.forEach((card, i) => {
      const t = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0;
      const hovered = card.id === this.hoverId;
      const x = cx + (i - (n - 1) / 2) * step;
      let y = -halfH + CARD_H * scale * 0.4 - t * t * 0.18 * scale;
      let z = -HAND_DEPTH + i * 0.03;
      let s = scale;
      let spin = -t * 0.05 * Math.min(n, 8) / 4;
      if (hovered) {
        y += CARD_H * scale * 0.3;
        z += 0.8;
        s *= 1.1;
        spin = 0;
      }
      const pos = this.camera.localToWorld(new THREE.Vector3(x, y, z));
      const quat = camQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, spin));
      const obj = this.objFor(card);
      obj.zone = { zone: 'hand', playerId: p.id };
      obj.setTarget(pos, quat, s, false);
    });
  }

  layoutOpponentHand(p, zone) {
    const n = p.hand.length;
    const s = zone.scale * 0.55;
    const step = Math.min(CARD_W * s * 0.42, 6 / Math.max(n, 1));
    p.hand.forEach((card, i) => {
      const off = i - (n - 1) / 2;
      const pos = new THREE.Vector3(zone.hand.x + off * step, 0.02 + i * 0.012, zone.hand.z + Math.abs(off) * 0.04);
      const obj = this.objFor(card);
      obj.zone = { zone: 'ohand', playerId: p.id };
      obj.setTarget(pos, tableQuat(-off * 0.06, false), s);
    });
  }

  layoutBank(p, zone) {
    const cards = p.bank.slice().sort((a, b) => b.value - a.value || a.id - b.id);
    const s = zone.scale * 0.9;
    const cw = CARD_W * s;
    const width = zone.bank.x1 - zone.bank.x0;
    const n = cards.length;
    const step = n > 1 ? Math.min(cw * 0.32, (width - cw) / (n - 1)) : 0;
    cards.forEach((card, i) => {
      const pos = new THREE.Vector3(zone.bank.x0 + cw / 2 + i * step, 0.012 + i * 0.016, zone.bank.z);
      const obj = this.objFor(card);
      obj.zone = { zone: 'bank', playerId: p.id };
      obj.setTarget(pos, tableQuat(0), s);
    });
  }

  layoutPiles(p, zone) {
    const s = zone.scale;
    const cw = CARD_W * s;
    const ch = CARD_H * s;
    const width = zone.props.x1 - zone.props.x0;
    const n = p.piles.length;
    const gap = 0.25 * s;
    const step = n > 1 ? Math.min(cw + gap, (width - cw) / (n - 1)) : 0;
    const cascade = ch * 0.17;
    for (const [key, g] of this.glows) if (key.startsWith(`${p.id}:`)) g.userData.opacity = 0;
    p.piles.forEach((pile, j) => {
      const x = zone.props.x0 + cw / 2 + j * step;
      const complete = R.isComplete(pile);
      const items = [...pile.cards, pile.house, pile.hotel].filter(Boolean);
      if (complete) {
        const g = this.glowFor(`${p.id}:${pile.id}`);
        const span = cascade * (items.length - 1);
        g.userData.opacity = 0.9;
        g.userData.pos.set(x, 0.006, zone.props.z + span / 2);
        g.userData.size.set(cw * 1.45, ch + span + cw * 0.45);
        if (g.userData.fresh) {
          g.position.copy(g.userData.pos);
          g.scale.set(g.userData.size.x, g.userData.size.y, 1);
          g.userData.fresh = false;
        }
      }
      items.forEach((card, k) => {
        const pos = new THREE.Vector3(x, 0.012 + k * 0.02, zone.props.z + k * cascade);
        const isBuilding = card.type === 'action';
        const spin = isBuilding ? -0.12 : isFlipped(card) ? Math.PI : 0;
        const obj = this.objFor(card);
        obj.zone = { zone: 'pile', playerId: p.id, pileId: pile.id, complete };
        obj.setTarget(pos, tableQuat(spin), s);
      });
    });
  }

  layoutShowcase(cards) {
    const n = cards.length;
    const s = 0.64;
    const step = CARD_W * s * 0.8;
    cards.forEach((card, i) => {
      const local = new THREE.Vector3((i - (n - 1) / 2) * step, 0.55, -SHOW_DEPTH + i * 0.05);
      const pos = this.camera.localToWorld(local);
      const quat = this.camera.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, (i - (n - 1) / 2) * -0.06));
      const obj = this.objFor(card);
      obj.zone = { zone: 'showcase' };
      obj.setTarget(pos, quat, s, false);
    });
  }

  // ---------- input ----------

  setPointer(x, y) {
    this.pointer.set(x, y);
    this.pointerDirty = true;
  }

  onPointerMove(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.setPointer(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  pick() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [];
    for (const obj of this.cards.values()) meshes.push(obj.front, obj.back);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    return hit ? this.cards.get(hit.object.userData.cardId) : null;
  }

  updateHover() {
    const obj = this.pick();
    const visible = obj && !obj.card.hidden && !['deck', 'ohand'].includes(obj.zone?.zone);
    const id = visible ? obj.card.id : null;
    if (id === this.hoverId) return;
    const prev = this.hoverId ? this.cards.get(this.hoverId) : null;
    this.hoverId = id;
    if (prev) prev.front.material.emissive.setHex(0x000000);
    if (visible) obj.front.material.emissive.setHex(0x2a2410);
    this.renderer.domElement.style.cursor = visible ? 'pointer' : 'default';
    if (prev?.zone?.zone === 'hand' || obj?.zone?.zone === 'hand') this.layout();
    this.handlers.hover(visible ? obj.card : null, visible ? obj.zone : null, this.pointer.x > 0.25 ? 'left' : 'right');
  }

  // Screen-space centre of a card (CSS pixels); used for debugging and tests.
  screenPosition(cardId) {
    const obj = this.cards.get(cardId);
    if (!obj) return null;
    const p = obj.group.position.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  onClick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.setPointer(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const obj = this.pick();
    if (obj && obj.zone) this.handlers.click(obj.card, obj.zone, e.clientX, e.clientY);
  }

  // ---------- frame loop ----------

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Keep the table's width in view on narrow windows by widening the vertical FOV.
    const refAspect = 16 / 9;
    const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) * refAspect);
    const needed = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hHalf) / aspect));
    this.camera.fov = Math.min(Math.max(BASE_FOV, needed), 75);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.layout();
  }

  frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    if (this.pointerDirty) {
      this.pointerDirty = false;
      this.updateHover();
    }
    const k = 1 - Math.exp(-dt * 9);
    for (const obj of this.cards.values()) obj.step(k);
    for (const g of this.glows.values()) {
      const u = g.userData;
      g.material.opacity += (u.opacity - g.material.opacity) * k * 0.6;
      g.visible = g.material.opacity > 0.01;
      if (u.opacity === 0) continue;
      g.position.lerp(u.pos, k);
      g.scale.x += (u.size.x - g.scale.x) * k;
      g.scale.y += (u.size.y - g.scale.y) * k;
    }
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.shadowColor = 'rgba(255, 210, 90, 1)';
  ctx.shadowBlur = 22;
  ctx.strokeStyle = 'rgba(255, 220, 120, 0.9)';
  ctx.lineWidth = 6;
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    ctx.roundRect(24, 24, 80, 112, 12);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function zonePlane(rect) {
  const w = rect.x1 - rect.x0;
  const h = rect.z1 - rect.z0;
  const px = 40;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * px);
  canvas.height = Math.round(h * px);
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.roundRect(6, 6, canvas.width - 12, canvas.height - 12, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fill();
  ctx.setLineDash([18, 12]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.35 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((rect.x0 + rect.x1) / 2, 0.004, (rect.z0 + rect.z1) / 2);
  return mesh;
}
