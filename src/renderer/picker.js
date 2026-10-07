'use strict';
(async () => {
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
    card.addEventListener('click', () => window.picker.choose({ id: s.id, name: s.name }));
    container.appendChild(card);
  };
  document.getElementById('cancel').addEventListener('click', () => window.picker.cancel());
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.picker.cancel(); });
  const list = await window.picker.list();
  for (const s of list) add(document.getElementById(s.isScreen ? 'screens' : 'windows'), s);
})();
