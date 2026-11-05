#include <Arduino.h>
#include <algorithm>
#include <Adafruit_NeoPixel.h>
#include <ArduinoJson.h>
#include <DNSServer.h>
#include <GxEPD2_BW.h>
#include <HTTPClient.h>
#include <HX711.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <SPI.h>
#include <Update.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <esp_system.h>
#include <mbedtls/sha256.h>
#include <qrcode.h>

#include "SmartWallConfig.h"
#include "OtaTrust.h"
#include "portal_page.h"

namespace {
JsonDocument uploadManifest;
mbedtls_sha256_context uploadHash;
bool uploadHashActive = false;
uint32_t healthyBootStarted = 0;
bool bootValidated = false;

enum class DeviceState {
  Booting,
  Connecting,
  Setup,
  Online,
  BackendError,
};

enum class FindAction { Find, Pick, Restock };

struct StoredConfig {
  String wifiSsid;
  String wifiPassword;
  String mqttHost;
  String mqttUsername;
  String mqttPassword;
  String otaPassword;
  String partId;
  String partName;
  String partDescription;
  float scaleCountsPerGram = 0.0F;
  float unitWeightGrams = 0.0F;
  int64_t tareOffset = 0;
  bool hasTare = false;
  uint16_t mqttPort = 1883;
};

Preferences preferences;
HX711 scale;
// The five WS2812B-2020 LEDs use the 800 kHz single-wire protocol and GRB order.
Adafruit_NeoPixel pixels(Leds::COUNT, Pins::BIN_LED, NEO_GRB + NEO_KHZ800);
GxEPD2_BW<GxEPD2_154_D67, GxEPD2_154_D67::HEIGHT> display(
    GxEPD2_154_D67(Pins::EPD_CS, Pins::EPD_DC, Pins::EPD_RST, Pins::EPD_BUSY));
WebServer server(80);
DNSServer dnsServer;
WiFiClient mqttNetworkClient;
PubSubClient mqttClient(mqttNetworkClient);
WiFiUDP discoveryUdp;

StoredConfig config;
DeviceState deviceState = DeviceState::Booting;
String binId;
String setupSsid;

bool setupMode = false;
bool webServerStarted = false;
bool rawValid = false;
bool weightValid = false;
bool filterReady = false;
bool measurementStable = false;
bool tareInProgress = false;
bool otaInProgress = false;
bool otaUploadAuthorized = false;
bool otaUploadSuccess = false;
bool findActive = false;
FindAction findAction = FindAction::Find;
bool guidedWeightAction = false;
bool guidedBaselineReady = false;
bool stableQuantityKnown = false;
bool stableQuantityCandidateActive = false;
bool weightChangeFlashActive = false;
FindAction weightChangeFlashAction = FindAction::Find;
bool successIndication = false;
bool hasConnectedSinceBoot = false;
bool discoveryStarted = false;
bool discoveredBrokerPendingSave = false;
bool discoveryOfferReceived = false;
bool discoveredAuthenticationRequired = false;
bool displayRefreshRequested = false;
int64_t latestRaw = 0;
int64_t rawWindow[Measurement::WINDOW_SAMPLES] = {};
size_t rawWindowCount = 0;
size_t rawWindowIndex = 0;
double filteredRaw = 0.0;
float measurementNoiseCounts = 0.0F;
float latestWeightGrams = 0.0F;
long stableQuantity = 0;
long stableQuantityCandidate = 0;
long guidedBaselineQuantity = 0;
uint8_t mqttFailures = 0;
String otaUploadError;
size_t otaBytesWritten = 0;
String pendingMqttCommand;
String lastProcessedCommandId;

uint32_t stateStartedAt = 0;
uint32_t wifiDisconnectedAt = 0;
uint32_t lastWifiAttemptAt = 0;
uint32_t lastWeightSampleAt = 0;
uint32_t lastWeightLogAt = 0;
uint32_t lastRawReadingAt = 0;
uint32_t lastTelemetryAt = 0;
uint32_t lastMqttAttemptAt = 0;
uint32_t lastDiscoveryAttemptAt = 0;
uint32_t discoveryStartedAt = 0;
uint32_t discoveryNonce = 0;
uint32_t discoveryAttempts = 0;
uint32_t findEndsAt = 0;
uint32_t stableQuantityCandidateSince = 0;
uint32_t weightChangeFlashEndsAt = 0;
uint32_t successEndsAt = 0;

void startBrokerDiscovery();
void refreshOperationalLabel();

String storedString(const char *key) {
  return preferences.isKey(key) ? preferences.getString(key, "") : String();
}

float storedFloat(const char *key, float fallback = 0.0F) {
  return preferences.isKey(key) ? preferences.getFloat(key, fallback) : fallback;
}

bool elapsed(uint32_t now, uint32_t since, uint32_t interval) {
  return static_cast<uint32_t>(now - since) >= interval;
}

String stateName() {
  if (findActive) return "find";
  if (otaInProgress) return "updating";
  if (tareInProgress) return "taring";
  switch (deviceState) {
    case DeviceState::Booting: return "booting";
    case DeviceState::Connecting: return "connecting";
    case DeviceState::Setup: return "setup";
    case DeviceState::Online: return "online";
    case DeviceState::BackendError: return "backend_error";
  }
  return "unknown";
}

String trimTrailingSlash(String value) {
  value.trim();
  while (value.endsWith("/")) value.remove(value.length() - 1);
  return value;
}

String jsonEscape(const String &value) {
  String output;
  output.reserve(value.length() + 8);
  for (size_t i = 0; i < value.length(); ++i) {
    const char c = value.charAt(i);
    switch (c) {
      case '\\': output += F("\\\\"); break;
      case '"': output += F("\\\""); break;
      case '\n': output += F("\\n"); break;
      case '\r': output += F("\\r"); break;
      case '\t': output += F("\\t"); break;
      default:
        if (static_cast<uint8_t>(c) >= 0x20) output += c;
    }
  }
  return output;
}

String createBinId() {
  const uint64_t mac = ESP.getEfuseMac();
  char suffix[13];
  snprintf(suffix, sizeof(suffix), "%04X%08X",
           static_cast<uint16_t>(mac >> 32), static_cast<uint32_t>(mac));
  String id = "BIN-";
  id += String(suffix).substring(6);  // Last six hexadecimal characters.
  id.toUpperCase();
  return id;
}

void loadConfig() {
  preferences.begin(Product::PREFERENCES_NAMESPACE, false);
  binId = storedString("bin_id");
  if (binId.isEmpty()) {
    binId = createBinId();
    preferences.putString("bin_id", binId);
    Serial.printf("[NVS] Created persistent Bin ID: %s\n", binId.c_str());
  }
  config.wifiSsid = storedString("wifi_ssid");
  config.wifiPassword = storedString("wifi_pass");
  config.mqttHost = storedString("mqtt_host");
  config.mqttUsername = storedString("mqtt_user");
  config.mqttPassword = storedString("mqtt_pass");
  config.mqttPort = preferences.isKey("mqtt_port")
                        ? preferences.getUShort("mqtt_port", 1883)
                        : 1883;
  config.otaPassword = storedString("ota_pass");
  config.partId = storedString("part_id");
  config.partName = storedString("part_name");
  config.partDescription = storedString("part_desc");
  config.scaleCountsPerGram = storedFloat("scale");
  config.unitWeightGrams = storedFloat("unit_g");
  config.tareOffset = preferences.isKey("tare") ? preferences.getLong64("tare", 0) : 0;
  config.hasTare = preferences.isKey("has_tare") && preferences.getBool("has_tare", false);
  lastProcessedCommandId = storedString("last_cmd");
  setupSsid = "SmartStock-" + binId;
  Serial.printf("[NVS] Config loaded: wifi=%s mqtt=%s:%u tare=%s offset=%lld scale=%.6f part=%s ota=%s\n",
                config.wifiSsid.isEmpty() ? "not-set" : "set",
                config.mqttHost.isEmpty() ? "not-set" : config.mqttHost.c_str(),
                config.mqttPort,
                config.hasTare ? "set" : "not-set", config.tareOffset,
                config.scaleCountsPerGram,
                config.partId.isEmpty() ? "unassigned" : config.partId.c_str(),
                config.otaPassword.isEmpty() ? "disabled" : "enabled");
}

void clearLedFrame(uint8_t brightness) {
  pixels.setBrightness(brightness);
  pixels.clear();
}

void setLed(uint8_t index, uint8_t red, uint8_t green, uint8_t blue) {
  pixels.setPixelColor(index, pixels.Color(red, green, blue));
}

void showLedFrame() {
  pixels.show();
}

void setAllLeds(uint8_t red, uint8_t green, uint8_t blue,
                uint8_t brightness = 255) {
  clearLedFrame(brightness);
  for (uint8_t index = 0; index < Leds::COUNT; ++index) {
    setLed(index, red, green, blue);
  }
  showLedFrame();
}

void setSpinner(uint8_t red, uint8_t green, uint8_t blue, uint32_t now,
                uint32_t stepMs, uint8_t brightness = 255) {
  clearLedFrame(brightness);
  setLed(Leds::CENTER, red / 7, green / 7, blue / 7);
  const uint8_t step = (now / stepMs) % 4;
  setLed(Leds::ARM_ORDER[step], red, green, blue);
  setLed(Leds::ARM_ORDER[(step + 3) % 4], red / 5, green / 5, blue / 5);
  showLedFrame();
}

void runLedSelfTest() {
  // Runs before display/HX711 initialization so a dark board is immediately
  // distinguishable from a peripheral initialization problem.
  constexpr uint8_t RED[] = {100, 255, 0, 0, 180};
  constexpr uint8_t GREEN[] = {100, 0, 255, 0, 80};
  constexpr uint8_t BLUE[] = {100, 0, 0, 255, 0};
  for (uint8_t index = 0; index < Leds::COUNT; ++index) {
    clearLedFrame(140);
    setLed(index, RED[index], GREEN[index], BLUE[index]);
    showLedFrame();
    delay(220);
  }
  setAllLeds(80, 80, 80, 120);
  delay(350);
}

uint8_t triangleWave(uint32_t now, uint32_t period, uint8_t minimum, uint8_t maximum) {
  const uint32_t half = period / 2;
  uint32_t phase = now % period;
  if (phase > half) phase = period - phase;
  return minimum + static_cast<uint32_t>(maximum - minimum) * phase / half;
}

void setActionPattern(FindAction action, uint32_t now) {
  const bool centerPhase = (now / 180) % 2 == 0;
  clearLedFrame(255);
  if (action == FindAction::Pick) {
    // Blue arms collapse into the centre: remove/pick.
    for (uint8_t arm : Leds::ARM_ORDER) {
      setLed(arm, 0, centerPhase ? 35 : 180, centerPhase ? 60 : 255);
    }
    setLed(Leds::CENTER, 0, centerPhase ? 180 : 35, centerPhase ? 255 : 60);
  } else if (action == FindAction::Restock) {
    // Green expands from the centre: place/restock.
    setLed(Leds::CENTER, 0, centerPhase ? 35 : 255, centerPhase ? 8 : 80);
    for (uint8_t arm : Leds::ARM_ORDER) {
      setLed(arm, 0, centerPhase ? 255 : 35, centerPhase ? 80 : 8);
    }
  } else {
    // Amber rotates around the centre: locate this bin.
    const uint8_t step = (now / 140) % 4;
    setLed(Leds::CENTER, 45, 20, 0);
    setLed(Leds::ARM_ORDER[step], 255, 150, 0);
    setLed(Leds::ARM_ORDER[(step + 3) % 4], 60, 20, 0);
  }
  showLedFrame();
}

void updateLed(uint32_t now) {
  // Priority: guided/find > OTA > tare > weight change > fault/setup/network.
  if (findActive) {
    if (findEndsAt != 0 && static_cast<int32_t>(now - findEndsAt) >= 0) {
      Serial.printf("[GUIDE] %s timed out without the requested stable change\n",
                    findAction == FindAction::Pick ? "pick" :
                    findAction == FindAction::Restock ? "restock" : "find");
      findActive = false;
      guidedWeightAction = false;
      guidedBaselineReady = false;
      findEndsAt = 0;
      displayRefreshRequested = true;
    } else {
      setActionPattern(findAction, now);
      return;
    }
  }
  if (otaInProgress) {
    setSpinner(80, 0, 255, now, 100);  // Fast violet OTA activity.
    return;
  }
  if (tareInProgress) {
    const bool vertical = (now / 120) % 2 == 0;
    clearLedFrame(220);
    setLed(Leds::CENTER, 60, 0, 120);
    setLed(vertical ? Leds::TOP : Leds::LEFT, 135, 0, 255);
    setLed(vertical ? Leds::BOTTOM : Leds::RIGHT, 135, 0, 255);
    showLedFrame();
    return;
  }
  if (weightChangeFlashActive) {
    if (static_cast<int32_t>(now - weightChangeFlashEndsAt) >= 0) {
      weightChangeFlashActive = false;
      displayRefreshRequested = true;
    } else {
      setActionPattern(weightChangeFlashAction, now);
      return;
    }
  }
  if (deviceState == DeviceState::BackendError) {
    const bool center = (now / 250) % 2 == 0;
    clearLedFrame(220);
    setLed(Leds::CENTER, center ? 255 : 25, 0, 0);
    for (uint8_t arm : Leds::ARM_ORDER) {
      setLed(arm, center ? 25 : 255, 0, 0);
    }
    showLedFrame();
    return;
  }
  if (deviceState == DeviceState::Setup) {
    const bool on = (now / 500) % 2 == 0;
    setAllLeds(0, 0, on ? 255 : 0, 255);  // Clear 500 ms blue blink.
    return;
  }
  if (deviceState == DeviceState::Connecting) {
    const uint8_t level = triangleWave(now, 2200, 30, 255);
    setSpinner(level, level / 2, 0, now, 260, 180);
    return;
  }
  if (deviceState == DeviceState::Booting) {
    const uint8_t level = triangleWave(now, 700, 35, 220);
    setSpinner(level, level / 3, level, now, 110, 180);
    return;
  }
  if (successIndication && static_cast<int32_t>(now - successEndsAt) < 0) {
    const uint8_t level = triangleWave(now, 450, 80, 255);
    setAllLeds(0, level, level / 5, 220);
    return;
  }
  if (successIndication) displayRefreshRequested = true;
  successIndication = false;
  // Ready is deliberately dark. The e-ink status remains visible without
  // distracting operators or consuming LED power between actions.
  clearLedFrame(0);
  showLedFrame();
}

String screenStatusText() {
  if (findActive) {
    if (findAction == FindAction::Pick) return "PICK: REMOVE STOCK";
    if (findAction == FindAction::Restock) return "RESTOCK: ADD STOCK";
    return "FIND THIS BIN";
  }
  if (otaInProgress) return "UPDATING FIRMWARE";
  if (tareInProgress) return "TARE / CALIBRATION";
  if (weightChangeFlashActive) {
    return weightChangeFlashAction == FindAction::Pick ? "STOCK REMOVED" : "STOCK ADDED";
  }
  if (deviceState == DeviceState::BackendError) return "WALL / MQTT OFFLINE";
  if (deviceState == DeviceState::Setup) return "WI-FI SETUP MODE";
  if (deviceState == DeviceState::Connecting) return "CONNECTING TO WI-FI";
  if (deviceState == DeviceState::Booting) return "STARTING";
  if (successIndication) return "ACTION COMPLETED";
  return config.partName.isEmpty() ? "ONLINE / UNASSIGNED" : "ONLINE / READY";
}

void showLabel(const String &status, const String &secondary = "") {
  // E-ink refreshes are blocking. Apply the current indicator state first so
  // guidance and weight-change feedback is visible without waiting for them.
  updateLed(millis());
  Serial.println("[EPD] LED state applied before label refresh");

  display.setRotation(1);
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.setTextColor(GxEPD_BLACK);
    display.setTextWrap(true);

    // Give the full upper section to the component name. The hardware bin ID
    // remains available through MQTT and the platform, but is not useful here.
    const String heading = config.partName.isEmpty() ? status : config.partName;
    const uint8_t headingSize = heading.length() <= 7 ? 4 :
                                heading.length() <= 40 ? 3 : 2;
    display.setTextSize(headingSize);
    display.setCursor(6, 6);
    display.print(heading);

    // Setup screens may still show connection details such as the temporary AP
    // name; assigned bins reserve this entire section for the component name.
    if (config.partName.isEmpty() && !secondary.isEmpty()) {
      display.setTextSize(1);
      display.setCursor(6, 40);
      display.print(secondary.substring(0, 30));
    }
    display.drawFastHLine(6, 124, display.width() - 12, GxEPD_BLACK);

    String quantityText = "--";
    if (stableQuantityKnown) {
      quantityText = String(stableQuantity);
    } else if (weightValid && measurementStable && config.unitWeightGrams > 0.0F) {
      quantityText = String(lroundf(max(0.0F, latestWeightGrams) /
                                    config.unitWeightGrams));
    }
    // Use the lower half for large, glanceable quantity and weight readings.
    // The final row carries the current action or connection status only.
    display.setTextSize(1);
    display.setCursor(6, 145);
    display.print("QTY");

    const uint8_t quantitySize = quantityText.length() <= 3 ? 5 :
                                 quantityText.length() <= 5 ? 4 :
                                 quantityText.length() <= 7 ? 3 : 2;
    const int16_t quantityWidth = quantityText.length() * 6 * quantitySize;
    constexpr int16_t quantityValueLeft = 42;
    const int16_t quantityAreaWidth = display.width() - quantityValueLeft - 6;
    const int16_t quantityInset = (quantityAreaWidth - quantityWidth) / 2;
    const int16_t centeredQuantityX = quantityValueLeft +
        (quantityInset > 0 ? quantityInset : 0);
    display.setTextSize(quantitySize);
    display.setCursor(centeredQuantityX, 126);
    display.print(quantityText);

    display.setTextSize(2);
    display.setCursor(6, 168);
    if (weightValid) {
      display.printf("%.1f g", max(0.0F, latestWeightGrams));
    } else {
      display.print("WEIGHT --");
    }
    display.drawFastHLine(6, 187, display.width() - 12, GxEPD_BLACK);
    display.setTextSize(1);
    display.setCursor(6, 190);
    display.print(screenStatusText().substring(0, 32));
  } while (display.nextPage());
  display.hibernate();
  displayRefreshRequested = false;
  Serial.printf("[EPD] Label refreshed status=%s quantity=%s weight=%s\n",
                screenStatusText().c_str(),
                stableQuantityKnown ? String(stableQuantity).c_str() : "--",
                weightValid ? String(latestWeightGrams, 1).c_str() : "--");
}

