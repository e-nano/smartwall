import {test,after,mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,statSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publicEncrypt,randomUUID} from 'node:crypto';
import express from 'express';
const dataDir=mkdtempSync(join(tmpdir(),'smartwall-connect-test-'));
process.env.DATA_DIR=dataDir;process.env.CLOUD_SYNC_ENABLED='false';process.env.CLOUD_SYNC_SITE_ID='';process.env.CLOUD_SYNC_API_URL='';process.env.CLOUD_SYNC_API_TOKEN='';process.env.CLOUD_BACKUP_ENCRYPTION_KEY='';process.env.CLOUD_PORTAL_URL='https://portal.example.test';
const {createCloudConnectRouter}=await import('../src/cloud-connect.js');
const {cloudSyncState,setCloudSyncEnabled}=await import('../src/cloud-sync.js');
const {loadConnectionConfig}=await import('../src/cloud-connection-config.js');
const {db,createPart}=await import('../src/db.js');
const {IntakeError,enqueue,audit}=await import('../src/goods-in.js');
const app=express();app.use(express.json());app.use('/connect',createCloudConnectRouter());
app.use((error:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error instanceof IntakeError?error.status:500).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
const address=server.address();assert(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
const realFetch=globalThis.fetch;let approved=false,publicKey='',installationId='',grantSiteId='test-wall',grantSourceSiteId:string|null=null;
const token='wall-secret-token-that-never-reaches-the-browser';const companyId=randomUUID();
mock.method(globalThis,'fetch',async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  const url=String(input);if(!url.startsWith('https://portal.example.test'))return realFetch(input,init);
  if(!url.includes('/api/portal/connections/device/')) {
    assert.equal((init?.headers as Record<string,string>).Authorization,`Bearer ${token}`);
    const value=url.endsWith('/catalogue')?{records:[],components:[]}:url.endsWith('/events')?{acceptedEventIds:JSON.parse(String(init?.body)).events.map((event:{eventId:string})=>event.eventId)}:{ok:true};
    return new Response(JSON.stringify(value),{status:url.endsWith('/backups')?201:200});
  }
  const path=url.split('/').at(-1),body=JSON.parse(String(init?.body ?? '{}'));
  let value;
  if(path==='start'){publicKey=body.publicKey;installationId=body.installationId;assert(!('token' in body));value={token:'a'.repeat(43),code:'ABCDEFGH',sourceSiteId:body.sourceSiteId ?? null,expiresAt:new Date(Date.now()+600000).toISOString(),verificationUrl:'https://portal.example.test/#connect=ABCDEFGH'};}
  else if(path==='status')value=approved?{state:'approved',siteId:grantSiteId,companyId,companyName:'Test company',wallName:'Test wall',sourceSiteId:grantSourceSiteId,encryptedToken:publicEncrypt({key:publicKey,oaepHash:'sha256'},Buffer.from(token)).toString('base64')}:{state:'pending'};
  else value={ok:true};
  return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
});
after(async()=>{setCloudSyncEnabled(false);mock.restoreAll();await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();rmSync(dataDir,{recursive:true,force:true});});
async function request(path:string,body:unknown,requestOrigin=origin){const response=await fetch(origin+'/connect/'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:requestOrigin},body:JSON.stringify(body)});return {status:response.status,value:await response.json()};}
test('local device connection keeps secrets out of the browser and persists a private restart configuration',async()=>{
  assert.equal(cloudSyncState().available,false);
  assert.equal((await request('start',{},'https://untrusted.example')).status,403);
  const start=await request('start',{});assert.equal(start.status,200);assert.equal(start.value.state,'pending');assert(!('token' in start.value));assert(!('privateKey' in start.value));assert.match(installationId,/^[a-f0-9-]{36}$/);
  assert.equal((await request('status',{id:randomUUID()})).status,410);
  assert.equal((await request('status',{id:start.value.id})).value.state,'pending');
  approved=true;
  const connected=await request('status',{id:start.value.id});assert.equal(connected.status,200);assert.equal(connected.value.state,'connected');assert(!JSON.stringify(connected.value).includes(token));
  setCloudSyncEnabled(false);
  const state=cloudSyncState();assert.equal(state.available,true);assert.equal(state.companyName,'Test company');assert(!JSON.stringify(state).includes(token));
  const file=join(dataDir,'cloud-connection.json');assert.equal(statSync(file).mode & 0o777,0o600);assert.equal(JSON.parse(readFileSync(file,'utf8')).token,token);
  const restored=loadConnectionConfig();assert.equal(restored?.siteId,'test-wall');assert.equal(restored?.token,token);assert.match(restored!.backupKey,/^[a-f0-9]{64}$/);
  assert.equal((await request('status',{id:start.value.id})).value.state,'connected');
});


test('switching walls preserves local stock and the backup key and reseeds inventory and goods-in history',async()=>{
  createPart({partId:'retained-part',name:'Retained component',description:'',category:'Other',subcategory:'Other',headType:'Other',measurementSystem:'Metric',nominalDiameter:'M3',nominalLength:'10',accuProductCode:'',accuOrderQuantity:0,unitWeightGrams:1,reorderLevel:5});
  audit('station_move_test',{});
  db.prepare("UPDATE sync_outbox SET synced_at=?").run(new Date().toISOString());
  const before=db.prepare('SELECT count(*) AS n FROM sync_outbox').get() as {n:number};
  const key=loadConnectionConfig()!.backupKey;
  grantSiteId='replacement-wall';grantSourceSiteId='test-wall';approved=false;
  const start=await request('start',{});assert.equal(start.status,200);
  approved=true;const result=await request('status',{id:start.value.id});assert.equal(result.status,200);assert.equal(result.value.state,'connected');
  setCloudSyncEnabled(false);
  assert.equal(loadConnectionConfig()!.siteId,'replacement-wall');assert.equal(loadConnectionConfig()!.backupKey,key);
  assert.equal((db.prepare('SELECT name FROM parts WHERE part_id=?').get('retained-part') as {name:string}).name,'Retained component');
  assert((db.prepare('SELECT count(*) AS n FROM sync_outbox').get() as {n:number}).n>before.n);
  assert.equal((db.prepare("SELECT count(*) AS n FROM sync_outbox WHERE entity_type='goods_in'").get() as {n:number}).n,2);
});
