// Select mode: pick several lines, then move them to the next day or another day, mark them done or
// delete them, or drag them all at once. A long press let go without moving starts it, as do ⌘-click
// and Shift-click with a mouse, and Select lines in the menu.
import { state, LATER, block, activeDays, templates } from './store.js';
import { main, ui, render } from './view.js';
import { moveSheet, moveNext, nextAction, setDone, removeWithUndo } from './menus.js';

const $ = id => document.getElementById(id);
const bar = $('selbar');
let anchor = null;   // the line a Shift-click range starts from

export function startSelect() {
  if (ui.sel) return;
  if (ui.editing) document.activeElement?.blur();
  ui.sel = new Set();   // view.js shows the bar and the selected lines from this
  anchor = null;
  sync();
}

export function endSelect() {
  if (!ui.sel) return;
  ui.sel = null;
  render();
}

// A tap on a line picks it with its sub-items, or puts it back; with Shift, every line on screen from
// the last tapped line to this one is picked.
export function tap(row, e) {
  startSelect();
  const id = row.dataset.id;
  if (e?.shiftKey && anchor && anchor !== id) range(anchor, id);
  else toggle(id, !ui.sel.has(id));
  anchor = id;
  sync();
}

// Picks a line (and its sub-items) if it isn't already, as a long press in select mode does.
export function pick(id) {
  startSelect();
  if (!ui.sel.has(id)) { toggle(id, true); anchor = id; sync(); }
}

function toggle(id, on) {
  const l = state.lines.get(id);
  if (l) for (const x of block(l)) on ? ui.sel.add(x.id) : ui.sel.delete(x.id);
}

function range(a, b) {
  const ids = [...main.querySelectorAll('section.day:not(.ro) .ls > .ln')].map(r => r.dataset.id);
  let i = ids.indexOf(a), j = ids.indexOf(b);
  if (i < 0 || j < 0) return toggle(b, true);
  if (i > j) [i, j] = [j, i];
  for (const id of ids.slice(i, j + 1)) toggle(id, true);
}

// The picked lines that still exist, in planner order: days, Later, then templates.
export function chosen() {
  if (!ui.sel) return [];
  const order = new Map([...activeDays(), { id: LATER }, ...templates()].map((x, i) => [x.id, i]));
  return [...ui.sel].map(id => state.lines.get(id)).filter(Boolean)
    .sort((a, b) => (order.get(a.c) ?? order.size) - (order.get(b.c) ?? order.size) || a.pos - b.pos);
}

function sync() {
  const lines = chosen(), n = lines.length, next = n ? nextAction(lines) : null;
  $('sel-count').textContent = n ? `${n} line${n === 1 ? '' : 's'} selected` : 'Tap lines to select them';
  for (const b of bar.querySelectorAll('[data-sel]')) b.disabled = !n;
  const nextBtn = bar.querySelector('[data-sel="next"]');
  nextBtn.disabled = !next;
  nextBtn.lastChild.textContent = next?.label ?? 'Next day';
  bar.querySelector('[data-sel="done"]').lastChild.textContent = n && lines.every(l => l.done) ? 'Not done' : 'Done';
  render();
}

bar.addEventListener('click', e => {
  const b = e.target.closest('[data-sel], #sel-cancel');
  if (!b) return;
  if (b.id === 'sel-cancel') return endSelect();
  const lines = chosen();
  if (!lines.length) return;
  if (b.dataset.sel === 'move') return moveSheet(lines, endSelect);   // stays in select mode if the sheet is closed
  endSelect();
  ({ next: moveNext, done: setDone, delete: removeWithUndo })[b.dataset.sel](lines);
});

// Escape leaves select mode; Delete or Backspace deletes the selected lines (they can be undone).
document.addEventListener('keydown', e => {
  if (!ui.sel || e.target.closest?.('input, textarea, dialog')) return;
  if (e.key === 'Escape') endSelect();
  else if ((e.key === 'Backspace' || e.key === 'Delete') && chosen().length) { const lines = chosen(); endSelect(); removeWithUndo(lines); }
  else return;
  e.preventDefault();
});
