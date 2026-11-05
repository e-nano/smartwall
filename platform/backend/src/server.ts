import { localAuthRouter } from './local-auth.js';
import { releasesRouter } from "./releases.js";
import { localAccess, localRequestGuard, validateLocalAccess, maintenanceMode } from "./local-access.js";
import { importFirmware } from "./firmware-import.js";
import { assertCompatible, type FirmwareMetadata } from "../../shared/releases.js";
import { componentSchema, componentImagesSchema, categoryPathSchema } from "../../shared/component-schema.js";
import { remoteSettings, setRemoteSettings } from "./remote-commands.js";
import { createCloudConnectRouter } from "./cloud-connect.js";
import { createGoodsInRouter } from "./goods-in-http.js";
import { IntakeError } from "./goods-in.js";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  assignPart,
  clearBinAssignment,
  db,
  createPart,
  dashboard,
  getBinMeasurement,
  getBinHardware,
  listOnlineBins,
  getFirmware,
  getPart,
  learnPartUnitWeight,
  listBins,
  listEventsSince,
  listFirmware,
  listParts,
  saveFirmware,
  updatePartClassification
} from "./db.js";
import { automaticUpdateState } from "./automatic-updates.js";
import { cloudSyncState, requestCloudSyncNow, setCloudSyncEnabled } from "./cloud-sync.js";
import { addEventListener, broadcast, listenerCount } from "./events.js";
import { mqttState, sendBinCommand, sendFleetCommand, syncPartLabels } from "./mqtt.js";
import { mqttSecurityState, setMqttCredentialsRequired } from "./mqtt-security.js";
import { firmwareManifest, validFirmwareSignature } from "./ota.js";

export const api = express();
const firmwareServer = express();
const firmwareDir = resolve(process.env.FIRMWARE_DIR ?? "./firmware");
const frontendDir = resolve(process.env.FRONTEND_DIR ?? "./frontend/dist");
const frontendIndex = resolve(frontendDir, "index.html");
mkdirSync(firmwareDir, { recursive: true });

// Minimal probes reveal no inventory, configuration or cloud account details.
api.get("/health/live", (_request, response) => response.json({ ok: true }));
api.get("/health/ready", (_request, response) => {
  try {
    db.prepare("SELECT 1").get();
    if (process.env.NODE_ENV === "production" && !existsSync(frontendIndex)) throw new Error("Frontend missing");
    response.json({ ok: true, maintenance: maintenanceMode(), version: process.env.SMARTWALL_VERSION ?? "development" });
  } catch { response.status(503).json({ ok: false }); }
});
api.use(localRequestGuard);
api.use(express.json({ limit: "1mb" }));
api.use("/api/auth", localAuthRouter());
api.use(localAccess);
api.use("/api/goods-in", createGoodsInRouter());
api.use("/api/releases", releasesRouter());
api.use("/api", (_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    callback(null, file.originalname.toLowerCase().endsWith(".bin"));
  }
});

const measurementSystems = ["Metric", "Imperial", "Not applicable"] as const;

const partSchema = componentSchema;
const partClassificationSchema = z.object({
  categoryPath: categoryPathSchema.optional(),
  name: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(100),
  subcategory: z.string().trim().min(1).max(100),
  headType: z.string().trim().min(1).max(100),
  measurementSystem: z.enum(measurementSystems),
  nominalDiameter: z.string().trim().min(1).max(40),
  nominalLength: z.string().trim().min(1).max(40),
  accuProductCode: z.string().trim().max(100).default(""),
  accuOrderQuantity: z.number().int().nonnegative().default(0)
});
const assignmentSchema = z.object({
  partId: z.string().trim().min(1).max(64),
  initialQuantity: z.number().int().positive().optional()
});
const relearnWeightSchema = z.object({
  initialQuantity: z.number().int().positive()
});
const findSchema = z.object({
  active: z.boolean().default(true),
  timeoutSeconds: z.number().int().min(1).max(3600).default(60),
  action: z.enum(["find", "pick", "restock"]).default("find")
});
const groupLightsSchema = z.object({
  binIds: z.array(z.string().trim().min(1)).min(1).max(250),
  active: z.boolean().default(true),
  timeoutSeconds: z.number().int().min(1).max(3600).default(300)
});
const eventRangeSchema = z.enum(["24h", "7d", "30d"]).default("24h");
const otaDeploySchema = z.object({
  target: z.enum(["selected", "all"]),
  binIds: z.array(z.string().min(1)).default([]),
  force: z.boolean().default(false)
});

