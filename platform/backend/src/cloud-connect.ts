import { Router } from "express";
import { generateKeyPairSync, privateDecrypt, randomUUID } from "node:crypto";
import { z } from "zod";
import { getAppSetting,setAppSetting } from "./db.js";
import { cloudConnectionTarget, installCloudConnection } from "./cloud-sync.js";
import { IntakeError } from "./goods-in.js";
import { broadcast } from "./events.js";

type Pending={id:string;token:string;code:string;verificationUrl:string;expiresAt:string;privateKey:string;apiUrl:string;sourceSiteId:string;originalSiteId:string;busy:boolean;connected:boolean};
let pending:Pending|null=null;
export function createCloudConnectRouter(){
  const router=Router();
  // The local station has no user accounts. Prevent a third-party web page
  // from starting or confirming a connection through the station API.
  router.use((request,response,next)=>{
    const origin=request.get('origin');
    if(!origin) return response.status(403).json({error:'Open the local SmartWall page to connect'});
    let hostname;try{hostname=new URL(origin).hostname;}catch{return response.status(403).json({error:'Invalid request origin'});}
    let host:string;try{host=new URL('http://'+request.get('host')).hostname;}catch{return response.status(403).json({error:'Invalid host'});}
    if(hostname!==host && !(['localhost','127.0.0.1','[::1]'].includes(hostname)&&['localhost','127.0.0.1','[::1]'].includes(host))) return response.status(403).json({error:'Invalid request origin'});
    next();
  });
  router.post('/start',async(_request,response)=>{
    if(pending?.busy) throw new IntakeError(409,'Connection is being saved. Please wait.');
    if(pending && !pending.connected) await remote(pending.apiUrl,'cancel',{token:pending.token});
    pending=null;
    const target=cloudConnectionTarget();
    if(new URL(target.apiUrl).protocol!=='https:') throw new IntakeError(400,'The online portal must use HTTPS');
    let installationId=getAppSetting('cloud_sync_installation_id');
    if(!installationId){installationId=randomUUID();setAppSetting('cloud_sync_installation_id',installationId);}
    const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
    const result=await remote(target.apiUrl,'start',{publicKey,installationId,...(target.siteId?{sourceSiteId:target.siteId}:{})});
    pending={id:randomUUID(),token:result.token,code:result.code,verificationUrl:result.verificationUrl,expiresAt:result.expiresAt,privateKey,apiUrl:target.apiUrl,sourceSiteId:result.sourceSiteId ?? target.siteId,originalSiteId:target.siteId,busy:false,connected:false};
    response.json(publicState(pending));
  });
  router.post('/status',async(request,response)=>{
    const {id}=z.object({id:z.string().uuid()}).strict().parse(request.body);
    const pair=pending;
    if(!pair || pair.id!==id) throw new IntakeError(410,'Start a new connection from this wall');
    if(pair.connected || pair.busy) return response.json(publicState(pair));
    if(new Date(pair.expiresAt).getTime()<=Date.now()) throw new IntakeError(410,'Connection expired. Start again.');
    pair.busy=true;
    try{
      const result=await remote(pair.apiUrl,'status',{token:pair.token});
      if(result.state==='cancelled'||result.state==='consumed') throw new IntakeError(410,'This connection is no longer available. Start again.');
      if(result.state==='approved'){
        const current=cloudConnectionTarget();
        if((result.sourceSiteId ?? '')!==pair.sourceSiteId || current.siteId!==pair.originalSiteId || (current.companyId && current.companyId!==result.companyId)) throw new IntakeError(409,'The wall connection changed. Start again.');
        const token=privateDecrypt({key:pair.privateKey,oaepHash:'sha256'},Buffer.from(result.encryptedToken,'base64')).toString();
        const state=await installCloudConnection({apiUrl:pair.apiUrl,siteId:result.siteId,token,companyId:result.companyId,companyName:result.companyName,wallName:result.wallName});
        pair.connected=true;pair.privateKey='';broadcast('cloud-sync',state);
        await remote(pair.apiUrl,'complete',{token:pair.token}).catch(()=>{});
      }
      response.json(publicState(pair));
    }finally{pair.busy=false;}
  });
  router.post('/cancel',async(request,response)=>{
    const {id}=z.object({id:z.string().uuid()}).strict().parse(request.body);
    if(pending?.id===id){
      if(pending.busy) throw new IntakeError(409,'Connection is being saved. Please wait.');
      if(!pending.connected) await remote(pending.apiUrl,'cancel',{token:pending.token});
      pending=null;
    }
    response.json({ok:true});
  });
  return router;
}
function publicState(pair:Pending){return {id:pair.id,code:pair.code,verificationUrl:pair.verificationUrl,expiresAt:pair.expiresAt,state:pair.connected?'connected':'pending'};}
async function remote(apiUrl:string,path:string,body:unknown){
  const response=await fetch(`${apiUrl}/api/portal/connections/device/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const result=await response.json();
  if(!response.ok) throw new IntakeError(response.status,result.error || 'Unable to contact the online portal');
  return result;
}
