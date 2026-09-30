// Editing in place: tap a line to type into it, keys that behave like Notes,
// and the toolbar that rides above the keyboard.
import { state, tx, update, remove, insert, block, moveBlock, indexOf, linesOf } from './store.js';
import { parseLines, segments, isUrl, linkText, linkAt, linkify } from './parse.js';
import { main, render } from './view.js';
import { moveSheet, toggleDone, linkSheet } from './menus.js';
import { anchorsIn } from './ui.js';

const L = state.lines;
const bar = document.getElementById('kb'), tools = document.getElementById('kb-tools'), colors = document.getElementById('kb-colors');
// Plain-text editing keeps pasted formatting out; engines without it fall back to regular editing.
const EDITABLE = (() => { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true'; })();
let cur = null;   // { id, row, tx } for the line being edited
const line = () => L.get(cur.id);
const inMirror = () => !!cur?.row.classList.contains('mir');

export function edit(row, offset) {
  const l = L.get(row.dataset.id), tx = row.firstChild;
  if (!l) return;
  if (cur?.tx !== tx) {
    cur = { id: l.id, row, tx };
    row.classList.add('ed');
    tx.textContent = l.text;
    tx.contentEditable = EDITABLE;
  } else if (tx.textContent !== l.text) tx.textContent = l.text;
  if (document.activeElement !== tx) tx.focus();
  setCaret(tx, offset ?? l.text.length);
  syncBar();
}

export function focusLine(id, offset, mirror = false) {
  const rows = [...main.querySelectorAll(`.ln[data-id="${id}"]`)];
  const row = rows.find(r => r.classList.contains('mir') === mirror) ?? rows[0];
  if (row) edit(row, offset);
}

// Starts editing where the finger or pointer landed. A drawn link shows only its label, so the
// position in the drawing is turned into the position in the line's text.
export function editAt(row, x, y) {
  const l = L.get(row.dataset.id);
  if (l) edit(row, rawOffset(l.text, offsetAt(row.firstChild, x, y)));
}

function rawOffset(text, shown) {
  let d = 0, r = 0;
  for (const [k, s, label] of segments(text)) {
    const len = k === 'l' ? label.length : s.length;
    if (shown <= d + len) return r + (k === 'l' ? 1 : 0) + shown - d;   // inside a link label: just after "["
    d += len;
    r += s.length;
  }
  return text.length;
}

// Adds a line at the end of a container (or reuses a trailing blank one) and starts editing it.
export function appendLine(c) {
  const list = linesOf(c), last = list.at(-1);
  if (last && !last.text && !last.ind) return focusLine(last.id, 0);
  let id;
  act(() => { id = insert(c, list.length, [{ text: '', ind: 0 }])[0].id; }, () => id, 0);
}

// Runs an edit as one step, redraws at once and puts the caret back, all within the same
// keypress or tap. Staying inside that event is what keeps the iPhone keyboard up.
function act(fn, id, offset) {
  const mirror = inMirror();
  tx(fn);
  render();
  if (id) focusLine(typeof id === 'function' ? id() : id, offset, mirror);
}

// ---- Caret ----

// Character offset in a drawn line nearest to a point, so editing starts where the finger landed.
export function offsetAt(el, x, y) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), r = document.createRange();
  let base = 0, best = null, bestD = Infinity;
  for (let n; (n = walk.nextNode()); base += n.length) {
    for (let i = 0; i < n.length; i++) {
      r.setStart(n, i);
      r.setEnd(n, i + 1);
      const b = r.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      const dy = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
      const dx = x < b.left ? b.left - x : x > b.right ? x - b.right : 0;
      const d = dy * 1e4 + dx;
      if (d < bestD) { bestD = d; best = base + i + (x > (b.left + b.right) / 2 ? 1 : 0); }
    }
  }
  return best ?? el.textContent.length;
}

// [start, end] of the selection inside el, as character offsets.
function caret(el) {
  const s = getSelection();
  if (!s.rangeCount) return [0, 0];
  const r = s.getRangeAt(0), pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  const start = pre.toString().length;
  return [start, start + r.toString().length];
}

function setCaret(el, offset) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), r = document.createRange();
  let n, left = offset;
  while ((n = walk.nextNode()) && left > n.length) left -= n.length;
  if (n) r.setStart(n, left); else r.setStart(el, el.childNodes.length);
  r.collapse(true);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

function caretRect() {
  const s = getSelection();
  if (!s.rangeCount) return null;
  const r = s.getRangeAt(0).cloneRange();
  r.collapse(true);
  return r.getClientRects()[0] ?? null;
}

// Is the caret on the first (up) or last (down) visual line of the line being edited?
function atEdge(up) {
  const rect = caretRect(), box = cur.tx.getBoundingClientRect();
  return !rect || (up ? rect.top - box.top < 12 : box.bottom - rect.bottom < 12);
}

// ---- Line operations ----

