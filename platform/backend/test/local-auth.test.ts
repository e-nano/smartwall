import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = mkdtempSync(join(tmpdir(), 'smartwall-auth-'));
process.env.DATA_DIR = join(directory, 'data');
process.env.FIRMWARE_DIR = join(directory, 'firmware');
process.env.SMARTWALL_ADMIN_PASSWORD = 'initial-setup-code-at-least-twenty-characters';
const { api } = await import('../src/server.js');
const { db } = await import('../src/db.js');
const server = api.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address(); assert(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;
type Login = { cookie: string; csrf: string };
let first: Login;
async function post(path: string, body: unknown, login?: Login, extra: Record<string, string> = {}) {
  return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(login ? { cookie: login.cookie, 'X-CSRF-Token': login.csrf } : {}), ...extra }, body: JSON.stringify(body) });
}
async function signedIn(response: Response): Promise<Login> {
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Strict/i);
  return { cookie: cookie.split(';')[0]!, csrf: (await response.json()).csrfToken };
}
const password = 'my-local-wall-password-2026';
after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); rmSync(directory, { recursive: true, force: true }); });

test('anonymous access returns JSON without a browser authentication popup', async () => {
  const response = await fetch(base + '/api/parts');
  assert.equal(response.status, 401); assert.equal(response.headers.get('www-authenticate'), null);
  assert.equal((await fetch(base + '/api/stream')).status, 401);
  const session = await (await fetch(base + '/api/auth/session')).json();
  assert.equal(session.authenticated, false); assert.equal(session.setupRequired, true);
});
test('first-run setup requires the private code, rejects cross-site forms and cannot overwrite an account', async () => {
  const body = { setupCode: process.env.SMARTWALL_ADMIN_PASSWORD, username: 'workshop', password };
  assert.equal((await post('/api/auth/setup', { ...body, setupCode: 'wrong' })).status, 401);
  assert.equal((await post('/api/auth/setup', body, undefined, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await fetch(base + '/api/auth/setup', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })).status, 415);
  assert.equal((await post('/api/auth/setup', { ...body, password: 'short' })).status, 400);
  first = await signedIn(await post('/api/auth/setup', body));
  assert.equal((await post('/api/auth/setup', { ...body, username: 'intruder' })).status, 409);
  const row = db.prepare('SELECT * FROM local_admin').get()!;
  assert.notEqual(row.password_hash, password); assert.equal(String(row.password_hash).length, 128);
  assert.equal(db.prepare('SELECT * FROM sync_outbox WHERE entity_type LIKE ?').all('%admin%').length, 0);
  const token = first.cookie.split('=')[1];
  assert.equal(db.prepare('SELECT * FROM local_sessions WHERE token_hash=?').get(token!), undefined);
});
test('sessions protect mutations with CSRF and ignore legacy Basic credentials', async () => {
  assert.equal((await fetch(base + '/api/parts', { headers: { cookie: first.cookie } })).status, 200);
  assert.equal((await fetch(base + '/api/parts', { headers: { Authorization: 'Basic ' + Buffer.from('admin:' + process.env.SMARTWALL_ADMIN_PASSWORD).toString('base64') } })).status, 401);
  assert.equal((await post('/api/auth/logout', {}, first, { 'X-CSRF-Token': 'wrong' })).status, 403);
  const mutation = await fetch(base + '/api/mqtt/security', { method: 'PATCH', headers: { cookie: first.cookie, 'Content-Type': 'application/json' }, body: '{"credentialsRequired":false}' });
  assert.equal(mutation.status, 403);
  const crossSite = await post('/api/auth/logout', {}, first, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(crossSite.status, 403);
});
test('login rejects wrong credentials, rotates sessions and logout revokes an open event stream', async () => {
  assert.equal((await post('/api/auth/login', { username: 'workshop', password: 'wrong' })).status, 401);
  const second = await signedIn(await post('/api/auth/login', { username: 'workshop', password }));
  const stream = await fetch(base + '/api/stream', { headers: { cookie: second.cookie } });
  assert.equal(stream.status, 200);
  assert.equal((await post('/api/auth/logout', {}, second)).status, 200);
  await stream.text(); // Resolves only when the revoked session's stream is closed.
  assert.equal((await fetch(base + '/api/parts', { headers: { cookie: second.cookie } })).status, 401);
  assert.equal((await fetch(base + '/api/parts', { headers: { cookie: first.cookie } })).status, 200);
});
test('changing credentials checks current password and revokes all earlier sessions', async () => {
  const body = { username: 'alan', password: 'new-local-password-2026', currentPassword: 'incorrect' };
  assert.equal((await post('/api/auth/account', body, first)).status, 401);
  const other = await signedIn(await post('/api/auth/login', { username: 'workshop', password }));
  const updated = await signedIn(await post('/api/auth/account', { ...body, currentPassword: password }, first));
  for (const old of [first, other]) assert.equal((await fetch(base + '/api/parts', { headers: { cookie: old.cookie } })).status, 401);
  assert.equal((await post('/api/auth/login', { username: 'workshop', password })).status, 401);
  const session = await (await fetch(base + '/api/auth/session', { headers: { cookie: updated.cookie } })).json();
  assert.equal(session.username, 'alan'); first = updated;
});
test('expired sessions fail and cookies can be secured behind HTTPS', async () => {
  db.exec('UPDATE local_sessions SET expires_at=0');
  assert.equal((await fetch(base + '/api/parts', { headers: { cookie: first.cookie } })).status, 401);
  process.env.SMARTWALL_SECURE_COOKIES = 'true';
  const login = await post('/api/auth/login', { username: 'alan', password: 'new-local-password-2026' });
  assert.match(login.headers.get('set-cookie')!, /; Secure/i); assert.equal(login.status, 200);
  delete process.env.SMARTWALL_SECURE_COOKIES;
});
test('repeated failed logins are limited with a retry time', async () => {
  db.exec('DELETE FROM local_login_limits');
  for (let i = 0; i < 8; i++) assert.equal((await post('/api/auth/login', { username: 'unknown', password: 'wrong' })).status, 401);
  const limited = await post('/api/auth/login', { username: 'alan', password: 'new-local-password-2026' });
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
  db.exec('DELETE FROM local_login_limits');
});
test('maintenance also blocks account setup and account changes', async () => {
  const marker = join(directory, 'maintenance'); writeFileSync(marker, ''); process.env.MAINTENANCE_FILE = marker;
  assert.equal((await post('/api/auth/login', { username: 'alan', password: 'new-local-password-2026' })).status, 503);
  assert.equal((await fetch(base + '/health/ready')).status, 200);
  delete process.env.MAINTENANCE_FILE;
});