firmwareServer.get("/firmware/:storedName", (request, response) => {
  const storedName = request.params.storedName;
  const expires = typeof request.query.expires === "string" ? request.query.expires : "";
  const signature = typeof request.query.signature === "string" ? request.query.signature : "";
  const pathname = `/firmware/${storedName}`;
  if (!/^[a-f0-9-]+\.bin$/.test(storedName) || !validFirmwareSignature(pathname, expires, signature)) {
    return response.status(403).json({ error: "Invalid or expired firmware URL" });
  }
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/octet-stream");
  response.sendFile(resolve(firmwareDir, storedName));
});

api.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    mqtt: mqttState(),
    cloudSync: cloudSyncState(),
    dashboardListeners: listenerCount()
  });
});

api.get("/api/mqtt/security", (_request, response) => response.json(mqttSecurityState()));
api.patch("/api/mqtt/security", (request, response, next) => {
  try {
    const { credentialsRequired } = z.object({ credentialsRequired: z.boolean() }).strict().parse(request.body);
    response.json(setMqttCredentialsRequired(credentialsRequired));
  } catch (error) {
    next(error);
  }
});

api.use("/api/sync/connect", createCloudConnectRouter());

api.get("/api/sync/status", (_request, response) => response.json(cloudSyncState()));
api.get("/api/sync/remote-settings", (_request,response) => response.json(remoteSettings()));
api.patch("/api/sync/remote-settings", (request,response,next) => {
  try { response.json(setRemoteSettings(z.object({ controlEnabled: z.boolean(),catalogueEnabled: z.boolean() }).strict().parse(request.body))); }
  catch (error) { next(error); }
});

api.patch("/api/sync/settings", (request, response, next) => {
  try {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
    const state = setCloudSyncEnabled(enabled);
    broadcast("cloud-sync", state);
    response.json(state);
  } catch (error) {
    next(error);
  }
});

api.post("/api/sync/run", (_request, response, next) => {
  try {
    const state = requestCloudSyncNow();
    broadcast("cloud-sync", state);
    response.status(202).json(state);
  } catch (error) {
    next(error);
  }
});

api.get("/api/stream", (request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();
  response.write(`event: ready\ndata: ${JSON.stringify({ connected: true })}\n\n`);
  addEventListener(response);
  request.on("close", () => response.end());
});

api.get("/api/dashboard", (_request, response) => response.json({
  ...dashboard(),
  mqtt: mqttState(),
  cloudSync: cloudSyncState(),
  automaticUpdates: automaticUpdateState()
}));
api.get("/api/bins", (_request, response) => response.json(listBins()));
api.get("/api/parts", (_request, response) => response.json(listParts()));
api.get("/api/events", (request, response, next) => {
  try {
    const range = eventRangeSchema.parse(request.query.range);
    const durationMs = range === "24h" ? 24 * 60 * 60 * 1000
      : range === "7d" ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
    response.json(listEventsSince(new Date(Date.now() - durationMs).toISOString()));
  } catch (error) {
    next(error);
  }
});
api.get("/api/firmware", (_request, response) => response.json(listFirmware()));

api.post("/api/parts", (request, response, next) => {
  try {
    response.status(201).json(createPart(partSchema.parse(request.body)));
  } catch (error) {
    next(error);
  }
});

api.put("/api/parts/:partId/images", (request, response, next) => {
  try {
    const images = componentImagesSchema.parse(request.body.images);
    const result = db.prepare("UPDATE parts SET images_json = ? WHERE part_id = ?").run(JSON.stringify(images), request.params.partId);
    if (!result.changes) return response.status(404).json({ error: "Part not found" });
    broadcast("parts", { partId: request.params.partId });
    response.json({ images });
  } catch (error) { next(error); }
});

api.patch("/api/parts/:partId/classification", async (request, response, next) => {
  try {
    const {
      name,
      category,
      subcategory,
      headType,
      measurementSystem,
      nominalDiameter,
      nominalLength,
      accuProductCode,
      accuOrderQuantity,
      categoryPath
    } = partClassificationSchema.parse(request.body);
    const previousPart = getPart(request.params.partId) as { name?: string } | undefined;
    const part = updatePartClassification(
      request.params.partId,
      name,
      categoryPath?.[0] ?? category,
      categoryPath?.[1] ?? (categoryPath ? "Other" : subcategory),
      headType,
      measurementSystem,
      nominalDiameter,
      nominalLength,
      accuProductCode,
      accuOrderQuantity,
      categoryPath
    );
    if (!part) return response.status(404).json({ error: "Part not found" });
    if (previousPart?.name !== name) await syncPartLabels(request.params.partId);
    response.json(part);
  } catch (error) {
    next(error);
  }
});

