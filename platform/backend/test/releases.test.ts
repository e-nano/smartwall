import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { firmwareMessage, verifyFirmware, assertCompatible } from '../../shared/releases.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateReleases } from '../src/release-migration.js';
const dir=mkdtempSync(join(tmpdir(),'smartwall-releases-'));
const {privateKey, publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const pem=publicKey.export({type:'spki',format:'pem'}).toString();
writeFileSync(join(dir,'publisher.pem'),pem);
process.env.DATA_DIR=join(dir,'data');process.env.FIRMWARE_DIR=join(dir,'firmware');
process.env.FIRMWARE_PUBLIC_KEY_FILE=join(dir,'publisher.pem');
process.env.SMARTWALL_ADMIN_PASSWORD='test-admin-password-long-enough';
const {api}=await import('../src/server.js');
const {db,upsertStatus,getBinHardware}=await import('../src/db.js');
const server=api.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const address=server.address(); assert(address && typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
const authorization='Basic '+Buffer.from('admin:'+process.env.SMARTWALL_ADMIN_PASSWORD).toString('base64');
after(async()=>{await new Promise<void>(r=>server.close(()=>r()));db.close();rmSync(dir,{recursive:true,force:true});});
function artifact(target='esp32-devkit', layout='default-4mb-v1') {
  const bytes=Buffer.alloc(512);bytes[0]=0xe9;bytes.writeUInt16LE(target==='esp32-devkit'?0:9,12);
  bytes.write(`SMARTWALL-TARGET:${target}:${layout}\0`,40);
  bytes.write("SMARTWALL-RELEASE:1.2.3\0",160);
  const m={version:'1.2.3',hardwareTarget:target,partitionLayout:layout,sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),signature:''};
  m.signature=sign('sha256',Buffer.from(firmwareMessage(m)),privateKey).toString('base64');return {bytes,m};
}
test('publisher signature binds version, board, partition and binary',()=>{
  const {bytes,m}=artifact();verifyFirmware(m,bytes,pem);
  assert.throws(()=>verifyFirmware({...m,version:'1.2.4'},bytes,pem));
  assert.throws(()=>verifyFirmware({...m,hardwareTarget:'smartbin-rev02-s3',partitionLayout:'default-8mb-v1'},bytes,pem),/hardware/);
  const changed=Buffer.from(bytes);changed[100]^=1;assert.throws(()=>verifyFirmware(m,changed,pem),/digest/);
  assert.throws(()=>verifyFirmware({...m,signature:''},bytes,pem),/signature/);
  assert.throws(()=>assertCompatible({hardware_target:'esp32-devkit',partition_layout:'default-4mb-v1'},{hardware_target:null,partition_layout:null}));
});
test('legacy migration preserves firmware references and isolates unknown targets',()=>{
  const legacy=new DatabaseSync(':memory:');legacy.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE firmware(firmware_id TEXT PRIMARY KEY,version TEXT UNIQUE NOT NULL,stored_name TEXT,original_name TEXT,sha256 TEXT,size_bytes INTEGER,source TEXT,created_at TEXT);
    CREATE TABLE bins(bin_id TEXT PRIMARY KEY);
    CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value TEXT);
    CREATE TABLE automatic_ota_deployments(firmware_id TEXT REFERENCES firmware(firmware_id));
    INSERT INTO firmware VALUES('old','1.0.0','a.bin','a.bin','abc',512,'upload','today');
    INSERT INTO automatic_ota_deployments VALUES('old');
    INSERT INTO app_settings VALUES('automatic_firmware_id','old');`);
  migrateReleases(legacy);migrateReleases(legacy);
  assert.equal(legacy.prepare('SELECT hardware_target FROM firmware').get()!.hardware_target,null);
  assert.equal(legacy.prepare('SELECT * FROM automatic_ota_deployments').all().length,1);
  assert.equal(legacy.prepare('PRAGMA foreign_key_check').all().length,0);
  assert.equal(legacy.prepare('SELECT * FROM app_settings').all().length,0);legacy.close();
});
test('protected API rejects anonymous and cross-origin mutations',async()=>{
  assert.equal((await fetch(base+'/api/firmware')).status,401);
  assert.equal((await fetch(base+'/health/live')).status,200);
  assert.equal((await fetch(base+'/api/mqtt/security',{method:'PATCH',headers:{authorization,Origin:'https://attacker.example','Content-Type':'application/json'},body:JSON.stringify({credentialsRequired:false})})).status,403);
});
test('signed uploads support two hardware builds per version; mismatches fail before MQTT',async()=>{
  const records=[];
  for (const target of ['esp32-devkit','smartbin-rev02-s3']) {
    const {m,bytes}=artifact(target,target==='esp32-devkit'?'default-4mb-v1':'default-8mb-v1');
    const form=new FormData();form.append('manifest',JSON.stringify(m));form.append('firmware',new Blob([new Uint8Array(bytes)]),'firmware.bin');
    const response=await fetch(base+'/api/firmware',{method:'POST',headers:{authorization},body:form});
    assert.equal(response.status,201,await response.clone().text());records.push(await response.json());
  }
  upsertStatus({binId:'devkit',online:true,firmwareVersion:'1.0.0',hardwareTarget:'esp32-devkit',partitionLayout:'default-4mb-v1'});
  assert.equal(getBinHardware('devkit')?.hardware_target,'esp32-devkit');
  const response=await fetch(base+`/api/firmware/${records[1].firmware_id}/deploy`,{method:'POST',headers:{authorization,'Content-Type':'application/json'},body:JSON.stringify({target:'selected',binIds:['devkit']})});
  assert.equal(response.status,409);
  const none=await fetch(base+`/api/firmware/${records[1].firmware_id}/deploy`,{method:'POST',headers:{authorization,'Content-Type':'application/json'},body:JSON.stringify({target:'all'})});
  assert.equal(none.status,400);
});

test('maintenance rejects writes until validation is complete',async()=>{
  const marker=join(dir,'maintenance');process.env.MAINTENANCE_FILE=marker;writeFileSync(marker,'');
  const response=await fetch(base+'/api/mqtt/security',{method:'PATCH',headers:{authorization,'Content-Type':'application/json'},body:JSON.stringify({credentialsRequired:false})});
  assert.equal(response.status,503);assert.equal((await fetch(base+'/health/ready')).status,200);
  rmSync(marker);delete process.env.MAINTENANCE_FILE;
  assert.equal((await fetch(base+'/api/firmware',{headers:{authorization}})).status,200);
});