String wifiQrEscape(const String &value) {
  String escaped;
  escaped.reserve(value.length() + 8);
  for (size_t index = 0; index < value.length(); ++index) {
    const char character = value.charAt(index);
    if (character == '\\' || character == ';' || character == ',' ||
        character == ':' || character == '"') escaped += '\\';
    escaped += character;
  }
  return escaped;
}

void drawSetupQrCode(esp_qrcode_handle_t qrCode) {
  constexpr int quietModules = 4;
  constexpr int maximumPixels = 132;
  constexpr int top = 24;
  const int modules = esp_qrcode_get_size(qrCode);
  const int scale = max(1, maximumPixels / (modules + quietModules * 2));
  const int totalPixels = (modules + quietModules * 2) * scale;
  const int left = (display.width() - totalPixels) / 2;
  display.fillRect(left, top, totalPixels, totalPixels, GxEPD_WHITE);
  for (int y = 0; y < modules; ++y) {
    for (int x = 0; x < modules; ++x) {
      if (!esp_qrcode_get_module(qrCode, x, y)) continue;
      display.fillRect(left + (x + quietModules) * scale,
                       top + (y + quietModules) * scale,
                       scale, scale, GxEPD_BLACK);
    }
  }
}

void showSetupLabel() {
  updateLed(millis());
  const String qrPayload = "WIFI:T:WPA;S:" + wifiQrEscape(setupSsid) +
                           ";P:" + wifiQrEscape(Product::AP_PASSWORD) + ";;";
  esp_qrcode_config_t qrConfig = ESP_QRCODE_CONFIG_DEFAULT();
  qrConfig.display_func = drawSetupQrCode;
  qrConfig.max_qrcode_version = 6;
  qrConfig.qrcode_ecc_level = ESP_QRCODE_ECC_MED;

  display.setRotation(1);
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.setTextColor(GxEPD_BLACK);
    display.setTextWrap(false);
    display.setTextSize(1);
    display.setCursor(67, 3);
    display.print("WI-FI SETUP");
    display.setCursor(46, 14);
    display.print("SCAN QR TO CONNECT");
    if (esp_qrcode_generate(&qrConfig, qrPayload.c_str()) != ESP_OK) {
      display.setTextSize(1);
      display.setCursor(18, 76);
      display.print("QR unavailable");
    }
    display.setTextSize(1);
    display.setCursor(4, 164);
    display.print("Wi-Fi: ");
    display.print(setupSsid.substring(0, 25));
    display.setCursor(4, 177);
    display.print("Password: ");
    display.print(Product::AP_PASSWORD);
    display.setCursor(4, 190);
    display.print("Setup: http://192.168.4.1");
  } while (display.nextPage());
  display.hibernate();
  displayRefreshRequested = false;
  Serial.printf("[EPD] Setup QR shown for %s\n", setupSsid.c_str());
}

