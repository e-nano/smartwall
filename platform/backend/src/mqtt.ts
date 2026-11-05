import { readFileSync } from "node:fs";
import { observeIntakes } from "./goods-in.js";
import mqtt, { type MqttClient } from "mqtt";
import { randomUUID } from "node:crypto";
import {
  completeCommand,
  getBinLabelAssignment,
  listBinLabelAssignmentsForPart,
  recordCommand,
  upsertOtaStatus,
  upsertStatus,
  upsertTelemetry,
  type JsonRecord
} from "./db.js";
import { broadcast } from "./events.js";

const topicRoot = "smartwall/v1";
let client: MqttClient | null = null;
let connected = false;
type BinSeen = { binId: string; firmwareVersion: string | null };
const binSeenHandlers = new Set<(bin: BinSeen) => void>();
const labelSyncAttempts = new Map<string, { signature: string; attemptedAt: number }>();
const labelSyncRetryMs = 30_000;

export function onBinSeen(handler: (bin: BinSeen) => void) {
  binSeenHandlers.add(handler);
  return () => binSeenHandlers.delete(handler);
}

function notifyBinSeen(binId: string, payload: JsonRecord) {
  const firmwareVersion = typeof payload.firmwareVersion === "string"
    ? payload.firmwareVersion
    : null;
  for (const handler of binSeenHandlers) handler({ binId, firmwareVersion });
}

function labelSignature(partId: string, name: string, unitWeightGrams: number) {
  return JSON.stringify([partId, name, unitWeightGrams]);
}

async function syncBinLabel(binId: string, reported?: JsonRecord) {
  const assignment = getBinLabelAssignment(binId);
  if (!assignment || !assignment.online) {
    labelSyncAttempts.delete(binId);
    return;
  }

  // Firmware versions before label reporting cannot confirm synchronization.
  // They still receive immediate rename pushes, but are not repeatedly refreshed.
  if (reported && typeof reported.partName !== "string") return;

  const name = assignment.name.slice(0, 100);
  const signature = labelSignature(assignment.part_id, name, assignment.unit_weight_grams);
  const reportedWeight = typeof reported?.unitWeightGrams === "number"
    ? reported.unitWeightGrams
    : null;
  const matches = reported?.partId === assignment.part_id &&
    reported?.partName === name &&
    reportedWeight !== null &&
    Math.abs(reportedWeight - assignment.unit_weight_grams) < 0.0001;
  if (matches) {
    labelSyncAttempts.set(binId, { signature, attemptedAt: Date.now() });
    return;
  }

  const previous = labelSyncAttempts.get(binId);
  if (previous?.signature === signature && Date.now() - previous.attemptedAt < labelSyncRetryMs) return;
  if (!connected) return;

  try {
    await sendBinCommand(binId, "set_label", {
      partId: assignment.part_id,
      name,
      description: assignment.description,
      unitWeightGrams: assignment.unit_weight_grams
    });
    labelSyncAttempts.set(binId, { signature, attemptedAt: Date.now() });
    console.log(`[LABEL SYNC] Sent ${assignment.part_id} / ${name} to ${binId}`);
  } catch (error) {
    console.error(`[LABEL SYNC] Could not update ${binId}:`, error);
  }
}

export async function syncPartLabels(partId: string) {
  for (const assignment of listBinLabelAssignmentsForPart(partId)) {
    labelSyncAttempts.delete(assignment.bin_id);
    if (assignment.online) await syncBinLabel(assignment.bin_id);
  }
}

