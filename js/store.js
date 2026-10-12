// Planner data: days, lines and templates, kept in memory and saved on this device.
// Every change goes through set/remove, so it can be undone, redrawn and synced record by record.
import { toggleStyle, clock, afterMidnight } from './parse.js';

export const LATER = 'later';   // container id of the Later list
export const state = {
  days: new Map(),    // id → { id, date, fold, arch }
  lines: new Map(),   // id → { id, c: container id (day, template or LATER), pos, text, ind, done, fold }
  tpls: new Map(),    // id → { id, name, pos, fold }
  prefs: { hideDone: true, laterFold: false },
  // Sync bookkeeping: the signed-in account, the newest server time seen, and records changed here but not sent yet.
  sync: { uid: null, since: null, dirty: new Map() },   // dirty: record id → kind
};
// Record kinds as sync names them.
export const KINDS = { d: state.days, l: state.lines, t: state.tpls };
const kindOf = map => map === state.lines ? 'l' : map === state.days ? 'd' : 't';
const byContainer = new Map();   // container id → Set of line ids
const listeners = new Set(), dirtyListeners = new Set();
const KEY = 'planner.v1';
let journal = null, queued = false, saveTimer = 0, remote = false;

export const uid = () => { const [a, b] = crypto.getRandomValues(new Uint32Array(2)); return a.toString(36) + b.toString(36); };
export const onChange = fn => listeners.add(fn);
export const onDirty = fn => (dirtyListeners.add(fn), () => dirtyListeners.delete(fn));

function set(map, rec) {
  const before = map.get(rec.id);
  journal?.push([map, rec.id, before]);
  map.set(rec.id, rec);
  if (map === state.lines) reindex(rec, before);
  touched(map, rec.id);
}
export function remove(map, id) {
  const before = map.get(id);
  if (!before) return;
  journal?.push([map, id, before]);
  map.delete(id);
  if (map === state.lines) reindex(null, before);
  touched(map, id);
}
export const update = (map, id, patch) => set(map, { ...map.get(id), ...patch });
export const add = (map, rec) => (set(map, rec), rec);
export function setPref(key, value) { state.prefs = { ...state.prefs, [key]: value }; changed(); }

function reindex(rec, before) {
  if (before) byContainer.get(before.c)?.delete(before.id);
  if (rec) (byContainer.get(rec.c) ?? byContainer.set(rec.c, new Set()).get(rec.c)).add(rec.id);
}

function touched(map, id) {
  if (!remote) { state.sync.dirty.set(id, kindOf(map)); dirtyListeners.forEach(fn => fn()); }
  changed();
}

export function changed() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 300);
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; listeners.forEach(fn => fn()); });
}

// ---- Undo and redo ----

// The last changes made on this device, newest last, each a list of [map, id, record before].
// Changes from other devices are never recorded. Undoing a step puts its reverse on the redo list,
// and any new change clears that list.
const history = [], future = [];
const HISTORY = 20;
let typing = null;   // the typing burst still growing: { id, step, at }

// Runs fn as one undoable step and returns the function that undoes it.
export function tx(fn) {
  if (journal) { fn(); return () => {}; }
  const step = journal = [];
  try { fn(); } finally { journal = null; }
  if (!step.length) return () => {};
  history.push(step);
  if (history.length > HISTORY) history.shift();
  future.length = 0;
  typing = null;
  return () => revert(step);
}

// Typing in one line counts as one step until a pause of 2 seconds, like undo in Notes.
export function typed(id, patch) {
  const now = Date.now();
  if (typing?.id === id && now - typing.at < 2000 && history.at(-1) === typing.step) {
    typing.at = now;
    return update(state.lines, id, patch);
  }
  tx(() => update(state.lines, id, patch));
  typing = { id, step: history.at(-1), at: now };
}

// Puts back the records a step changed, and returns the step that reverses that.
function apply(step) {
  const back = journal = [];
  try { for (let k = step.length; k--;) { const [map, id, before] = step[k]; before ? set(map, before) : remove(map, id); } } finally { journal = null; }
  typing = null;
  return back;
}

function revert(step) {
  const i = history.indexOf(step);
  if (i < 0) return false;   // already undone
  history.splice(i, 1);
  future.push(apply(step));
  if (future.length > HISTORY) future.shift();
  return true;
}

// Undoes the most recent change, or redoes the most recently undone one; false when there's none.
export const undo = () => history.length > 0 && revert(history.at(-1));
export function redo() {
  if (!future.length) return false;
  history.push(apply(future.pop()));
  return true;
}
export const canUndo = () => history.length > 0;
export const canRedo = () => future.length > 0;

// ---- Sync ----

const same = (a, b) => !!a && Object.keys(a).length === Object.keys(b).length && Object.keys(b).every(k => a[k] === b[k]);

