import type { Response } from "express";

const listeners = new Set<Response>();
const heartbeatIntervalMs = 25_000;

// Keep SSE connections alive through reverse proxies such as Cloudflare Tunnel.
const heartbeat = setInterval(() => {
  for (const listener of listeners) listener.write(": keep-alive\n\n");
}, heartbeatIntervalMs);
heartbeat.unref();

export function addEventListener(response: Response) {
  listeners.add(response);
  response.on("close", () => listeners.delete(response));
}

export function broadcast(type: string, payload: unknown) {
  const body = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const listener of listeners) listener.write(body);
}

export function listenerCount() {
  return listeners.size;
}
