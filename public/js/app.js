// --- Recent sessions ---
const recentCard = document.getElementById('recent-sessions');
const recentList = document.getElementById('recent-list');

async function renderRecentSessions() {
  const list = JSON.parse(localStorage.getItem('recentSessions') || '[]');
  if (list.length === 0) return;

  // Render entries immediately so the card appears without waiting on network
  recentList.innerHTML = list.map(s => {
    const ago = timeAgo(s.ts);
    return `<li class="recent-item" id="recent-${s.id}">
      <a href="/session/${s.id}" class="recent-link">
        <span class="recent-name">${escHtml(s.sessionName || s.id)}</span>
        <span class="recent-meta">as ${escHtml(s.name)} &middot; ${ago}</span>
      </a>
    </li>`;
  }).join('');
  recentCard.classList.remove('hidden');

  // Check each session in parallel, remove entries for expired ones
  await Promise.all(list.map(async s => {
    const ok = await fetch(`/api/sessions/${s.id}`).then(r => r.ok).catch(() => false);
    if (!ok) {
      const el = document.getElementById(`recent-${s.id}`);
      if (el) el.remove();
      const updated = JSON.parse(localStorage.getItem('recentSessions') || '[]').filter(r => r.id !== s.id);
      localStorage.setItem('recentSessions', JSON.stringify(updated));
    }
  }));

  if (recentList.children.length === 0) recentCard.classList.add('hidden');
}

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

renderRecentSessions();

const form = document.getElementById('create-form');
const errorMsg = document.getElementById('error-msg');
const submitBtn = document.getElementById('submit-btn');
const passwordGroup = document.getElementById('password-group');
const passwordInput = document.getElementById('password');

// Pre-fill name from localStorage if available
const savedName = localStorage.getItem('friendDeciderName');
if (savedName) document.getElementById('name').value = savedName;

let passwordRequired = false;
fetch('/api/config')
  .then(r => r.json())
  .then(cfg => {
    passwordRequired = cfg.passwordRequired;
    if (passwordRequired) {
      passwordGroup.classList.remove('hidden');
      passwordInput.required = true;
    }
  })
  .catch(() => {});

form.addEventListener('submit', async e => {
  e.preventDefault();
  errorMsg.classList.add('hidden');

  const sessionName = document.getElementById('session-name').value.trim();
  const name = document.getElementById('name').value.trim();
  const password = passwordRequired ? passwordInput.value : undefined;

  if (!sessionName) return showError('Please enter what you are deciding');
  if (!name) return showError('Please enter your name');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating...';

  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(password !== undefined && { password }), creatorName: name, sessionName }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Failed to create session');
      return;
    }

    localStorage.setItem('friendDeciderName', name);
    localStorage.setItem(`participant:${data.sessionId}`, data.participantId);
    window.location.href = `/session/${data.sessionId}`;
  } catch (err) {
    showError('Network error. Please try again.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Session';
  }
});

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}
