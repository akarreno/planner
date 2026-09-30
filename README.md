# Weekly Planner

A text-first planner that replaces a weekly planner note in Apple Notes. You type the same shorthand
as in Notes (`07:30 Gym`, `≈ 15:30 Coffee (?)`, `< 22:30 Sleep`, `— Task`, `- sub-item`), and the app
reads structure out of it: times, dates, sub-items, headers, a "now" line and dated Later items.
It installs to the Home Screen from Safari, works offline, and syncs through Firebase.

No framework and no build step: plain ES modules, plus a trimmed Firebase bundle in `vendor/`.

| File | What it does |
|---|---|
| `js/parse.js` | Pure text logic: reading a line, pasted text, a whole note, templates; exporting back to text |
| `js/store.js` | Days, lines and templates in memory; undoable changes; saved to `localStorage` |
| `js/sync.js` | Two-way sync: sends changed records in batches, applies other devices' changes live |
| `js/firebase.js` | Firebase sign-in and Firestore storage, in the shape `sync.js` expects |
| `js/view.js` | Draws the screen, touching only the rows that changed |
| `js/edit.js` | Tap-to-edit, Notes-like keys (Return, Backspace, Tab), paste, toolbar above the keyboard |
| `js/gestures.js` | Swipe right = done, swipe left = delete, long-press = drag |
| `js/menus.js` | Sheets: menu, Fill days, Move to, import, copy, sync account |
| `js/app.js`, `js/main.js` | Startup and tap routing; `main.js` is the hosted entry |
| `js/config.js` | The Firebase project's web settings (public by design) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline cache and Home Screen app |
| `firestore.rules` | Each account can read and write only its own planner |

## Data

Firestore path `users/{uid}/items/{record id}`: each day, line and template is one document with its fields
plus `k` (kind), `u` (server time of the last write) and `x` (deleted). Devices listen for documents with
`u` newer than the last one they saw, so an app launch only reads what changed.

## Commands

- `npm test`: parser and sync tests (Node 22+).
- `node test/e2e.mjs`: sync between two browsers against the Firebase emulators (see the file for setup).
- `npm run artifact`: builds `dist/` for the claude.ai preview, seeded from `private/seed.js` (not in git).
- `tools/vendor-firebase.sh <version>`: rebuilds `vendor/firebase.js`.

Run locally: `npx http-server -c-1 .` and open http://localhost:8080.