api.post("/api/bins/:binId/assign", async (request, response, next) => {
  try {
    const { partId, initialQuantity } = assignmentSchema.parse(request.body);
    const part = getPart(partId);
    if (!part) return response.status(404).json({ error: "Part not found" });
    const bin = getBinMeasurement(request.params.binId);
    if (!bin) return response.status(404).json({ error: "Bin not found" });
    if (!bin.online) return response.status(409).json({ error: "Bin must be online to assign a component" });

    let unitWeightGrams = part.unit_weight_grams;
    let learned = false;
    if (!part.weight_calibrated) {
      if (initialQuantity === undefined) {
        return response.status(400).json({
          error: "Enter how many pieces are in the bin to learn their individual weight"
        });
      }
      if (!bin.measurement_stable || bin.net_weight_grams === null) {
        return response.status(409).json({
          error: "Wait until the bin measurement is stable, then assign again"
        });
      }
      if (bin.net_weight_grams <= 0) {
        return response.status(409).json({
          error: "The stable net weight must be positive; tare the empty bin, add the pieces, and retry"
        });
      }
      unitWeightGrams = bin.net_weight_grams / initialQuantity;
      if (!Number.isFinite(unitWeightGrams) || unitWeightGrams <= 0) {
        return response.status(409).json({ error: "Could not calculate a valid individual weight" });
      }
      learned = true;
    }

    const commandId = await sendBinCommand(request.params.binId, "set_label", {
      partId: part.part_id,
      name: part.name,
      description: part.description,
      unitWeightGrams
    });
    if (learned) learnPartUnitWeight(partId, unitWeightGrams);
    assignPart(request.params.binId, partId, learned ? initialQuantity! : null);
    response.status(202).json({
      commandId,
      learned,
      unitWeightGrams,
      initialQuantity: learned ? initialQuantity : null
    });
  } catch (error) {
    next(error);
  }
});

api.post("/api/bins/:binId/empty", async (request, response, next) => {
  try {
    const bin = getBinMeasurement(request.params.binId);
    if (!bin) return response.status(404).json({ error: "Bin not found" });
    if (!bin.online) {
      return response.status(409).json({ error: "Bin must be online to clear its assignment" });
    }
    const commandId = await sendBinCommand(request.params.binId, "clear_assignment");
    clearBinAssignment(request.params.binId);
    response.status(202).json({ commandId });
  } catch (error) {
    next(error);
  }
});

api.post("/api/bins/:binId/relearn-weight", async (request, response, next) => {
  try {
    const { initialQuantity } = relearnWeightSchema.parse(request.body);
    const bin = getBinMeasurement(request.params.binId);
    if (!bin) return response.status(404).json({ error: "Bin not found" });
    if (!bin.online) {
      return response.status(409).json({ error: "Bin must be online to relearn weight" });
    }
    if (!bin.part_id) {
      return response.status(409).json({ error: "Assign a component before relearning its weight" });
    }
    if (!bin.measurement_stable || bin.net_weight_grams === null) {
      return response.status(409).json({ error: "Wait until the bin measurement is stable, then try again" });
    }
    if (bin.net_weight_grams <= 0) {
      return response.status(409).json({ error: "Stable net weight must be positive" });
    }
    const part = getPart(bin.part_id);
    if (!part) return response.status(404).json({ error: "Assigned component was not found" });
    const unitWeightGrams = bin.net_weight_grams / initialQuantity;
    if (!Number.isFinite(unitWeightGrams) || unitWeightGrams <= 0) {
      return response.status(409).json({ error: "Could not calculate a valid individual weight" });
    }
    const commandId = await sendBinCommand(request.params.binId, "set_label", {
      partId: part.part_id,
      name: part.name,
      description: part.description,
      unitWeightGrams
    });
    learnPartUnitWeight(part.part_id, unitWeightGrams);
    assignPart(request.params.binId, part.part_id, initialQuantity);
    response.status(202).json({ commandId, unitWeightGrams, initialQuantity });
  } catch (error) {
    next(error);
  }
});

api.post("/api/bins/:binId/find", async (request, response, next) => {
  try {
    const input = findSchema.parse(request.body);
    const commandId = await sendBinCommand(request.params.binId, "find", { ...input });
    response.status(202).json({ commandId });
  } catch (error) {
    next(error);
  }
});

