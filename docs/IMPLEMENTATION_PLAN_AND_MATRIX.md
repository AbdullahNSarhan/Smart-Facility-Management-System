> **Management update:** Shared node settings, separate people/credentials, reader enrollment software, camera proxy and the new API are documented in [Facility Management](FACILITY_MANAGEMENT.md). That guide supersedes older browser-only IP and combined provisioning descriptions below. Device policy sync and Vision remain pending.

# LCI-SFM Node.js Backend Implementation Plan & Contract Matrix

## 1. Implementation Plan (Milestones 1–11)

1. **Milestone 1 — Backend Scaffold, Config & Health**:
   - Create modular `backend/src/` architecture (`config/`, `db/`, `auth/`, `middleware/`, `mqtt/`, `repositories/`, `services/`, `routes/`, `validators/`, `websocket/`, `utils/`).
   - Separate Express/WebSocket application construction (`backend/src/app.js`) from HTTP listener startup (`backend/src/server.js`) and graceful `SIGINT`/`SIGTERM` shutdown.
   - Implement request correlation IDs (`X-Request-Id`), structured JSON logging with secret redaction, strict body-size limits (`32kb`), rate limiting, and `/api/health/live` + `/api/health/ready`.
   - Provide `.env.example`, `nginx/nginx.conf`, `mosquitto/mosquitto.conf`, `mosquitto/acl`, `backend/Dockerfile`, and updated `docker-compose.yml`.

2. **Milestone 2 — SQLite Schema, Versioned Migrations & Backup/Restore**:
   - Use `better-sqlite3` with WAL journal mode, `foreign_keys = ON`, and `busy_timeout = 5000`.
   - Create versioned SQL migrations in `backend/src/db/migrations/` for:
     - `schema_migrations`
     - `system_users`
     - `sessions`
     - `access_logs`
     - `camera_events`
     - `environmental_telemetry`
     - `system_errors`
     - `command_audit`
   - Implement safe database backup and restore utilities (`backend/src/db/backup.js`).

3. **Milestone 3 — Authentication, Server-Side Sessions & RBAC**:
   - Implement `crypto.scrypt` (memory-hard OWASP-compliant KDF built into Node.js `crypto` with high-entropy random salt and timing-safe comparison, avoiding native C++ build fragility while meeting OWASP password storage standards; documented in architecture).
   - Support same-origin `HttpOnly`, `SameSite=Strict` session cookies (`lci_sid`) with CSRF token protection (`X-CSRF-Token`) AND controlled Bearer-token compatibility (`Authorization: Bearer <token>`) backed by the same server-side `sessions` table (storing only SHA-256 token verifiers, never raw tokens, with idle/absolute expiry and immediate revocation).
   - Implement `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`, and a secure one-time administrator bootstrap workflow (`LCI_BOOTSTRAP_ADMIN_PASSWORD` env var or CLI `npm run bootstrap-admin`).

4. **Milestone 4 — MQTT Service, Topic Registry & Payload Validation**:
   - Build singleton `MqttCoordinator` (`backend/src/mqtt/mqttClient.js`) with exponential backoff, connection state tracking, and clean shutdown.
   - Define strict topic registry (`backend/src/mqtt/topics.js`) separating **Verified Documented Topics** (`lecf/env/telemetry`, `lecf/access/mfa_face`) from **Proposed Firmware Extension Topics** (`lecf/access/state`, `lecf/access/heartbeat`, `lecf/access/command`, `lecf/access/command/ack`, `lecf/env/command`, `lecf/env/command/ack`, `lecf/env/heartbeat`, `lecf/camera/status`, `lecf/camera/heartbeat`).
   - Validate all inbound MQTT frames with Zod schemas and deduplicate QoS 1 replays via `(node_id, boot_id, seq)` unique index when sequence fields are present.

5. **Milestone 5 & 6 — REST APIs & Authenticated WebSocket Streams**:
   - Implement all UI REST contracts (`/api/logs/:table` with strict table allowlist and secret-free `system_users` projection, `/api/command`, `/api/provision/user`, `/api/auth/admin-profile`, `/api/users/role`, `/api/users/delete`, `/api/telemetry/aggregate`).
   - Attach `/ws/telemetry` and `/ws/mfa` WebSocket servers (`backend/src/websocket/wsServer.js`) to the HTTP server, authenticating connections via cookie or Bearer token and broadcasting normalized telemetry/MFA events with backpressure bounds.

6. **Milestone 7, 8 & 9 — Command Coordinator, Admin Safety & Telemetry Rollups**:
   - Implement `CommandCoordinator` recording every command in `command_audit` before publishing to fixed server-side MQTT topics with `retain: false`.
   - Return truthful command lifecycle states (`published`, `acknowledged`, `state_confirmed`, `unavailable`, `rejected`, `timed_out`) and update the frontend (`app.js`) to distinguish `published` (broker accepted publish) from `acknowledged` / `state_confirmed`.
   - Enforce last-Admin protection, session revocation on role change/deletion, and explicit offline PIN provisioning status.
   - Implement `GET /api/telemetry/aggregate?range=24h|7d|1h&bucket=5m|15m|1h` using parameterized SQLite time-bucket aggregation and wire the frontend's `24h / 7d Rollup` chart mode to consume it.

