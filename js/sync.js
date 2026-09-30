// Two-way sync between this device's store and a server (Firestore, through firebase.js).
// Changes made here are sent in batches a moment after typing pauses. Changes from other devices arrive
// live and are applied, unless this device has its own unsent change to the same record: the later write wins.
//
// backend: { listen(sinceMs | null, onChanges(changes, fromCache), onError) → stop, commit(ops) → Promise }
// changes and ops: [{ id, kind, rec }] with rec null for a deleted record; changes also carry u, the server time.

const BATCH = 400;          // records per commit (Firestore allows 500 writes per batch)
const PAUSE = 700;          // send this long after the last change...
const MAX_WAIT = 3000;      // ...but no later than this after the first unsent one
const MARGIN = 60_000;      // on start, re-read the last minute too, in case a change landed as the app closed

export function startSync(store, backend, uid, onStatus = () => {}) {
  const sync = store.state.sync;
  if (sync.uid !== uid) Object.assign(sync, { uid, since: null });   // another account on this device: start over
  let first = sync.since == null, sending = false, stopped = false, timer = 0, oldest = 0, retry = 0, error = null, cached = true;

  const report = () => onStatus({ pending: sync.dirty.size, sending, first, offline: cached, error });

  const stopListening = backend.listen(first ? null : sync.since - MARGIN, (changes, fromCache) => {
    cached = fromCache;
    if (first) {
      if (fromCache) return report();   // wait for the server's answer before deciding which side has the data
      first = false;
      if (changes.some(c => c.rec)) store.replaceAll(changes); else store.markAllDirty();
    } else if (changes.length) {
      store.applyRemote(changes.filter(c => !sync.dirty.has(c.id)));
    }
    for (const c of changes) if (c.u > sync.since) sync.since = c.u;
    sync.since ??= 0;
    error = null;
    store.save();
    report();
  }, e => { error = e.message; report(); });

  const stopWatching = store.onDirty(schedule);

  function schedule() {
    if (first || stopped || !sync.dirty.size) return report();
    const now = Date.now();
    oldest ||= now;
    clearTimeout(timer);
    timer = setTimeout(flush, Math.max(0, Math.min(PAUSE, oldest + MAX_WAIT - now)));
    report();
  }

  async function flush() {
    oldest = 0;
    if (sending || stopped || !sync.dirty.size) return;
    sending = true;
    report();
    const ops = [...sync.dirty].slice(0, BATCH).map(([id, kind]) => ({ id, kind, rec: store.KINDS[kind].get(id) ?? null }));
    try {
      await backend.commit(ops);
      // Records changed again while this batch was in flight stay marked, and go in the next one.
      for (const op of ops) if ((store.KINDS[op.kind].get(op.id) ?? null) === op.rec) sync.dirty.delete(op.id);
      retry = 0;
      error = null;
      store.save();
    } catch (e) {
      error = e.message;
      clearTimeout(timer);
      timer = setTimeout(flush, Math.min(60_000, 2000 * 2 ** retry++));
    } finally {
      sending = false;
    }
    if (!error) schedule(); else report();
  }

  schedule();   // anything left unsent last time
  return () => { stopped = true; clearTimeout(timer); stopListening(); stopWatching(); };
}
