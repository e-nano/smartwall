import { productSchema, trustedSupplierUrl, type Supplier, type SupplierProduct } from "./scan-parsers.js";

const hosts: Record<Supplier, string[]> = {
  Accu: ["accu.co.uk","www.accu.co.uk","accu-components.com","www.accu-components.com","accu.co","www.accu.co"],
  RS: ["uk.rs-online.com","rs-online.com","www.rs-online.com"],
  Farnell: ["uk.farnell.com","www.farnell.com","www.newark.com","au.element14.com"],
  DigiKey: ["www.digikey.com","www.digikey.co.uk"], Mouser: ["www.mouser.com","www.mouser.co.uk"]
};
function allowed(supplier: Supplier, value: string) {
  try { const url = new URL(value); return trustedSupplierUrl(supplier,value) && (!url.port || url.port === "443") && hosts[supplier].includes(url.hostname); }
  catch { return false; }
}
export function structuredSupplierProduct(supplier: Supplier, url: string, html: string, expectedPartNumber?: string): SupplierProduct | null {
  const found: any[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node["@type"] === "Product" || (Array.isArray(node["@type"]) && node["@type"].includes("Product"))) found.push(node);
    if (node["@graph"]) walk(node["@graph"]);
  };
  for (const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(script[1]!)); } catch { /* Never execute supplier page scripts. */ }
  }
  // Product groups, multiple variants and missing strong identities require operator confirmation.
  if (found.length !== 1 || found[0].hasVariant || found[0].isVariantOf) return null;
  const p = found[0];
  if (typeof p.sku !== "string" || typeof p.name !== "string" || !p.sku.trim()) return null;
  if (expectedPartNumber && p.sku.trim().toUpperCase() !== expectedPartNumber.toUpperCase()) return null;
  const gtins = [p.gtin,p.gtin8,p.gtin12,p.gtin13,p.gtin14].filter(value => typeof value === "string");
  const parsed = productSchema.safeParse({ supplier,partNumber:p.sku,name:p.name,description:typeof p.description === "string" ? p.description.replace(/<[^>]*>/g,"").slice(0,240) : "", url,gtins });
  return parsed.success ? parsed.data : null;
}
export async function lookupSupplierProduct(supplier: Supplier, original: string, expectedPartNumber?: string): Promise<SupplierProduct | null> {
  if (!allowed(supplier,original)) return null;
  let target=original;
  try {
    for (let redirects=0;redirects<=2;redirects++) {
      const response=await fetch(target,{redirect:"manual",signal:AbortSignal.timeout(5000),headers:{Accept:"text/html","User-Agent":"SmartWall/1.0"}});
      if (response.status>=300 && response.status<400) {
        const location=response.headers.get("location"); await response.body?.cancel(); if (!location) return null;
        target=new URL(location,target).href; if (!allowed(supplier,target)) return null; continue;
      }
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html") || !response.body) return null;
      const reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
      try {
        while (true) { const chunk=await reader.read(); if (chunk.done) break; bytes+=chunk.value.length; if (bytes>2*1024*1024) {await reader.cancel();return null;} chunks.push(chunk.value); }
      } finally { reader.releaseLock(); }
      return structuredSupplierProduct(supplier,original,Buffer.concat(chunks).toString("utf8"),expectedPartNumber);
    }
  } catch { /* Offline, protected or ambiguous supplier pages fall back to learned mapping. */ }
  return null;
}
