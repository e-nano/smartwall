import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, createPart, learnPartUnitWeight, assignPart } from "./db.js";
import { gtin, parseScan, productSchema, scanKey, supplierKey, trustedSupplierUrl, type SupplierProduct } from "./scan-parsers.js";

type Row = Record<string, any>;
export class IntakeError extends Error { constructor(public status: number, message: string) { super(message); } }
export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const value = fn(); db.exec("COMMIT"); return value; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
const now = () => new Date().toISOString();
export function enqueue(type: string, id: string, record: Row) {
  db.prepare(`INSERT INTO sync_outbox (event_id, entity_type, entity_id, operation, payload_json, created_at)
    VALUES (?, 'goods_in', ?, 'upsert', ?, ?)`)
    .run(randomUUID(), `${type}:${id}`, JSON.stringify({ ...record, record_type: type, id }), now());
}
export function audit(action: string, details: Row) {
  const record = { id: randomUUID(), action, actor: "operator_station", ...details, created_at: now() };
  db.prepare("INSERT INTO goods_in_audit (id, data_json) VALUES (?, ?)").run(record.id, JSON.stringify(record));
  enqueue("audit", record.id, record);
}

db.exec(`
 CREATE TABLE IF NOT EXISTS supplier_items (
   item_id TEXT PRIMARY KEY, supplier TEXT NOT NULL, part_number TEXT NOT NULL,
   part_id TEXT NOT NULL REFERENCES parts(part_id), data_json TEXT NOT NULL,
   UNIQUE(supplier, part_number)
 );
 CREATE TABLE IF NOT EXISTS scan_identifiers (
   identifier_id TEXT PRIMARY KEY, identifier_key TEXT NOT NULL UNIQUE,
   raw_value TEXT NOT NULL, part_id TEXT NOT NULL REFERENCES parts(part_id),
   item_id TEXT REFERENCES supplier_items(item_id), data_json TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS supplier_catalog (
   catalogue_id TEXT PRIMARY KEY, supplier TEXT NOT NULL, part_number TEXT NOT NULL,
   data_json TEXT NOT NULL, UNIQUE(supplier, part_number)
 );
 CREATE TABLE IF NOT EXISTS goods_in_intakes (
   intake_id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE,
   bin_id TEXT NOT NULL, part_id TEXT NOT NULL REFERENCES parts(part_id),
   state TEXT NOT NULL, data_json TEXT NOT NULL
 );
 CREATE UNIQUE INDEX IF NOT EXISTS active_goods_in_bin ON goods_in_intakes(bin_id)
   WHERE state IN ('preparing','awaiting_fill','awaiting_confirmation','confirming');
 CREATE TABLE IF NOT EXISTS goods_in_audit (id TEXT PRIMARY KEY, data_json TEXT NOT NULL);
`);
const json = (row?: Row) => row ? JSON.parse(row.data_json) as Row : null;
export function part(id: string): Row | undefined { return db.prepare("SELECT * FROM parts WHERE part_id = ?").get(id) as Row | undefined; }
function item(supplier: string, number: string) { return db.prepare("SELECT * FROM supplier_items WHERE supplier = ? AND part_number = ?").get(supplier, number) as Row | undefined; }
function alias(key: string) { return db.prepare("SELECT * FROM scan_identifiers WHERE identifier_key = ?").get(key) as Row | undefined; }
function createComponent(name: string, description = "", product?: SupplierProduct) {
  return createPart({ partId: "part-" + randomUUID(), name, description, category: "Other", subcategory: "Other",
    headType: "Not applicable", measurementSystem: "Not applicable", nominalDiameter: "Not applicable", nominalLength: "Not applicable",
    accuProductCode: product?.supplier === "Accu" ? product.partNumber : "", accuOrderQuantity: product?.packageQuantity ?? 0,
    reorderLevel: 0 }) as Row;
}
function saveItem(component: Row, product: Partial<SupplierProduct> & { supplier: SupplierProduct["supplier"]; partNumber: string }) {
  const existing = item(product.supplier, product.partNumber);
  if (existing) {
    if (existing.part_id !== component.part_id) throw new IntakeError(409, "Supplier item already belongs to another component");
    return existing.item_id as string;
  }
  const record = { ...product, item_id: randomUUID(), part_id: component.part_id, created_at: now() };
  db.prepare("INSERT INTO supplier_items VALUES (?, ?, ?, ?, ?)").run(record.item_id, product.supplier, product.partNumber, component.part_id, JSON.stringify(record));
  enqueue("supplier_item", record.item_id, record);
  return record.item_id;
}
function saveAlias(key: string, raw: string, componentId: string, itemId: string | null, symbology: string, source: string) {
  const existing = alias(key);
  if (existing && existing.part_id !== componentId) throw new IntakeError(409, "Identifier already belongs to another component; explicit remapping is required");
  const previous = json(existing);
  const record = { identifier_id: existing?.identifier_id ?? randomUUID(), identifier_key: key, raw_value: previous?.raw_value ?? raw,
    last_raw_value: raw, part_id: componentId, item_id: existing?.item_id ?? itemId, symbology, source,
    first_seen: previous?.first_seen ?? now(), last_seen: now() };
  db.prepare(`INSERT INTO scan_identifiers VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(identifier_key)
    DO UPDATE SET data_json = excluded.data_json`).run(record.identifier_id, key, record.raw_value, componentId, record.item_id, JSON.stringify(record));
  enqueue("scan_identifier", record.identifier_id, record);
}
export function catalogue() { return (db.prepare("SELECT * FROM supplier_catalog ORDER BY supplier, part_number").all() as Row[]).map(row => json(row)!); }
export function importCatalogue(input: unknown, source = "operator_verified") {
  const parsed = z.object({ verified: z.literal(true), products: z.array(productSchema).min(1).max(1000) }).parse(input);
  for (const p of parsed.products) {
    if (p.url && !trustedSupplierUrl(p.supplier, p.url)) throw new IntakeError(400, "Supplier URL must be an HTTPS URL on that supplier's domain");
    if (p.gtins.some(code => !gtin(code))) throw new IntakeError(400, "Product has an invalid GTIN check digit");
  }
  return transaction(() => {
    for (const p of parsed.products) {
      const product = { ...p, gtins: p.gtins.map(code => gtin(code)!), verified: true, verified_at: now(), verification_source: source };
      const previous = db.prepare("SELECT * FROM supplier_catalog WHERE supplier = ? AND part_number = ?").get(p.supplier, p.partNumber) as Row | undefined;
      const id = previous?.catalogue_id ?? randomUUID();
      db.prepare(`INSERT INTO supplier_catalog VALUES (?, ?, ?, ?) ON CONFLICT(supplier,part_number)
        DO UPDATE SET data_json = excluded.data_json`).run(id, p.supplier, p.partNumber, JSON.stringify({ ...product, catalogue_id: id }));
      enqueue("catalogue", id, { ...product, catalogue_id: id });
    }
    audit("catalogue_verified", { count: parsed.products.length, source });
    return { imported: parsed.products.length };
  });
}
function identities(raw: string, parsed: ReturnType<typeof parseScan>) {
  return [scanKey(raw), ...(parsed.supplier && parsed.partNumber ? [supplierKey(parsed.supplier, parsed.partNumber)] : []), ...(parsed.gtin ? ["gtin:" + parsed.gtin] : [])];
}
function candidates(raw: string, parsed: ReturnType<typeof parseScan>, products: Row[]) {
  const ids = new Set<string>();
  for (const key of identities(raw, parsed)) { const found = alias(key); if (found) ids.add(found.part_id); }
  const checkSupplier = (supplier: string, number: string) => {
    const found = item(supplier, number); if (found) ids.add(found.part_id);
    if (supplier === "Accu") for (const legacy of db.prepare("SELECT part_id FROM parts WHERE upper(trim(accu_product_code)) = ?").all(number) as Row[]) ids.add(legacy.part_id);
  };
  if (parsed.supplier && parsed.partNumber) checkSupplier(parsed.supplier, parsed.partNumber);
  for (const p of products) {
    checkSupplier(p.supplier, p.partNumber);
    for (const code of p.gtins ?? []) { const found = alias("gtin:" + code); if (found) ids.add(found.part_id); }
  }
  return [...ids].map(id => part(id)!);
}
function matchedProducts(parsed: ReturnType<typeof parseScan>) {
  return catalogue().filter(p => (parsed.supplier && parsed.partNumber && p.supplier === parsed.supplier && p.partNumber === parsed.partNumber) || (parsed.gtin && p.gtins.includes(parsed.gtin)) || (parsed.url && parsed.supplier === p.supplier && parsed.url === p.url));
}
export function resolveScan(raw: string, symbology: string) {
  const parsed = parseScan(raw, symbology);
  if (parsed.rejected) return { status: "rejected", message: parsed.rejected, parsed };
  return transaction(() => {
    const products = matchedProducts(parsed);
    const matches = candidates(raw, parsed, products);
    if (matches.length > 1 || (products.length > 1 && matches.length === 0)) {
      audit("scan_conflict", { raw_value: raw, candidates: matches.map(p => p.part_id) });
      return { status: "conflict", parsed, candidates: matches, message: "Strong identifiers disagree. Select a component and explicitly resolve the conflict." };
    }
    const existing = matches[0];
    const product = products[0] as SupplierProduct | undefined;
    if (!existing && !product) return { status: parsed.confidence === "medium" ? "confirmation_required" : "mapping_required", parsed };
    const component = existing ?? createComponent(product!.name, product!.description, product);
    const itemId = product ? saveItem(component, product) : parsed.supplier && parsed.partNumber ? saveItem(component, parsed as any) : null;
    const keys = new Set([...identities(raw, parsed), ...(product ? [supplierKey(product.supplier, product.partNumber), ...product.gtins.map(code => "gtin:" + gtin(code)!)] : [])]);
    for (const key of keys) saveAlias(key, raw, component.part_id, itemId, parsed.symbology, existing ? "resolved" : "verified_catalogue");
    audit(existing ? "scan_resolved" : "component_created_automatically", { raw_value: raw, part_id: component.part_id, parser: parsed.parser });
    return { status: "resolved", component, parsed: { ...parsed, confidence: "high" }, created: !existing, product: product ?? json(itemId ? db.prepare("SELECT * FROM supplier_items WHERE item_id = ?").get(itemId) as Row : undefined) };
  });
}
export function mapScan(input: { raw: string; symbology: string; partId?: string; name?: string; description?: string; productVerified: true; remap?: boolean; reason?: string }) {
  const parsed = parseScan(input.raw, input.symbology);
  if (parsed.rejected) throw new IntakeError(400, parsed.rejected);
  return transaction(() => {
    const products = matchedProducts(parsed);
    const matches = candidates(input.raw, parsed, products);
    let component = input.partId ? part(input.partId) : undefined;
    if (input.partId && !component) throw new IntakeError(404, "Component not found");
    if (!component && matches.length) throw new IntakeError(409, "Existing strong identifiers must be resolved before creating a component");
    const keys = [...new Set([...identities(input.raw, parsed), ...products.flatMap(p =>
      [supplierKey(p.supplier,p.partNumber), ...(p.gtins ?? []).map((code: string) => "gtin:" + code)])])];
    const conflicts = keys.map(key => alias(key)).filter(row => row && row.part_id !== component?.part_id) as Row[];
    const supplierConflict = parsed.supplier && parsed.partNumber ? item(parsed.supplier, parsed.partNumber) : undefined;
    if ((conflicts.length || (supplierConflict && supplierConflict.part_id !== component?.part_id) || matches.some(p => p.part_id !== component?.part_id)) && (!input.remap || !input.reason?.trim())) {
      throw new IntakeError(409, "Confirm explicit remapping and provide a reason to resolve this conflict");
    }
    if (!component) {
      if (!input.name?.trim()) throw new IntakeError(400, "Enter a component name");
      component = createComponent(input.name.trim(), input.description ?? "");
      if (parsed.supplier === "Accu" && parsed.partNumber) {
        db.prepare("UPDATE parts SET accu_product_code=? WHERE part_id=?").run(parsed.partNumber,component.part_id);
        component = part(component.part_id)!;
      }
      audit("component_created_manually", { part_id: component.part_id, raw_value: input.raw });
    }
    const supplierReferences = [...products, ...(parsed.supplier && parsed.partNumber ? [{supplier:parsed.supplier,partNumber:parsed.partNumber}] : [])];
    for (const reference of supplierReferences) {
      const previous = item(reference.supplier,reference.partNumber);
      if (previous && previous.part_id !== component.part_id) {
        const record = { ...json(previous), part_id: component.part_id, remapped_at: now() };
        db.prepare("UPDATE supplier_items SET part_id=?,data_json=? WHERE item_id=?").run(component.part_id,JSON.stringify(record),previous.item_id);
        enqueue("supplier_item",previous.item_id,record);
        for (const identifier of db.prepare("SELECT * FROM scan_identifiers WHERE item_id=?").all(previous.item_id) as Row[]) {
          const changed = { ...json(identifier), part_id: component.part_id, remapped_at: now() };
          db.prepare("UPDATE scan_identifiers SET part_id=?,data_json=? WHERE identifier_id=?").run(component.part_id,JSON.stringify(changed),identifier.identifier_id);
          enqueue("scan_identifier",identifier.identifier_id,changed);
          audit("identifier_remapped",{identifier_key:identifier.identifier_key,previous_part_id:identifier.part_id,part_id:component.part_id,reason:input.reason});
        }
      }
      if (reference.supplier === "Accu" && input.remap) {
        const legacy = db.prepare("SELECT part_id FROM parts WHERE upper(trim(accu_product_code))=? AND part_id<>?").all(reference.partNumber,component.part_id) as Row[];
        for (const old of legacy) {
          db.prepare("UPDATE parts SET accu_product_code='' WHERE part_id=?").run(old.part_id);
          audit("legacy_supplier_reference_remapped",{previous_part_id:old.part_id,part_id:component.part_id,part_number:reference.partNumber,reason:input.reason});
        }
      }
    }
    const itemId = parsed.supplier && parsed.partNumber ? saveItem(component, parsed as any) : products[0] ? saveItem(component,products[0] as SupplierProduct) : null;
    for (const key of keys) {
      const previous = alias(key);
      if (previous && previous.part_id !== component.part_id) {
        const record = { ...json(previous), part_id: component.part_id, item_id: itemId, remapped_at: now(), last_seen: now() };
        db.prepare("UPDATE scan_identifiers SET part_id = ?, item_id = ?, data_json = ? WHERE identifier_key = ?").run(component.part_id, itemId, JSON.stringify(record), key);
        enqueue("scan_identifier", previous.identifier_id, record);
        audit("identifier_remapped", { identifier_key: key, previous_part_id: previous.part_id, part_id: component.part_id, reason: input.reason });
      } else saveAlias(key, input.raw, component.part_id, itemId, parsed.symbology, "operator_verified");
    }
    audit("mapping_learned", { raw_value: input.raw, part_id: component.part_id, reason: input.reason ?? "Operator confirmed a product identifier" });
    return { status: "resolved", component, parsed, created: !input.partId };
  });
}
export function getIntake(id: string): Row {
  const result = json(db.prepare("SELECT * FROM goods_in_intakes WHERE intake_id = ?").get(id) as Row | undefined);
  if (!result) throw new IntakeError(404, "Intake not found");
  return result;
}
export function saveIntake(record: Row) {
  record.updated_at = now();
  db.prepare(`INSERT INTO goods_in_intakes VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(intake_id)
    DO UPDATE SET state = excluded.state, data_json = excluded.data_json`).run(record.intake_id, record.request_key, record.bin_id, record.part_id, record.state, JSON.stringify(record));
  enqueue("intake", record.intake_id, record);
  return record;
}
export function binMeasurement(id: string) {
  const bin = db.prepare("SELECT * FROM bins WHERE bin_id = ?").get(id) as Row | undefined;
  if (!bin) throw new IntakeError(404, "Bin not found");
  if (!bin.online || !bin.last_seen || Date.now() - Date.parse(bin.last_seen) > 45000) throw new IntakeError(409, "Bin must be online with a fresh reading");
  if (!bin.measurement_stable || bin.net_weight_grams === null) throw new IntakeError(409, "Wait for a stable bin measurement");
  return bin;
}
export function prepareIntake(input: { requestKey: string; partId: string; binId: string; raw: string }) {
  return transaction(() => {
    const previous = json(db.prepare("SELECT * FROM goods_in_intakes WHERE request_key = ?").get(input.requestKey) as Row | undefined);
    if (previous) {
      if (previous.bin_id !== input.binId || previous.part_id !== input.partId || previous.raw_value !== input.raw) throw new IntakeError(409, "Request key already used for another intake");
      return { intake: previous, duplicate: true };
    }
    const component = part(input.partId);
    if (!component) throw new IntakeError(404, "Component not found");
    const known = alias(scanKey(input.raw));
    if (!known || known.part_id !== component.part_id) throw new IntakeError(409, "Resolve the scan to this component before restocking");
    const bin = binMeasurement(input.binId);
    if (bin.part_id && bin.part_id !== component.part_id) throw new IntakeError(409, "This bin is assigned to another component. Empty and clear it before reuse.");
    if ((!component.weight_calibrated || !bin.part_id) && Math.abs(bin.net_weight_grams) > 0.2) throw new IntakeError(409, "For the first fill, empty and tare the bin before starting");
    const active = db.prepare("SELECT intake_id FROM goods_in_intakes WHERE bin_id = ? AND state IN ('preparing','awaiting_fill','awaiting_confirmation','confirming')").get(input.binId);
    if (active) throw new IntakeError(409, "This bin already has an active intake");
    const record: Row = { intake_id: randomUUID(), request_key: input.requestKey, bin_id: input.binId, part_id: input.partId,
      part_name: component.name, raw_value: input.raw, state: "preparing", baseline_weight: bin.net_weight_grams,
      baseline_quantity: component.weight_calibrated ? bin.estimated_quantity ?? Math.round(Math.max(0,bin.net_weight_grams) / component.unit_weight_grams) : 0,
      learned_weight: Boolean(component.weight_calibrated), unit_weight: component.weight_calibrated ? component.unit_weight_grams : null,
      started_at: now(), expires_at: new Date(Date.now() + 10 * 60000).toISOString(), assigned_before: Boolean(bin.part_id), command_ids: [] };
    saveIntake(record); audit("intake_started", { intake_id: record.intake_id, part_id: input.partId, bin_id: input.binId });
    return { intake: record, duplicate: false };
  });
}
export function observeIntakes(binId?: string) {
  const active = db.prepare("SELECT * FROM goods_in_intakes WHERE state IN ('preparing','awaiting_fill','awaiting_confirmation','confirming')").all() as Row[];
  for (const row of active) {
    const intake = json(row)!;
    if (binId && intake.bin_id !== binId) continue;
    if (Date.parse(intake.expires_at) < Date.now()) { intake.state = "timed_out"; saveIntake(intake); audit("intake_timed_out", { intake_id: intake.intake_id }); continue; }
    if (["preparing", "confirming"].includes(intake.state)) continue;
    const bin = db.prepare("SELECT * FROM bins WHERE bin_id = ?").get(intake.bin_id) as Row | undefined;
    if (!bin || bin.part_id !== intake.part_id || !bin.online || !bin.measurement_stable || bin.net_weight_grams === null ||
      Date.parse(bin.last_seen) <= Date.parse(intake.started_at) || Date.now() - Date.parse(bin.last_seen) > 45000) continue;
    const delta = bin.net_weight_grams - intake.baseline_weight;
    if (delta <= 0 || (intake.unit_weight && delta < intake.unit_weight * 0.5)) continue;
    if (intake.observed_weight === bin.net_weight_grams && intake.observed_at === bin.last_seen) continue;
    intake.observed_weight = bin.net_weight_grams; intake.observed_at = bin.last_seen;
    intake.estimated_added = intake.unit_weight ? Math.round(delta / intake.unit_weight) : null;
    const reliable = intake.unit_weight && Math.abs(delta / intake.unit_weight - intake.estimated_added) <= 0.2 && intake.estimated_added > 0;
    // Existing observed_restock events remain the only scale stock movements; this receipt links to them.
    intake.movement_event_ids = (db.prepare("SELECT event_id FROM inventory_events WHERE bin_id = ? AND part_id = ? AND event_type = 'observed_restock' AND created_at >= ?").all(intake.bin_id, intake.part_id, intake.started_at) as Row[]).map(row => row.event_id);
    intake.state = reliable ? "completed" : "awaiting_confirmation";
    if (reliable) {
      if (!intake.movement_event_ids.length) {
        const id = randomUUID();
        db.prepare(`INSERT INTO inventory_events (event_id,bin_id,part_id,event_type,quantity_delta,previous_quantity,new_quantity,source,created_at)
          VALUES (?, ?, ?, 'observed_restock', ?, ?, ?, 'goods_in_scale', ?)`)
          .run(id,intake.bin_id,intake.part_id,intake.estimated_added,intake.baseline_quantity,intake.baseline_quantity+intake.estimated_added,now());
        intake.movement_event_ids = [id];
      }
      intake.quantity_added = intake.estimated_added; intake.completed_at = now(); audit("intake_completed", { intake_id: intake.intake_id, quantity_added: intake.quantity_added, source: "load_cell" }); }
    saveIntake(intake);
  }
}
export function listIntakes() { observeIntakes(); return (db.prepare("SELECT * FROM goods_in_intakes ORDER BY rowid DESC LIMIT 100").all() as Row[]).map(row => json(row)!); }
export function confirmationPlan(id: string, count: number) {
  const intake = getIntake(id);
  if (intake.state === "completed") {
    if (intake.confirmed_count && intake.confirmed_count !== count) throw new IntakeError(409, "This receipt was already confirmed with a different count");
    return { intake, duplicate: true, unitWeight: null };
  }
  if (intake.state !== "awaiting_confirmation") throw new IntakeError(409, "Wait for a stable positive weight change before confirming");
  if (Date.parse(intake.expires_at) <= Date.now()) {
    observeIntakes(intake.bin_id);
    throw new IntakeError(409, "This intake expired. Start a new intake before adding stock.");
  }
  const bin = binMeasurement(intake.bin_id);
  if (bin.part_id !== intake.part_id || bin.net_weight_grams <= intake.baseline_weight) throw new IntakeError(409, "The stocked bin must have a stable positive weight change");
  if (intake.learned_weight && count !== Math.round((bin.net_weight_grams - intake.baseline_weight) / intake.unit_weight)) throw new IntakeError(409, "Count differs from the scale estimate. Relearn the component weight before completing this intake.");
  return { intake, duplicate: false, unitWeight: intake.learned_weight ? null : (bin.net_weight_grams - intake.baseline_weight) / count, weight: bin.net_weight_grams };
}
export function finishConfirmation(id: string, count: number, unitWeight: number | null, weight: number) {
  return transaction(() => {
    const intake = getIntake(id);
    if (intake.state === "completed") return intake;
    if (intake.state !== "confirming") throw new IntakeError(409, "Intake is not being confirmed");
    const bin = binMeasurement(intake.bin_id);
    if (Math.abs(bin.net_weight_grams - weight) > Math.max(0.01, (unitWeight ?? intake.unit_weight ?? 0.1) * 0.1)) throw new IntakeError(409, "The bin changed during confirmation; wait for a stable reading and retry");
    if (unitWeight) {
      learnPartUnitWeight(intake.part_id, unitWeight); assignPart(intake.bin_id, intake.part_id, count);
      const eventId = randomUUID();
      db.prepare(`INSERT INTO inventory_events (event_id, bin_id, part_id, event_type, quantity_delta,
        previous_quantity, new_quantity, source, created_at) VALUES (?, ?, ?, 'observed_restock', ?, 0, ?, 'goods_in_confirmed', ?)`)
        .run(eventId, intake.bin_id, intake.part_id, count, count, now());
      intake.movement_event_ids = [eventId];
    }
    intake.state = "completed"; intake.quantity_added = count; intake.confirmed_count = count; intake.completed_at = now();
    if (unitWeight) intake.learned_unit_weight = unitWeight;
    saveIntake(intake); audit("intake_confirmed", { intake_id: id, quantity_added: count, learned_unit_weight: unitWeight });
    return intake;
  });
}
export function cancelIntake(id: string) {
  const intake = getIntake(id);
  if (["completed", "confirming", "preparing"].includes(intake.state)) throw new IntakeError(409, "This intake cannot be cancelled in its current state");
  intake.state = "cancelled"; saveIntake(intake); audit("intake_cancelled", { intake_id: id }); return intake;
}
export function supplierItems() { return (db.prepare("SELECT * FROM supplier_items").all() as Row[]).map(row => json(row)!); }
export function scanIdentifiers() { return (db.prepare("SELECT * FROM scan_identifiers").all() as Row[]).map(row => json(row)!); }

