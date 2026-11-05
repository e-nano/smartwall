import { mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { automaticDeploymentCanAttempt, beginAutomaticDeployment, completeAutomaticDeploymentPublish,
  failAutomaticDeployment, getAutomaticFirmware, listOnlineBins, markAutomaticDeploymentInstalled,
  setAutomaticFirmware, getBinHardware, db } from './db.js';
import { broadcast } from './events.js';
import { mqttState, onBinSeen, sendBinCommand } from './mqtt.js';
import { firmwareManifest } from './ota.js';
import { importFirmware } from './firmware-import.js';
import { assertCompatible, hardwareLayouts, type FirmwareMetadata } from '../../shared/releases.js';

const inboxDir = resolve(process.env.FIRMWARE_INBOX_DIR ?? resolve(process.env.FIRMWARE_DIR ?? './firmware', 'incoming'));
const enabled = process.env.AUTO_UPDATE_FIRMWARE === 'true';
const retryAfterMs = 300_000;
let running = false;
function newer(a: string, b: string) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i=0;i<3;i++) if (left[i] !== right[i]) return left[i]! > right[i]!;
  return false;
}
async function updateBin(binId: string, version: string | null) {
  if (!enabled || !mqttState().connected) return;
  const bin = getBinHardware(binId);
  if (!bin?.hardware_target) return;
  const release = getAutomaticFirmware(bin.hardware_target);
  if (!release) return;
  try { assertCompatible(release, bin); } catch { return; }
  if (version === release.version) { if (bin.boot_validated) markAutomaticDeploymentInstalled(release.firmware_id, binId); return; }
  // Unknown and prerelease versions require an explicit administrator action.
  if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !newer(release.version, version)) return;
  if (!automaticDeploymentCanAttempt(release.firmware_id, binId, retryAfterMs, 10_000)) return;
  const attempt = db.prepare('SELECT attempts FROM automatic_ota_deployments WHERE firmware_id=? AND bin_id=?').get(release.firmware_id,binId);
  if (Number(attempt?.attempts ?? 0) >= 3) return;
  beginAutomaticDeployment(release.firmware_id, binId);
  try {
    const commandId = await sendBinCommand(binId, 'ota', firmwareManifest(release));
    completeAutomaticDeploymentPublish(release.firmware_id, binId, commandId);
    broadcast('automatic-update', { binId, version: release.version, state: 'sent' });
  } catch (error) { failAutomaticDeployment(release.firmware_id, binId, String(error)); }
}
export function automaticUpdateState() {
  const targets = Object.keys(hardwareLayouts).map(target => ({ hardwareTarget: target, version: getAutomaticFirmware(target)?.version ?? null }));
  return { enabled, version: null, targets, inbox: inboxDir, retryAfterMs, publishRetryAfterMs: 10_000 };
}
export function startAutomaticFirmwareUpdates() {
  mkdirSync(inboxDir, { recursive: true });
  onBinSeen(bin => { if (!running) void updateBin(bin.binId, bin.firmwareVersion); });
  const cycle = async () => {
    if (running || !enabled) return;
    running = true;
    try {
      for (const name of readdirSync(inboxDir).filter(name => /^[a-zA-Z0-9._-]+\.json$/.test(name))) {
        const path = resolve(inboxDir,name);
        try {
          const metadata = JSON.parse(readFileSync(path,'utf8')) as FirmwareMetadata;
          if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) throw new Error('Only stable firmware can roll out automatically');
          const release = importFirmware(readFileSync(resolve(inboxDir, name.replace(/\.json$/, '.bin'))), metadata, name.replace(/\.json$/, '.bin'), 'automatic-build');
          const active = getAutomaticFirmware(metadata.hardwareTarget);
          if (!active || newer(metadata.version, active.version)) setAutomaticFirmware(release.firmware_id);
          renameSync(path, `${path}.imported`);
          broadcast('firmware', { version: release.version, hardwareTarget: release.hardware_target });
        } catch (error) { console.error('[OTA] Rejected inbox release:', name, String(error)); renameSync(path, `${path}.rejected`); }
      }
      for (const bin of listOnlineBins()) await updateBin(bin.bin_id, bin.firmware_version);
    } catch (error) { console.error('[OTA] Reconciliation failed', String(error)); }
    finally { running=false; }
  };
  void cycle(); setInterval(() => void cycle(), 10_000).unref();
}
