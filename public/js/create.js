const params = new URLSearchParams(location.search);
const preSession = params.get('session');
const preItems = params.get('items') || '';

const createCard = document.getElementById('create-card');
const invalidTemplate = document.getElementById('invalid-template');

if (!preSession || !preSession.trim()) {
  invalidTemplate.classList.remove('hidden');
} else {
  createCard.classList.remove('hidden');

  document.getElementById('session-preview').textContent = preSession;

  const itemsList = preItems
    ? preItems.split(',').map(s => decodeURIComponent(s).trim()).filter(Boolean)
    : [];

  if (itemsList.length > 0) {
    const itemsSection = document.getElementById('items-section');
    const itemsPreview = document.getElementById('items-preview');
    itemsSection.classList.remove('hidden');
    itemsPreview.innerHTML = itemsList
      .map(text => `<li class="item"><span class="item-text">${escHtml(text)}</span></li>`)
      .join('');
  }

  const savedName = localStorage.getItem('friendDeciderName');
  if (savedName) document.getElementById('name').value = savedName;

  let passwordRequired = false;
  fetch('/api/config')
    .then(r => r.json())
    .then(cfg => {
      passwordRequired = cfg.passwordRequired;
      if (passwordRequired) {
        document.getElementById('password-group').classList.remove('hidden');
        document.getElementById('password').required = true;
      }
    })
    .catch(() => {});

  document.getElementById('create-form').addEventListener('submit', async e => {
    e.preventDefault();
    document.getElementById('error-msg').classList.add('hidden');

    const name = document.getElementById('name').value.trim();
    const password = passwordRequired ? document.getElementById('password').value : undefined;

    if (!name) { showError('Please enter your name'); return; }

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(password !== undefined && { password }),
          creatorName: name,
          sessionName: preSession.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        showError(data.error || 'Failed to create session');
        return;
      }

      localStorage.setItem('friendDeciderName', name);
      localStorage.setItem(`participant:${data.sessionId}`, data.participantId);
      const dest = preItems
        ? `/session/${data.sessionId}?items=${encodeURIComponent(preItems)}`
        : `/session/${data.sessionId}`;
      window.location.href = dest;
    } catch {
      showError('Network error. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create & Join';
    }
  });
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
