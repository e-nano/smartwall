import { createHash, verify, constants } from 'node:crypto';

export const hardwareLayouts = Object.freeze({
  'esp32-devkit': 'default-4mb-v1',
  'smartbin-rev02-s3': 'default-8mb-v1',
});
export function firmwareMessage(m) {
  if (!m || !Object.hasOwn(hardwareLayouts, m.hardwareTarget) || hardwareLayouts[m.hardwareTarget] !== m.partitionLayout ||
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(m.version) ||
      !/^[a-f0-9]{64}$/.test(m.sha256) || !Number.isSafeInteger(m.sizeBytes) || m.sizeBytes < 256 || m.sizeBytes > (m.hardwareTarget === 'esp32-devkit' ? 0x140000 : 0x330000)) {
    throw new Error('Invalid firmware compatibility metadata');
  }
  return `smartwall-firmware-v1\n${m.version}\n${m.hardwareTarget}\n${m.partitionLayout}\n${m.sizeBytes}\n${m.sha256}\n`;
}
export function verifyFirmware(m, bytes, publicKey, allowUnsigned = false) {
  const message = firmwareMessage(m);
  if (bytes.length !== m.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== m.sha256)
    throw new Error('Firmware size or digest mismatch');
  const marker = Buffer.from(`SMARTWALL-TARGET:${m.hardwareTarget}:${m.partitionLayout}\0`);
  const chip = m.hardwareTarget === 'esp32-devkit' ? 0 : 9;
  if (bytes[0] !== 0xe9 || bytes.readUInt16LE(12) !== chip || !bytes.includes(marker) || !bytes.includes(Buffer.from(`SMARTWALL-RELEASE:${m.version}\0`)))
    throw new Error('Firmware binary does not match its hardware target');
  if (!m.signature && allowUnsigned) return m;
  if (!publicKey || !/^[A-Za-z0-9+/]+={0,2}$/.test(m.signature ?? '') ||
      !verify('sha256', Buffer.from(message), { key: publicKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(m.signature, 'base64')))
    throw new Error('Firmware publisher signature is missing or invalid');
  return m;
}
export function assertCompatible(firmware, bin) {
  if (!bin || !bin.hardware_target || !bin.partition_layout ||
      bin.hardware_target !== firmware.hardware_target || bin.partition_layout !== firmware.partition_layout)
    throw new Error('Bin hardware is unknown or incompatible with this firmware');
}
