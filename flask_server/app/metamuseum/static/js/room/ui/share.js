export function buildShareRoomUrl(pageLocation, explicitRoomId) {
  const roomId = explicitRoomId
    || new URLSearchParams(pageLocation.search).get('room_id');
  if (!roomId) return null;
  const protocol = pageLocation.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//${pageLocation.host}/room?room_id=${encodeURIComponent(roomId)}`;
}

function copiedFeedback(button, setTimeout) {
  const original = button.textContent;
  button.textContent = '✅ Copied!';
  setTimeout(() => { button.textContent = original; }, 1500);
}

function fallbackCopy({ document, url, button, setTimeout }) {
  const textarea = document.createElement('textarea');
  textarea.value = url;
  textarea.style.cssText = 'position:fixed;top:-999px;left:-999px;';
  document.body.appendChild(textarea);
  textarea.select?.();
  try {
    document.execCommand?.('copy');
  } catch {
    // Copy feedback is still useful when the legacy command is unavailable.
  }
  textarea.remove();
  copiedFeedback(button, setTimeout);
}

export function mountShare({
  document,
  location,
  roomId,
  navigator,
  qrcode,
  setTimeout,
}) {
  const roomUrl = buildShareRoomUrl(location, roomId);
  let overlay = null;

  const close = () => {
    overlay?.remove();
    overlay = null;
  };

  const show = () => {
    if (!roomUrl || typeof qrcode !== 'function') return;
    close();
    const qr = qrcode(0, 'M');
    qr.addData(roomUrl);
    qr.make();

    overlay = document.createElement('div');
    overlay.id = 'share-qr-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,sans-serif;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#1a1a2e;border-radius:16px;padding:28px;max-width:340px;width:90%;color:white;text-align:center;';
    const title = document.createElement('h3');
    title.textContent = '📱 Share this Room';
    title.style.cssText = 'margin:0 0 20px 0;font-size:18px;';
    const qrContainer = document.createElement('div');
    qrContainer.id = 'qr-container';
    qrContainer.style.cssText = 'background:white;border-radius:12px;padding:16px;display:inline-block;margin-bottom:20px;line-height:0;';
    qrContainer.innerHTML = qr.createImgTag(4, 0);
    const urlText = document.createElement('div');
    urlText.textContent = roomUrl;
    urlText.style.cssText = 'background:rgba(255,255,255,0.1);border-radius:8px;padding:10px 14px;margin-bottom:14px;word-break:break-all;font-size:11px;color:#aaa;max-height:60px;overflow-y:auto;';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;';

    const copyButton = document.createElement('button');
    copyButton.id = 'qr-copy-btn';
    copyButton.textContent = '📋 Copy URL';
    copyButton.style.cssText = 'flex:1;padding:10px;border-radius:8px;border:none;background:#3498db;color:white;cursor:pointer;font-size:14px;font-weight:600;';
    copyButton.addEventListener('click', () => {
      const copyPromise = navigator.clipboard?.writeText?.(roomUrl);
      if (!copyPromise) {
        fallbackCopy({ document, url: roomUrl, button: copyButton, setTimeout });
        return;
      }
      copyPromise
        .then(() => copiedFeedback(copyButton, setTimeout))
        .catch(() => fallbackCopy({ document, url: roomUrl, button: copyButton, setTimeout }));
    });

    const closeButton = document.createElement('button');
    closeButton.id = 'qr-close-btn';
    closeButton.textContent = 'Close';
    closeButton.style.cssText = 'flex:1;padding:10px;border-radius:8px;border:none;background:#555;color:white;cursor:pointer;font-size:14px;';
    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });

    actions.appendChild(copyButton);
    actions.appendChild(closeButton);
    dialog.appendChild(title);
    dialog.appendChild(qrContainer);
    dialog.appendChild(urlText);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  };

  const button = document.createElement('button');
  button.id = 'share-room-btn';
  button.textContent = '🔗 Share';
  button.style.cssText = 'position:fixed;top:10px;left:10px;padding:6px 14px;background:rgba(0,0,0,0.75);color:white;border:1px solid rgba(255,255,255,0.2);border-radius:6px;cursor:pointer;font-size:12px;z-index:9999;font-family:-apple-system,sans-serif;';
  button.addEventListener('click', show);
  document.body.appendChild(button);

  return {
    destroy() {
      close();
      button.remove();
    },
  };
}
