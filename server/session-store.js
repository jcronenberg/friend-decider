import { randomUUID } from 'crypto';
import { info } from './log.js';
import { MAX_TOTAL_SESSIONS } from './config.js';

export class Item {
  constructor(id, text, addedBy) {
    this.id = id;
    this.text = text;
    this.addedBy = addedBy;
    this.votes = new Map(); // participantId -> 'favor'|'neutral'|'against'
  }
}

export class Session {
  constructor(id, creatorId, creatorName, sessionName) {
    this.id = id;
    this.name = sessionName;
    this.items = new Map(); // itemId -> Item
    this.participants = new Map(); // participantId -> { name, connected }
    this.creatorId = creatorId;
    this.scoringRules = { favor: 2, neutral: 0, against: -5 };
    this.lockNavigation = false;
    this.doneParticipants = new Set(); // participantIds currently viewing results
    this.createdAt = Date.now();
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      creatorId: this.creatorId,
      participants: Object.fromEntries(
        [...this.participants.entries()].map(([id, p]) => [id, { name: p.name, connected: p.connected }])
      ),
      scoringRules: { ...this.scoringRules },
      lockNavigation: this.lockNavigation,
      doneParticipants: [...this.doneParticipants],
      items: [...this.items.values()].map(item => ({
        id: item.id,
        text: item.text,
        addedBy: item.addedBy,
        votes: Object.fromEntries(item.votes),
      })),
    };
  }
}

// Map preserves insertion order: oldest entries first, newest last.
// touchSession() re-inserts a session to move it to the end (most recently active).
const sessions = new Map();

function evictSessions(count) {
  const inactive = [];
  const active = [];
  for (const [id, session] of sessions) {
    const hasConnected = [...session.participants.values()].some(p => p.connected);
    if (hasConnected) active.push(id);
    else inactive.push(id);
  }
  const toEvict = [...inactive, ...active].slice(0, count);
  for (const id of toEvict) {
    sessions.delete(id);
    info(`Session evicted (limit reached): ${id}`);
  }
}

export function createSession(creatorId, creatorName, creatorIp, sessionName, lockNavigation = false) {
  if (sessions.size >= MAX_TOTAL_SESSIONS) {
    evictSessions(sessions.size - MAX_TOTAL_SESSIONS + 1);
  }
  const id = randomUUID();
  const session = new Session(id, creatorId, creatorName, sessionName);
  session.creatorIp = creatorIp || null;
  session.lockNavigation = lockNavigation;
  session.participants.set(creatorId, { name: creatorName, connected: false });
  sessions.set(id, session);
  return session;
}

export function countSessionsByIp(ip) {
  let count = 0;
  for (const session of sessions.values()) {
    if (session.creatorIp === ip) count++;
  }
  return count;
}

export function getSession(id) {
  return sessions.get(id) || null;
}

export function deleteSession(id) {
  sessions.delete(id);
}

// Move session to the end of the map (most recently active).
export function touchSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  sessions.set(id, session);
}