// Applies changes from another device: [{ id, kind, rec }], where rec null means deleted.
// They are not marked as changed here, so they don't bounce back.
export function applyRemote(changes) {
  remote = true;
  try {
    for (const { id, kind, rec } of changes) {
      const map = KINDS[kind];
      if (!map) continue;
      if (rec) { if (!same(map.get(id), rec)) set(map, rec); } else remove(map, id);
    }
  } finally { remote = false; }
}

// Swaps everything for records from sync (a device's first sync with an account that has data).
export function replaceAll(changes) {
  remote = true;
  try { for (const map of Object.values(KINDS)) for (const id of [...map.keys()]) remove(map, id); } finally { remote = false; }
  state.sync.dirty.clear();
  applyRemote(changes);
}

// Swaps the planner for a saved copy ({ days, lines, tpls }) as one undoable step; returns the undo.
export function restoreCopy({ days, lines, tpls }) {
  return tx(() => {
    for (const map of Object.values(KINDS)) for (const id of [...map.keys()]) remove(map, id);
    for (const d of days) set(state.days, d);
    for (const t of tpls) set(state.tpls, t);
    for (const l of lines) set(state.lines, l);
  });
}

// Marks every record as changed, to send all of it (a device's first sync with an empty account).
export function markAllDirty() {
  for (const [k, map] of Object.entries(KINDS)) for (const id of map.keys()) state.sync.dirty.set(id, k);
  dirtyListeners.forEach(fn => fn());
  changed();
}

// Highlights used to color a whole line (an hl field); now they mark text inside the line.
function fromLineHighlight({ hl, ...l }) {
  return hl ? { ...l, text: toggleStyle(l.text, 0, 0, 'h', hl)?.text ?? l.text } : l;
}

// ---- Saving on this device ----

export function save() {
  clearTimeout(saveTimer);
  const { days, lines, tpls, prefs, sync } = state;
  try {
    localStorage.setItem(KEY, JSON.stringify({
      v: 2, days: [...days.values()], lines: [...lines.values()], tpls: [...tpls.values()], prefs,
      sync: { uid: sync.uid, since: sync.since, dirty: [...sync.dirty] },
    }));
  } catch { /* storage blocked or full: keep working in memory */ }
}

export function load() {
  let data;
  try { data = JSON.parse(localStorage.getItem(KEY)); } catch { return false; }
  if (data?.v !== 1 && data?.v !== 2) return false;
  for (const d of data.days) state.days.set(d.id, d);
  for (const t of data.tpls) state.tpls.set(t.id, t);
  for (const l of data.lines) { state.lines.set(l.id, l); reindex(l); }
  for (const l of state.lines.values()) if ('hl' in l) set(state.lines, fromLineHighlight(l));
  tidyAll();
  if (data.v === 2) {   // version 1 had other defaults: keep the new ones
    state.prefs = { ...state.prefs, ...data.prefs };
    state.sync = { ...data.sync, dirty: new Map(data.sync.dirty) };
  }
  return true;
}

// ---- Queries ----

const byPos = (a, b) => a.pos - b.pos;
export const linesOf = c => [...(byContainer.get(c) ?? [])].map(id => state.lines.get(id)).sort(byPos);
export const indexOf = line => linesOf(line.c).findIndex(l => l.id === line.id);
export const activeDays = () => [...state.days.values()].filter(d => !d.arch).sort((a, b) => a.date.localeCompare(b.date));
export const archivedDays = () => [...state.days.values()].filter(d => d.arch).sort((a, b) => b.date.localeCompare(a.date));
export const templates = () => [...state.tpls.values()].sort(byPos);
export const dayOn = date => activeDays().find(d => d.date === date);

// A line plus the more-indented lines right under it.
export function block(line) {
  const list = linesOf(line.c), i = list.findIndex(l => l.id === line.id);
  let j = i + 1;
  while (j < list.length && list[j].ind > line.ind) j++;
  return list.slice(i, j);
}

// ---- Changes ----

export const ensureDay = date => dayOn(date) ?? add(state.days, { id: uid(), date, fold: false, arch: false });

// Positions for n lines placed at index i of container c (not counting lines in skip).
// Positions are fractions between neighbours, so only the moved lines change.
function slots(c, i, n, skip) {
  const list = skip ? linesOf(c).filter(l => !skip.has(l.id)) : linesOf(c);
  let a = list[i - 1]?.pos, b = list[i]?.pos;
  if (a == null) a = b == null ? 0 : b - n - 1;
  if (b == null) b = a + n + 1;
  const step = (b - a) / (n + 1);
  if (step < 1e-9) {   // gap worn out by many inserts: respace the container once
    list.forEach((l, k) => update(state.lines, l.id, { pos: k + 1 }));
    return slots(c, i, n, skip);
  }
  return Array.from({ length: n }, (_, k) => a + step * (k + 1));
}

// Inserts rows ({ text, ind, fold? }) at index i of container c and returns the new lines.
export function insert(c, i, rows) {
  const pos = slots(c, i, rows.length);
  return rows.map((r, k) => add(state.lines, { id: uid(), c, pos: pos[k], text: r.text, ind: r.ind, done: false, fold: !!r.fold }));
}

