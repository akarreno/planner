// Starts the app: loads saved data, draws, routes taps, and connects sync when it's set up.
import * as store from './store.js';
import { startSync } from './sync.js';
import { backupIfDue } from './backup.js';
import { today } from './parse.js';
import { main, ui, archFold, render, go, search, setFinding, scrollToNow, scrollToDate } from './view.js';
import { editAt, appendLine, undoLast, redoLast } from './edit.js';
import { consumeClick } from './gestures.js';
import { tap } from './select.js';
import { mainMenu, dayMenu, laterMenu, tplMenu, archive, restore, newTemplate, importSheet, importTemplatesSheet, setAccount } from './menus.js';
import { fillIcons } from './ui.js';

const { state, update, setPref } = store;
const $ = id => document.getElementById(id);

// config: Firebase web app settings, or null to keep sync off. The planner starts empty until
// the person imports their own note or signs in.
export function start({ config, emulator } = {}) {
  store.load();
  fillIcons(document);
  store.onChange(render);
  render();
  scrollToNow();
  if (config) { setAccount({ on: true }); connectAccount(config, emulator); }
}

async function connectAccount(config, emulator) {
  const { connect } = await import('./firebase.js');   // the Firebase bundle loads after the planner is on screen
  const fb = connect(config, emulator);
  let stop = null;
  setAccount({ on: true, fb, user: null });
  fb.onUser(user => {
    stop?.();
    stop = null;
    setAccount({ on: true, fb, user });
    if (!user) return;
    const server = fb.backend(user.uid);
    let backupError = null;
    // Once this device has the account's planner (after its first sync), it saves the day's backup.
    stop = startSync(store, server, user.uid, status => {
      setAccount({ on: true, fb, user, status, backupError });
      if (status.first) return;
      backupIfDue(state, server.backups, user.uid, today()).then(
        () => { backupError = null; },
        e => { backupError = e; setAccount({ on: true, fb, user, status, backupError }); });
    });
  });
}

$('menu').onclick = mainMenu;
$('fold').onclick = foldAll;
$('back').onclick = () => go('plan');
$('find').onclick = () => setFinding(true);
$('q-done').onclick = () => { setFinding(false); scrollToNow(); };
$('q').oninput = e => { search(e.target.value); if (ui.finding) scrollTo(0, 0); };
$('q').onkeydown = e => { if (e.key === 'Escape' && ui.finding) $('q-done').click(); };

// A search result: close the search and show the line in its place, opening whatever hides it.
// Archived lines open the Archive with the same search.
function jumpTo(id) {
  const l = state.lines.get(id), day = state.days.get(l.c);
  if (day?.arch) return go('arch', ui.query);
  setFinding(false);
  if (day?.fold) update(state.days, day.id, { fold: false });
  if (l.c === store.LATER && state.prefs.laterFold) setPref('laterFold', false);
  store.reveal(id);
  if (l.done && state.prefs.hideDone) setPref('hideDone', false);
  render();
  const row = main.querySelector(`.ls > .ln[data-id="${id}"]`);
  if (!row) return;
  row.scrollIntoView({ block: 'center' });
  row.classList.remove('flash');
  requestAnimationFrame(() => row.classList.add('flash'));
  setTimeout(() => row.classList.remove('flash'), 1600);
}

// Collapses every day (and Later) on the screen, or expands them all, as one undoable step.
function foldAll() {
  const fold = $('fold').dataset.mode === 'collapse';
  const [map, recs] = ui.screen === 'tpl' ? [state.tpls, store.templates()] : [state.days, ui.screen === 'plan' ? store.activeDays() : store.archivedDays()];
  store.tx(() => { for (const r of recs) if (r.fold !== fold) update(map, r.id, { fold }); });
  if (ui.screen === 'arch') {   // the Archive's sections of done lines from planner days fold here only
    for (const sec of main.querySelectorAll('section.day[data-kind="done"]')) archFold[fold ? 'add' : 'delete'](sec.dataset.c);
    render();
  }
  if (ui.screen !== 'plan') return;
  setPref('laterFold', fold);
  requestAnimationFrame(() => (fold ? scrollToDate(today()) : scrollToNow()));
}

function toggleSection(kind, c) {
  if (kind === 'later') setPref('laterFold', !state.prefs.laterFold);
  else if (kind === 'tpl') update(state.tpls, c, { fold: !state.tpls.get(c).fold });
  else if (kind === 'done') { archFold[archFold.has(c) ? 'delete' : 'add'](c); render(); }
  else update(state.days, c, { fold: !state.days.get(c).fold });
}

function openMenu(kind, c) {
  if (kind === 'later') laterMenu();
  else if (kind === 'tpl') tplMenu(state.tpls.get(c));
  else dayMenu(state.days.get(c));
}

main.addEventListener('click', e => {
  if (consumeClick()) return;
  const sec = e.target.closest('section.day'), c = sec?.dataset.c, kind = sec?.dataset.kind;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'new-tpl') return newTemplate();
  if (act === 'import') return importSheet();
  if (act === 'import-tpl') return importTemplatesSheet();
  if (!sec) return;
  if (act === 'fold') {
    const l = state.lines.get(e.target.closest('.ln').dataset.id);
    return update(state.lines, l.id, { fold: !l.fold });
  }
  if (act === 'fold-sec') return toggleSection(kind, c);
  if (act === 'sec-menu') return openMenu(kind, c);
  if (act === 'archive') return archive(state.days.get(c));
  if (act === 'restore') return restore(state.days.get(c));
  if (ui.finding && ui.query.trim()) { const row = e.target.closest('.ln'); return row && jumpTo(row.dataset.id); }
  const row = e.target.closest('.ln');
  if (ui.sel) {   // select mode: a tap picks or unpicks a line, even on a link
    e.preventDefault();
    return row && !sec.classList.contains('ro') && tap(row, e);
  }
  if (sec.classList.contains('ro') || e.target.closest('a')) return;
  if (act === 'append') return appendLine(c);
  if (!row || row.classList.contains('ed')) return;
  if (e.metaKey || e.shiftKey) tap(row, e);   // ⌘-click or Shift-click starts selecting
  else editAt(row, e.clientX, e.clientY);
});

// ⌘F opens the planner's search; ⌘Z and ⇧⌘Z outside a line undo and redo (inside one, edit.js handles them).
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && ui.screen === 'plan') { e.preventDefault(); return setFinding(true); }
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
  if (e.target.closest?.('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
  e.preventDefault();
  if (e.shiftKey) redoLast(); else undoLast();
});

// Keep the "now" line and the Today label current. Save before the app goes to the background,
// and after a long break come back to the current time.
let hiddenAt = 0;
setInterval(render, 30_000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); store.save(); return; }
  render();
  if (Date.now() - hiddenAt > 30 * 60_000 && !document.body.classList.contains('editing')) scrollToNow();
});