void resetQuantityTracking() {
  stableQuantityKnown = false;
  stableQuantityCandidateActive = false;
  guidedBaselineReady = false;
  if (guidedWeightAction) {
    findActive = false;
    findEndsAt = 0;
  }
  guidedWeightAction = false;
}

void resetWeightFilter() {
  rawWindowCount = 0;
  rawWindowIndex = 0;
  filteredRaw = 0.0;
  measurementNoiseCounts = 0.0F;
  filterReady = false;
  measurementStable = false;
  weightValid = false;
  resetQuantityTracking();
}

void updateWeightFilter(int64_t reading) {
  rawWindow[rawWindowIndex] = reading;
  rawWindowIndex = (rawWindowIndex + 1) % Measurement::WINDOW_SAMPLES;
  if (rawWindowCount < Measurement::WINDOW_SAMPLES) ++rawWindowCount;
  if (rawWindowCount < Measurement::WINDOW_SAMPLES) {
    filterReady = false;
    weightValid = false;
    return;
  }

  int64_t sorted[Measurement::WINDOW_SAMPLES];
  std::copy(rawWindow, rawWindow + Measurement::WINDOW_SAMPLES, sorted);
  std::sort(sorted, sorted + Measurement::WINDOW_SAMPLES);
  const size_t first = Measurement::TRIM_EACH_SIDE;
  const size_t last = Measurement::WINDOW_SAMPLES - Measurement::TRIM_EACH_SIDE;
  const size_t retained = last - first;
  double sum = 0.0;
  for (size_t i = first; i < last; ++i) sum += static_cast<double>(sorted[i]);
  filteredRaw = sum / retained;
  double variance = 0.0;
  for (size_t i = first; i < last; ++i) {
    const double difference = static_cast<double>(sorted[i]) - filteredRaw;
    variance += difference * difference;
  }
  measurementNoiseCounts = static_cast<float>(sqrt(variance / retained));
  measurementStable = measurementNoiseCounts <= Measurement::MAX_STABLE_NOISE_COUNTS;
  filterReady = true;

  if (config.scaleCountsPerGram == 0.0F) {
    weightValid = false;
    return;
  }
  latestWeightGrams = static_cast<float>(filteredRaw - config.tareOffset) /
                       config.scaleCountsPerGram;
  weightValid = isfinite(latestWeightGrams);
}

void sampleWeight(uint32_t now) {
  if (!elapsed(now, lastWeightSampleAt, Timing::WEIGHT_SAMPLE_INTERVAL_MS)) return;
  lastWeightSampleAt = now;
  if (!scale.is_ready()) {
    // At 10 samples/second, polling can land between conversions. Preserve the
    // last valid reading unless the HX711 has been silent for two full seconds.
    if (rawValid && elapsed(now, lastRawReadingAt, 2000)) {
      rawValid = false;
      weightValid = false;
    }
    return;
  }
  latestRaw = scale.read();
  lastRawReadingAt = now;
  rawValid = true;
  updateWeightFilter(latestRaw);
}

void logWeightDiagnostic(uint32_t now) {
  if (!setupMode || !elapsed(now, lastWeightLogAt, 1000)) return;
  lastWeightLogAt = now;
  if (!rawValid) {
    Serial.printf("[HX711] raw=unavailable (check DT/GPIO%d, SCK/GPIO%d and power)\n",
                  Pins::HX711_DT, Pins::HX711_SCK);
    return;
  }
  const int64_t netCounts = config.hasTare ? latestRaw - config.tareOffset : 0;
  Serial.printf("[HX711] raw=%lld tare=%s offset=%lld net=%lld filter=%u/%u",
                latestRaw, config.hasTare ? "yes" : "no", config.tareOffset,
                netCounts, static_cast<unsigned>(rawWindowCount),
                static_cast<unsigned>(Measurement::WINDOW_SAMPLES));
  if (filterReady) {
    Serial.printf(" filtered=%.1f noise=%.1f stable=%s", filteredRaw,
                  measurementNoiseCounts, measurementStable ? "yes" : "no");
  }
  if (weightValid) {
    Serial.printf(" weight=%.3f g", latestWeightGrams);
  } else {
    Serial.print(" weight=uncalibrated");
  }
  Serial.println();
}

bool collectStableRaw(const char *operation, int64_t &average, float &noise,
                      String &error) {
  int64_t samples[Measurement::WINDOW_SAMPLES];
  size_t count = 0;
  const uint32_t started = millis();
  Serial.printf("[%s] Collecting %u HX711 samples (about 3 seconds)\n", operation,
                static_cast<unsigned>(Measurement::WINDOW_SAMPLES));
  while (count < Measurement::WINDOW_SAMPLES &&
         !elapsed(millis(), started, Measurement::CAPTURE_TIMEOUT_MS)) {
    updateLed(millis());
    if (scale.is_ready()) {
      const int64_t reading = scale.read();
      if (llabs(reading) >= 8388000LL) {
        error = "HX711 is saturated; check load-cell wiring and applied load";
        Serial.printf("[%s] ERROR: %s (raw=%lld)\n", operation, error.c_str(), reading);
        return false;
      }
      samples[count++] = reading;
      Serial.printf("[%s] Sample %u/%u raw=%lld\n", operation,
                    static_cast<unsigned>(count),
                    static_cast<unsigned>(Measurement::WINDOW_SAMPLES), reading);
    }
    yield();
    delay(5);
  }
  if (count < Measurement::WINDOW_SAMPLES) {
    error = "HX711 unavailable or timed out";
    Serial.printf("[%s] ERROR: %s (received %u/%u samples)\n", operation,
                  error.c_str(),
                  static_cast<unsigned>(count),
                  static_cast<unsigned>(Measurement::WINDOW_SAMPLES));
    return false;
  }

  std::sort(samples, samples + Measurement::WINDOW_SAMPLES);
  const size_t first = Measurement::TRIM_EACH_SIDE;
  const size_t last = Measurement::WINDOW_SAMPLES - Measurement::TRIM_EACH_SIDE;
  const size_t retained = last - first;
  double sum = 0.0;
  for (size_t i = first; i < last; ++i) sum += static_cast<double>(samples[i]);
  const double mean = sum / retained;
  double variance = 0.0;
  for (size_t i = first; i < last; ++i) {
    const double difference = static_cast<double>(samples[i]) - mean;
    variance += difference * difference;
  }
  variance /= retained;
  const double standardDeviation = sqrt(variance);
  noise = static_cast<float>(standardDeviation);
  Serial.printf("[%s] Trimmed statistics: mean=%.1f noise=%.1f limit=%.1f counts\n",
                operation, mean, standardDeviation,
                Measurement::MAX_STABLE_NOISE_COUNTS);
  if (standardDeviation > Measurement::MAX_STABLE_NOISE_COUNTS) {
    error = "Reading is unstable (noise " + String(standardDeviation, 0) +
            " counts); settle the empty bin and retry";
    Serial.printf("[%s] ERROR: %s\n", operation, error.c_str());
    return false;
  }
  average = static_cast<int64_t>(llround(mean));
  Serial.printf("[%s] Stable filtered reading accepted: %lld\n", operation, average);
  return true;
}

void sendJson(int status, const String &body) {
  server.sendHeader("Cache-Control", "no-store");
  server.send(status, "application/json", body);
}

void sendError(int status, const String &message) {
  sendJson(status, "{\"error\":\"" + jsonEscape(message) + "\"}");
}

void sendPortal() {
  server.sendHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  server.sendHeader("Pragma", "no-cache");
  server.send_P(200, "text/html", PORTAL_HTML);
}

