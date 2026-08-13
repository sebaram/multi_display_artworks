import { INTERPOLATION_DELAY_MS } from '../core/sync-constants.js';

export function mountSyncDebug({
  document, poseBuffer, socketClient, now, setInterval, clearInterval,
}) {
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;top:8px;left:8px;padding:6px 10px;background:rgba(0,0,0,0.7);'
    + 'color:#0f0;font:12px monospace;white-space:pre;z-index:10000;pointer-events:none;';
  document.body.appendChild(panel);

  let sends = 0;
  let receives = 0;
  let windowStart = now();

  const originalEmit = socketClient.emit;
  socketClient.emit = (event, payload) => {
    if (event === 'position_update') sends += 1;
    return originalEmit.call(socketClient, event, payload);
  };

  function refresh() {
    const elapsed = Math.max(1, now() - windowStart) / 1000;
    const staleness = poseBuffer.userIds()
      .map((userId) => poseBuffer.stalenessMs(userId, now()) ?? 0);
    const worst = staleness.length ? Math.max(...staleness) : 0;

    panel.textContent = [
      `send ${Math.round(sends / elapsed)}/s`,
      `recv ${Math.round(receives / elapsed)}/s`,
      `peers ${staleness.length}`,
      `stale ${Math.round(worst)}ms`,
      `delay ${INTERPOLATION_DELAY_MS}ms`,
    ].join('  ');

    sends = 0;
    receives = 0;
    windowStart = now();
  }

  const timer = setInterval(refresh, 1000);

  return {
    recordReceive() {
      receives += 1;
    },
    destroy() {
      clearInterval(timer);
      socketClient.emit = originalEmit;
      panel.remove();
    },
  };
}