// Existing verified Accu fields become supplier records only when their identity is unambiguous.
transaction(() => {
  for (const component of db.prepare("SELECT * FROM parts WHERE trim(accu_product_code) <> ''").all() as Row[]) {
    const number = component.accu_product_code.trim().toUpperCase();
    if ((db.prepare("SELECT count(*) AS n FROM parts WHERE upper(trim(accu_product_code)) = ?").get(number) as Row).n !== 1 || item("Accu", number)) continue;
    const itemId = saveItem(component, { supplier: "Accu", partNumber: number, name: component.name, description: component.description });
    saveAlias(supplierKey("Accu", number), number, component.part_id, itemId, "supplier_code", "legacy_verified_accu");
    audit("legacy_supplier_migrated", { part_id: component.part_id, supplier: "Accu", part_number: number });
  }
});

export function importCompanyCatalogue(input: unknown, ownSiteId: string) {
  const bundle = z.object({ records: z.array(z.record(z.unknown())).max(50000), components: z.array(z.record(z.unknown())).max(50000) }).parse(input);
  let imported = 0;
  const report = (key: string, details: Row) => {
    const setting = "goods_in_conflict:" + key;
    if (db.prepare("SELECT 1 FROM app_settings WHERE setting_key=?").get(setting)) return;
    db.prepare("INSERT INTO app_settings VALUES (?, '1', ?)").run(setting, now());
    audit("company_mapping_conflict", details);
  };
  return transaction(() => {
    for (const record of bundle.records.filter(row => row.record_type === "catalogue" && row.site_id !== ownSiteId)) {
      const parsed = productSchema.safeParse(record);
      if (!parsed.success || record.verified !== true) continue;
      const p = parsed.data;
      if ((p.url && !trustedSupplierUrl(p.supplier, p.url)) || p.gtins.some(code => !gtin(code))) continue;
      const existing = db.prepare("SELECT 1 FROM supplier_catalog WHERE supplier=? AND part_number=?").get(p.supplier, p.partNumber);
      if (existing) continue; // Locally verified metadata always wins; do not echo cached records back to the cloud.
      const id = randomUUID();
      db.prepare("INSERT INTO supplier_catalog VALUES (?, ?, ?, ?)").run(id, p.supplier, p.partNumber, JSON.stringify({ ...p, gtins: p.gtins.map(code => gtin(code)!), catalogue_id: id, verified: true, source_wall: record.site_id }));
      imported++;
    }
    for (const remote of bundle.components.filter(p => p.site_id !== ownSiteId)) {
      if (typeof remote.part_id !== "string" || typeof remote.name !== "string" || remote.name.length > 100) continue;
      const remoteItems = bundle.records.filter(row => row.site_id === remote.site_id && row.record_type === "supplier_item" && row.part_id === remote.part_id);
      const remoteAliases = bundle.records.filter(row => row.site_id === remote.site_id && row.record_type === "scan_identifier" && row.part_id === remote.part_id);
      if (!remoteAliases.length) continue;
      const localIds = new Set<string>();
      for (const entry of remoteItems) {
        const parsed = productSchema.pick({ supplier: true, partNumber: true }).safeParse(entry);
        if (!parsed.success) continue;
        const match = item(parsed.data.supplier, parsed.data.partNumber); if (match) localIds.add(match.part_id);
        if (parsed.data.supplier === "Accu") for (const p of db.prepare("SELECT part_id FROM parts WHERE upper(trim(accu_product_code))=?").all(parsed.data.partNumber) as Row[]) localIds.add(p.part_id);
      }
      for (const entry of remoteAliases) {
        if (typeof entry.identifier_key !== "string") continue;
        const match = alias(entry.identifier_key); if (match) localIds.add(match.part_id);
      }
      if (localIds.size > 1) { report(`${remote.site_id}:${remote.part_id}`, { source_wall: remote.site_id, source_part_id: remote.part_id, candidates: [...localIds] }); continue; }
      const mapKey = `goods_in_component:${remote.site_id}:${remote.part_id}`;
      const stored = db.prepare("SELECT setting_value FROM app_settings WHERE setting_key=?").get(mapKey) as Row | undefined;
      let component = localIds.size ? part([...localIds][0]!) : stored ? part(stored.setting_value) : undefined;
      if (!component) {
        // An imported unit weight is not a local load-cell calibration.
        component = createComponent(remote.name, typeof remote.description === "string" ? remote.description.slice(0, 240) : "");
        db.prepare("INSERT INTO app_settings VALUES (?, ?, ?)").run(mapKey, component.part_id, now());
      }
      for (const entry of remoteItems) {
        const parsed = productSchema.pick({ supplier: true, partNumber: true }).safeParse(entry);
        if (!parsed.success || item(parsed.data.supplier, parsed.data.partNumber)) continue;
        const id = randomUUID();
        db.prepare("INSERT INTO supplier_items VALUES (?, ?, ?, ?, ?)").run(id, parsed.data.supplier, parsed.data.partNumber, component.part_id,
          JSON.stringify({ ...entry, ...parsed.data, item_id: id, part_id: component.part_id, source_wall: remote.site_id }));
        imported++;
      }
      for (const entry of remoteAliases) {
        const parsed = z.object({ identifier_key: z.string().min(1).max(250), raw_value: z.string().min(1).max(2048), symbology: z.string().max(30).default("unknown") }).safeParse(entry);
        if (!parsed.success || parseScan(parsed.data.raw_value).rejected) continue;
        const old = alias(parsed.data.identifier_key);
        if (old) {
          if (old.part_id !== component.part_id) report(parsed.data.identifier_key, { identifier_key: parsed.data.identifier_key, source_wall: remote.site_id, part_id: old.part_id, proposed_part_id: component.part_id });
          continue;
        }
        const id = randomUUID();
        const localItem = remoteItems.find(row => row.item_id === entry.item_id);
        const itemId = localItem && typeof localItem.supplier === "string" && typeof localItem.partNumber === "string" ? item(localItem.supplier, localItem.partNumber)?.item_id ?? null : null;
        db.prepare("INSERT INTO scan_identifiers VALUES (?, ?, ?, ?, ?, ?)").run(id, parsed.data.identifier_key, parsed.data.raw_value, component.part_id, itemId,
          JSON.stringify({ ...entry, ...parsed.data, identifier_id: id, part_id: component.part_id, item_id: itemId, source_wall: remote.site_id }));
        imported++;
      }
    }
    return { imported };
  });
}


export function seedGoodsInSync() {
  transaction(()=>{
    for(const [table,type,key] of [["supplier_catalog","catalogue","catalogue_id"],["supplier_items","supplier_item","item_id"],["scan_identifiers","scan_identifier","identifier_id"],["goods_in_intakes","intake","intake_id"],["goods_in_audit","audit","id"]] as const) {
      for(const row of db.prepare(`SELECT ${key},data_json FROM ${table}`).all() as Row[]) enqueue(type,row[key],JSON.parse(row.data_json));
    }
  });
}
