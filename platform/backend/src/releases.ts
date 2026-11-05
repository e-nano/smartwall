import { Router } from 'express';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID, verify, createHash, constants } from 'node:crypto';
import { trustedFirmwareKey, importFirmware } from './firmware-import.js';
import { verifyFirmware, firmwareMessage, type FirmwareMetadata } from '../../shared/releases.js';
import { broadcast } from './events.js';

async function boundedDownload(url: string, max: number) {
  if (new URL(url).protocol !== 'https:') throw new Error('Release downloads require HTTPS');
  const response=await fetch(url,{signal:AbortSignal.timeout(60_000)});
  if (!response.ok || !response.body || new URL(response.url).protocol !== 'https:') throw new Error('Release download failed');
  const chunks: Uint8Array[]=[]; let size=0;
  for await (const chunk of response.body) { size+=chunk.length; if (size>max) throw new Error('Release download is too large'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export function releasesRouter() {
  const router=Router();
  router.get('/',(_req,res) => {
    let supervisor:unknown=null;
    try { if(process.env.RELEASE_STATUS_FILE) supervisor=JSON.parse(readFileSync(process.env.RELEASE_STATUS_FILE,'utf8')); } catch { /* Supervisor optional */ }
    res.json({version:process.env.SMARTWALL_VERSION ?? 'development',configured:!!process.env.SMARTWALL_RELEASE_URL,supervisor});
  });
  router.post('/check',(_req,res) => queue('check',undefined,res));
  router.post('/apply',(req,res) => {
    if (!/^[a-f0-9]{64}$/.test(req.body.manifestSha256 ?? '')) return res.status(400).json({error:'Check for an update before requesting installation'});
    return queue('apply',req.body.manifestSha256,res);
  });
  router.post('/firmware',async (_req,res) => {
    try {
      const url=process.env.SMARTWALL_RELEASE_URL, key=trustedFirmwareKey();
      if (!url || !key) return res.status(409).json({error:'Configure a release URL and trusted publisher key first'});
      const [bytes,signature]=await Promise.all([boundedDownload(url,128*1024),boundedDownload(url+'.sig',2048)]);
      if(!verify('sha256',bytes,{key,padding:constants.RSA_PKCS1_PADDING},Buffer.from(signature.toString().trim(),'base64'))) throw new Error('Release signature is invalid');
      const release=JSON.parse(bytes.toString());
      if(release.schema!==1 || !Array.isArray(release.firmware) || release.firmware.length>10) throw new Error('Unsupported release');
      // Verify all downloads before persisting any firmware.
      const downloaded: {m:FirmwareMetadata; bytes:Buffer}[]=[];
      for(const m of release.firmware as FirmwareMetadata[]) { firmwareMessage(m); if(!m.url) throw new Error('Firmware URL missing'); downloaded.push({m,bytes:await boundedDownload(m.url,m.sizeBytes)}); }
      for (const {m,bytes} of downloaded) verifyFirmware(m,bytes,key);
      const records=downloaded.map(({m,bytes})=>importFirmware(bytes,m,`smartwall-${m.hardwareTarget}-${m.version}.bin`));
      broadcast('firmware',{}); res.json({firmware:records,manifestSha256:createHash('sha256').update(bytes).digest('hex')});
    } catch(error) { res.status(400).json({error:error instanceof Error?error.message:'Could not import release'}); }
  });
  return router;
}
function queue(action:string, manifestSha256:string|undefined, res:import('express').Response) {
  const dir=process.env.RELEASE_REQUEST_DIR;
  if(!dir) return res.status(409).json({error:'The optional update supervisor is not installed'});
  mkdirSync(dir,{recursive:true});
  const requestId=randomUUID();
  writeFileSync(resolve(dir,requestId+'.json'),JSON.stringify({action,manifestSha256,requestId}),{flag:'wx',mode:0o600});
  return res.status(202).json({requestId});
}
