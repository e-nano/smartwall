# Smart Stock Bin MQTT contract (v2)

The ESP32 maintains one MQTT connection to the inventory platform's broker. There
is no command polling. Configure the broker host, port and optional username and
password in the device setup page. The current prototype uses plain MQTT on port
1883 on a trusted LAN.

The topic root is `smartwall/v1` and the permanent ESP32-derived `binId` identifies
each device.

## Topics

| Direction | Topic | Retained | Purpose |
|---|---|---:|---|
| Bin → platform | `smartwall/v1/bins/{binId}/status` | Yes | Online state, firmware and IP; MQTT Last Will changes it to offline |
| Bin → platform | `smartwall/v1/bins/{binId}/telemetry` | Yes | Latest weight, quantity, assignment and health observation |
| Platform → bin | `smartwall/v1/bins/{binId}/commands` | No | Command for one selected bin |
| Platform → all bins | `smartwall/v1/bins/all/commands` | No | Fleet command; use cautiously and never retain |
| Bin → platform | `smartwall/v1/bins/{binId}/acks` | No | Completed/failed command acknowledgement |
| Bin → platform | `smartwall/v1/bins/{binId}/ota` | Yes | OTA download progress and final state |

The firmware subscribes to both command topics at QoS 1. PubSubClient publishes
at QoS 0, so the platform must use unique command IDs and tolerate a missing
acknowledgement. The device persists its last processed command ID and safely
acknowledges a duplicate rather than executing it twice.

## Telemetry

The bin publishes immediately after connecting and then every 15 seconds:

```json
{
  "binId": "BIN-7A9700",
  "firmwareVersion": "0.3.1",
  "deviceState": "online",
  "uptimeSeconds": 123,
  "rssi": -57,
  "ipAddress": "192.168.1.42",
  "rawValid": true,
  "rawAdc": 812345,
  "filterReady": true,
  "measurementStable": true,
  "filterSamples": 50,
  "filteredRawAdc": 812340.7,
  "measurementNoiseCounts": 42.1,
  "weightValid": true,
  "netWeightGrams": 96.42,
  "tareOffset": 123456,
  "scaleCountsPerGram": 721.55,
  "unitWeightGrams": 1.25,
  "estimatedQuantity": 77,
  "partId": "M3X12-SHCS"
}
```

The platform should mark a bin stale/offline when its Last Will arrives or its
telemetry ages out. It must not interpret an offline bin as zero inventory.

## Commands and acknowledgements

Every command must contain a globally unique `commandId`. Commands must not be
retained by the broker.

```json
{"commandId":"cmd-1","command":"find","active":true,"action":"pick","timeoutSeconds":60}
```

```json
{
  "commandId":"cmd-2",
  "command":"set_label",
  "partId":"M3X12-SHCS",
  "name":"M3 x 12 socket screws",
  "description":"A2 stainless, box of 100",
  "unitWeightGrams":1.25
}
```

```json
{"commandId":"cmd-3","command":"tare"}
```

```json
{"commandId":"cmd-4","command":"calibrate","knownWeightGrams":1000.0}
```

```json
{"commandId":"cmd-5","command":"refresh_label"}
```

The acknowledgement is published on the bin's `acks` topic:

```json
{
  "binId":"BIN-7A9700",
  "commandId":"cmd-1",
  "ok":true,
  "message":"completed",
  "firmwareVersion":"0.3.1"
}
```

To illuminate one bin, publish `find` to its individual command topic. Use
`action` = `pick` for blue, `restock` for green, or `find` for amber. A plain
`find` runs until its timeout. Pick and restock are guided weight operations: the
bin captures its current stable quantity, keeps the requested colour flashing,
and stops after a change in the correct direction remains stable for 1.2 seconds.
The timeout remains a safety limit if no matching change occurs. The initial
acknowledgement means guidance was accepted; the resulting stable quantity is
published immediately in telemetry and becomes an observed inventory event in
the platform. To target several bins, publish separately to each selected bin.
The broadcast topic is intended for deliberate fleet-wide operations.

Outside a guided operation, the bin also detects stable quantity changes while
weighing continuously. A removal flashes blue for four seconds, a restock flashes
green, the e-paper quantity is refreshed, and telemetry is sent immediately.

## MQTT-triggered OTA

Firmware binaries are not sent through MQTT. The platform hosts `firmware.bin`
and publishes a small manifest command containing an absolute download URL and
the lowercase SHA-256 digest:

```json
{
  "commandId":"ota-2026-09-28-001",
  "command":"ota",
  "version":"0.3.1",
  "url":"http://192.168.1.10:8081/firmware/0.3.1/firmware.bin",
  "sha256":"64-lowercase-hexadecimal-characters",
  "force":false
}
```

The firmware requires normal Wi-Fi station mode, an HTTP 200 response and a valid
`Content-Length`. It streams the image into the inactive OTA partition, computes
SHA-256 during the download, rejects a mismatch, activates the image only after
verification, publishes completion, and restarts. Progress is published to the
bin's `ota` topic.

Target one bin by publishing the manifest to:

```text
smartwall/v1/bins/BIN-7A9700/commands
```

Target every connected bin by publishing it once, without the retained flag, to:

```text
smartwall/v1/bins/all/commands
```

For safer fleet deployment, the platform should roll out to a small canary group,
wait for the new firmware version in status/telemetry, and only then continue in
batches. Do not start every download simultaneously on a constrained server or
Wi-Fi network.

Generate the digest with:

```sh
sha256sum .pio/build/elegoo_esp32/firmware.bin
```

## Security boundary

SHA-256 verifies that the downloaded bytes match the MQTT manifest, but it does
not authenticate a manifest supplied by a compromised broker. Production should
use per-device broker ACLs, MQTT over TLS, HTTPS downloads, cryptographically
signed firmware, staged rollout controls and boot-health rollback.

## Local device endpoints

The ESP32 still exposes these maintenance endpoints on its own IP:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` or `/setup` | Setup and maintenance page |
| `GET` | `/api/status` | Identity, MQTT and live measurement status |
| `GET` | `/api/networks` | Wi-Fi scan |
| `POST` | `/api/config` | Save Wi-Fi/MQTT settings and restart |
| `POST` | `/api/tare` | Stable-sample tare and persistence |
| `POST` | `/api/calibrate` | Calibrate using `knownWeightGrams` |
| `POST` | `/api/find` | Local LED test |
| `POST` | `/api/ota` | Local browser OTA; station mode only |
| `POST` | `/api/factory-reset` | Clear Wi-Fi credentials and enter setup mode |
