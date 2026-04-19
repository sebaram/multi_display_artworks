/* LLM Auto-Layout UI — admin button opens modal, sends prompt to /api/auto-layout, applies result */

function showLLMLayoutModal(roomId) {
  const modal = document.createElement('div');
  modal.id = 'llm-layout-modal';
  modal.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  `;

  modal.innerHTML = `
    <div style="background: #1a1a2e; border-radius: 16px; padding: 28px; max-width: 520px; width: 92%; color: white;">
      <h3 style="margin: 0 0 6px 0; font-size: 18px;">✨ AI Auto-Arrange</h3>
      <p style="margin: 0 0 18px 0; font-size: 13px; opacity: 0.7;">
        Describe how to arrange artworks using natural language
      </p>

      <textarea id="llm-prompt-input" placeholder="e.g. 'Place traditional paintings on the left wall, modern art on the right'
e.g. 'Group Korean artworks together, Western artworks on the opposite wall'
e.g. 'Arrange by color: warm tones on the main wall'"
        rows="4"
        style="width: 100%; padding: 12px; border-radius: 8px; border: none; font-size: 14px;
               resize: vertical; box-sizing: border-box; background: rgba(255,255,255,0.1);
               color: white; line-height: 1.5;"></textarea>

      <div id="llm-status" style="font-size: 13px; margin: 10px 0; min-height: 18px; color: #aaa;"></div>

      <div style="display: flex; gap: 8px; margin-top: 8px;">
        <button id="llm-run-btn" onclick="runLLMLayout()"
          style="flex:2; padding: 10px; border-radius: 8px; border: none; background: #9b59b6;
                 color: white; cursor: pointer; font-size: 14px; font-weight: 600;">
          ✨ Arrange with AI
        </button>
        <button onclick="closeLLLModal()"
          style="flex:1; padding: 10px; border-radius: 8px; border: none; background: #555;
                 color: white; cursor: pointer; font-size: 14px;">
          Cancel
        </button>
      </div>
    </div>
  `;

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeLLLModal();
  });
  document.body.appendChild(modal);
  document.getElementById('llm-prompt-input').focus();
}

let currentLLMRoomId = null;

function closeLLLModal() {
  const el = document.getElementById('llm-layout-modal');
  if (el) el.remove();
}

async function runLLMLayout() {
  const roomId = new URLSearchParams(window.location.search).get('room_id');
  const prompt = document.getElementById('llm-prompt-input').value.trim();
  const status = document.getElementById('llm-status');
  const btn = document.getElementById('llm-run-btn');

  if (!prompt) {
    status.textContent = 'Please enter a description';
    status.style.color = '#ff6b6b';
    return;
  }

  status.textContent = '🤖 Thinking...';
  status.style.color = '#FFA500';
  btn.disabled = true;
  btn.textContent = 'Thinking...';

  try {
    // Step 1: Get LLM arrangement
    const resp = await fetch('/api/auto-layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: roomId, prompt })
    });

    const data = await resp.json();

    if (!resp.ok) {
      status.textContent = '❌ ' + (data.error || 'Failed');
      status.style.color = '#ff6b6b';
      btn.disabled = false;
      btn.textContent = '✨ Arrange with AI';
      return;
    }

    status.textContent = '✅ ' + data.explanation;
    status.style.color = '#4CAF50';

    // Step 2: Apply layout
    status.textContent = '📐 Applying positions...';
    const applyResp = await fetch('/api/apply-layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ arrangements: data.arrangements })
    });

    const applyData = await applyResp.json();
    const okCount = applyData.results.filter(r => r.status === 'ok').length;
    status.textContent = `✅ Done! ${okCount}/${applyData.results.length} elements moved.`;
    status.style.color = '#4CAF50';

    setTimeout(() => {
      closeLLLModal();
      location.reload();  // Refresh to see new positions
    }, 2000);

  } catch (e) {
    status.textContent = '❌ Network error: ' + e.message;
    status.style.color = '#ff6b6b';
    btn.disabled = false;
    btn.textContent = '✨ Arrange with AI';
  }
}

// Admin button in room — only shown to admins
function addLLMLayoutButton() {
  // Only admins see this button (drag_enabled indicates admin in room)
  if (typeof isAdmin !== 'undefined' && !isAdmin) return;

  const btn = document.createElement('button');
  btn.id = 'llm-layout-btn';
  btn.textContent = '✨ AI Arrange';
  btn.style.cssText = `
    position: fixed;
    top: 10px;
    left: 110px;
    padding: 6px 14px;
    background: rgba(155, 89, 182, 0.9);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    z-index: 9999;
    font-family: -apple-system, sans-serif;
  `;
  btn.onclick = () => {
    const roomId = new URLSearchParams(window.location.search).get('room_id');
    showLLMLayoutModal(roomId);
  };
  document.body.appendChild(btn);
}

// ─── Effects Modal ──────────────────────────────────────────────────────────

function showLLMEffectsModal(roomId) {
  const modal = document.createElement('div');
  modal.id = 'llm-effects-modal';
  modal.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  `;

  modal.innerHTML = `
    <div style="background: #1a1a2e; border-radius: 16px; padding: 28px; max-width: 560px; width: 92%; color: white;">
      <h3 style="margin: 0 0 4px 0; font-size: 18px;">🎆 Room Effects</h3>
      <p style="margin: 0 0 18px 0; font-size: 13px; opacity: 0.7;">
        Trigger visual/audio effects using natural language
      </p>

      <textarea id="llm-effects-prompt-input"
        placeholder="e.g. 'Show glittering particles in the room'
e.g. 'Focus a spotlight on the portrait painting'
e.g. 'Create a dramatic atmosphere with warm lighting'
e.g. 'Add fog and shake the camera for 3 seconds'
e.g. 'Play ambient forest sounds with subtle lighting"
        rows="4"
        style="width: 100%; padding: 12px; border-radius: 8px; border: none; font-size: 14px;
               resize: vertical; box-sizing: border-box; background: rgba(255,255,255,0.1);
               color: white; line-height: 1.5;"></textarea>

      <div id="llm-effects-status" style="font-size: 13px; margin: 10px 0; min-height: 18px; color: #aaa;"></div>

      <div style="display: flex; gap: 8px; margin-top: 8px;">
        <button id="llm-effects-run-btn" onclick="runLLMEffects()"
          style="flex:2; padding: 10px; border-radius: 8px; border: none; background: #e67e22;
                 color: white; cursor: pointer; font-size: 14px; font-weight: 600;">
          🎆 Trigger Effects
        </button>
        <button onclick="closeLLLEffectsModal()"
          style="flex:1; padding: 10px; border-radius: 8px; border: none; background: #555;
                 color: white; cursor: pointer; font-size: 14px;">
          Cancel
        </button>
        <button onclick="clearRoomEffects()"
          style="padding: 10px; border-radius: 8px; border: none; background: #c0392b;
                 color: white; cursor: pointer; font-size: 13px;">
          Clear All
        </button>
      </div>
    </div>
  `;

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeLLLEffectsModal();
  });
  document.body.appendChild(modal);
  document.getElementById('llm-effects-prompt-input').focus();
}

