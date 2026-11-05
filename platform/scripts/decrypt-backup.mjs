#!/usr/bin/env node

import { createDecipheriv } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function usage() {
  console.error("Usage: CLOUD_BACKUP_ENCRYPTION_KEY=... node scripts/decrypt-backup.mjs INPUT OUTPUT");
  process.exit(2);
}

function encryptionKey() {
  const configured = process.env.CLOUD_BACKUP_ENCRYPTION_KEY ?? "";
  if (/^[a-fA-F0-9]{64}$/.test(configured)) return Buffer.from(configured, "hex");
  const decoded = Buffer.from(configured, "base64");
  if (decoded.length === 32) return decoded;
  throw new Error("CLOUD_BACKUP_ENCRYPTION_KEY must be 32 bytes encoded as hex or base64");
}

const [, , inputArgument, outputArgument] = process.argv;
if (!inputArgument || !outputArgument) usage();

const inputPath = resolve(inputArgument);
const outputPath = resolve(outputArgument);
const encrypted = readFileSync(inputPath);
if (encrypted.length < 34 || encrypted.subarray(0, 5).toString("ascii") !== "SWDB1") {
  throw new Error("Input is not a valid SmartWall SWDB1 encrypted backup");
}

const iv = encrypted.subarray(5, 17);
const authenticationTag = encrypted.subarray(17, 33);
const ciphertext = encrypted.subarray(33);
const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
decipher.setAuthTag(authenticationTag);
const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

writeFileSync(outputPath, plaintext, { flag: "wx", mode: 0o600 });
console.log(`Recovered SQLite database: ${outputPath}`);
