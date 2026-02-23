import { Router } from 'express';
import { randomUUID } from 'crypto';
import { createSession, getSession, countSessionsByIp } from './session-store.js';
import { info, warn } from './log.js';
import { CREATION_PASSWORDS, MAX_SESSIONS_PER_IP } from './config.js';
import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// Rate limit: max 5 session creation attempts per IP per minute
const rateLimitMap = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 30_000);

router.get('/api/config', (req, res) => {
  res.json({ passwordRequired: CREATION_PASSWORDS.length > 0 });
});

router.post('/api/sessions', (req, res) => {
  const ip = req.ip;

  if (MAX_SESSIONS_PER_IP > 0 && countSessionsByIp(ip) >= MAX_SESSIONS_PER_IP) {
    warn(`Session limit reached for ${ip} (limit: ${MAX_SESSIONS_PER_IP})`);
    return res.status(429).json({ error: `Session limit reached. You can have at most ${MAX_SESSIONS_PER_IP} active sessions.` });
  }

  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    warn(`Rate limited session creation from ${ip}`);
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }

  const { password, creatorName, sessionName, lockNavigation } = req.body;

  if (CREATION_PASSWORDS.length > 0 && !CREATION_PASSWORDS.includes(password)) {
    warn(`Session creation rejected - bad password (creator: "${creatorName}")`);
    return res.status(401).json({ error: 'Invalid password' });
  }

  if (!creatorName || typeof creatorName !== 'string' || !creatorName.trim()) {
    return res.status(400).json({ error: 'creatorName is required' });
  }

  if (!sessionName || typeof sessionName !== 'string' || !sessionName.trim()) {
    return res.status(400).json({ error: 'sessionName is required' });
  }

  const creatorId = randomUUID();
  const session = createSession(creatorId, creatorName.trim(), ip, sessionName.trim(), lockNavigation === true);

  info(`Session created: ${session.id} "${sessionName.trim()}" by "${creatorName.trim()}"`);
  res.json({ sessionId: session.id, participantId: creatorId });
});

router.get('/api/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session.toJSON());
});

router.get('/api/sessions/:id/qr', async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const url = `${req.protocol}://${req.get('host')}/session/${req.params.id}`;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1 });
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(svg);
});

router.get('/session/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/session.html'));
});

export default router;