// Splits lines (in planner order) into runs of lines that sit next to each other in their container.
function runs(lines) {
  const next = new Map(), out = [];
  for (const c of new Set(lines.map(l => l.c))) linesOf(c).forEach((l, i, list) => next.set(l.id, list[i + 1]?.id));
  lines.forEach((l, k) => (k && next.get(lines[k - 1].id) === l.id ? out.at(-1).push(l) : out.push([l])));
  return out;
}

// Moves lines to index i of container c (index counted without them), together and in order. Each run
// of lines that sat together starts at indent ind and keeps its sub-items' indents.
export function moveBlock(blk, c, i, ind = blk[0].ind) {
  const pos = slots(c, i, blk.length, new Set(blk.map(l => l.id)));
  let k = 0;
  for (const run of runs(blk)) {
    const shift = ind - run[0].ind;
    for (const l of run) update(state.lines, l.id, { c, pos: pos[k++], ind: Math.max(0, l.ind + shift) });
  }
}

// Moves lines (in planner order) to another day, Later or a template as top-level lines. Each line goes
// with the sub-items under it; on a day it goes before the first line timed later than it (if it has
// a time), else at the end.
export function moveLines(lines, c) {
  lines = lines.map(l => state.lines.get(l.id)).filter(Boolean);   // as they are now
  const from = new Set(lines.map(l => l.c)), units = [];   // a line and the deeper lines right after it
  for (const run of runs(lines)) {
    let head = null;
    for (const l of run) if (head && l.ind > head.ind) units.at(-1).push(l); else { head = l; units.push([l]); }
  }
  for (const unit of units) {
    const ids = new Set(unit.map(l => l.id)), list = linesOf(c).filter(l => !ids.has(l.id));
    const t = state.days.has(c) ? clock(unit[0].text) : null;
    let i = list.length;
    if (t != null) {
      let prev = null;
      i = list.findIndex(l => { const m = l.ind ? null : afterMidnight(prev, clock(l.text)); if (m != null) prev = m; return m != null && m > t; });
      if (i < 0) i = list.length;
    }
    moveBlock(unit, c, i, 0);
  }
  for (const x of from) tidy(x);
  tidy(c);
}

export const removeLines = lines => lines.forEach(l => remove(state.lines, l.id));

// Blank lines: at most one in a row, and none at the start or end of a day, Later or a template.
// keep: a line that's being typed in, never removed. Blank lines with sub-items stay.
export function tidy(c, keep) {
  const list = linesOf(c), drop = new Set();
  const blank = (l, i) => l.id !== keep && !l.text.trim() && !(list[i + 1]?.ind > l.ind);
  let prevBlank = true;   // so blanks at the start go
  list.forEach((l, i) => {
    if (blank(l, i) && prevBlank) drop.add(l.id);
    else prevBlank = blank(l, i);
  });
  for (let i = list.length - 1; i >= 0 && (drop.has(list[i].id) || blank(list[i], i)); i--) drop.add(list[i].id);
  for (const id of drop) remove(state.lines, id);
}
export const tidyAll = () => [...byContainer.keys()].forEach(c => tidy(c));
export function removeDay(day) { removeLines(linesOf(day.id)); remove(state.days, day.id); }

// plan: [{ date, tpl }], where tpl is a template id, or null for a blank day.
export function fillDays(plan) {
  for (const { date, tpl } of plan) {
    const day = ensureDay(date);
    if (tpl) insert(day.id, linesOf(day.id).length, linesOf(tpl));
  }
}

// Swaps the planner (active days and Later) for imported content. Archived days stay.
export function replacePlanner({ days, later }) {
  activeDays().forEach(removeDay);
  removeLines(linesOf(LATER));
  for (const d of days) { const day = ensureDay(d.date); insert(day.id, linesOf(day.id).length, d.lines); }
  insert(LATER, 0, later);
  tidyAll();
}

// Adds imported content to the planner: each day's lines go at the end of that day (created if needed),
// and Later lines at the end of Later, after a blank line where there's already something.
export function addToPlanner({ days, later }) {
  const append = (c, rows) => {
    if (!rows.length) return;
    const list = linesOf(c);
    insert(c, list.length, list.length && list.at(-1).text.trim() ? [{ text: '', ind: 0 }, ...rows] : rows);
  };
  for (const d of days) append(ensureDay(d.date).id, d.lines);
  append(LATER, later);
  for (const c of [...days.map(d => dayOn(d.date).id), LATER]) tidy(c);
}

// Imported templates ([{ name, lines }]) replace templates with the same name; the others stay.
export function importTemplateList(list) {
  for (const t of list) {
    const old = templates().find(tp => tp.name.toLowerCase() === t.name.toLowerCase());
    if (old) removeLines(linesOf(old.id));
    const tpl = old ?? add(state.tpls, { id: uid(), name: t.name, pos: (templates().at(-1)?.pos ?? -1) + 1, fold: true });
    insert(tpl.id, 0, t.lines);
  }
}
