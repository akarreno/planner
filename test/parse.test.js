import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segments, clock, leadDate, kind, parseLines, importNote, importTemplates, exportText, today, dayTitle } from '../js/parse.js';
import { NOTE, TEMPLATE, BASE as base } from './fixture.js';

const join = segs => segs.map(s => s[1]).join('');

test('segments split the shorthand and join back to the exact line', () => {
  for (const line of ['≈ 15:30 Coffee (?)', '11:30 - 12:30 Meal Prep + Wash Dishes', '18:30 to 20:00 Run club',
    '< 22:30 Sleep', '— Shower + Get dressed', '> Dec 17: Dentist', 'w/ Link: https://example.com', '', '—']) {
    assert.equal(join(segments(line, base)), line);
  }
  assert.deepEqual(segments('≈ 15:30 Coffee (?)', base), [['m', '≈ '], ['t', '15:30'], ['', ' Coffee '], ['q', '(?)']]);
  assert.deepEqual(segments('18:30 to 20:00 Run club', base)[0], ['t', '18:30 to 20:00']);
  assert.deepEqual(segments('— Nov 10: Review', base).slice(0, 2), [['m', '— '], ['d', 'Nov 10']]);
  assert.deepEqual(segments('w/ Link: https://example.com', base).at(-1), ['u', 'https://example.com']);
});

test('clock reads start times, ignoring markers', () => {
  assert.equal(clock('≈ 15:30 Coffee'), 930);
  assert.equal(clock('< 01:00 Sleep'), 60);
  assert.equal(clock('13:30 - 15:00 Gym'), 810);
  assert.equal(clock('— Shower'), null);
  assert.equal(clock('2027‑July‑10 — Eye Exam'), null);
});

test('leadDate finds dates at the start of a line in several spellings', () => {
  assert.equal(leadDate('Nov 6: Ask for card limit increase', base), '2026-11-06');
  assert.equal(leadDate('— Monday, November 10: Renew', base), '2026-11-10');
  assert.equal(leadDate('≈ Oct 26: Flu Shot', base), '2026-10-26');
  assert.equal(leadDate('> Dec 17: Dentist', base), '2026-12-17');
  assert.equal(leadDate('— Oct 14 - Social:', base), '2026-10-14');
  assert.equal(leadDate('— 2027‑July‑10 — Eye Exam', base), '2027-07-10');
  assert.equal(leadDate('— 15 Ene 2027: nothing', base), null);
  assert.equal(leadDate('— Jan 15: Taxes', base), '2027-01-15');   // far in the past → next year
  assert.equal(leadDate('— Decide this: link', base), null);
  assert.equal(leadDate('— Union Station 3', base), null);
  assert.equal(leadDate('10:45 Union Station', base), null);
});

test('kind spots headers and blank lines', () => {
  assert.equal(kind('Projects:'), 'head');
  assert.equal(kind('@ Home:'), 'head');
  assert.equal(kind('   '), 'blank');
  assert.equal(kind('w/ Link: https://example.com'), '');
});

test('parseLines handles Notes bullets, typed dashes, nested numbering and header blocks', () => {
  assert.deepEqual(parseLines('19:00 Dinner\n\t⁃\tDishwasher\n- - Gym bag\n< 22:30 Sleep'),
    [{ text: '19:00 Dinner', ind: 0 }, { text: 'Dishwasher', ind: 1 }, { text: 'Gym bag', ind: 1 }, { text: '< 22:30 Sleep', ind: 0 }]);
  const list = parseLines('Work:\n\t1.\tA\n\t5.\tB\n\t1.\tB1\n\t6.\tC\n\t1.\tC1\n\t7.\tD\n\n11:30 Meal');
  assert.deepEqual(list.map(r => [r.text, r.ind]), [['Work:', 0], ['1. A', 1], ['5. B', 1], ['1. B1', 2], ['6. C', 1], ['1. C1', 2], ['7. D', 1], ['', 0], ['11:30 Meal', 0]]);
  assert.deepEqual(parseLines('On Plane:\n— Fill next week\n— Grocery list\n\n— After').map(r => r.ind), [0, 1, 1, 0, 0]);
});

test('importNote reads a whole planner note', () => {
  const { days, later } = importNote(NOTE, { base, first: base });
  assert.deepEqual(days.map(d => d.date), ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-13']);
  assert.equal(days[0].lines[0].text, '— Stretch');
  assert.equal(dayTitle(days[1].date), 'Thursday October 1');
  const oct13 = days.at(-1).lines;
  const video = oct13.findIndex(l => l.text === '2. Video concept');
  assert.deepEqual([oct13[video].ind, oct13[video + 1].ind, oct13[video + 2].ind], [1, 2, 1]);
  assert.deepEqual(days.find(d => d.date === '2026-10-04').lines.slice(0, 1), [{ text: '—', ind: 0 }]);
  const plane = days.find(d => d.date === '2026-10-04').lines;
  assert.deepEqual(plane.slice(-3).map(l => l.ind), [0, 1, 1]);   // "On Plane:" with its two lines under it
  assert.equal(later[0].text, '— Clean up phone photos');
  const abroad = later.findIndex(l => l.text === '@ Abroad:');
  assert.deepEqual(later.slice(abroad, abroad + 3).map(l => l.ind), [0, 1, 1]);
  assert.equal(later.at(-1).text, 'w/ Link: https://example.com');
  assert.equal(later.at(-1).ind, 0);
});

test('importTemplates reads one template per weekday', () => {
  const t = importTemplates(TEMPLATE);
  assert.deepEqual(t.map(x => x.name), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  assert.equal(t[0].lines[0].text, '07:30 Gym');
  assert.equal(t[2].lines.find(l => l.text.startsWith('Pack')).ind, 1);
});

test('exportText round-trips through importNote', () => {
  const parsed = importNote(NOTE, { base, first: base });
  const text = exportText([...parsed.days.map(d => ({ title: dayTitle(d.date), lines: d.lines })), { title: 'Later:', lines: parsed.later }]);
  assert.deepEqual(importNote(text, { base }), parsed);
});

test('the day changes at midnight', () => {
  assert.equal(today(new Date(2026, 8, 30, 23, 59)), '2026-09-30');
  assert.equal(today(new Date(2026, 9, 1, 0, 0)), '2026-10-01');
});
