import { test,after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir=mkdtempSync(join(tmpdir(),"smartwall-component-api-test-"));
process.env.DATA_DIR=dir; process.env.FIRMWARE_DIR=join(dir,"firmware");
const { api }=await import("../src/server.js");
const { db,listPendingSyncEvents }=await import("../src/db.js");
const server=api.listen(0,"127.0.0.1"); await new Promise<void>(resolve=>server.once("listening",resolve));
const address=server.address(); assert(address && typeof address!=="string"); const base=`http://127.0.0.1:${address.port}`;
after(async()=>{ await new Promise<void>(resolve=>server.close(()=>resolve())); db.close(); rmSync(dir,{recursive:true,force:true}); });
const image="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
async function request(path:string,method="GET",body?:unknown) {
  const response=await fetch(base+path,{method,headers:{"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,value:await response.json()};
}
test("manual local catalogue supports custom taxonomy, supplier references and image changes in the sync outbox",async()=>{
  const part={partId:"LOCAL-RS-SENSOR",name:"RS optical sensor",category:"Automation controls",subcategory:"Photoelectric sensors",images:[image],sourceSupplier:"RS Components",sourceProductCode:"123456",sourceUrl:"https://uk.rs-online.com/web/p/photoelectric-sensors/123456"};
  const created=await request("/api/parts","POST",part); assert.equal(created.status,201,JSON.stringify(created.value)); assert.equal(created.value.weight_calibrated,0); assert.deepEqual(JSON.parse(created.value.images_json),[image]);
  const parts=await request("/api/parts"); assert.equal(parts.value[0].category,part.category); assert.equal(parts.value[0].source_supplier,"RS Components");
  const updated=await request(`/api/parts/${part.partId}/classification`,"PATCH",{name:part.name,category:"Custom category",subcategory:"Custom subcategory",headType:"Not applicable",measurementSystem:"Not applicable",nominalDiameter:"Not applicable",nominalLength:"Not applicable"}); assert.equal(updated.status,200);
  assert.equal((await request(`/api/parts/${part.partId}/images`,"PUT",{images:[]})).status,200);
  const events=listPendingSyncEvents(100).filter(event=>event.entity_type==="part"); assert(events.length>=3);
  const mirrored=JSON.parse(events.at(-1)!.payload_json); assert.equal(mirrored.category,"Custom category"); assert.equal(mirrored.images_json,"[]"); assert.equal(mirrored.source_product_code,"123456");
  assert.equal((await request(`/api/parts/${part.partId}/images`,"PUT",{images:["data:image/svg+xml;base64,PHN2Zz4="]})).status,400);
  assert.equal((await request("/api/parts/missing/images","PUT",{images:[]})).status,404);
});
test("local remote access is disabled by default and both permissions persist independently",async()=>{
  assert.deepEqual((await request("/api/sync/remote-settings")).value,{controlEnabled:false,catalogueEnabled:false});
  const enabled=await request("/api/sync/remote-settings","PATCH",{controlEnabled:false,catalogueEnabled:true}); assert.equal(enabled.status,200);
  assert.equal((await request("/api/sync/remote-settings")).value.catalogueEnabled,true);
  assert.equal((db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='remote_catalogue_enabled'").get() as any).setting_value,"true");
  assert.equal((await request("/api/sync/remote-settings","PATCH",{controlEnabled:"yes",catalogueEnabled:true})).status,400);
});

test("manual create/edit preserves nested paths without a depth limit and legacy edits retain deeper levels",async()=>{
  const path=["Electronics","Passive components","Resistors",...Array.from({length:120},(_,index)=>`Subtype ${index}`)];
  const created=await request("/api/parts","POST",{partId:"DEEP-PART",name:"Deeply classified component",categoryPath:path});
  assert.equal(created.status,201); assert.equal(created.value.category,path[0]); assert.equal(created.value.subcategory,path[1]); assert.deepEqual(JSON.parse(created.value.category_path_json),path);
  const fields={name:"Deeply classified component",category:path[0],subcategory:path[1],headType:"Not applicable",measurementSystem:"Not applicable",nominalDiameter:"Not applicable",nominalLength:"Not applicable"};
  const legacy=await request("/api/parts/DEEP-PART/classification","PATCH",fields); assert.equal(legacy.status,200); assert.deepEqual(JSON.parse(legacy.value.category_path_json),path);
  const changed=["Automation","Sensors","Optical","Reflective","Infrared"];
  const updated=await request("/api/parts/DEEP-PART/classification","PATCH",{...fields,categoryPath:changed});
  assert.equal(updated.status,200); assert.equal(updated.value.category,"Automation"); assert.deepEqual(JSON.parse(updated.value.category_path_json),changed);
  const event=listPendingSyncEvents(100).filter(event=>event.entity_id==="DEEP-PART").at(-1)!;
  assert.deepEqual(JSON.parse(JSON.parse(event.payload_json).category_path_json),changed);
});
