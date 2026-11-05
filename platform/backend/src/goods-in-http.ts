import { lookupSupplierProduct } from "./supplier-lookup.js";
import { Router } from "express";
import { z } from "zod";
import { db, assignPart } from "./db.js";
import { broadcast } from "./events.js";
import { sendBinCommand, syncPartLabels } from "./mqtt.js";
import { cancelIntake, catalogue, confirmationPlan, finishConfirmation, getIntake, importCatalogue, IntakeError, listIntakes,
  mapScan, observeIntakes, part, prepareIntake, resolveScan, saveIntake, scanIdentifiers, supplierItems } from "./goods-in.js";

const scanSchema = z.object({ raw: z.string().min(1).max(2048).refine(value => value.trim().length > 0, "Scan a product identifier"), symbology: z.string().max(30).default("unknown") });
export function createGoodsInRouter(command = sendBinCommand, updateLabels = syncPartLabels) {
  const router = Router();
  const acknowledged = async (commandId: string) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const record = db.prepare("SELECT status FROM commands WHERE command_id = ?").get(commandId) as { status: string } | undefined;
      if (record?.status === "completed") return;
      if (record?.status === "failed") throw new IntakeError(409, "The bin rejected the command. Check the bin and try again.");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new IntakeError(409, "The bin did not acknowledge the command. Check its connection and try again.");
  };
  router.get("/", (_request, response) => response.json({ intakes: listIntakes(), supplierItems: supplierItems(), identifiers: scanIdentifiers(), catalogue: catalogue(), audit: db.prepare("SELECT data_json FROM goods_in_audit ORDER BY rowid DESC LIMIT 100").all().map(row => JSON.parse(row.data_json as string)) }));
  router.post("/resolve", async (request, response) => {
    const input = scanSchema.parse(request.body);
    let result = resolveScan(input.raw,input.symbology);
    if (["confirmation_required","mapping_required"].includes(result.status) && result.parsed.supplier && result.parsed.url) {
      const product = await lookupSupplierProduct(result.parsed.supplier,result.parsed.url,result.parsed.partNumber);
      if (product) {
        try { importCatalogue({verified:true,products:[product]},"supplier_structured_data"); result=resolveScan(input.raw,input.symbology); }
        catch { /* Invalid supplier metadata must never bypass the confirmation workflow. */ }
      }
    }
    response.json(result);broadcast("goods-in",{});
  });
  router.post("/map", (request, response) => {
    const input = scanSchema.extend({ partId: z.string().min(1).max(100).optional(), name: z.string().trim().min(1).max(100).optional(),
      description: z.string().max(240).optional(), productVerified: z.literal(true), remap: z.boolean().default(false), reason: z.string().trim().max(240).optional() }).parse(request.body);
    response.json(mapScan(input)); broadcast("goods-in", {});
  });
  router.post("/catalogue", (request, response) => { response.json(importCatalogue(request.body)); broadcast("goods-in", {}); });
  router.post("/intakes", async (request, response) => {
    const input = scanSchema.extend({ requestKey: z.string().uuid(), partId: z.string().min(1).max(100), binId: z.string().min(1).max(100) }).parse(request.body);
    const prepared = prepareIntake(input);
    if (prepared.duplicate) return response.json(prepared.intake);
    const intake = prepared.intake;
    try {
      const component = part(input.partId)!;
      if (!intake.assigned_before) {
        const labelId = await command(input.binId, "set_label", { partId: input.partId, name: component.name, description: component.description, unitWeightGrams: component.unit_weight_grams });
        intake.command_ids.push(labelId); await acknowledged(labelId);
        assignPart(input.binId, input.partId, intake.learned_weight ? 0 : null);
      }
      const findId = await command(input.binId, "find", { active: true, action: "restock", timeoutSeconds: 600 });
      intake.command_ids.push(findId); await acknowledged(findId);
      intake.state = "awaiting_fill"; saveIntake(intake); observeIntakes(input.binId);
      response.status(201).json(getIntake(intake.intake_id));
    } catch (error) {
      intake.state = "failed"; intake.message = error instanceof Error ? error.message : "Bin command failed"; saveIntake(intake);
      throw error;
    } finally { broadcast("goods-in", {}); }
  });
  router.post("/intakes/:id/confirm", async (request, response) => {
    const { count } = z.object({ count: z.number().int().positive().max(10000000) }).parse(request.body);
    const plan = confirmationPlan(request.params.id, count);
    if (plan.duplicate) return response.json(plan.intake);
    const intake = plan.intake;
    intake.state = "confirming"; saveIntake(intake);
    try {
      if (plan.unitWeight) {
        const component = part(intake.part_id)!;
        const commandId = await command(intake.bin_id, "set_label", { partId: intake.part_id, name: component.name, description: component.description, unitWeightGrams: plan.unitWeight });
        await acknowledged(commandId);
      }
      const result = finishConfirmation(request.params.id, count, plan.unitWeight, plan.weight!);
      if (plan.unitWeight) await updateLabels(intake.part_id);
      await command(intake.bin_id, "find", { active: false, action: "restock" }).catch(() => {});
      response.json(result);
    } catch (error) {
      if (getIntake(intake.intake_id).state !== "completed") { intake.state = "awaiting_confirmation"; saveIntake(intake); }
      throw error;
    } finally { broadcast("goods-in", {}); }
  });
  router.post("/intakes/:id/cancel", async (request, response) => {
    const intake = cancelIntake(request.params.id);
    await command(intake.bin_id, "find", { active: false, action: "restock" }).catch(() => {});
    response.json(intake); broadcast("goods-in", {});
  });
  return router;
}
