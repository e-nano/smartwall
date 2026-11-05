import type { DatabaseSync } from 'node:sqlite';

// Rebuild only the firmware table to replace the old version-only UNIQUE key.
// Do not rename the original table: SQLite would rewrite dependent FK targets.
export function migrateReleases(db: DatabaseSync) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=1').get()) return;
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE firmware_v2 (
      firmware_id TEXT PRIMARY KEY, version TEXT NOT NULL,
      stored_name TEXT NOT NULL, original_name TEXT NOT NULL, sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'upload', created_at TEXT NOT NULL,
      hardware_target TEXT, partition_layout TEXT, signature TEXT,
      UNIQUE(version, hardware_target, partition_layout)
    );
    INSERT INTO firmware_v2 (firmware_id,version,stored_name,original_name,sha256,size_bytes,source,created_at)
      SELECT firmware_id,version,stored_name,original_name,sha256,size_bytes,source,created_at FROM firmware;
    DROP TABLE firmware;
    ALTER TABLE firmware_v2 RENAME TO firmware;
    ALTER TABLE bins ADD COLUMN hardware_target TEXT;
    ALTER TABLE bins ADD COLUMN partition_layout TEXT;
    DELETE FROM app_settings WHERE setting_key='automatic_firmware_id';
    INSERT INTO schema_migrations VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Release migration would break foreign keys');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.exec('PRAGMA foreign_keys=ON'); }
}