function parsePayload(buffer: Buffer): JsonRecord | null {
  try {
    const value: unknown = JSON.parse(buffer.toString("utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonRecord)
      : null;
  } catch {
    return null;
  }
}

export function startMqtt() {
  const brokerUrl = process.env.MQTT_URL ?? "mqtt://localhost:1883";
  client = mqtt.connect(brokerUrl, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD_FILE ? readFileSync(process.env.MQTT_PASSWORD_FILE,"utf8").trim() : process.env.MQTT_PASSWORD || undefined,
    clientId: `smartwall-platform-${randomUUID().slice(0, 8)}`,
    clean: true,
    reconnectPeriod: 2_000,
    connectTimeout: 10_000
  });

  client.on("connect", () => {
    connected = true;
    client?.subscribe(
      [
        `${topicRoot}/bins/+/status`,
        `${topicRoot}/bins/+/telemetry`,
        `${topicRoot}/bins/+/acks`,
        `${topicRoot}/bins/+/ota`
      ],
      { qos: 1 },
      (error) => {
        if (error) console.error("[MQTT] Subscribe failed", error.message);
        else console.log(`[MQTT] Connected to ${brokerUrl}`);
      }
    );
    broadcast("broker", { connected: true });
  });

  client.on("reconnect", () => {
    connected = false;
    broadcast("broker", { connected: false, reconnecting: true });
  });
  client.on("close", () => {
    connected = false;
    broadcast("broker", { connected: false });
  });
  client.on("error", (error) => {
    connected = false;
    console.error("[MQTT]", error.message);
  });

  client.on("message", (topic, buffer) => {
    const match = topic.match(/^smartwall\/v1\/bins\/([^/]+)\/(status|telemetry|acks|ota)$/);
    if (!match) return;
    const payload = parsePayload(buffer);
    if (!payload) {
      console.warn(`[MQTT] Ignoring invalid JSON on ${topic}`);
      return;
    }
    const binId = match[1]!;
    const channel = match[2]!;
    if (typeof payload.binId !== "string") payload.binId = binId;
    if (channel === "status") upsertStatus(payload);
    if (channel === "telemetry") {
      upsertTelemetry(payload);
      try { observeIntakes(binId); } catch { console.error("[GOODS IN] Could not update intake measurement"); }
      void syncBinLabel(binId, payload);
    }
    if (channel === "acks") completeCommand(payload);
    if (channel === "ota") upsertOtaStatus(payload);
    if (channel === "status" || channel === "telemetry") notifyBinSeen(binId, payload);
    broadcast(channel, payload);
  });

  return client;
}

function requireClient() {
  if (!client || !connected) throw new Error("MQTT broker is not connected");
  return client;
}

function publish(topic: string, payload: JsonRecord) {
  const mqttClient = requireClient();
  return new Promise<void>((resolve, reject) => {
    mqttClient.publish(topic, JSON.stringify(payload), { qos: 1, retain: false }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function sendBinCommand(binId: string, command: string, fields: JsonRecord = {}) {
  const commandId = randomUUID();
  const payload: JsonRecord = { commandId, command, ...fields };
  await publish(`${topicRoot}/bins/${binId}/commands`, payload);
  recordCommand(commandId, binId, command, payload);
  broadcast("command", { commandId, binId, command, status: "sent" });
  return commandId;
}

export async function sendRemoteGuidance(binId: string, commandId: string,
  fields: { action: "find" | "pick" | "restock"; active: boolean; timeoutSeconds: number }) {
  const payload = { commandId, command: "find", ...fields };
  // Record before publishing so a fast device acknowledgement cannot be lost.
  recordCommand(commandId,binId,"find",payload);
  await publish(`${topicRoot}/bins/${binId}/commands`,payload);
  broadcast("command",{ commandId,binId,command: "find",status: "sent" });
}

export async function sendFleetCommand(command: string, fields: JsonRecord = {}) {
  const commandId = randomUUID();
  const payload: JsonRecord = { commandId, command, ...fields };
  await publish(`${topicRoot}/bins/all/commands`, payload);
  recordCommand(commandId, null, command, payload);
  broadcast("command", { commandId, binId: null, command, status: "sent" });
  return commandId;
}

export function mqttState() {
  return {
    connected,
    brokerUrl: (process.env.MQTT_URL ?? "mqtt://localhost:1883").replace(/:\/\/[^@]+@/, "://")
  };
}
