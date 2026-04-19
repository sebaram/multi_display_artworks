/* Guest Name — prompt for display name before entering room

Flow:
1. If no name in sessionStorage → show modal
2. User enters name (3-20 chars)
3. Name stored in sessionStorage + sent via Socket.IO join_position_room
4. Displayed above avatar in 3D scene
*/

function initGuestName(roomId) {
  const stored = sessionStorage.getItem('metamuseum_guest_name');
  if (stored) {
    return stored;
  }

  // Create modal
  const overlay = document.createElement('div');
  overlay.id = 'guest-name-overlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  `;
  overlay.innerHTML = `
    <div style="background: #1a1a2e; border-radius: 16px; padding: 32px; max-width: 360px; width: 90%; color: white; text-align: center;">
      <div style="font-size: 40px; margin-bottom: 12px;">🏛️</div>
      <h2 style="margin: 0 0 8px 0; font-size: 20px;">Welcome to MetaMuseum</h2>
      <p style="margin: 0 0 24px 0; font-size: 14px; opacity: 0.7;">Enter your name to join the gallery</p>
      <input type="text" id="guest-name-input" placeholder="Your name (3-20 characters)"
        maxlength="20" minlength="3"
        style="width: 100%; padding: 12px 16px; border-radius: 8px; border: none;
               font-size: 16px; text-align: center; box-sizing: border-box; outline: none;
               background: rgba(255,255,255,0.1); color: white;"
        autocomplete="off" />
      <button id="guest-name-submit" onclick="submitGuestName()"
        style="width: 100%; margin-top: 12px; padding: 12px; border-radius: 8px;
               border: none; background: #4CAF50; color: white; font-size: 16px;
               cursor: pointer; font-weight: 600;">
        Enter Gallery →
      </button>
      <p id="guest-name-error" style="color: #ff6b6b; font-size: 13px; margin-top: 10px; min-height: 18px;"></p>
    </div>
  `;
  document.body.appendChild(overlay);

  // Enter key submits
  document.getElementById('guest-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitGuestName();
  });
  document.getElementById('guest-name-input').focus();

  return null;
}

function submitGuestName() {
  const input = document.getElementById('guest-name-input');
  const error = document.getElementById('guest-name-error');
  const name = input.value.trim();

  if (name.length < 3) {
    error.textContent = 'Name must be at least 3 characters';
    return;
  }
  if (name.length > 20) {
    error.textContent = 'Name must be 20 characters or less';
    return;
  }

  // Disallow some chars
  if (!/^[a-zA-Z0-9가-힣\s\-_'.]+$/.test(name)) {
    error.textContent = 'Letters, numbers, Korean, spaces only';
    return;
  }

  sessionStorage.setItem('metamuseum_guest_name', name);

  // Remove modal
  const overlay = document.getElementById('guest-name-overlay');
  if (overlay) overlay.remove();

  // Update socket join with name
  if (typeof posSocket !== 'undefined' && posSocket && posSocketConnected) {
    posSocket.emit('join_position_room', {
      room_id: roomId,
      userId: myUserId,
      avatar: avatarType,
      displayName: name
    });
  }

  // Update avatar name tag if already created
  updateAvatarDisplayName(name);
}

function updateAvatarDisplayName(name) {
  // Update own avatar's name tag if it exists
  const myCamera = document.getElementById(`camera-${myUserId}`);
  if (myCamera) {
    const nameTag = myCamera.querySelector('.display-name');
    if (nameTag) {
      nameTag.setAttribute('value', name);
    }
  }
}

// Store globally for socket access
window.initGuestName = initGuestName;
window.submitGuestName = submitGuestName;
