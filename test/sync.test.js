import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSync } from '../js/sync.js';
import { importNote } from '../js/parse.js';
import { NOTE, BASE } from './fixture.js';

// Two separate store instances play two devices.
const phone = await import('../js/store.js?phone');
const mac = await import('../js/store.js?mac');

// A server like Firestore as sync uses it: commits get a server time, and every listener
// (the writer's own included) hears committed records.
function fakeServer() {
  const docs = new Map(), listeners = new Set();
  let clock = 1000;
  return {
    docs,
    backend({ failures = 0 } = {}) {
      return {
        listen(since, fn) {
          const l = { since: since ?? -Infinity, fn };
          listeners.add(l);
          queueMicrotask(() => fn([...docs.values()].filter(d => d.u > l.since).map(d => ({ ...d })), false));
          return () => listeners.delete(l);
        },
        async commit(ops) {
          if (failures-- > 0) throw new Error('offline');
          const u = ++clock, out = ops.map(o => ({ id: o.id, kind: o.kind, rec: o.rec && { ...o.rec }, u }));
          for (const d of out) docs.set(d.id, d);
          for (const l of listeners) l.fn(out.map(d => ({ ...d })), false);
        },
      };
    },
  };
}

const settle = () => new Promise(r => setTimeout(r, 900));
const texts = store => store.activeDays().flatMap(d => store.linesOf(d.id).map(l => l.text));

test('two devices converge', async () => {
  const server = fakeServer();
  phone.tx(() => phone.replacePlanner(importNote(NOTE, { base: BASE, first: BASE })));
  const total = phone.state.lines.size + phone.state.days.size;

  // First device on an empty account uploads everything.
  const stopPhone = startSync(phone, server.backend(), 'me');
  await settle();
  assert.equal(server.docs.size, total);
  assert.equal(phone.state.sync.dirty.size, 0);

  // A new device takes the account's data, replacing what it had.
  mac.tx(() => mac.ensureDay('2026-12-25'));
  const stopMac = startSync(mac, server.backend(), 'me');
  await settle();
  assert.deepEqual(texts(mac), texts(phone));
  assert.equal(mac.dayOn('2026-12-25'), undefined);

  // An edit on one shows up on the other.
  const line = phone.linesOf(phone.activeDays()[0].id)[0];
  phone.update(phone.state.lines, line.id, { text: '— Stretch 10 min' });
  await settle();
  assert.equal(mac.state.lines.get(line.id).text, '— Stretch 10 min');

  // Both edit the same line before either sends: the later send wins on both.
  mac.update(mac.state.lines, line.id, { text: 'mac version' });
  phone.update(phone.state.lines, line.id, { text: 'phone version' });
  await settle();
  assert.equal(phone.state.lines.get(line.id).text, mac.state.lines.get(line.id).text);

  // Deleting a day and its lines on one removes them on the other.
  const day = mac.activeDays()[1];
  mac.tx(() => mac.removeDay(day));
  await settle();
  assert.equal(phone.state.days.get(day.id), undefined);
  assert.deepEqual(texts(phone), texts(mac));

  stopPhone();
  stopMac();
});

test('changes made offline are sent once the connection is back', async () => {
  const server = fakeServer();
  const store = await import('../js/store.js?offline');
  store.tx(() => store.insert(store.LATER, 0, [{ text: 'written on a plane', ind: 0 }]));
  const stop = startSync(store, server.backend({ failures: 1 }), 'me');
  await settle();
  assert.equal(server.docs.size, 0);
  assert.equal(store.state.sync.dirty.size, 1);
  await new Promise(r => setTimeout(r, 2300));   // first retry comes 2 s after the failure
  assert.equal(server.docs.size, 1);
  assert.equal(store.state.sync.dirty.size, 0);
  stop();
});
