// Sheets and undoable actions: menus, Fill days, Move to, import, copy, and the sync account.
import {
  state, LATER, tx, update, add, remove, uid, setPref, linesOf, block, moveBlock, removeLines, removeDay,
  fillDays, replacePlanner, replaceTemplates, activeDays, archivedDays, templates, dayOn, ensureDay,
} from './store.js';
import { dayTitle, shortDay, today, addDays, weekday, importNote, importTemplates, exportText, safeUrl } from './parse.js';
import { go, scrollToDate } from './view.js';
import { h, sheet, choose, closeSheet, toast, pasteWithLinks } from './ui.js';

const undoable = (message, fn) => toast(message, tx(fn));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---- Lines ----

export function toggleDone(line) {
  const undo = tx(() => update(state.lines, line.id, { done: !line.done }));
  if (state.prefs.hideDone && !line.done) toast('Marked done', undo);
}

export const removeWithUndo = blk => undoable(blk.length > 1 ? `Deleted ${plural(blk.length, 'line')}` : 'Deleted line', () => removeLines(blk));

export function moveSheet(line) {
  const t = today(), blk = block(line);
  const to = (target, label) => undoable(`Moved to ${label}`, () => {
    const c = target === LATER ? LATER : ensureDay(target).id;
    moveBlock(blk, c, linesOf(c).length, 0);
  });
  const dates = [...new Set([t, addDays(t, 1), ...activeDays().map(d => d.date).filter(d => d >= t)])].sort();
  const here = state.days.get(line.c)?.date;
  const other = h('input', { type: 'date', id: 'move-date', 'aria-label': 'Another date', onchange: e => { if (e.target.value) { closeSheet(); to(e.target.value, dayTitle(e.target.value)); } } });
  choose('Move to', [
    ...dates.filter(d => d !== here).map(d => ({ label: d === t ? 'Today' : d === addDays(t, 1) ? 'Tomorrow' : shortDay(d), hint: d === t || d === addDays(t, 1) ? shortDay(d) : '', run: () => to(d, dayTitle(d)) })),
    line.c !== LATER && { label: 'Later', run: () => to(LATER, 'Later') },
  ], h('label', { className: 'field' }, 'Another date', other));
}

// save(label, url) gets url null for "Remove link".
export function linkSheet({ label, url }, save) {
  const text = h('input', { id: 'link-text', value: label, placeholder: 'Text to show', autocomplete: 'off' });
  const addr = h('input', { id: 'link-url', value: url, inputMode: 'url', placeholder: 'https://… or an app link', autocapitalize: 'off', autocomplete: 'off' });
  const msg = h('p', { className: 'note err', hidden: true }, 'That isn’t an address. Paste a web address like https://… or an app link.');
  const submit = e => {
    e.preventDefault();
    const u = safeUrl(addr.value);
    if (!u) { msg.hidden = false; return; }
    closeSheet();
    save(text.value.trim(), u);
  };
  sheet(url ? 'Edit link' : 'Add link', h('form', { className: 'stack', onsubmit: submit },
    h('label', { className: 'field' }, 'Text', text), h('label', { className: 'field' }, 'Address', addr), msg,
    h('button', { className: 'primary', type: 'submit' }, 'Save'),
    url && h('button', { className: 'act danger', type: 'button', onclick: () => { closeSheet(); save(text.value.trim() || url, null); } }, 'Remove link')));
  (label ? addr : text).focus();
}

// ---- Days ----

export const archive = day => undoable(`Archived ${dayTitle(day.date)}`, () => update(state.days, day.id, { arch: true, fold: true }));

export function restore(day) {
  undoable(`Restored ${dayTitle(day.date)}`, () => {
    const existing = dayOn(day.date);
    if (!existing) return update(state.days, day.id, { arch: false, fold: false });
    const lines = linesOf(day.id);   // the date is planned again: merge into it
    if (lines.length) moveBlock(lines, existing.id, linesOf(existing.id).length);
    remove(state.days, day.id);
  });
}

export function dayMenu(day) {
  choose(dayTitle(day.date), [
    day.arch ? { label: 'Restore to planner', run: () => restore(day) } : { label: 'Archive day', run: () => archive(day) },
    { label: 'Copy as text', run: () => copy(exportText([{ title: dayTitle(day.date), lines: linesOf(day.id) }])) },
    { label: 'Delete day', danger: true, run: () => undoable(`Deleted ${dayTitle(day.date)}`, () => removeDay(day)) },
  ]);
}

export const laterMenu = () => choose('Later', [
  { label: 'Copy as text', run: () => copy(exportText([{ title: 'Later:', lines: linesOf(LATER) }])) },
]);

