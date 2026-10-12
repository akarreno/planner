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

test('importing adds to existing days and Later, and replaces templates only by name', async () => {
  const s = await import('../js/store.js?import');
  const { importNote, importTemplates } = await import('../js/parse.js');
  const texts = c => s.linesOf(c).map(l => l.text);
  s.tx(() => s.addToPlanner(importNote('Thursday October 1\n09:00 Wake Up\nLater:\n— Old idea', { base: '2026-10-01' })));
  s.tx(() => s.addToPlanner(importNote('Thursday October 1\n14:00 Lunch\nFriday October 2\n— Pack\nLater:\n— New idea', { base: '2026-10-01' })));
  assert.deepEqual(texts(s.dayOn('2026-10-01').id), ['09:00 Wake Up', '', '14:00 Lunch']);
  assert.deepEqual(texts(s.dayOn('2026-10-02').id), ['— Pack']);
  assert.deepEqual(texts(s.LATER), ['— Old idea', '', '— New idea']);

  s.tx(() => s.importTemplateList(importTemplates('Monday\n07:30 Gym\nSaturday\n10:00 Gym')));
  s.tx(() => s.importTemplateList(importTemplates('Monday\n06:00 Run')));
  assert.deepEqual(s.templates().map(t => [t.name, texts(t.id)]), [['Monday', ['06:00 Run']], ['Saturday', ['10:00 Gym']]]);
});

test('tidy keeps at most one blank line in a row and none at the ends, sparing the line being typed in', async () => {
  const s = await import('../js/store.js?tidy');
  const rows = t => t.split('|').map(text => ({ text, ind: text.startsWith('>') ? 1 : 0 }));
  const texts = c => s.linesOf(c).map(l => l.text).join('|');
  s.insert('d', 0, rows('||A|||B| |C||'));
  s.tidy('d');
  assert.equal(texts('d'), 'A||B| |C');               // a line of spaces counts as blank
  s.insert('e', 0, rows('A||'));
  const typing = s.linesOf('e').at(-1).id;
  s.tidy('e', typing);
  assert.equal(texts('e'), 'A||');                   // the last blank is being typed in, the one before separates it
  s.insert('f', 0, rows('A||>child|B'));
  s.tidy('f');
  assert.equal(texts('f'), 'A||>child|B');           // a blank line with sub-items stays
});

test('redo brings back what undo took, until a new change', async () => {
  const s = await import('../js/store.js?redo');
  let id;
  s.tx(() => { id = s.insert(s.LATER, 0, [{ text: 'a', ind: 0 }])[0].id; });
  s.tx(() => s.update(s.state.lines, id, { text: 'b' }));
  s.tx(() => s.update(s.state.lines, id, { text: 'c' }));
  assert.equal(s.redo(), false);
  s.undo(); s.undo();
  assert.equal(s.state.lines.get(id).text, 'a');
  assert.equal(s.redo(), true);
  assert.equal(s.state.lines.get(id).text, 'b');
  assert.equal(s.undo(), true);            // a redo can be undone again
  assert.equal(s.state.lines.get(id).text, 'a');
  s.redo(); s.redo();
  assert.equal(s.state.lines.get(id).text, 'c');
  s.undo();
  s.tx(() => s.update(s.state.lines, id, { text: 'd' }));
  assert.equal(s.canRedo(), false, 'a new change clears redo');
  s.undo(); s.undo(); s.undo();
  assert.equal(s.state.lines.get(id), undefined);
  s.redo();
  assert.equal(s.state.lines.get(id).text, 'a', 'redo brings a removed line back');
});

test('moving lines to a day puts timed ones in time order and keeps sub-items with their line', async () => {
  const s = await import('../js/store.js?move');
  const texts = c => s.linesOf(c).map(l => '-'.repeat(l.ind) + l.text);
  const mon = s.ensureDay('2026-10-12'), tue = s.ensureDay('2026-10-13');
  s.insert(mon.id, 0, [
    { text: '08:00 Gym', ind: 0 }, { text: 'Shoes', ind: 1 }, { text: 'Call bank', ind: 0 },
    { text: 'Errands:', ind: 0 }, { text: 'Stamps', ind: 1 }, { text: 'Milk', ind: 1 },
  ]);
  s.insert(tue.id, 0, [{ text: '07:00 Wake', ind: 0 }, { text: '12:00 Lunch', ind: 0 }, { text: '< 01:00 Sleep', ind: 0 }]);
  const [gym, shoes, bank, , , milk] = s.linesOf(mon.id);
  s.moveLines([gym, shoes, bank, milk], tue.id);
  assert.deepEqual(texts(tue.id), ['07:00 Wake', '08:00 Gym', '-Shoes', '12:00 Lunch', '< 01:00 Sleep', 'Call bank', 'Milk']);
  assert.deepEqual(texts(mon.id), ['Errands:', '-Stamps']);

  // Dropping lines from different places in one spot: each run starts at the drop's indent.
  const [wake] = s.linesOf(tue.id), [, stamps] = s.linesOf(mon.id);
  s.moveBlock([stamps, wake], s.LATER, 0, 0);
  assert.deepEqual(texts(s.LATER), ['Stamps', '07:00 Wake']);
});
