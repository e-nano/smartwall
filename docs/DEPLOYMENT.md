# Deploying SmartWall

This package deploys the local **edge** installation beside the bins. E-Nano provides
the optional commercial [SmartWall Online](https://smartwall.e-nano.io) service.
Its source and deployment are private; no online portal server is distributed here.
Keep an edge installation on each workshop LAN for UDP bin discovery.

## Local installation (Linux AMD64 / ARM64)

Use Docker Engine with Compose v2, Python 3, OpenSSL and a reserved LAN IPv4 address.
Raspberry Pi installations require a 64-bit OS. Docker Desktop and routed/VLAN
broadcast discovery are not yet validated deployment targets.

After the first approved release exists, download the source at that release and
obtain `publisher.pem` through a trusted maintainer channel. Verify its fingerprint
independently; fetching a new key beside an untrusted download is not authentication.
Replace the LAN address below with your workshop host. Community forks also
replace the repository and image names with their own. These commands are instructions, not an already published release.

```sh
sudo python3 deploy/supervisor/install.py \
  --directory /opt/smartwall \
  --lan-ip 192.168.1.10 \
  --release-url https://github.com/e-nano/smartwall/releases/latest/download/release.json \
  --image-repository ghcr.io/e-nano/smartwall/edge \
  --public-key /path/to/verified/publisher.pem
sudo docker compose --project-directory /opt/smartwall up -d
```

The installer verifies the signed release and pins the image digest. It refuses to
overwrite an existing installation. It generates separate admin, MQTT and firmware
URL secrets. Data, firmware, requests and configuration persist under `/opt/smartwall`.
The interface defaults to `http://127.0.0.1:8080`; sign in as `admin` using the password
in `runtime/secrets/admin_password`. An SSH tunnel can provide remote administration.
For LAN/browser access use an HTTPS reverse proxy, set its origin in
`SMARTWALL_ALLOWED_ORIGINS`, and retain the loopback backend. HTTP Basic authentication
must be carried over HTTPS or a trusted local SSH tunnel. Do not publish port 8080
unencrypted to the internet. The edge administrator has full local access; cloud
company/user roles continue to apply independently in the online portal.

MQTT (1883), firmware HTTP downloads (8081) and discovery (UDP 4210) are LAN services.
Firewall them to the workshop subnet. Firmware authenticity comes from a device-verified
publisher signature, independent of HTTP transport. The Compose edge uses Linux host
networking for UDP; ports 8080/8081/4210 must be free. Mosquitto publishes to the LAN IP
and loopback. The application never mounts the Docker socket.

Bins continue to require only Wi-Fi setup by default. The broker wrapper observes
**Updates → Automatic bin connection → Require MQTT credentials** and restarts the
broker when that setting changes. Legacy development broker launchers require a
manual broker restart after changing the setting.

## Software updates

Install the optional host supervisor after inspecting its configuration:

```sh
sudo cp deploy/supervisor/smartwall-update.service /etc/systemd/system/
sudo cp deploy/supervisor/smartwall-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now smartwall-update.timer
```

The units assume `/opt/smartwall`; edit their paths if you chose another directory.
This supervisor controls Docker and is privileged host software. Keep its script,
Compose file, `.env`, configuration and publisher key under administrator control.
The UI can request only `check` or `apply` of a previously checked signed manifest;
it cannot supply images, commands, paths or Compose configuration.

In **Updates**, check for a release and install it. The supervisor checks public
releases every six hours and processes UI requests approximately once a minute.
Automatic software installation is off by default. Set `automatic_updates` in
`supervisor/config.json` to opt in, and set `maintenance_utc_hours`, e.g. `[2,4]`.
`allow_ui_updates` separately controls UI-triggered installations. There is no inbound
cloud connection or mandatory E-Nano account. Stable installations reject beta
manifests; beta installations use a separately configured signed release URL.

The supervisor verifies the publisher signature and allowed image repository/digest,
pulls the image, stops the edge, snapshots SQLite (including WAL), starts the new
container with writers paused, checks readiness/version, then resumes traffic.
A failed startup restores the old database/image before reopening writes. Its
transaction journal also supports recovery after supervisor/host interruption.
If recovery fails, maintenance remains active for administrator intervention.
It does not automatically restore an old snapshot after traffic has reopened.
Retain `supervisor/backup-*.sqlite`, configuration, secrets and the append-only audit
log for recovery. Control backup retention according to disk capacity.

Remote bins can still change physically during a platform restart. The next telemetry
reconciles counts; this is not a guarantee of recording every physical action during downtime.

## Firmware updates and existing bins

**Import released bin firmware** verifies and imports both signed hardware variants.
Select a release and individual bins, or **Update compatible bins**. The server and
device both enforce target/layout; a fleet-wide OTA broadcast is no longer used.
Manual uploads require the matching `.bin` and signed `.json` manifest. The bin's
own upload page also requires both files. Never infer target solely from a filename.

Automatic firmware updates are off by default. To enable, set `AUTO_UPDATE_FIRMWARE=true`.
The approved producer places matching `NAME.bin` and `NAME.json` files in
`runtime/firmware/incoming` (binary first, metadata last). Only stable versions are
selected, separately per target; each bin gets at most three attempts per release.
Building locally never puts a binary into that directory.

Existing firmware does not report board identity or contain a publisher key. It is
intentionally ineligible for the new automatic path. Provision each board once over
USB with the matching release, bootloader/partition layout and trusted public key.
Preserve NVS calibration/Wi-Fi settings; do not erase flash indiscriminately. Verify
this bootstrap on a test device of each target before fleet migration. A development
build without a public key works normally but refuses all OTA. Trust-key replacement
currently requires physical reprovisioning; multi-key rotation is future work.

New applications defer Arduino's early OTA confirmation until setup completes and
the main loop runs for 30 seconds. This detects resets before confirmation; it is
not a complete peripheral/network self-test or a guarantee against hangs. Test crash,
power-loss and recovery behavior on both actual bootloaders before declaring stable.
Hardware secure-boot fuses are not changed by these updates.

## Connect to SmartWall Online

Open **Cloud sync → Connect this wall**, sign in at `https://smartwall.e-nano.io`
as a company administrator and approve the displayed wall code. This enrolls the
station in E-Nano's hosted service. Cloud sync is optional; local inventory and
bin control continue without an account or internet connection.

The station keeps its own wall credential and backup encryption key. User access
is scoped by the hosted account's company and role. Remote bin actions and catalogue
changes additionally require the corresponding local **Remote access** switches.
Pausing synchronization also pauses remote commands.

Independent developers may implement a compatible service. `CLOUD_PORTAL_URL` and
`CLOUD_SYNC_API_URL` remain configurable; this repository includes the client-side
integration, not E-Nano's server implementation or hosting deployment.

## Validation boundary

Container definitions, type checks, software recovery tests, signed artifact checks
and both firmware compilation targets are checked in development. A full Docker
startup, AMD64/ARM64 deployment, real HTTPS setup, physical OTA/power-cut validation
and release-environment approvals must also pass before the first stable publication.
