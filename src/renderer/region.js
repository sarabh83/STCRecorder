'use strict';
// Full-screen overlay: drag a rectangle, release to confirm. The answer is sent as
// fractions of the screen so it does not depend on display scaling.
(() => {
  const MIN = 48; // px; anything smaller is treated as a slip of the hand
  const box = document.getElementById('box');
  const size = document.getElementById('size');
  let start = null;
  let rect = null;

  function paint(e) {
    const x = Math.max(0, Math.min(start.x, e.clientX));
    const y = Math.max(0, Math.min(start.y, e.clientY));
    const right = Math.min(window.innerWidth, Math.max(start.x, e.clientX));
    const bottom = Math.min(window.innerHeight, Math.max(start.y, e.clientY));
    rect = { x, y, w: right - x, h: bottom - y };
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${rect.w}px`;
    box.style.height = `${rect.h}px`;
    box.classList.toggle('low', y < 30); // no room above for the size label
    const scale = window.devicePixelRatio || 1;
    size.textContent = `${Math.round(rect.w * scale)} × ${Math.round(rect.h * scale)}`;
  }

  window.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY };
    document.body.classList.add('drawing');
    box.hidden = false;
    paint(e);
  });
  window.addEventListener('pointermove', (e) => { if (start) paint(e); });
  window.addEventListener('pointerup', () => {
    if (!start) return;
    start = null;
    if (rect.w >= MIN && rect.h >= MIN) {
      window.region.done({
        x: rect.x / window.innerWidth,
        y: rect.y / window.innerHeight,
        w: rect.w / window.innerWidth,
        h: rect.h / window.innerHeight,
      });
    } else { // too small: let the user draw again
      box.hidden = true;
      document.body.classList.remove('drawing');
    }
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.region.cancel(); });
  window.addEventListener('contextmenu', () => window.region.cancel());
})();
