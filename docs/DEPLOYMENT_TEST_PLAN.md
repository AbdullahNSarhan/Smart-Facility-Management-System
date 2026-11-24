# LCI-SFM 2.0 — Deployment & Verification Test Plan

**Release:** `2.0.0-rc.1`

---

## 1. Automated Software Verification Suite (CI / Local Host)

| ID | Category | Command / Harness | Pass Criteria |
|---|---|---|---|
| **T-01** | Syntax & Lint | `npm run lint` | Zero syntax errors across all frontend ES modules, backend modules, tests, and scripts. |
| **T-02** | Backend & Legacy Integration | `npm test` (`backend.test.js`, `management.test.js`, `operations.test.js`) | Auth, CSRF, RBAC, health/readiness (`live` vs `ready` across SQLite/MQTT states), camera SSRF bounds, backup/restore, alarms, notifications, and simulator all pass. |
| **T-03** | Multi-Room & Dynamic Core | `npm test` (`multiroom.test.js`) | Migration `004` upgrade on populated DB, room CRUD/archive/delete guards, MQTT_V1 without IP, pending device quarantine approve/reject, manifest drift detection, boolean alarms, MQTT identity tracking all pass. |
| **T-04** | Production Frontend Bundle | `npm run build` | Vite builds `dist/` cleanly with zero missing imports or external asset references. |
| **T-05** | Multi-Page UI & Air-Gap E2E | `npm run test:ui` (`scripts/ui-release-smoke.mjs`) | All 14 routes (`/`, `/login`, `/app/*`) render without errors; room/device/endpoint/alarm workflows pass; Viewer RBAC blocks Admin UI/routes; mobile `390px` horizontal overflow `<= 2px`; **zero external network requests (`external_requests === 0`)**. |
| **T-06** | Multi-Room Scale & Concurrency | `npm run test:load` (`scripts/load-test.mjs`) | 20 rooms, 100 devices, 500 endpoints, 10,000 MQTT v1 frames ingested with zero data loss and zero cross-device contamination; 20 WS clients + 25 concurrent HTTP API sessions succeed with bounded p95 latency and RSS memory. |
| **T-07** | Shell Scripts & Offline Bundle | `bash -n *.sh scripts/*.sh`, `install.sh --discover-only`, `configure-static-ip.sh --discover`, `build-offline-bundle.sh --skip-docker-images` | All shell scripts parse cleanly; discovery runs read-only without error; offline archive builds and passes `sha256sum -c` verification. |

---

## 2. Target Server / VM & Physical Hardware Verification (Pending Target Environment)

The following tests MUST be executed and signed off on an actual Ubuntu Server LTS VM or bare-metal deployment host before declaring production hardware readiness:

| ID | Scenario | Verification Procedure |
|---|---|---|
| **H-01** | Fresh Online Ubuntu Install | Run `sudo ./install.sh` on clean Ubuntu 24.04 LTS; verify Q1–Q6 guided flow, Compose startup, and `GET /api/health/ready` HTTP 200 on `FRONTEND_BIND_IP`. |
| **H-02** | Air-Gapped USB Offline Install | Build full bundle (`npm run bundle:offline`) on connected build host, transfer `.tar.gz` + `.sha256` to offline Ubuntu host with internet disconnected, run `sudo ./install-offline.sh`, verify dashboard & MQTT without external internet. |
| **H-03** | Static IPv4 Netplan Safety | Test `sudo ./scripts/configure-static-ip.sh --iface <nic> --cidr ... --gateway ... --dry-run` followed by interactive `netplan try` rollback confirmation. |
| **H-04** | Local HTTPS / TLS Mode | Run `sudo ./scripts/setup-local-tls.sh --ip <LAN_IP>`, start with `-f docker-compose.yml -f docker-compose.tls.yml`, verify HTTPS port `443`, HTTP->HTTPS redirect, `SESSION_SECURE_COOKIE=true`, and WSS `/ws/telemetry`. |
| **H-05** | Per-Device MQTT ACL Isolation | Run `sudo ./scripts/provision-mqtt-device.sh add ...` for two test devices; confirm device A cannot publish to device B's topic and anonymous login is refused. |
| **H-06** | Offline Upgrade & Rollback | Run `sudo ./update-offline.sh` with a newer bundle and simulate a readiness failure to verify automatic previous-release & SQLite preservation. |
| **H-07** | Physical Edge Nodes & Safety | Connect real ESP32 controllers & camera; verify firmware manifest/telemetry/ACK schemas, power-cycle recovery, and hardwired emergency exit independence. |
