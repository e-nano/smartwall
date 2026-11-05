#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(tr -d '[:space:]' < "$project_dir/.firmware-version")"
build_output="$project_dir/.pio/build/elegoo_esp32/firmware.bin"
release_dir="$project_dir/platform/firmware/devkit"
release_output="$release_dir/smartwall-$version-devkit.bin"

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][A-Za-z0-9.-]+)?$ ]]; then
  echo "Invalid firmware version: $version" >&2
  exit 1
fi

if command -v pio >/dev/null 2>&1; then
  pio_bin="$(command -v pio)"
elif [[ -x "$HOME/.platformio/penv/bin/pio" ]]; then
  pio_bin="$HOME/.platformio/penv/bin/pio"
else
  echo "PlatformIO CLI was not found" >&2
  exit 1
fi

echo "Building SmartWall DevKit firmware $version..."
"$pio_bin" run --project-dir "$project_dir" --environment elegoo_esp32

if [[ ! -s "$build_output" ]]; then
  echo "PlatformIO did not produce $build_output" >&2
  exit 1
fi

mkdir -p "$release_dir"
temporary="$release_output.$$"
trap 'rm -f "$temporary"' EXIT
install -m 0644 "$build_output" "$temporary"
mv "$temporary" "$release_output"
trap - EXIT

sha256sum "$release_output"
echo "DevKit firmware is ready at $release_output"
echo "It is kept outside firmware/incoming so it cannot be deployed to an ESP32-S3 by mistake."
