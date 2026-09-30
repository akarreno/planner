// Draws the current screen from state. Sections and rows are keyed by id and only touched when
// something about them changed, so the line being edited keeps its focus and caret.
import { state, LATER, linesOf, activeDays, archivedDays, templates, dayOn } from './store.js';
import { segments, kind, clock, leadDate, headTitle, today, addDays, nowMinutes, clockLabel, NUMBERED } from './parse.js';
import { h, icon } from './ui.js';

export const main = document.getElementById('main');
export const ui = { screen: 'plan', query: '' };
const $ = id => document.getElementById(id);
const TITLES = { tpl: 'Templates', arch: 'Archive' };
const sections = new Map();   // key → <section>
const extras = {};            // non-section elements, created once

// The planner has no top bar; Templates and Archive get one with a back button.
export function go(screen) {
  ui.screen = screen;
  const sub = screen !== 'plan';
  $('title').textContent = TITLES[screen] ?? '';
  $('bar').hidden = !sub;
  $('search').hidden = screen !== 'arch';
  $('menu').hidden = sub;
  document.body.classList.toggle('sub', sub);
  render();
  scrollTo(0, 0);
}

export function scrollToDate(date) {
  const day = dayOn(date) ?? activeDays().find(d => d.date > date);
  sections.get(day?.id)?.scrollIntoView({ block: 'start' });
}

// Brings the "now" line to about a third of the way down the screen; without one, today's start.
export function scrollToNow() {
  const t = today(), sec = sections.get(dayOn(t)?.id);
  const mark = sec && !sec.classList.contains('folded') &&
    (sec.querySelector('.ln.nowb') ?? (sec.querySelector('.ls.nowend') && sec.querySelector('.ls > .ln:last-child')));
  if (mark) scrollTo(0, Math.max(0, mark.getBoundingClientRect().top + scrollY - innerHeight / 3));
  else scrollToDate(t);
}

export function render() {
  const t = today();
  const list = ui.screen === 'plan' ? planSections(t) : ui.screen === 'tpl' ? tplSections() : archiveSections();
  const fresh = ui.screen === 'plan' && !state.days.size && !state.lines.size;
  const want = fresh ? [welcome()] : list.map(paintSection);
  if (ui.screen === 'plan' && !fresh && want.length === 1) want.unshift(extra('empty', 'p', 'No days planned. Open the menu and use Fill days to add the coming week from your templates.'));
  if (ui.screen === 'arch' && !want.length) want.push(extra('empty', 'p', ui.query ? 'No archived day has that text.' : 'Archived days show up here.'));
  if (ui.screen === 'tpl') want.push(extras.newTpl ??= h('button', { className: 'act add-tpl', 'data-act': 'new-tpl' }, 'New template'));
  const keep = new Set(want);
  for (const [k, el] of sections) if (!keep.has(el)) sections.delete(k);
  place(main, want);
}

// First run: nothing here yet.
const welcome = () => extras.welcome ??= h('div', { className: 'welcome' },
  h('h2', {}, 'Bring your planner over'),
  h('p', {}, 'Paste your planner note from Notes to get your days and Later list, and your weekly template to use with Fill days. Or sign in to sync from the menu, if your planner is already on another device.'),
  h('button', { className: 'primary', 'data-act': 'import' }, 'Import planner note'),
  h('button', { className: 'act', 'data-act': 'import-tpl' }, 'Import weekly template'));

function extra(key, tag, text) {
  const el = extras[key] ??= h(tag, { className: key });
  if (el.textContent !== text) el.textContent = text;
  return el;
}

// Puts `want` into box in order, moving as few nodes as possible, and drops anything else.
function place(box, want) {
  let ref = box.firstChild;
  for (const el of want) el === ref ? (ref = ref.nextSibling) : box.insertBefore(el, ref);
  while (ref) { const next = ref.nextSibling; ref.remove(); ref = next; }
}

// ---- What each screen shows ----

// Visible lines of a container: skips lines inside folded parents and, if chosen, done lines.
function outline(list) {
  const out = [];
  let hideBelow = -1;
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    if (hideBelow >= 0) { if (l.ind > hideBelow) continue; hideBelow = -1; }
    let kids = 0;
    while (i + kids + 1 < list.length && list[i + kids + 1].ind > l.ind) kids++;
    if (l.fold && kids) hideBelow = l.ind;
    if (!(state.prefs.hideDone && l.done)) out.push({ l, kids });
  }
  return out;
}

const countOf = c => linesOf(c).filter(l => l.text.trim()).length;

// The "now" line sits just above the next timed line. Times that jump back by 6+ hours
// (like "< 01:00 Sleep" after dinner) count as after midnight.
function nowMark(entries) {
  const now = nowMinutes();
  let prev = null;
  for (const { l } of entries) {
    let m = clock(l.text);
    if (m == null) continue;
    if (prev != null && m < prev - 360) m += 1440;
    prev = m;
    if (m > now) return { at: l.id, label: clockLabel() };
  }
  return { at: null, label: clockLabel() };
}

// Later items that start with a date also show on that day; unfinished past ones show on today.
function datedLater(list, t) {
  const byDate = new Map();
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    if (l.ind) continue;
    const date = leadDate(l.text, t);
    if (!date) continue;
    const key = date < t && !l.done ? t : date;
    let j = i + 1;
    while (j < list.length && list[j].ind > 0) j++;
    byDate.set(key, [...(byDate.get(key) ?? []), ...outline(list.slice(i, j))]);
  }
  return byDate;
}

