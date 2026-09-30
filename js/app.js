// Starts the app: loads saved data, draws, routes taps, and connects sync when it's set up.
import * as store from './store.js';
import { startSync } from './sync.js';
import { main, ui, render, go, scrollToNow } from './view.js';
import { editAt, appendLine } from './edit.js';
import { consumeClick } from './gestures.js';
import { mainMenu, dayMenu, laterMenu, tplMenu, archive, restore, newTemplate, importSheet, importTemplatesSheet, setAccount } from './menus.js';
import { fillIcons } from './ui.js';

const { state, update, setPref } = store;
const $ = id => document.getElementById(id);

// seed: first-run content ({ note, template, base, first }); config: Firebase web app settings, or null.
export function start({ seed, config, emulator } = {}) {
  if (!store.load() && seed) store.seed(seed);
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
    if (user) stop = startSync(store, fb.backend(user.uid), user.uid, status => setAccount({ on: true, fb, user, status }));
  });
}

$('menu').onclick = mainMenu;
$('back').onclick = () => go('plan');
$('q').oninput = e => { ui.query = e.target.value; render(); };

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

// Keep the "now" line and the Today label current. Save before the app goes to the background,
// and after a long break come back to the current time.
let hiddenAt = 0;
setInterval(render, 30_000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); store.save(); return; }
  render();
  if (Date.now() - hiddenAt > 30 * 60_000 && !document.body.classList.contains('editing')) scrollToNow();
});
