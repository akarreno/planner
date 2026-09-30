// Daily backups: once a day, a signed-in device saves a compressed copy of the whole planner (days, Later,
// templates, archive) to the account, and the last 30 days are kept. Restoring swaps the planner for a
// saved copy as one undoable step, and sync carries it to the other devices.
//
// api: { list() → dates, load(date) → bytes, save(date, bytes, keep, drop) } (see firebase.js)

const KEEP = 30;
const KEY = 'planner.backup';   // "uid date" of this device's last backup

export async function pack({ days, lines, tpls }) {
  const json = JSON.stringify({ v: 1, days: [...days.values()], lines: [...lines.values()], tpls: [...tpls.values()] });
  const gz = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(gz).arrayBuffer());
}

export async function unpack(bytes) {
  const json = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(json).text());
}

const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = v => { try { localStorage.setItem(KEY, v); } catch { /* storage blocked: `done` still covers this session */ } };
let running = false, failedAt = 0, done = null;

// Saves today's copy, unless this device already did for this account today. After a failure it
// waits 10 minutes before trying again.
export async function backupIfDue(state, api, uid, date) {
  const mark = `${uid} ${date}`;
  if (running || done === mark || read() === mark || Date.now() - failedAt < 600_000) return;
  running = true;
  try {
    const dates = await api.list();
    const keep = [...new Set([...dates, date])].sort().slice(-KEEP);
    await api.save(date, await pack(state), keep, dates.filter(d => !keep.includes(d)));
    done = mark;
    write(mark);
  } catch (e) {
    failedAt = Date.now();
    throw e;
  } finally {
    running = false;
  }
}
