import { defineConfig } from 'vite';
import { attachGameServer } from './server/hub.js';

// Runs the multiplayer rooms inside the dev/preview server, so `npm run dev`
// is all you need to play online locally.
const gameServer = {
  name: 'monopoly-deal-rooms',
  configureServer(server) {
    if (server.httpServer) attachGameServer(server.httpServer);
  },
  configurePreviewServer(server) {
    if (server.httpServer) attachGameServer(server.httpServer);
  },
};

export default defineConfig({
  // Relative asset paths so the built game can be hosted from any folder.
  base: './',
  plugins: [gameServer],
});
