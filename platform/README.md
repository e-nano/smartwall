# SmartWall local platform

For production packaging, start with [Docker deployment](../docs/DEPLOYMENT.md) and
[release approvals](../docs/RELEASING.md). The Compose file in this directory remains
the legacy development broker; the full deployment is `deploy/edge/compose.yaml`.


Local React/TypeScript operator interface and TypeScript control plane for the
SmartWall ESP32 bins. SQLite stores bins, parts, observed inventory changes,
commands and firmware releases. MQTT carries live device traffic; the browser
receives changes over server-sent events.

## Services

- React/Vite development UI: `http://127.0.0.1:5173`
- Production UI and operator API: `http://127.0.0.1:8080` (workstation only)
- MQTT broker: LAN port `1883` (open to LAN bins by default)
- SmartWall discovery: LAN UDP port `4210`
- Signed OTA downloads: LAN port `8081`
- SQLite database: `data/smartwall.db`
- Uploaded images: `firmware/`

The operator API and UI intentionally bind only to the local computer. Firmware
bytes are exposed to bins through short-lived, HMAC-signed URLs. MQTT accepts
local bins without credentials by default so commissioning only requires Wi-Fi.
**Updates → Automatic bin connection** can require credentials when needed.

## Local setup

1. Copy `.env.example` to a private `.env` and replace its placeholders.
2. Confirm `PUBLIC_BASE_URL` uses this computer's LAN address and port `8081`.
   `MQTT_URL=mqtt://localhost:1883` is correct for the backend running on this
   computer. ESP32 bins discover its reachable LAN address over UDP; a saved
   manual broker address remains available as a fallback.
3. Start the broker:

   ```sh
   ./scripts/start-mqtt.sh
   ```

   If Docker Compose is available, `docker compose up -d mqtt` is equivalent.

4. Install dependencies and start the API and UI:

   ```sh
   npm install
   npm run dev
   ```

5. Open `http://127.0.0.1:5173`.
6. Scan the e-ink Wi-Fi QR code to join a new bin's setup network, then select
   the workshop Wi-Fi and enter its password. MQTT host and
   credential fields are under Advanced settings for manual fallback or when
   the wall is configured to require credentials.


## Operator workflow

- Create a component with its ID, name and reorder level. Its individual weight
  is learned during the first bin fill instead of being entered manually.
- To teach that weight, tare an empty bin, add a known number of pieces, and wait
  until its measurement is stable. Select the new component on the Bins screen,
  enter the number of pieces and assign it. The platform divides the stable net
  weight by the piece count, saves the resulting unit weight, and sends the label
  and initial quantity to the bin. Using more pieces produces a more accurate
  unit weight.
- Future bins assigned to that component reuse the learned unit weight and do not
  ask for a piece count. Use **Change** on an assigned bin to select a different
  component.
- To prepare a bin for another component, physically remove its contents and use
  **Empty** on the Bins page. This clears the bin assignment and quantity but
  preserves the component and its learned unit weight in the catalog.
- To correct an existing component weight, place a known total number of pieces
  in its assigned bin, wait for a stable reading, choose **Relearn weight**, enter
  the total piece count and confirm. The updated weight is reused by every bin
  assigned to that component.
- Use Find, Pick or Restock to illuminate the chosen physical bin.
- Stable measured quantity changes appear as observed pick/restock events.
- Build firmware using the board-specific scripts. Builds remain outside the rollout inbox.
- Upload a matching signed `.json` manifest and `.bin` in Updates, or import an official release.
- Deploy to selected compatible bins or all compatible online bins. Unknown hardware is blocked.

## OTA safety

Firmware imports verify a publisher RSA/SHA-256 signature and embedded hardware/version
markers before storage. Devices verify the signed metadata and downloaded digest before
activation. Download URLs additionally expire after 15 minutes. Firmware records support
multiple hardware builds of one version. Legacy records are preserved but cannot deploy.

Automatic updates default to off. With explicit opt-in, signed stable manifests in the
inbox select a release per target, with at most three attempts per bin. See the deployment
guide for public-key provisioning, manual updates and current rollback validation limits.

## Optional local-first cloud mirror

SmartWall remains fully operational on the local workstation. SQLite is the
authoritative database, MQTT and OTA stay on the LAN, and no ESP32 depends on an
internet connection. An optional worker mirrors business records to E-Nano's
commercial hosted service whenever internet access is available.

Every mirrored SQLite mutation creates an immutable outbox event in the same
database transaction. The worker sends ordered batches over HTTPS, and the
cloud API uses the event ID as an idempotency key. Failed events remain in
SQLite and retry with exponential backoff. High-frequency raw measurements and
last-seen heartbeats are deliberately excluded; parts, meaningful bin state,
stable inventory events and firmware metadata are mirrored.

