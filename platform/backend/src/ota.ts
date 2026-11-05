import { readFileSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { FirmwareRecord, JsonRecord } from "./db.js";

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
}

function signingSecret() {
  return process.env.OTA_SIGNING_SECRET_FILE ? readFileSync(process.env.OTA_SIGNING_SECRET_FILE,"utf8").trim() : process.env.OTA_SIGNING_SECRET ?? "";
}

export function signFirmwareUrl(storedName: string) {
  const baseUrl = publicBaseUrl();
  const secret = signingSecret();
  if (!baseUrl) throw new Error("PUBLIC_BASE_URL must be configured for OTA");
  if (secret.length < 32) throw new Error("OTA_SIGNING_SECRET must be at least 32 characters");
  const expires = Math.floor(Date.now() / 1000) + 15 * 60;
  const pathname = `/firmware/${storedName}`;
  const signature = createHmac("sha256", secret)
    .update(`${pathname}:${expires}`)
    .digest("hex");
  return `${baseUrl}${pathname}?expires=${expires}&signature=${signature}`;
}

export function validFirmwareSignature(pathname: string, expiresText: string, signature: string) {
  const secret = signingSecret();
  if (secret.length < 32 || !/^\d+$/.test(expiresText) || !/^[a-f0-9]{64}$/.test(signature)) {
    return false;
  }
  const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac("sha256", secret)
    .update(`${pathname}:${expires}`)
    .digest("hex");
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
}

export function firmwareManifest(firmware: FirmwareRecord, force = false): JsonRecord {
  return {
    version: firmware.version,
    hardwareTarget: firmware.hardware_target,
    partitionLayout: firmware.partition_layout,
    sizeBytes: firmware.size_bytes,
    signature: firmware.signature,
    url: signFirmwareUrl(firmware.stored_name),
    sha256: firmware.sha256,
    force
  };
}
