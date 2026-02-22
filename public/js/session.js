// Extract session ID from URL
const sessionId = location.pathname.split('/').pop();
const participantKey = `participant:${sessionId}`;

let ws = null;
let myParticipantId = localStorage.getItem(participantKey) || null;
let myName = localStorage.getItem('friendDeciderName') || '';
let state = null; // full session state
let reconnectTimer = null;

// DOM refs
const invalidScreen = document.getElementById('invalid-session');
const nameModal = document.getElementById('name-modal');
const app = document.getElementById('app');
const participantNameInput = document.getElementById('participant-name');
const joinBtn = document.getElementById('join-btn');
const nameError = document.getElementById('name-error');
const copyLinkBtn = document.getElementById('copy-link-btn');
const qrBtn = document.getElementById('qr-btn');
const qrModal = document.getElementById('qr-modal');
const qrImage = document.getElementById('qr-image');
const qrCloseBtn = document.getElementById('qr-close-btn');
const connectionDot = document.getElementById('connection-status');
const phaseIndicator = document.getElementById('phase-indicator');
const participantsList = document.getElementById('participants-list');

const phaseAdding = document.getElementById('phase-adding');
const phaseVoting = document.getElementById('phase-voting');
const phaseResults = document.getElementById('phase-results');

const addItemForm = document.getElementById('add-item-form');
const itemInput = document.getElementById('item-input');
const itemError = document.getElementById('item-error');
const itemsList = document.getElementById('items-list');
const startVotingBtn = document.getElementById('start-voting-btn');

const doneAddingBtn = document.getElementById('done-adding-btn');
const addingReadyCount = document.getElementById('adding-ready-count');
const votingList = document.getElementById('voting-list');
const doneVotingBtn = document.getElementById('done-voting-btn');
const votingReadyCount = document.getElementById('voting-ready-count');
const backToAddingBtn = document.getElementById('back-to-adding-btn');
const showResultsBtn = document.getElementById('show-results-btn');
const backToVotingBtn = document.getElementById('back-to-voting-btn');

const resultsList = document.getElementById('results-list');

// --- Name prompt ---

function promptForName() {
  if (myName) {
    participantNameInput.value = myName;
  }
  nameModal.classList.remove('hidden');
  participantNameInput.focus();
}

joinBtn.addEventListener('click', () => {
  const name = participantNameInput.value.trim();
  if (!name) {
    nameError.textContent = 'Please enter a name';
    nameError.classList.remove('hidden');
    return;
  }
  myName = name;
  localStorage.setItem('friendDeciderName', name);
  nameError.classList.add('hidden');
  nameModal.classList.add('hidden');
  app.classList.remove('hidden');
  connect();
});

participantNameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') joinBtn.click();
});

// --- WebSocket ---

