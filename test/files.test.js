import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// The offline cache must list every script and stylesheet, or a new file would be missing offline.
test('sw.js caches every app file', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const listed = new Set(JSON.parse(sw.match(/const FILES = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']')));
  for (const dir of ['js', 'css', 'vendor']) {
    for (const f of readdirSync(new URL(`../${dir}/`, import.meta.url))) assert.ok(listed.has(`${dir}/${f}`), `${dir}/${f} is not in sw.js`);
  }
});