String statusJson() {
  JsonDocument doc;
  doc["binId"] = binId;
  doc["firmware"] = Product::FIRMWARE_VERSION;
  doc["state"] = stateName();
  doc["setupMode"] = setupMode;
  doc["ssid"] = WiFi.status() == WL_CONNECTED ? WiFi.SSID() : "";
  doc["ip"] = setupMode ? WiFi.softAPIP().toString() :
              (WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "");
  doc["rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  doc["mqttHost"] = config.mqttHost;
  doc["mqttPort"] = config.mqttPort;
  doc["mqttConnected"] = mqttClient.connected();
  doc["mqttDiscovered"] = discoveryOfferReceived;
  doc["mqttDiscoveryActive"] = discoveryStarted;
  doc["mqttDiscoveryAttempts"] = discoveryAttempts;
  doc["mqttAuthenticationRequired"] = discoveryOfferReceived
      ? discoveredAuthenticationRequired
      : !config.mqttUsername.isEmpty();
  doc["otaEnabled"] = !setupMode && WiFi.status() == WL_CONNECTED;
  doc["otaPasswordProtected"] = !config.otaPassword.isEmpty();
  doc["partId"] = config.partId;
  doc["partName"] = config.partName;
  doc["rawValid"] = rawValid;
  if (rawValid) doc["raw"] = latestRaw;
  doc["hasTare"] = config.hasTare;
  doc["tareOffset"] = config.tareOffset;
  if (rawValid && config.hasTare) doc["netRaw"] = latestRaw - config.tareOffset;
  doc["filterSamples"] = rawWindowCount;
  doc["filterWindowSamples"] = Measurement::WINDOW_SAMPLES;
  doc["filterReady"] = filterReady;
  doc["measurementStable"] = measurementStable;
  if (filterReady) {
    doc["filteredRaw"] = filteredRaw;
    doc["filteredNetRaw"] = filteredRaw - config.tareOffset;
    doc["noiseCounts"] = measurementNoiseCounts;
  }
  doc["weightValid"] = weightValid;
  if (weightValid) doc["weightGrams"] = serialized(String(latestWeightGrams, 3));
  doc["scaleCountsPerGram"] = config.scaleCountsPerGram;
  doc["unitWeightGrams"] = config.unitWeightGrams;
  if (weightValid && measurementStable && config.unitWeightGrams > 0.0F) {
    doc["estimatedQuantity"] = lroundf(max(0.0F, latestWeightGrams) /
                                        config.unitWeightGrams);
  } else {
    doc["estimatedQuantity"] = nullptr;
  }
  doc["uptimeSeconds"] = millis() / 1000;
  String output;
  serializeJson(doc, output);
  return output;
}

void configureRoutes() {
  static const char *trackedHeaders[] = {"X-OTA-Password", "X-Firmware-Manifest"};
  server.collectHeaders(trackedHeaders, 2);
  server.on("/", HTTP_GET, [] { sendPortal(); });
  server.on("/setup", HTTP_GET, [] { sendPortal(); });
  server.on("/api/status", HTTP_GET, [] { sendJson(200, statusJson()); });

  server.on("/api/networks", HTTP_GET, [] {
    Serial.printf("[HTTP] GET /api/networks from %s\n",
                  server.client().remoteIP().toString().c_str());
    const int found = WiFi.scanNetworks(false, true);
    JsonDocument doc;
    JsonArray networks = doc["networks"].to<JsonArray>();
    for (int i = 0; i < found; ++i) {
      JsonObject network = networks.add<JsonObject>();
      network["ssid"] = WiFi.SSID(i);
      network["rssi"] = WiFi.RSSI(i);
      network["secure"] = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
    }
    WiFi.scanDelete();
    String output;
    serializeJson(doc, output);
    sendJson(200, output);
  });

  server.on("/api/config", HTTP_POST, [] {
    Serial.printf("[HTTP] POST /api/config from %s\n",
                  server.client().remoteIP().toString().c_str());
    String ssid = server.arg("ssid");
    ssid.trim();
    if (ssid.isEmpty() || ssid.length() > 32) {
      sendError(400, "Choose a valid Wi-Fi network");
      return;
    }
    const String password = server.arg("password");
    if (password.length() > 63) {
      sendError(400, "Wi-Fi password is too long");
      return;
    }
    String mqttHost = server.arg("mqttHost");
    mqttHost.trim();
    const long requestedMqttPort = server.arg("mqttPort").isEmpty()
                                       ? 1883
                                       : server.arg("mqttPort").toInt();
    if (mqttHost.length() > 253 || requestedMqttPort < 1 || requestedMqttPort > 65535) {
      sendError(400, "Enter a valid MQTT host and port");
      return;
    }
    const String unitWeightText = server.arg("unitWeight");
    float unitWeight = config.unitWeightGrams;
    if (!unitWeightText.isEmpty()) {
      unitWeight = unitWeightText.toFloat();
      if (!isfinite(unitWeight) || unitWeight < 0.0F) {
        sendError(400, "Unit weight must be zero or a positive number");
        return;
      }
    }
    config.wifiSsid = ssid;
    config.wifiPassword = password;
    config.mqttHost = mqttHost;
    config.mqttPort = static_cast<uint16_t>(requestedMqttPort);
    const String requestedMqttUsername = server.arg("mqttUsername");
    const String requestedMqttPassword = server.arg("mqttPassword");
    if (!requestedMqttUsername.isEmpty() || !requestedMqttPassword.isEmpty()) {
      config.mqttUsername = requestedMqttUsername;
      config.mqttPassword = requestedMqttPassword;
    }
    const String requestedOtaPassword = server.arg("otaPassword");
    if (!requestedOtaPassword.isEmpty() && requestedOtaPassword.length() < 8) {
      sendError(400, "OTA password must be at least 8 characters");
      return;
    }
    if (!requestedOtaPassword.isEmpty()) config.otaPassword = requestedOtaPassword;
    config.unitWeightGrams = unitWeight;
    preferences.putString("wifi_ssid", config.wifiSsid);
    preferences.putString("wifi_pass", config.wifiPassword);
    preferences.putString("mqtt_host", config.mqttHost);
    preferences.putUShort("mqtt_port", config.mqttPort);
    preferences.putString("mqtt_user", config.mqttUsername);
    preferences.putString("mqtt_pass", config.mqttPassword);
    if (!requestedOtaPassword.isEmpty()) {
      preferences.putString("ota_pass", config.otaPassword);
    }
    preferences.putFloat("unit_g", config.unitWeightGrams);
    sendJson(200, "{\"message\":\"Saved. Connecting now; the setup network will close.\"}");
    delay(350);
    ESP.restart();
  });

  server.on("/api/tare", HTTP_POST, [] {
    Serial.printf("[HTTP] POST /api/tare from %s\n",
                  server.client().remoteIP().toString().c_str());
    Serial.println("[TARE] Request accepted; bin must be empty and still");
    tareInProgress = true;
    refreshOperationalLabel();
    String error;
    int64_t offset = 0;
    float captureNoise = 0.0F;
    const bool ok = collectStableRaw("TARE", offset, captureNoise, error);
    tareInProgress = false;
    refreshOperationalLabel();
    if (!ok) {
      Serial.printf("[TARE] Failed: %s\n", error.c_str());
      sendError(503, error);
      return;
    }
    Serial.printf("[NVS] Saving tare offset %lld\n", offset);
    const bool offsetSaved = preferences.putLong64("tare", offset) == sizeof(int64_t);
    const bool flagSaved = preferences.putBool("has_tare", true) == sizeof(bool);
    if (!offsetSaved || !flagSaved) {
      Serial.printf("[NVS] ERROR saving tare: offsetSaved=%s flagSaved=%s\n",
                    offsetSaved ? "yes" : "no", flagSaved ? "yes" : "no");
      sendError(500, "Tare was measured but could not be saved to device storage");
      return;
    }
    config.tareOffset = offset;
    config.hasTare = true;
    latestRaw = offset;
    rawValid = true;
    resetWeightFilter();
    Serial.printf("[TARE] COMPLETE: offset=%lld net=0 persisted=yes\n", offset);
    sendJson(200, "{\"ok\":true,\"offset\":" + String(offset) + "}");
  });

  server.on("/api/calibrate", HTTP_POST, [] {
    Serial.printf("[HTTP] POST /api/calibrate from %s\n",
                  server.client().remoteIP().toString().c_str());
    const float knownWeight = server.arg("knownWeightGrams").toFloat();
    Serial.printf("[CAL] Requested known mass: %.3f g tare=%lld\n",
                  knownWeight, config.tareOffset);
    if (!rawValid || !config.hasTare || !isfinite(knownWeight) || knownWeight <= 0.0F) {
      Serial.println("[CAL] ERROR: valid reading, saved tare and positive mass required");
      sendError(400, "A valid reading, saved tare, and positive known weight are required");
      return;
    }
    tareInProgress = true;
    refreshOperationalLabel();
    String captureError;
    int64_t calibrationRaw = 0;
    float captureNoise = 0.0F;
    const bool captureOk = collectStableRaw("CAL", calibrationRaw, captureNoise,
                                            captureError);
    tareInProgress = false;
    refreshOperationalLabel();
    if (!captureOk) {
      sendError(503, captureError);
      return;
    }
    latestRaw = calibrationRaw;
    lastRawReadingAt = millis();
    const int64_t rawDelta = calibrationRaw - config.tareOffset;
    Serial.printf("[CAL] Load signal delta=%lld counts\n", rawDelta);
    const float calculatedScale = static_cast<float>(rawDelta) / knownWeight;
    if (!isfinite(calculatedScale) || fabsf(calculatedScale) < 1.0F) {
      const String error = "Applied mass changed the HX711 by only " +
                           String(rawDelta) +
                           " counts; check load-cell wiring and mounting";
      Serial.printf("[CAL] ERROR: %s\n", error.c_str());
      sendError(400, error);
      return;
    }
    config.scaleCountsPerGram = calculatedScale;
    preferences.putFloat("scale", calculatedScale);
    resetWeightFilter();
    Serial.printf("[CAL] COMPLETE: scale=%.6f counts/g\n", calculatedScale);
    sendJson(200, "{\"ok\":true,\"scaleCountsPerGram\":" +
                      String(calculatedScale, 6) + "}");
  });

  server.on("/api/find", HTTP_POST, [] {
    Serial.printf("[HTTP] POST /api/find from %s\n",
                  server.client().remoteIP().toString().c_str());
    findActive = server.arg("active") != "0";
    findAction = FindAction::Find;
    const uint32_t seconds = constrain(server.arg("timeout").toInt(), 1L, 3600L);
    findEndsAt = findActive ? millis() + seconds * 1000UL : 0;
    displayRefreshRequested = true;
    sendJson(200, "{\"ok\":true}");
  });

  server.on("/api/factory-reset", HTTP_POST, [] {
    Serial.printf("[HTTP] POST /api/factory-reset from %s\n",
                  server.client().remoteIP().toString().c_str());
    preferences.remove("wifi_ssid");
    preferences.remove("wifi_pass");
    sendJson(200, "{\"ok\":true}");
    delay(300);
    ESP.restart();
  });

  server.on(
      "/api/ota", HTTP_POST,
      [] {
        if (!otaUploadAuthorized) {
          sendError(401, otaUploadError.isEmpty() ? "OTA authorization failed"
                                                  : otaUploadError);
          return;
        }
        if (!otaUploadSuccess) {
          sendError(500, otaUploadError.isEmpty() ? "Firmware update failed"
                                                  : otaUploadError);
          return;
        }
        Serial.printf("[OTA] Upload complete: %u bytes; rebooting\n",
                      static_cast<unsigned>(otaBytesWritten));
        sendJson(200, "{\"ok\":true,\"message\":\"Firmware installed; device is restarting\"}");
        delay(600);
        ESP.restart();
      },
      [] {
        HTTPUpload &upload = server.upload();
        if (upload.status == UPLOAD_FILE_START) {
          const bool stationConnected = !setupMode && WiFi.status() == WL_CONNECTED;
          const bool passwordAccepted = config.otaPassword.isEmpty() ||
                                        server.header("X-OTA-Password") == config.otaPassword;
          if (uploadHashActive) { mbedtls_sha256_free(&uploadHash); uploadHashActive=false; }
          String verificationError;
          const bool manifestValid = !deserializeJson(uploadManifest, server.header("X-Firmware-Manifest")) &&
            verifyOtaManifest(uploadManifest.as<JsonObjectConst>(), verificationError);
          otaUploadAuthorized = stationConnected && passwordAccepted && manifestValid;
          otaUploadSuccess = false;
          otaUploadError = "";
          otaBytesWritten = 0;
          if (!otaUploadAuthorized) {
            otaUploadError = !stationConnected
                                 ? "OTA is disabled in setup/AP mode"
                                 : !passwordAccepted ? "Incorrect OTA password" : verificationError.isEmpty() ? "Signed manifest required" : verificationError;
            Serial.printf("[OTA] REJECTED: %s\n", otaUploadError.c_str());
            return;
          }
          otaInProgress = true;
          displayRefreshRequested = true;
          Serial.printf("[OTA] Starting upload: %s\n", upload.filename.c_str());
          mbedtls_sha256_init(&uploadHash); uploadHashActive=true;
          mbedtls_sha256_starts_ret(&uploadHash, 0);
          if (!Update.begin(uploadManifest["sizeBytes"].as<size_t>(), U_FLASH)) {
            otaUploadError = Update.errorString();
            otaInProgress = false;
            Serial.printf("[OTA] ERROR begin: %s\n", otaUploadError.c_str());
          }
        } else if (upload.status == UPLOAD_FILE_WRITE) {
          if (!otaUploadAuthorized || !otaUploadError.isEmpty()) return;
          if (otaBytesWritten + upload.currentSize > uploadManifest["sizeBytes"].as<size_t>()) {
            otaUploadError="Upload exceeds signed size"; Update.abort(); otaInProgress=false; return;
          }
          if (mbedtls_sha256_update_ret(&uploadHash,upload.buf,upload.currentSize)!=0) {
            otaUploadError="Could not hash firmware"; Update.abort(); otaInProgress=false; return;
          }
          const size_t written = Update.write(upload.buf, upload.currentSize);
          otaBytesWritten += written;
          if (written != upload.currentSize) {
            otaUploadError = Update.errorString();
            Serial.printf("[OTA] ERROR write: %s\n", otaUploadError.c_str());
            return;
          }
          if ((otaBytesWritten % (128 * 1024)) < upload.currentSize) {
            Serial.printf("[OTA] Written %u bytes\n",
                          static_cast<unsigned>(otaBytesWritten));
          }
        } else if (upload.status == UPLOAD_FILE_END) {
          if (!otaUploadAuthorized || !otaUploadError.isEmpty()) {
            Update.abort();
            if (uploadHashActive) { mbedtls_sha256_free(&uploadHash); uploadHashActive=false; }
            otaInProgress = false;
            return;
          }
          uint8_t digest[32]; char hex[65];
          const bool hashed = mbedtls_sha256_finish_ret(&uploadHash,digest)==0;
          mbedtls_sha256_free(&uploadHash); uploadHashActive=false;
          for (size_t i=0;i<32;i++) snprintf(hex+i*2,3,"%02x",digest[i]);
          hex[64]='\0';
          if (!hashed || otaBytesWritten != uploadManifest["sizeBytes"].as<size_t>() || uploadManifest["sha256"].as<String>() != hex) {
            otaUploadError="Firmware digest or size mismatch"; Update.abort(); otaInProgress=false; return;
          }
          otaUploadSuccess = Update.end(true);
          otaInProgress = false;
          if (!otaUploadSuccess) {
            otaUploadError = Update.errorString();
            Serial.printf("[OTA] ERROR finalize: %s\n", otaUploadError.c_str());
          }
        } else if (upload.status == UPLOAD_FILE_ABORTED) {
          Update.abort();
          if (uploadHashActive) { mbedtls_sha256_free(&uploadHash); uploadHashActive=false; }
          otaUploadSuccess = false;
          otaInProgress = false;
          otaUploadError = "Upload aborted";
          Serial.println("[OTA] Upload aborted");
        }
      });

  // Captive-portal probes used by Android, Apple and Windows.
  server.on("/generate_204", HTTP_ANY, [] { server.sendHeader("Location", "/", true); server.send(302); });
  server.on("/hotspot-detect.html", HTTP_ANY, [] { sendPortal(); });
  server.on("/ncsi.txt", HTTP_ANY, [] { server.sendHeader("Location", "/", true); server.send(302); });
  server.on("/connecttest.txt", HTTP_ANY, [] { server.sendHeader("Location", "/", true); server.send(302); });
  server.onNotFound([] {
    if (setupMode) {
      server.sendHeader("Location", String("http://") + WiFi.softAPIP().toString() + "/", true);
      server.send(302);
    } else {
      sendError(404, "Not found");
    }
  });
}

void startWebServer() {
  if (webServerStarted) return;
  configureRoutes();
  server.begin();
  webServerStarted = true;
}

void enterSetupMode(const String &reason) {
  Serial.printf("Entering Setup Mode: %s\n", reason.c_str());
  if (discoveryStarted) {
    discoveryUdp.stop();
    discoveryStarted = false;
  }
  setupMode = true;
  deviceState = DeviceState::Setup;
  stateStartedAt = millis();
  WiFi.disconnect(true, false);
  delay(100);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(setupSsid.c_str(), Product::AP_PASSWORD);
  dnsServer.start(53, "*", WiFi.softAPIP());
  startWebServer();
  showSetupLabel();
  Serial.printf("Setup AP: %s, address: http://%s/\n", setupSsid.c_str(),
                WiFi.softAPIP().toString().c_str());
}

void startStationConnection() {
  setupMode = false;
  discoveryOfferReceived = false;
  discoveredAuthenticationRequired = false;
  discoveredBrokerPendingSave = false;
  deviceState = DeviceState::Connecting;
  stateStartedAt = millis();
  lastWifiAttemptAt = stateStartedAt;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);  // Credentials are owned by Preferences, not the Wi-Fi NVS copy.
  WiFi.setHostname(binId.c_str());
  WiFi.begin(config.wifiSsid.c_str(), config.wifiPassword.c_str());
  showLabel(config.partName.isEmpty() ? "CONNECTING" : "ASSIGNED");
}

