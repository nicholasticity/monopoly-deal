// Production server: serves the built game from dist/ and hosts multiplayer
// rooms over WebSocket on the same port.  Usage: npm run build && npm start
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachGameServer } from './hub.js';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

function sendFile(res, file) {
  const ext = path.extname(file);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    // Vite fingerprints everything under assets/, so those can be cached for good.
    'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  let file;
  try {
    file = path.join(DIST, decodeURIComponent(pathname));
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (file !== DIST && !file.startsWith(DIST + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.stat(file, (err, stat) => {
    if (!err && stat.isFile()) return sendFile(res, file);
    const index = path.join(DIST, 'index.html');
    if (fs.existsSync(index)) return sendFile(res, index);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('The game has not been built yet. Run "npm run build" first.');
  });
});

attachGameServer(server);

// A bug in one room shouldn't take every other room down with it.
process.on('uncaughtException', (e) => console.error('[server] uncaught error', e));
process.on('unhandledRejection', (e) => console.error('[server] unhandled rejection', e));

server.listen(PORT, HOST, () => {
  console.log(`Monopoly Deal server running on http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets || []) {
      if (net.family === 'IPv4' && !net.internal) console.log(`  on your network: http://${net.address}:${PORT}`);
    }
  }
});