The local health and dashboard APIs expose cloud synchronization state. A
direct status response is available from `/api/sync/status`.

The cloud button in the local header opens the synchronization panel. When the
environment capability and credentials are valid, synchronization defaults to
on and the choice is persisted in SQLite. Operators can pause transmission
without losing queued changes, resume it with an explicit data-transfer
confirmation, or select **Sync now**. The panel shows queued changes, last
successful synchronization, last encrypted backup, and any current error.

The worker can also create a consistent SQLite snapshot with `VACUUM INTO`,
encrypt it locally with AES-256-GCM, and upload only the encrypted bytes to a
private hosted backup storage. The cloud service never receives the decryption
key. Keep a recovery copy of `CLOUD_BACKUP_ENCRYPTION_KEY` outside the local
computer.

Cloud synchronization is disabled until the wall is configured. Open
**Cloud sync → Connect this wall** on the local station to connect to
[SmartWall Online](https://smartwall.e-nano.io).
Sign in in the separate online tab as a company administrator, check the code,
and approve a named wall. Settings are saved automatically and synchronization
starts immediately. Private settings and the backup key are retained in
`data/cloud-connection.json` (`0600`) across restarts; keep a secure recovery copy.
The online portal also allows administrators to delete walls and revoke their
connection while preserving local stock and archived online history.

Advanced installations can still configure these private values in `platform/.env`:

```dotenv
CLOUD_SYNC_ENABLED=true
CLOUD_SYNC_API_URL=https://smartwall.e-nano.io
CLOUD_SYNC_SITE_ID=smartwall-main
CLOUD_SYNC_API_TOKEN=YOUR_PRIVATE_WALL_VALUE
CLOUD_BACKUP_ENCRYPTION_KEY=YOUR_PRIVATE_WALL_VALUE
```

The first enabled start queues the existing parts, bins, inventory history and
firmware metadata before sending new changes. The online service is operated by
E-Nano; it is not part of the community deployment.

To recover an encrypted `SWDB1` backup downloaded from the hosted service:

```sh
cd platform
CLOUD_BACKUP_ENCRYPTION_KEY='your-recovery-key' \
  node scripts/decrypt-backup.mjs backup.sqlite.aes256gcm recovered-smartwall.db
```

The recovery command refuses to overwrite an existing output file. Stop the
local backend before replacing its SQLite database, and retain the original
database until the recovered copy has passed `PRAGMA integrity_check`.

For local startup at boot, copy
`deploy/systemd/smartwall-platform.service.example` to
`/etc/systemd/system/smartwall-platform.service`, review the paths and user, then
enable it with systemd. The MQTT container already uses `restart: unless-stopped`.

## Optional SmartWall Online service

E-Nano operates [SmartWall Online](https://smartwall.e-nano.io) as a commercial
hosted service for company accounts, multiple walls, remote inventory and AI
integration. Its frontend, server and infrastructure remain private. This package
contains the local software and the integration client only. Developers may build
a compatible alternative and configure its HTTPS endpoint in the local station.

## Goods-in barcode and QR intake

The local **Goods in** screen resolves scans, learns confirmed identifiers, guides
restocking and records receipts using existing ELEGOO commands. The separate
online portal displays receipts, supplier identities and scan audit history.
Verified mappings synchronize between walls within the same company; scale
calibration remains local. See [workflow and supported resolution](GOODS_IN.md).

## MCP and remote catalogue integration

The cloud MCP endpoint authenticates each user and scopes access to a selected company and walls.
An outbound local station worker handles authorized Find/Pick/Restock and component/image changes.
In **Cloud sync → Remote access**, enable the desired actions on the physical station. Both defaults
are off; pausing cloud sync also pauses remote commands. Local operation remains authoritative.

The local component catalogue accepts custom categories and arbitrarily nested types/subtypes, supplier references and
up to four PNG/JPEG/WebP images (512 KiB total). Categories appear in suggestions after saving a
component. Use **Add nested subtype** in the create/classification forms to add further levels. Use **Images** on an existing component to replace/remove attachments. The online
portal's **Add components** page queues the same changes to an online, enabled station.

Open [Connect with AI](https://smartwall.e-nano.io/mcp-connect.html) in the hosted
portal for ChatGPT connection instructions. The service endpoint is
`https://smartwall.e-nano.io/mcp`; OAuth grants are bound to the connecting user.
The client connection metadata is in `plugins/smartwall/`. The hosted MCP server
and account-management implementation are not included in the public project.
