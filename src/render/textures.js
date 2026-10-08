// Draws card faces onto 2D canvases. Cached per card key.
import { COLORS, COLOR_ORDER, ACTIONS } from '../game/cards.js';

export const TEX_W = 400;
export const TEX_H = 560;
export const TEX_RADIUS = 30;

const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
const EMOJI = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
// Narrowest a name may be squeezed (of its width) before its font gets smaller.
const SQUEEZE = 0.85;

export const MONEY_COLORS = {
  1: ['#f4ead0', '#c8b27a'],
  2: ['#f7cfcf', '#d37c7c'],
  3: ['#d6ecc8', '#79ad5b'],
  4: ['#c9def4', '#5f8fc4'],
  5: ['#ddcdf0', '#8b67ba'],
  10: ['#f9d7a2', '#d68b2c'],
};

const cache = new Map();
const urlCache = new Map();

function makeCanvas() {
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = TEX_H;
  return c;
}

function setFont(ctx, size, weight = 'bold', family = FONT) {
  ctx.font = `${weight} ${size}px ${family}`;
}

function fitFont(ctx, text, maxW, size, weight = 'bold', min = 10) {
  for (; size > min; size--) {
    setFont(ctx, size, weight);
    if (ctx.measureText(text).width <= maxW) break;
  }
  return size;
}