String mqttTopic(const String &suffix) {
  return String(Product::MQTT_TOPIC_ROOT) + "/bins/" + binId + "/" + suffix;
}

bool publishMqtt(const String &topic, const String &payload, bool retained = false) {
  if (!mqttClient.connected()) return false;
  const bool ok = mqttClient.publish(topic.c_str(), payload.c_str(), retained);
  if (!ok) Serial.printf("[MQTT] Publish failed: %s\n", topic.c_str());
  return ok;
}

void recordMqttResult(bool success) {
  const DeviceState previousState = deviceState;
  if (success) {
    mqttFailures = 0;
    if (deviceState == DeviceState::BackendError) deviceState = DeviceState::Online;
  } else {
    mqttFailures = min<uint8_t>(mqttFailures + 1, 10);
    if (mqttFailures >= 3) deviceState = DeviceState::BackendError;
  }
  if (deviceState != previousState) displayRefreshRequested = true;
}

void sendTelemetry(uint32_t now) {
  if (!mqttClient.connected() ||
      !elapsed(now, lastTelemetryAt, Timing::TELEMETRY_INTERVAL_MS)) return;
  lastTelemetryAt = now;
  JsonDocument doc;
  doc["binId"] = binId;
  doc["firmwareVersion"] = Product::FIRMWARE_VERSION;
  doc["hardwareTarget"] = Product::HARDWARE_TARGET;
  doc["partitionLayout"] = Product::PARTITION_LAYOUT;
  doc["bootValidated"] = bootValidated;
  doc["deviceState"] = stateName();
  doc["uptimeSeconds"] = now / 1000;
  doc["rssi"] = WiFi.RSSI();
  doc["ipAddress"] = WiFi.localIP().toString();
  doc["rawValid"] = rawValid;
  if (rawValid) doc["rawAdc"] = latestRaw;
  doc["filterReady"] = filterReady;
  doc["measurementStable"] = measurementStable;
  doc["filterSamples"] = rawWindowCount;
  if (filterReady) {
    doc["filteredRawAdc"] = filteredRaw;
    doc["measurementNoiseCounts"] = measurementNoiseCounts;
  }
  doc["weightValid"] = weightValid;
  if (weightValid) doc["netWeightGrams"] = latestWeightGrams;
  doc["tareOffset"] = config.tareOffset;
  doc["scaleCountsPerGram"] = config.scaleCountsPerGram;
  doc["unitWeightGrams"] = config.unitWeightGrams;
  doc["partName"] = config.partName;
  if (stableQuantityKnown) {
    doc["estimatedQuantity"] = stableQuantity;
  } else if (weightValid && measurementStable && config.unitWeightGrams > 0.0F) {
    doc["estimatedQuantity"] = lroundf(max(0.0F, latestWeightGrams) /
                                        config.unitWeightGrams);
  } else {
    doc["estimatedQuantity"] = nullptr;
  }
  if (guidedWeightAction) {
    doc["guidedAction"] = findAction == FindAction::Pick ? "pick" : "restock";
  } else {
    doc["guidedAction"] = nullptr;
  }
  doc["partId"] = config.partId;
  String body;
  serializeJson(doc, body);
  const bool ok = publishMqtt(mqttTopic("telemetry"), body, true);
  Serial.printf("[MQTT] Telemetry %s (%u bytes)\n", ok ? "published" : "failed",
                static_cast<unsigned>(body.length()));
  recordMqttResult(ok);
}

void refreshOperationalLabel() {
  showLabel(config.partName.isEmpty() ? "READY / UNASSIGNED" : "ASSIGNED");
}

void requestImmediateTelemetry(uint32_t now) {
  lastTelemetryAt = now - Timing::TELEMETRY_INTERVAL_MS;
}

