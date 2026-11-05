import { createHash, randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from './db.js';

const cookieName = 'smartwall_session';
const lifetime = 8 * 60 * 60 * 1000;
const streams = new Map<string, Set<Response>>();
db.exec(`
  CREATE TABLE IF NOT EXISTS local_admin (
    id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL,
    salt TEXT NOT NULL, password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS local_sessions (
    token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS local_login_limits (
    bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL
  );
`);
type Admin = { username: string; salt: string; password_hash: string };
type Session = { token_hash: string; csrf: string; expires_at: number };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const equal = (a: string, b: string) => timingSafeEqual(Buffer.from(hash(a), 'hex'), Buffer.from(hash(b), 'hex'));
export function administrator() { return db.prepare('SELECT username,salt,password_hash FROM local_admin WHERE id=1').get() as Admin | undefined; }
export function setupCode() {
  return process.env.SMARTWALL_ADMIN_PASSWORD_FILE
    ? readFileSync(process.env.SMARTWALL_ADMIN_PASSWORD_FILE, 'utf8').trim()
    : process.env.SMARTWALL_ADMIN_PASSWORD ?? '';
}
export function authenticationRequired() { return !!administrator() || !!setupCode() || process.env.NODE_ENV === 'production'; }
function passwordHash(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => derive(password, salt, 64, (error, key) => error ? reject(error) : resolve(key.toString('hex'))));
}
function cookieOptions(request: Request) {
  return { httpOnly: true, sameSite: 'strict' as const, secure: request.secure || process.env.SMARTWALL_SECURE_COOKIES === 'true', path: '/' };
}
export function sessionFor(request: Request): Session | undefined {
  const cookie = (request.headers.cookie ?? '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  if (!cookie || !/^[a-f0-9]{64}$/.test(cookie)) return;
  return db.prepare('SELECT * FROM local_sessions WHERE token_hash=? AND expires_at>?').get(hash(cookie), Date.now()) as Session | undefined;
}
function revoke(token?: string) {
  if (token) db.prepare('DELETE FROM local_sessions WHERE token_hash=?').run(token);
  else db.exec('DELETE FROM local_sessions');
  for (const [key, clients] of streams) if (!token || key === token) {
    for (const client of clients) client.end();
    streams.delete(key);
  }
}
export function watchSession(request: Request, response: Response, session: Session) {
  const clients = streams.get(session.token_hash) ?? new Set<Response>();
  clients.add(response); streams.set(session.token_hash, clients);
  const timer = setInterval(() => { if (!sessionFor(request)) response.end(); }, 10_000);
  timer.unref();
  response.on('close', () => { clearInterval(timer); clients.delete(response); if (!clients.size) streams.delete(session.token_hash); });
}
function signIn(request: Request, response: Response) {
  db.prepare('DELETE FROM local_sessions WHERE expires_at<=?').run(Date.now());
  const existing = sessionFor(request); if (existing) revoke(existing.token_hash);
  const token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO local_sessions VALUES(?,?,?)').run(hash(token), csrf, Date.now() + lifetime);
  response.cookie(cookieName, token, { ...cookieOptions(request), maxAge: lifetime });
  response.json({ authenticated: true, required: true, setupRequired: false, username: administrator()!.username, csrfToken: csrf });
}
function attempt(request: Request, response: Response) {
  const now = Date.now();
  db.prepare('DELETE FROM local_login_limits WHERE reset_at<=?').run(now);
  for (const [bucket, limit] of [[request.socket.remoteAddress ?? 'unknown', 8], ['global', 128]] as const) {
    const row = db.prepare('SELECT attempts,reset_at FROM local_login_limits WHERE bucket=?').get(bucket) as {attempts:number;reset_at:number} | undefined;
    if (row && row.attempts >= limit) {
      response.setHeader('Retry-After', String(Math.ceil((row.reset_at - now) / 1000)));
      response.status(429).json({ error: 'Too many sign-in attempts. Please try again in 15 minutes.' }); return false;
    }
  }
  for (const bucket of [request.socket.remoteAddress ?? 'unknown', 'global'])
    db.prepare('INSERT INTO local_login_limits VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1').run(bucket, now + 15 * 60 * 1000);
  return true;
}
function successfulAttempt(request: Request) { db.prepare('DELETE FROM local_login_limits WHERE bucket=?').run(request.socket.remoteAddress ?? 'unknown'); }
const credentials = z.object({ username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9._@-]*$/, 'Use letters, numbers, dots, dashes or @ in your username'), password: z.string().min(12, 'Use a password with at least 12 characters').max(256) });
export function localAuthRouter() {
  const router = Router();
  router.use((_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/session', (request, response) => {
    const required = authenticationRequired(), session = sessionFor(request);
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '');
    response.json({ required, authenticated: !!session || (!required && loopback), setupRequired: required && !administrator(), username: session ? administrator()?.username : null, csrfToken: session?.csrf });
  });
  router.post('/setup', async (request, response) => {
    if (administrator()) return response.status(409).json({ error: 'This wall already has an administrator. Sign in instead.' });
    if (!attempt(request, response)) return;
    const code = setupCode();
    if (code.length < 20 || typeof request.body?.setupCode !== 'string' || !equal(request.body.setupCode, code))
      return response.status(401).json({ error: 'The setup code is incorrect.' });
    const input = credentials.parse(request.body), salt = randomBytes(16).toString('hex');
    const password = await passwordHash(input.password, salt);
    // INSERT OR IGNORE makes concurrent setup requests unable to replace an account.
    const result = db.prepare('INSERT OR IGNORE INTO local_admin VALUES(1,?,?,?)').run(input.username, salt, password);
    if (!result.changes) return response.status(409).json({ error: 'Setup is already complete. Sign in instead.' });
    successfulAttempt(request); signIn(request, response);
  });
  router.post('/login', async (request, response) => {
    if (!attempt(request, response)) return;
    const input = z.object({ username: z.string().trim().max(64), password: z.string().max(256) }).parse(request.body);
    const admin = administrator();
    const password = await passwordHash(input.password, admin?.salt ?? 'unconfigured-wall');
    if (!admin || administrator()?.password_hash !== admin.password_hash || !equal(input.username, admin.username) || !equal(password, admin.password_hash))
      return response.status(401).json({ error: 'Your username or password is incorrect.' });
    successfulAttempt(request); signIn(request, response);
  });
  router.use((request, response, next) => {
    const session = sessionFor(request);
    if (!session) return response.status(401).json({ error: 'Please sign in to continue.' });
    if (!equal(request.header('x-csrf-token') ?? '', session.csrf)) return response.status(403).json({ error: 'Your session changed. Refresh and try again.' });
    next();
  });
  router.post('/logout', (request, response) => {
    revoke(sessionFor(request)!.token_hash);
    response.clearCookie(cookieName, cookieOptions(request)); response.json({ ok: true });
  });
  router.post('/account', async (request, response) => {
    if (!attempt(request, response)) return;
    const current = administrator()!;
    const input = credentials.extend({ currentPassword: z.string().max(256) }).parse(request.body);
    if (!equal(await passwordHash(input.currentPassword, current.salt), current.password_hash))
      return response.status(401).json({ error: 'Your current password is incorrect.' });
    const salt = randomBytes(16).toString('hex'), password = await passwordHash(input.password, salt);
    // Recheck after async hashing so a revoked or concurrently changed account cannot be overwritten.
    if (!sessionFor(request) || administrator()?.password_hash !== current.password_hash)
      return response.status(409).json({ error: 'Your account changed. Sign in again.' });
    db.prepare('UPDATE local_admin SET username=?,salt=?,password_hash=? WHERE id=1').run(input.username, salt, password);
    revoke(); successfulAttempt(request); signIn(request, response);
  });
  return router;
}
