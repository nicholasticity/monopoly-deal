// Draws card faces onto 2D canvases. Cached per card key.
import { COLORS, COLOR_ORDER, ACTIONS } from '../game/cards.js';

export const TEX_W = 400;
export const TEX_H = 560;
export const TEX_RADIUS = 30;

const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
const EMOJI = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

const MONEY_COLORS = {
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

// Shrinks the font until the wrapped text fits in maxLines.
function fitWrapped(ctx, text, maxW, maxLines, size, weight = 'bold', min = 12) {
  for (; size > min; size--) {
    setFont(ctx, size, weight);
    if (wrap(ctx, text, maxW).length <= maxLines) break;
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
    setFont(ctx, 24, '800');
    ctx.fillText(String(i + 1), x + 44 + i * 6, cy);
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
    ctx.lineTo(x + w - 70, cy + 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'right';
    setFont(ctx, 30, '900');
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
  ctx.fillText('TITLE DEED', TEX_W / 2, hy + 24);
  const name = card.name.toUpperCase();
  const size = fitWrapped(ctx, name, hw - 90, 2, 36, '900');
  const lines = wrap(ctx, name, hw - 90);
  const icon = propertyIcon(card);
  const top = hy + (icon ? 66 : 80) - ((lines.length - 1) * size * 1.05) / 2;
  lines.forEach((l, i) => ctx.fillText(l, TEX_W / 2, top + i * size * 1.05));
  if (icon) {
    setFont(ctx, 34, 'normal', EMOJI);
    ctx.fillText(icon, TEX_W / 2, hy + hh - 26);
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
  setFont(ctx, 34, '900');
  ctx.fillText(info.name.toUpperCase(), TEX_W / 2 + 22, y + 66);
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

export function cardCanvas(card) {
  const key = card ? card.key : 'back';
  let canvas = cache.get(key);
  if (canvas) return canvas;
  canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  if (!card) drawBack(ctx);
  else if (card.type === 'money') drawMoney(ctx, card);
  else if (card.type === 'property') drawProperty(ctx, card);
  else if (card.type === 'wild') drawWild(ctx, card);
  else if (card.type === 'action') drawAction(ctx, card);
  else if (card.type === 'rent') drawRent(ctx, card);
  cache.set(key, canvas);
  return canvas;
}

export function cardImageURL(card) {
  const key = card ? card.key : 'back';
  let url = urlCache.get(key);
  if (!url) {
    url = cardCanvas(card).toDataURL('image/png');
    urlCache.set(key, url);
  }
  return url;
}

// Two-colour wilds are shown upside-down when assigned to their second colour.
export function isFlipped(card) {
  return card.type === 'wild' && !card.anyColor && card.color === card.colors[1];
}
