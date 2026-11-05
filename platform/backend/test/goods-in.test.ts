import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
const dir = mkdtempSync(join(tmpdir(), "smartwall-goods-in-test-"));
process.env.DATA_DIR = dir;
const { db, upsertTelemetry, recordCommand, completeCommand } = await import("../src/db.js");
const goods = await import("../src/goods-in.js");
const { parseScan, gtin, scanKey } = await import("../src/scan-parsers.js");
const { structuredSupplierProduct, lookupSupplierProduct } = await import("../src/supplier-lookup.js");
const { createGoodsInRouter } = await import("../src/goods-in-http.js");
let rejectCommands = false;
const app = express(); app.use(express.json());
app.use("/api/goods-in", createGoodsInRouter(async (binId, type, fields) => {
  const id = randomUUID(); recordCommand(id, binId, type, fields ?? {});
  completeCommand({ commandId: id, ok: !rejectCommands }); return id;
}, async () => {}));
app.use((error: any, _request: any, response: any, _next: any) => response.status(error.status ?? 400).json({ error: error.message }));
const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address(); assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api/goods-in`;
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); rmSync(dir, {recursive:true,force:true}); });
async function request(path: string, body?: any) {
  const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: {"Content-Type":"application/json"}, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
  return {status:response.status,value:await response.json()};
}
const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n:number}).n;
const product = {supplier:"Accu",partNumber:"HSH-M5-20-A2",name:"M5 test screw",gtins:["4006381333931"],unitWeightEstimate:12,packageQuantity:20};
let componentId = "";
test("supplier parsers, GTIN validation and shipment guard", () => {
  assert.equal(gtin("4006381333931"),"04006381333931"); assert.equal(gtin("4006381333932"),null);
  for (const supplier of ["ACCU","RS","FARNELL","DIGIKEY","MOUSER"]) assert.equal(parseScan(supplier+":TEST-42").confidence,"medium");
  assert.equal(parseScan(']Q3{"supplier":"Accu","partNumber":"HSH-M5-20-A2"}').supplier,"Accu");
  assert(parseScan("https://www.ups.com/track?number=42").rejected);
  assert.equal(parseScan("https://accu.co.uk.evil.example/product/42").confidence,"unknown");
});
test("supplier lookup trusts only one complete product and blocks arbitrary hosts and redirects", async () => {
  const html = '<script type="application/ld+json">'+JSON.stringify({"@type":"Product",sku:"TEST-42",name:"Verified supplier product"})+'</script>';
  assert.equal(structuredSupplierProduct("Accu","https://www.accu.co.uk/42-TEST-42",html,"TEST-42")!.partNumber,"TEST-42");
  assert.equal(structuredSupplierProduct("Accu","https://www.accu.co.uk/product",html,"DIFFERENT"),null);
  assert.equal(structuredSupplierProduct("Accu","https://www.accu.co.uk/product",html+html),null);
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{location:"http://127.0.0.1/private"}});};
  try { assert.equal(await lookupSupplierProduct("Accu","https://evil.example/product"),null);assert.equal(calls,0);
    assert.equal(await lookupSupplierProduct("Accu","https://www.accu.co.uk/product"),null);assert.equal(calls,1); }
  finally { globalThis.fetch=original; }
});
test("verified catalogue creates once, preserves raw aliases and does not falsely calibrate weight", async () => {
  assert.equal((await request("/resolve",{raw:"ACCU:HSH-M5-20-A2"})).value.status,"confirmation_required");
  assert.equal((await request("/catalogue",{verified:false,products:[product]})).status,400);
  assert.equal((await request("/catalogue",{verified:true,products:[{...product,url:"https://evil.example/product"}]})).status,400);
  assert.equal((await request("/catalogue",{verified:true,products:[product]})).status,200);
  const result=await request("/resolve",{raw:"ACCU:HSH-M5-20-A2"}); assert.equal(result.value.status,"resolved");
  componentId=result.value.component.part_id; assert.equal(result.value.component.weight_calibrated,0); assert.equal(result.value.component.unit_weight_grams,1);
  assert.equal((await request("/resolve",{raw:"4006381333931"})).value.component.part_id,componentId);
  assert.equal((await request("/resolve",{raw:'{"supplier":"Accu","partNumber":"HSH-M5-20-A2"}'})).value.component.part_id,componentId);
  assert.equal(count("parts"),1);
  assert.equal((await request("/map",{raw:"LOCAL-BAG-42",partId:componentId,productVerified:true})).value.status,"resolved");
  assert.equal((await request("/resolve",{raw:"LOCAL-BAG-42"})).value.component.part_id,componentId);
  const before=count("scan_identifiers"); assert.equal((await request("/map",{raw:"https://www.ups.com/track?number=42",partId:componentId,productVerified:true})).status,400); assert.equal(count("scan_identifiers"),before);
});
test("conflicts require explicit remapping with a reason and cannot create duplicates", async () => {
  const other=(await request("/map",{raw:"OTHER-BAG",name:"Other component",productVerified:true})).value.component.part_id;
  assert.equal((await request("/map",{raw:"LOCAL-BAG-42",partId:other,productVerified:true})).status,409);
  assert.equal((await request("/map",{raw:"LOCAL-BAG-42",partId:other,productVerified:true,remap:true,reason:"Corrected label"})).status,200);
  assert.equal((await request("/resolve",{raw:"LOCAL-BAG-42"})).value.component.part_id,other);
  assert((db.prepare("SELECT data_json FROM goods_in_audit").all() as any[]).some(row=>JSON.parse(row.data_json).action==="identifier_remapped"));
  db.prepare("UPDATE parts SET accu_product_code=? WHERE part_id=?").run(product.partNumber,other);
  assert.equal((await request("/resolve",{raw:"ACCU:HSH-M5-20-A2"})).value.status,"conflict");
  const before=count("parts"); assert.equal((await request("/map",{raw:"ACCU:HSH-M5-20-A2",name:"Duplicate",productVerified:true})).status,409); assert.equal(count("parts"),before);
  assert.equal((await request("/map",{raw:"ACCU:HSH-M5-20-A2",partId:componentId,productVerified:true,remap:true,reason:"Resolved duplicate legacy supplier code"})).status,200);
  assert.equal((await request("/resolve",{raw:"ACCU:HSH-M5-20-A2"})).value.status,"resolved");
});
test("first fill learns actual weight and records exactly one movement despite retries", async () => {
  upsertTelemetry({binId:"BIN-TEST",netWeightGrams:0,measurementStable:true,estimatedQuantity:0});
  const body={raw:"ACCU:HSH-M5-20-A2",partId:componentId,binId:"BIN-TEST",requestKey:randomUUID()};
  const start=await request("/intakes",body); assert.equal(start.status,201); assert.equal(start.value.state,"awaiting_fill");
  const id=start.value.intake_id; assert.equal((await request("/intakes",body)).value.intake_id,id);
  assert.equal((await request("/intakes",{...body,requestKey:randomUUID()})).status,409);
  assert.equal((await request(`/intakes/${id}/confirm`,{count:20})).status,409);
  await new Promise(resolve=>setTimeout(resolve,5));
  upsertTelemetry({binId:"BIN-TEST",partId:componentId,netWeightGrams:100,measurementStable:true,estimatedQuantity:100}); goods.observeIntakes("BIN-TEST");
  assert.equal(goods.getIntake(id).state,"awaiting_confirmation"); assert.equal(count("inventory_events"),0);
  assert.equal((db.prepare("SELECT estimated_quantity FROM bins WHERE bin_id='BIN-TEST'").get() as any).estimated_quantity,null);
  assert.equal((await request(`/intakes/${id}/confirm`,{count:20})).value.state,"completed");
  assert.equal(goods.part(componentId)!.unit_weight_grams,5); assert.equal(count("inventory_events"),1);
  assert.equal((await request(`/intakes/${id}/confirm`,{count:20})).value.state,"completed"); assert.equal(count("inventory_events"),1);
});
test("calibrated restock links scale movements once and failed commands release the bin", async () => {
  const body={raw:"ACCU:HSH-M5-20-A2",partId:componentId,binId:"BIN-TEST",requestKey:randomUUID()};
  const start=await request("/intakes",body); assert.equal(start.status,201);
  await new Promise(resolve=>setTimeout(resolve,5));
  upsertTelemetry({binId:"BIN-TEST",partId:componentId,netWeightGrams:150,measurementStable:true,estimatedQuantity:30}); goods.observeIntakes("BIN-TEST");
  const receipt=goods.getIntake(start.value.intake_id); assert.equal(receipt.state,"completed"); assert.equal(receipt.quantity_added,10); assert.equal(receipt.movement_event_ids.length,1);
  assert.equal(count("inventory_events"),2); goods.observeIntakes("BIN-TEST"); assert.equal(count("inventory_events"),2);
  rejectCommands=true; const failed=await request("/intakes",{...body,requestKey:randomUUID()}); rejectCommands=false; assert.equal(failed.status,409);
  assert.equal((await request("")).value.intakes[0].state,"failed");
  const resumed=await request("/intakes",{...body,requestKey:randomUUID()}); assert.equal(resumed.status,201);
  assert.equal((await request(`/intakes/${resumed.value.intake_id}/cancel`,{})).value.state,"cancelled");
});
test("shared catalogue imports are idempotent and cannot import another wall's calibration", () => {
  const records=[{record_type:"scan_identifier",site_id:"other-wall",part_id:"remote-id",identifier_key:scanKey("REMOTE-PRODUCT"),raw_value:"REMOTE-PRODUCT",symbology:"unknown"},
    {record_type:"supplier_item",site_id:"other-wall",part_id:"remote-id",item_id:"remote-item",supplier:"RS",partNumber:"TEST-42",name:"Remote product"}];
  const bundle={records,components:[{site_id:"other-wall",part_id:"remote-id",name:"Remote product",unit_weight_grams:99,weight_calibrated:true}]};
  assert(goods.importCompanyCatalogue(bundle,"this-wall").imported>0); const before=count("parts"); goods.importCompanyCatalogue(bundle,"this-wall"); assert.equal(count("parts"),before);
  const imported=db.prepare("SELECT p.* FROM parts p JOIN supplier_items s ON s.part_id=p.part_id WHERE s.supplier='RS'").get() as any;
  assert.equal(imported.weight_calibrated,0); assert.equal(goods.part(componentId)!.unit_weight_grams,5);
  assert.equal(goods.resolveScan("REMOTE-PRODUCT","unknown").component!.part_id,imported.part_id);
  assert((db.prepare("SELECT count(*) AS n FROM sync_outbox WHERE entity_type='goods_in'").get() as any).n>0);
});
test("stale or unstable bins and expired confirmations cannot record stock", async () => {
  const raw="EXPIRY-PRODUCT";
  const partId=(await request("/map",{raw,name:"Expiry component",productVerified:true})).value.component.part_id;
  const binId="BIN-EXPIRY";
  upsertTelemetry({binId,netWeightGrams:0,measurementStable:false,estimatedQuantity:0});
  const body={raw,partId,binId,requestKey:randomUUID()};
  assert.equal((await request("/intakes",body)).status,409);
  upsertTelemetry({binId,netWeightGrams:0,measurementStable:true,estimatedQuantity:0});
  db.prepare("UPDATE bins SET last_seen=? WHERE bin_id=?").run(new Date(Date.now()-60000).toISOString(),binId);
  assert.equal((await request("/intakes",body)).status,409);
  upsertTelemetry({binId,netWeightGrams:0,measurementStable:true,estimatedQuantity:0});
  const started=await request("/intakes",body);assert.equal(started.status,201);
  await new Promise(resolve=>setTimeout(resolve,5));
  upsertTelemetry({binId,partId,netWeightGrams:50,measurementStable:true,estimatedQuantity:50});goods.observeIntakes(binId);
  const receipt=goods.getIntake(started.value.intake_id);assert.equal(receipt.state,"awaiting_confirmation");
  receipt.expires_at=new Date(Date.now()-1000).toISOString();goods.saveIntake(receipt);
  const before=count("inventory_events");
  assert.equal((await request(`/intakes/${receipt.intake_id}/confirm`,{count:10})).status,409);
  assert.equal(goods.getIntake(receipt.intake_id).state,"timed_out");assert.equal(count("inventory_events"),before);
  assert.equal(goods.part(partId)!.weight_calibrated,0);
});
