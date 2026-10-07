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
const ASPECT = CARD_H / CARD_W;
// The classic table (opponents across the top) when it shows the local player's
// cards at least this wide (px), or unless a row layout shows them this much bigger.
const CLASSIC_PX = 60;
const CLASSIC_BIAS = 1.15;
// Opponent card scale by number of opponents, and gaps between rows (table units).
const OPP_SCALE = [0, 1.05, 1, 0.92, 0.78];
const ROW_SCALE = [0, 0.9, 0.8, 0.7, 0.62];
const ROW_GAP = 0.5;
const DECK_ROW = 3.7;

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const FLAT = new THREE.Quaternion().setFromAxisAngle(X_AXIS, -Math.PI / 2);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
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

// ---------- table layouts ----------
// A layout places each player's zone (zone 0 is the local player), the deck and the
// discard pile, sizes the table and says where the camera looks from.

// Wide screens: opponents side by side across the top, the local player along the bottom.
function classicLayout(n) {
  const zones = [{
    scale: 1.05,
    hand: { x: 0, z: 3.6 },
    bank: { x0: -20.4, x1: -13.2, z: -0.4 },
    props: { x0: -12.2, x1: 20.6, z: -0.4 },
    rect: { x0: -21.2, x1: 21.2, z0: -2.7, z1: 5.6 },
    label: new THREE.Vector3(-17.2, 0, -2.7),
  }];
  const k = n - 1;
  const gap = 0.9;
  const left = -21.2, right = 21.2;
  const w = (right - left - gap * (k - 1)) / k;
  const scale = OPP_SCALE[k];
  for (let i = 0; i < k; i++) {
    const x0 = left + i * (w + gap);
    const x1 = x0 + w;
    const cw = CARD_W * scale;
    const bankW = Math.min(Math.max(cw * 1.6, w * 0.24), cw * 2.6);
    zones.push({
      scale,
      hand: { x: (x0 + x1) / 2, z: -18.7 },
      bank: { x0: x0 + 0.5, x1: x0 + 0.5 + bankW, z: -14.3 },
      props: { x0: x0 + 1.0 + bankW, x1: x1 - 0.5, z: -14.3 },
      rect: { x0, x1, z0: -20.4, z1: -8.6 },
      label: new THREE.Vector3((x0 + x1) / 2, 0, -20.4),
    });
  }
  return {
    key: `classic:${n}`,
    zones,
    deck: new THREE.Vector3(-1.8, 0, -5.5),
    discard: new THREE.Vector3(1.8, 0, -5.5),
    bounds: { x0: left, x1: right, z0: -20.4, z1: 5.6 },
    table: { w: 50, d: 36, cz: -6.5 },
    eye: new THREE.Vector3(0, 33, 19),
    target: new THREE.Vector3(0, 0, -3.2),
  };
}

// Depth of one line of property piles (room for a set plus a building) and of a row
// zone with its label.
const lineDepth = (scale) => CARD_H * scale * 1.51 + 0.3;
const rowHeight = (scale, lines = 1) => 0.9 + CARD_H * scale * 1.34 + (lines - 1) * lineDepth(scale) + 0.4;

// A zone laid out as a row: the label on its top edge, the bank on the left, then the
// properties (on one or more lines) and, for opponents, a small face-down hand.
function rowZone(x0, x1, z0, scale, opponent, lines) {
  const cw = CARD_W * scale;
  const w = x1 - x0;
  const z = z0 + 0.9 + (CARD_H * scale) / 2;
  const z1 = z0 + rowHeight(scale, lines);
  const bankW = Math.min(Math.max(cw * 1.6, w * 0.2), cw * 2.6);
  const handW = opponent ? Math.min(cw * 1.8, w * 0.2) : 0;
  return {
    scale,
    hand: opponent ? { x: x1 - 0.4 - handW / 2, z, span: handW, scale: scale * 0.6 } : { x: 0, z: z1 + 1.6 },
    bank: { x0: x0 + 0.4, x1: x0 + 0.4 + bankW, z },
    props: { x0: x0 + 0.9 + bankW, x1: x1 - 0.4 - (opponent ? handW + 0.5 : 0), z, lines, lineDepth: lineDepth(scale) },
    rect: { x0, x1, z0, z1 },
    label: new THREE.Vector3(x0 + 0.5, 0, z0),
    labelLeft: true,
  };
}

