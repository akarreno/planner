// Sync end to end: two browsers (a phone and a Mac) against the Firebase emulators, using firestore.rules.
// Needs Playwright and firebase-tools. Run from the repo root:
//   npx firebase emulators:start --only auth,firestore --project demo-planner   (in one terminal)
//   npx http-server -p 8090 -c-1 -s .                                          (in another)
//   node test/e2e.mjs
import { chromium, devices } from 'playwright';
import { NOTE, TEMPLATE } from './fixture.js';
const APP = 'http://localhost:8090/';
const AUTH = 'http://127.0.0.1:9099', FS = 'http://127.0.0.1:8080';
const log = (...a) => console.log(...a);
const errors = [];

// Fresh emulator state and two accounts.
await fetch(`${FS}/emulator/v1/projects/demo-planner/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`${AUTH}/emulator/v1/projects/demo-planner/accounts`, { method: 'DELETE' });
const signUp = (email) => fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'secret123', returnSecureToken: true }) }).then(r => r.json());
const me = await signUp('me@example.com'), other = await signUp('other@example.com');

// The hosted index.html, with an entry that points at the emulators instead of a real project.
const ENTRY = `import { start } from './app.js';
start({ config: { apiKey: 'demo', projectId: 'demo-planner', authDomain: 'localhost' }, emulator: '127.0.0.1' });`;
const browser = await chromium.launch();
async function device(name, viewport) {
  const ctx = await browser.newContext(viewport ?? { ...devices['iPhone 13'] });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8090' });
  await ctx.route('**/js/main.js', r => r.fulfill({ contentType: 'text/javascript', body: ENTRY }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e}`));
  page.on('console', m => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await page.goto(APP);
  return page;
}
async function signIn(page) {
  await until(async () => (await hint(page)) === 'Sign in');   // the sync code loads after the planner
  await page.locator('#menu').click();
  await page.locator('dialog .act', { hasText: 'Sync' }).click();
  await page.fill('#sign-email', 'me@example.com');
  await page.fill('#sign-password', 'secret123');
  await page.locator('dialog .primary').click();
  await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 10000 }).catch(async () => console.log('sign-in sheet still open:', await page.locator('dialog .err').textContent()));
}
const hint = async page => {
  await page.locator('#menu').click();
  const t = await page.locator('dialog .act', { hasText: 'Sync' }).locator('.hint').textContent();
  await page.keyboard.press('Escape');
  return t;
};
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 150)); } return false; };

// Phone: first run, import note and template, then sign in.
const phone = await device('phone');
log('welcome shown:', await phone.locator('.welcome').isVisible());
await phone.locator('.welcome .primary').click();
await phone.fill('#import-text', NOTE);
await phone.locator('dialog .primary').click();
await phone.locator('#menu').click();
await phone.locator('dialog .act', { hasText: 'Import weekly template' }).click();
await phone.fill('#import-tpl-text', TEMPLATE);
await phone.locator('dialog .primary').click();
log('phone imported, days:', await phone.locator('section.day[data-kind=day]').count());
await signIn(phone);
log('phone synced:', await until(async () => (await hint(phone)) === 'Up to date'), await hint(phone));

// Firestore now holds the planner under the account.
const docs = await fetch(`${FS}/v1/projects/demo-planner/databases/(default)/documents/users/${me.localId}/items?pageSize=1000`, { headers: { Authorization: 'Bearer owner' } }).then(r => r.json());
log('documents in Firestore:', docs.documents?.length);

// Rules: another account can't read this planner; the owner's own token can.
const denied = await fetch(`${FS}/v1/projects/demo-planner/databases/(default)/documents/users/${me.localId}/items?pageSize=1`, { headers: { Authorization: `Bearer ${other.idToken}` } });
const allowed = await fetch(`${FS}/v1/projects/demo-planner/databases/(default)/documents/users/${me.localId}/items?pageSize=1`, { headers: { Authorization: `Bearer ${me.idToken}` } });
log('rules: other account →', denied.status, '| owner →', allowed.status);

