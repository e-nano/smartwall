#pragma once
#include <ArduinoJson.h>
#include <mbedtls/base64.h>
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>
#include <esp_ota_ops.h>
#include "SmartWallConfig.h"

inline bool validReleaseVersion(const String &s) {
  unsigned a,b,c; int consumed=0;
  if (sscanf(s.c_str(), "%u.%u.%u%n", &a,&b,&c,&consumed) != 3) return false;
  if (consumed == static_cast<int>(s.length())) return true;
  if (s[consumed++] != '-' || consumed == static_cast<int>(s.length())) return false;
  for (;consumed < static_cast<int>(s.length());++consumed)
    if (!isalnum(s[consumed]) && s[consumed]!='-' && s[consumed]!='.') return false;
  return true;
}
inline bool verifyOtaManifest(JsonObjectConst m, String &error) {
  const String target = m["hardwareTarget"] | "", layout = m["partitionLayout"] | "";
  const String version = m["version"] | "", sha = m["sha256"] | "", signature = m["signature"] | "";
  const size_t size = m["sizeBytes"] | 0U;
  const esp_partition_t *next = esp_ota_get_next_update_partition(nullptr);
  if (target != Product::HARDWARE_TARGET || layout != Product::PARTITION_LAYOUT) {
    error="Firmware is for a different board or partition layout"; return false;
  }
  if (!validReleaseVersion(version) || sha.length()!=64 || !next || size<256 || size>next->size) {
    error="Invalid firmware metadata or image exceeds OTA partition"; return false;
  }
  for (char c : sha) if (!((c>='0' && c<='9') || (c>='a' && c<='f'))) { error="Invalid SHA-256"; return false; }
  // Downgrades require physical recovery; an unauthenticated force flag must not permit replay.
  unsigned a,b,c,x,y,z;
  if (sscanf(version.c_str(),"%u.%u.%u",&a,&b,&c)==3 && sscanf(Product::FIRMWARE_VERSION,"%u.%u.%u",&x,&y,&z)==3 &&
      (a<x || (a==x && b<y) || (a==x && b==y && c<z))) { error="Firmware downgrade requires USB recovery"; return false; }
  const char *key=SMARTWALL_RELEASE_PUBLIC_KEY;
  if (!key[0]) { error="No trusted OTA publisher configured; flash a build with a public key over USB"; return false; }
  const String message=String("smartwall-firmware-v1\n")+version+"\n"+target+"\n"+layout+"\n"+String(size)+"\n"+sha+"\n";
  uint8_t digest[32], decoded[512]; size_t decodedSize=0;
  if (signature.length()>700 || mbedtls_base64_decode(decoded,sizeof(decoded),&decodedSize,
      reinterpret_cast<const uint8_t *>(signature.c_str()),signature.length())!=0 ||
      mbedtls_sha256_ret(reinterpret_cast<const uint8_t *>(message.c_str()),message.length(),digest,0)!=0) {
    error="Invalid firmware signature"; return false;
  }
  mbedtls_pk_context pk; mbedtls_pk_init(&pk);
  const bool valid=mbedtls_pk_parse_public_key(&pk,reinterpret_cast<const uint8_t *>(key),strlen(key)+1)==0 &&
    mbedtls_pk_can_do(&pk,MBEDTLS_PK_RSA) && mbedtls_pk_verify(&pk,MBEDTLS_MD_SHA256,digest,sizeof(digest),decoded,decodedSize)==0;
  mbedtls_pk_free(&pk);
  if (!valid) error="Firmware publisher signature is invalid";
  return valid;
}
