'use strict';
(async () => {
  const $ = (id) => document.getElementById(id);
  let area = false; // true: after picking a screen, the user draws the part of it to record

  const add = (container, s) => {
    const card = document.createElement('button');
    card.className = 'card';
    if (s.thumb) {
      const img = document.createElement('img');
      img.src = s.thumb;
      img.alt = '';
      card.appendChild(img);
    }
    const label = document.createElement('span');
    label.textContent = s.name;
    label.title = s.name;
    card.appendChild(label);
    card.addEventListener('click', () => window.picker.choose({ id: s.id, name: s.name }, area));
    container.appendChild(card);
  };

  // An area can only be drawn on a screen: a window may move or resize under it.
  $('mode').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    area = b.dataset.mode === 'area';
    $('mode').querySelectorAll('button').forEach((n) => n.classList.toggle('on', n === b));
    $('windowsPart').hidden = area;
    $('areaHint').hidden = !area;
  });
  $('cancel').addEventListener('click', () => window.picker.cancel());
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.picker.cancel(); });
  const list = await window.picker.list();
  for (const s of list) add($(s.isScreen ? 'screens' : 'windows'), s);
})();
