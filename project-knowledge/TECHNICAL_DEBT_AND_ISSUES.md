# Technical Debt, Bugs & Security Assessment — LCI-SFM

This assessment documents verified bugs, security weaknesses, architectural inconsistencies, performance bottlenecks, and maintainability debt discovered through line-by-line inspection of `/opt/lci-sfm` at commit `a44db21` (`v2.0.0-rc.1`).

---

## Severity Summary

| ID | Severity | Category | Component | Short Description |
| :--- | :---: | :--- | :--- | :--- |
| **TD-01** | **High** | Security / Auth Bug | Backend Auth & Admin UI | Admin credential rotation (`POST /api/auth/admin-profile`) silently strips `currentPassword` without verifying it and leaves existing sessions active. |
| **TD-02** | **High** | Secret Exposure Risk | Git / Docker Hygiene | `mosquitto/provisioned-credentials/*.cred` (plaintext MQTT passwords) and `dist-release/` are missing from `.gitignore` and `.dockerignore`. |
| **TD-03** | **High** | Operational / Deployment | Mosquitto & Update Scripts | Host developer ownership (`bedo:bedo`) conflicts with Mosquitto container `UID 1883` on `0600` secret files and `sudo ./update.sh` Git checks. |
| **TD-04** | **High** | Data Integrity / Safety | Legacy MQTT Ingestion | `mqttClient.js` fabricates missing sensor readings (`smoke` boolean -> `650`/`120`, `humidity: 0`) and infers `fan_relay` at `28°C` (vs `30°C` hardware rule), persisting synthetic values as real observations. |
| **TD-05** | **Medium** | Functional UI Bug | `/app/users` Credentials UI | Frontend reads `c.masked_label` (undefined; backend sends `masked_uid`) and checks `c.status === 'ACTIVE'` (backend sends `'ASSIGNED'`), hiding card UIDs and breaking Revoke/Block buttons. |
| **TD-06** | **Medium** | Performance / Scalability | `ReleaseOperationsService` | Synchronous N+1 SQLite queries inside `listDevices()` and 1-second `tick()` (~1,000+ sync queries/sec at 100 devices; `2,815ms` p95 API latency under load). |
| **TD-07** | **Medium** | Security / Legacy API | Legacy User Provisioning | `POST /api/provision/user` allows weak 4-character passwords (`min(4)`), bypassing `/api/v1/operators`'s 12-character policy. |
| **TD-08** | **Medium** | Incomplete Integrations | Edge Sync / HTTP / Vision / UI | Physical credentials stuck in `PENDING_DEVICE_SYNC`; no `HTTP_JSON_V1` background poller; `vision_service` absent & `/ws/mfa` unused in v2 UI; `landing.js` `info.mode` mismatch; unwired backend endpoints. |
| **TD-09** | **Medium** | Deployment Scripts | Air-Gapped Scripts & Docs | `install-offline.sh` omits legacy device MQTT accounts; `update-offline.sh` ignores `TLS_ENABLED=true`; `README.md` cites `dist-offline/` instead of `dist-release/`. |
| **TD-10** | **Low** | Maintainability / Dead Code | Root & Dual Schemas | Orphaned `facility-console.js` & `release-console.js`; stale `metadata.json` (`GEMINI_API`) & Node-RED root `.md` files; duplicated manifests/lint lists; dual legacy-vs-v2 SQLite tables. |

*(Note: Zero Critical RCE, SQL injection, unauthenticated admin bypass, or hardcoded production credential vulnerabilities were found — SQLite queries use parameterized prepared statements throughout, passwords/PINs use `scrypt`, cookies are `HttpOnly` + `SameSite=Strict` with timing-safe CSRF checks, and camera snapshot URLs block SSRF redirects and loopback targets.)*

---

## Detailed Findings & Source Code Evidence

