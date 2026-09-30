import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = await import('../js/store.js?undo');
const { state, tx, typed, undo, canUndo, insert, update, applyRemote, LATER } = store;
const text = id => state.lines.get(id).text;

test('undo reverts the last change, and typing counts as one step until a pause', t => {
  let id;
  tx(() => { id = insert(LATER, 0, [{ text: 'Gym', ind: 0 }])[0].id; });

  const now = t.mock.method(Date, 'now', () => 1000);
  for (const s of ['Gym ', 'Gym a', 'Gym at', 'Gym at 7']) typed(id, { text: s });
  now.mock.mockImplementation(() => 5000);   // a pause, then more typing
  typed(id, { text: 'Gym at 7:30' });

  assert.equal(undo(), true);
  assert.equal(text(id), 'Gym at 7');
  assert.equal(undo(), true);
  assert.equal(text(id), 'Gym');
  assert.equal(undo(), true);             // the insert itself
  assert.equal(state.lines.get(id), undefined);
  assert.equal(undo(), false);
  assert.equal(canUndo(), false);
  assert.ok(state.sync.dirty.has(id), 'undone changes still sync');
});

test('keeps the last 20 changes, and never records changes from other devices', () => {
  let id;
  tx(() => { id = insert(LATER, 0, [{ text: '0', ind: 0 }])[0].id; });
  for (let i = 1; i <= 25; i++) tx(() => update(state.lines, id, { text: String(i) }));
  applyRemote([{ id, kind: 'l', rec: { ...state.lines.get(id), text: 'from the Mac' } }]);
  assert.equal(undo(), true);
  assert.equal(text(id), '24');           // the remote change was not an undo step
  let n = 1;
  while (undo()) n++;
  assert.equal(n, 20);
  assert.equal(text(id), '5');
});

test('a backup packs the whole planner and restores it as one undoable step', async () => {
  const { pack, unpack } = await import('../js/backup.js');
  let id;
  tx(() => { id = insert(LATER, 0, [{ text: 'keep me', ind: 0 }])[0].id; });
  const copy = await unpack(await pack(state));
  tx(() => { update(state.lines, id, { text: 'changed' }); insert(LATER, 0, [{ text: 'added later', ind: 0 }]); });
  const undoRestore = store.restoreCopy(copy);
  assert.equal(text(id), 'keep me');
  assert.equal([...state.lines.values()].some(l => l.text === 'added later'), false);
  assert.ok(state.sync.dirty.has(id), 'a restore syncs to other devices');
  undoRestore();
  assert.equal(text(id), 'changed');
  assert.equal([...state.lines.values()].some(l => l.text === 'added later'), true);
});
