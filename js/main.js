// Entry point for the hosted app.
import { start } from './app.js';
import { firebaseConfig } from './config.js';
import { save } from './store.js';
import { toast } from './ui.js';

start({ config: firebaseConfig });

// Offline support and updates (see sw.js). When a new version has downloaded: within a few seconds of
// the app coming on screen, and not mid-edit, reload into it at once; otherwise offer a Reload button.
const sw = navigator.serviceWorker;
if (sw) {
  const hadWorker = !!sw.controller;
  let shownAt = Date.now();
  const reload = () => { save(); location.reload(); };
  const updated = () => {
    if (Date.now() - shownAt < 10_000 && !document.body.classList.contains('editing')) reload();
    else toast('A new version of the app is ready.', reload, 'Reload', 15_000);
  };
  sw.register('sw.js').catch(() => {});   // fails harmlessly where service workers aren't allowed
  sw.addEventListener('message', e => { if (e.data?.type === 'updated') updated(); });
  sw.addEventListener('controllerchange', () => { if (hadWorker) updated(); });   // a new sw.js took over
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    shownAt = Date.now();
    sw.controller?.postMessage('check');
    sw.getRegistration().then(r => r?.update()).catch(() => {});
  });
}
