'use strict';
// Small dropdown used instead of a native <select>, so the option list matches the panel.
// Markup: .select > button.select-trigger (span.select-value + icon) + div.select-menu[hidden]
(() => {
  window.createSelect = (root, onChange, onOpen) => {
    const trigger = root.querySelector('.select-trigger');
    const valueEl = root.querySelector('.select-value');
    const menu = root.querySelector('.select-menu');
    let options = []; // [{value, label}]
    let value = '';
    let active = -1; // option under the keyboard / mouse

    const isOpen = () => !menu.hidden;
    const current = () => options.find((o) => o.value === value);

    function paintActive() {
      [...menu.children].forEach((n, i) => n.classList.toggle('active', i === active));
      if (menu.children[active]) menu.children[active].scrollIntoView({ block: 'nearest' });
    }

    function paint() {
      const cur = current();
      valueEl.textContent = cur ? cur.label : '';
      trigger.title = cur ? cur.label : '';
      menu.textContent = '';
      options.forEach((o, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'select-option';
        b.tabIndex = -1;
        b.dataset.index = i;
        b.setAttribute('role', 'option');
        b.setAttribute('aria-selected', String(o.value === value));
        const text = document.createElement('span');
        text.textContent = o.label;
        const check = document.createElement('i');
        check.dataset.icon = 'check';
        b.append(text, check);
        menu.appendChild(b);
      });
      window.paintIcons(menu);
      paintActive();
    }

    function setOpen(next) {
      if (next === isOpen() || (next && trigger.disabled)) return;
      menu.hidden = !next;
      root.classList.toggle('open', next);
      trigger.setAttribute('aria-expanded', String(next));
      if (next) {
        active = Math.max(0, options.findIndex((o) => o.value === value));
        paintActive();
        if (onOpen) onOpen(); // lets the owner refresh the options
      }
    }

    function pick(i) {
      const o = options[i];
      setOpen(false);
      if (!o || o.value === value) return;
      value = o.value;
      paint();
      onChange(o.value, o.label);
    }

    trigger.addEventListener('click', () => setOpen(!isOpen()));
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('.select-option');
      if (b) pick(Number(b.dataset.index));
    });
    menu.addEventListener('pointermove', (e) => {
      const b = e.target.closest('.select-option');
      if (b && Number(b.dataset.index) !== active) {
        active = Number(b.dataset.index);
        paintActive();
      }
    });
    root.addEventListener('keydown', (e) => {
      const move = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (!isOpen()) {
        if (move) {
          e.preventDefault();
          setOpen(true);
        }
        return;
      }
      if (move) {
        active = Math.max(0, Math.min(options.length - 1, active + move));
        paintActive();
      } else if (e.key === 'Enter' || e.key === ' ') {
        pick(active);
      } else if (e.key === 'Escape' || e.key === 'Tab') {
        setOpen(false);
      } else {
        return;
      }
      e.preventDefault();
      e.stopPropagation(); // Escape closes the list, not the whole panel
    });
    document.addEventListener('pointerdown', (e) => { if (!root.contains(e.target)) setOpen(false); });
    window.addEventListener('blur', () => setOpen(false));

    return {
      setOptions(list, selected) {
        options = list;
        value = selected;
        active = isOpen() ? Math.max(0, list.findIndex((o) => o.value === selected)) : -1;
        paint();
      },
      close: () => setOpen(false),
      set disabled(v) {
        trigger.disabled = v;
        if (v) setOpen(false);
      },
    };
  };
})();
