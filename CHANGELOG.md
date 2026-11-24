# Changelog

## 2.0.0-rc.1

Local-first, air-gapped multi-room smart facility management platform release candidate (software verified; target Ubuntu VM and physical hardware acceptance pending).

- **Release A — Dynamic Multi-Room Core:** Added additive SQLite migration `004_multi_room_platform.sql` (`rooms`, `pending_devices`, `mqtt_identities`, per-endpoint `data_type`/`last_reported_at`, boolean/enum alarm conditions, and legacy `room-001` migration), transport-conditional IP validation (zero IP required for `MQTT_V1`), Pending Device Quarantine & Manifest Drift detection, room/device/endpoint APIs, and host-side allowlisted MQTT provisioning helper (`scripts/provision-mqtt-device.sh`).
- **Release B — Multi-Page Operational Platform GUI:** Replaced single-page console with History API routes (`/`, `/login`, `/app/overview`, `/app/rooms`, `/app/rooms/:roomId`, `/app/devices`, `/app/devices/:deviceId`, `/app/devices/:deviceId/endpoints/:endpointKey`, `/app/alarms`, `/app/notifications`, `/app/events`, `/app/diagnostics`, `/app/users`, `/app/settings`, `/app/profile`), Dark Industrial Graphite default theme with Light toggle, Generic Endpoint Widget Engine (`frontend/widgets.js`), local SVG trend charts, and zero-external-network Playwright verification (`external_requests: 0`).
- **Release C — Local Deployment & Air-Gap Engineering:** Upgraded `install.sh` with `--discover-only` and guided Q1–Q6 deployment assistant, added safe Netplan static-IP helper (`scripts/configure-static-ip.sh`), optional local HTTPS/TLS mode (`nginx/nginx-tls.conf`, `docker-compose.tls.yml`, `scripts/setup-local-tls.sh`), hardened Compose (`no-new-privileges:true`, pinned `nginx:1.27-alpine`, configurable ports), and SHA-256 verified offline release bundles (`scripts/build-offline-bundle.sh`, `install-offline.sh`, `update-offline.sh`).
- **Release D — Scale Verification & Platform Documentation:** Added multi-room scale/concurrency benchmark (`scripts/load-test.mjs`: 20 rooms, 100 devices, 500 endpoints, 10,000 frames, 20 WS clients, 25 concurrent API sessions) and comprehensive architecture, MQTT v1 protocol, capability registry, audit, and test plan/results documentation.

## 1.1.0-rc.1

Software release candidate; hardware acceptance pending.

- Add persistent, scoped Notification Center with bell/preview, per-account read state, filters, sound preference, WebSocket invalidation and retention.
- Add typed multi-endpoint device registry while preserving the team's three legacy profiles and room settings.
- Support identity-scoped v1 MQTT telemetry, heartbeat and expiring switch command/ACK contracts, manual bounded JSON probes and registered-camera capture.
- Add sensor threshold/hysteresis/dwell alarms, missing-evidence and command-failure incidents, acknowledgement/recovery timelines and expiring maintenance.
- Add isolated, labelled simulator and reproducible Chromium acceptance journey.
- Add additive migration 003, upgrade/privacy/replay tests, protocol guide, release checklist and expanded CI including real-broker v1 identity isolation.

Known limits: physical nodes and credential policy synchronization are not accepted; Vision/biometric enrollment is separate work; HTTP sensor sampling is manual; additional vendor protocols need adapters; registry edits do not reconfigure hardware network interfaces. Alarm rules do not actuate physical outputs. See `docs/RELEASE_CANDIDATE_GUIDE.md`.
