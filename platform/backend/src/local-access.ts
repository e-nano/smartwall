import type { RequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { administrator, authenticationRequired, sessionFor, setupCode, watchSession } from './local-auth.js';

export function maintenanceMode() { return !!process.env.MAINTENANCE_FILE && existsSync(process.env.MAINTENANCE_FILE); }
export function validateLocalAccess() {
  const host = process.env.HTTP_HOST ?? '127.0.0.1';
  if (!administrator() && (process.env.NODE_ENV === 'production' || !['127.0.0.1','::1','localhost'].includes(host)) && setupCode().length < 20)
    throw new Error('Set a unique setup code of at least 20 characters using SMARTWALL_ADMIN_PASSWORD_FILE before starting SmartWall');
}
export const localRequestGuard: RequestHandler = (request, response, next) => {
  if (!['GET','HEAD','OPTIONS'].includes(request.method)) {
    const origin = request.header('origin');
    const allowed = (process.env.SMARTWALL_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean);
    if (origin) {
      let sameHost = false;
      try { sameHost = new URL(origin).host === request.header('host'); } catch { /* reject */ }
      if (!sameHost && !allowed.includes(origin)) { response.status(403).json({ error: 'Cross-origin write rejected' }); return; }
    }
    if (request.header('sec-fetch-site') === 'cross-site') { response.status(403).json({ error: 'Cross-site write rejected' }); return; }
    if (request.path.startsWith('/api/auth/') && !request.is('application/json')) {
      response.status(415).json({ error: 'Use application/json for account requests' }); return;
    }
  }
  if (maintenanceMode() && request.path.startsWith('/api/')) {
    response.setHeader('Retry-After', '30'); response.status(503).json({ error: 'SmartWall is updating. Please retry shortly.' }); return;
  }
  next();
};
export const localAccess: RequestHandler = (request, response, next) => {
  // The login shell is public. All inventory, actions and event streams remain protected.
  if (!request.path.startsWith('/api/')) return next();
  if (authenticationRequired()) {
    const session = sessionFor(request);
    if (!session) { response.status(401).json({ error: 'Please sign in to continue.' }); return; }
    if (!['GET','HEAD','OPTIONS'].includes(request.method) && request.header('x-csrf-token') !== session.csrf) {
      response.status(403).json({ error: 'Your session changed. Refresh and try again.' }); return;
    }
    if (request.path === '/api/stream') watchSession(request, response, session);
  } else if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')) {
    response.status(403).json({ error: 'Local administrator authentication is not configured' }); return;
  }
  next();
};
