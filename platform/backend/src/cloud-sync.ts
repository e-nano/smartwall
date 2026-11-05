import { loadConnectionConfig, saveConnectionConfig, type CloudConnectionConfig } from "./cloud-connection-config.js";
import { importCompanyCatalogue, seedGoodsInSync } from "./goods-in.js";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import {
  createDatabaseSnapshot,
  db,
  getAppSetting,
  getCloudSyncPreference,
  listBinSyncHeartbeats,
  listPendingSyncEvents,
  markSyncEventsFailed,
  markSyncEventsSynced,
  pruneSyncedOutbox,
  seedSyncOutbox,
  setAppSetting,
  setCloudSyncPreference,
  syncOutboxSummary
} from "./db.js";

let connection = loadConnectionConfig();
let capabilityEnabled = !!connection || ["1", "true", "yes", "on"].includes(
  (process.env.CLOUD_SYNC_ENABLED ?? "false").toLowerCase()
);
let apiUrl = (connection?.apiUrl ?? process.env.CLOUD_SYNC_API_URL ?? "").replace(/\/$/, "");
let siteId = connection?.siteId ?? process.env.CLOUD_SYNC_SITE_ID ?? "";
let apiToken = connection?.token ?? process.env.CLOUD_SYNC_API_TOKEN ?? "";
const intervalMs = boundedNumber(process.env.CLOUD_SYNC_INTERVAL_MS, 5_000, 1_000, 300_000);
const batchSize = boundedNumber(process.env.CLOUD_SYNC_BATCH_SIZE, 100, 1, 500);
const backupIntervalMs = boundedNumber(
  process.env.CLOUD_BACKUP_INTERVAL_MS,
  24 * 60 * 60_000,
  60_000,
  30 * 24 * 60 * 60_000
);
const requestTimeoutMs = boundedNumber(
  process.env.CLOUD_SYNC_REQUEST_TIMEOUT_MS,
  15_000,
  2_000,
  120_000
);
const heartbeatIntervalMs = boundedNumber(
  process.env.CLOUD_SYNC_HEARTBEAT_MS,
  60_000,
  10_000,
  30 * 60_000
);
const outboxRetentionDays = boundedNumber(
  process.env.CLOUD_SYNC_OUTBOX_RETENTION_DAYS,
  7,
  1,
  365
);

let running = false;
let failures = 0;
let lastAttemptAt: string | null = null;
let lastSuccessAt: string | null = null;
let lastError: string | null = null;
let lastBackupAt: string | null = null;
let lastHeartbeatAt: string | null = null;
let timer: NodeJS.Timeout | undefined;
let runtimeEnabled = false;
let rerunRequested = false;

function boundedNumber(
  configured: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
) {
  const parsed = Number(configured ?? fallback);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function configurationError() {
  if (!capabilityEnabled) return "Cloud sync is disabled in the environment";
  if (!apiUrl.startsWith("https://")) {
    return "CLOUD_SYNC_API_URL must be an https:// URL";
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(siteId)) {
    return "CLOUD_SYNC_SITE_ID must contain 2-64 letters, numbers, underscores or hyphens";
  }
  if (apiToken.length < 32) {
    return "CLOUD_SYNC_API_TOKEN must be at least 32 characters";
  }
  return null;
}

function authorizationHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${apiToken}`,
    ...extra
  };
}

export function remoteCommandConnection() {
  return runtimeEnabled && !configurationError() ? { apiUrl,siteId,token: apiToken } : null;
}

async function syncBatch() {
  // Image attachments make individual events larger. Keep every batch below the cloud body limit.
  let byteCount = 1024;
  const pending: ReturnType<typeof listPendingSyncEvents> = [];
  for (const event of listPendingSyncEvents(batchSize)) {
    const size = Buffer.byteLength(event.payload_json) + 1024;
    if (byteCount + size > 1500000) break;
    byteCount += size;
    pending.push(event);
  }
  if (pending.length === 0) return 0;
  const eventIds = pending.map((event) => event.event_id);
  try {
    const response = await fetch(`${apiUrl}/v1/sync/events`, {
      method: "POST",
      headers: authorizationHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        siteId,
        events: pending.map((event) => ({
          sequence: event.sequence,
          eventId: event.event_id,
          entityType: event.entity_type,
          entityId: event.entity_id,
          operation: event.operation,
          payload: JSON.parse(event.payload_json) as Record<string, unknown>,
          createdAt: event.created_at
        }))
      }),
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
    if (!response.ok) {
      throw new Error(`Cloud sync returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const result = await response.json() as { acceptedEventIds?: unknown };
    if (!Array.isArray(result.acceptedEventIds)) {
      throw new Error("Cloud sync response did not include acceptedEventIds");
    }
    const accepted = [...new Set(result.acceptedEventIds.filter(
      (eventId): eventId is string => typeof eventId === "string" && eventIds.includes(eventId)
    ))];
    if (accepted.length !== eventIds.length) {
      throw new Error(`Cloud sync acknowledged ${accepted.length} of ${eventIds.length} events`);
    }
    markSyncEventsSynced(accepted);
    return accepted.length;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markSyncEventsFailed(eventIds, message);
    throw error;
  }
}

