#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
platform_dir=$(cd -- "$script_dir/.." && pwd)
cd "$platform_dir"

if [[ ! -f .env ]]; then
  echo "Missing platform/.env. Copy .env.example and replace its placeholder secrets." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

: "${MQTT_USERNAME:?MQTT_USERNAME is required in .env}"
: "${MQTT_PASSWORD:?MQTT_PASSWORD is required in .env}"

if docker container inspect smartwall-mqtt >/dev/null 2>&1; then
  if docker inspect --format '{{range .Mounts}}{{println .Destination}}{{end}}' smartwall-mqtt | grep -qx /smartwall-auth; then
    docker start smartwall-mqtt >/dev/null
    echo "SmartWall MQTT broker started on port 1883."
    exit 0
  fi
  # Migrate older containers to the discovery/auth-mode mounts. MQTT data is
  # retained in the named volume.
  docker rm -f smartwall-mqtt >/dev/null
fi

docker volume create smartwall-mqtt-data >/dev/null
mkdir -p "$platform_dir/data/mqtt"
docker run -d \
  --name smartwall-mqtt \
  --restart unless-stopped \
  -p 1883:1883 \
  -e MQTT_USERNAME \
  -e MQTT_PASSWORD \
  -v "$platform_dir/infra/mosquitto.conf:/mosquitto/config/mosquitto-open.conf:ro" \
  -v "$platform_dir/infra/mosquitto-auth.conf:/mosquitto/config/mosquitto-auth.conf:ro" \
  -v "$platform_dir/data/mqtt:/smartwall-auth:ro" \
  -v smartwall-mqtt-data:/mosquitto/data \
  --entrypoint /bin/sh \
  eclipse-mosquitto:2 \
  -c 'rm -f /tmp/smartwall-passwd && mosquitto_passwd -b -c /tmp/smartwall-passwd "$MQTT_USERNAME" "$MQTT_PASSWORD" && chown mosquitto:mosquitto /tmp/smartwall-passwd /mosquitto/data && chmod 600 /tmp/smartwall-passwd && config=/mosquitto/config/mosquitto-open.conf && if [ -f /smartwall-auth/require-credentials ]; then config=/mosquitto/config/mosquitto-auth.conf; fi && exec mosquitto -c "$config"' >/dev/null

echo "SmartWall MQTT broker started on port 1883."
