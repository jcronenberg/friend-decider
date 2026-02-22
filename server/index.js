import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import path from 'path';
import router from './routes.js';
import { handleConnection } from './ws-handler.js';
import { startCleanup } from './session-store.js';
import { info, warn } from './log.js';
import { CREATION_PASSWORDS } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use(router);

const server = createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const match = req.url.match(/^\/ws\/([^/?]+)/);
  if (!match) {
    warn('WS upgrade rejected - bad URL:', req.url);
    socket.destroy();
    return;
  }
  const sessionId = match[1];

  wss.handleUpgrade(req, socket, head, ws => {
    handleConnection(ws, sessionId);
  });
});

if (CREATION_PASSWORDS.length === 0) {
  console.error('ERROR: CREATION_PASSWORD environment variable is not set. Refusing to start.');
  process.exit(1);
}

const shortPasswords = CREATION_PASSWORDS.filter(p => p.length < 8);
if (shortPasswords.length > 0) {
  console.warn(`WARNING: ${shortPasswords.length} password(s) are less than 8 characters. Consider using stronger passwords.`);
}

info(`Loaded ${CREATION_PASSWORDS.length} creation password(s)`);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '::';
server.listen(PORT, HOST, () => {
  info(`Friend Decider running on ${HOST}:${PORT}`);
});

startCleanup();

function shutdown(signal) {
  info(`Received ${signal}, shutting down`);
  // Terminate all open WebSocket connections so server.close() can finish
  for (const client of wss.clients) client.terminate();
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
