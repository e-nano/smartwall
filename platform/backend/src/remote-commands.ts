import { z } from "zod";
import { componentSchema, componentImagesSchema } from "../../shared/component-schema.js";
import { createPart, db, getAppSetting, getBinMeasurement, getPart, setAppSetting } from "./db.js";
import { broadcast } from "./events.js";
import { sendRemoteGuidance } from "./mqtt.js";

db.exec(`CREATE TABLE IF NOT EXISTS remote_command_receipts (
  command_id TEXT PRIMARY KEY, site_id TEXT NOT NULL, kind TEXT NOT NULL,
  status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
  reported_status TEXT
);`);
// A crash during dispatch leaves uncertainty. Never replay a physical action.
db.prepare("UPDATE remote_command_receipts SET status='unknown',message='Station restarted during dispatch' WHERE status='dispatching'").run();

export function remoteSettings() {
  return {
    controlEnabled: getAppSetting("remote_control_enabled") === "true" ||
      (getAppSetting("remote_control_enabled") === null && process.env.CLOUD_REMOTE_CONTROL_ENABLED === "true"),
    catalogueEnabled: getAppSetting("remote_catalogue_enabled") === "true" ||
      (getAppSetting("remote_catalogue_enabled") === null && process.env.CLOUD_REMOTE_CATALOGUE_ENABLED === "true")
  };
}
export function setRemoteSettings(value: { controlEnabled: boolean; catalogueEnabled: boolean }) {
  setAppSetting("remote_control_enabled",String(value.controlEnabled));
  setAppSetting("remote_catalogue_enabled",String(value.catalogueEnabled));
  return remoteSettings();
}
const remoteCommandSchema = z.object({ commandId: z.string().uuid(), siteId: z.string().min(2).max(64),
  kind: z.enum(["guidance","create_component","attach_images"]), payload: z.unknown(), expiresAt: z.string().datetime() });
const guidanceSchema = z.object({ binId: z.string().min(1).max(128), action: z.enum(["find","pick","restock"]),
  active: z.boolean(), timeoutSeconds: z.number().int().min(1).max(300) }).strict();
type Guidance = z.infer<typeof guidanceSchema>;
type Receipt = { command_id: string; site_id: string; kind: string; status: string; message: string; updated_at: string; reported_status: string | null };
export type StationConnection = { apiUrl: string; siteId: string; token: string };
const finishReceipt = (id: string, status: string, message: string) => db.prepare(`UPDATE remote_command_receipts
  SET status=?,message=?,updated_at=? WHERE command_id=?`).run(status,message,new Date().toISOString(),id);