export function fillSheet() {
  const t = today(), days = activeDays(), tpls = templates();
  const start = h('input', { type: 'date', id: 'fill-start', value: days.length ? addDays(days.at(-1).date, 1) : t });
  const count = h('select', { id: 'fill-count' }, Array.from({ length: 14 }, (_, i) => h('option', { value: i + 1 }, plural(i + 1, 'day'))));
  count.value = '7';
  const rows = h('div', { className: 'fill-rows' });
  const addBtn = h('button', { className: 'primary' });
  const draw = () => {
    const from = start.value || t;
    rows.replaceChildren(...Array.from({ length: +count.value }, (_, k) => {
      const date = addDays(from, k), label = h('span', {}, shortDay(date));
      if (dayOn(date)) return h('div', { className: 'fill-row' }, label, h('span', { className: 'hint' }, 'Already planned'));
      const pick = h('select', { id: `fill-${date}`, 'data-date': date, 'aria-label': `Template for ${dayTitle(date)}` },
        tpls.map(tp => h('option', { value: tp.id }, tp.name)), h('option', { value: '' }, 'Blank day'));
      pick.value = tpls.find(tp => tp.name.toLowerCase() === weekday(date).toLowerCase())?.id ?? '';
      return h('div', { className: 'fill-row' }, label, pick);
    }));
    const n = rows.querySelectorAll('select').length;
    addBtn.textContent = n ? `Add ${plural(n, 'day')}` : 'Nothing to add';
    addBtn.disabled = !n;
  };
  start.onchange = count.onchange = draw;
  addBtn.onclick = () => {
    const plan = [...rows.querySelectorAll('select')].map(s => ({ date: s.dataset.date, tpl: s.value || null }));
    closeSheet();
    undoable(`Added ${plural(plan.length, 'day')}`, () => fillDays(plan));
    requestAnimationFrame(() => scrollToDate(plan[0].date));
  };
  draw();
  sheet('Fill days', h('div', { className: 'pair' }, h('label', { className: 'field' }, 'Start', start), h('label', { className: 'field' }, 'Days', count)), rows, addBtn);
}

// ---- Templates ----

function nameSheet(title, value, save) {
  const input = h('input', { id: 'tpl-name', value, placeholder: 'Template name', autocomplete: 'off' });
  const ok = () => { const name = input.value.trim(); if (name) { closeSheet(); save(name); } };
  input.onkeydown = e => { if (e.key === 'Enter') ok(); };
  sheet(title, h('label', { className: 'field' }, 'Name', input), h('button', { className: 'primary', onclick: ok }, 'Save'));
  input.focus();
}

export const newTemplate = () => nameSheet('New template', '', name =>
  undoable(`Added ${name}`, () => add(state.tpls, { id: uid(), name, pos: (templates().at(-1)?.pos ?? 0) + 1, fold: false })));

export const tplMenu = tp => choose(tp.name, [
  { label: 'Rename', run: () => nameSheet('Rename template', tp.name, name => update(state.tpls, tp.id, { name })) },
  { label: 'Copy as text', run: () => copy(exportText([{ title: tp.name, lines: linesOf(tp.id) }])) },
  { label: 'Delete template', danger: true, run: () => undoable(`Deleted ${tp.name}`, () => { removeLines(linesOf(tp.id)); remove(state.tpls, tp.id); }) },
]);

// ---- Sync account ----

// on: sync is set up here; fb: the Firebase connection, once loaded; user: { uid, email } or null;
// status: what sync last reported ({ pending, sending, first, offline, error }).
let account = { on: false, fb: null, user: null, status: null };

export function setAccount(next) {
  account = { status: null, ...next };
  const s = account.status, dot = document.getElementById('dot');
  dot.hidden = !s || !(s.error || (s.offline && s.pending));
  dot.classList.toggle('bad', !!s?.error);
}

function syncHint() {
  const { fb, user, status: s } = account;
  if (!fb) return 'Connecting…';
  if (!user) return 'Sign in';
  if (!s || s.first) return 'Connecting…';
  if (s.error) return 'Problem';
  if (s.pending) return s.offline ? `Offline, ${plural(s.pending, 'change')} waiting` : 'Sending…';
  return s.offline ? 'Offline' : 'Up to date';
}