function closeLLLEffectsModal() {
  const el = document.getElementById('llm-effects-modal');
  if (el) el.remove();
}

async function runLLMEffects() {
  const roomId = new URLSearchParams(window.location.search).get('room_id');
  const prompt = document.getElementById('llm-effects-prompt-input').value.trim();
  const status = document.getElementById('llm-effects-status');
  const btn = document.getElementById('llm-effects-run-btn');

  if (!prompt) {
    status.textContent = 'Please enter a description';
    status.style.color = '#ff6b6b';
    return;
  }

  status.textContent = '🤖 Thinking...';
  status.style.color = '#FFA500';
  btn.disabled = true;
  btn.textContent = 'Thinking...';

  try {
    const resp = await fetch('/api/auto-effect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: roomId, prompt })
    });

    const data = await resp.json();

    if (!resp.ok) {
      status.textContent = '❌ ' + (data.error || 'Failed');
      status.style.color = '#ff6b6b';
      btn.disabled = false;
      btn.textContent = '🎆 Trigger Effects';
      return;
    }

    status.textContent = '✅ ' + data.explanation;
    status.style.color = '#4CAF50';
    btn.disabled = false;
    btn.textContent = '🎆 Trigger Effects';

    // Effects are rendered automatically via socket event
    // Close after 2s
    setTimeout(closeLLLEffectsModal, 2000);

  } catch (e) {
    status.textContent = '❌ Network error: ' + e.message;
    status.style.color = '#ff6b6b';
    btn.disabled = false;
    btn.textContent = '🎆 Trigger Effects';
  }
}

async function clearRoomEffects() {
  const roomId = new URLSearchParams(window.location.search).get('room_id');
  try {
    await fetch('/api/clear-effects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: roomId })
    });
    closeLLLEffectsModal();
  } catch (e) {
    console.error('Failed to clear effects:', e);
  }
}

// Add effects button (next to AI Arrange)
function addLLMEffectsButton() {
  if (typeof isAdmin !== 'undefined' && !isAdmin) return;

  const btn = document.createElement('button');
  btn.id = 'llm-effects-btn';
  btn.textContent = '🎆 Effects';
  btn.style.cssText = `
    position: fixed;
    top: 10px;
    left: 210px;
    padding: 6px 14px;
    background: rgba(230, 126, 34, 0.9);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    z-index: 9999;
    font-family: -apple-system, sans-serif;
  `;
  btn.onclick = () => {
    const roomId = new URLSearchParams(window.location.search).get('room_id');
    showLLMEffectsModal(roomId);
  };
  document.body.appendChild(btn);
}

window.showLLMLayoutModal = showLLMLayoutModal;
window.closeLLLModal = closeLLLModal;
window.runLLMLayout = runLLMLayout;
window.addLLMLayoutButton = addLLMLayoutButton;
window.showLLMEffectsModal = showLLMEffectsModal;
window.closeLLLEffectsModal = closeLLLEffectsModal;
window.runLLMEffects = runLLMEffects;
window.clearRoomEffects = clearRoomEffects;
window.addLLMEffectsButton = addLLMEffectsButton;