function enter(start, end) {
  const l = line(), text = cur.tx.textContent, before = text.slice(0, start), after = text.slice(end);
  if (!text && l.ind) return act(() => update(L, l.id, { ind: l.ind - 1 }), l.id, 0);   // Enter on an empty sub-item steps it out
  if (!before && after && start === end) return act(() => insert(l.c, indexOf(l), [{ text: '', ind: l.ind }]), l.id, 0);   // at the start: open a line above
  let id;
  act(() => {
    update(L, l.id, { text: before });
    id = insert(l.c, indexOf(l) + (l.fold ? block(l).length : 1), [{ text: after, ind: l.ind }])[0].id;
  }, () => id, 0);
}

// Backspace at the start of a line: step a sub-item out, or join the line onto the one above.
function backspace() {
  const l = line();
  if (l.ind) return act(() => update(L, l.id, { ind: l.ind - 1 }), l.id, 0);
  const above = L.get(cur.row.previousElementSibling?.dataset.id);
  if (!above) return false;
  const text = cur.tx.textContent;
  act(() => { update(L, above.id, { text: above.text + text }); remove(L, l.id); }, above.id, above.text.length);
}

// Forward delete at the end of a line joins the next line onto it.
function joinNext() {
  const next = L.get(cur.row.nextElementSibling?.dataset.id);
  if (!next) return false;
  const l = line(), text = cur.tx.textContent;
  act(() => { update(L, l.id, { text: text + next.text }); remove(L, next.id); }, l.id, text.length);
}

// Indent or outdent a line with its sub-items. A line can sit at most one level under the line above.
function shift(delta) {
  const l = line(), list = linesOf(l.c), i = list.findIndex(x => x.id === l.id), [offset] = caret(cur.tx);
  if (delta > 0 ? i === 0 || l.ind > list[i - 1].ind : !l.ind) return;
  act(() => block(l).forEach(x => update(L, x.id, { ind: Math.max(0, x.ind + delta) })), l.id, offset);
}

// Moves a line and its sub-items past the neighbouring block above or below.
function moveBy(dir) {
  const l = line(), list = linesOf(l.c), blk = block(l), i = list.findIndex(x => x.id === l.id), [offset] = caret(cur.tx);
  let to;
  if (dir < 0) {
    to = i - 1;
    while (to >= 0 && list[to].ind > l.ind) to--;
    if (to < 0) return;
  } else {
    const next = list[i + blk.length];
    if (!next) return;
    to = i + block(next).length;
  }
  act(() => moveBlock(blk, l.c, to), l.id, offset);
}

function toggle() {
  const l = line(), [offset] = caret(cur.tx), mirror = inMirror();
  toggleDone(l);
  render();
  focusLine(l.id, offset, mirror);
}

// Arrow up/down past the edge of a line continues on the neighbouring line, near the same column.
function step(dir) {
  const rows = [...main.querySelectorAll('.ln')].filter(r => r.offsetParent && !r.closest('.ro'));
  const target = rows[rows.indexOf(cur.row) + dir];
  if (!target) return false;
  const x = caretRect()?.left ?? 0, box = target.firstChild.getBoundingClientRect();
  editAt(target, x, dir < 0 ? box.bottom - 4 : box.top + 4);
}

// ---- Links ----

// Links the selected text to an address, as pasting a link over selected text does in Notes.
function setLink(start, end, url) {
  const l = line(), text = cur.tx.textContent;
  const next = text.slice(0, start) + linkText(text.slice(start, end), url) + text.slice(end);
  act(() => update(L, l.id, { text: next }), l.id, next.length - (text.length - end));
}

// Add or edit a link (⌘K, or the toolbar): on the link under the caret, or on the selected text.
function openLink() {
  const l = line(), text = cur.tx.textContent;
  let [start, end] = caret(cur.tx);
  const found = linkAt(text, start);
  if (found) ({ start, end } = found);
  cur.tx.blur();
  linkSheet({ label: found ? found.label : text.slice(start, end), url: found?.url ?? '' }, (label, url) => {
    const t = L.get(l.id).text, piece = !url ? label : label ? linkText(label, url) : url;
    tx(() => update(L, l.id, { text: t.slice(0, start) + piece + t.slice(end) }));
  });
}

// ---- Events ----

main.addEventListener('keydown', e => {
  if (!cur || e.target !== cur.tx || e.isComposing || e.keyCode === 229) return;
  const [start, end] = caret(cur.tx), k = e.key, mod = e.metaKey || e.ctrlKey;
  let done;
  if (k === 'Enter') done = mod ? toggle() : enter(start, end);
  else if (k === 'Backspace' && !mod && start === 0 && end === 0) done = backspace();
  else if (k === 'Delete' && start === end && end === cur.tx.textContent.length) done = joinNext();
  else if (k === 'Tab') done = shift(e.shiftKey ? -1 : 1);
  else if ((k === 'ArrowUp' || k === 'ArrowDown') && e.altKey) done = moveBy(k === 'ArrowUp' ? -1 : 1);
  else if ((k === 'ArrowUp' || k === 'ArrowDown') && !e.shiftKey && !mod && atEdge(k === 'ArrowUp')) done = step(k === 'ArrowUp' ? -1 : 1);
  else if (k === 'Escape') done = cur.tx.blur();
  else if (mod && k.toLowerCase() === 'k') done = openLink();
  else return;
  if (done !== false) e.preventDefault();
});