function planSections(t) {
  const later = linesOf(LATER), dated = datedLater(later, t), tomorrow = addDays(t, 1);
  return [
    ...activeDays().map(d => {
      const entries = outline(linesOf(d.id)), past = d.date < t;
      return {
        key: d.id, kind: 'day', title: headTitle(d.date), fold: d.fold, entries, count: countOf(d.id),
        chip: d.date === t ? 'Today' : d.date === tomorrow ? 'Tomorrow' : past ? 'Past' : '',
        pill: past && ['Archive', 'archive'], now: d.date === t && nowMark(entries), from: dated.get(d.date),
      };
    }),
    { key: LATER, kind: 'later', title: 'Later', fold: state.prefs.laterFold, entries: outline(later), count: countOf(LATER) },
  ];
}

const tplSections = () => templates().map(tp =>
  ({ key: tp.id, kind: 'tpl', title: tp.name, fold: tp.fold, entries: outline(linesOf(tp.id)), count: countOf(tp.id) }));

function archiveSections() {
  const q = ui.query.trim().toLowerCase();
  return archivedDays().flatMap(d => {
    const lines = linesOf(d.id);
    if (q && !lines.some(l => l.text.toLowerCase().includes(q))) return [];
    return [{ key: d.id, kind: 'arch', title: headTitle(d.date), fold: !q && d.fold, ro: true, pill: ['Restore', 'restore'], entries: outline(lines), count: countOf(d.id) }];
  });
}

// ---- Sections ----

function makeSection() {
  const el = h('section', { className: 'day' },
    h('div', { className: 'dh' },
      h('button', { className: 'dt', 'data-act': 'fold-sec' }, icon('chev'), h('h2'), h('span', { className: 'chip' }), h('span', { className: 'cnt' })),
      h('button', { className: 'pill' }),
      h('button', { className: 'ib sm', 'data-act': 'sec-menu', 'aria-label': 'Options' }, icon('more'))),
    h('div', { className: 'ls' }),
    h('div', { className: 'fl' }, h('div', { className: 'fl-h' }, 'From Later'), h('div', { className: 'mls' })),
    h('div', { className: 'end', 'data-act': 'append' }));
  el.rows = new Map();
  el.mirrors = new Map();
  return el;
}

const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };

function paintSection(s) {
  let el = sections.get(s.key);
  if (!el) sections.set(s.key, el = makeSection());
  el.dataset.c = s.key;
  el.dataset.kind = s.kind;
  const cl = el.classList;
  cl.toggle('folded', !!s.fold);
  cl.toggle('ro', !!s.ro);
  cl.toggle('today', s.chip === 'Today');
  cl.toggle('empty', !s.entries.length);
  const [head, ls, fl, end] = el.children, [dt, pill] = head.children, [, title, chip, cnt] = dt.children;
  setText(title, s.title);
  setText(chip, s.chip ?? '');
  chip.classList.toggle('past', s.chip === 'Past');
  setText(cnt, s.fold && s.count ? String(s.count) : '');
  setText(pill, s.pill ? s.pill[0] : '');
  pill.dataset.act = s.pill ? s.pill[1] : '';
  end.hidden = !!s.ro;
  fl.hidden = !s.from?.length;
  if (s.fold) return el;
  syncRows(ls, el.rows, s.entries, s.now);
  if (s.from?.length) syncRows(fl.lastChild, el.mirrors, s.from, null, true);
  const endNow = s.now && !s.now.at;
  ls.classList.toggle('nowend', !!endNow);
  if (endNow) ls.dataset.now = s.now.label; else delete ls.dataset.now;
  return el;
}

// ---- Rows ----

function syncRows(box, cache, entries, now, mirror) {
  const want = entries.map(e => {
    let row = cache.get(e.l.id);
    if (!row) cache.set(e.l.id, row = h('div', { className: 'ln' }, h('div', { className: 'tx' })));
    paintRow(row, e, now, mirror);
    return row;
  });
  if (cache.size > want.length) { const keep = new Set(want); for (const [id, row] of cache) if (!keep.has(row)) cache.delete(id); }
  place(box, want);
}

function paintRow(row, { l, kids }, now, mirror) {
  const k = kind(l.text), cl = row.classList, isNow = now?.at === l.id;
  row.dataset.id = l.id;
  cl.toggle('mir', !!mirror);
  cl.toggle('blank', k === 'blank');
  cl.toggle('head', k === 'head');
  cl.toggle('done', l.done);
  cl.toggle('bul', l.ind > 0 && k !== 'blank' && !NUMBERED.test(l.text));
  cl.toggle('par', kids > 0);
  cl.toggle('folded', kids > 0 && l.fold);
  cl.toggle('nowb', isNow);
  if (isNow) row.dataset.now = now.label; else if (row.dataset.now) delete row.dataset.now;
  if (row.ind !== l.ind) { row.ind = l.ind; row.style.setProperty('--i', l.ind); }
  // The line being edited shows its raw text; everything else is redrawn only when the text changed.
  if (!cl.contains('ed') && row.text !== l.text) { row.text = l.text; paintText(row.firstChild, l.text); }
  const foldKey = kids ? `${kids}${l.fold ? '+' : '-'}` : '';
  if (row.foldKey !== foldKey) {
    row.foldKey = foldKey;
    row.querySelector('.fd')?.remove();
    if (kids) row.append(h('button', { className: 'fd', 'data-act': 'fold', 'aria-label': l.fold ? 'Expand' : 'Collapse' },
      l.fold ? h('span', {}, String(kids)) : null, icon('chev')));
  }
}

// Web links open in a new tab; app links (a note, a shortcut) open their app.
const link = (href, label) => href ? h('a', { href, target: /^https?:/i.test(href) ? '_blank' : null, rel: 'noopener' }, label) : label;

function paintText(tx, text) {
  tx.replaceChildren(...segments(text).map(([k, s, label, href]) =>
    k === 'l' ? link(href, label) : k === 'u' ? link(s, s) : k ? h('span', { className: 's-' + k }, s) : s));
}
