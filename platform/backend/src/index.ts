import "dotenv/config";
import { maintenanceMode } from "./local-access.js";
import { startAutomaticFirmwareUpdates } from "./automatic-updates.js";
import { startCloudSync, remoteCommandConnection } from "./cloud-sync.js";
import { startRemoteCommands } from "./remote-commands.js";
import { markStaleBins } from "./db.js";
import { broadcast } from "./events.js";
import { startDiscovery } from "./discovery.js";
import { startMqtt } from "./mqtt.js";
import { startServers } from "./server.js";

// The supervisor validates migrations while all writers are held in maintenance.
// This also prevents cloud commands and MQTT telemetry from advancing a backup.
startServers();
let started=false;
function startWriters() {
  if (started || maintenanceMode()) return;
  started=true;
  startMqtt(); startDiscovery(); startAutomaticFirmwareUpdates(); startCloudSync();
  startRemoteCommands(remoteCommandConnection);
  setInterval(() => {
    const changed=markStaleBins();
    if (changed>0) broadcast("status", { staleBins: changed });
  },15_000).unref();
}
startWriters();
setInterval(startWriters,1000).unref();