export async function processRemoteCommand(value: unknown, siteId: string, settings = remoteSettings(),
  publish: (binId: string, commandId: string, fields: Omit<Guidance,"binId">) => Promise<void> = sendRemoteGuidance) {
  const command = remoteCommandSchema.parse(value);
  if (command.siteId !== siteId) throw new Error("Remote command targets another wall");
  if (db.prepare("SELECT command_id FROM remote_command_receipts WHERE command_id=?").get(command.commandId)) return;
  db.prepare(`INSERT INTO remote_command_receipts(command_id,site_id,kind,status,updated_at)
    VALUES(?,?,?,'dispatching',?)`).run(command.commandId,siteId,command.kind,new Date().toISOString());
  if (Date.parse(command.expiresAt) <= Date.now()) { finishReceipt(command.commandId,"expired","Command expired before local execution"); return; }
  if (command.kind === "guidance" ? !settings.controlEnabled : !settings.catalogueEnabled) {
    finishReceipt(command.commandId,"failed","Remote action disabled locally"); return;
  }
  try {
    if (command.kind === "guidance") {
      const { binId, ...fields } = guidanceSchema.parse(command.payload);
      const bin = getBinMeasurement(binId);
      if (!bin?.online || !bin.last_seen || Date.now() - Date.parse(bin.last_seen) > 45_000) throw new Error("Bin is offline or stale");
      await publish(binId,command.commandId,fields);
      finishReceipt(command.commandId,"sent","Sent to bin; awaiting acknowledgement");
    } else {
      // Catalogue writes and their durable receipt commit together, including sync outbox triggers.
      db.exec("BEGIN IMMEDIATE");
      try {
        if (command.kind === "create_component") {
          const component = componentSchema.parse(command.payload);
          if (component.unitWeightGrams !== undefined) throw new Error("Unit weight must be learned locally");
          if (getPart(component.partId)) throw new Error("Component ID already exists; existing component was preserved");
          createPart(component);
        } else {
          const input = z.object({ partId: z.string().min(1).max(64), images: componentImagesSchema }).strict().parse(command.payload);
          if (!db.prepare("UPDATE parts SET images_json=? WHERE part_id=?").run(JSON.stringify(input.images),input.partId).changes) throw new Error("Component not found");
        }
        finishReceipt(command.commandId,"completed","Component change saved locally");
        db.exec("COMMIT");
        broadcast("parts",{});
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    }
  } catch (error) {
    const message = error instanceof z.ZodError ? "Invalid remote command payload"
      : error instanceof Error && ["Component ID already exists; existing component was preserved","Component not found","Unit weight must be learned locally","Bin is offline or stale"].includes(error.message)
        ? error.message : "Remote action could not be confirmed";
    finishReceipt(command.commandId,command.kind === "guidance" ? "unknown" : "failed",message);
  }
}

export async function runRemoteCommandCycle(connection: StationConnection,
  publish: (binId: string, commandId: string, fields: Omit<Guidance,"binId">) => Promise<void> = sendRemoteGuidance,
  isCurrentConnection: () => boolean = () => true) {
  const base = `${connection.apiUrl}/v1/sites/${encodeURIComponent(connection.siteId)}/commands`;
  const settings = remoteSettings();
  const post = (path: string, body: unknown) => fetch(base + path, { method: "POST",
    headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const response = await post("/poll",settings);
  if (response.status === 404) return; // Older cloud deployments have no command channel.
  if (!response.ok) throw new Error(`Remote command poll returned HTTP ${response.status}`);
  const result = z.object({ commands: z.array(remoteCommandSchema).max(5) }).parse(await response.json());
  for (const command of result.commands) {
    if (!isCurrentConnection()) return;
    await processRemoteCommand(command,connection.siteId,remoteSettings(),publish);
  }
  if (!isCurrentConnection()) return;
  const receipts = db.prepare("SELECT * FROM remote_command_receipts WHERE site_id=? AND (reported_status IS NULL OR reported_status<>status OR status='sent') LIMIT 100").all(connection.siteId) as Receipt[];
  for (const receipt of receipts) {
    if (receipt.status !== "sent") continue;
    const ack = db.prepare("SELECT status FROM commands WHERE command_id=?").get(receipt.command_id) as { status: string } | undefined;
    if (ack?.status === "completed") { receipt.status="accepted"; receipt.message="Bin acknowledged guidance; check inventory for physical changes"; }
    else if (ack?.status === "failed") { receipt.status="failed"; receipt.message="Bin rejected guidance"; }
    else if (Date.now()-Date.parse(receipt.updated_at)>20_000) { receipt.status="unknown"; receipt.message="No acknowledgement received; physical outcome is unknown"; }
    if (receipt.status !== "sent") finishReceipt(receipt.command_id,receipt.status,receipt.message);
  }
  const unreported = receipts.filter(receipt => receipt.reported_status !== receipt.status && receipt.status !== "dispatching");
  if (!unreported.length) return;
  const reported = await post("/results", { results: unreported.map(receipt => ({ commandId: receipt.command_id,status: receipt.status,message: receipt.message })) });
  if (!reported.ok) throw new Error(`Remote command results returned HTTP ${reported.status}`);
  const accepted = z.object({ acceptedCommandIds: z.array(z.string().uuid()) }).parse(await reported.json());
  for (const id of accepted.acceptedCommandIds) {
    const receipt = unreported.find(receipt => receipt.command_id === id);
    if (receipt) db.prepare("UPDATE remote_command_receipts SET reported_status=? WHERE command_id=?").run(receipt.status,id);
  }
}

export function startRemoteCommands(connection: () => StationConnection | null) {
  let running = false;
  const poll = async () => {
    if (running) return;
    const current = connection(); if (!current) return;
    running = true;
    try { await runRemoteCommandCycle(current,sendRemoteGuidance,() => {
      const latest=connection();
      return latest?.siteId===current.siteId && latest.apiUrl===current.apiUrl && latest.token===current.token;
    }); }
    catch { console.warn("[REMOTE COMMANDS] Connection unavailable; commands remain subject to expiry"); }
    finally { running=false; }
  };
  const timer = setInterval(() => void poll(),5_000); timer.unref();
  void poll();
  return () => clearInterval(timer);
}
