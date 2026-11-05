import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyFirmware, type FirmwareMetadata } from '../../shared/releases.js';
import { getFirmwareByVersion, saveFirmware } from './db.js';

export function trustedFirmwareKey() {
  return process.env.FIRMWARE_PUBLIC_KEY_FILE ? readFileSync(process.env.FIRMWARE_PUBLIC_KEY_FILE) : null;
}
export function importFirmware(bytes: Buffer, metadata: FirmwareMetadata, originalName: string, source: 'upload' | 'automatic-build' = 'upload') {
  verifyFirmware(metadata, bytes, trustedFirmwareKey(), process.env.ALLOW_UNSIGNED_FIRMWARE === 'true');
  const existing = getFirmwareByVersion(metadata.version, metadata.hardwareTarget);
  if (existing) {
    if (existing.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new Error('This firmware version already has different contents');
    return existing;
  }
  const dir = resolve(process.env.FIRMWARE_DIR ?? './firmware'); mkdirSync(dir, { recursive: true });
  const firmwareId = randomUUID(), storedName = `${firmwareId}.bin`, path = resolve(dir, storedName);
  writeFileSync(path, bytes, { flag: 'wx' });
  try { return saveFirmware({ ...metadata, firmwareId, storedName, originalName, source })!; }
  catch (error) { if (existsSync(path)) unlinkSync(path); throw error; }
}
