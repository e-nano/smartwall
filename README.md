# SmartWall — local inventory and SmartBin firmware

Start with the [SmartWall user guide](https://smartwall.e-nano.io/guide.html),
[Docker source trial and installation](docs/DEPLOYMENT.md),
[official release approvals](docs/RELEASING.md), [contributing](CONTRIBUTING.md), and [security](SECURITY.md).
The community project covers the local operator interface, backend, bin firmware and
approved software/firmware updates. E-Nano runs the optional commercial
[SmartWall Online](https://smartwall.e-nano.io) service; its portal, server and hosting
infrastructure are private and are not distributed with this project. The local
software works without an online account. Developers may implement their own
compatible service using the local integration code.

The community source repository is [e-nano/smartwall](https://github.com/e-nano/smartwall).
An open-source licence has not yet been selected; publishing the source does not
grant an open-source licence. Official Docker/firmware releases remain disabled
until licensing and release approval settings are completed.
See [public/private source separation](docs/RELEASING.md#public-and-private-source).

PlatformIO firmware for both the manufactured **Smart Bin Integrated Controller Rev 0.2** and the original **ELEGOO ESP32 DevKit** prototype. The two targets share the application code but retain their own processor, GPIO and LED configuration.

## Implemented prototype behavior

- Stable Bin ID derived from the ESP32 eFuse MAC and persisted in NVS.
- HX711 acquisition, filtered weight, stable-sample tare, calibration and persisted tare/scale.
- Continuous 10 Hz weighing with a five-second trimmed filter, stable quantity detection and immediate change telemetry.
- Large-format 1.54-inch e-paper label with readable Bin ID, part name, prominent quantity and current weight.
- Five WS2812B-2020 LEDs use their physical cross layout for boot, connecting, success, fault, tare and OTA animations. On every boot, a short centre/top/right/bottom/left self-test lights all five LEDs before peripheral initialization. Picks collapse blue into the centre, restocks expand green outwards, Find rotates amber around the centre, and a dim cyan centre heartbeat remains visible while idle. Captive-portal Setup Mode uses a clear 500 ms blue on/off blink.
- Automatic Wi-Fi reconnect and fallback to captive Setup Mode after a timeout.
- Captive portal with network scan, Wi-Fi and MQTT broker settings, live weight, optional tare and Find test.
- Recovery without reflashing: hold the board's **BOOT** button for four seconds during startup, or use **Clear Wi-Fi & restart setup** in the maintenance page.
- MQTT telemetry, immediate per-bin or fleet commands, persisted label assignment, acknowledgements and Last-Will offline indication.
- Browser OTA in normal Wi-Fi requires signed board-specific metadata and a trusted publisher key; setup/AP mode disables OTA. NVS configuration is preserved.

The local React/TypeScript operator platform is in [platform](platform/README.md). Its device-facing MQTT contract is documented in [docs/backend-api.md](docs/backend-api.md).

## Integrated board pinout

These GPIOs come from the Smart Bin Rev 0.2 KiCad schematic and the ESP32-S3-WROOM-1 module pin table:

| Function | Schematic net | U1 module pin | ESP32-S3 GPIO |
|---|---|---:|---:|
| HX711 data | `HX_DOUT` | 4 | 4 |
| HX711 clock | `HX_SCK` | 5 | 5 |
| LED data | `LED_DATA_3V3` | 6 | 6 |
| E-paper BUSY | `EPD_BUSY` | 7 | 7 |
| E-paper RST | `EPD_RST` | 12 | 8 |
| E-paper DC | `EPD_DC` | 17 | 9 |
| E-paper CS | `EPD_CS` | 18 | 10 |
| E-paper MOSI | `EPD_MOSI` | 19 | 11 |
| E-paper SCLK | `EPD_SCLK` | 20 | 12 |
| BOOT / setup button | `ESP_BOOT` | 27 | 0 |

The five WS2812B-2020 LEDs are daisy-chained `D1 → D7 → D8 → D9 → D10`, which is **centre → top → right → bottom → left** when viewing the populated front of the PCB. U4 translates the ESP32's 3.3 V data to the 5 V LED domain and R11 provides the series damping resistor.

The selected display driver is `GxEPD2_154_D67` (200 × 200) for the raw Waveshare 1.54-inch V2 panel.

> Rev 0.2 bring-up note: the manufactured D2/D3 Schottky diodes must have the corrected physical orientation established during bench rework. Firmware cannot compensate for a reversed power-path diode.

## Build and upload

For the initial USB installation on the integrated ESP32-S3 board, use:

```sh
pio run --environment smartbin_integrated_rev02 --target upload
```

For the original ESP32 DevKit, use:

```sh
pio run --environment elegoo_esp32 --target upload
```

To create a clearly labelled DevKit OTA image without adding it to the automatic
S3 rollout inbox, run:

```sh
./scripts/compile-devkit-firmware.sh
```

The result is stored under `platform/firmware/devkit/`. Keeping board-specific
images separate prevents an ESP32 image from being offered to an ESP32-S3 (or
the reverse).

After the bin is commissioned on Wi-Fi and MQTT, build releases through the
versioned release script from the project root:

```sh
./scripts/compile-firmware.sh
```

Every successful development build increments the semantic patch version, embeds it in the
firmware, and places the binary in `platform/firmware/integrated/`. Building does not
publish or deploy an update. A failed build leaves the current version unchanged.
To intentionally select the next major or minor version, pass it explicitly, for
example `./scripts/compile-firmware.sh 0.4.0`.

## First commissioning

1. Power the bin with no saved configuration.
2. Scan the Wi-Fi QR code on the e-ink screen to join `SmartStock-BIN-xxxxxx` automatically. If the phone cannot scan Wi-Fi QR codes, connect manually using password `smartstock`.
3. If the captive page does not open automatically, browse to `http://192.168.4.1/`.
4. Optionally tare the empty, settled bin. Add a known mass, enter its weight in grams and press **Calibrate with mass fitted**. Neither action is required for Wi-Fi setup.
5. Select Wi-Fi and enter its password. The bin broadcasts a local UDP discovery request and automatically learns the SmartWall MQTT address and port. Broker and OTA settings remain available under **Advanced connection settings**.
6. Select **Save & Connect**. The ESP32 restarts, closes the setup AP, connects, updates the label and starts MQTT telemetry and command subscriptions.

The default setup AP password is intentionally simple for bench commissioning. Change `Product::AP_PASSWORD` in `include/SmartWallConfig.h` and add stronger onboarding/access control before deployment.

## Calibration

The setup portal now provides the complete calibration workflow: tare the empty bin,
fit a known mass, enter its weight in grams and press **Calibrate with mass fitted**.
The total weight of the bin, platform and calibration mass must remain within the
load cell's rating.

The equivalent API call is:

```sh
curl -X POST -d 'knownWeightGrams=500' http://BIN-IP/api/calibrate
```

Both tare offset and counts-per-gram scale survive power cycling. Load-cell wire colours are deliberately not documented because their mapping depends on the exact cell model; use its E+/E-/A+/A- data sheet.

## OTA firmware updates

OTA runs in normal Wi-Fi mode and requires a publisher-signed manifest and matching
binary. Both platform uploads and the bin's own upload page check the signature,
board target, partition layout and image digest. A build without a configured public
key refuses OTA. Set `SMARTWALL_FIRMWARE_PUBLIC_KEY_FILE` when compiling to embed a
trusted publisher key; existing bins need a tested USB bootstrap before joining the
new update path. See [deployment and recovery](docs/DEPLOYMENT.md).

Automatic updates are opt-in (`AUTO_UPDATE_FIRMWARE=true`), select stable releases
per hardware target, and stop after three attempts per bin/release. The platform's
Updates view imports signed releases and offers selected/compatible-bin deployment.
Neither compilation nor merging a pull request publishes an official release.

The ESP32 writes an inactive application slot, validates the digest against signed
metadata, then reboots. Boot confirmation is deferred until setup completes and the
main loop runs for 30 seconds. Physical rollback tests remain required for each board.
Signed artifacts and release approval are documented in [RELEASING.md](docs/RELEASING.md).

## Current prototype assumptions

- The prototype uses trusted-LAN MQTT on port `1883`, UDP discovery on port `4210`, and HTTP for remote OTA downloads. MQTT accepts newly discovered bins without credentials by default. **Updates → Automatic bin connection** can require the configured MQTT username and password. Production requires MQTT over TLS, HTTPS, broker ACLs and signed firmware.
- GPIO0/SW2 is the recovery input on Smart Bin Rev 0.2; SW1 is the hardware reset input and is not read by firmware.
- The load-cell wiring, e-paper operation and measurement accuracy still need bench validation on the assembled board.
- E-paper refreshes happen only at persistent state transitions (setup, connected/assignment, explicit refresh), not on each live sample.