function signInSheet() {
  const email = h('input', { id: 'sign-email', type: 'email', autocomplete: 'username', placeholder: 'Email', autocapitalize: 'off' });
  const password = h('input', { id: 'sign-password', type: 'password', autocomplete: 'current-password', placeholder: 'Password' });
  const msg = h('p', { className: 'note', hidden: true });
  const say = (text, bad) => { msg.textContent = text; msg.classList.toggle('err', bad); msg.hidden = false; };
  const submit = h('button', { className: 'primary', type: 'submit' }, 'Sign in');
  const form = h('form', { className: 'stack', onsubmit: async e => {
    e.preventDefault();
    submit.disabled = true;
    msg.hidden = true;
    try {
      await account.fb.signIn(email.value.trim(), password.value);
      closeSheet();
      toast('Signed in. Syncing…');
    } catch (err) {
      say(/invalid|wrong|not-found|credential/.test(err.code ?? '') ? 'That email and password don’t match an account.'
        : /network/.test(err.code ?? '') ? 'No connection. Try again when you’re online.' : err.message, true);
      submit.disabled = false;
    }
  } }, h('label', { className: 'field' }, 'Email', email), h('label', { className: 'field' }, 'Password', password), msg, submit,
  // New accounts start without a password the person knows: this email lets them choose one.
  h('button', { className: 'act', type: 'button', onclick: async () => {
    if (!email.value.trim()) return say('Type your email above first.', true);
    try {
      await account.fb.resetPassword(email.value.trim());
      say('If that email has an account, a link to set your password is on its way. Check spam too.', false);
    } catch (err) {
      say(/network/.test(err.code ?? '') ? 'No connection. Try again when you’re online.' : /invalid-email/.test(err.code ?? '') ? 'That email address isn’t valid.' : err.message, true);
    }
  } }, 'Set or reset password'));
  sheet('Sign in to sync', h('p', { className: 'note' }, 'Sign in on the device that has your planner first; other devices then load it.'), form);
  email.focus();
}

function accountSheet() {
  const { user, status: s } = account;
  choose('Sync', [
    { label: 'Sign out', danger: true, run: () => account.fb.signOut().then(() => toast('Signed out. The planner stays on this device.')) },
  ], h('p', { className: 'note' }, `Signed in as ${user.email}. ${syncHint()}.`), s?.error ? h('p', { className: 'note err' }, s.error) : null);
}

// ---- App ----

export const mainMenu = () => choose('Planner', [
  { label: 'Fill days…', run: fillSheet },
  { label: 'Templates', hint: String(templates().length), run: () => go('tpl') },
  { label: 'Archive', hint: String(archivedDays().length), run: () => go('arch') },
  { label: 'Show done lines', checked: !state.prefs.hideDone, run: () => setPref('hideDone', !state.prefs.hideDone) },
  account.on && { label: 'Sync', hint: syncHint(), run: () => (!account.fb ? toast('Still connecting. Try again in a moment.') : account.user ? accountSheet() : signInSheet()) },
  { label: 'Import planner note…', run: importSheet },
  { label: 'Import weekly template…', run: importTemplatesSheet },
  { label: 'Copy everything as text', run: () => copy(allText()) },
], account.on ? null : h('p', { className: 'note' }, 'Saved on this device only. Sync isn’t set up here.'));

const allText = () => exportText([
  ...activeDays().map(d => ({ title: dayTitle(d.date), lines: linesOf(d.id) })),
  { title: 'Later:', lines: linesOf(LATER) },
]);

export function importSheet() {
  const text = h('textarea', { id: 'import-text', placeholder: 'Paste the whole note here', onpaste: pasteWithLinks });
  const replace = h('button', { className: 'primary', disabled: true }, 'Replace planner');
  const parse = () => importNote(text.value, { base: today() });
  text.oninput = () => {
    const { days, later } = parse();
    replace.disabled = !days.length && !later.length;
    replace.textContent = `Replace planner with ${plural(days.length, 'day')}${later.length ? ' and Later' : ''}`;
  };
  replace.onclick = () => { const parsed = parse(); closeSheet(); undoable('Planner replaced', () => replacePlanner(parsed)); };
  sheet('Import planner note',
    h('p', { className: 'note' }, 'A line like “Thursday October 1” starts a day. Lines before the first day go to today, and everything after “Later:” goes to Later. Archived days are kept.'),
    text, replace);
}

export function importTemplatesSheet() {
  const text = h('textarea', { id: 'import-tpl-text', placeholder: 'Paste the weekly template note here', onpaste: pasteWithLinks });
  const replace = h('button', { className: 'primary', disabled: true }, 'Replace templates');
  text.oninput = () => {
    const n = importTemplates(text.value).length;
    replace.disabled = !n;
    replace.textContent = n ? `Replace templates with ${plural(n, 'template')}` : 'Replace templates';
  };
  replace.onclick = () => { const list = importTemplates(text.value); closeSheet(); undoable(`Imported ${plural(list.length, 'template')}`, () => replaceTemplates(list)); };
  sheet('Import weekly template',
    h('p', { className: 'note' }, 'A line with just a weekday name, like “Monday”, starts a template. Fill days picks the template with the same name as each day.'),
    text, replace);
}

// Clipboard writes must start inside the tap that asked for them.
function copy(text) {
  const fallback = () => sheet('Copy text', h('textarea', { id: 'copy-text', readOnly: true, value: text, onfocus: e => e.target.select() }));
  if (!navigator.clipboard) return fallback();
  navigator.clipboard.writeText(text).then(() => toast('Copied'), fallback);
}