function connect() {
  if (ws && ws.readyState < 2) ws.close();

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/${sessionId}`);

  ws.addEventListener('open', () => {
    setConnected(true);
    ws.send(JSON.stringify({
      type: 'join',
      name: myName,
      existingParticipantId: myParticipantId,
    }));
  });

  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    handleMessage(msg);
  });

  ws.addEventListener('close', () => {
    setConnected(false);
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    setConnected(false);
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connect(), 2000);
}

function setConnected(yes) {
  connectionDot.classList.toggle('connected', yes);
  connectionDot.classList.toggle('disconnected', !yes);
  connectionDot.title = yes ? 'Connected' : 'Disconnected';
}

// --- Message handling ---

function handleMessage(msg) {
  switch (msg.type) {
    case 'state': {
      myParticipantId = msg.participantId;
      localStorage.setItem(participantKey, myParticipantId);
      state = msg.state;
      saveRecentSession(sessionId, myName);
      renderAll();
      break;
    }
    case 'participant-joined': {
      if (state) {
        state.participants[msg.participantId] = { name: msg.name, connected: true };
        renderParticipants();
        refreshReadyCount();
      }
      break;
    }
    case 'participant-left': {
      if (state && state.participants[msg.participantId]) {
        state.participants[msg.participantId].connected = false;
        renderParticipants();
        refreshReadyCount();
      }
      break;
    }
    case 'item-added': {
      if (state) {
        state.items.push(msg.item);
        itemError.classList.add('hidden');
        renderItems();
      }
      break;
    }
    case 'item-removed': {
      if (state) {
        state.items = state.items.filter(i => i.id !== msg.itemId);
        renderItems();
      }
      break;
    }
    case 'phase-changed': {
      if (state) {
        if (msg.phase === 'adding') {
          // Votes were cleared server-side; clear locally too
          state.items.forEach(item => { item.votes = {}; });
        }
        state.phase = msg.phase;
        state.doneParticipants = [];
        renderParticipants();
        renderPhase();
        renderDoneButton();
        refreshReadyCount();
      }
      break;
    }
    case 'done-updated': {
      if (state) {
        if (msg.isDone) {
          if (!state.doneParticipants.includes(msg.participantId)) state.doneParticipants.push(msg.participantId);
        } else {
          state.doneParticipants = state.doneParticipants.filter(id => id !== msg.participantId);
        }
        renderParticipants();
        renderDoneButton();
        renderReadyCount(msg.doneCount, msg.totalConnected);
      }
      break;
    }
    case 'vote-updated': {
      if (state) {
        const item = state.items.find(i => i.id === msg.itemId);
        if (item) {
          item.votes[msg.participantId] = msg.vote;
          updateVoteButton(msg.itemId, msg.participantId, msg.vote);
        }
      }
      break;
    }
    case 'results': {
      if (state) {
        state.phase = 'results';
        state.doneParticipants = [];
        renderParticipants();
        renderDoneButton();
        renderResults(msg.results);
        renderPhase();
      }
      break;
    }
    case 'error': {
      if (msg.message === 'Session not found') {
        showInvalidSession();
      } else if (msg.message === 'An item with that name already exists') {
        showItemError(msg.message);
      } else {
        console.error('Server error:', msg.message);
      }
      break;
    }
  }
}

// --- Rendering ---

function renderAll() {
  renderParticipants();
  renderPhase();
  renderItems();
  renderDoneButton();
  const connected = Object.values(state.participants).filter(p => p.connected).length;
  const doneCount = state.doneParticipants.filter(id => state.participants[id]?.connected).length;
  renderReadyCount(doneCount, connected);
}

function renderDoneButton() {
  if (!state) return;
  const amDone = state.doneParticipants.includes(myParticipantId);
  [doneAddingBtn, doneVotingBtn].forEach(btn => {
    btn.textContent = amDone ? 'Undo Done' : "I'm Done";
    btn.classList.toggle('active', amDone);
  });
}

function refreshReadyCount() {
  const connected = Object.entries(state.participants)
    .filter(([, p]) => p.connected)
    .map(([id]) => id);
  const doneCount = connected.filter(id => state.doneParticipants.includes(id)).length;
  renderReadyCount(doneCount, connected.length);
}

function renderReadyCount(doneCount, total) {
  if (!state) return;
  const inPhase = state.phase === 'adding' || state.phase === 'voting';
  const text = inPhase && total > 0 ? `${doneCount}/${total} ready` : '';
  addingReadyCount.textContent = text;
  votingReadyCount.textContent = text;
}

function renderParticipants() {
  if (!state) return;
  const inActivePhase = state.phase === 'adding' || state.phase === 'voting';
  const entries = Object.entries(state.participants);
  participantsList.innerHTML = entries.map(([id, p]) => {
    const isMe = id === myParticipantId;
    const isCreator = id === state.creatorId;
    const isDone = inActivePhase && state.doneParticipants.includes(id);
    const statusClass = !p.connected ? 'offline' : isDone ? 'ready' : 'online';
    const title = !p.connected ? 'Offline' : isDone ? 'Ready' : 'Online';
    return `<span class="participant-chip ${statusClass}" title="${title}">
      ${escHtml(p.name)}${isMe ? ' (you)' : ''}${isCreator ? ' &#9733;' : ''}
    </span>`;
  }).join('');
}

function renderPhase() {
  if (!state) return;
  const phases = { adding: 'Adding Items', voting: 'Voting', results: 'Results' };
  phaseIndicator.textContent = `Phase: ${phases[state.phase] || state.phase}`;

  phaseAdding.classList.toggle('hidden', state.phase !== 'adding');
  phaseVoting.classList.toggle('hidden', state.phase !== 'voting');
  phaseResults.classList.toggle('hidden', state.phase !== 'results');

  const isCreator = myParticipantId === state.creatorId;
  startVotingBtn.classList.toggle('hidden', !isCreator || state.phase !== 'adding');
  backToAddingBtn.classList.toggle('hidden', !isCreator || state.phase !== 'voting');
  showResultsBtn.classList.toggle('hidden', !isCreator || state.phase !== 'voting');
  backToVotingBtn.classList.toggle('hidden', !isCreator || state.phase !== 'results');

  if (state.phase === 'voting') renderVoting();
  if (state.phase === 'results' && state.results) renderResults(state.results);
}

function renderItems() {
  if (!state) return;
  const hasItems = state.items.length > 0;
  doneAddingBtn.disabled = !hasItems;
  startVotingBtn.disabled = !hasItems;

  itemsList.innerHTML = state.items.map(item => {
    const canRemove = item.addedBy === myParticipantId || myParticipantId === state.creatorId;
    const adderName = state.participants[item.addedBy]?.name || 'Unknown';
    return `<li class="item" data-id="${item.id}">
      <span class="item-text">${escHtml(item.text)}</span>
      <span class="item-meta">by ${escHtml(adderName)}</span>
      ${canRemove ? `<button class="btn btn-danger btn-sm remove-btn" data-id="${item.id}">Remove</button>` : ''}
    </li>`;
  }).join('') || '<li class="empty-state">No items yet. Add something!</li>';

  // Attach remove listeners
  itemsList.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => sendRemoveItem(btn.dataset.id));
  });
}

function renderVoting() {
  if (!state) return;
  votingList.innerHTML = state.items.map(item => {
    const myVote = item.votes[myParticipantId] || 'favor';
    return `<li class="item voting-item" data-id="${item.id}">
      <span class="item-text">${escHtml(item.text)}</span>
      <div class="vote-buttons">
        <button class="vote-btn favor ${myVote === 'favor' ? 'active' : ''}" data-item="${item.id}" data-vote="favor">In Favor</button>
        <button class="vote-btn neutral ${myVote === 'neutral' ? 'active' : ''}" data-item="${item.id}" data-vote="neutral">Neutral</button>
        <button class="vote-btn against ${myVote === 'against' ? 'active' : ''}" data-item="${item.id}" data-vote="against">Against</button>
      </div>
    </li>`;
  }).join('') || '<li class="empty-state">No items to vote on.</li>';

  votingList.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      sendVote(btn.dataset.item, btn.dataset.vote);
    });
  });
}

function updateVoteButton(itemId, participantId, vote) {
  if (participantId !== myParticipantId) return;
  const item = votingList.querySelector(`[data-id="${itemId}"]`);
  if (!item) return;
  item.querySelectorAll('.vote-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.vote === vote);
  });
}

function renderResults(results) {
  resultsList.innerHTML = results.map((item, i) => {
    const medal = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`;
    const scoreClass = item.score > 0 ? 'score-positive' : item.score < 0 ? 'score-negative' : 'score-neutral';
    return `<li class="result-item">
      <div class="result-rank">${medal}</div>
      <div class="result-body">
        <div class="result-text">${escHtml(item.text)}</div>
        <div class="result-votes">
          <span class="vote-count favor">${item.votes.favor} in favor</span>
          <span class="vote-count neutral">${item.votes.neutral} neutral</span>
          <span class="vote-count against">${item.votes.against} against</span>
        </div>
      </div>
      <div class="result-score ${scoreClass}">${item.score > 0 ? '+' : ''}${item.score}</div>
    </li>`;
  }).join('') || '<li class="empty-state">No results.</li>';
}

