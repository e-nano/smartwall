import { createHash } from "node:crypto";
import { z } from "zod";

export const suppliers = ["Accu", "RS", "Farnell", "DigiKey", "Mouser"] as const;
export type Supplier = typeof suppliers[number];
export const supplierSchema = z.enum(suppliers);
export const productSchema = z.object({
  supplier: supplierSchema,
  partNumber: z.string().trim().min(1).max(100).transform(value => value.toUpperCase()),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(240).default(""),
  url: z.string().url().max(1024).optional(),
  gtins: z.array(z.string().regex(/^\d{8,14}$/)).max(20).default([]),
  packageQuantity: z.number().int().positive().max(10000000).optional(),
  unitWeightEstimate: z.number().positive().optional(),
  metadata: z.record(z.string().max(100)).default({})
});
export type SupplierProduct = z.infer<typeof productSchema>;
const domains: Record<Supplier, string[]> = {
  Accu: ["accu.co.uk", "accu-components.com", "accu.co"],
  RS: ["rs-online.com"], Farnell: ["farnell.com", "newark.com", "element14.com"],
  DigiKey: ["digikey.com", "digikey.co.uk"], Mouser: ["mouser.com", "mouser.co.uk"]
};
export function trustedSupplierUrl(supplier: Supplier, raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password &&
      domains[supplier].some(domain => url.hostname === domain || url.hostname.endsWith("." + domain));
  } catch { return false; }
}
export function gtin(raw: string): string | null {
  if (![8, 12, 13, 14].includes(raw.length) || !/^\d+$/.test(raw)) return null;
  let sum = 0;
  for (let i = raw.length - 2, multiplier = 3; i >= 0; i--, multiplier = multiplier === 3 ? 1 : 3) sum += Number(raw[i]) * multiplier;
  return (10 - sum % 10) % 10 === Number(raw.at(-1)) ? raw.padStart(14, "0") : null;
}
export const scanKey = (value: string) => "raw:" + createHash("sha256").update(value.trim()).digest("hex");
export const supplierKey = (supplier: Supplier, partNumber: string) => `sku:${supplier}:${partNumber.trim().toUpperCase()}`;
export type ParsedScan = {
  supplier?: Supplier; partNumber?: string; name?: string; description?: string; url?: string;
  gtin?: string; packageQuantity?: number; symbology: string; parser: string;
  confidence: "unknown" | "medium"; rejected?: string;
};
export function parseScan(raw: string, symbology = "unknown"): ParsedScan {
  let value = raw.trim();
  const aim = value.match(/^\]([A-Za-z][0-9])/);
  if (aim) { symbology = aim[1]!; value = value.slice(3); }
  if (/\b(?:tracking|shipment|consignment|waybill)\b/i.test(value) || /(?:dhl|fedex|royalmail|dpd|ups)\.(?:com|co\.uk)/i.test(value)) {
    return { symbology, parser: "ShipmentGuard", confidence: "unknown", rejected: "This looks like a shipment/tracking label. Scan the product label instead." };
  }
  try {
    const label = z.object({ supplier: supplierSchema, partNumber: z.string().trim().min(1).max(100),
      name: z.string().max(100).optional(), description: z.string().max(240).optional(),
      packageQuantity: z.number().int().positive().optional() }).parse(JSON.parse(value));
    return { ...label, partNumber: label.partNumber.toUpperCase(), symbology, parser: label.supplier + "Parser", confidence: "medium" };
  } catch { /* Untrusted label JSON is never sufficient for automatic creation. */ }
  const prefixed = value.match(/^(ACCU|APC|RS|FARNELL|DIGIKEY|MOUSER)\s*:\s*([A-Za-z0-9][A-Za-z0-9._/+ -]{0,99})$/i);
  if (prefixed) {
    const supplier = prefixed[1]!.toUpperCase() === "APC" ? "Accu" : suppliers.find(name => name.toUpperCase() === prefixed[1]!.toUpperCase())!;
    return { supplier, partNumber: prefixed[2]!.trim().toUpperCase(), symbology, parser: supplier + "Parser", confidence: "medium" };
  }
  try {
    const url = new URL(value);
    if (/\/(?:order|track|shipment|account|login)(?:\/|$)/i.test(url.pathname)) return { symbology, parser: "ShipmentGuard", confidence: "unknown", rejected: "Scan a product label, not an order or account link." };
    const supplier = suppliers.find(name => trustedSupplierUrl(name, value));
    if (supplier) {
      const segments = url.pathname.split("/").filter(Boolean);
      const code = url.searchParams.get("partNumber") || url.searchParams.get("sku") || url.searchParams.get("mpn") ||
        (supplier === "Accu" ? segments.at(-1)?.match(/^\d+-(.+)$/)?.[1] : supplier === "Farnell" ? segments.at(-1) : supplier === "RS" ? segments.at(-1)?.replace(/-$/, "") : undefined);
      return { supplier, ...(code ? { partNumber: decodeURIComponent(code).toUpperCase().slice(0, 100) } : {}), url: url.href,
        symbology, parser: supplier + "Parser", confidence: "medium" };
    }
  } catch { /* Scans are identifiers, not instructions to fetch arbitrary URLs. */ }
  const productGtin = gtin(value);
  return { ...(productGtin ? { gtin: productGtin } : {}), symbology, parser: "GenericLearnedParser", confidence: "unknown" };
}
