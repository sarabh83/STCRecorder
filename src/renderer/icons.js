'use strict';
// Inline SVG icons. "logo" is the STC Recorder mark (design/logo.svg): a record dot inside a
// ring that is still being drawn; its two parts have classes so panel.css can colour and spin them.
// Elements with data-icon="name" get the matching SVG injected at load time.
(() => {
  const wrap = (viewBox, body) => `<svg viewBox="${viewBox}" width="1em" height="1em" fill="currentColor" aria-hidden="true">${body}</svg>`;
  const material = (d) => wrap('0 0 24 24', `<path d="${d}"/>`);

  const MIC = '<rect x="143" y="28" width="162" height="262" rx="81"/>'
    + '<path d="M110 218a114 114 0 0 0 228 0" fill="none" stroke="currentColor" stroke-width="26" stroke-linecap="round"/>'
    + '<path d="M110 205v13M338 205v13" stroke="currentColor" stroke-width="26" stroke-linecap="round"/>'
    + '<rect x="212" y="330" width="24" height="62"/><rect x="165" y="390" width="118" height="28" rx="14"/>';

  const LOGO = '<path class="logo-ring" fill="none" stroke="currentColor" stroke-width="26" stroke-linecap="round" d="M128 30A98 98 0 1 0 212.9 79"/>'
    + '<circle class="logo-dot" cx="128" cy="128" r="46"/>';

  const ICONS = {
    logo: wrap('0 0 256 256', LOGO),
    mic: wrap('0 0 448 448', MIC),
    'mic-off': wrap('0 0 448 448', MIC + '<path d="M60 40 388 408" stroke="#e5484d" stroke-width="30" stroke-linecap="round"/>'),
    monitor: material('M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h3l-1 1v2h12v-2l-1-1h3c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z'),
    speaker: material('M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z'),
    'speaker-off': material('M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z'),
    pause: material('M6 19h4V5H6v14zm8-14v14h4V5h-4z'),
    play: material('M8 5v14l11-7z'),
    stop: material('M6 6h12v12H6z'),
    record: wrap('0 0 24 24', '<circle cx="12" cy="12" r="7"/>'),
    logout: material('m17 7-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z'),
    folder: material('M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z'),
    bolt: material('M7 2v11h3v9l7-12h-4l4-8z'),
    check: material('M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'),
    chevron: material('M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z'),
  };

  window.ICONS = ICONS;
  window.paintIcons = (root = document) => {
    root.querySelectorAll('[data-icon]').forEach((n) => { n.innerHTML = ICONS[n.dataset.icon] || ''; });
  };
})();