// --- Actions ---

addItemForm.addEventListener('submit', e => {
  e.preventDefault();
  const text = itemInput.value.trim();
  if (!text) return;
  itemError.classList.add('hidden');
  ws.send(JSON.stringify({ type: 'add-item', text }));
  itemInput.value = '';
});

function showItemError(msg) {
  itemError.textContent = msg;
  itemError.classList.remove('hidden');
}

doneAddingBtn.addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'mark-done' }));
});

doneVotingBtn.addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'mark-done' }));
});

startVotingBtn.addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'start-voting' }));
});

backToAddingBtn.addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'prev-phase' }));
});

backToVotingBtn.addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'prev-phase' }));
});

showResultsBtn.addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'show-results' }));
});

qrBtn.addEventListener('click', async () => {
  if (!qrImage.innerHTML) {
    const res = await fetch(`/api/sessions/${sessionId}/qr`);
    qrImage.innerHTML = await res.text();
  }
  qrModal.classList.remove('hidden');
});

qrCloseBtn.addEventListener('click', () => qrModal.classList.add('hidden'));
qrModal.addEventListener('click', e => { if (e.target === qrModal) qrModal.classList.add('hidden'); });

copyLinkBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(location.href).then(() => {
    copyLinkBtn.textContent = 'Copied!';
    setTimeout(() => { copyLinkBtn.textContent = 'Copy Link'; }, 2000);
  });
});

function sendRemoveItem(itemId) {
  ws.send(JSON.stringify({ type: 'remove-item', itemId }));
}

function sendVote(itemId, vote) {
  ws.send(JSON.stringify({ type: 'vote', itemId, vote }));
}

function showInvalidSession() {
  clearTimeout(reconnectTimer);
  if (ws) ws.onclose = null; // prevent reconnect loop
  nameModal.classList.add('hidden');
  app.classList.add('hidden');
  invalidScreen.classList.remove('hidden');
}

// --- Recent sessions ---

function saveRecentSession(id, name) {
  const key = 'recentSessions';
  let list = JSON.parse(localStorage.getItem(key) || '[]');
  // Remove existing entry for this session then prepend fresh one
  list = list.filter(s => s.id !== id);
  list.unshift({ id, name, ts: Date.now() });
  localStorage.setItem(key, JSON.stringify(list.slice(0, 5)));
}

// --- Utils ---

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Init ---

(async () => {
  const res = await fetch(`/api/sessions/${sessionId}`);
  if (!res.ok) {
    showInvalidSession();
    return;
  }

  if (myParticipantId && myName) {
    // Known participant - skip name modal and connect directly
    app.classList.remove('hidden');
    connect();
  } else {
    promptForName();
  }
})();
