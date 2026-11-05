"""PlatformIO pre-build hook. Only a public verification key enters the image."""
Import("env")
import os
from pathlib import Path
key_path = os.environ.get("SMARTWALL_FIRMWARE_PUBLIC_KEY_FILE")
key = Path(key_path).read_text() if key_path else ""
if key and ("-----BEGIN PUBLIC KEY-----" not in key or ')SWKEY"' in key):
    raise ValueError("Expected a PEM public key")
version = os.environ.get("SMARTWALL_RELEASE_VERSION")
if version:
    import re
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", version):
        raise ValueError("Invalid release version")
build = Path(env.subst("$BUILD_DIR")); build.mkdir(parents=True, exist_ok=True)
header = '#pragma once\nstatic constexpr char SMARTWALL_RELEASE_PUBLIC_KEY[] = R"SWKEY(' + key + ')SWKEY";\n'
if version: header += '#define SMARTWALL_RELEASE_VERSION "' + version + '"\n'
(build / 'SmartWallRelease.generated.h').write_text(header)
env.Append(CPPPATH=[str(build)])