void startGuidedWeightAction(FindAction action, uint32_t now, uint32_t timeoutSeconds) {
  findAction = action;
  findActive = true;
  guidedWeightAction = action == FindAction::Pick || action == FindAction::Restock;
  guidedBaselineReady = false;
  weightChangeFlashActive = false;
  findEndsAt = now + timeoutSeconds * 1000UL;
  displayRefreshRequested = true;

  if (guidedWeightAction && stableQuantityKnown) {
    guidedBaselineQuantity = stableQuantity;
    guidedBaselineReady = true;
  } else if (guidedWeightAction && weightValid && measurementStable &&
             config.unitWeightGrams > 0.0F) {
    guidedBaselineQuantity = lroundf(max(0.0F, latestWeightGrams) /
                                     config.unitWeightGrams);
    guidedBaselineReady = true;
  }

  if (guidedWeightAction) {
    Serial.printf("[GUIDE] %s started baseline=%s timeout=%u seconds\n",
                  action == FindAction::Pick ? "pick" : "restock",
                  guidedBaselineReady ? String(guidedBaselineQuantity).c_str() : "waiting",
                  static_cast<unsigned>(timeoutSeconds));
  }
}

void processStableWeightChange(uint32_t now) {
  if (!weightValid || !measurementStable || config.unitWeightGrams <= 0.0F ||
      tareInProgress || otaInProgress) {
    stableQuantityCandidateActive = false;
    return;
  }

  const long quantity = lroundf(max(0.0F, latestWeightGrams) /
                                config.unitWeightGrams);
  if (stableQuantityKnown && quantity == stableQuantity) {
    stableQuantityCandidateActive = false;
    if (guidedWeightAction && !guidedBaselineReady) {
      guidedBaselineQuantity = quantity;
      guidedBaselineReady = true;
      Serial.printf("[GUIDE] Stable baseline acquired: %ld units\n", quantity);
    }
    return;
  }

  if (!stableQuantityCandidateActive || stableQuantityCandidate != quantity) {
    stableQuantityCandidate = quantity;
    stableQuantityCandidateSince = now;
    stableQuantityCandidateActive = true;
    return;
  }
  if (!elapsed(now, stableQuantityCandidateSince,
               Measurement::STABLE_QUANTITY_CONFIRM_MS)) return;
  stableQuantityCandidateActive = false;

  if (!stableQuantityKnown) {
    stableQuantity = quantity;
    stableQuantityKnown = true;
    if (guidedWeightAction && !guidedBaselineReady) {
      guidedBaselineQuantity = quantity;
      guidedBaselineReady = true;
      Serial.printf("[GUIDE] Stable baseline acquired: %ld units\n", quantity);
    }
    Serial.printf("[WEIGHT] Stable quantity baseline=%ld (%.1f g)\n",
                  stableQuantity, latestWeightGrams);
    if (!setupMode) refreshOperationalLabel();
    requestImmediateTelemetry(now);
    return;
  }

  const long previousQuantity = stableQuantity;
  const long quantityDelta = quantity - previousQuantity;
  stableQuantity = quantity;
  Serial.printf("[WEIGHT] Stable quantity change: %ld -> %ld (%+ld, %.1f g)\n",
                previousQuantity, quantity, quantityDelta, latestWeightGrams);

  const bool findCompleted = findActive && findAction == FindAction::Find;
  if (findCompleted) {
    findActive = false;
    findEndsAt = 0;
    guidedBaselineReady = false;
    Serial.printf("[GUIDE] find complete after stable quantity change: %ld -> %ld\n",
                  previousQuantity, quantity);
  }

  bool guidedCompleted = false;
  if (guidedWeightAction && guidedBaselineReady) {
    guidedCompleted =
        (findAction == FindAction::Pick && quantity < guidedBaselineQuantity) ||
        (findAction == FindAction::Restock && quantity > guidedBaselineQuantity);
    if (guidedCompleted) {
      Serial.printf("[GUIDE] %s complete: baseline=%ld current=%ld\n",
                    findAction == FindAction::Pick ? "pick" : "restock",
                    guidedBaselineQuantity, quantity);
      guidedWeightAction = false;
      guidedBaselineReady = false;
      findActive = false;
      findEndsAt = 0;
      successIndication = true;
      successEndsAt = now + Timing::SUCCESS_LED_DURATION_MS;
    } else {
      Serial.println("[GUIDE] Change did not match requested direction; continuing guidance");
    }
  }

  if (!guidedWeightAction && !guidedCompleted && !findCompleted && !setupMode) {
    weightChangeFlashAction = quantityDelta < 0 ? FindAction::Pick : FindAction::Restock;
    weightChangeFlashActive = true;
    weightChangeFlashEndsAt = now + Timing::WEIGHT_CHANGE_FLASH_MS;
  }
  if (!setupMode) refreshOperationalLabel();
  requestImmediateTelemetry(now);
}

void saveAssignment(JsonObjectConst command) {
  const String nextPartId = command["partId"] | "";
  const String nextName = command["name"] | "";
  const String nextDescription = command["description"] | "";
  if (nextPartId.isEmpty() || nextName.isEmpty()) return;
  float nextUnitWeightGrams = config.unitWeightGrams;
  if (command["unitWeightGrams"].is<float>()) {
    const float value = command["unitWeightGrams"].as<float>();
    if (isfinite(value) && value >= 0.0F) nextUnitWeightGrams = value;
  }
  const bool quantityConfigurationChanged = config.partId != nextPartId ||
      fabsf(config.unitWeightGrams - nextUnitWeightGrams) > 0.0001F;
  config.partId = nextPartId;
  config.partName = nextName.substring(0, Product::MAX_LABEL_NAME);
  config.partDescription = nextDescription.substring(0, Product::MAX_LABEL_DESCRIPTION);
  config.unitWeightGrams = nextUnitWeightGrams;
  preferences.putString("part_id", config.partId);
  preferences.putString("part_name", config.partName);
  preferences.putString("part_desc", config.partDescription);
  preferences.putFloat("unit_g", config.unitWeightGrams);
  if (quantityConfigurationChanged) resetQuantityTracking();
  showLabel("ASSIGNED");
  requestImmediateTelemetry(millis());
}

void clearAssignment() {
  config.partId = "";
  config.partName = "";
  config.partDescription = "";
  config.unitWeightGrams = 0.0F;
  preferences.remove("part_id");
  preferences.remove("part_name");
  preferences.remove("part_desc");
  preferences.remove("unit_g");
  findActive = false;
  findEndsAt = 0;
  guidedWeightAction = false;
  guidedBaselineReady = false;
  successIndication = false;
  weightChangeFlashActive = false;
  resetQuantityTracking();
  showLabel("READY / UNASSIGNED");
  requestImmediateTelemetry(millis());
  Serial.println("[ASSIGN] Bin assignment cleared; load-cell calibration retained");
}

void acknowledgeCommand(const String &commandId, bool ok, const String &message) {
  if (commandId.isEmpty()) return;
  JsonDocument doc;
  doc["binId"] = binId;
  doc["commandId"] = commandId;
  doc["ok"] = ok;
  doc["message"] = message;
  doc["firmwareVersion"] = Product::FIRMWARE_VERSION;
  doc["hardwareTarget"] = Product::HARDWARE_TARGET;
  doc["partitionLayout"] = Product::PARTITION_LAYOUT;
  doc["bootValidated"] = bootValidated;
  String body;
  serializeJson(doc, body);
  publishMqtt(mqttTopic("acks"), body, false);
}

void publishOtaStatus(const String &commandId, const char *state, int progress,
                      const String &message = "") {
  JsonDocument doc;
  doc["binId"] = binId;
  doc["commandId"] = commandId;
  doc["state"] = state;
  doc["progress"] = progress;
  if (!message.isEmpty()) doc["message"] = message;
  String body;
  serializeJson(doc, body);
  publishMqtt(mqttTopic("ota"), body, true);
}

bool installOtaFromUrl(JsonObjectConst command, const String &commandId,
                       String &message) {
  if (!verifyOtaManifest(command, message)) return false;
  const String version = command["version"] | "";
  const String url = command["url"] | "";
  String expectedSha = command["sha256"] | "";
  const bool force = command["force"] | false;
  expectedSha.toLowerCase();

  if (version.isEmpty() || url.isEmpty() || expectedSha.length() != 64) {
    message = "OTA requires version, absolute URL and 64-character sha256";
    return false;
  }
  if (!url.startsWith("http://")) {
    message = "This prototype accepts OTA downloads from http:// URLs only";
    return false;
  }
  if (!force && version == Product::FIRMWARE_VERSION) {
    message = "Firmware version is already installed";
    return false;
  }
  if (setupMode || WiFi.status() != WL_CONNECTED) {
    message = "OTA requires normal Wi-Fi station mode";
    return false;
  }

  otaInProgress = true;
  refreshOperationalLabel();
  publishOtaStatus(commandId, "downloading", 0, "Starting firmware download");
  Serial.printf("[OTA] MQTT command: version=%s url=%s\n", version.c_str(), url.c_str());

  WiFiClient downloadClient;
  HTTPClient http;
  bool updateStarted = false;
  bool shaStarted = false;
  mbedtls_sha256_context shaContext;

  auto fail = [&](const String &reason) {
    if (updateStarted) Update.abort();
    if (shaStarted) mbedtls_sha256_free(&shaContext);
    http.end();
    otaInProgress = false;
    displayRefreshRequested = true;
    message = reason;
    publishOtaStatus(commandId, "failed", 0, reason);
    Serial.printf("[OTA] ERROR: %s\n", reason.c_str());
    return false;
  };

  http.setConnectTimeout(Timing::OTA_DOWNLOAD_TIMEOUT_MS);
  http.setTimeout(Timing::OTA_DOWNLOAD_TIMEOUT_MS);
  if (!http.begin(downloadClient, url)) return fail("Could not open firmware URL");
  const int responseCode = http.GET();
  if (responseCode != HTTP_CODE_OK) {
    return fail("Firmware server returned HTTP " + String(responseCode));
  }
  const int contentLength = http.getSize();
  if (contentLength <= 0 || static_cast<size_t>(contentLength) != command["sizeBytes"].as<size_t>()) {
    return fail("Firmware Content-Length must match signed metadata");
  }
  if (!Update.begin(static_cast<size_t>(contentLength), U_FLASH)) {
    return fail("Update begin failed: " + String(Update.errorString()));
  }
  updateStarted = true;

  mbedtls_sha256_init(&shaContext);
  shaStarted = true;
  if (mbedtls_sha256_starts_ret(&shaContext, 0) != 0) {
    return fail("Could not initialize SHA-256 verification");
  }

  WiFiClient *stream = http.getStreamPtr();
  uint8_t buffer[2048];
  size_t totalWritten = 0;
  uint32_t lastDataAt = millis();
  int lastProgress = -10;
  while (totalWritten < static_cast<size_t>(contentLength)) {
    const size_t available = stream->available();
    if (available > 0) {
      const size_t wanted = min(available, sizeof(buffer));
      const size_t received = stream->readBytes(buffer, wanted);
      if (received == 0) continue;
      lastDataAt = millis();
      if (Update.write(buffer, received) != received) {
        return fail("Flash write failed: " + String(Update.errorString()));
      }
      if (mbedtls_sha256_update_ret(&shaContext, buffer, received) != 0) {
        return fail("SHA-256 calculation failed");
      }
      totalWritten += received;
      const int progress = static_cast<int>((totalWritten * 100ULL) / contentLength);
      if (progress >= lastProgress + 10 || progress == 100) {
        lastProgress = progress;
        publishOtaStatus(commandId, "downloading", progress);
        Serial.printf("[OTA] Downloaded %u/%d bytes (%d%%)\n",
                      static_cast<unsigned>(totalWritten), contentLength, progress);
      }
    } else {
      if (!http.connected()) return fail("Firmware download ended early");
      if (elapsed(millis(), lastDataAt, Timing::OTA_DOWNLOAD_TIMEOUT_MS)) {
        return fail("Firmware download timed out");
      }
      delay(2);
    }
    mqttClient.loop();
    updateLed(millis());
    yield();
  }

  uint8_t digest[32];
  if (mbedtls_sha256_finish_ret(&shaContext, digest) != 0) {
    return fail("SHA-256 finalization failed");
  }
  mbedtls_sha256_free(&shaContext);
  shaStarted = false;
  http.end();

  char actualSha[65];
  for (size_t i = 0; i < sizeof(digest); ++i) {
    snprintf(actualSha + i * 2, 3, "%02x", digest[i]);
  }
  actualSha[64] = '\0';
  if (expectedSha != actualSha) {
    return fail("Firmware SHA-256 does not match the manifest");
  }
  if (!Update.end(true)) {
    return fail("Update finalize failed: " + String(Update.errorString()));
  }
  updateStarted = false;
  otaInProgress = false;
  message = "Firmware " + version + " verified and installed";
  publishOtaStatus(commandId, "installed", 100, message);
  Serial.printf("[OTA] COMPLETE: version=%s sha256=%s\n", version.c_str(), actualSha);
  return true;
}