api.post("/api/bins/lights", async (request, response, next) => {
  try {
    const input = groupLightsSchema.parse(request.body);
    const binIds = [...new Set(input.binIds)];
    const onlineBinIds = binIds.filter((binId) => Boolean(getBinMeasurement(binId)?.online));
    if (onlineBinIds.length === 0) {
      return response.status(409).json({ error: "No selected bins are online" });
    }
    const commandIds = await Promise.all(
      onlineBinIds.map((binId) => sendBinCommand(binId, "find", {
        active: input.active,
        timeoutSeconds: input.timeoutSeconds,
        action: "find"
      }))
    );
    response.status(202).json({ commandIds, binIds: onlineBinIds, active: input.active });
  } catch (error) {
    next(error);
  }
});

api.post("/api/bins/:binId/tare", async (request, response, next) => {
  try {
    response.status(202).json({ commandId: await sendBinCommand(request.params.binId, "tare") });
  } catch (error) {
    next(error);
  }
});

api.post("/api/bins/:binId/calibrate", async (request, response, next) => {
  try {
    const input = z.object({ knownWeightGrams: z.number().positive() }).parse(request.body);
    response.status(202).json({
      commandId: await sendBinCommand(request.params.binId, "calibrate", { ...input })
    });
  } catch (error) {
    next(error);
  }
});

api.post("/api/firmware", upload.single("firmware"), (request, response, next) => {
  try {
    if (!request.file) return response.status(400).json({ error: "A .bin firmware file is required" });
    try {
      const metadata = JSON.parse(String(request.body.manifest ?? "")) as FirmwareMetadata;
      const firmware = importFirmware(request.file.buffer, metadata, request.file.originalname);
      broadcast("firmware", { version: firmware.version });
      return response.status(201).json(firmware);
    } catch (error) { return response.status(400).json({ error: error instanceof Error ? error.message : "Invalid firmware manifest" }); }
  } catch (error) {
    next(error);
  }
});

api.post("/api/firmware/:firmwareId/deploy", async (request, response, next) => {
  try {
    const input = otaDeploySchema.parse(request.body);
    const firmware = getFirmware(request.params.firmwareId);
    if (!firmware) return response.status(404).json({ error: "Firmware not found" });
    const binIds = input.target === "all"
      ? listOnlineBins().filter(bin => bin.hardware_target === firmware.hardware_target && bin.partition_layout === firmware.partition_layout).map(bin => bin.bin_id)
      : [...new Set(input.binIds)];
    if (!binIds.length) return response.status(400).json({ error: "No compatible bins selected. Legacy bins need their hardware identified by updated firmware." });
    try { for (const id of binIds) assertCompatible(firmware, getBinHardware(id)); }
    catch (error) { return response.status(409).json({ error: String(error) }); }
    const manifest = firmwareManifest(firmware, input.force);
    const commandIds = await Promise.all(binIds.map(id => sendBinCommand(id, "ota", manifest)));
    response.status(202).json({ commandIds, target: binIds });
  } catch (error) {
    next(error);
  }
});

if (existsSync(frontendIndex)) {
  api.use(express.static(frontendDir, { index: false }));
  api.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/") || !request.accepts("html")) {
      return next();
    }
    response.setHeader("Cache-Control", "no-store");
    response.sendFile(frontendIndex);
  });
} else {
  console.warn(`[HTTP] Frontend build not found at ${frontendIndex}; API-only mode`);
}

api.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error);
  if (error instanceof IntakeError) return response.status(error.status).json({ error: error.message });
  if (error instanceof z.ZodError) {
    return response.status(400).json({ error: error.issues[0]?.message ?? "Invalid request" });
  }
  const message = error instanceof Error ? error.message : "Unexpected server error";
  if (message.includes("UNIQUE constraint failed")) {
    return response.status(409).json({ error: "That identifier or firmware version already exists" });
  }
  response.status(500).json({ error: message });
});

export function startServers() {
  validateLocalAccess();
  const apiPort = Number(process.env.PORT ?? 8080);
  const firmwarePort = Number(process.env.FIRMWARE_PORT ?? 8081);
  const apiHost = process.env.HTTP_HOST ?? "127.0.0.1";
  const firmwareHost = process.env.FIRMWARE_HOST ?? "0.0.0.0";
  api.listen(apiPort, apiHost, () => {
    console.log(`[HTTP] SmartWall UI and API: http://${apiHost}:${apiPort}`);
  });
  firmwareServer.listen(firmwarePort, firmwareHost, () => {
    console.log(`[OTA] Signed firmware downloads: http://${firmwareHost}:${firmwarePort}`);
  });
}
