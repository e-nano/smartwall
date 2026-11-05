import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { RequestHandler } from 'express';

export function maintenanceMode() {
  return !!process.env.MAINTENANCE_FILE && existsSync(process.env.MAINTENANCE_FILE);
}
function configuredPassword() {
  return process.env.SMARTWALL_ADMIN_PASSWORD_FILE
    ? readFileSync(process.env.SMARTWALL_ADMIN_PASSWORD_FILE,'utf8').trim()
    : process.env.SMARTWALL_ADMIN_PASSWORD ?? '';
}
export function validateLocalAccess() {
  const host=process.env.HTTP_HOST ?? '127.0.0.1';
  if ((process.env.NODE_ENV === 'production' || !['127.0.0.1','::1','localhost'].includes(host)) && configuredPassword().length < 20)
    throw new Error('Set a unique administrator password of at least 20 characters before exposing SmartWall');
}
export const localAccess: RequestHandler = (request,response,next) => {
  const password=configuredPassword();
  if (password) {
    const expected=createHash('sha256').update(`admin:${password}`).digest();
    const auth=request.header('authorization') ?? '';
    const supplied=createHash('sha256').update(auth.startsWith('Basic ') ? Buffer.from(auth.slice(6),'base64') : '').digest();
    if (!timingSafeEqual(expected,supplied)) {
      response.setHeader('WWW-Authenticate','Basic realm="SmartWall", charset="UTF-8"');
      response.status(401).send('Sign in with your SmartWall administrator account'); return;
    }
  } else if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')) {
    response.status(403).json({ error:'Local administrator authentication is not configured' }); return;
  }
  // Browser credentials must not authorize requests submitted by another site.
  if (!['GET','HEAD','OPTIONS'].includes(request.method)) {
    const origin=request.header('origin');
    const allowed=(process.env.SMARTWALL_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean);
    if (origin) {
      let sameHost=false;
      try { sameHost=new URL(origin).host === request.header('host'); } catch { /* rejected below */ }
      if (!sameHost && !allowed.includes(origin)) { response.status(403).json({ error:'Cross-origin write rejected' }); return; }
    }
    if (request.header('sec-fetch-site') === 'cross-site') { response.status(403).json({ error:'Cross-site write rejected' }); return; }
  }
  if (maintenanceMode() && request.path.startsWith('/api/')) {
    response.setHeader('Retry-After','30'); response.status(503).json({ error:'SmartWall is updating. Please retry shortly.' }); return;
  }
  next();
};
