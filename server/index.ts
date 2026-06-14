import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { setupGame } from './game';
import { getDictionary } from './dictionary';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
// In dev, Vite owns $PORT (preview tooling may inject it) — the socket server stays on 3001.
const PORT = isProd ? Number(process.env.PORT ?? 3001) : 3001;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: isProd ? undefined : { origin: true },
});

getDictionary(); // warm up at boot
setupGame(io);

if (isProd) {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  // In dev the Vite server (5173) serves the client and proxies /socket.io here.
  app.get('/', (_req, res) => res.send('SpellCasters socket server. Use the Vite dev server on :5173.'));
}

server.listen(PORT, () => {
  console.log(`SpellCasters server listening on http://localhost:${PORT}`);
});
