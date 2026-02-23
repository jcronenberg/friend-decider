// Extract session ID from URL
const sessionId = location.pathname.split('/').pop();
const participantKey = `participant:${sessionId}`;
const viewKey = `view:${sessionId}`;

let ws = null;
let myParticipantId = localStorage.getItem(participantKey) || null;
let myName = localStorage.getItem('friendDeciderName') || '';
let state = null; // full session state
let reconnectTimer = null;
let currentView = localStorage.getItem(viewKey) || 'adding'; // 'adding' | 'voting' | 'results'

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
const sessionNameDisplay = document.getElementById('session-name-display');
const participantsList = document.getElementById('participants-list');

const tabBtns = document.querySelectorAll('.tab-btn');
const viewAdding = document.getElementById('view-adding');
const viewVoting = document.getElementById('view-voting');
const viewResults = document.getElementById('view-results');

const scoringConfig = document.getElementById('scoring-config');
const scoringAddingDisplay = document.getElementById('scoring-adding-display');
const scoringDisplay = document.getElementById('scoring-display');
const addItemForm = document.getElementById('add-item-form');
const itemInput = document.getElementById('item-input');
const itemError = document.getElementById('item-error');
const itemsList = document.getElementById('items-list');

const votingList = document.getElementById('voting-list');
const resultsList = document.getElementById('results-list');
const viewBackBtn = document.getElementById('view-back-btn');
const viewNextBtn = document.getElementById('view-next-btn');
const navWarning = document.getElementById('nav-warning');
const confirmModal = document.getElementById('confirm-modal');
const confirmMessage = document.getElementById('confirm-message');
const confirmOkBtn = document.getElementById('confirm-ok-btn');
const confirmCancelBtn = document.getElementById('confirm-cancel-btn');

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
      saveRecentSession(sessionId, myName, state.name);
      renderAll();
      break;
    }
    case 'participant-joined': {
      if (state) {
        state.participants[msg.participantId] = { name: msg.name, connected: true };
        renderParticipants();
        if (currentView === 'results') renderResults(computeResults());
      }
      break;
    }
    case 'participant-left': {
      if (state && state.participants[msg.participantId]) {
        state.participants[msg.participantId].connected = false;
        renderParticipants();
      }
      break;
    }
    case 'item-added': {
      if (state) {
        state.items.push(msg.item);
        itemError.classList.add('hidden');
        renderItems();
        if (currentView === 'voting') renderVoting();
        if (currentView === 'results') renderResults(computeResults());
      }
      break;
    }
    case 'item-removed': {
      if (state) {
        state.items = state.items.filter(i => i.id !== msg.itemId);
        renderItems();
        if (currentView === 'voting') renderVoting();
        if (currentView === 'results') renderResults(computeResults());
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
      }
      break;
    }
    case 'scoring-updated': {
      if (state) {
        state.scoringRules = msg.scoringRules;
        renderScoringRules();
        if (currentView === 'results') renderResults(computeResults());
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
        if (currentView === 'results') renderResults(computeResults());
      }
      break;
    }
    case 'error': {
      if (msg.message === 'Session not found') {
        showInvalidSession();
      } else if (msg.message === 'An item with that name already exists' || msg.message === 'Item limit of 100 reached') {
        showItemError(msg.message);
      } else {
        console.error('Server error:', msg.message);
      }
      break;
    }
  }
}

// --- Rendering ---

function renderSessionName() {
  if (!state || !state.name) return;
  sessionNameDisplay.textContent = state.name;
  sessionNameDisplay.classList.remove('hidden');
  document.title = `${state.name} - Friend Decider`;
}

function renderAll() {
  renderSessionName();
  renderParticipants();
  renderItems();
  renderScoringRules();
  renderView();
}

function renderView() {
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
  viewAdding.classList.toggle('hidden', currentView !== 'adding');
  viewVoting.classList.toggle('hidden', currentView !== 'voting');
  viewResults.classList.toggle('hidden', currentView !== 'results');
  const views = ['adding', 'voting', 'results'];
  const idx = views.indexOf(currentView);
  const locked = state && state.lockNavigation;
  viewBackBtn.classList.toggle('hidden', idx === 0 || locked);
  viewNextBtn.classList.toggle('hidden', idx === views.length - 1);
  tabBtns.forEach(b => {
    const toIdx = views.indexOf(b.dataset.view);
    b.disabled = locked && (toIdx < idx || toIdx > idx + 1);
  });
  if (currentView === 'voting') renderVoting();
  if (currentView === 'results') renderResults(computeResults());
}

let navWarningTimer = null;
function showNavWarning(msg) {
  navWarning.textContent = msg;
  navWarning.classList.remove('hidden');
  clearTimeout(navWarningTimer);
  navWarningTimer = setTimeout(() => navWarning.classList.add('hidden'), 3000);
}

function showConfirm(msg) {
  return new Promise(resolve => {
    confirmMessage.textContent = msg;
    confirmModal.classList.remove('hidden');
    function finish(result) {
      confirmModal.classList.add('hidden');
      confirmOkBtn.removeEventListener('click', onOk);
      confirmCancelBtn.removeEventListener('click', onCancel);
      confirmModal.removeEventListener('click', onBackdrop);
      resolve(result);
    }
    function onOk() { finish(true); }
    function onCancel() { finish(false); }
    function onBackdrop(e) { if (e.target === confirmModal) finish(false); }
    confirmOkBtn.addEventListener('click', onOk);
    confirmCancelBtn.addEventListener('click', onCancel);
    confirmModal.addEventListener('click', onBackdrop);
  });
}

