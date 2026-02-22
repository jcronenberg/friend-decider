import { randomUUID } from 'crypto';
import { info } from './log.js';

export class Item {
  constructor(id, text, addedBy) {
    this.id = id;
    this.text = text;
    this.addedBy = addedBy;
    this.votes = new Map(); // participantId -> 'favor'|'neutral'|'against'
  }
}

export class Session {
  constructor(id, creatorId, creatorName) {
    this.id = id;
    this.phase = 'adding'; // 'adding'|'voting'|'results'
    this.items = new Map(); // itemId -> Item
    this.participants = new Map(); // participantId -> { name, connected }
    this.creatorId = creatorId;
    this.scoringRules = { favor: 2, neutral: 0, against: -5 };
    this.doneParticipants = new Set(); // participantIds who clicked Done this phase
    this.allDisconnectedAt = null;
    this.createdAt = Date.now();
  }

  toJSON() {
    return {
      id: this.id,
      phase: this.phase,
      creatorId: this.creatorId,
      participants: Object.fromEntries(
        [...this.participants.entries()].map(([id, p]) => [id, { name: p.name, connected: p.connected }])
      ),
      scoringRules: { ...this.scoringRules },
      doneParticipants: [...this.doneParticipants],
      results: this.results || null,
      items: [...this.items.values()].map(item => ({
        id: item.id,
        text: item.text,
        addedBy: item.addedBy,
        votes: Object.fromEntries(item.votes),
      })),
    };
  }
}

const sessions = new Map();

export function createSession(creatorId, creatorName) {
  const id = randomUUID();
  const session = new Session(id, creatorId, creatorName);
  session.participants.set(creatorId, { name: creatorName, connected: false });
  sessions.set(id, session);
  return session;
}

export function getSession(id) {
  return sessions.get(id) || null;
}

export function deleteSession(id) {
  sessions.delete(id);
}

// Cleanup: every 30s, remove sessions disconnected for >5 minutes
const FIVE_MINUTES = 5 * 60 * 1000;

export function startCleanup() {
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (session.allDisconnectedAt && now - session.allDisconnectedAt > FIVE_MINUTES) {
        sessions.delete(id);
        info(`Session expired and deleted: ${id}`);
      }
    }
  }, 30_000);
}
