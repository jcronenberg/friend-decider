import { randomUUID } from 'crypto';
import { getSession } from './session-store.js';
import { info, warn } from './log.js';

// connections: sessionId -> Set of { ws, participantId }
const connections = new Map();

function getConnections(sessionId) {
  if (!connections.has(sessionId)) connections.set(sessionId, new Set());
  return connections.get(sessionId);
}

function broadcast(sessionId, message, excludeWs = null) {
  const conns = getConnections(sessionId);
  const data = JSON.stringify(message);
  for (const conn of conns) {
    if (conn.ws !== excludeWs && conn.ws.readyState === 1) {
      conn.ws.send(data);
    }
  }
}

function send(ws, message) {
  if (ws.readyState === 1) ws.send(JSON.stringify(message));
}

export function handleConnection(ws, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    warn(`WS connect rejected - session not found: ${sessionId}`);
    send(ws, { type: 'error', message: 'Session not found' });
    ws.close();
    return;
  }
  info(`WS connected to session ${sessionId}`);

  let participantId = null;

  ws.on('message', raw => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return send(ws, { type: 'error', message: 'Invalid message' });
    }

    const session = getSession(sessionId);
    if (!session) return send(ws, { type: 'error', message: 'Session not found' });

    switch (msg.type) {
      case 'join': {
        const { name, existingParticipantId } = msg;

        // Reconnect existing participant
        if (existingParticipantId && session.participants.has(existingParticipantId)) {
          participantId = existingParticipantId;
          const p = session.participants.get(participantId);
          p.connected = true;
          info(`[${sessionId}] "${p.name}" reconnected`);
        } else {
          // New participant
          if (!name || typeof name !== 'string' || !name.trim()) {
            return send(ws, { type: 'error', message: 'Name is required' });
          }
          participantId = randomUUID();
          session.participants.set(participantId, { name: name.trim(), connected: true });
          info(`[${sessionId}] "${name.trim()}" joined (${session.participants.size} participants)`);
        }

        // Clear disconnect timer since someone is now connected
        session.allDisconnectedAt = null;

        const conn = { ws, participantId };
        getConnections(sessionId).add(conn);
        ws._conn = conn;

        // Send full state to the joining client
        send(ws, {
          type: 'state',
          participantId,
          state: session.toJSON(),
        });

        // Notify others
        const p = session.participants.get(participantId);
        broadcast(sessionId, {
          type: 'participant-joined',
          participantId,
          name: p.name,
        }, ws);

        break;
      }

      case 'add-item': {
        if (!participantId) return send(ws, { type: 'error', message: 'Not joined' });

        const { text } = msg;
        if (!text || typeof text !== 'string' || !text.trim()) {
          return send(ws, { type: 'error', message: 'Item text required' });
        }

        if (session.items.size >= 100) {
          return send(ws, { type: 'error', message: 'Item limit of 100 reached' });
        }

        const normalized = text.trim().toLowerCase();
        const duplicate = [...session.items.values()].some(i => i.text.toLowerCase() === normalized);
        if (duplicate) return send(ws, { type: 'error', message: 'An item with that name already exists' });

        const item = { id: randomUUID(), text: text.trim(), addedBy: participantId, votes: new Map() };
        session.items.set(item.id, item);
        info(`[${sessionId}] Item added: "${item.text}"`);

        const payload = { type: 'item-added', item: { id: item.id, text: item.text, addedBy: item.addedBy, votes: {} } };
        send(ws, payload);
        broadcast(sessionId, payload, ws);
        break;
      }

      case 'remove-item': {
        if (!participantId) return send(ws, { type: 'error', message: 'Not joined' });

        const { itemId } = msg;
        const item = session.items.get(itemId);
        if (!item) return send(ws, { type: 'error', message: 'Item not found' });
        if (item.addedBy !== participantId && session.creatorId !== participantId) {
          return send(ws, { type: 'error', message: 'Not authorized to remove this item' });
        }

        session.items.delete(itemId);
        info(`[${sessionId}] Item removed: "${item.text}"`);
        const payload = { type: 'item-removed', itemId };
        send(ws, payload);
        broadcast(sessionId, payload, ws);
        break;
      }

      case 'vote': {
        if (!participantId) return send(ws, { type: 'error', message: 'Not joined' });

        const { itemId, vote } = msg;
        if (!['favor', 'neutral', 'against'].includes(vote)) {
          return send(ws, { type: 'error', message: 'Invalid vote value' });
        }

        const item = session.items.get(itemId);
        if (!item) return send(ws, { type: 'error', message: 'Item not found' });

        item.votes.set(participantId, vote);

        const payload = { type: 'vote-updated', itemId, participantId, vote };
        send(ws, payload);
        broadcast(sessionId, payload, ws);
        break;
      }

      case 'set-done': {
        if (!participantId) return send(ws, { type: 'error', message: 'Not joined' });

        const { isDone } = msg;
        if (isDone) session.doneParticipants.add(participantId);
        else session.doneParticipants.delete(participantId);

        const name = session.participants.get(participantId)?.name ?? participantId;
        info(`[${sessionId}] "${name}" ${isDone ? 'viewing results' : 'left results'}`);

        const payload = { type: 'done-updated', participantId, isDone };
        send(ws, payload);
        broadcast(sessionId, payload, ws);
        break;
      }

      case 'set-scoring': {
        if (!participantId) return send(ws, { type: 'error', message: 'Not joined' });
        if (participantId !== session.creatorId) return send(ws, { type: 'error', message: 'Only creator can change scoring' });

        const { favor, neutral, against } = msg;
        if (![favor, neutral, against].every(v => Number.isInteger(v))) {
          return send(ws, { type: 'error', message: 'Scoring values must be integers' });
        }

        session.scoringRules = { favor, neutral, against };
        info(`[${sessionId}] Scoring updated: favor=${favor}, neutral=${neutral}, against=${against}`);

        const payload = { type: 'scoring-updated', scoringRules: session.scoringRules };
        send(ws, payload);
        broadcast(sessionId, payload, ws);
        break;
      }

      default:
        warn(`[${sessionId}] Unknown message type: ${msg.type}`);
        send(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
    }
  });

  ws.on('close', () => {
    if (ws._conn) {
      getConnections(sessionId).delete(ws._conn);
    }

    const session = getSession(sessionId);
    if (!session) return;

    if (participantId && session.participants.has(participantId)) {
      session.participants.get(participantId).connected = false;
    }

    const conns = getConnections(sessionId);
    if (conns.size === 0) {
      session.allDisconnectedAt = Date.now();
      info(`[${sessionId}] All participants disconnected - session expires in 5 minutes`);
    }

    if (participantId) {
      const name = session.participants.get(participantId)?.name ?? participantId;
      info(`[${sessionId}] "${name}" disconnected (${conns.size} remaining)`);
      broadcast(sessionId, { type: 'participant-left', participantId });
    }
  });
}
