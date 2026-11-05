#!/usr/bin/env node
// Run only in the approved publisher job. Builds have no access to the private key.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, createPublicKey, sign, constants } from 'node:crypto';
import { firmwareMessage, verifyFirmware, hardwareLayouts } from '../../platform/shared/releases.js';
const [version, repository, image, directory='release'] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version ?? '') || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') ||
    !/^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/.test(image ?? '')) throw new Error('Usage: publish-metadata.mjs VERSION OWNER/REPO IMAGE@sha256:DIGEST [directory]');
const key=readFileSync(process.env.RELEASE_SIGNING_KEY_FILE);
const publicKey=createPublicKey(key).export({ type:'spki',format:'pem' });
if (process.env.FIRMWARE_PUBLIC_KEY_FILE && readFileSync(process.env.FIRMWARE_PUBLIC_KEY_FILE,'utf8').trim() !== publicKey.trim())
  throw new Error('Release signing key does not match the key embedded during firmware builds');
mkdirSync(directory,{recursive:true});
const firmware=[];
for (const [target,layout] of Object.entries(hardwareLayouts)) {
  const name=`smartwall-${target}-${version}`;
  const bytes=readFileSync(resolve(directory,`${target}.bin`));
  if (!bytes.includes(Buffer.from(publicKey.trim()))) throw new Error(`Firmware ${target} does not embed this publisher key`);
  const metadata={ version,hardwareTarget:target,partitionLayout:layout,sizeBytes:bytes.length,
    sha256:createHash('sha256').update(bytes).digest('hex'),
    url:`https://github.com/${repository}/releases/download/v${version}/${name}.bin` };
  metadata.signature=sign('sha256',Buffer.from(firmwareMessage(metadata)),{key,padding:constants.RSA_PKCS1_PADDING}).toString('base64');
  verifyFirmware(metadata,bytes,publicKey);
  writeFileSync(resolve(directory,`${name}.bin`),bytes);
  writeFileSync(resolve(directory,`${name}.json`),JSON.stringify(metadata,null,2)+'\n');
  firmware.push(metadata);
}
const release={ schema:1,version,channel:version.includes('-')?'beta':'stable',publishedAt:new Date().toISOString(),
  image, minimumSupervisor:1, firmware,
  releaseNotes:`https://github.com/${repository}/releases/tag/v${version}` };
const bytes=Buffer.from(JSON.stringify(release,null,2)+'\n');
writeFileSync(resolve(directory,'release.json'),bytes);
writeFileSync(resolve(directory,'release.json.sig'),sign('sha256',bytes,{key,padding:constants.RSA_PKCS1_PADDING}).toString('base64')+'\n');
writeFileSync(resolve(directory,'publisher.pem'),publicKey);
console.log(`Signed release ${version} for ${firmware.length} hardware targets`);
