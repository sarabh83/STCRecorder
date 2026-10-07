'use strict';
// Inline SVG icons. The microphone is the Starecorder logo (solid capsule, holder, stem, base).
// Elements with data-icon="name" get the matching SVG injected at load time.
(() => {
  const wrap = (viewBox, body) => `<svg viewBox="${viewBox}" width="1em" height="1em" fill="currentColor" aria-hidden="true">${body}</svg>`;
  const material = (d) => wrap('0 0 24 24', `<path d="${d}"/>`);

  const MIC = '<rect x="143" y="28" width="162" height="262" rx="81"/>'
    + '<path d="M110 218a114 114 0 0 0 228 0" fill="none" stroke="currentColor" stroke-width="26" stroke-linecap="round"/>'
    + '<path d="M110 205v13M338 205v13" stroke="currentColor" stroke-width="26" stroke-linecap="round"/>'
    + '<rect x="212" y="330" width="24" height="62"/><rect x="165" y="390" width="118" height="28" rx="14"/>';

  const ICONS = {
    mic: wrap('0 0 448 448', MIC),
    'mic-off': wrap('0 0 448 448', MIC + '<path d="M60 40 388 408" stroke="#e5484d" stroke-width="30" stroke-linecap="round"/>'),
    monitor: material('M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h3l-1 1v2h12v-2l-1-1h3c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z'),
    speaker: material('M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z'),
    pause: material('M6 19h4V5H6v14zm8-14v14h4V5h-4z'),
    play: material('M8 5v14l11-7z'),
    stop: material('M6 6h12v12H6z'),
    record: wrap('0 0 24 24', '<circle cx="12" cy="12" r="7"/>'),
    chevron: material('M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z'),
  };

  window.ICONS = ICONS;
  window.paintIcons = (root = document) => {
    root.querySelectorAll('[data-icon]').forEach((n) => { n.innerHTML = ICONS[n.dataset.icon] || ''; });
  };
})();