7. **Milestone 10 & 11 — Docker Compose, Nginx Proxy & Automated Test Suite**:
   - Configure `nginx/nginx.conf`, `mosquitto/mosquitto.conf`, `mosquitto/acl`, `backend/Dockerfile`, and `docker-compose.yml`.
   - Write comprehensive automated unit and HTTP/WebSocket/MQTT integration tests in `backend/test/` using Node's test runner and `supertest`.

---

## 2. Contract & Dependency Matrix

| Subsystem / Interface | Route / Topic | Verification Status | Security & Data Contract |
| :--- | :--- | :--- | :--- |
| **Auth Login** | `POST /api/auth/login` | Verified UI Contract | Validates username/password (scrypt), creates server-side `sessions` row, sets `HttpOnly` cookie + returns token/CSRF token & role (`Admin` \| `Viewer`). Rate-limited. |
| **Auth Logout** | `POST /api/auth/logout` | Verified UI Contract | Revokes session in SQLite, clears cookie, disconnects bound WebSockets. |
| **Auth Session** | `GET /api/auth/session` | Verified UI Contract | Returns `{ authenticated, verified: true, user: { id, username, role }, csrf_token }`. |
| **Health Probes** | `GET /api/health/live`, `GET /api/health/ready` | Target Architecture | Liveness returns HTTP 200 `{ status: "alive" }`. Readiness reports SQLite, MQTT broker, and per-node evidence states without secrets. |
| **Audit Logs** | `GET /api/logs/:table` | Verified UI Contract | Allowlisted tables: `access_logs`, `camera_events`, `environmental_telemetry`, `system_errors`, `system_users`. `system_users` omits all password/PIN hashes. |
| **Telemetry Rollup** | `GET /api/telemetry/aggregate` | New Implemented Feature | Allowlisted `range` (`1h`, `24h`, `7d`) and `bucket` (`5m`, `15m`, `1h`). Returns real SQLite `AVG`, `MIN`, `MAX`, `COUNT` buckets. |
| **Command Dispatch** | `POST /api/command` | Verified UI Contract | Allowlisted commands (`EMERGENCY_DOOR_UNLOCK`, `TOGGLE_HVAC_FAN`, `TOGGLE_AUX_LIGHT`, `SET_CONTROL_MODE`). Ignores client IPs for routing; publishes non-retained MQTT frame with `command_id` and returns explicit lifecycle state (`published`, `acknowledged`, `unavailable`). |
| **User Provisioning** | `POST /api/provision/user` | Verified UI Contract | Admin-only. Stores scrypt password hash & PIN verifier in SQLite; returns `provisioning_sync_status: "stored_pending_edge_sync"` because Node 1 offline EEPROM sync topic is not yet defined in firmware. |
| **Admin Profile** | `POST /api/auth/admin-profile` | Verified UI Contract | Admin-only. Updates username and scrypt password hash in transaction; audits change. |
| **User Role / Delete** | `POST /api/users/role`, `POST /api/users/delete` | Verified UI Contract | Admin-only. Prevents deleting/demoting the last enabled Admin; revokes active sessions of modified/deleted user. |
| **Telemetry WS** | `WS /ws/telemetry` | Verified UI Contract | Requires valid session (cookie or Bearer). Broadcasts `{ temperature, humidity, smoke_gas_level, light_state, door_state, fan_relay, node, seq, timestamp }`. |
| **MFA WS** | `WS /ws/mfa` | Verified UI Contract | Requires valid session. Broadcasts `{ isFacePassed, isCardPassed, isPinPassed, mfa_status, timestamp }`. |
| **Env Telemetry MQTT** | `lecf/env/telemetry` | Documented Firmware Topic | Subscribed by backend (QoS 1). Normalizes `temp`/`temperature`, validates ranges, deduplicates `(node_id, boot_id, seq)`, persists to SQLite, broadcasts to `/ws/telemetry`. |
| **Face Match MQTT** | `lecf/access/mfa_face` | Documented Service Topic | Published by Python vision service; subscribed by Node 1 & backend. Updates MFA state and logs `camera_events`. |
| **Proposed Node Topics** | `lecf/access/state`, `lecf/access/command`, `lecf/access/command/ack`, `lecf/env/command`, `lecf/env/command/ack`, `lecf/*/heartbeat` | Proposed (Requires Firmware Agreement) | Registered in `backend/src/mqtt/topics.js`. Commands publish to `lecf/access/command` or `lecf/env/command` (`retain: false`) and transition from `published` to `acknowledged` only if matching `command_id` arrives on `.../ack`. |
