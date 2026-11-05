#!/bin/sh
set -eu
password=$(cat /run/secrets/mqtt_password)
mosquitto_passwd -b -c /tmp/smartwall-passwd smartwall "$password"
unset password
chown mosquitto:mosquitto /tmp/smartwall-passwd /mosquitto/data
chmod 600 /tmp/smartwall-passwd
pid=''
stop() { if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi; }
trap 'stop; exit 0' TERM INT
mode() { if [ -f /smartwall-auth/require-credentials ]; then echo false; else echo true; fi; }
start() {
  current=$(mode)
  cat > /tmp/mosquitto.conf <<CONFIG
listener 1883 0.0.0.0
allow_anonymous $current
password_file /tmp/smartwall-passwd
persistence true
persistence_location /mosquitto/data/
log_dest stdout
CONFIG
  mosquitto -c /tmp/mosquitto.conf &
  pid=$!
  echo "$pid" > /tmp/mosquitto.pid
}
start
while kill -0 "$pid" 2>/dev/null; do
  sleep 2 & wait $! || true
  if [ "$(mode)" != "$current" ]; then stop; start; fi
done
exit 1