### TD-01 — [HIGH] Admin Credential Rotation Does Not Verify `currentPassword` or Revoke Other Sessions
- **Evidence**:
  - Frontend [admin.js](file:///opt/lci-sfm/frontend/pages/admin.js#L1211-L1215) collects `currentPassword` in the "Rotate Admin Credentials" form and sends `{ currentPassword, newUsername, newPassword }` to `POST /api/auth/admin-profile`.
  - Backend validator `adminProfileSchema` in [schemas.js](file:///opt/lci-sfm/backend/src/validators/schemas.js#L52-L56) defines only `{ newUsername, newPassword }` without `.strict()`, causing Zod to **silently strip `currentPassword`**.
  - Route handler in [apiRoutes.js](file:///opt/lci-sfm/backend/src/routes/apiRoutes.js#L112-L133) and repository method `updateAdminCredentials()` in [sqliteRepository.js](file:///opt/lci-sfm/backend/src/repositories/sqliteRepository.js#L140-L181) update `username` and `password_hash` without calling `verifySecret(currentPassword, user.password_hash)` and without calling `revokeAllSessionsForUser(user.id)` (unlike `/api/v1/operators/:id/reset-password`, which revokes sessions).
- **Impact**: An attacker with momentary access to an unlocked admin browser tab (or CSRF if misconfigured) can permanently take over the admin account using any arbitrary `currentPassword` value, and previously stolen sessions remain valid after a legitimate admin rotates their password.

---

### TD-02 — [HIGH] Provisioned MQTT Device Credentials Directory Not Ignored by Git or Docker
- **Evidence**:
  - [provision-mqtt-device.sh](file:///opt/lci-sfm/scripts/provision-mqtt-device.sh#L27) (`CRED_DIR="$ROOT_DIR/mosquitto/provisioned-credentials"`) writes plaintext MQTT device credentials to `mosquitto/provisioned-credentials/<device_id>.cred` (lines 194–205).
  - [.gitignore](file:///opt/lci-sfm/.gitignore) and [.dockerignore](file:///opt/lci-sfm/.dockerignore) ignore `mosquitto/passwd` and `mosquitto/device-credentials.txt`, **but do not include `mosquitto/provisioned-credentials/`**.
  - Similarly, `dist-release/` (created by [build-offline-bundle.sh](file:///opt/lci-sfm/scripts/build-offline-bundle.sh#L18)) is missing from `.gitignore`, and `install.sh`'s `.git/info/exclude` block omits `mosquitto/provisioned-credentials/`.
- **Impact**: High risk of accidentally committing plaintext device MQTT passwords into Git or copying them into Docker build contexts (`docker build`), and `update.sh` will abort on dirty working trees after provisioning a single MQTT v1 device.

---

### TD-03 — [HIGH] File Ownership & Git Safe-Directory Friction Between IDE Access (`bedo:bedo`) and Appliance Scripts
- **Evidence**:
  - [install.sh](file:///opt/lci-sfm/install.sh#L264) and [update.sh](file:///opt/lci-sfm/update.sh#L82) `chown 1883:1883` and `chmod 0600` on `mosquitto/passwd` and `mosquitto/acl` so the unprivileged `mosquitto` user (`UID 1883`) inside `eclipse-mosquitto:2.0` can read them.
  - When `/opt/lci-sfm` is owned by `bedo:bedo` (`1000:1000`) for local engineering, `0600` files owned by `1000:1000` cannot be opened by container `UID 1883` on the next `docker compose restart mosquitto` or `SIGHUP` reload (`Error: Unable to open pwfile "/mosquitto/config/passwd". Permission denied.`).
  - Furthermore, running `sudo ./update.sh` executes `git` as `root` inside a `bedo:bedo` repository, triggering Git's `dubious ownership` block unless `/opt/lci-sfm` is configured in root's `safe.directory`, and [update.sh](file:///opt/lci-sfm/update.sh#L37) aborts if untracked folders like `project-knowledge/` exist.
- **Impact**: Broker restart failures or blocked updates during operational maintenance if group/ACL permissions and Git `safe.directory`/exclude rules are not harmonized.

---

### TD-04 — [HIGH] Legacy Telemetry Handler Synthesizes Missing Sensor & Actuator Values
- **Evidence**:
  - In `_handleEnvTelemetry` ([mqttClient.js](file:///opt/lci-sfm/backend/src/mqtt/mqttClient.js#L426-L440)):
    - Boolean `smoke: true/false` is converted to hardcoded numeric gas levels `650` / `120` ppm (`data.smoke ? 650 : 120`).
    - Missing `humidity` defaults to `0` (`data.humidity ?? 0`).
    - Missing `fan_relay` is inferred from temperature using `temperature >= 28.0 ? 'ON' : 'OFF'`, contradicting the hardware firmware & UI threshold of **`30.0°C`** documented in [ESP32_FIRMWARE_SPEC.md](file:///opt/lci-sfm/docs/ESP32_FIRMWARE_SPEC.md) and [monitoring.js](file:///opt/lci-sfm/frontend/pages/monitoring.js).
    - Missing `light_state` and `door_state` default to `'OFF'` and `'CLOSED'`.
  - Line 476 then passes these fabricated values into `this.operations.ingestLegacy('env_02', ...)`, storing synthetic readings into `device_frames`, `device_observations`, and `device_endpoint_state`, and evaluating `alarm_rules` against them (`650 > 400` triggers an Elevated Smoke/Gas alarm from a boolean flag, while `fan_relay: 'ON'` falsely implies physical fan actuation between `28°C` and `30°C`).
- **Impact**: Violates telemetry truthfulness — operators cannot distinguish real physical actuator/sensor readings from backend-invented fallback defaults.

---

### TD-05 — [MEDIUM] Physical Credential Masking & Revoke/Block Actions Broken in `/app/users`
- **Evidence**:
  - Backend `maskCredential()` in [facilityManagement.js](file:///opt/lci-sfm/backend/src/services/facilityManagement.js#L118-L121) returns `{ credential_id, subject_id, modality, masked_uid, status, sync_status, ... }`, where `status` is constrained in SQLite ([002_facility_management.sql](file:///opt/lci-sfm/backend/src/migrations/002_facility_management.sql#L26)) to `'ASSIGNED' | 'BLOCKED' | 'REVOKED'`.
  - Frontend `renderPersonDetailModal()` in [admin.js](file:///opt/lci-sfm/frontend/pages/admin.js#L834-L852) renders `${escapeHtml(c.masked_label || '••••')}` (always falling back to `'••••'` because `masked_label` does not exist) and conditionally renders the Revoke/Block action buttons only when `c.status === 'ACTIVE'` (which is **always `false`** for newly issued `'ASSIGNED'` credentials and `'BLOCKED'` credentials).
- **Impact**: Operators cannot see masked RFID card identifiers (`****1A2B`) in the UI and **cannot block or revoke any issued RFID card or PIN from the web interface**.

---

### TD-06 — [MEDIUM] Synchronous N+1 SQLite Queries in `listDevices()` and 1-Second Background `tick()`
- **Evidence**:
  - `device(deviceId)` in [releaseOperations.js](file:///opt/lci-sfm/backend/src/services/releaseOperations.js#L628-L709) executes **4 separate synchronous SQLite queries** (`device_registry` + `rooms`, `device_endpoints`, `device_endpoint_state`, `device_observations`) plus JSON parsing per device.
  - `listDevices()` ([releaseOperations.js](file:///opt/lci-sfm/backend/src/services/releaseOperations.js#L711-L725)) queries all matching `device_id`s and calls `ids.map((r) => this.device(r.device_id))` (`1 + 4N` queries).
  - `tick()` ([releaseOperations.js](file:///opt/lci-sfm/backend/src/services/releaseOperations.js#L105), lines `1899–1932`) runs on a `1000ms` `setInterval`, calling `listDevices()` **and then** looping over every device to call `evaluateDevice(d.device_id)`, which calls `this.device(deviceId)` **a second time** plus `alarm_rules` and `alarms` queries.
  - At 100 devices, `tick()` blocks the single Node.js event loop thread with **~1,000+ synchronous SQLite queries every second** before serving any HTTP/MQTT traffic. [PRODUCTION_READINESS_REPORT.md](file:///opt/lci-sfm/docs/PRODUCTION_READINESS_REPORT.md) records the symptom during `load-test.mjs` (`p95 = 2,815.6 ms` API latency at 100 devices).
- **Impact**: Degrades HTTP and WebSocket responsiveness linearly as device count grows beyond ~30–50 nodes.

---

### TD-07 — [MEDIUM] Legacy `POST /api/provision/user` Endpoint Weakens Operator Password Policy
- **Evidence**:
  - Modern operator creation (`POST /api/v1/operators`, validated in [managementSchemas.js](file:///opt/lci-sfm/backend/src/validators/managementSchemas.js)) enforces `password` length `>= 12` characters and cleanly separates web operators (`system_users`) from physical badge holders (`people`).
  - Legacy `POST /api/provision/user` ([apiRoutes.js](file:///opt/lci-sfm/backend/src/routes/apiRoutes.js#L261-L296), validated by `provisionUserSchema` in [schemas.js](file:///opt/lci-sfm/backend/src/validators/schemas.js#L40-L50)) remains mounted and accepts `password: z.string().min(4).max(128)`, while writing legacy `rfid`/`pin_verifier` fields onto `system_users`.
- **Impact**: Allows an admin API caller to create `Admin` or `Viewer` login accounts with 4-character passwords, bypassing the v2 security baseline.

---

### TD-08 — [MEDIUM] Incomplete Edge Integrations & Frontend-Backend Contract Gaps
1. **Edge Physical Credential Sync Unimplemented**: `physical_credentials.sync_status` has a hardcoded SQLite constraint `CHECK (sync_status = 'PENDING_DEVICE_SYNC')` ([002_facility_management.sql](file:///opt/lci-sfm/backend/src/migrations/002_facility_management.sql#L27)). No MQTT topic or sync service pushes assigned/revoked RFID UIDs or PIN verifiers to `node1`; access control validation either relies on firmware hardcoded/local lists or future sync protocol work.
2. **`HTTP_JSON_V1` Transport Has No Background Poller**: `probeDevice()` in [releaseOperations.js](file:///opt/lci-sfm/backend/src/services/releaseOperations.js) fetches HTTP JSON devices only when an operator manually triggers `POST /api/v1/devices/:id/probe`. Without periodic polling, `HTTP_JSON_V1` devices automatically transition to `OFFLINE` once `stale_after_s` elapses.
3. **Vision Service Missing & `/ws/mfa` Unwired in v2 SPA**: `mosquitto/acl` and `mqttClient.js` support `vision_service` publishing `lecf/vision/mfa_result` and broadcasting over `/ws/mfa`, and `GET /api/logs/camera_events` exists on the backend, **but no `vision_service` code or container exists in the repository**, no v2 SPA page connects to `/ws/mfa` (`frontend/` only opens `/ws/live` in [api.js](file:///opt/lci-sfm/frontend/api.js)), and `/app/logs` does not expose a `camera_events` tab.
4. **Landing Page Simulator Badge Field Mismatch**: [landing.js](file:///opt/lci-sfm/frontend/pages/landing.js#L226) checks `if (info?.mode === 'simulator')`, whereas `GET /api/public/info` ([apiRoutes.js](file:///opt/lci-sfm/backend/src/routes/apiRoutes.js#L61-L68)) returns `{ simulation: Boolean(...), status, mqttConnected, serverTime }` without a `mode` property — so the simulator mode banner never activates when `APP_SIMULATION=true`.
5. **Unwired Backend Endpoints**: `GET /api/telemetry/aggregate` and `PUT /api/v1/retention` are implemented and tested on the backend, but have no corresponding controls in `/app/analytics` or `/app/settings`.

---

### TD-09 — [MEDIUM] Air-Gapped Offline Scripts Out of Sync with Online Scripts
- **Evidence**:
  - [install-offline.sh](file:///opt/lci-sfm/install-offline.sh#L84-L88) initializes `mosquitto/passwd` with **only `lci_backend`**, omitting `node1_access`, `node2_env`, and `vision_service` (which [install.sh](file:///opt/lci-sfm/install.sh#L236-L265) provisions and records in `mosquitto/device-credentials.txt`). Legacy ESP32 nodes cannot authenticate to an offline-installed broker without manual intervention.
  - [update-offline.sh](file:///opt/lci-sfm/update-offline.sh#L95) runs `docker compose up -d --remove-orphans` unconditionally without checking `TLS_ENABLED=true` in `.env` (unlike [update.sh](file:///opt/lci-sfm/update.sh#L15-L21), which adds `-f docker-compose.tls.yml`), dropping HTTPS port `443` during an offline update on a TLS-enabled server.
  - [README.md](file:///opt/lci-sfm/README.md#L127) instructs operators to copy `dist-offline/`, whereas [build-offline-bundle.sh](file:///opt/lci-sfm/scripts/build-offline-bundle.sh#L18) outputs to `dist-release/`.

---

### TD-10 — [LOW] Orphaned Console Files, Outdated Documentation & Structural Duplication
1. **Orphaned v1.x Browser Scripts at Root**: [facility-console.js](file:///opt/lci-sfm/facility-console.js) (428 lines) and [release-console.js](file:///opt/lci-sfm/release-console.js) (819 lines) are leftover pre-SPA imperative DOM overlays that are no longer imported by `index.html`, `app.js`, or `frontend/main.js`.
2. **Outdated Root Markdown & AI Studio Artifacts**:
   - [metadata.json](file:///opt/lci-sfm/metadata.json) still references `"GEMINI_API"` from an early prototype.
   - Root files [Smart Facility Management Workflow.md](file:///opt/lci-sfm/Smart%20Facility%20Management%20Workflow.md), [Hardware Component Pinouts and Setup.md](file:///opt/lci-sfm/Hardware%20Component%20Pinouts%20and%20Setup.md), and `public/assets/aistudio/*.md` describe an obsolete **Node-RED** architecture (`1880`, dashboard nodes) that is not part of LCI-SFM, and `public/assets/aistudio/*.md` gets copied into production `dist/` builds by Vite.
3. **Duplicated Manifests & Hardcoded `npm run lint` File Lists**: Root `package.json` and `backend/package.json` duplicate runtime dependencies (`express`, `mqtt`, `ws`, `zod`), and `npm run lint` manually enumerates individual `.js`/`.mjs` files (already missing `scripts/ci-mqtt-contract-smoke.mjs`), meaning newly added files silently skip syntax checking unless added to `package.json`.
4. **Dual Legacy vs. v2 Persistence Paths**: Maintaining parallel `command_audit` vs `device_commands`, `environmental_telemetry` vs `device_frames`, and `facility_settings` vs `facilities`/`rooms` increases cognitive load and write amplification.