void handleMqttCommand(const String &body) {
  JsonDocument doc;
  const DeserializationError parseError = deserializeJson(doc, body);
  if (parseError || doc["command"].isNull()) {
    Serial.printf("[MQTT] Invalid command JSON: %s\n", parseError.c_str());
    return;
  }
  const String type = doc["command"].as<String>();
  const String commandId = doc["commandId"] | "";
  if (commandId.isEmpty()) {
    Serial.println("[MQTT] Rejected command without commandId");
    return;
  }
  if (commandId == lastProcessedCommandId) {
    Serial.printf("[MQTT] Duplicate command acknowledged: %s\n", commandId.c_str());
    acknowledgeCommand(commandId, true, "duplicate already processed");
    return;
  }

  Serial.printf("[MQTT] Command %s type=%s\n", commandId.c_str(), type.c_str());
  bool ok = true;
  bool restartAfterAck = false;
  String message = "completed";
  if (type == "find") {
    const bool active = doc["active"] | true;
    const String action = doc["action"] | "find";
    const FindAction requestedAction = action == "pick" ? FindAction::Pick
                                       : action == "restock" ? FindAction::Restock
                                                               : FindAction::Find;
    const uint32_t seconds = constrain(doc["timeoutSeconds"] | 60, 1, 3600);
    if (active) {
      startGuidedWeightAction(requestedAction, millis(), seconds);
      message = requestedAction == FindAction::Pick ? "guided pick active" :
                requestedAction == FindAction::Restock ? "guided restock active" :
                                                        "find light active";
    } else {
      findActive = false;
      guidedWeightAction = false;
      guidedBaselineReady = false;
      findEndsAt = 0;
      displayRefreshRequested = true;
      message = "guidance stopped";
    }
  } else if (type == "set_label") {
    saveAssignment(doc.as<JsonObjectConst>());
  } else if (type == "clear_assignment") {
    clearAssignment();
    message = "assignment cleared";
  } else if (type == "tare") {
    tareInProgress = true;
    refreshOperationalLabel();
    int64_t offset = 0;
    float captureNoise = 0.0F;
    ok = collectStableRaw("TARE", offset, captureNoise, message);
    tareInProgress = false;
    refreshOperationalLabel();
    if (ok) {
      config.tareOffset = offset;
      config.hasTare = true;
      preferences.putLong64("tare", offset);
      preferences.putBool("has_tare", true);
      resetWeightFilter();
    }
  } else if (type == "calibrate") {
    const float knownWeight = doc["knownWeightGrams"] | 0.0F;
    if (!rawValid || !config.hasTare || knownWeight <= 0.0F) {
      ok = false;
      message = "valid reading, tare and knownWeightGrams required";
    } else {
      tareInProgress = true;
      refreshOperationalLabel();
      int64_t calibrationRaw = 0;
      float captureNoise = 0.0F;
      ok = collectStableRaw("CAL", calibrationRaw, captureNoise, message);
      tareInProgress = false;
      refreshOperationalLabel();
      if (ok) {
        config.scaleCountsPerGram =
            static_cast<float>(calibrationRaw - config.tareOffset) / knownWeight;
        preferences.putFloat("scale", config.scaleCountsPerGram);
        latestRaw = calibrationRaw;
        lastRawReadingAt = millis();
        resetWeightFilter();
      }
    }
  } else if (type == "refresh_label") {
    showLabel(config.partName.isEmpty() ? "READY / UNASSIGNED" : "ASSIGNED");
  } else if (type == "ota") {
    ok = installOtaFromUrl(doc.as<JsonObjectConst>(), commandId, message);
    restartAfterAck = ok;
  } else {
    ok = false;
    message = "unsupported command";
  }

  lastProcessedCommandId = commandId;
  preferences.putString("last_cmd", lastProcessedCommandId);
  acknowledgeCommand(commandId, ok, message);
  if (restartAfterAck) {
    mqttClient.loop();
    delay(750);
    ESP.restart();
  }
}

void onMqttMessage(char *topic, uint8_t *payload, unsigned int length) {
  if (length == 0 || length > 1800) {
    Serial.printf("[MQTT] Rejected command payload length=%u\n", length);
    return;
  }
  if (!pendingMqttCommand.isEmpty()) {
    Serial.println("[MQTT] Command deferred because another command is pending");
    return;
  }
  pendingMqttCommand.reserve(length + 1);
  for (unsigned int i = 0; i < length; ++i) {
    pendingMqttCommand += static_cast<char>(payload[i]);
  }
  Serial.printf("[MQTT] Message received on %s (%u bytes)\n", topic, length);
}

bool connectMqtt(uint32_t now) {
  if (config.mqttHost.isEmpty() || mqttClient.connected()) return mqttClient.connected();
  if (!elapsed(now, lastMqttAttemptAt, Timing::MQTT_RECONNECT_INTERVAL_MS)) return false;
  lastMqttAttemptAt = now;
  mqttClient.setServer(config.mqttHost.c_str(), config.mqttPort);

  const String statusTopic = mqttTopic("status");
  const String offline = "{\"binId\":\"" + jsonEscape(binId) + "\",\"online\":false}";
  bool connected = false;
  const bool useCredentials = discoveryOfferReceived
      ? discoveredAuthenticationRequired
      : !config.mqttUsername.isEmpty();
  if (!useCredentials) {
    connected = mqttClient.connect(binId.c_str(), statusTopic.c_str(), 1, true,
                                   offline.c_str());
  } else {
    connected = mqttClient.connect(binId.c_str(), config.mqttUsername.c_str(),
                                   config.mqttPassword.c_str(), statusTopic.c_str(),
                                   1, true, offline.c_str());
  }
  if (!connected) {
    Serial.printf("[MQTT] Connect failed host=%s:%u state=%d\n",
                  config.mqttHost.c_str(), config.mqttPort, mqttClient.state());
    recordMqttResult(false);
    return false;
  }

  const String deviceCommands = mqttTopic("commands");
  const String broadcastCommands = String(Product::MQTT_TOPIC_ROOT) + "/bins/all/commands";
  const bool subscribedDevice = mqttClient.subscribe(deviceCommands.c_str(), 1);
  const bool subscribedAll = mqttClient.subscribe(broadcastCommands.c_str(), 1);
  JsonDocument status;
  status["binId"] = binId;
  status["online"] = true;
  status["firmwareVersion"] = Product::FIRMWARE_VERSION;
  status["hardwareTarget"] = Product::HARDWARE_TARGET;
  status["partitionLayout"] = Product::PARTITION_LAYOUT;
  status["bootValidated"] = bootValidated;
  status["ipAddress"] = WiFi.localIP().toString();
  String statusBody;
  serializeJson(status, statusBody);
  publishMqtt(statusTopic, statusBody, true);
  Serial.printf("[MQTT] Connected to %s:%u; subscriptions device=%s all=%s\n",
                config.mqttHost.c_str(), config.mqttPort,
                subscribedDevice ? "ok" : "failed", subscribedAll ? "ok" : "failed");
  recordMqttResult(subscribedDevice && subscribedAll);
  if (discoveredBrokerPendingSave) {
    preferences.putString("mqtt_host", config.mqttHost);
    preferences.putUShort("mqtt_port", config.mqttPort);
    discoveredBrokerPendingSave = false;
    Serial.printf("[DISCOVERY] Saved verified broker %s:%u\n",
                  config.mqttHost.c_str(), config.mqttPort);
  }
  if (discoveryStarted) {
    discoveryUdp.stop();
    discoveryStarted = false;
  }
  lastTelemetryAt = now - Timing::TELEMETRY_INTERVAL_MS;
  return true;
}

