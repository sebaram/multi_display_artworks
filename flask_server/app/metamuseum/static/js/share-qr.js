/* QR Code Room Share — standalone local generation (no external API)

Uses qrcode-generator library from cdnjs (7KB, no dependencies).
- Generates QR code as canvas element
- Shows in modal with room URL
- Works offline
*/

// Load qrcode-generator from CDN
(function loadQRGenerator() {
  if (window.QRCode) return;  // already loaded

  var script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
  script.onload = function() {
    console.log('[QR] Generator loaded');
  };
  document.head.appendChild(script);
})();

function showShareQR() {
  var roomId = new URLSearchParams(window.location.search).get('room_id');
  if (!roomId) return;

  // Build full room URL
  var proto = location.protocol === 'https:' ? 'https:' : 'http:';
  var host = location.host;
  var avatar = new URLSearchParams(window.location.search).get('avatar') || 'shiba';
  var roomUrl = proto + '//' + host + '/room?room_id=' + roomId + '&avatar=' + avatar;

  // Generate QR code as canvas
  var qr = qrcode(0, 'M');
  qr.addData(roomUrl);
  qr.make();

  // Create modal
  var overlay = document.createElement('div');
  overlay.id = 'share-qr-overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;' +
    'align-items:center;justify-content:center;z-index:99999;' +
    'font-family:-apple-system,BlinkMacSystemFont,sans-serif;';

  var qrSize = 200;
  var qrImg = qr.createImgTag(4, 0);  // returns <img> tag string

  overlay.innerHTML =
    '<div style="background:#1a1a2e;border-radius:16px;padding:28px;max-width:340px;' +
    'width:90%;color:white;text-align:center;">' +
      '<h3 style="margin:0 0 20px 0;font-size:18px;">📱 Share this Room</h3>' +
      '<div style="background:white;border-radius:12px;padding:16px;display:inline-block;margin-bottom:20px;">' +
        '<div id="qr-container" style="display:inline-block;line-height:0;">' + qrImg + '</div>' +
      '</div>' +
      '<div style="background:rgba(255,255,255,0.1);border-radius:8px;padding:10px 14px;' +
      'margin-bottom:14px;word-break:break-all;font-size:11px;color:#aaa;max-height:60px;overflow-y:auto;">' +
        roomUrl +
      '</div>' +
      '<div style="display:flex;gap:8px;">' +
        '<button id="qr-copy-btn" style="flex:1;padding:10px;border-radius:8px;border:none;' +
        'background:#3498db;color:white;cursor:pointer;font-size:14px;font-weight:600;">' +
        '📋 Copy URL</button>' +
        '<button id="qr-close-btn" style="flex:1;padding:10px;border-radius:8px;border:none;' +
        'background:#555;color:white;cursor:pointer;font-size:14px;">Close</button>' +
      '</div>' +
    '</div>';

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeShareQR();
  });

  document.body.appendChild(overlay);

  document.getElementById('qr-copy-btn').addEventListener('click', function() {
    copyShareURL(roomUrl, this);
  });

  document.getElementById('qr-close-btn').addEventListener('click', closeShareQR);
}

function copyShareURL(url, btn) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(function() {
      var orig = btn.textContent;
      btn.textContent = '✅ Copied!';
      setTimeout(function() { btn.textContent = orig; }, 1500);
    }).catch(function() {
      fallbackCopy(url, btn);
    });
  } else {
    fallbackCopy(url, btn);
  }
}

function fallbackCopy(url, btn) {
  // Fallback for browsers without clipboard API
  var textarea = document.createElement('textarea');
  textarea.value = url;
  textarea.style.cssText = 'position:fixed;top:-999px;left:-999px;';
  document.body.appendChild(textarea);
  textarea.select();
  try { document.execCommand('copy'); } catch(e) {}
  document.body.removeChild(textarea);
  var orig = btn.textContent;
  btn.textContent = '✅ Copied!';
  setTimeout(function() { btn.textContent = orig; }, 1500);
}

function closeShareQR() {
  var el = document.getElementById('share-qr-overlay');
  if (el) el.remove();
}

// Add share button to room UI
function addShareButton() {
  var btn = document.createElement('button');
  btn.id = 'share-room-btn';
  btn.textContent = '🔗 Share';
  btn.style.cssText =
    'position:fixed;top:10px;left:10px;padding:6px 14px;' +
    'background:rgba(0,0,0,0.75);color:white;border:1px solid rgba(255,255,255,0.2);' +
    'border-radius:6px;cursor:pointer;font-size:12px;z-index:9999;' +
    'font-family:-apple-system,sans-serif;';
  btn.onclick = showShareQR;
  document.body.appendChild(btn);
}

window.showShareQR = showShareQR;
window.closeShareQR = closeShareQR;
window.addShareButton = addShareButton;
