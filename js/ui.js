// Small DOM helpers: element builder, icons, bottom sheet and toast.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && !k.includes('-')) el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter(x => x != null && x !== false && x !== ''));
  return el;
}

const PATHS = {
  chev: 'M9 6l6 6-6 6',
  back: 'M15 5l-7 7 7 7',
  more: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
  fill: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 9.5h16M8.5 3v4M15.5 3v4M12 12.5v5M9.5 15h5',
  outdent: 'M11 6h9M11 12h9M11 18h9M7.5 9L4.5 12l3 3',
  indent: 'M11 6h9M11 12h9M11 18h9M4.5 9l3 3-3 3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  move: 'M4 12h12M12 7l5 5-5 5M20 5v14',
  hide: 'M6 9.5l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
};

export function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="ic i-${name}" viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;
  return t.content.firstChild;
}
// Static markup marks icon slots with data-icon="name".
export const fillIcons = root => root.querySelectorAll('[data-icon]').forEach(el => el.prepend(icon(el.dataset.icon)));

// ---- Bottom sheet ----

const dlg = document.getElementById('sheet');
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

export function sheet(title, ...body) {
  dlg.replaceChildren(
    h('div', { className: 'sh-h' }, h('h3', {}, title), h('button', { className: 'ib', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('close'))),
    h('div', { className: 'sh-b' }, ...body));
  if (!dlg.open) dlg.showModal();
}
export const closeSheet = () => dlg.close();

// A sheet of actions: items are { label, run, danger?, checked?, hint? } or falsy (skipped).
export const choose = (title, items, ...extra) => sheet(title,
  ...items.filter(Boolean).map(it => h('button', { className: 'act' + (it.danger ? ' danger' : ''), onclick: () => { closeSheet(); it.run(); } },
    h('span', {}, it.label), it.checked ? icon('check') : it.hint ? h('span', { className: 'hint' }, it.hint) : null)),
  ...extra);

// ---- Toast ----

const toastEl = document.getElementById('toast');
let toastTimer = 0;

export function toast(message, undo) {
  toastEl.replaceChildren(h('span', {}, message), undo && h('button', { onclick: () => { toastEl.hidden = true; undo(); } }, 'Undo'));
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 5000);
}
