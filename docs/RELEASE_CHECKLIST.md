# Release acceptance — 2.0.0-rc.1

Software release candidate for the **Local-First Multi-Room Smart Facility Management Platform**. Checked software rows are implemented and verified locally (`npm test`, `npm run lint`, `npm run build`, `npm run test:ui`, `npm run test:load`, and offline bundle checks). Target Ubuntu VM and physical hardware rows remain unchecked until executed and recorded on real deployment hosts and devices.

## Release A — Dynamic Multi-Room Core

- [x] A1: Additive SQLite migration `004_multi_room_platform.sql` upgrades populated 1.1.0 databases cleanly and migrates legacy room/nodes to `room-001`.
- [x] A2: First-class `rooms` CRUD, archive, and guarded delete APIs (`/api/v1/rooms`).
- [x] A3: Transport-conditional IP validation (`MQTT_V1` allows empty IP; `HTTP_JSON_V1` and `CAMERA_JPEG` enforce private RFC1918 IPv4).
- [x] A4: Capability (`kind`) separated from data type (`data_type`) with per-endpoint freshness (`last_reported_at`).
- [x] A5: Pending Device Quarantine (`pending_devices`) with Admin approve/reject/ignore workflows and Manifest Drift flagging.
- [x] A6: Numeric, boolean (`EQUALS_BOOLEAN`), enum (`EQUALS_ENUM`), and `STALE` server-side alarm rules with dwell/hysteresis and recovery evidence.
- [x] A7: Host-side allowlisted MQTT credential/ACL provisioning CLI (`scripts/provision-mqtt-device.sh`) paired with backend `mqtt_identities` status tracking (zero root/Docker socket in backend container).

## Release B — Multi-Page Operational GUI & Air-Gap Compliance

- [x] B1: Dedicated Local Landing (`/`), Login (`/login`), and Authenticated Operations Shell (`/app/overview`, `/app/rooms`, `/app/rooms/:id`, `/app/devices`, `/app/devices/:id`, `/app/devices/:id/endpoints/:key`, `/app/alarms`, `/app/notifications`, `/app/events`, `/app/diagnostics`, `/app/users`, `/app/settings`, `/app/profile`).
- [x] B2: Dark Industrial Graphite default theme with Light Neutral toggle, local system typography, and zero static pill clutter.
- [x] B3: Generic Endpoint Widget Engine (`METRIC_TREND`, `BOOLEAN_STATE`, `SWITCH_CONTROL`, `ACCESS_STATE`, `CAMERA_SNAPSHOT`, `UNSUPPORTED`) and local inline SVG trend charts.
- [x] B4: Playwright 14-route E2E passes with **`external_requests: 0`** (air-gap proven), **`mobile_overflow_px: 0`** at 390px, and Viewer RBAC gating verified.

## Release C — Guided Deployment, Local TLS & Offline Bundles

- [x] C1: Guided `install.sh` with `--discover-only`, Q1–Q6 interactive flow, `--non-interactive`, and idempotent secret/volume preservation.
- [x] C2: Safe Netplan static-IP helper (`scripts/configure-static-ip.sh`) with `--discover`, IP/CIDR validation, ARP conflict check, `--dry-run`, and `netplan try` rollback safety.
- [x] C3: Optional local HTTPS/TLS mode (`nginx/nginx-tls.conf`, `docker-compose.tls.yml`, `scripts/setup-local-tls.sh`).
- [x] C4: Offline release bundle builder (`scripts/build-offline-bundle.sh`), SHA-256 verification, `install-offline.sh`, and `update-offline.sh` with readiness check & rollback.
- [x] C5: Hardened `docker-compose.yml` (`no-new-privileges:true`, pinned `nginx:1.27-alpine`, parameterized ports, `/api/health/live` container healthcheck).

## Release D — Scale Verification & Documentation

- [x] D1: Multi-room scale benchmark (`npm run test:load`) passes: 20 rooms, 100 devices, 500 endpoints, 10,000/10,000 frames persisted, 20 WS clients (200,000 deliveries), 25 concurrent API sessions.
- [x] D2: Complete architecture, MQTT v1 protocol, capability registry, platform audit, deployment guide, test plan, and truthful test results documentation.

## Target Server / VM & Physical Hardware Commissioning — Pending

- [ ] Execute fresh guided `sudo ./install.sh` on a clean Ubuntu 24.04 LTS VM/server and record `/api/health/ready` HTTP 200 on LAN IP.
- [ ] Build full Docker-image offline bundle (`npm run bundle:offline`) and verify `sudo ./install-offline.sh` and `sudo ./update-offline.sh` on an air-gapped Ubuntu host with no internet route.
- [ ] Verify `scripts/configure-static-ip.sh` (`netplan try`) and `scripts/setup-local-tls.sh` (`docker-compose.tls.yml` HTTPS + WSS) on target Ubuntu host.
- [ ] Verify per-device Mosquitto ACL isolation (`scripts/provision-mqtt-device.sh`) against live broker with at least two device credentials.
- [ ] Connect physical edge controllers and camera; verify firmware manifest/telemetry/heartbeat/ACK payloads, sensor calibration (MQ-2 raw until calibrated), and hardwired emergency exit independence.
- [ ] Perform sustained on-site bench soak and verified SQLite backup/restore drill before production handover.
