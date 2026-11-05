import { test } from "node:test";
import assert from "node:assert/strict";
import { ScannerBurst } from "../src/scanner-input.js";
function feed(burst: ScannerBurst, text: string, start=0, gap=8) {
  [...text].forEach((key,index)=>assert.equal(burst.push(key,start+index*gap),null));
  return start+(text.length-1)*gap;
}
test("a keyboard scanner submits an Enter or Tab burst exactly once",()=>{
 const burst=new ScannerBurst();
 feed(burst,"ACCU:ABC-42");assert.equal(burst.push("Enter",100),"ACCU:ABC-42");assert.equal(burst.flush(300),null);
 feed(burst,"4006381333931",400);assert.equal(burst.push("Tab",550),"4006381333931");
});
test("suffix-free scans wait for the burst to finish and preserve QR punctuation",()=>{
 const burst=new ScannerBurst();const raw='{"supplier":"Accu","partNumber":"ABC-42"}';const last=feed(burst,raw);
 assert.equal(burst.flush(last+90),null);assert.equal(burst.flush(last+320),raw);assert.equal(burst.flush(last+640),null);
});
test("ordinary typing, pauses, short shortcuts and navigation do not become scans",()=>{
 const burst=new ScannerBurst();feed(burst,"component",0,100);assert.equal(burst.push("Enter",1000),null);
 feed(burst,"ABC",1200);assert.equal(burst.push("Enter",1225),null);
 feed(burst,"ABCD",1400);burst.push("ArrowLeft",1450);assert.equal(burst.push("Enter",1460),null);
 feed(burst,"AAAA",1600);feed(burst,"BB",1800);assert.equal(burst.push("Enter",1820),null);
});
test("focus resets separate scans and oversized labels cannot submit their tail",()=>{
 const burst=new ScannerBurst();feed(burst,"ABCD");burst.reset();assert.equal(burst.push("Enter",60),null);
 feed(burst,"A".repeat(2100),100);assert.equal(burst.push("Enter",18000),null);
 feed(burst,"NEXT-SCAN",19000);assert.equal(burst.push("Enter",19100),"NEXT-SCAN");
});

test("slower keyboard scanners and short scheduling gaps still submit",()=>{
 const burst=new ScannerBurst();feed(burst,"SCANNER-42",0,60);assert.equal(burst.push("Enter",650),"SCANNER-42");
 feed(burst,"ABCD",1000,10);feed(burst,"EFGH",1140,10);assert.equal(burst.flush(1490),"ABCDEFGH");
});