async function switchView(view) {
  const views = ['adding', 'voting', 'results'];
  if (state && state.lockNavigation) {
    const fromIdx = views.indexOf(currentView);
    const toIdx = views.indexOf(view);
    if (toIdx < fromIdx) {
      showNavWarning("Navigation is locked — you can't go back.");
      return;
    }
    if (toIdx > fromIdx + 1) {
      showNavWarning("You must complete each stage in order.");
      return;
    }
    if (toIdx > fromIdx) {
      const ok = await showConfirm("Are you sure you want to continue? You won't be able to go back.");
      if (!ok) return;
    }
  }
  const wasOnResults = currentView === 'results';
  const nowOnResults = view === 'results';
  currentView = view;
  localStorage.setItem(viewKey, currentView);
  if (wasOnResults !== nowOnResults) {
    ws.send(JSON.stringify({ type: 'set-done', isDone: nowOnResults }));
  }
  renderView();
}

tabBtns.forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));

const views = ['adding', 'voting', 'results'];
viewBackBtn.addEventListener('click', () => {
  const idx = views.indexOf(currentView);
  if (idx > 0) switchView(views[idx - 1]);
});
viewNextBtn.addEventListener('click', () => {
  const idx = views.indexOf(currentView);
  if (idx < views.length - 1) switchView(views[idx + 1]);
});

function computeResults() {
  if (!state) return [];
  const { favor: fPts, neutral: nPts, against: aPts } = state.scoringRules;
  const pids = Object.keys(state.participants);
  return state.items.map(item => {
    let favor = 0, neutral = 0, against = 0;
    for (const pid of pids) {
      const v = item.votes[pid] || 'favor';
      if (v === 'favor') favor++;
      else if (v === 'neutral') neutral++;
      else against++;
    }
    const score = favor * fPts + neutral * nPts + against * aPts;
    return { ...item, score, votes: { favor, neutral, against } };
  }).sort((a, b) =>
    b.score - a.score ||
    a.votes.against - b.votes.against ||
    b.votes.favor - a.votes.favor ||
    a.text.localeCompare(b.text)
  );
}

function renderScoringRules() {
  if (!state) return;
  const { favor, neutral, against } = state.scoringRules;
  const isCreator = myParticipantId === state.creatorId;

  const fmt = v => (v > 0 ? '+' : '') + v;

  const readonlyHtml = `
    <div class="scoring-label">Scoring:</div>
    <span class="vote-count favor">In Favor: ${fmt(favor)}</span>
    <span class="vote-count neutral">Neutral: ${fmt(neutral)}</span>
    <span class="vote-count against">Against: ${fmt(against)}</span>`;

  scoringDisplay.innerHTML = readonlyHtml;

  scoringAddingDisplay.innerHTML = readonlyHtml;
  scoringAddingDisplay.classList.toggle('hidden', isCreator);

  if (isCreator) {
    scoringConfig.classList.remove('hidden');
    scoringConfig.innerHTML = `
      <h2>Scoring</h2>
      <div class="scoring-inputs">
        <div class="form-group">
          <label for="score-favor">In Favor</label>
          <input type="number" id="score-favor" class="scoring-input favor" value="${favor}">
        </div>
        <div class="form-group">
          <label for="score-neutral">Neutral</label>
          <input type="number" id="score-neutral" class="scoring-input neutral" value="${neutral}">
        </div>
        <div class="form-group">
          <label for="score-against">Against</label>
          <input type="number" id="score-against" class="scoring-input against" value="${against}">
        </div>
      </div>
`;
    ['favor', 'neutral', 'against'].forEach(key => {
      document.getElementById(`score-${key}`).addEventListener('change', sendScoringUpdate);
    });
  } else {
    scoringConfig.classList.add('hidden');
  }
}

function sendScoringUpdate() {
  const favor = parseInt(document.getElementById('score-favor').value, 10);
  const neutral = parseInt(document.getElementById('score-neutral').value, 10);
  const against = parseInt(document.getElementById('score-against').value, 10);
  if ([favor, neutral, against].some(isNaN)) return;
  ws.send(JSON.stringify({ type: 'set-scoring', favor, neutral, against }));
}

function renderParticipants() {
  if (!state) return;
  const entries = Object.entries(state.participants);
  participantsList.innerHTML = entries.map(([id, p]) => {
    const isMe = id === myParticipantId;
    const isCreator = id === state.creatorId;
    const isDone = state.doneParticipants.includes(id);
    const statusClass = !p.connected ? 'offline' : isDone ? 'ready' : 'online';
    const title = !p.connected ? 'Offline' : isDone ? 'On Results' : 'Online';
    return `<span class="participant-chip ${statusClass}" title="${title}">
      ${escHtml(p.name)}${isMe ? ' (you)' : ''}${isCreator ? ' &#9733;' : ''}
    </span>`;
  }).join('');
}

function renderItems() {
  if (!state) return;

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

function saveRecentSession(id, name, sessionName) {
  const key = 'recentSessions';
  let list = JSON.parse(localStorage.getItem(key) || '[]');
  // Remove existing entry for this session then prepend fresh one
  list = list.filter(s => s.id !== id);
  list.unshift({ id, name, sessionName, ts: Date.now() });
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

  const sessionData = await res.json();
  if (sessionData.name) {
    const el = document.getElementById('join-session-name');
    el.textContent = sessionData.name;
    el.classList.remove('hidden');
  }

  if (myParticipantId && myName) {
    // Known participant - skip name modal and connect directly
    app.classList.remove('hidden');
    connect();
  } else {
    promptForName();
  }
})();
