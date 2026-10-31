export function isMobilePointer(coarsePointer, mobileWidth) {
  return Boolean(coarsePointer.matches && mobileWidth.matches);
}

function listen(mediaQuery, listener) {
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }
  mediaQuery.addListener(listener);
  return () => mediaQuery.removeListener(listener);
}

export function mountMobileGuidance({ document, matchMedia }) {
  const coarsePointer = matchMedia('(pointer: coarse)');
  const mobileWidth = matchMedia('(max-width: 767px)');
  let hint = null;

  function sync() {
    if (isMobilePointer(coarsePointer, mobileWidth)) {
      if (hint) return;
      hint = document.createElement('div');
      hint.setAttribute('id', 'mobile-movement-guidance');
      hint.setAttribute('role', 'status');
      hint.textContent = 'Hold and drag to move';
      hint.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9998;padding:8px 12px;border-radius:999px;background:rgba(10,14,30,0.82);color:white;font:13px sans-serif;pointer-events:none;white-space:nowrap;';
      document.body.appendChild(hint);
      return;
    }
    hint?.remove();
    hint = null;
  }

  const removeCoarseListener = listen(coarsePointer, sync);
  const removeWidthListener = listen(mobileWidth, sync);
  sync();

  return {
    destroy() {
      removeCoarseListener();
      removeWidthListener();
      hint?.remove();
      hint = null;
    },
  };
}
