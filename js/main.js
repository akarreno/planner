// Entry point for the hosted app.
import { start } from './app.js';
import { firebaseConfig } from './config.js';

start({ config: firebaseConfig });

// Offline support. Registration fails harmlessly where service workers aren't allowed.
navigator.serviceWorker?.register('sw.js').catch(() => {});
