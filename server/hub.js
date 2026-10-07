// WebSocket endpoint (/ws) that routes client messages to rooms. Attach it to any
// Node HTTP server: the production server and the Vite dev server both do.
import { WebSocketServer } from 'ws';
import { randomInt } from 'node:crypto';
import { Room } from './room.js';

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 4;
const MAX_ROOMS = 500;
const PING_MS = 25_000;
// Abuse limits for a public server. Generous for real players; they only stop scripts.
const LIMITS = {
  connections: 1000, // open sockets in total
  perIp: 16, // open sockets from one address (a household shares one)
  messages: 120, // messages per socket per 10 s
  roomEntries: 30, // creates + joins from one address per minute
};

// Behind a hosting proxy (Render, Fly…) the client's address is in X-Forwarded-For.
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || '?';
}

export function attachGameServer(httpServer, { path = '/ws', log = console.log, timeScale = 1, limits = {} } = {}) {
  const limit = { ...LIMITS, ...limits };
  const rooms = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const socketsPerIp = new Map();
  const entriesPerIp = new Map(); // ip -> timestamps of recent creates/joins

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname !== path) return;
    const ip = clientIp(req);
    if (wss.clients.size >= limit.connections || (socketsPerIp.get(ip) || 0) >= limit.perIp) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, ip));
  });

  // Stops room-code guessing and room spam from one address.
  const allowEntry = (ip) => {
    const now = Date.now();
    const recent = (entriesPerIp.get(ip) || []).filter((t) => now - t < 60_000);
    if (recent.length >= limit.roomEntries) return false;
    recent.push(now);
    entriesPerIp.set(ip, recent);
    return true;
  };

  const newCode = () => {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_LETTERS[randomInt(CODE_LETTERS.length)];
      if (!rooms.has(code)) return code;
    }
  };

  const closeRoom = (room) => {
    rooms.delete(room.code);
    log(`[rooms] closed ${room.code} (${rooms.size} open)`);
  };

  // Keeps idle sockets alive through proxies and reaps dead ones.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
    const now = Date.now();
    for (const [ip, times] of entriesPerIp) if (times.every((t) => now - t >= 60_000)) entriesPerIp.delete(ip);
  }, PING_MS);
  wss.on('close', () => clearInterval(heartbeat));
  httpServer.on('close', () => wss.close());

  wss.on('connection', (ws, req, ip) => {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    socketsPerIp.set(ip, (socketsPerIp.get(ip) || 0) + 1);
    let windowStart = Date.now();
    let windowCount = 0;
    const conn = {
      room: null,
      member: null,
      send(msg) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      drop() {
        ws.close(4000, 'replaced');
      },
    };

    const enter = (room, msg) => {
      if (conn.member) conn.room.leave(conn.member);
      const clientId = typeof msg.clientId === 'string' ? msg.clientId.slice(0, 64) : '';
      if (!clientId) return conn.send({ type: 'error', message: 'Missing client id.', fatal: true });
      const result = room.join(conn, clientId, msg.name);
      if (typeof result === 'string') conn.send({ type: 'error', message: result, fatal: true });
    };

    ws.on('message', (data) => {
      const now = Date.now();
      if (now - windowStart > 10_000) {
        windowStart = now;
        windowCount = 0;
      }
      if (++windowCount > limit.messages) return ws.close(1008, 'too many messages');
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;
      const { room, member } = conn;
      try {
        switch (msg.type) {
          case 'create': {
            if (!allowEntry(ip)) return conn.send({ type: 'error', message: 'Too many attempts. Wait a minute and try again.', fatal: true });
            if (rooms.size >= MAX_ROOMS) return conn.send({ type: 'error', message: 'The server is full right now. Try again later.', fatal: true });
            const fresh = new Room(newCode(), closeRoom, { timeScale });
            rooms.set(fresh.code, fresh);
            log(`[rooms] opened ${fresh.code} (${rooms.size} open)`);
            enter(fresh, msg);
            return;
          }
          case 'join': {
            const code = String(msg.code ?? '').toUpperCase().replace(/[^A-Z]/g, '');
            const target = rooms.get(code);
            // Reconnecting to your own seat is always allowed; anything else counts.
            const rejoin = target?.members.some((m) => m.kind === 'human' && !m.left && m.clientId === msg.clientId);
            if (!rejoin && !allowEntry(ip)) return conn.send({ type: 'error', message: 'Too many attempts. Wait a minute and try again.', fatal: true });
            if (!target) return conn.send({ type: 'error', message: `There's no room with the code ${code || '(blank)'}.`, fatal: true });
            if (target === room && member) return target.attach(member, conn);
            enter(target, msg);
            return;
          }
        }
        if (!room || !member) return;
        switch (msg.type) {
          case 'leave': return room.leave(member);
          case 'chat': return room.say(member, msg.text);
          case 'response': return room.respond(member, msg.reqId, msg.value);
          case 'back': return room.back(member);
          case 'addBot': return room.addBot(member);
          case 'kick': return room.kick(member, msg.id);
          case 'speed': return room.setSpeed(member, msg.speed);
          case 'start': return room.start(member);
          case 'stop': return room.stop(member);
        }
      } catch (e) {
        console.error('[rooms] message failed', msg.type, e);
      }
    });

    ws.on('close', () => {
      const left = (socketsPerIp.get(ip) || 1) - 1;
      if (left > 0) socketsPerIp.set(ip, left);
      else socketsPerIp.delete(ip);
      if (conn.member) conn.room.disconnected(conn.member);
      conn.member = null;
      conn.room = null;
    });
  });

  return { rooms, wss };
}
