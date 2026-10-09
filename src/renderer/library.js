'use strict';
// The "Recordings" tab: what is on disk, with play / open folder / final processing (MP4).
(() => {
  const list = document.getElementById('libList');
  const empty = document.getElementById('libEmpty');
  let items = []; // from the main process, newest first
  let busyId = null; // the recording being processed
  const errors = new Map(); // id -> why its last processing failed

  const size = (bytes) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`);
  const length = (ms) => {
    const s = Math.round(ms / 1000);
    const p = (n) => String(n).padStart(2, '0');
    return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`;
  };
  const when = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  function button(icon, title, onClick) {
    const b = document.createElement('button');
    b.className = 'icon-btn';
    b.title = title;
    const i = document.createElement('i');
    i.dataset.icon = icon;
    b.appendChild(i);
    b.addEventListener('click', onClick);
    return b;
  }

  function paint() {
    list.textContent = '';
    empty.hidden = items.length > 0;
    for (const r of items) {
      const busy = r.id === busyId;
      const row = document.createElement('div');
      row.className = 'lib-item';
      row.dataset.id = r.id;
      row.classList.toggle('busy', busy);

      const text = document.createElement('div');
      text.className = 'lib-text';
      const name = document.createElement('div');
      name.className = 'lib-name';
      name.textContent = when(r.startedAt);
      const meta = document.createElement('div');
      meta.className = 'lib-meta';
      const error = errors.get(r.id);
      if (error) {
        meta.classList.add('error');
        meta.textContent = error;
      } else {
        meta.textContent = `${length(r.durationMs)} · ${size(r.size)}`;
        if (!r.done) meta.textContent += ' · interrupted';
        if (r.mp4Size) {
          const mp4 = document.createElement('b');
          mp4.textContent = ` → MP4 ${size(r.mp4Size)}`;
          meta.appendChild(mp4);
        }
      }
      text.append(name, meta);

      const process = button(r.mp4Size ? 'check' : 'bolt', r.mp4Size ? 'Processed – click to do it again' : 'Final processing: convert to a small MP4', () => run(r.id));
      process.classList.add('lib-process');
      process.classList.toggle('done', !!r.mp4Size);
      process.disabled = busyId !== null;
      if (busy) process.textContent = '0%';

      const bar = document.createElement('div');
      bar.className = 'lib-bar';
      bar.appendChild(document.createElement('i'));

      row.append(
        text,
        button('play', r.mp4Size ? 'Play the MP4' : 'Play', () => window.api.libPlay(r.id)),
        button('folder', 'Open folder', () => window.api.libFolder(r.id)),
        process,
        bar,
      );
      list.appendChild(row);
    }
    window.paintIcons(list);
  }

  async function refresh() {
    items = await window.api.libList();
    const running = items.find((r) => r.processing);
    busyId = running ? running.id : null;
    paint();
  }

  async function run(id) {
    if (busyId) return;
    busyId = id;
    errors.delete(id);
    paint();
    const res = await window.api.libProcess(id);
    busyId = null;
    if (res && res.error) errors.set(id, res.error);
    await refresh();
  }

  window.api.onLibProgress((id, p) => {
    const row = [...list.children].find((n) => n.dataset.id === id);
    if (!row) return;
    row.querySelector('.lib-process').textContent = `${Math.floor(p * 100)}%`;
    row.querySelector('.lib-bar i').style.width = `${p * 100}%`;
  });

  window.library = { refresh };
})();
