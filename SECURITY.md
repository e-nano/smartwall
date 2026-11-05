# Security reporting and update trust

Report vulnerabilities through the official repository's private vulnerability
reporting feature once configured. Do not include credentials, exploitable details
or customer data in public issues. Maintainers must enable the private reporting
channel before publication; no response SLA is promised yet.

Stable updates must come from a publisher key explicitly trusted by the installation.
An HTTP download token or checksum alone is not a publisher signature. The release
manifest binds image digests; firmware signatures also bind board and partition layout.
Review the first trusted public key out of band. Forks use their own keys and release sources.

The edge's administrator has full local control. Its web application does not receive
the Docker socket. The optional host supervisor has privileged Docker access and must
be protected accordingly. LAN MQTT remains open by default for Wi-Fi-only commissioning;
use network isolation or enable broker credentials as appropriate. Never expose MQTT,
UDP discovery or bin configuration interfaces directly to the internet.

See [deployment boundaries and recovery](docs/DEPLOYMENT.md) and
[release requirements](docs/RELEASING.md). No release should be described as production
validated until the documented container and physical-device checks have passed.
