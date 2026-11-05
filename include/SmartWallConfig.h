#pragma once

#include <Arduino.h>

#include "FirmwareVersion.generated.h"
#include "SmartWallRelease.generated.h"

namespace Pins {
#if defined(SMARTWALL_BOARD_DEVKIT)
// ELEGOO ESP32 DevKit USB-C prototype labels.
constexpr uint8_t HX711_DT = 25;   // D25
constexpr uint8_t HX711_SCK = 26;  // D26

constexpr uint8_t EPD_DIN = 23;   // D23 / SPI MOSI
constexpr uint8_t EPD_CLK = 18;   // D18 / SPI SCK
constexpr uint8_t EPD_CS = 5;     // D5
constexpr uint8_t EPD_DC = 17;    // TX2
constexpr uint8_t EPD_RST = 16;   // RX2
constexpr uint8_t EPD_BUSY = 4;   // D4

constexpr uint8_t BIN_LED = 27;      // D27 / one WS2812E DIN
constexpr uint8_t SETUP_BUTTON = 0;  // BOOT
#elif defined(SMARTWALL_BOARD_INTEGRATED_REV02)
// Smart Bin integrated controller Rev 0.2. These GPIOs come from the
// manufactured KiCad schematic and the ESP32-S3-WROOM-1-N8 module pins.
constexpr uint8_t HX711_DT = 4;   // U1 pin 4 / HX_DOUT
constexpr uint8_t HX711_SCK = 5;  // U1 pin 5 / HX_SCK

constexpr uint8_t EPD_DIN = 11;   // U1 pin 19 / EPD_MOSI
constexpr uint8_t EPD_CLK = 12;   // U1 pin 20 / EPD_SCLK
constexpr uint8_t EPD_CS = 10;    // U1 pin 18 / EPD_CS
constexpr uint8_t EPD_DC = 9;     // U1 pin 17 / EPD_DC
constexpr uint8_t EPD_RST = 8;    // U1 pin 12 / EPD_RST
constexpr uint8_t EPD_BUSY = 7;   // U1 pin 7 / EPD_BUSY

constexpr uint8_t BIN_LED = 6;       // U1 pin 6 / LED_DATA_3V3 via U4 and R11
constexpr uint8_t SETUP_BUTTON = 0;  // U1 pin 27 / ESP_BOOT / SW2
#else
#error "Select a supported SmartWall board environment in platformio.ini"
#endif
}  // namespace Pins

namespace Leds {
#if defined(SMARTWALL_BOARD_DEVKIT)
constexpr uint8_t COUNT = 1;
constexpr uint8_t CENTER = 0;
constexpr uint8_t TOP = 0;
constexpr uint8_t RIGHT = 0;
constexpr uint8_t BOTTOM = 0;
constexpr uint8_t LEFT = 0;
constexpr uint8_t ARM_ORDER[] = {0, 0, 0, 0};
#else
constexpr uint8_t COUNT = 5;
// D1 -> D7 -> D8 -> D9 -> D10 follows this physical cross on the PCB.
constexpr uint8_t CENTER = 0;
constexpr uint8_t TOP = 1;
constexpr uint8_t RIGHT = 2;
constexpr uint8_t BOTTOM = 3;
constexpr uint8_t LEFT = 4;
constexpr uint8_t ARM_ORDER[] = {TOP, RIGHT, BOTTOM, LEFT};
#endif
}  // namespace Leds

namespace Timing {
constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 20000;
constexpr uint32_t WIFI_RECONNECT_INTERVAL_MS = 10000;
constexpr uint32_t WIFI_FAILURE_TO_SETUP_MS = 60000;
constexpr uint32_t WEIGHT_SAMPLE_INTERVAL_MS = 100;
constexpr uint32_t TELEMETRY_INTERVAL_MS = 15000;
constexpr uint32_t MQTT_RECONNECT_INTERVAL_MS = 5000;
constexpr uint32_t DISCOVERY_INTERVAL_MS = 5000;
constexpr uint32_t DISCOVERY_FALLBACK_DELAY_MS = 1500;
constexpr uint32_t OTA_DOWNLOAD_TIMEOUT_MS = 10000;
constexpr uint32_t FIND_DEFAULT_TIMEOUT_MS = 60000;
constexpr uint32_t FORCE_SETUP_HOLD_MS = 4000;
constexpr uint32_t SUCCESS_LED_DURATION_MS = 1800;
constexpr uint32_t WEIGHT_CHANGE_FLASH_MS = 4000;
}  // namespace Timing

namespace Measurement {
constexpr size_t WINDOW_SAMPLES = 30;       // Three seconds at the HX711 10 Hz rate.
constexpr size_t TRIM_EACH_SIDE = 6;        // Average the middle 18 samples.
constexpr uint32_t CAPTURE_TIMEOUT_MS = 10000;
constexpr uint32_t STABLE_QUANTITY_CONFIRM_MS = 700;
constexpr float MAX_STABLE_NOISE_COUNTS = 300.0F;
}  // namespace Measurement

namespace Product {
#ifdef SMARTWALL_RELEASE_VERSION
constexpr char FIRMWARE_VERSION[] = SMARTWALL_RELEASE_VERSION;
constexpr char RELEASE_MARKER[] = "SMARTWALL-RELEASE:" SMARTWALL_RELEASE_VERSION;
#else
constexpr char FIRMWARE_VERSION[] = SMARTWALL_FIRMWARE_VERSION;
constexpr char RELEASE_MARKER[] = "SMARTWALL-RELEASE:" SMARTWALL_FIRMWARE_VERSION;
#endif
#if defined(SMARTWALL_BOARD_DEVKIT)
constexpr char HARDWARE_TARGET[] = "esp32-devkit";
constexpr char PARTITION_LAYOUT[] = "default-4mb-v1";
constexpr char IMAGE_MARKER[] = "SMARTWALL-TARGET:esp32-devkit:default-4mb-v1";
#else
constexpr char HARDWARE_TARGET[] = "smartbin-rev02-s3";
constexpr char PARTITION_LAYOUT[] = "default-8mb-v1";
constexpr char IMAGE_MARKER[] = "SMARTWALL-TARGET:smartbin-rev02-s3:default-8mb-v1";
#endif
constexpr char MQTT_TOPIC_ROOT[] = "smartwall/v1";
constexpr char DISCOVERY_PROTOCOL[] = "smartwall-discovery-v1";
constexpr uint16_t DISCOVERY_SERVER_PORT = 4210;
constexpr uint16_t DISCOVERY_CLIENT_PORT = 0;  // Ask lwIP for an ephemeral reply port.
constexpr char PREFERENCES_NAMESPACE[] = "smartstock";
constexpr char AP_PASSWORD[] = "smartstock";  // Eight characters; change for deployment.
constexpr size_t MAX_LABEL_NAME = 100;
constexpr size_t MAX_LABEL_DESCRIPTION = 72;
}  // namespace Product
