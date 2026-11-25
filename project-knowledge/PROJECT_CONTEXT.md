# AI Agent Project Context — LCI-SFM (`v2.0.0-rc.1`)

> **Read this document first in future sessions.** It condenses the verified architecture, file map, contracts, operational state, known gotchas, and engineering rules for `/opt/lci-sfm` so you do not need to repeat project-wide discovery. For deep dives, consult the companion documents in `/opt/lci-sfm/project-knowledge/`.

---

## 1. Identity & Current State

- **Project**: **LCI-SFM** (*Smart Facility Management System* — Local-First On-Premises IoT Monitoring, Access Control & Actuation Platform).
- **Repository Root**: `/opt/lci-sfm` (`main` branch at `a44db21`, version `2.0.0-rc.1`).
- **Target Architecture**: **4 strictly separated local components** — Vanilla ES-Module SPA (`nginx:1.27-alpine`) + Node.js 24 Express/WS Backend (`lci-sfm-backend`) + Embedded `node:sqlite` WAL Database (`data/lci_sfm.sqlite`) + Authenticated Eclipse Mosquitto 2.0 Broker (`eclipse-mosquitto:2.0`).
  - **IMPORTANT**: **Node-RED is NOT part of the architecture.** Ignore obsolete Node-RED mentions in root `Smart Facility Management Workflow.md`, `Hardware Component Pinouts and Setup.md`, and `public/assets/aistudio/*.md`.
- **Live Host Status (`Ubuntu 26.04.1 LTS`, `192.168.204.139`)**:
  - Docker Compose stack (`lci_frontend` on `127.0.0.1:80`, `lci_backend` on internal `3000/tcp` `healthy`, `lci_mqtt_broker` on `127.0.0.1:1883`) is **actively running**.
  - **Host Tooling Quirk**: `node` and `npm` are **NOT** installed on the host OS. Run lint/tests via Docker using the pre-built `lci-sfm-validator:node24` image (`sudo docker run --rm -v /opt/lci-sfm:/workspace:ro --mount type=tmpfs,destination=/workspace/data,tmpfs-mode=1777 -w /workspace lci-sfm-validator:node24 sh -lc 'npm run lint && npm test'`).

---

## 2. High-Signal Codebase Map