// Mac: signs in and loads the planner.
const mac = await device('mac', { viewport: { width: 1100, height: 800 } });
await signIn(mac);
const same = await until(async () => (await mac.locator('section.day[data-kind=day]').count()) === (await phone.locator('section.day[data-kind=day]').count()));
log('mac loaded planner:', same, await mac.locator('section.day[data-kind=day] h2').allTextContents());

// Edit on the phone → shows on the Mac.
const first = phone.locator('section.day .ls > .ln', { hasText: 'Brush Teeth' }).first();
await first.click();
await phone.keyboard.press('End');
await phone.keyboard.type(' and floss');
await phone.keyboard.press('Escape');
const t0 = Date.now();
const arrived = await until(async () => (await mac.locator('.ln', { hasText: 'Brush Teeth and floss' }).count()) > 0);
log('edit phone → mac:', arrived, `${Date.now() - t0} ms`);

// Delete on the Mac → gone on the phone.
const target = mac.locator('section.day .ls > .ln', { hasText: 'Pay Rent' }).first();
const box = await target.boundingBox();
await mac.mouse.move(box.x + 40, box.y + box.height / 2); await mac.mouse.down();
for (let dx = 10; dx <= 160; dx += 15) await mac.mouse.move(box.x + 40 - dx, box.y + box.height / 2);
await mac.mouse.up();
const t1 = Date.now();
const gone = await until(async () => (await phone.locator('.ln', { hasText: 'Pay Rent' }).count()) === 0);
log('delete mac → phone:', gone, `${Date.now() - t1} ms`);

// Offline on the phone: edits wait, then go out when back online.
await phone.context().setOffline(true);
const later = phone.locator('section.day[data-kind=later] .ls > .ln', { hasText: 'Clean up phone photos' });
await later.click();
await phone.keyboard.press('End');
await phone.keyboard.type(' (offline)');
await phone.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 1500));
log('phone offline hint:', await hint(phone), '| dot visible:', await phone.locator('#dot').isVisible());
await phone.context().setOffline(false);
const t2 = Date.now();
const back = await until(async () => (await mac.locator('.ln', { hasText: '(offline)' }).count()) > 0, 30000);
log('offline edit reached mac after reconnect:', back, `${Date.now() - t2} ms`);

// Reload the Mac: stays signed in and keeps the data.
await mac.reload();
await mac.waitForSelector('.ln');
log('mac after reload, signed in:', await until(async () => (await hint(mac)) === 'Up to date'));
// A friend: the owner creates their account with a throwaway password; they set their own through the
// reset email, sign in, and get an empty planner of their own.
await signUp('friend@example.com');
const friend = await device('friend');
await until(async () => (await hint(friend)) === 'Sign in');
await friend.locator('#menu').click();
await friend.locator('dialog .act', { hasText: 'Sync' }).click();
await friend.fill('#sign-email', 'friend@example.com');
await friend.locator('dialog .act', { hasText: 'Set or reset password' }).click();
await friend.locator('dialog p.note', { hasText: 'on its way' }).waitFor();
const { oobCodes } = await fetch(`${AUTH}/emulator/v1/projects/demo-planner/oobCodes`).then(r => r.json());
const code = oobCodes.find(c => c.email === 'friend@example.com' && c.requestType === 'PASSWORD_RESET')?.oobCode;
log('reset email sent:', !!code);
await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=demo`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ oobCode: code, newPassword: 'friends-own-pw' }) });
await friend.fill('#sign-password', 'friends-own-pw');
await friend.locator('dialog .primary').click();
log('friend signed in with own password:', await until(async () => (await hint(friend)) === 'Up to date'));
log('friend sees none of the owner’s planner:', (await friend.locator('section.day').count()) === 0 && (await friend.locator('.welcome').isVisible()));

log('errors', errors.filter(e => !/net::ERR_INTERNET_DISCONNECTED|Failed to load resource|WebChannelConnection|Could not reach Cloud Firestore/.test(e)));
await browser.close();

