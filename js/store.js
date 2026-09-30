// Planner data: days, lines and templates, kept in memory and saved on this device.
// Every change goes through set/remove, so it can be undone, redrawn and synced record by record.

export const LATER = 'later';   // container id of the Later list
export const state = {
  days: new Map(),    // id → { id, date, fold, arch }
  lines: new Map(),   // id → { id, c: container id (day, template or LATER), pos, text, ind, done, fold, hl?: highlight color }
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

// Runs fn as one undoable step and returns the function that undoes it.
export function tx(fn) {
  if (journal) { fn(); return () => {}; }
  const steps = journal = [];
  try { fn(); } finally { journal = null; }
  return () => tx(() => {
    for (let k = steps.length; k--;) { const [map, id, before] = steps[k]; before ? set(map, before) : remove(map, id); }
  });
}

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

// Marks every record as changed, to send all of it (a device's first sync with an empty account).
export function markAllDirty() {
  for (const [k, map] of Object.entries(KINDS)) for (const id of map.keys()) state.sync.dirty.set(id, k);
  dirtyListeners.forEach(fn => fn());
  changed();
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
  return rows.map((r, k) => add(state.lines, { id: uid(), c, pos: pos[k], text: r.text, ind: r.ind, done: false, fold: !!r.fold, ...(r.hl && { hl: r.hl }) }));
}

// Moves a block to index i of container c (index counted without the block), with its first line at indent ind.
export function moveBlock(blk, c, i, ind = blk[0].ind) {
  const pos = slots(c, i, blk.length, new Set(blk.map(l => l.id))), shift = ind - blk[0].ind;
  blk.forEach((l, k) => update(state.lines, l.id, { c, pos: pos[k], ind: Math.max(0, l.ind + shift) }));
}

export const removeLines = lines => lines.forEach(l => remove(state.lines, l.id));
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
}

// Swaps all templates for imported ones: [{ name, lines }].
export function replaceTemplates(list) {
  for (const tp of templates()) { removeLines(linesOf(tp.id)); remove(state.tpls, tp.id); }
  list.forEach((t, k) => {
    const tpl = add(state.tpls, { id: uid(), name: t.name, pos: k, fold: true });
    insert(tpl.id, 0, t.lines);
  });
}
