// Starts the app: loads saved data, draws, routes taps, and connects sync when it's set up.
import * as store from './store.js';
import { startSync } from './sync.js';
import { backupIfDue } from './backup.js';
import { today } from './parse.js';
import { main, ui, render, go, scrollToNow, scrollToDate } from './view.js';
import { editAt, appendLine, undoLast } from './edit.js';
import { consumeClick } from './gestures.js';
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
$('q').oninput = e => { ui.query = e.target.value; render(); };

// Collapses every day (and Later) on the screen, or expands them all, as one undoable step.
function foldAll() {
  const fold = $('fold').dataset.mode === 'collapse';
  const [map, recs] = ui.screen === 'tpl' ? [state.tpls, store.templates()] : [state.days, ui.screen === 'plan' ? store.activeDays() : store.archivedDays()];
  store.tx(() => { for (const r of recs) if (r.fold !== fold) update(map, r.id, { fold }); });
  if (ui.screen !== 'plan') return;
  setPref('laterFold', fold);
  requestAnimationFrame(() => (fold ? scrollToDate(today()) : scrollToNow()));
}

function toggleSection(kind, c) {
  if (kind === 'later') setPref('laterFold', !state.prefs.laterFold);
  else if (kind === 'tpl') update(state.tpls, c, { fold: !state.tpls.get(c).fold });
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
  if (sec.classList.contains('ro') || e.target.closest('a')) return;
  if (act === 'append') return appendLine(c);
  const row = e.target.closest('.ln');
  if (row && !row.classList.contains('ed')) editAt(row, e.clientX, e.clientY);
});

// ⌘Z outside a line (inside one, edit.js handles it).
document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return;
  if (e.target.closest?.('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
  e.preventDefault();
  undoLast();
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