// Tall or short screens: opponents in rows of `cols` across, then the deck and
// discard, then the local player's row across the full width. `aspect` is the shape
// of the space on screen: the table widens to match it, and on screens taller than
// the table the cards grow and properties get a second line.
function rowsLayout(n, cols, aspect) {
  const k = n - 1;
  const rows = Math.ceil(k / cols);
  const elev = THREE.MathUtils.degToRad(62);
  const depthFor = (s, hs, oppLines = 1, myLines = 1) =>
    rows * rowHeight(s, oppLines) + (rows - 1) * ROW_GAP + ROW_GAP + DECK_ROW + ROW_GAP + rowHeight(hs, myLines);
  // Never so narrow that a row can't show a few piles side by side.
  const base = ROW_SCALE[k];
  const minW = Math.max(17, cols * 19.5 * base + (cols - 1) * 0.6);
  const room = minW / (aspect * Math.sin(elev));
  const maxS = Math.min(1.05, (minW - (cols - 1) * 0.6) / cols / 16.5);
  const scales = (g) => [Math.min(base * g, maxS), Math.min(g, 1.3)];
  // The most the cards can grow (in steps of 5%) with the given lines of properties.
  const grow = (oppLines, myLines) => {
    let lo = 1, hi = 2.5;
    for (let i = 0; i < 16; i++) {
      const g = (lo + hi) / 2;
      if (depthFor(...scales(g), oppLines, myLines) <= room) lo = g;
      else hi = g;
    }
    return Math.floor(lo * 20) / 20;
  };
  // Spare depth goes to bigger cards, then a second line of properties for the local
  // player, then one for the opponents, as long as the cards stay this much bigger.
  let [oppLines, myLines, g] = [1, 1, grow(1, 1)];
  for (const [o, m, need] of [[1, 2, 1], [2, 2, 1.4]]) {
    const more = grow(o, m);
    if (more < need || depthFor(...scales(more), o, m) > room) break;
    [oppLines, myLines, g] = [o, m, more];
  }
  const [s, hs] = scales(g);
  const depth = depthFor(s, hs, oppLines, myLines);
  const W = Math.round(Math.max(minW, Math.min(56, aspect * depth * Math.sin(elev))) * 4) / 4;
  const z0 = -6.5 - depth / 2;
  const cellW = (W - (cols - 1) * 0.6) / cols;
  const oppH = rows * rowHeight(s, oppLines) + (rows - 1) * ROW_GAP;
  const zones = [null];
  for (let i = 0; i < k; i++) {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, k - row * cols);
    const x0 = -W / 2 + (W - inRow * cellW - (inRow - 1) * 0.6) / 2 + (i % cols) * (cellW + 0.6);
    zones.push(rowZone(x0, x0 + cellW, z0 + row * (rowHeight(s, oppLines) + ROW_GAP), s, true, oppLines));
  }
  const deckZ = z0 + oppH + ROW_GAP + DECK_ROW / 2;
  const humanZ0 = z0 + oppH + ROW_GAP + DECK_ROW + ROW_GAP;
  zones[0] = rowZone(-W / 2, W / 2, humanZ0, hs, false, myLines);
  const z1 = humanZ0 + rowHeight(hs, myLines);
  const target = new THREE.Vector3(0, 0, (z0 + z1) / 2);
  const dist = Math.max(depth, W / 1.5) * 1.6 + 16;
  return {
    key: `rows:${n}:${cols}:${W}:${g}:${oppLines}${myLines}`,
    zones,
    deck: new THREE.Vector3(-1.8, 0, deckZ),
    discard: new THREE.Vector3(1.8, 0, deckZ),
    bounds: { x0: -W / 2 - 0.2, x1: W / 2 + 0.2, z0, z1 },
    table: { w: W + 4, d: depth + 12, cz: (z0 - 4 + z1 + 8) / 2 },
    eye: new THREE.Vector3(0, Math.sin(elev) * dist, target.z + Math.cos(elev) * dist),
    target,
  };
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
    this.scene.add(this.camera);

    this.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.table = buildTable(this.scene, this.renderer);

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
    this.zoneMeshRoot = new THREE.Group();
    this.scene.add(this.zoneMeshRoot);
    this.zoneMeshes = [];
    this.layoutKey = null;
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
    // Screen space (CSS px) the HUD covers; main.js hooks this up to the HUD.
    this.insets = () => ({ top: 0, bottom: 0, right: 320, portrait: false });

    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    // Touch has no hover: a tap shows the card (preview, raised hand card) until the
    // next tap somewhere else.
    el.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && this.onPointerMove(e));
    el.addEventListener('pointerleave', (e) => e.pointerType !== 'touch' && this.setPointer(-10, -10));
    document.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && e.target !== el && this.setPointer(-10, -10), true);
    el.addEventListener('click', (e) => this.onClick(e));
    new ResizeObserver(() => this.resize()).observe(container);
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
    this.buildLabels(game);
    this.fit();
    this.placeLabels();
    for (const card of game.allCards) this.objFor(card);
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
      // Cards that appear mid-game (an online deck reshuffle) rise from the discard pile.
      obj.base.set(this.discardPos.x, 0.3, this.discardPos.z);
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

  // Switches to a new table layout: zone outlines, label spots and the table itself.
  useLayout(l) {
    this.layoutKey = l.key;
    this.zones = l.zones;
    this.deckPos = l.deck;
    this.discardPos = l.discard;
    this.table.setSize(l.table.w, l.table.d, l.table.cz);
    for (const mesh of this.zoneMeshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.map.dispose();
      mesh.material.dispose();
    }
    this.zoneMeshes = l.zones.map((z) => {
      const mesh = zonePlane(z.rect);
      this.zoneMeshRoot.add(mesh);
      return mesh;
    });
    this.placeLabels();
  }

  buildLabels(game) {
    for (const l of this.labels) l.obj.removeFromParent();
    this.labels = game.state.players.map((p) => {
      const div = document.createElement('div');
      div.className = `plabel ${p.isHuman ? 'human' : ''}`;
      const obj = new CSS2DObject(div);
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

  // Name labels sit on the top edge of each zone: centred, or at the left of a row.
  placeLabels() {
    if (!this.game) return;
    this.game.state.players.forEach((p, i) => {
      const zone = this.zones[this.zoneIndex(i)];
      const { obj, div } = this.labels[i];
      obj.position.copy(zone.label);
      obj.center.set(zone.labelLeft ? 0 : 0.5, 0.5);
      div.classList.toggle('row', !!zone.labelLeft);
    });
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
    const { deckPos, discardPos } = this;
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
    // Opponent labels wrap onto two lines (or, along a row, cut the name short) when
    // their zone is narrow on screen.
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
    return ((b.x - a.x) / 2) * this.size.w;
  }

  // The point in camera space at the given depth that shows at screen pixel (px, py).
  screenToCamera(px, py, depth) {
    const { w, h } = this.size;
    const ndcZ = new THREE.Vector3(0, 0, -depth).applyMatrix4(this.camera.projectionMatrix).z;
    return new THREE.Vector3((px / w) * 2 - 1, 1 - (py / h) * 2, ndcZ).applyMatrix4(this.camera.projectionMatrixInverse);
  }

  // Targets a card floating in front of the camera: centred on pixel (px, py), pxW wide.
  floatAt(obj, px, py, pxW, depth, spin) {
    const a = this.screenToCamera(px, py, depth);
    const scale = (this.screenToCamera(px + pxW, py, depth).x - a.x) / CARD_W;
    const quat = this.camera.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, spin));
    obj.setTarget(this.camera.localToWorld(a), quat, scale, false);
  }

  // Width (CSS px) of a card in the local hand, and how much of it shows above the
  // bottom of the screen.
  handMetrics() {
    const { w, h } = this.size;
    const { portrait } = this.inset;
    const width = Math.min((0.23 * h) / ASPECT, w * (portrait ? 0.21 : 0.1));
    return { width, visible: width * ASPECT * (portrait ? 0.72 : h < 500 ? 0.75 : 0.9), portrait };
  }

  // Cards in the human hand float in front of the camera like a held fan.
  layoutHumanHand(p) {
    const cards = p.hand;
    const n = cards.length;
    const { w, h } = this.size;
    const { width: cw, visible, portrait } = this.handMetrics();
    const ch = cw * ASPECT;
    const half = w / 2;
    // Keep the fan clear of the turn controls in the bottom-right corner. In portrait
    // they sit above the hand, so the fan can use the full width.
    const maxRight = portrait ? half - 6 : half * Math.max(0, Math.min(0.5, 1 - (2 * this.inset.right) / w));
    const minLeft = portrait ? -maxRight : -half * 0.96;
    const span = Math.min(portrait ? Infinity : half * 1.24, maxRight - minLeft, cw * 0.92 * Math.max(n - 1, 0) + cw);
    const step = n > 1 ? (span - cw) / (n - 1) : 0;
    const cx = half + (portrait ? 0 : Math.min(-half * 0.12, maxRight - span / 2));
    cards.forEach((card, i) => {
      const t = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0;
      const x = cx + (i - (n - 1) / 2) * step;
      let y = h - visible + ch / 2 + t * t * 0.054 * ch;
      let size = cw;
      let depth = HAND_DEPTH - i * 0.03;
      let spin = (-t * 0.05 * Math.min(n, 8)) / 4;
      if (card.id === this.hoverId) {
        y -= ch * (portrait ? 0.24 : 0.3);
        size *= 1.2;
        depth -= 0.8;
        spin = 0;
      }
      const obj = this.objFor(card);
      obj.zone = { zone: 'hand', playerId: p.id };
      this.floatAt(obj, x, y, size, depth, spin);
    });
  }

  layoutOpponentHand(p, zone) {
    const n = p.hand.length;
    const s = zone.hand.scale ?? zone.scale * 0.55;
    let step = Math.min(CARD_W * s * 0.42, 6 / Math.max(n, 1));
    if (zone.hand.span && n > 1) step = Math.min(step, (zone.hand.span - CARD_W * s) / (n - 1));
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
    const gap = 0.25 * s;
    // Wrap onto the zone's extra lines (if any) once the piles would have to overlap.
    const fit = Math.floor((width - cw) / (cw + gap)) + 1;
    const lines = Math.min(zone.props.lines ?? 1, Math.ceil(p.piles.length / fit));
    const n = Math.ceil(p.piles.length / lines);
    const step = n > 1 ? Math.min(cw + gap, (width - cw) / (n - 1)) : 0;
    const cascade = ch * 0.17;
    for (const [key, g] of this.glows) if (key.startsWith(`${p.id}:`)) g.userData.opacity = 0;
    p.piles.forEach((pile, j) => {
      const x = zone.props.x0 + cw / 2 + (j % n) * step;
      const z = zone.props.z + Math.floor(j / n) * (zone.props.lineDepth ?? 0);
      const complete = R.isComplete(pile);
      const items = [...pile.cards, pile.house, pile.hotel].filter(Boolean);
      if (complete) {
        const g = this.glowFor(`${p.id}:${pile.id}`);
        const span = cascade * (items.length - 1);
        g.userData.opacity = 0.9;
        g.userData.pos.set(x, 0.006, z + span / 2);
        g.userData.size.set(cw * 1.45, ch + span + cw * 0.45);
        if (g.userData.fresh) {
          g.position.copy(g.userData.pos);
          g.scale.set(g.userData.size.x, g.userData.size.y, 1);
          g.userData.fresh = false;
        }
      }
      items.forEach((card, k) => {
        const pos = new THREE.Vector3(x, 0.012 + k * 0.02, z + k * cascade);
        const isBuilding = card.type === 'action';
        const spin = isBuilding ? -0.12 : isFlipped(card) ? Math.PI : 0;
        const obj = this.objFor(card);
        obj.zone = { zone: 'pile', playerId: p.id, pileId: pile.id, complete };
        obj.setTarget(pos, tableQuat(spin), s);
      });
    });
  }

  // Cards being played are held up in the middle of the table area.
  layoutShowcase(cards) {
    const n = cards.length;
    const { w, h } = this.size;
    const size = Math.min((0.35 * h) / ASPECT, (0.9 * w) / (1 + 0.8 * (n - 1)));
    const cy = (this.safe.y0 + this.safe.y1) / 2;
    cards.forEach((card, i) => {
      const off = i - (n - 1) / 2;
      const obj = this.objFor(card);
      obj.zone = { zone: 'showcase' };
      this.floatAt(obj, w / 2 + off * size * 0.8, cy, size, SHOW_DEPTH - i * 0.05, off * -0.06);
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
    // The preview goes where it won't cover the card: the other side, or in portrait
    // the other half of the screen.
    const side = this.inset.portrait ? (this.pointer.y > 0 ? 'low' : 'high') : this.pointer.x > 0.25 ? 'left' : 'right';
    this.handlers.hover(visible ? obj.card : null, visible ? obj.zone : null, side);
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
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    // Resizing the canvas clears it, so only do it when the size really changed.
    if (w !== this.size?.w || h !== this.size?.h) {
      this.renderer.setSize(w, h);
      this.labelRenderer.setSize(w, h);
    }
    this.size = { w, h };
    this.inset = this.insets();
    // The HUD keeps the status row clear of the hand.
    document.documentElement.style.setProperty('--hand-h', `${Math.round(this.handMetrics().visible)}px`);
    this.fit();
    this.layout();
  }

  // Picks the layout that shows the local player's cards biggest on this screen and
  // aims the camera so it fills the space between the top bar and the hand.
  fit() {
    const { w, h } = this.size;
    const hand = this.handMetrics();
    const y0 = this.inset.top + 14;
    const y1 = Math.max(y0 + 80, h - hand.visible - this.inset.bottom - 6);
    this.safe = { x0: 6, x1: w - 6, y0, y1 };
    const n = this.game?.state.players.length ?? 4;
    const aspect = (w - 12) / (y1 - y0);
    const classic = classicLayout(n);
    const classicScore = this.aim(classic);
    // The row layout with the biggest cards (counting the opponents' at half).
    let best = null;
    for (let cols = 1; cols < n; cols++) {
      // Perspective makes the far rows look smaller than rowsLayout guesses, so
      // measure the result and correct the shape it aims for until it fills the space.
      let eff = aspect;
      let pick = null;
      for (let i = 0; i < 5; i++) {
        const l = rowsLayout(n, cols, eff);
        const score = this.aim(l);
        const fill = this.fillRatio;
        const total = score + 0.5 * this.screenSpan(l.zones[1].props.x0, l.zones[1].props.x0 + CARD_W * l.zones[1].scale, l.zones[1].props.z);
        if (!pick || total > pick.total) pick = { l, score, total };
        if (Math.abs(fill.x - fill.y) < 0.03) break;
        eff *= fill.y / fill.x;
      }
      if (!best || pick.total > best.total) best = pick;
    }
    if (classicScore >= CLASSIC_PX || classicScore * CLASSIC_BIAS >= best.score) best = { l: classic };
    this.aim(best.l);
    if (best.l.key !== this.layoutKey) this.useLayout(best.l);
  }

  // Points the camera for a layout, then zooms and shifts the picture so the layout's
  // bounds just fit the safe area (recording in fillRatio how much of each axis they
  // fill). Returns the on-screen width (px) of one of the local player's property cards.
  aim(l) {
    const { w, h } = this.size;
    const cam = this.camera;
    cam.position.copy(l.eye);
    cam.lookAt(l.target);
    cam.fov = BASE_FOV;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const { x0, x1, z0, z1 } = l.bounds;
    const box = new THREE.Box2();
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      const p = new THREE.Vector3(x, 0, z).project(cam);
      box.expandByPoint(new THREE.Vector2(p.x, p.y));
    }
    const s = this.safe;
    const sx0 = (s.x0 / w) * 2 - 1, sx1 = (s.x1 / w) * 2 - 1;
    const sy0 = 1 - (s.y1 / h) * 2, sy1 = 1 - (s.y0 / h) * 2;
    const k = Math.min((sx1 - sx0) / (box.max.x - box.min.x), (sy1 - sy0) / (box.max.y - box.min.y));
    this.fillRatio = { x: (k * (box.max.x - box.min.x)) / (sx1 - sx0), y: (k * (box.max.y - box.min.y)) / (sy1 - sy0) };
    const tx = (sx0 + sx1 - k * (box.min.x + box.max.x)) / 2;
    const ty = (sy0 + sy1 - k * (box.min.y + box.max.y)) / 2;
    cam.projectionMatrix.premultiply(new THREE.Matrix4().set(k, 0, 0, tx, 0, k, 0, ty, 0, 0, 1, 0, 0, 0, 0, 1));
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    const { props, scale } = l.zones[0];
    return this.screenSpan(props.x0, props.x0 + CARD_W * scale, props.z);
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