void startBrokerDiscovery() {
  if (discoveryStarted) return;
  if (!discoveryUdp.begin(Product::DISCOVERY_CLIENT_PORT)) {
    Serial.println("[DISCOVERY] Could not open UDP client port");
    return;
  }
  discoveryStarted = true;
  discoveryStartedAt = millis();
  lastDiscoveryAttemptAt = discoveryStartedAt - Timing::DISCOVERY_INTERVAL_MS;
}

void sendBrokerDiscovery(uint32_t now) {
  if (!elapsed(now, lastDiscoveryAttemptAt, Timing::DISCOVERY_INTERVAL_MS)) return;
  lastDiscoveryAttemptAt = now;
  discoveryNonce = esp_random();
  char nonce[9];
  snprintf(nonce, sizeof(nonce), "%08x", static_cast<unsigned>(discoveryNonce));

  JsonDocument request;
  request["protocol"] = Product::DISCOVERY_PROTOCOL;
  request["type"] = "discover";
  request["binId"] = binId;
  request["nonce"] = nonce;
  request["firmwareVersion"] = Product::FIRMWARE_VERSION;
  request["hardwareTarget"] = Product::HARDWARE_TARGET;
  request["partitionLayout"] = Product::PARTITION_LAYOUT;
  request["bootValidated"] = bootValidated;
  String body;
  serializeJson(request, body);
  ++discoveryAttempts;

  const IPAddress local = WiFi.localIP();
  const IPAddress mask = WiFi.subnetMask();
  IPAddress broadcastAddress;
  for (uint8_t index = 0; index < 4; ++index) {
    broadcastAddress[index] = local[index] | static_cast<uint8_t>(~mask[index]);
  }
  if (discoveryUdp.beginPacket(broadcastAddress, Product::DISCOVERY_SERVER_PORT)) {
    discoveryUdp.print(body);
    discoveryUdp.endPacket();
    Serial.printf("[DISCOVERY] Looking for SmartWall on %s:%u\n",
                  broadcastAddress.toString().c_str(), Product::DISCOVERY_SERVER_PORT);
  }
  // A unicast probe makes reconnects work on Wi-Fi networks that suppress
  // station broadcasts. New bins still use the subnet broadcast above.
  if (!config.mqttHost.isEmpty() &&
      discoveryUdp.beginPacket(config.mqttHost.c_str(), Product::DISCOVERY_SERVER_PORT)) {
    discoveryUdp.print(body);
    discoveryUdp.endPacket();
  }
}

void receiveBrokerDiscovery() {
  const int packetSize = discoveryUdp.parsePacket();
  if (packetSize <= 0 || packetSize > 512) return;
  const IPAddress brokerAddress = discoveryUdp.remoteIP();
  char payload[513];
  const int length = discoveryUdp.read(reinterpret_cast<uint8_t *>(payload), sizeof(payload) - 1);
  if (length <= 0) return;
  payload[length] = '\0';

  JsonDocument offer;
  if (deserializeJson(offer, payload) ||
      offer["protocol"].as<String>() != Product::DISCOVERY_PROTOCOL ||
      offer["type"].as<String>() != "offer") return;
  char expectedNonce[9];
  snprintf(expectedNonce, sizeof(expectedNonce), "%08x",
           static_cast<unsigned>(discoveryNonce));
  if (offer["nonce"].as<String>() != expectedNonce) return;
  const int offeredPort = offer["mqttPort"] | 0;
  if (offeredPort < 1 || offeredPort > 65535) return;

  const String offeredHost = brokerAddress.toString();
  discoveredBrokerPendingSave = config.mqttHost != offeredHost ||
                                config.mqttPort != static_cast<uint16_t>(offeredPort);
  config.mqttHost = offeredHost;
  config.mqttPort = static_cast<uint16_t>(offeredPort);
  discoveredAuthenticationRequired = offer["authenticationRequired"] | false;
  discoveryOfferReceived = true;
  mqttFailures = 0;
  lastMqttAttemptAt = millis() - Timing::MQTT_RECONNECT_INTERVAL_MS;
  Serial.printf("[DISCOVERY] SmartWall found at %s:%u authentication=%s\n",
                config.mqttHost.c_str(), config.mqttPort,
                discoveredAuthenticationRequired ? "required" : "open");
}

void maintainBrokerDiscovery(uint32_t now) {
  if (mqttClient.connected()) return;
  startBrokerDiscovery();
  if (!discoveryStarted) return;
  receiveBrokerDiscovery();
  sendBrokerDiscovery(now);
}

void maintainMqtt(uint32_t now) {
  if (config.mqttHost.isEmpty()) return;
  if (!mqttClient.connected()) {
    // Give local discovery a brief first chance on every boot. If UDP is
    // filtered, the last verified/manual broker remains a fast fallback.
    if (!discoveryOfferReceived && discoveryStarted &&
        !elapsed(now, discoveryStartedAt, Timing::DISCOVERY_FALLBACK_DELAY_MS)) return;
    connectMqtt(now);
    return;
  }
  if (!mqttClient.loop()) recordMqttResult(false);
}

void processPendingMqttCommand() {
  if (pendingMqttCommand.isEmpty()) return;
  String command = pendingMqttCommand;
  pendingMqttCommand = "";
  handleMqttCommand(command);
}

void updateNetwork(uint32_t now) {
  if (setupMode) return;
  if (WiFi.status() == WL_CONNECTED) {
    if (deviceState == DeviceState::Connecting) {
      deviceState = DeviceState::Online;
      hasConnectedSinceBoot = true;
      successIndication = true;
      successEndsAt = now + Timing::SUCCESS_LED_DURATION_MS;
      wifiDisconnectedAt = 0;
      startWebServer();
      showLabel(config.partName.isEmpty() ? "READY / UNASSIGNED" : "ASSIGNED");
      startBrokerDiscovery();
      Serial.printf("Connected: %s, IP: %s\n", WiFi.SSID().c_str(),
                    WiFi.localIP().toString().c_str());
      // Make both actions happen quickly after a reconnect.
      lastTelemetryAt = now - Timing::TELEMETRY_INTERVAL_MS;
      lastMqttAttemptAt = now - Timing::MQTT_RECONNECT_INTERVAL_MS;
    }
    return;
  }
  if (wifiDisconnectedAt == 0) wifiDisconnectedAt = now;
  if (deviceState != DeviceState::Connecting) {
    deviceState = DeviceState::Connecting;
    displayRefreshRequested = true;
  }
  if (elapsed(now, lastWifiAttemptAt, Timing::WIFI_RECONNECT_INTERVAL_MS)) {
    lastWifiAttemptAt = now;
    WiFi.disconnect(false, false);
    WiFi.begin(config.wifiSsid.c_str(), config.wifiPassword.c_str());
  }
  const uint32_t timeout = hasConnectedSinceBoot
                               ? Timing::WIFI_FAILURE_TO_SETUP_MS
                               : Timing::WIFI_CONNECT_TIMEOUT_MS;
  if (elapsed(now, wifiDisconnectedAt, timeout)) enterSetupMode("Wi-Fi connection timeout");
}

bool forceSetupRequested() {
  pinMode(Pins::SETUP_BUTTON, INPUT_PULLUP);
  if (digitalRead(Pins::SETUP_BUTTON) != LOW) return false;
  const uint32_t started = millis();
  while (digitalRead(Pins::SETUP_BUTTON) == LOW) {
    updateLed(millis());
    if (elapsed(millis(), started, Timing::FORCE_SETUP_HOLD_MS)) return true;
    delay(10);
  }
  return false;
}

}  // namespace

// Arduino otherwise confirms OTA before setup() has even run.
extern "C" bool verifyRollbackLater() { return true; }

void setup() {
  Serial.begin(115200);
  delay(80);
  Serial.printf("\n[BOOT] Smart Stock Bin firmware %s starting\n",
                Product::FIRMWARE_VERSION);
  Serial.println(Product::IMAGE_MARKER);
  Serial.println(Product::RELEASE_MARKER);
  Serial.printf("[BOOT] Reset reason=%d freeHeap=%u bytes\n",
                static_cast<int>(esp_reset_reason()), ESP.getFreeHeap());
  pixels.begin();
  runLedSelfTest();
  mqttClient.setCallback(onMqttMessage);
  mqttClient.setBufferSize(4096);
  mqttClient.setKeepAlive(30);
  setAllLeds(50, 10, 70, 180);
  loadConfig();

  SPI.begin(Pins::EPD_CLK, -1, Pins::EPD_DIN, Pins::EPD_CS);
  display.init(115200, true, 2, false);
  Serial.println("[EPD] Display initialized");
  scale.begin(Pins::HX711_DT, Pins::HX711_SCK);
  Serial.printf("[HX711] Initialized DT=GPIO%d SCK=GPIO%d ready=%s\n",
                Pins::HX711_DT, Pins::HX711_SCK,
                scale.is_ready() ? "yes" : "no");

  if (forceSetupRequested()) {
    preferences.remove("wifi_ssid");
    preferences.remove("wifi_pass");
    config.wifiSsid = "";
    config.wifiPassword = "";
  }

  if (config.wifiSsid.isEmpty()) {
    enterSetupMode("No stored Wi-Fi credentials");
  } else {
    startStationConnection();
  }
  healthyBootStarted=millis();
}

void loop() {
  const uint32_t now = millis();
  sampleWeight(now);
  processStableWeightChange(now);
  logWeightDiagnostic(now);
  updateLed(now);
  updateNetwork(now);
  if (webServerStarted) server.handleClient();
  if (setupMode) {
    dnsServer.processNextRequest();
  } else if (WiFi.status() == WL_CONNECTED) {
    const uint32_t networkNow = millis();
    maintainBrokerDiscovery(networkNow);
    maintainMqtt(networkNow);
    processPendingMqttCommand();
    sendTelemetry(now);
  }
  if (displayRefreshRequested && !setupMode) refreshOperationalLabel();
  // Confirm only after setup and a responsive event loop. Network availability
  // and sensor calibration are external conditions, not firmware boot failures.
  if (!bootValidated && healthyBootStarted && millis()-healthyBootStarted >= 30000) {
    esp_ota_img_states_t state;
    if (esp_ota_get_state_partition(esp_ota_get_running_partition(),&state)==ESP_OK && state==ESP_OTA_IMG_PENDING_VERIFY)
      bootValidated=esp_ota_mark_app_valid_cancel_rollback()==ESP_OK;
    else bootValidated=true;
  }
  delay(2);
}