### Frontend (`index.html`, `app.js`, `styles.css`, `frontend/`)
- **Entry**: `index.html` → `app.js` → [main.js](file:///opt/lci-sfm/frontend/main.js). Built with **Vite 6** (`npm run build` → `dist/`). Zero UI frameworks (no React/Vue).
- **Core Modules**:
  - [router.js](file:///opt/lci-sfm/frontend/router.js): History API SPA router (`/`, `/login`, `/app`, `/app/rooms`, `/app/rooms/:id`, `/app/devices`, `/app/devices/:id`, `/app/monitoring`, `/app/control`, `/app/access`, `/app/alarms`, `/app/logs`, `/app/analytics`, `/app/users`, `/app/settings`).
  - [api.js](file:///opt/lci-sfm/frontend/api.js): `fetch` wrapper (`credentials: 'include'`, automatic `X-CSRF-Token` injection on mutations) + `/ws/live` auto-reconnecting WebSocket client.
  - [store.js](file:///opt/lci-sfm/frontend/store.js): Reactive pub/sub state store (`session`, `bootstrap`, `rooms`, `devices`, `alarms`, `notifications`, `telemetry`, `commands`).
  - `frontend/pages/`: [landing.js](file:///opt/lci-sfm/frontend/pages/landing.js), [login.js](file:///opt/lci-sfm/frontend/pages/login.js), [shell.js](file:///opt/lci-sfm/frontend/pages/shell.js), [overview.js](file:///opt/lci-sfm/frontend/pages/overview.js), [rooms.js](file:///opt/lci-sfm/frontend/pages/rooms.js), [devices.js](file:///opt/lci-sfm/frontend/pages/devices.js), [monitoring.js](file:///opt/lci-sfm/frontend/pages/monitoring.js), [operations.js](file:///opt/lci-sfm/frontend/pages/operations.js), [admin.js](file:///opt/lci-sfm/frontend/pages/admin.js).
- **Dead Root Files**: `facility-console.js` and `release-console.js` are unused legacy v1 overlays.

### Backend (`backend/src/`, `backend/test/`)
- **Boot & Wiring**: [server.js](file:///opt/lci-sfm/backend/src/server.js) → [env.js](file:///opt/lci-sfm/backend/src/config/env.js), [database.js](file:///opt/lci-sfm/backend/src/config/database.js), [sqliteRepository.js](file:///opt/lci-sfm/backend/src/repositories/sqliteRepository.js), [facilityManagement.js](file:///opt/lci-sfm/backend/src/services/facilityManagement.js), [releaseOperations.js](file:///opt/lci-sfm/backend/src/services/releaseOperations.js), [commandCoordinator.js](file:///opt/lci-sfm/backend/src/services/commandCoordinator.js), [mqttClient.js](file:///opt/lci-sfm/backend/src/mqtt/mqttClient.js), [wsServer.js](file:///opt/lci-sfm/backend/src/ws/wsServer.js), [app.js](file:///opt/lci-sfm/backend/src/app.js).
- **HTTP Routes**:
  - [apiRoutes.js](file:///opt/lci-sfm/backend/src/routes/apiRoutes.js) (`/api`): health (`/health/live`, `/health/ready`), auth (`/auth/login`, `/auth/logout`, `/auth/me`, `/auth/admin-profile`), bootstrap (`/bootstrap`), telemetry (`/telemetry/history`, `/telemetry/aggregate`), legacy logs (`/logs/:type`), legacy commands (`/control/command`), camera proxy (`/camera/snapshot`).
  - [managementRoutes.js](file:///opt/lci-sfm/backend/src/routes/managementRoutes.js) (`/api/v1`): `/facility`, `/operators`, `/people`, `/credentials`, `/enrollments/rfid`, `/audit`.
  - [operationsRoutes.js](file:///opt/lci-sfm/backend/src/routes/operationsRoutes.js) (`/api/v1`): `/facility/profile`, `/rooms`, `/devices` (CRUD, archive/restore, endpoints, commands, probe, snapshot, mqtt-provisioning), `/pending-devices` (approve/dismiss), `/alarm-rules`, `/alarms` (ack/resolve/comment), `/notifications`, `/retention`, `/diagnostics`, `/export/:kind.csv`.
- **Security**: `scrypt` password/PIN hashing ([crypto.js](file:///opt/lci-sfm/backend/src/utils/crypto.js)); `HttpOnly` + `SameSite=Strict` `lci_session` cookie + SHA-256 `token_verifier` in `sessions` + timing-safe `X-CSRF-Token` validation ([auth.js](file:///opt/lci-sfm/backend/src/middleware/auth.js)); strict Zod schemas; SSRF-hardened camera/HTTP probes ([cameraSnapshot.js](file:///opt/lci-sfm/backend/src/services/cameraSnapshot.js)).
- **Database**: 30 tables + 5 triggers across `001`–`004` in `backend/src/migrations/`. Note: `system_users` = web operators (`Admin`/`Viewer`); `people` + `physical_credentials` = badge/PIN holders.
- **Tests**: 4 suites (`backend.test.js`, `management.test.js`, `operations.test.js`, `multiroom.test.js`) — **65 / 65 passing**.

### MQTT Contracts (`mosquitto/`, `backend/src/mqtt/`)
- **Modern `MQTT_V1` (`lci/v1/d/<device_id>/...`)**:
  - Device → Backend: `announce`, `status`, `telemetry`, `event`, `ack`, `enroll/event`.
  - Backend → Device: `cmd` (`<device_id>/cmd`), `enroll/cmd`.
  - Provisioned per-device via `sudo ./scripts/provision-mqtt-device.sh <device_id>`.
- **Legacy `LEGACY_V1` (`lecf/...`)**:
  - Subscribed: `lecf/node1/access_event`, `lecf/vision/mfa_result`, `lecf/env/telemetry`, `lecf/+/ack`, `lecf/+/status`, `lecf/+/error`, `lecf/+/enroll/event`, `lecf/system/errors`.
  - Published: `lecf/node1/cmd`, `lecf/env/cmd`, `lecf/node3/cmd`, `lecf/<id>/enroll/cmd`.
- **Command Truthfulness Principle**: Actuation commands are **never** marked `CONFIRMED` / `state_confirmed` upon publish or `ACK` alone; physical state telemetry from the device must confirm the requested state before `expires_at`.

---

## 3. Top Known Issues & Operational Gotchas

1. **`TD-01` (Security Bug)**: `POST /api/auth/admin-profile` strips `currentPassword` in `adminProfileSchema` without checking it and does not revoke existing sessions.
2. **`TD-02` (Secret Leak Risk)**: `mosquitto/provisioned-credentials/` (created by `provision-mqtt-device.sh`) and `dist-release/` are **not** in `.gitignore` or `.dockerignore`.
3. **`TD-03` (Mosquitto UID `1883` Permission Gotcha)**: `/opt/lci-sfm` was `chown`ed to `bedo:bedo` (`1000:1000`). Because `mosquitto/passwd` and `mosquitto/acl` are `0600`, **restarting `lci_mqtt_broker` will fail with `Permission denied`** unless `UID/GID 1883` has read access (`chown bedo:1883` + `chmod 0640` or `chown 1883:1883`). Also `sudo ./update.sh` checks `git status --porcelain` (aborts on untracked files) and needs `git safe.directory` when owned by `bedo`.
4. **`TD-04` (Synthetic Legacy Telemetry)**: `mqttClient.js:_handleEnvTelemetry` converts boolean `smoke` to `650`/`120`, defaults `humidity` to `0`, and infers `fan_relay` at `28.0°C` (mismatching the `30.0°C` hardware rule), feeding synthetic values into `operations.ingestLegacy()`.
5. **`TD-05` (Broken UI Credential Actions)**: `frontend/pages/admin.js` reads `c.masked_label` (backend sends `masked_uid`) and checks `c.status === 'ACTIVE'` (backend sends `'ASSIGNED'`), hiding card UIDs and disabling Revoke/Block buttons in `/app/users`.
6. **`TD-06` (SQLite N+1 Bottleneck)**: `ReleaseOperationsService.tick()` runs every `1000ms` and executes `listDevices()` + `evaluateDevice()` per device (~1,000+ sync queries/sec at 100 devices).
7. **Secrets on Disk (NEVER READ OR PRINT VALUES)**: `.env`, `DEPLOYMENT-CREDENTIALS.txt`, `mosquitto/passwd`, `mosquitto/device-credentials.txt`, `mosquitto/provisioned-credentials/*.cred`.

---

## 4. Companion Knowledge Base Index (`/opt/lci-sfm/project-knowledge/`)

1. [PROJECT_OVERVIEW.md](file:///opt/lci-sfm/project-knowledge/PROJECT_OVERVIEW.md) — Purpose, scope, roles, and release readiness status.
2. [SYSTEM_ARCHITECTURE.md](file:///opt/lci-sfm/project-knowledge/SYSTEM_ARCHITECTURE.md) — Frontend, Backend, SQLite, Mosquitto, and Docker/Nginx architecture.
3. [CODEBASE_STRUCTURE.md](file:///opt/lci-sfm/project-knowledge/CODEBASE_STRUCTURE.md) — Complete directory tree and file-by-file responsibilities.
4. [FEATURES_AND_MODULES.md](file:///opt/lci-sfm/project-knowledge/FEATURES_AND_MODULES.md) — Verification matrix of every feature (`Implemented` / `Partial` / `Not Implemented`).
5. [API_AND_INTEGRATION_MAP.md](file:///opt/lci-sfm/project-knowledge/API_AND_INTEGRATION_MAP.md) — All REST endpoints, WebSocket channels, MQTT payloads, and end-to-end data flows.
6. [DATABASE_DOCUMENTATION.md](file:///opt/lci-sfm/project-knowledge/DATABASE_DOCUMENTATION.md) — All 30 SQLite tables, 5 triggers, indexes, ER diagram, and schema vs. doc notes.
7. [DEVELOPMENT_GUIDE.md](file:///opt/lci-sfm/project-knowledge/DEVELOPMENT_GUIDE.md) — Host environment, npm/Docker commands, `.env` variables, ports, and operational caveats.
8. [TECHNICAL_DEBT_AND_ISSUES.md](file:///opt/lci-sfm/project-knowledge/TECHNICAL_DEBT_AND_ISSUES.md) — Severity-ranked (`High`/`Medium`/`Low`) code quality & security findings with line citations.
9. [DEVELOPMENT_ROADMAP.md](file:///opt/lci-sfm/project-knowledge/DEVELOPMENT_ROADMAP.md) — Prioritized `P0`–`P4` engineering plan for `v2.0.0` GA and hardware commissioning.

---

## 5. Standing Engineering Governance Rules

1. **Inspect existing code** before modifying any file.
2. **Prefer surgical, targeted edits** over full-component rewrites.
3. **Preserve working functionality** and backward compatibility unless instructed otherwise.
4. **Follow established conventions**: ES modules (`import`/`export`), `node:sqlite` parameterized prepared statements, Zod input schemas, vanilla SPA modules (`frontend/`), and structured logging.
5. **No unapproved technologies, dependency installs, feature removals, or `git push` operations.**
6. **Never expose secrets** from `.env`, `DEPLOYMENT-CREDENTIALS.txt`, or `mosquitto/*`.
7. **Verify every change** with `npm run lint` and `npm test` (and `npm run test:ui` for UI changes).
