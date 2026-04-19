/* QR Code Room Share — generate QR code for current room URL

Uses QRServer.com API (no library needed) or embeds a QR code canvas.
Clicking "Share" → shows QR code modal with room URL + copy button.
*/

function showShareQR() {
  const roomId = new URLSearchParams(window.location.search).get('room_id');
  if (!roomId) return;

  // Build full room URL
  const proto = location.protocol === 'https:' ? 'https:' : 'http:';
  const host = location.host;
  const avatar = new URLSearchParams(window.location.search).get('avatar') || 'shiba';
  const roomUrl = `${proto}//${host}/room?room_id=${roomId}&avatar=${avatar}`;

  // Create modal
  const overlay = document.createElement('div');
  overlay.id = 'share-qr-overlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  `;

  overlay.innerHTML = `
    <div style="background: #1a1a2e; border-radius: 16px; padding: 28px; max-width: 340px; width: 90%; color: white; text-align: center;">
      <h3 style="margin: 0 0 20px 0; font-size: 18px;">📱 Share this Room</h3>

      <div style="background: white; border-radius: 12px; padding: 16px; display: inline-block; margin-bottom: 20px;">
        <img id="qr-image" src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(roomUrl)}&bgcolor=ffffff&color=1a1a2e"
             style="display: block; width: 200px; height: 200px;"
             alt="QR Code" />
      </div>

      <div style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; word-break: break-all; font-size: 11px; color: #aaa;">
        ${roomUrl}
      </div>

      <div style="display: flex; gap: 8px;">
        <button onclick="copyShareURL('${roomUrl.replace(/'/g, "\\'")}')"
          style="flex:1; padding: 10px; border-radius: 8px; border: none; background: #3498db; color: white; cursor: pointer; font-size: 14px;">
          📋 Copy URL
        </button>
        <button onclick="closeShareQR()"
          style="flex:1; padding: 10px; border-radius: 8px; border: none; background: #555; color: white; cursor: pointer; font-size: 14px;">
          Close
        </button>
      </div>
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeShareQR();
  });

  document.body.appendChild(overlay);
}

function copyShareURL(url) {
  navigator.clipboard.writeText(url).then(() => {
    // Brief flash
    const btn = document.querySelector('#share-qr-overlay button');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✅ Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }
  }).catch(() => {
    // Fallback
    prompt('Copy this URL:', url);
  });
}

function closeShareQR() {
  const el = document.getElementById('share-qr-overlay');
  if (el) el.remove();
}

// Add share button to room UI
function addShareButton() {
  const btn = document.createElement('button');
  btn.id = 'share-room-btn';
  btn.textContent = '🔗 Share';
  btn.style.cssText = `
    position: fixed;
    top: 10px;
    left: 10px;
    padding: 6px 14px;
    background: rgba(0,0,0,0.75);
    color: white;
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    z-index: 9999;
    font-family: -apple-system, sans-serif;
  `;
  btn.onclick = showShareQR;
  document.body.appendChild(btn);
}

window.showShareQR = showShareQR;
window.closeShareQR = closeShareQR;
window.addShareButton = addShareButton;