// Some keyboards skip keydown; catch Return and Backspace here too.
main.addEventListener('beforeinput', e => {
  if (!cur || e.target !== cur.tx) return;
  const [start, end] = caret(cur.tx);
  if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') { e.preventDefault(); enter(start, end); }
  else if (e.inputType === 'deleteContentBackward' && start === 0 && end === 0 && backspace() !== false) e.preventDefault();
});

main.addEventListener('input', e => {
  if (!cur || e.target !== cur.tx) return;
  const l = line();
  let text = cur.tx.textContent;
  if (text.includes('\n')) { cur.tx.textContent = text = text.replace(/\n+/g, ' '); setCaret(cur.tx, text.length); }
  if (!l.ind && /^[-*•] /.test(text) && caret(cur.tx)[0] === 2) {   // typing "- " starts a sub-item, like Notes
    cur.tx.textContent = text = text.slice(2);
    update(L, l.id, { text, ind: 1 });
    return setCaret(cur.tx, 0);
  }
  update(L, l.id, { text });
});

// Pasting an address over selected text links it. Links copied from Notes come along as [label](address).
// Pasting several lines splits them into lines, keeping their indents relative to this one.
main.addEventListener('paste', e => {
  if (!cur || !cur.tx.contains(e.target)) return;
  e.preventDefault();
  const plain = e.clipboardData.getData('text/plain').replace(/\s+$/, ''), [start, end] = caret(cur.tx);
  if (start < end && isUrl(plain)) return setLink(start, end, plain.trim());
  const raw = linkify(plain, anchorsIn(e.clipboardData.getData('text/html')));
  if (!raw.includes('\n')) return document.execCommand('insertText', false, raw);
  const rows = parseLines(raw), l = line(), text = cur.tx.textContent, tail = text.slice(end), base = rows[0].ind;
  let id;
  act(() => {
    update(L, l.id, { text: text.slice(0, start) + rows[0].text });
    const last = insert(l.c, indexOf(l) + 1, rows.slice(1).map(r => ({ text: r.text, ind: l.ind + Math.max(0, r.ind - base) }))).at(-1);
    update(L, last.id, { text: last.text + tail });
    id = last.id;
  }, () => id, rows.at(-1).text.length);
});

main.addEventListener('focusin', e => { if (e.target.classList?.contains('tx')) syncBar(); });

main.addEventListener('focusout', e => {
  const tx = e.target;
  if (!tx.classList?.contains('tx')) return;
  tx.contentEditable = 'false';
  tx.parentElement.classList.remove('ed');
  tx.parentElement.key = null;   // redraw the finished line from the saved text
  if (cur?.tx === tx) cur = null;
  queueMicrotask(render);
  requestAnimationFrame(syncBar);
});

// ---- Toolbar above the keyboard ----

bar.addEventListener('pointerdown', e => e.preventDefault());   // keep focus, and the keyboard, on the line
bar.addEventListener('mousedown', e => e.preventDefault());
bar.addEventListener('click', e => {
  if (!cur) return;
  const color = e.target.closest('[data-hl]');
  if (color) return highlight(color.dataset.hl || null);
  const b = e.target.closest('[data-kb]');
  if (!b) return;
  ({
    outdent: () => shift(-1),
    indent: () => shift(1),
    done: toggle,
    up: () => moveBy(-1),
    down: () => moveBy(1),
    move: () => { const l = line(); cur.tx.blur(); moveSheet(l); },
    link: openLink,
    mark: () => showColors(true),
    close: () => cur.tx.blur(),
  })[b.dataset.kb]();
});

// The highlight button swaps the tools for a row of colors; picking one (or none) swaps them back.
function showColors(on) {
  tools.hidden = on;
  colors.hidden = !on;
  if (on) for (const b of colors.querySelectorAll('[data-hl]')) b.classList.toggle('on', (line().hl || '') === b.dataset.hl);
}

function highlight(color) {
  const l = line(), [offset] = caret(cur.tx);
  act(() => update(L, l.id, { hl: color }), l.id, offset);
  showColors(false);
}

function syncBar() {
  const on = !!cur && document.activeElement === cur.tx;
  bar.hidden = !on;
  if (!on) showColors(false);
  document.body.classList.toggle('editing', on);
  if (!on) return;
  placeBar();
  bar.querySelector('[data-kb="done"]').classList.toggle('on', !!line()?.done);
}

// iOS keeps fixed elements behind the keyboard; lift the bar by the part of the screen the keyboard covers.
const vv = window.visualViewport;
function placeBar() { if (vv) bar.style.transform = `translateY(${Math.min(0, vv.height + vv.offsetTop - innerHeight)}px)`; }
vv?.addEventListener('resize', placeBar);
vv?.addEventListener('scroll', placeBar);
