import dgram from "node:dgram";
import { mqttCredentialsRequired } from "./mqtt-security.js";

const protocol = "smartwall-discovery-v1";
const defaultDiscoveryPort = 4210;
const defaultMqttPort = 1883;
const maximumRequestBytes = 512;

type DiscoveryRequest = {
  protocol: typeof protocol;
  type: "discover";
  binId: string;
  nonce: string;
};

function mqttPort() {
  try {
    const broker = new URL(process.env.MQTT_URL ?? "mqtt://localhost:1883");
    if (broker.port) return Number(broker.port);
    return broker.protocol === "mqtts:" ? 8883 : defaultMqttPort;
  } catch {
    return defaultMqttPort;
  }
}

export function parseDiscoveryRequest(message: Buffer): DiscoveryRequest | null {
  if (message.length === 0 || message.length > maximumRequestBytes) return null;
  try {
    const value: unknown = JSON.parse(message.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const request = value as Record<string, unknown>;
    if (request.protocol !== protocol || request.type !== "discover") return null;
    if (typeof request.binId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(request.binId)) return null;
    if (typeof request.nonce !== "string" || !/^[a-fA-F0-9]{8}$/.test(request.nonce)) return null;
    return request as DiscoveryRequest;
  } catch {
    return null;
  }
}

export function createDiscoveryReply(request: DiscoveryRequest) {
  return Buffer.from(JSON.stringify({
    protocol,
    type: "offer",
    nonce: request.nonce,
    mqttPort: mqttPort(),
    authenticationRequired: mqttCredentialsRequired()
  }));
}

export function startDiscovery() {
  const requestedPort = Number(process.env.SMARTWALL_DISCOVERY_PORT ?? defaultDiscoveryPort);
  const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535
    ? requestedPort
    : defaultDiscoveryPort;
  const host = process.env.SMARTWALL_DISCOVERY_HOST ?? "0.0.0.0";
  const socket = dgram.createSocket("udp4");

  socket.on("message", (message, remote) => {
    const request = parseDiscoveryRequest(message);
    if (!request) return;
    console.log(`[DISCOVERY] Offering MQTT to ${request.binId} at ${remote.address}`);
    const reply = createDiscoveryReply(request);
    socket.send(reply, remote.port, remote.address, (error) => {
      if (error) console.error(`[DISCOVERY] Could not reply to ${request.binId}: ${error.message}`);
    });
  });
  socket.on("error", (error) => {
    console.error(`[DISCOVERY] UDP service error: ${error.message}`);
  });
  socket.bind(port, host, () => {
    console.log(`[DISCOVERY] SmartWall broker discovery: udp://${host}:${port}`);
  });
  return socket;
}
