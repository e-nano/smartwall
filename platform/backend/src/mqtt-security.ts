import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAppSetting, setAppSetting } from "./db.js";

const settingKey = "mqtt_credentials_required";
const stateDir = resolve(process.env.DATA_DIR ?? "./data", "mqtt");
const markerPath = resolve(stateDir, "require-credentials");

export function mqttCredentialsRequired() {
  return getAppSetting(settingKey) === "1";
}

export function mqttSecurityState(restarted?: boolean) {
  return {
    credentialsRequired: mqttCredentialsRequired(),
    discoveryEnabled: true,
    brokerRestarted: restarted
  };
}

export function setMqttCredentialsRequired(required: boolean) {
  mkdirSync(stateDir, { recursive: true });
  if (required) writeFileSync(markerPath, "required\n", { mode: 0o644 });
  else if (existsSync(markerPath)) rmSync(markerPath);
  setAppSetting(settingKey, required ? "1" : "0");

  // The broker wrapper watches this durable marker. The web app never controls Docker.
  return { ...mqttSecurityState(false), brokerRestartPending: true };
}
