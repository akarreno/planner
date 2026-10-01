// Small DOM helpers: element builder, icons, bottom sheet, toast, and links from pasted rich text.
import { linkify } from './parse.js';

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
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  fold: 'M7 3.5l5 5 5-5M7 20.5l5-5 5 5',
  unfold: 'M7 8.5l5-5 5 5M7 15.5l5 5 5-5',
  link: 'M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1',
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

// A short message, optionally with one action button (Undo unless labelled otherwise).
export function toast(message, action, label = 'Undo', ms = 5000) {
  toastEl.replaceChildren(h('span', {}, message), action && h('button', { onclick: () => { toastEl.hidden = true; action(); } }, label));
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

// ---- Links in pasted rich text ----

// The links in copied HTML (Notes puts both HTML and plain text on the clipboard): [{ label, href }].
export function anchorsIn(html) {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('a[href]')].map(a => ({ label: a.textContent, href: a.getAttribute('href') }));
}

// For import boxes: pastes the plain text with Notes links written back in as [label](address).
export function pasteWithLinks(e) {
  const anchors = anchorsIn(e.clipboardData.getData('text/html'));
  if (!anchors.length) return;
  e.preventDefault();
  const box = e.target;
  box.setRangeText(linkify(e.clipboardData.getData('text/plain'), anchors), box.selectionStart, box.selectionEnd, 'end');
  box.dispatchEvent(new Event('input'));
}