function wrap(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function drawWrapped(ctx, text, cx, y, maxW, lineH) {
  const lines = wrap(ctx, text, maxW);
  lines.forEach((l, i) => ctx.fillText(l, cx, y + i * lineH));
  return lines.length;
}

// Shrinks the font until the wrapped text fits in maxLines (and no word is too wide).
function fitWrapped(ctx, text, maxW, maxLines, size, weight = 'bold', min = 12) {
  for (; size > min; size--) {
    setFont(ctx, size, weight);
    const lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) break;
  }
  return size;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Fills the whole canvas (not just the rounded rect) so the card mesh's rounded
// corners never sample transparent texels.
function base(ctx, fill = '#fdfcf7') {
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
}

function frame(ctx, color, inset = 16, width = 5) {
  rr(ctx, inset, inset, TEX_W - inset * 2, TEX_H - inset * 2, TEX_RADIUS - inset * 0.6);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function badge(ctx, x, y, value, ring = '#222', fill = '#fff', rotate = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotate);
  ctx.beginPath();
  ctx.arc(0, 0, 32, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = ring;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 25, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, `${value}M`, 44, 24, '800');
  ctx.fillText(`${value}M`, 0, 2);
  ctx.restore();
}

function drawMoney(ctx, card) {
  const [bg, ink] = MONEY_COLORS[card.value];
  base(ctx, bg);
  rr(ctx, 18, 18, TEX_W - 36, TEX_H - 36, 20);
  ctx.fillStyle = '#ffffffaa';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = ink;
  ctx.stroke();
  // guilloche-ish rings
  ctx.save();
  ctx.translate(TEX_W / 2, TEX_H / 2);
  for (let i = 0; i < 14; i++) {
    ctx.beginPath();
    ctx.ellipse(0, 0, 150 - i * 6, 210 - i * 8, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `${ink}${i % 2 ? '33' : '55'}`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, 118, 150, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.fillStyle = '#1b1b1b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = `$${card.value}M`;
  fitFont(ctx, label, 210, 120, '900');
  ctx.fillText(label, 0, 6);
  ctx.restore();
  badge(ctx, 58, 58, card.value, ink);
  badge(ctx, TEX_W - 58, TEX_H - 58, card.value, ink, '#fff', Math.PI);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  setFont(ctx, 20, '800');
  ctx.fillText('MONEY', TEX_W / 2, 56);
}

function propertyIcon(card) {
  if (card.color === 'railroad') return '🚂';
  if (card.name === 'Electric Company') return '💡';
  if (card.name === 'Water Works') return '🚰';
  return null;
}

function rentTable(ctx, color, x, y, w, rowH, textColor = '#222') {
  const info = COLORS[color];
  ctx.textBaseline = 'middle';
  info.rent.forEach((amount, i) => {
    const cy = y + i * rowH + rowH / 2;
    // stacked mini cards
    for (let k = 0; k <= i; k++) {
      rr(ctx, x + k * 6, cy - 18 - k * 2, 26, 34, 4);
      ctx.fillStyle = info.hex;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#222';
      ctx.stroke();
    }
    ctx.fillStyle = textColor;
    ctx.textAlign = 'left';
    setFont(ctx, 28, '800');
    ctx.fillText(String(i + 1), x + 42 + i * 6, cy);
    if (i === info.rent.length - 1) {
      setFont(ctx, 15, '800');
      ctx.fillText('FULL SET', x + 66 + i * 6, cy);
    }
    // dotted leader
    ctx.strokeStyle = `${textColor}66`;
    ctx.setLineDash([3, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + (i === info.rent.length - 1 ? 150 : 90) + i * 6, cy + 2);
    ctx.lineTo(x + w - 84, cy + 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'right';
    setFont(ctx, 36, '900');
    ctx.fillText(`$${amount}M`, x + w, cy);
  });
}

function drawProperty(ctx, card) {
  const info = COLORS[card.color];
  base(ctx);
  frame(ctx, '#2a2a2a', 14, 3);
  const hx = 24, hy = 24, hw = TEX_W - 48, hh = 150;
  rr(ctx, hx, hy, hw, hh, 12);
  ctx.fillStyle = info.hex;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#222';
  ctx.stroke();

  ctx.fillStyle = info.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  setFont(ctx, 15, '800');
  ctx.fillText('TITLE DEED', TEX_W / 2, hy + 26);
  // The name sits below the value badge, so it gets the band's full width (lines may
  // be squeezed a little to keep it big) and stays readable on small table cards. Its
  // first line is in the strip that still shows when the card is covered in a pile.
  const name = card.name.toUpperCase();
  const nameW = hw - 40;
  const size = fitWrapped(ctx, name, nameW / SQUEEZE, 2, 42, '900', 20);
  wrap(ctx, name, nameW / SQUEEZE).forEach((l, i) => ctx.fillText(l, TEX_W / 2, hy + 75 + i * size, nameW));
  const icon = propertyIcon(card);
  if (icon) {
    setFont(ctx, 34, 'normal', EMOJI);
    ctx.fillText(icon, TEX_W - 52, 52);
  }

  ctx.fillStyle = '#222';
  setFont(ctx, 20, '800');
  ctx.textAlign = 'center';
  ctx.fillText('RENT', TEX_W / 2, 204);
  const rows = info.rent.length;
  const rowH = Math.min(78, (TEX_H - 250) / rows);
  rentTable(ctx, card.color, 44, 226 + (4 - rows) * 12, TEX_W - 88, rowH);
  badge(ctx, 52, 52, card.value);
}

function wildHalf(ctx, color, value, flip) {
  const info = COLORS[color];
  ctx.save();
  if (flip) {
    ctx.translate(TEX_W, TEX_H);
    ctx.rotate(Math.PI);
  }
  const x = 24, y = 24, w = TEX_W - 48, h = TEX_H / 2 - 32;
  rr(ctx, x, y, w, h, 12);
  ctx.fillStyle = info.hex;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#222';
  ctx.stroke();
  ctx.fillStyle = info.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  setFont(ctx, 17, '800');
  ctx.fillText('PROPERTY WILD CARD', TEX_W / 2 + 22, y + 26);
  setFont(ctx, 42, '900');
  ctx.fillText(info.name.toUpperCase(), TEX_W / 2 + 22, y + 68, w - 100);
  // compact rent chips
  const n = info.rent.length;
  const chipW = Math.min(72, (w - 40) / n);
  const startX = TEX_W / 2 - (chipW * n) / 2;
  info.rent.forEach((amount, i) => {
    const cx = startX + i * chipW + chipW / 2;
    const cy = y + 150;
    rr(ctx, cx - chipW / 2 + 4, cy - 40, chipW - 8, 82, 10);
    ctx.fillStyle = '#ffffffe6';
    ctx.fill();
    ctx.fillStyle = '#333';
    setFont(ctx, 16, '800');
    ctx.fillText(`${i + 1}${i === n - 1 ? '★' : ''}`, cx, cy - 20);
    setFont(ctx, 24, '900');
    ctx.fillText(`$${amount}M`, cx, cy + 14);
  });
  badge(ctx, 52, 52, value);
  ctx.restore();
}

function drawWild(ctx, card) {
  base(ctx);
  frame(ctx, '#2a2a2a', 14, 3);
  if (card.anyColor) {
    ctx.save();
    rr(ctx, 24, 24, TEX_W - 48, TEX_H - 48, 14);
    ctx.clip();
    const stripe = (TEX_W + TEX_H) / COLOR_ORDER.length;
    COLOR_ORDER.forEach((color, i) => {
      ctx.beginPath();
      ctx.moveTo(i * stripe - TEX_H, TEX_H);
      ctx.lineTo(i * stripe, 0);
      ctx.lineTo((i + 1) * stripe, 0);
      ctx.lineTo((i + 1) * stripe - TEX_H, TEX_H);
      ctx.closePath();
      ctx.fillStyle = COLORS[color].hex;
      ctx.fill();
    });
    ctx.restore();
    rr(ctx, 54, 150, TEX_W - 108, 260, 20);
    ctx.fillStyle = '#ffffffee';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#222';
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    setFont(ctx, 30, '900');
    ctx.fillText('PROPERTY', TEX_W / 2, 196);
    ctx.fillText('WILD CARD', TEX_W / 2, 232);
    setFont(ctx, 19, '600');
    drawWrapped(ctx, 'Can be used as part of any property set. It has no monetary value.', TEX_W / 2, 282, TEX_W - 140, 26);
    return;
  }
  const [a, b] = card.colors;
  wildHalf(ctx, a, card.value, false);
  wildHalf(ctx, b, card.value, true);
  ctx.fillStyle = '#222';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  setFont(ctx, 14, '800');
  ctx.fillText('⇅ FLIP TO CHANGE COLOUR ⇅', TEX_W / 2, TEX_H / 2);
}

function actionShell(ctx, color, value, title, desc, label = 'ACTION CARD') {
  base(ctx);
  frame(ctx, color, 14, 6);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  setFont(ctx, 20, '900');
  ctx.fillText(label, TEX_W / 2 + 18, 54);
  setFont(ctx, 18, '600');
  ctx.fillStyle = '#333';
  const size = fitWrapped(ctx, desc, TEX_W - 80, 4, 21, '600', 14);
  drawWrapped(ctx, desc, TEX_W / 2, 432, TEX_W - 80, size * 1.25);
  badge(ctx, 52, 52, value, color);
}

function emblem(ctx, cx, cy, r, fill) {
  ctx.beginPath();
  ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#222';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (typeof fill === 'function') fill();
  else {
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#ffffff55');
    g.addColorStop(1, '#00000022');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#222';
  ctx.stroke();
}

function drawAction(ctx, card) {
  const def = ACTIONS[card.action];
  const isBuilding = card.action === 'house' || card.action === 'hotel';
  actionShell(ctx, def.color, def.value, def.name, def.desc);
  const cx = TEX_W / 2, cy = 232, r = 122;
  emblem(ctx, cx, cy, r, def.color);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (card.action === 'doublerent') {
    ctx.fillStyle = '#fff';
    setFont(ctx, 88, '900');
    ctx.fillText('×2', cx, cy - 26);
  } else {
    setFont(ctx, isBuilding ? 96 : 80, 'normal', EMOJI);
    ctx.fillText(def.icon, cx, cy - (isBuilding ? 18 : 30));
  }
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#00000088';
  ctx.lineWidth = 5;
  const title = def.name.toUpperCase();
  const size = fitWrapped(ctx, title, 210, 2, 34, '900', 18);
  const lines = wrap(ctx, title, 210);
  const ty = cy + (isBuilding ? 70 : 52) - ((lines.length - 1) * size) / 2;
  lines.forEach((l, i) => {
    ctx.strokeText(l, cx, ty + i * size * 1.02);
    ctx.fillText(l, cx, ty + i * size * 1.02);
  });
}

function drawRent(ctx, card) {
  const desc = card.anyColor
    ? 'Force one player to pay you rent for properties you own in one colour of your choice.'
    : 'All players pay you rent for properties you own in one of these colours.';
  const ring = card.anyColor ? '#333' : COLORS[card.colors[0]].hex;
  actionShell(ctx, ring, card.value, 'Rent', desc, card.anyColor ? 'WILD RENT' : 'RENT CARD');
  const cx = TEX_W / 2, cy = 232, r = 122;
  emblem(ctx, cx, cy, r, () => {
    ctx.save();
    ctx.clip();
    const colors = card.anyColor ? COLOR_ORDER : card.colors;
    const slice = (Math.PI * 2) / colors.length;
    colors.forEach((color, i) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r + 2, -Math.PI / 2 + i * slice - (card.anyColor ? 0 : Math.PI / 2), -Math.PI / 2 + (i + 1) * slice - (card.anyColor ? 0 : Math.PI / 2));
      ctx.closePath();
      ctx.fillStyle = COLORS[color].hex;
      ctx.fill();
    });
    ctx.restore();
  });
  ctx.beginPath();
  ctx.arc(cx, cy, 66, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#222';
  ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  setFont(ctx, 40, '900');
  ctx.fillText('RENT', cx, cy + 2);
}

function drawBack(ctx) {
  base(ctx, '#b3121f');
  rr(ctx, 18, 18, TEX_W - 36, TEX_H - 36, 20);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  // diagonal pattern
  ctx.save();
  rr(ctx, 26, 26, TEX_W - 52, TEX_H - 52, 16);
  ctx.clip();
  ctx.strokeStyle = '#ffffff18';
  ctx.lineWidth = 10;
  for (let i = -TEX_H; i < TEX_W + TEX_H; i += 28) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i - TEX_H, TEX_H);
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  ctx.translate(TEX_W / 2, TEX_H / 2);
  ctx.rotate(-0.42);
  rr(ctx, -175, -62, 350, 124, 18);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#111';
  ctx.stroke();
  ctx.fillStyle = '#b3121f';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  setFont(ctx, 46, '900');
  ctx.fillText('MONOPOLY', 0, -22);
  ctx.fillStyle = '#111';
  setFont(ctx, 44, '900');
  ctx.fillText('DEAL', 0, 30);
  ctx.restore();
}

// ---------- playing cards (Judgement) ----------

// The back of a playing card, passed wherever a card face would be.
export const PLAYING_BACK = { key: 'playing-back', type: 'playing-back' };

const SUIT_RED = '#c8102e';
// Four colours, so spades and clubs (and hearts and diamonds) are easy to tell apart.
const SUIT_INK = { spades: '#1b1b24', hearts: SUIT_RED, clubs: '#13803a', diamonds: '#1a5fd0' };
const suitColor = (suit) => SUIT_INK[suit];
const RANK_TEXT = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

// A suit symbol centred on (x, y), size tall, drawn as a path so it looks the
// same everywhere (font glyphs vary). color: other than the suit's own.
function drawSuit(ctx, suit, x, y, size, flip = false, color = suitColor(suit)) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, flip ? -size : size);
  ctx.fillStyle = color;
  ctx.beginPath();
  if (suit === 'hearts') {
    ctx.moveTo(0, 0.5);
    ctx.bezierCurveTo(-0.15, 0.35, -0.5, 0.12, -0.5, -0.17);
    ctx.bezierCurveTo(-0.5, -0.38, -0.35, -0.5, -0.25, -0.5);
    ctx.bezierCurveTo(-0.1, -0.5, 0, -0.4, 0, -0.28);
    ctx.bezierCurveTo(0, -0.4, 0.1, -0.5, 0.25, -0.5);
    ctx.bezierCurveTo(0.35, -0.5, 0.5, -0.38, 0.5, -0.17);
    ctx.bezierCurveTo(0.5, 0.12, 0.15, 0.35, 0, 0.5);
  } else if (suit === 'diamonds') {
    ctx.moveTo(0, -0.5);
    ctx.quadraticCurveTo(0.14, -0.2, 0.4, 0);
    ctx.quadraticCurveTo(0.14, 0.2, 0, 0.5);
    ctx.quadraticCurveTo(-0.14, 0.2, -0.4, 0);
    ctx.quadraticCurveTo(-0.14, -0.2, 0, -0.5);
  } else if (suit === 'spades') {
    ctx.moveTo(0, -0.5);
    ctx.bezierCurveTo(-0.07, -0.36, -0.5, -0.16, -0.5, 0.1);
    ctx.bezierCurveTo(-0.5, 0.3, -0.34, 0.38, -0.22, 0.38);
    ctx.bezierCurveTo(-0.12, 0.38, -0.05, 0.33, -0.03, 0.27);
    ctx.lineTo(-0.15, 0.5);
    ctx.lineTo(0.15, 0.5);
    ctx.lineTo(0.03, 0.27);
    ctx.bezierCurveTo(0.05, 0.33, 0.12, 0.38, 0.22, 0.38);
    ctx.bezierCurveTo(0.34, 0.38, 0.5, 0.3, 0.5, 0.1);
    ctx.bezierCurveTo(0.5, -0.16, 0.07, -0.36, 0, -0.5);
  } else {
    for (const [cx, cy] of [[0, -0.255], [-0.255, 0.08], [0.255, 0.08]]) {
      ctx.moveTo(cx + 0.245, cy);
      ctx.arc(cx, cy, 0.245, 0, Math.PI * 2);
    }
    ctx.moveTo(0.1, 0.02);
    ctx.arc(0, 0.02, 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-0.04, 0.05);
    ctx.quadraticCurveTo(-0.04, 0.4, -0.18, 0.5);
    ctx.lineTo(0.18, 0.5);
    ctx.quadraticCurveTo(0.04, 0.4, 0.04, 0.05);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Rank over suit in the top-left corner, and the same upside-down bottom-right.
function cornerIndex(ctx, card) {
  const text = RANK_TEXT[card.rank] ?? String(card.rank);
  for (const turn of [0, Math.PI]) {
    ctx.save();
    ctx.translate(TEX_W / 2, TEX_H / 2);
    ctx.rotate(turn);
    ctx.translate(-TEX_W / 2, -TEX_H / 2);
    ctx.fillStyle = suitColor(card.suit);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    fitFont(ctx, text, 84, 92, '800');
    ctx.fillText(text, 62, 112);
    drawSuit(ctx, card.suit, 62, 170, 74);
    ctx.restore();
  }
}

// Pip positions as (column, row) over the middle of the card; rows below the
// centre are drawn upside-down like a real deck.
const PIPS = {
  2: [[1, 0], [1, 1]],
  3: [[1, 0], [1, 0.5], [1, 1]],
  4: [[0, 0], [2, 0], [0, 1], [2, 1]],
  5: [[0, 0], [2, 0], [1, 0.5], [0, 1], [2, 1]],
  6: [[0, 0], [2, 0], [0, 0.5], [2, 0.5], [0, 1], [2, 1]],
  7: [[0, 0], [2, 0], [1, 0.25], [0, 0.5], [2, 0.5], [0, 1], [2, 1]],
  8: [[0, 0], [2, 0], [1, 0.25], [0, 0.5], [2, 0.5], [1, 0.75], [0, 1], [2, 1]],
  9: [[0, 0], [2, 0], [0, 1 / 3], [2, 1 / 3], [1, 0.5], [0, 2 / 3], [2, 2 / 3], [0, 1], [2, 1]],
  10: [[0, 0], [2, 0], [1, 1 / 6], [0, 1 / 3], [2, 1 / 3], [0, 2 / 3], [2, 2 / 3], [1, 5 / 6], [0, 1], [2, 1]],
};

// Court cards: a double-headed figure in red, blue and gold, the robe in the suit's
// colour (dark slate for spades). Each half is drawn upright, then the same again turned round.
const COURT_BLUE = '#2456a6';
// Robe and trim for each suit.
const ROBES = {
  spades: ['#2e3448', SUIT_RED],
  hearts: [SUIT_RED, COURT_BLUE],
  clubs: [SUIT_INK.clubs, SUIT_RED],
  diamonds: [SUIT_INK.diamonds, SUIT_RED],
};
const COURT_GOLD = '#f2b632';
const SKIN = '#f8d9b4';
const INK = '#1b1b24';
const PEARL = '#fffaf0';
// Hair and eyebrows: the jack's brown, the queen's golden, the king's white.
const HAIR = { 11: ['#7a4a26', '#4a2a12'], 12: ['#e0a63a', '#8a5a1e'], 13: ['#ece6da', '#8f897f'] };

function drawFigure(ctx, card, robe, trim) {
  const rank = card.rank;
  const [hair, brow] = HAIR[rank];
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Fills the current path and outlines it in ink.
  const paint = (fill, width = 2.5) => {
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = width;
    ctx.strokeStyle = INK;
    ctx.stroke();
  };
  const ellipse = (x, y, rx, ry, fill, width = 2.5) => {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    paint(fill, width);
  };
  const shape = (points, fill, width = 2.5) => {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    paint(fill, width);
  };
  // A staff: ink edges, then its colour down the middle.
  const rod = (x0, y0, x1, y1, color, width) => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineWidth = width + 4;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  };
  const line = (color, width) => {
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  };

  // The queen's long hair falls behind her shoulders.
  if (rank === 12) {
    ctx.beginPath();
    ctx.moveTo(-28, -172);
    ctx.bezierCurveTo(-52, -150, -44, -112, -58, -88);
    ctx.quadraticCurveTo(-30, -96, -20, -110);
    ctx.lineTo(20, -110);
    ctx.quadraticCurveTo(30, -96, 58, -88);
    ctx.bezierCurveTo(44, -112, 52, -150, 28, -172);
    ctx.closePath();
    paint(hair);
  }

  // Shoulders, and the gold-edged front of the robe with the suit on it.
  ctx.beginPath();
  ctx.moveTo(-88, 4);
  ctx.lineTo(-88, -52);
  ctx.bezierCurveTo(-88, -84, -60, -100, -24, -104);
  ctx.lineTo(24, -104);
  ctx.bezierCurveTo(60, -100, 88, -84, 88, -52);
  ctx.lineTo(88, 4);
  ctx.closePath();
  paint(robe, 3);
  shape([[-27, -104], [-34, 4], [34, 4], [27, -104]], COURT_GOLD);
  shape([[-20, -104], [-26, 4], [26, 4], [20, -104]], trim, 1.5);
  drawSuit(ctx, card.suit, 0, -70, 22, false, PEARL);
  drawSuit(ctx, card.suit, 0, -32, 22, false, PEARL);

  // Neck and collar: ermine for the king, pearls for the queen.
  ctx.beginPath();
  ctx.rect(-11, -124, 22, 22);
  paint(SKIN, 2);
  if (rank === 13) {
    ellipse(0, -102, 46, 13, PEARL);
    ctx.fillStyle = INK;
    for (const x of [-32, -16, 0, 16, 32]) {
      ctx.beginPath();
      ctx.ellipse(x, -100 - (Math.abs(x) > 20 ? 2 : 0), 2.5, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (rank === 12) {
    ellipse(0, -102, 40, 11, COURT_GOLD);
    for (let i = -3; i <= 3; i++) {
      const x = i * 10;
      ellipse(x, -102 + 11 * Math.sqrt(1 - (x / 40) ** 2) - 2, 3, 3, PEARL, 1.2);
    }
  } else {
    ellipse(0, -102, 36, 10, trim);
    ellipse(0, -103, 24, 5, COURT_GOLD, 1.5);
  }

  // Hair behind the head: the king's white, the jack's bob.
  if (rank === 13) ellipse(0, -148, 33, 30, hair);
  else if (rank === 11) {
    ctx.beginPath();
    ctx.roundRect(-34, -176, 68, 56, 20);
    paint(hair);
  }

  // The face.
  ellipse(0, -148, 27, 33, SKIN);
  ctx.fillStyle = 'rgba(232, 120, 120, 0.3)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(s * 15, -137, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const s of [-1, 1]) {
    ellipse(s * 10, -150, 6, 3.6, '#fff', 1.5);
    ctx.beginPath();
    ctx.arc(s * 9.5, -150, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = '#2a2a3a';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 16, -157);
    ctx.quadraticCurveTo(s * 10, -162, s * 4, -158);
    line(brow, 2.4);
  }
  ctx.beginPath();
  ctx.moveTo(1, -152);
  ctx.quadraticCurveTo(-5, -139, 2, -138);
  line('#b9805a', 2);
  if (rank === 12) ellipse(0, -128, 5.5, 2.8, SUIT_RED, 1);
  else if (rank === 11) {
    ctx.beginPath();
    ctx.arc(0, -132, 7, 0.2 * Math.PI, 0.8 * Math.PI);
    line('#9a3b2b', 2.2);
  } else {
    // The king's beard and moustache, over a glimpse of mouth.
    ctx.beginPath();
    ctx.moveTo(-5, -126);
    ctx.lineTo(5, -126);
    line('#9a3b2b', 2);
    ctx.beginPath();
    ctx.moveTo(-26, -140);
    ctx.bezierCurveTo(-30, -112, -14, -96, 0, -94);
    ctx.bezierCurveTo(14, -96, 30, -112, 26, -140);
    ctx.bezierCurveTo(18, -126, 8, -124, 0, -124);
    ctx.bezierCurveTo(-8, -124, -18, -126, -26, -140);
    ctx.closePath();
    paint(hair);
    ctx.beginPath();
    ctx.moveTo(0, -133);
    ctx.bezierCurveTo(-8, -138, -18, -136, -22, -128);
    ctx.bezierCurveTo(-14, -131, -6, -129, 0, -129);
    ctx.bezierCurveTo(6, -129, 14, -131, 22, -128);
    ctx.bezierCurveTo(18, -136, 8, -138, 0, -133);
    ctx.closePath();
    paint(hair, 2);
  }

  // Hair over the forehead.
  ctx.beginPath();
  ctx.moveTo(-27, -146);
  ctx.bezierCurveTo(-30, -176, -14, -184, 0, -183);
  ctx.bezierCurveTo(14, -184, 30, -176, 27, -146);
  ctx.bezierCurveTo(22, -160, 12, -168, 0, -166);
  ctx.bezierCurveTo(-12, -168, -22, -160, -27, -146);
  ctx.closePath();
  paint(hair, 2);

  // Headwear.
  if (rank === 13) {
    ellipse(0, -190, 24, 16, robe);
    shape([[-30, -174], [-34, -212], [-17, -194], [0, -218], [17, -194], [34, -212], [30, -174]], COURT_GOLD);
    ctx.beginPath();
    ctx.rect(-31, -186, 62, 13);
    paint(COURT_GOLD);
    ellipse(0, -179.5, 4, 4, trim, 1.5);
    for (const s of [-1, 1]) ellipse(s * 18, -179.5, 3, 3, robe, 1.5);
    for (const [x, y] of [[-34, -212], [0, -218], [34, -212]]) ellipse(x, y, 4, 4, COURT_GOLD, 1.5);
  } else if (rank === 12) {
    shape([[-24, -188], [-27, -205], [-12, -196], [0, -214], [12, -196], [27, -205], [24, -188]], COURT_GOLD);
    ctx.beginPath();
    ctx.rect(-24, -190, 48, 11);
    paint(COURT_GOLD);
    ellipse(0, -184.5, 3.5, 3.5, trim, 1.5);
    for (const [x, y] of [[-27, -205], [0, -214], [27, -205]]) ellipse(x, y, 3.5, 3.5, PEARL, 1.5);
  } else {
    // A feathered cap.
    ctx.beginPath();
    ctx.moveTo(-14, -192);
    ctx.bezierCurveTo(-30, -226, -56, -236, -66, -228);
    ctx.bezierCurveTo(-52, -222, -36, -208, -22, -186);
    ctx.closePath();
    paint(PEARL, 2);
    ctx.beginPath();
    ctx.moveTo(-17, -190);
    ctx.quadraticCurveTo(-40, -222, -63, -228);
    line(INK, 1.5);
    ctx.beginPath();
    ctx.moveTo(-30, -178);
    ctx.bezierCurveTo(-32, -214, 32, -214, 30, -178);
    ctx.closePath();
    paint(robe);
    ctx.beginPath();
    ctx.rect(-30, -188, 60, 8);
    paint(COURT_GOLD, 2);
    ellipse(0, -178, 42, 8, trim);
  }

  // What they hold, in front: a sceptre, a flower, a halberd.
  if (rank === 13) {
    rod(58, -40, 58, -196, COURT_GOLD, 5);
    ellipse(58, -203, 9, 9, COURT_GOLD, 2);
    rod(58, -212, 58, -226, COURT_GOLD, 3);
    rod(51, -219, 65, -219, COURT_GOLD, 3);
    ellipse(58, -50, 13, 6, COURT_GOLD, 2);
    ellipse(58, -62, 9, 9, SKIN, 2);
  } else if (rank === 12) {
    rod(54, -62, 61, -118, '#2c8a4b', 3);
    ctx.beginPath();
    ctx.moveTo(57, -90);
    ctx.quadraticCurveTo(74, -98, 78, -88);
    ctx.quadraticCurveTo(68, -82, 57, -90);
    ctx.closePath();
    paint('#3fa45f', 1.5);
    for (let i = 0; i < 5; i++) {
      const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
      ellipse(61 + 8 * Math.cos(a), -127 + 8 * Math.sin(a), 7, 7, '#e94b6a', 1.5);
    }
    ellipse(61, -127, 4, 4, COURT_GOLD, 1.5);
    ellipse(54, -49, 13, 6, COURT_GOLD, 2);
    ellipse(54, -60, 9, 9, SKIN, 2);
  } else {
    rod(62, -30, 62, -198, '#8a5a2b', 4);
    shape([[62, -232], [55, -204], [62, -196], [69, -204]], '#d5dbe2', 2);
    ctx.beginPath();
    ctx.moveTo(64, -196);
    ctx.quadraticCurveTo(84, -200, 86, -180);
    ctx.quadraticCurveTo(76, -186, 64, -184);
    ctx.closePath();
    paint('#d5dbe2', 2);
    ellipse(62, -54, 13, 6, COURT_GOLD, 2);
    ellipse(62, -66, 9, 9, SKIN, 2);
  }
}

function drawCourt(ctx, card) {
  const [robe, trim] = ROBES[card.suit];
  const x = 106, y = 34, w = TEX_W - 212, h = TEX_H - 68;
  rr(ctx, x, y, w, h, 12);
  ctx.fillStyle = '#fbf4e2';
  ctx.fill();
  for (const turn of [0, Math.PI]) {
    ctx.save();
    ctx.translate(TEX_W / 2, TEX_H / 2);
    ctx.rotate(turn);
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2, w, h / 2);
    ctx.clip();
    // A little larger than drawn, filling the frame.
    ctx.translate(0, 10);
    ctx.scale(1.1, 1.1);
    drawFigure(ctx, card, robe, trim);
    ctx.restore();
  }
  // A gold band between the halves, then the frame.
  ctx.fillStyle = INK;
  ctx.fillRect(x, TEX_H / 2 - 6, w, 12);
  ctx.fillStyle = COURT_GOLD;
  ctx.fillRect(x, TEX_H / 2 - 4, w, 8);
  rr(ctx, x, y, w, h, 12);
  ctx.lineWidth = 4;
  ctx.strokeStyle = suitColor(card.suit);
  ctx.stroke();
}

function drawPlaying(ctx, card) {
  base(ctx, '#fffdf8');
  rr(ctx, 10, 10, TEX_W - 20, TEX_H - 20, TEX_RADIUS - 8);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#d9d4c7';
  ctx.stroke();
  cornerIndex(ctx, card);
  if (card.rank === 14) {
    drawSuit(ctx, card.suit, TEX_W / 2, TEX_H / 2, 190);
  } else if (card.rank > 10) {
    drawCourt(ctx, card);
  } else {
    const cols = [148, 200, 252];
    const top = 128, bottom = TEX_H - 128;
    for (const [c, r] of PIPS[card.rank]) drawSuit(ctx, card.suit, cols[c], top + r * (bottom - top), 64, r > 0.5);
  }
}

function drawPlayingBack(ctx) {
  base(ctx, '#1d3461');
  rr(ctx, 18, 18, TEX_W - 36, TEX_H - 36, 20);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  // diamond lattice
  ctx.save();
  rr(ctx, 26, 26, TEX_W - 52, TEX_H - 52, 16);
  ctx.clip();
  ctx.strokeStyle = '#ffffff22';
  ctx.lineWidth = 4;
  for (let i = -TEX_H; i < TEX_W + TEX_H; i += 34) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i - TEX_H, TEX_H);
    ctx.moveTo(i - TEX_H, 0);
    ctx.lineTo(i, TEX_H);
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  ctx.translate(TEX_W / 2, TEX_H / 2);
  ctx.beginPath();
  ctx.ellipse(0, 0, 150, 92, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#f5c542';
  ctx.stroke();
  drawSuit(ctx, 'spades', -66, -38, 34);
  drawSuit(ctx, 'hearts', -22, -38, 34);
  drawSuit(ctx, 'clubs', 22, -38, 34);
  drawSuit(ctx, 'diamonds', 66, -38, 34);
  ctx.fillStyle = '#1d3461';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, 'JUDGEMENT', 250, 44, '900');
  ctx.fillText('JUDGEMENT', 0, 22);
  ctx.restore();
}

export function cardCanvas(card) {
  const key = card ? card.key : 'back';
  let canvas = cache.get(key);
  if (canvas) return canvas;
  canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  if (!card) drawBack(ctx);
  else if (card.type === 'playing') drawPlaying(ctx, card);
  else if (card.type === 'playing-back') drawPlayingBack(ctx);
  else if (card.type === 'money') drawMoney(ctx, card);
  else if (card.type === 'property') drawProperty(ctx, card);
  else if (card.type === 'wild') drawWild(ctx, card);
  else if (card.type === 'action') drawAction(ctx, card);
  else if (card.type === 'rent') drawRent(ctx, card);
  cache.set(key, canvas);
  return canvas;
}

// An image URL for a card face (null: the back), ready straight away.
export function cardImageURL(card) {
  const key = card ? card.key : 'back';
  let url = urlCache.get(key);
  if (!url) {
    url = cardCanvas(card).toDataURL('image/png');
    urlCache.set(key, url);
  }
  return url;
}

// The same, encoded off the main thread: the table loads faces this way so a deal
// doesn't stall while dozens of cards are drawn.
const blobCache = new Map();
export function loadCardImage(card) {
  const key = card ? card.key : 'back';
  let url = blobCache.get(key);
  if (!url) {
    const canvas = cardCanvas(card);
    url = new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : cardImageURL(card)), 'image/png'));
    blobCache.set(key, url);
  }
  return url;
}

// Two-colour wilds are shown upside-down when assigned to their second colour.
export function isFlipped(card) {
  return card.type === 'wild' && !card.anyColor && card.color === card.colors[1];
}
