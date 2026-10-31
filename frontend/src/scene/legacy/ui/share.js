import { translate as t, subscribeLocale } from '../../../app/locale-state.js';

export function buildShareRoomUrl(pageLocation, roomId) {
  if (!roomId) return null;
  const protocol = pageLocation.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//${pageLocation.host}/room?room_id=${encodeURIComponent(roomId)}`;
}

function fallbackCopy({ document, url, copiedFeedback }) {
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
  copiedFeedback();
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
  let overlayLabels = null;
  let copied = false;
  function updateLabels() {
    button.textContent = t('🔗 공유', '🔗 Share');
    if (!overlayLabels) return;
    const { title, copyButton, closeButton } = overlayLabels;
    title.textContent = t('📱 이 방 공유', '📱 Share this Room');
    copyButton.textContent = copied ? t('✅ 복사 완료!', '✅ Copied!') : t('📋 URL 복사', '📋 Copy URL');
    closeButton.textContent = t('닫기', 'Close');
  }

  const close = () => {
    overlay?.remove();
    overlay = null;
    overlayLabels = null;
    copied = false;
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
    copyButton.style.cssText = 'flex:1;padding:10px;border-radius:8px;border:none;background:#3498db;color:white;cursor:pointer;font-size:14px;font-weight:600;';
    const copiedFeedback = () => {
      if (overlayLabels?.copyButton !== copyButton) return;
      copied = true;
      updateLabels();
      setTimeout(() => {
        if (overlayLabels?.copyButton !== copyButton) return;
        copied = false;
        updateLabels();
      }, 1500);
    };
    copyButton.addEventListener('click', () => {
      const copyPromise = navigator.clipboard?.writeText?.(roomUrl);
      if (!copyPromise) {
        fallbackCopy({ document, url: roomUrl, copiedFeedback });
        return;
      }
      copyPromise
        .then(copiedFeedback)
        .catch(() => fallbackCopy({ document, url: roomUrl, copiedFeedback }));
    });

    const closeButton = document.createElement('button');
    closeButton.id = 'qr-close-btn';
    closeButton.style.cssText = 'flex:1;padding:10px;border-radius:8px;border:none;background:#555;color:white;cursor:pointer;font-size:14px;';
    closeButton.addEventListener('click', close);
    overlayLabels = { title, copyButton, closeButton };
    updateLabels();
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
  updateLabels();
  button.style.cssText = 'padding:6px 14px;background:rgba(0,0,0,0.75);color:white;border:1px solid rgba(255,255,255,0.2);border-radius:6px;cursor:pointer;font-size:12px;font-family:-apple-system,sans-serif;pointer-events:auto;';
  button.addEventListener('click', show);
  const toolbar = document.getElementById?.('room-toolbar') ?? document.body;
  toolbar.appendChild(button);
  const unsubscribeLocale = subscribeLocale(updateLabels);

  return {
    destroy() {
      unsubscribeLocale();
      close();
      button.remove();
    },
  };
}
