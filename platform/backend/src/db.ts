import { migrateReleases } from "./release-migration.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type JsonRecord = Record<string, unknown>;

export type FirmwareRecord = {
  firmware_id: string;
  hardware_target: string | null;
  partition_layout: string | null;
  signature: string | null;
  version: string;
  stored_name: string;
  original_name: string;
  sha256: string;
  size_bytes: number;
  source: string;
  created_at: string;
};

const dataDir = resolve(process.env.DATA_DIR ?? "./data");
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(resolve(dataDir, "smartwall.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS parts (
    part_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Other',
    subcategory TEXT NOT NULL DEFAULT 'Other',
    head_type TEXT NOT NULL DEFAULT 'Not applicable',
    measurement_system TEXT NOT NULL DEFAULT 'Not applicable',
    nominal_diameter TEXT NOT NULL DEFAULT 'Not applicable',
    nominal_length TEXT NOT NULL DEFAULT 'Not applicable',
    accu_product_code TEXT NOT NULL DEFAULT '',
    accu_order_quantity INTEGER NOT NULL DEFAULT 0 CHECK (accu_order_quantity >= 0),
    unit_weight_grams REAL NOT NULL CHECK (unit_weight_grams > 0),
    weight_calibrated INTEGER NOT NULL DEFAULT 0,
    weight_calibrated_at TEXT,
    reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bins (
    bin_id TEXT PRIMARY KEY,
    online INTEGER NOT NULL DEFAULT 0,
    last_seen TEXT,
    firmware_version TEXT,
    device_state TEXT,
    ip_address TEXT,
    rssi INTEGER,
    part_id TEXT REFERENCES parts(part_id) ON DELETE SET NULL,
    net_weight_grams REAL,
    estimated_quantity INTEGER,
    measurement_stable INTEGER NOT NULL DEFAULT 0,
    measurement_noise_counts REAL,
    telemetry_json TEXT
  );

  CREATE TABLE IF NOT EXISTS inventory_events (
    event_id TEXT PRIMARY KEY,
    bin_id TEXT NOT NULL REFERENCES bins(bin_id) ON DELETE CASCADE,
    part_id TEXT,
    event_type TEXT NOT NULL,
    quantity_delta INTEGER NOT NULL,
    previous_quantity INTEGER,
    new_quantity INTEGER,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS commands (
    command_id TEXT PRIMARY KEY,
    bin_id TEXT,
    command_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS firmware (
    firmware_id TEXT PRIMARY KEY,
    version TEXT NOT NULL UNIQUE,
    stored_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'upload',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ota_status (
    command_id TEXT NOT NULL,
    bin_id TEXT NOT NULL,
    firmware_id TEXT,
    state TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (command_id, bin_id)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS automatic_ota_deployments (
    firmware_id TEXT NOT NULL REFERENCES firmware(firmware_id) ON DELETE CASCADE,
    bin_id TEXT NOT NULL,
    command_id TEXT,
    state TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    last_attempt_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (firmware_id, bin_id)
  );

  CREATE TABLE IF NOT EXISTS sync_outbox (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    synced_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_bins_part_id ON bins(part_id);
  CREATE INDEX IF NOT EXISTS idx_bins_last_seen ON bins(last_seen);
  CREATE INDEX IF NOT EXISTS idx_inventory_events_created_at ON inventory_events(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_commands_created_at ON commands(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ota_status_updated_at ON ota_status(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_auto_ota_command ON automatic_ota_deployments(command_id);
  CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending
    ON sync_outbox(synced_at, sequence);
`);

// Existing development databases predate the source column. SQLite does not
// support ADD COLUMN IF NOT EXISTS, so inspect before applying the migration.
const firmwareColumns = db.prepare(`PRAGMA table_info(firmware)`).all() as Array<{ name: string }>;
if (!firmwareColumns.some((column) => column.name === "source")) {
  db.exec(`ALTER TABLE firmware ADD COLUMN source TEXT NOT NULL DEFAULT 'upload'`);
}
migrateReleases(db);

const automaticDeploymentColumns = db.prepare(
  `PRAGMA table_info(automatic_ota_deployments)`
).all() as Array<{ name: string }>;
if (!automaticDeploymentColumns.some((column) => column.name === "message")) {
  db.exec(`ALTER TABLE automatic_ota_deployments ADD COLUMN message TEXT`);
}
const partColumns = db.prepare(`PRAGMA table_info(parts)`).all() as Array<{ name: string }>;
// Existing parts already had manually entered weights, so migrations mark them learned.
if (!partColumns.some((column) => column.name === "weight_calibrated")) {
  db.exec(`ALTER TABLE parts ADD COLUMN weight_calibrated INTEGER NOT NULL DEFAULT 1`);
}
if (!partColumns.some((column) => column.name === "weight_calibrated_at")) {
  db.exec(`ALTER TABLE parts ADD COLUMN weight_calibrated_at TEXT`);
}
if (!partColumns.some((column) => column.name === "category")) {
  db.exec(`ALTER TABLE parts ADD COLUMN category TEXT NOT NULL DEFAULT 'Other'`);
}
if (!partColumns.some((column) => column.name === "subcategory")) {
  db.exec(`ALTER TABLE parts ADD COLUMN subcategory TEXT NOT NULL DEFAULT 'Other'`);
}
if (!partColumns.some((column) => column.name === "head_type")) {
  db.exec(`ALTER TABLE parts ADD COLUMN head_type TEXT NOT NULL DEFAULT 'Not applicable'`);
}
if (!partColumns.some((column) => column.name === "measurement_system")) {
  db.exec(`ALTER TABLE parts ADD COLUMN measurement_system TEXT NOT NULL DEFAULT 'Not applicable'`);
}
if (!partColumns.some((column) => column.name === "nominal_diameter")) {
  db.exec(`ALTER TABLE parts ADD COLUMN nominal_diameter TEXT NOT NULL DEFAULT 'Not applicable'`);
}
if (!partColumns.some((column) => column.name === "nominal_length")) {
  db.exec(`ALTER TABLE parts ADD COLUMN nominal_length TEXT NOT NULL DEFAULT 'Not applicable'`);
}
if (!partColumns.some((column) => column.name === "accu_product_code")) {
  db.exec(`ALTER TABLE parts ADD COLUMN accu_product_code TEXT NOT NULL DEFAULT ''`);
}
if (!partColumns.some((column) => column.name === "accu_order_quantity")) {
  db.exec(`ALTER TABLE parts ADD COLUMN accu_order_quantity INTEGER NOT NULL DEFAULT 0`);
}

for (const field of ["images_json", "source_supplier", "source_product_code", "source_url"]) {
  if (!partColumns.some(column => column.name === field)) {
    db.exec(`ALTER TABLE parts ADD COLUMN ${field} TEXT NOT NULL DEFAULT '${field === "images_json" ? "[]" : ""}'`);
  }
}
if (!partColumns.some(column => column.name === "category_path_json")) {
  db.exec("ALTER TABLE parts ADD COLUMN category_path_json TEXT NOT NULL DEFAULT '[]'");
  db.exec("UPDATE parts SET category_path_json=json_array(category,subcategory)");
}
// Replace old trigger definitions so upgraded stations also mirror attachments.
db.exec("DROP TRIGGER IF EXISTS sync_parts_insert; DROP TRIGGER IF EXISTS sync_parts_update;");

// The cloud mirror is fed by an immutable transactional outbox. Triggers are
// used so a local write and its sync event either both commit or neither does.
// Bin events intentionally exclude raw/unstable measurements and last_seen
// heartbeats to keep the offline queue bounded.
db.exec(`
  CREATE TRIGGER IF NOT EXISTS sync_parts_insert
  AFTER INSERT ON parts
  BEGIN
    INSERT INTO sync_outbox (
      event_id, entity_type, entity_id, operation, payload_json, created_at
    ) VALUES (
      lower(hex(randomblob(16))), 'part', NEW.part_id, 'upsert',
      json_object(
        'part_id', NEW.part_id,
        'name', NEW.name,
        'description', NEW.description,
        'images_json', NEW.images_json, 'source_supplier', NEW.source_supplier,
        'source_product_code', NEW.source_product_code, 'source_url', NEW.source_url,
        'category_path_json', NEW.category_path_json,
        'category', NEW.category,
        'subcategory', NEW.subcategory,
        'head_type', NEW.head_type,
        'measurement_system', NEW.measurement_system,
        'nominal_diameter', NEW.nominal_diameter,
        'nominal_length', NEW.nominal_length,
        'accu_product_code', NEW.accu_product_code,
        'accu_order_quantity', NEW.accu_order_quantity,
        'unit_weight_grams', NEW.unit_weight_grams,
        'weight_calibrated', NEW.weight_calibrated,
        'weight_calibrated_at', NEW.weight_calibrated_at,
        'reorder_level', NEW.reorder_level,
        'created_at', NEW.created_at
      ), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS sync_parts_update
  AFTER UPDATE ON parts
  BEGIN
    INSERT INTO sync_outbox (
      event_id, entity_type, entity_id, operation, payload_json, created_at
    ) VALUES (
      lower(hex(randomblob(16))), 'part', NEW.part_id, 'upsert',
      json_object(
        'part_id', NEW.part_id,
        'name', NEW.name,
        'description', NEW.description,
        'images_json', NEW.images_json, 'source_supplier', NEW.source_supplier,
        'source_product_code', NEW.source_product_code, 'source_url', NEW.source_url,
        'category_path_json', NEW.category_path_json,
        'category', NEW.category,
        'subcategory', NEW.subcategory,
        'head_type', NEW.head_type,
        'measurement_system', NEW.measurement_system,
        'nominal_diameter', NEW.nominal_diameter,
        'nominal_length', NEW.nominal_length,
        'accu_product_code', NEW.accu_product_code,
        'accu_order_quantity', NEW.accu_order_quantity,
        'unit_weight_grams', NEW.unit_weight_grams,
        'weight_calibrated', NEW.weight_calibrated,
        'weight_calibrated_at', NEW.weight_calibrated_at,
        'reorder_level', NEW.reorder_level,
        'created_at', NEW.created_at
      ), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS sync_bins_insert
  AFTER INSERT ON bins
  BEGIN
    INSERT INTO sync_outbox (
      event_id, entity_type, entity_id, operation, payload_json, created_at
    ) VALUES (
      lower(hex(randomblob(16))), 'bin', NEW.bin_id, 'upsert',
      json_object(
        'bin_id', NEW.bin_id,
        'online', NEW.online,
        'last_seen', NEW.last_seen,
        'firmware_version', NEW.firmware_version,
        'device_state', NEW.device_state,
        'ip_address', NEW.ip_address,
        'rssi', NEW.rssi,
        'part_id', NEW.part_id,
        'net_weight_grams', NEW.net_weight_grams,
        'estimated_quantity', NEW.estimated_quantity,
        'measurement_stable', NEW.measurement_stable,
        'measurement_noise_counts', NEW.measurement_noise_counts
      ), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS sync_bins_meaningful_update
  AFTER UPDATE ON bins
  WHEN OLD.online IS NOT NEW.online
    OR OLD.firmware_version IS NOT NEW.firmware_version
    OR OLD.device_state IS NOT NEW.device_state
    OR OLD.part_id IS NOT NEW.part_id
    OR OLD.estimated_quantity IS NOT NEW.estimated_quantity
  BEGIN
    INSERT INTO sync_outbox (
      event_id, entity_type, entity_id, operation, payload_json, created_at
    ) VALUES (
      lower(hex(randomblob(16))), 'bin', NEW.bin_id, 'upsert',
      json_object(
        'bin_id', NEW.bin_id,
        'online', NEW.online,
        'last_seen', NEW.last_seen,
        'firmware_version', NEW.firmware_version,
        'device_state', NEW.device_state,
        'ip_address', NEW.ip_address,
        'rssi', NEW.rssi,
        'part_id', NEW.part_id,
        'net_weight_grams', NEW.net_weight_grams,
        'estimated_quantity', NEW.estimated_quantity,
        'measurement_stable', NEW.measurement_stable,
        'measurement_noise_counts', NEW.measurement_noise_counts
      ), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS sync_inventory_events_insert
  AFTER INSERT ON inventory_events
  BEGIN
    INSERT INTO sync_outbox (
      event_id, entity_type, entity_id, operation, payload_json, created_at
    ) VALUES (
      lower(hex(randomblob(16))), 'inventory_event', NEW.event_id, 'upsert',
      json_object(
        'event_id', NEW.event_id,
        'bin_id', NEW.bin_id,
        'part_id', NEW.part_id,
        'event_type', NEW.event_type,
        'quantity_delta', NEW.quantity_delta,
        'previous_quantity', NEW.previous_quantity,
        'new_quantity', NEW.new_quantity,
        'source', NEW.source,
        'created_at', NEW.created_at
      ), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );
  END;

  CREATE TRIGGER IF NOT EXISTS sync_firmware_insert
  AFTER INSERT ON firmware
  BEGIN
    INSERT INTO sync_outbox (
      event_id, entity_type, entity_id, operation, payload_json, created_at
    ) VALUES (
      lower(hex(randomblob(16))), 'firmware', NEW.firmware_id, 'upsert',
      json_object(
        'firmware_id', NEW.firmware_id,
        'version', NEW.version,
        'original_name', NEW.original_name,
        'sha256', NEW.sha256,
        'size_bytes', NEW.size_bytes,
        'source', NEW.source,
        'created_at', NEW.created_at
      ), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );
  END;
`);
db.exec("PRAGMA optimize");

const nowIso = () => new Date().toISOString();
const asNullableNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const asNullableString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

function withImmediateTransaction<T>(work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getAppSetting(settingKey: string) {
  const row = db.prepare(`
    SELECT setting_value FROM app_settings WHERE setting_key = ?
  `).get(settingKey) as { setting_value: string } | undefined;
  return row?.setting_value ?? null;
}

export function setAppSetting(settingKey: string, settingValue: string) {
  db.prepare(`
    INSERT INTO app_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_value = excluded.setting_value,
      updated_at = excluded.updated_at
  `).run(settingKey, settingValue, nowIso());
}

export function getCloudSyncPreference(defaultEnabled: boolean) {
  const stored = getAppSetting("cloud_sync_enabled");
  if (stored !== null) return stored === "1";
  setAppSetting("cloud_sync_enabled", defaultEnabled ? "1" : "0");
  return defaultEnabled;
}

export function setCloudSyncPreference(enabled: boolean) {
  setAppSetting("cloud_sync_enabled", enabled ? "1" : "0");
}

export type SyncOutboxEvent = {
  sequence: number;
  event_id: string;
  entity_type: "part" | "bin" | "inventory_event" | "firmware" | "goods_in";
  entity_id: string;
  operation: "upsert";
  payload_json: string;
  created_at: string;
  attempts: number;
};

export function seedSyncOutbox() {
  const seeded = db.prepare(`
    SELECT setting_value FROM app_settings WHERE setting_key = 'cloud_sync_seed_version'
  `).get() as { setting_value: string } | undefined;
  if (seeded?.setting_value === "1") return;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      INSERT INTO sync_outbox (event_id, entity_type, entity_id, operation, payload_json, created_at)
      SELECT lower(hex(randomblob(16))), 'part', part_id, 'upsert', json_object(
        'part_id', part_id, 'name', name, 'description', description,
        'images_json', images_json, 'source_supplier', source_supplier, 'source_product_code', source_product_code, 'source_url', source_url,
        'category_path_json', category_path_json, 'category', category, 'subcategory', subcategory, 'head_type', head_type,
        'measurement_system', measurement_system, 'nominal_diameter', nominal_diameter,
        'nominal_length', nominal_length, 'accu_product_code', accu_product_code,
        'accu_order_quantity', accu_order_quantity, 'unit_weight_grams', unit_weight_grams,
        'weight_calibrated', weight_calibrated, 'weight_calibrated_at', weight_calibrated_at,
        'reorder_level', reorder_level, 'created_at', created_at
      ), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM parts;

      INSERT INTO sync_outbox (event_id, entity_type, entity_id, operation, payload_json, created_at)
      SELECT lower(hex(randomblob(16))), 'bin', bin_id, 'upsert', json_object(
        'bin_id', bin_id, 'online', online, 'last_seen', last_seen,
        'firmware_version', firmware_version, 'device_state', device_state,
        'ip_address', ip_address, 'rssi', rssi, 'part_id', part_id,
        'net_weight_grams', net_weight_grams, 'estimated_quantity', estimated_quantity,
        'measurement_stable', measurement_stable,
        'measurement_noise_counts', measurement_noise_counts
      ), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM bins;

      INSERT INTO sync_outbox (event_id, entity_type, entity_id, operation, payload_json, created_at)
      SELECT lower(hex(randomblob(16))), 'inventory_event', event_id, 'upsert', json_object(
        'event_id', event_id, 'bin_id', bin_id, 'part_id', part_id,
        'event_type', event_type, 'quantity_delta', quantity_delta,
        'previous_quantity', previous_quantity, 'new_quantity', new_quantity,
        'source', source, 'created_at', created_at
      ), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM inventory_events;

      INSERT INTO sync_outbox (event_id, entity_type, entity_id, operation, payload_json, created_at)
      SELECT lower(hex(randomblob(16))), 'firmware', firmware_id, 'upsert', json_object(
        'firmware_id', firmware_id, 'version', version, 'original_name', original_name,
        'sha256', sha256, 'size_bytes', size_bytes, 'source', source,
        'created_at', created_at
      ), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM firmware;

      INSERT INTO app_settings (setting_key, setting_value, updated_at)
      VALUES ('cloud_sync_seed_version', '1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_at = excluded.updated_at;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listPendingSyncEvents(limit: number) {
  return db.prepare(`
    SELECT sequence, event_id, entity_type, entity_id, operation,
           payload_json, created_at, attempts
    FROM sync_outbox
    WHERE synced_at IS NULL
    ORDER BY sequence
    LIMIT ?
  `).all(limit) as SyncOutboxEvent[];
}

export function markSyncEventsSynced(eventIds: string[]) {
  if (eventIds.length === 0) return;
  const placeholders = eventIds.map(() => "?").join(", ");
  db.prepare(`
    UPDATE sync_outbox
    SET synced_at = ?, last_error = NULL
    WHERE event_id IN (${placeholders})
  `).run(nowIso(), ...eventIds);
}

export function markSyncEventsFailed(eventIds: string[], message: string) {
  if (eventIds.length === 0) return;
  const placeholders = eventIds.map(() => "?").join(", ");
  db.prepare(`
    UPDATE sync_outbox
    SET attempts = attempts + 1, last_error = ?
    WHERE event_id IN (${placeholders})
  `).run(message.slice(0, 1000), ...eventIds);
}

export function syncOutboxSummary() {
  return db.prepare(`
    SELECT
      SUM(CASE WHEN synced_at IS NULL THEN 1 ELSE 0 END) AS pending,
      MAX(synced_at) AS last_synced_at,
      MAX(sequence) AS latest_sequence
    FROM sync_outbox
  `).get() as {
    pending: number | null;
    last_synced_at: string | null;
    latest_sequence: number | null;
  };
}

export function listBinSyncHeartbeats() {
  return db.prepare(`
    SELECT bin_id, online, last_seen, firmware_version
    FROM bins
    ORDER BY bin_id
  `).all() as Array<{
    bin_id: string;
    online: number;
    last_seen: string | null;
    firmware_version: string | null;
  }>;
}

export function pruneSyncedOutbox(retentionDays: number) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60_000).toISOString();
  return Number(db.prepare(`
    DELETE FROM sync_outbox
    WHERE synced_at IS NOT NULL AND synced_at < ?
  `).run(cutoff).changes);
}

export function createDatabaseSnapshot(destinationPath: string) {
  db.prepare("VACUUM INTO ?").run(destinationPath);
}

export function listBins() {
  return db.prepare(`
    SELECT b.*, p.name AS part_name, p.description AS part_description,
           p.category AS part_category, p.subcategory AS part_subcategory,
           p.head_type AS part_head_type,
           p.measurement_system AS part_measurement_system,
           p.nominal_diameter AS part_nominal_diameter,
           p.nominal_length AS part_nominal_length,
           p.unit_weight_grams, p.reorder_level,
           CASE
             WHEN b.part_id IS NOT NULL AND b.estimated_quantity IS NOT NULL
              AND b.estimated_quantity <= p.reorder_level THEN 1 ELSE 0
           END AS low_stock
    FROM bins b
    LEFT JOIN parts p ON p.part_id = b.part_id
    ORDER BY b.online DESC, COALESCE(p.name, b.bin_id), b.bin_id
  `).all();
}

export function listParts() {
  return db.prepare(`
    SELECT p.*, COUNT(b.bin_id) AS bin_count,
           COALESCE(SUM(b.estimated_quantity), 0) AS total_quantity
    FROM parts p
    LEFT JOIN bins b ON b.part_id = p.part_id
    GROUP BY p.part_id
    ORDER BY p.name
  `).all();
}

export function listEvents(limit = 30) {
  return db.prepare(`
    SELECT e.*, p.name AS part_name
    FROM inventory_events e
    LEFT JOIN parts p ON p.part_id = e.part_id
    ORDER BY e.created_at DESC
    LIMIT ?
  `).all(limit);
}

export function listEventsSince(since: string, limit = 5000) {
  return db.prepare(`
    SELECT e.*, p.name AS part_name
    FROM inventory_events e
    LEFT JOIN parts p ON p.part_id = e.part_id
    WHERE e.created_at >= ?
    ORDER BY e.created_at DESC
    LIMIT ?
  `).all(since, limit);
}

export function listCommands(limit = 40) {
  return db.prepare(`
    SELECT * FROM commands ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

export function listFirmware() {
  return db.prepare(`SELECT * FROM firmware ORDER BY created_at DESC`).all();
}

export function listOnlineBins() {
  return db.prepare(`
    SELECT bin_id, firmware_version, hardware_target, partition_layout FROM bins WHERE online = 1 ORDER BY bin_id
  `).all() as Array<{ bin_id: string; firmware_version: string | null; hardware_target: string | null; partition_layout: string | null }>;
}

export type BinLabelAssignment = {
  bin_id: string;
  online: number;
  part_id: string;
  name: string;
  description: string;
  unit_weight_grams: number;
};

export function getBinLabelAssignment(binId: string) {
  return db.prepare(`
    SELECT b.bin_id, b.online, p.part_id, p.name, p.description, p.unit_weight_grams
    FROM bins b
    JOIN parts p ON p.part_id = b.part_id
    WHERE b.bin_id = ?
  `).get(binId) as BinLabelAssignment | undefined;
}

export function listBinLabelAssignmentsForPart(partId: string) {
  return db.prepare(`
    SELECT b.bin_id, b.online, p.part_id, p.name, p.description, p.unit_weight_grams
    FROM bins b
    JOIN parts p ON p.part_id = b.part_id
    WHERE p.part_id = ?
    ORDER BY b.bin_id
  `).all(partId) as BinLabelAssignment[];
}

export function listOtaStatus(limit = 100) {
  return db.prepare(`
    SELECT * FROM ota_status ORDER BY updated_at DESC LIMIT ?
  `).all(limit);
}

export function listAutomaticDeployments(limit = 100) {
  return db.prepare(`
    SELECT d.*, f.version
    FROM automatic_ota_deployments d
    JOIN firmware f ON f.firmware_id = d.firmware_id
    ORDER BY d.updated_at DESC
    LIMIT ?
  `).all(limit);
}

export function dashboard() {
  const bins = listBins();
  const summary = db.prepare(`
    SELECT COUNT(*) AS total_bins,
           SUM(CASE WHEN online = 1 THEN 1 ELSE 0 END) AS online_bins,
           SUM(CASE WHEN online = 0 THEN 1 ELSE 0 END) AS offline_bins,
           SUM(CASE WHEN part_id IS NULL THEN 1 ELSE 0 END) AS unassigned_bins
    FROM bins
  `).get();
  const lowStock = db.prepare(`
    SELECT COUNT(*) AS count
    FROM bins b JOIN parts p ON p.part_id = b.part_id
    WHERE b.estimated_quantity IS NOT NULL
      AND b.estimated_quantity <= p.reorder_level
  `).get() as { count: number };
  const counts = summary as { total_bins: number; online_bins: number | null; offline_bins: number | null; unassigned_bins: number | null };
  return {
    summary: {
      total_bins: counts.total_bins ?? 0,
      online_bins: counts.online_bins ?? 0,
      offline_bins: counts.offline_bins ?? 0,
      unassigned_bins: counts.unassigned_bins ?? 0,
      low_stock_bins: lowStock.count ?? 0
    },
    bins,
    parts: listParts(),
    events: listEvents(100),
    commands: listCommands(20),
    firmware: listFirmware(),
    ota: listOtaStatus(),
    automaticDeployments: listAutomaticDeployments()
  };
}

function storeHardware(payload: JsonRecord) {
  if (typeof payload.hardwareTarget !== "string" || typeof payload.partitionLayout !== "string") return;
  db.prepare("UPDATE bins SET hardware_target=?, partition_layout=?, telemetry_json=json_set(COALESCE(telemetry_json,'{}'),'$.bootValidated',?) WHERE bin_id=?")
    .run(payload.hardwareTarget, payload.partitionLayout, payload.bootValidated === true ? 1 : 0, String(payload.binId));
}

export function getBinHardware(binId: string) {
  return db.prepare("SELECT hardware_target, partition_layout, json_extract(telemetry_json,'$.bootValidated') AS boot_validated FROM bins WHERE bin_id=?").get(binId) as
    { hardware_target: string | null; partition_layout: string | null; boot_validated: number | null } | undefined;
}

export function upsertStatus(payload: JsonRecord) {
  const binId = asNullableString(payload.binId);
  if (!binId) return;
  db.prepare(`
    INSERT INTO bins (bin_id, online, last_seen, firmware_version, ip_address)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(bin_id) DO UPDATE SET
      online = excluded.online,
      last_seen = excluded.last_seen,
      firmware_version = COALESCE(excluded.firmware_version, bins.firmware_version),
      ip_address = COALESCE(excluded.ip_address, bins.ip_address)
  `).run(
    binId,
    payload.online === true ? 1 : 0,
    nowIso(),
    asNullableString(payload.firmwareVersion),
    asNullableString(payload.ipAddress)
  );
  storeHardware(payload);
}

export function upsertTelemetry(payload: JsonRecord) {
  const binId = asNullableString(payload.binId);
  if (!binId) return null;
  return withImmediateTransaction(() => {
    const previous = db.prepare(`
      SELECT part_id, estimated_quantity, measurement_stable FROM bins WHERE bin_id = ?
    `).get(binId) as
      | { part_id: string | null; estimated_quantity: number | null; measurement_stable: number }
      | undefined;
    let quantity = asNullableNumber(payload.estimatedQuantity);
    const reportedPartId = asNullableString(payload.partId);
    const knownPartId = reportedPartId && db.prepare(`SELECT 1 FROM parts WHERE part_id = ?`).get(reportedPartId)
      ? reportedPartId
      : null;
    const effectivePartId = knownPartId ?? previous?.part_id;
    if (effectivePartId) {
      const calibration = db.prepare("SELECT weight_calibrated FROM parts WHERE part_id = ?").get(effectivePartId) as { weight_calibrated: number } | undefined;
      if (!calibration?.weight_calibrated) quantity = null;
    }
    const stable = payload.measurementStable === true;
    const seenAt = nowIso();

    db.prepare(`
      INSERT INTO bins (
        bin_id, online, last_seen, firmware_version, device_state, ip_address, rssi,
        part_id, net_weight_grams, estimated_quantity, measurement_stable,
        measurement_noise_counts, telemetry_json
      ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bin_id) DO UPDATE SET
        online = 1,
        last_seen = excluded.last_seen,
        firmware_version = excluded.firmware_version,
        device_state = excluded.device_state,
        ip_address = excluded.ip_address,
        rssi = excluded.rssi,
        part_id = COALESCE(excluded.part_id, bins.part_id),
        net_weight_grams = excluded.net_weight_grams,
        estimated_quantity = CASE
          WHEN excluded.measurement_stable = 1 AND excluded.estimated_quantity IS NOT NULL
            THEN excluded.estimated_quantity
          ELSE bins.estimated_quantity
        END,
        measurement_stable = excluded.measurement_stable,
        measurement_noise_counts = excluded.measurement_noise_counts,
        telemetry_json = excluded.telemetry_json
    `).run(
      binId,
      seenAt,
      asNullableString(payload.firmwareVersion),
      asNullableString(payload.deviceState),
      asNullableString(payload.ipAddress),
      asNullableNumber(payload.rssi),
      knownPartId,
      asNullableNumber(payload.netWeightGrams),
      quantity,
      stable ? 1 : 0,
      asNullableNumber(payload.measurementNoiseCounts),
      JSON.stringify(payload)
    );
    storeHardware(payload);

    if (
      stable &&
      previous !== undefined &&
      previous.estimated_quantity !== null &&
      quantity !== null &&
      previous.estimated_quantity !== quantity
    ) {
      const delta = quantity - previous.estimated_quantity;
      db.prepare(`
        INSERT INTO inventory_events (
          event_id, bin_id, part_id, event_type, quantity_delta,
          previous_quantity, new_quantity, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'load_cell', ?)
      `).run(
        randomUUID(),
        binId,
        previous.part_id,
        delta > 0 ? "observed_restock" : "observed_pick",
        delta,
        previous.estimated_quantity,
        quantity,
        seenAt
      );
      return { binId, delta, quantity };
    }
    return null;
  });
}

export function createPart(input: {
  partId: string;
  name: string;
  description: string;
  category: string;
  subcategory: string;
  categoryPath?: string[];
  headType: string;
  measurementSystem: string;
  nominalDiameter: string;
  nominalLength: string;
  accuProductCode: string;
  accuOrderQuantity: number;
  unitWeightGrams?: number;
  images?: string[]; sourceSupplier?: string; sourceProductCode?: string; sourceUrl?: string;
  reorderLevel: number;
}) {
  const categoryPath=input.categoryPath ?? [input.category,input.subcategory];
  const calibrated = input.unitWeightGrams !== undefined;
  db.prepare(`
    INSERT INTO parts (
      part_id, name, description, category, subcategory, head_type,
      measurement_system, nominal_diameter, nominal_length,
      accu_product_code, accu_order_quantity, unit_weight_grams,
      weight_calibrated, weight_calibrated_at, reorder_level, created_at,
      images_json, source_supplier, source_product_code, source_url, category_path_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.partId,
    input.name,
    input.description,
    categoryPath[0]!,
    categoryPath[1] ?? "Other",
    input.headType,
    input.measurementSystem,
    input.nominalDiameter,
    input.nominalLength,
    input.accuProductCode,
    input.accuOrderQuantity,
    input.unitWeightGrams ?? 1.0,
    calibrated ? 1 : 0,
    calibrated ? nowIso() : null,
    input.reorderLevel,
    nowIso(), JSON.stringify(input.images ?? []), input.sourceSupplier ?? "", input.sourceProductCode ?? "", input.sourceUrl ?? "", JSON.stringify(categoryPath)
  );
  return db.prepare(`SELECT * FROM parts WHERE part_id = ?`).get(input.partId);
}

export function updatePartClassification(
  partId: string,
  name: string,
  category: string,
  subcategory: string,
  headType: string,
  measurementSystem: string,
  nominalDiameter: string,
  nominalLength: string,
  accuProductCode: string,
  accuOrderQuantity: number,
  categoryPath?: string[]
) {
  const previous=db.prepare("SELECT category,subcategory,category_path_json FROM parts WHERE part_id=?").get(partId) as {category:string;subcategory:string;category_path_json:string}|undefined;
  const path=categoryPath ?? (previous?.category===category && previous.subcategory===subcategory
    ? JSON.parse(previous.category_path_json) as string[] : [category,subcategory]);
  const result = db.prepare(`
    UPDATE parts
    SET name = ?, category = ?, subcategory = ?, head_type = ?, measurement_system = ?,
        nominal_diameter = ?, nominal_length = ?, accu_product_code = ?, accu_order_quantity = ?, category_path_json = ?
    WHERE part_id = ?
  `).run(
    name,
    category,
    subcategory,
    headType,
    measurementSystem,
    nominalDiameter,
    nominalLength,
    accuProductCode,
    accuOrderQuantity,
    JSON.stringify(path),
    partId
  );
  return Number(result.changes) > 0 ? getPart(partId) : undefined;
}

export function getBinMeasurement(binId: string) {
  return db.prepare(`
    SELECT bin_id, online, last_seen, part_id, net_weight_grams, measurement_stable
    FROM bins WHERE bin_id = ?
  `).get(binId) as
    | {
        bin_id: string;
        online: number;
        last_seen: string | null;
        part_id: string | null;
        net_weight_grams: number | null;
        measurement_stable: number;
      }
    | undefined;
}

export function learnPartUnitWeight(partId: string, unitWeightGrams: number) {
  const calibratedAt = nowIso();
  db.prepare(`
    UPDATE parts
    SET unit_weight_grams = ?, weight_calibrated = 1, weight_calibrated_at = ?
    WHERE part_id = ?
  `).run(unitWeightGrams, calibratedAt, partId);
  return getPart(partId);
}

export function assignPart(
  binId: string,
  partId: string,
  initialQuantity: number | null = null
) {
  const result = db.prepare(`
    UPDATE bins
    SET part_id = ?, estimated_quantity = ?
    WHERE bin_id = ?
  `).run(partId, initialQuantity, binId);
  return Number(result.changes) > 0;
}

export function clearBinAssignment(binId: string) {
  const result = db.prepare(`
    UPDATE bins
    SET part_id = NULL, estimated_quantity = NULL
    WHERE bin_id = ?
  `).run(binId);
  return Number(result.changes) > 0;
}

export function recordCommand(commandId: string, binId: string | null, type: string, payload: JsonRecord) {
  db.prepare(`
    INSERT INTO commands (command_id, bin_id, command_type, payload_json, status, created_at)
    VALUES (?, ?, ?, ?, 'sent', ?)
  `).run(commandId, binId, type, JSON.stringify(payload), nowIso());
}

export function completeCommand(payload: JsonRecord) {
  const commandId = asNullableString(payload.commandId);
  if (!commandId) return;
  db.prepare(`
    UPDATE commands SET status = ?, message = ?, completed_at = ? WHERE command_id = ?
  `).run(payload.ok === true ? "completed" : "failed", asNullableString(payload.message), nowIso(), commandId);
}

export function saveFirmware(input: {
  firmwareId: string;
  version: string;
  storedName: string;
  originalName: string;
  sha256: string;
  sizeBytes: number;
  source?: "upload" | "automatic-build";
  hardwareTarget: string;
  partitionLayout: string;
  signature?: string;
}) {
  db.prepare(`
    INSERT INTO firmware (
      firmware_id, version, stored_name, original_name, sha256, size_bytes, source, created_at, hardware_target, partition_layout, signature
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.firmwareId,
    input.version,
    input.storedName,
    input.originalName,
    input.sha256,
    input.sizeBytes,
    input.source ?? "upload",
    nowIso(), input.hardwareTarget, input.partitionLayout, input.signature ?? null
  );
  return getFirmware(input.firmwareId);
}

export function getFirmware(firmwareId: string) {
  return db.prepare(`SELECT * FROM firmware WHERE firmware_id = ?`).get(firmwareId) as
    | FirmwareRecord
    | undefined;
}

export function getFirmwareByVersion(version: string, hardwareTarget: string) {
  return db.prepare(`SELECT * FROM firmware WHERE version = ? AND hardware_target = ?`).get(version, hardwareTarget) as
    | FirmwareRecord
    | undefined;
}

export function setAutomaticFirmware(firmwareId: string) {
  const firmware = getFirmware(firmwareId);
  if (!firmware?.hardware_target) throw new Error("Firmware hardware target is required");
  db.prepare(`
    INSERT INTO app_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_value = excluded.setting_value,
      updated_at = excluded.updated_at
  `).run(`automatic_firmware_id:${firmware.hardware_target}`, firmwareId, nowIso());
}

export function getAutomaticFirmware(hardwareTarget: string) {
  return db.prepare(`
    SELECT f.*
    FROM firmware f
    JOIN app_settings s ON s.setting_value = f.firmware_id
    WHERE s.setting_key = ?
  `).get(`automatic_firmware_id:${hardwareTarget}`) as FirmwareRecord | undefined;
}

export function automaticDeploymentCanAttempt(
  firmwareId: string,
  binId: string,
  retryAfterMs: number,
  failedRetryAfterMs: number
) {
  const row = db.prepare(`
    SELECT state, last_attempt_at
    FROM automatic_ota_deployments
    WHERE firmware_id = ? AND bin_id = ?
  `).get(firmwareId, binId) as { state: string; last_attempt_at: string | null } | undefined;
  if (!row) return true;
  // If a previously updated bin is later reflashed or rolled back, its reported
  // version differs and it becomes eligible again after the normal cooldown.
  const attemptedAt = row.last_attempt_at ? Date.parse(row.last_attempt_at) : 0;
  const cooldown = row.state === "failed" ? failedRetryAfterMs : retryAfterMs;
  return !Number.isFinite(attemptedAt) || Date.now() - attemptedAt >= cooldown;
}

export function beginAutomaticDeployment(firmwareId: string, binId: string) {
  const now = nowIso();
  db.prepare(`
    INSERT INTO automatic_ota_deployments (
      firmware_id, bin_id, state, attempts, last_attempt_at, updated_at
    ) VALUES (?, ?, 'publishing', 1, ?, ?)
    ON CONFLICT(firmware_id, bin_id) DO UPDATE SET
      command_id = NULL,
      state = 'publishing',
      message = NULL,
      attempts = automatic_ota_deployments.attempts + 1,
      last_attempt_at = excluded.last_attempt_at,
      updated_at = excluded.updated_at
  `).run(firmwareId, binId, now, now);
}

export function completeAutomaticDeploymentPublish(
  firmwareId: string,
  binId: string,
  commandId: string
) {
  db.prepare(`
    UPDATE automatic_ota_deployments
    SET command_id = ?, state = 'sent', message = NULL, updated_at = ?
    WHERE firmware_id = ? AND bin_id = ?
  `).run(commandId, nowIso(), firmwareId, binId);
}

export function failAutomaticDeployment(
  firmwareId: string,
  binId: string,
  message: string
) {
  db.prepare(`
    UPDATE automatic_ota_deployments
    SET state = 'failed', message = ?, updated_at = ?
    WHERE firmware_id = ? AND bin_id = ?
  `).run(message, nowIso(), firmwareId, binId);
}

export function markAutomaticDeploymentInstalled(firmwareId: string, binId: string) {
  db.prepare(`
    INSERT INTO automatic_ota_deployments (
      firmware_id, bin_id, state, attempts, updated_at
    ) VALUES (?, ?, 'installed', 0, ?)
    ON CONFLICT(firmware_id, bin_id) DO UPDATE SET
      state = 'installed', message = NULL, updated_at = excluded.updated_at
  `).run(firmwareId, binId, nowIso());
}

export function upsertOtaStatus(payload: JsonRecord) {
  const commandId = asNullableString(payload.commandId);
  const binId = asNullableString(payload.binId);
  if (!commandId || !binId) return;
  db.prepare(`
    INSERT INTO ota_status (command_id, bin_id, state, progress, message, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(command_id, bin_id) DO UPDATE SET
      state = excluded.state,
      progress = excluded.progress,
      message = excluded.message,
      updated_at = excluded.updated_at
  `).run(
    commandId,
    binId,
    asNullableString(payload.state) ?? "unknown",
    asNullableNumber(payload.progress) ?? 0,
    asNullableString(payload.message),
    nowIso()
  );
  db.prepare(`
    UPDATE automatic_ota_deployments
    SET state = ?, message = ?, updated_at = ?
    WHERE command_id = ?
  `).run(
    asNullableString(payload.state) ?? "unknown",
    asNullableString(payload.message),
    nowIso(),
    commandId
  );
}

export function getPart(partId: string) {
  return db.prepare(`SELECT * FROM parts WHERE part_id = ?`).get(partId) as
    | {
        part_id: string;
        name: string;
        description: string;
        category: string;
        subcategory: string;
        head_type: string;
        measurement_system: string;
        nominal_diameter: string;
        nominal_length: string;
        unit_weight_grams: number;
        weight_calibrated: number;
        weight_calibrated_at: string | null;
      }
    | undefined;
}

export function markStaleBins(maxAgeSeconds = 45) {
  const cutoff = new Date(Date.now() - maxAgeSeconds * 1000).toISOString();
  return Number(db.prepare(`
    UPDATE bins SET online = 0
    WHERE online = 1 AND (last_seen IS NULL OR last_seen < ?)
  `).run(cutoff).changes);
}