function encryptionKey() {
  const configured = connection?.backupKey ?? process.env.CLOUD_BACKUP_ENCRYPTION_KEY ?? "";
  if (/^[a-fA-F0-9]{64}$/.test(configured)) return Buffer.from(configured, "hex");
  const decoded = Buffer.from(configured, "base64");
  return decoded.length === 32 ? decoded : null;
}

async function uploadDatabaseBackup() {
  const key = encryptionKey();
  if (!key) return;
  const createdAt = new Date().toISOString();
  const dataDir = resolve(process.env.DATA_DIR ?? "./data");
  const snapshotPath = resolve(dataDir, `.smartwall-sync-${randomUUID()}.db`);
  try {
    createDatabaseSnapshot(snapshotPath);
    const plaintext = readFileSync(snapshotPath);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const encrypted = Buffer.concat([
      Buffer.from("SWDB1", "ascii"),
      iv,
      cipher.getAuthTag(),
      ciphertext
    ]);
    const response = await fetch(`${apiUrl}/v1/sync/backups`, {
      method: "POST",
      headers: authorizationHeaders({
        "Content-Type": "application/octet-stream",
        "X-SmartWall-Site": siteId,
        "X-SmartWall-Backup-Created-At": createdAt
      }),
      body: encrypted,
      signal: AbortSignal.timeout(Math.max(requestTimeoutMs, 60_000))
    });
    if (!response.ok) {
      throw new Error(`Cloud backup returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    lastBackupAt = createdAt;
    setAppSetting("cloud_sync_last_backup_at", createdAt);
    console.log(`[CLOUD SYNC] Encrypted SQLite backup uploaded (${encrypted.length} bytes)`);
  } finally {
    try {
      unlinkSync(snapshotPath);
    } catch {
      // The snapshot may not have been created; there is nothing left to clean up.
    }
  }
}

async function sendHeartbeat() {
  const sentAt = new Date().toISOString();
  const outbox = syncOutboxSummary();
  const response = await fetch(`${apiUrl}/v1/sync/heartbeat`, {
    method: "POST",
    headers: authorizationHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      siteId,
      sentAt,
      latestSequence: outbox.latest_sequence ?? 0,
      pendingEvents: outbox.pending ?? 0,
      bins: listBinSyncHeartbeats().map((bin) => ({
        binId: bin.bin_id,
        online: Boolean(bin.online),
        lastSeen: bin.last_seen,
        firmwareVersion: bin.firmware_version
      }))
    }),
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  if (!response.ok) {
    throw new Error(`Cloud heartbeat returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  lastHeartbeatAt = sentAt;
  try {
    const catalogue = await fetch(`${apiUrl}/v1/sites/${encodeURIComponent(siteId)}/goods-in/catalogue`, {
      headers: authorizationHeaders(), signal: AbortSignal.timeout(requestTimeoutMs)
    });
    if (catalogue.ok) importCompanyCatalogue(await catalogue.json(), siteId);
    else if (catalogue.status !== 404) console.warn("[GOODS IN] Company catalogue download unavailable; local mappings remain usable");
  } catch { console.warn("[GOODS IN] Company catalogue download failed; local mappings remain usable"); }

}

function backupIsDue() {
  return !lastBackupAt || Date.now() - Date.parse(lastBackupAt) >= backupIntervalMs;
}

function heartbeatIsDue() {
  return !lastHeartbeatAt || Date.now() - Date.parse(lastHeartbeatAt) >= heartbeatIntervalMs;
}

function schedule(delayMs: number) {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!runtimeEnabled || configurationError()) return;
  timer = setTimeout(() => void runOnce(), delayMs);
  timer.unref();
}

async function runOnce() {
  if (running || !runtimeEnabled || configurationError()) return;
  running = true;
  lastAttemptAt = new Date().toISOString();
  try {
    let synchronized = 0;
    do {
      synchronized = await syncBatch();
    } while (runtimeEnabled && synchronized === batchSize);
    if (!runtimeEnabled) return;
    if (heartbeatIsDue()) await sendHeartbeat();
    if (backupIsDue()) await uploadDatabaseBackup();
    pruneSyncedOutbox(outboxRetentionDays);
    failures = 0;
    lastError = null;
    lastSuccessAt = new Date().toISOString();
    schedule(intervalMs);
  } catch (error) {
    failures += 1;
    lastError = error instanceof Error ? error.message : String(error);
    const retryMs = Math.min(5 * 60_000, intervalMs * 2 ** Math.min(failures, 6));
    console.warn(`[CLOUD SYNC] ${lastError}; retrying in ${Math.round(retryMs / 1000)}s`);
    schedule(retryMs);
  } finally {
    running = false;
    if (runtimeEnabled && rerunRequested) {
      rerunRequested = false;
      schedule(0);
    }
  }
}

export function startCloudSync() {
  if (!capabilityEnabled) {
    console.log("[CLOUD SYNC] Disabled; local SQLite remains authoritative");
    return;
  }
  const issue = configurationError();
  if (issue) {
    lastError = issue;
    console.warn(`[CLOUD SYNC] ${issue}; configure the environment before enabling sync`);
    return;
  }
  runtimeEnabled = getCloudSyncPreference(true);
  lastBackupAt = getAppSetting("cloud_sync_last_backup_at");
  if (!encryptionKey()) {
    console.warn("[CLOUD SYNC] CLOUD_BACKUP_ENCRYPTION_KEY is invalid; database backups are disabled");
  }
  if (!runtimeEnabled) {
    console.log("[CLOUD SYNC] Paused from the local platform; changes remain queued");
    return;
  }
  seedSyncOutbox();
  console.log(`[CLOUD SYNC] Mirroring site ${siteId} to ${apiUrl}`);
  schedule(0);
}

export function setCloudSyncEnabled(enabled: boolean) {
  if (enabled) {
    const issue = configurationError();
    if (issue) throw new Error(issue);
  }
  setCloudSyncPreference(enabled);
  runtimeEnabled = enabled;
  if (!enabled) {
    if (timer) clearTimeout(timer);
    timer = undefined;
    rerunRequested = false;
    console.log("[CLOUD SYNC] Paused from the local platform; changes remain queued");
    return cloudSyncState();
  }
  seedSyncOutbox();
  failures = 0;
  lastError = null;
  console.log(`[CLOUD SYNC] Enabled from the local platform for site ${siteId}`);
  if (running) rerunRequested = true;
  else schedule(0);
  return cloudSyncState();
}

export function requestCloudSyncNow() {
  if (!runtimeEnabled) throw new Error("Cloud sync is paused");
  const issue = configurationError();
  if (issue) throw new Error(issue);
  lastHeartbeatAt = null;
  if (running) rerunRequested = true;
  else schedule(0);
  return cloudSyncState();
}

export function cloudSyncState() {
  const outbox = syncOutboxSummary();
  const issue = configurationError();
  return {
    available: capabilityEnabled && issue === null,
    masterEnabled: capabilityEnabled,
    enabled: runtimeEnabled,
    configured: issue === null,
    configurationError: issue,
    backupConfigured: encryptionKey() !== null,
    siteId: siteId || null,
    companyName: connection?.companyName ?? null,
    wallName: connection?.wallName ?? null,
    running,
    pending: outbox.pending ?? 0,
    latestSequence: outbox.latest_sequence ?? 0,
    lastAttemptAt,
    lastSuccessAt: lastSuccessAt ?? outbox.last_synced_at,
    lastBackupAt,
    lastHeartbeatAt,
    lastError
  };
}


export function cloudConnectionTarget() {
  return {apiUrl: apiUrl || (process.env.CLOUD_PORTAL_URL ?? "https://smartwall.e-nano.io"),siteId,companyId:connection?.companyId ?? null};
}

export async function installCloudConnection(value:Omit<CloudConnectionConfig,'backupKey'>) {
  const previousEnabled=runtimeEnabled;
  runtimeEnabled=false;
  if(timer) clearTimeout(timer);
  timer=undefined;
  const deadline=Date.now()+requestTimeoutMs*4;
  while(running && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,100));
  if(running) {runtimeEnabled=previousEnabled;throw new Error("Sync is still busy. Try connecting again shortly.");}
  try {
    const backupKey=(encryptionKey() ?? randomBytes(32)).toString('hex');
    const next={...value,backupKey};
    saveConnectionConfig(next);
    if(siteId!==next.siteId){
      db.prepare("DELETE FROM app_settings WHERE setting_key IN ('cloud_sync_seed_version','cloud_sync_last_backup_at')").run();
      lastBackupAt=null;seedGoodsInSync();
    }
    connection=next;capabilityEnabled=true;apiUrl=next.apiUrl;siteId=next.siteId;apiToken=next.token;
    lastHeartbeatAt=null;lastError=null;
    return setCloudSyncEnabled(true);
  }catch(error){runtimeEnabled=previousEnabled;if(runtimeEnabled)schedule(0);throw error;}
}
