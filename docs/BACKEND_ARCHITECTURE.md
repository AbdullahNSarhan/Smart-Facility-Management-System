# LCI-SFM Backend Architecture & Integration Specification

**Status:** Implemented in `backend/src/` and `docker-compose.yml` (originally authored as the Node-RED-to-Node.js migration specification)  
**Backend runtime:** Node.js 24 LTS  
**Message broker:** Eclipse Mosquitto  
**Database:** SQLite with versioned migrations and persistent storage (`node:sqlite` in WAL mode)  
**Frontend:** Existing HTML/CSS/vanilla-JavaScript BMS/HMI console (`index.html`, `styles.css`, `app.js`)  
**Vision processing:** Existing/planned Python + OpenCV service (external to `docker-compose.yml`)  
**Deployment target:** Local wired LAN / air-gapped-oriented appliance

> **Historical & implementation note:** This document was originally written as the architecture specification for migrating LCI-SFM from its early Node-RED prototype to Node.js. The Node.js backend (`backend/src/`), SQLite migrations, `scrypt` credential hashing, `HttpOnly` cookie + CSRF session middleware, `/api/telemetry/aggregate` rollup endpoint, `/api/health/live` and `/api/health/ready` health probes, and the 3-service `docker-compose.yml` (`frontend_dashboard`, `backend`, `mqtt-service`) are now implemented in the repository. Keep the four hardware/software reference documents as the source for physical design and safety behavior.

## 1. Architecture decision

Use **Node.js + Express + MQTT.js + WebSockets + SQLite + Mosquitto**.

Mosquitto is the MQTT broker, not the application's business-logic backend. Node.js performs authentication, authorization, validation, persistence, command routing, and forwarding live updates to browsers.

### Why this arrangement?

- **Node.js API service:** one explicit place for REST APIs, sessions, role checks, validation, command policy, audit records, and health reporting.
- **Mosquitto:** routes MQTT messages between edge nodes and authorized services. It enforces broker authentication and topic ACLs.
- **SQLite:** local durable persistence for users, sessions, access events, environmental telemetry, camera events, faults, and command audit records.
- **WebSockets:** Node.js forwards verified data to the browser using the existing `/ws/telemetry` and `/ws/mfa` paths.
- **Nginx:** serves only frontend build assets and proxies same-origin `/api/` and `/ws/` requests to Node.js.
- **Python/OpenCV vision service:** keeps face detection/recognition separate from the API service. It receives camera frames using the documented workflow and publishes a constrained result to MQTT.

The browser must **not** connect directly to the Mosquitto TCP listener and must never receive MQTT broker credentials. MQTT traffic stays on the trusted service/device network.

### Target data paths

```text
Operator Browser
    |
    | HTTP(S) /api/*       WebSocket /ws/*
    v
Nginx frontend (port 80 for lab; TLS recommended for deployment)
    |                       |
    | static dist/          +------ reverse proxy ------+
    |                                              Node.js API
    |                                              - Auth / RBAC
    |                                              - REST routes
    |                                              - WS broadcaster
    |                                              - Command workflow
    |                                              - MQTT client
    |                                              - SQLite repository
    |                                                      |
    |                                                      | MQTT
    |                                                      v
    |                                                Mosquitto
    |                                               /     |     \
    |                                           Node 1  Node 2  Node 3
    |                                           Access  Sensors Camera
    |                                                      |
    |                                                      +---- HTTP JPEG
    |                                                            |
    |                                                  Python/OpenCV vision
    |                                                            |
    +------------------------------------------------------------+
                                              verified face result via MQTT

SQLite file and Mosquitto credentials/configuration live in persistent volumes.
```

The root `docker-compose.yml` defines the three core appliance services (`frontend_dashboard` Nginx, `backend` Node.js/SQLite, and `mqtt-service` Mosquitto). The Python/OpenCV vision service and ESP32 node firmware remain external and must be provisioned and tested separately when connecting physical hardware.

## 2. Required software baseline

Use Node.js **24 LTS** for the initial implementation. Prefer an Active LTS release over the Current release for a facility appliance.

Recommended dependencies:
- `express` for the REST API and HTTP server.
- `mqtt` (MQTT.js) for broker client connectivity, subscriptions, and publishing.
- `ws` for WebSocket servers attached to the HTTP server.
- `better-sqlite3` for local SQLite access, prepared statements, transactions, and migrations.
- `zod` or an equally strict schema validator for request/payload validation.
- `argon2` for Argon2id password hashing, or a reviewed alternative such as the Node.js built-in scrypt implementation.
- `helmet` and `express-rate-limit` for applicable HTTP security controls and rate limits.
- A structured logger such as `pino`, with secret redaction.

Use pinned, currently supported package versions when implementing. Avoid dependencies and external services that need the public internet at runtime. Install/build assets before moving the appliance into an air-gapped network.

## 3. Service responsibilities

### 3.1 Node.js backend

Node.js is the sole owner of:
- Authentication, server-side session validation, and authorization.
- All HTTP API routes used by the frontend.
- MQTT subscriptions and command publishing.
- Validation and normalization of telemetry.
- SQLite writes and queries.
- WebSocket broadcasting.
- Command lifecycle tracking and audit records.
- Health/readiness responses and controlled startup/shutdown.

Keep the application modular. HTTP route handlers should not contain all MQTT/SQL behavior inline.

### 3.2 Mosquitto

Mosquitto is responsible for broker-level identity, connection handling, routing, QoS, and topic access control.

Baseline configuration must include:
- Anonymous access disabled.
- Separate credentials for the backend, Node 1, Node 2, Node 3, and the vision service.
- Least-privilege per-user topic ACLs.
- No public unauthenticated broker listener.
- Persistent broker configuration/credential volume.
- Message size limits and appropriate connection/persistence limits.
- TLS when MQTT traverses a network that is not physically and administratively trusted. An air-gapped label alone does not provide confidentiality or integrity.

Do not publish MQTT port 1883 to every interface by default. If the edge devices need LAN access to the broker, bind and firewall the listener deliberately. Inside Docker, services should connect by the service name `mqtt-service:1883`, not `localhost` or a container IP.

### 3.3 SQLite

Use a persistent path such as `/data/lci_sfm.db` mounted into the backend container. The Nginx container must not own or serve the database file.

Use versioned, repeatable migrations; parameterized SQL/prepared statements; transactions for related updates; foreign keys; appropriate indexes; and a documented backup/restore procedure. Enable WAL mode where appropriate for this single-host use case and configure a bounded busy timeout. Never use string concatenation for SQL values.

### 3.4 Nginx and same-origin frontend

Preferred target: serve the compiled frontend on one origin and reverse proxy:
- `/api/*` to the Node.js HTTP service.
- `/ws/*` to the Node.js WebSocket service.
- Optionally, `/api/camera/snapshot` to a restricted backend snapshot proxy rather than giving all browser clients direct access to Node 3.

Build the frontend into `dist/` and serve only those built static assets. Do not mount the whole repository as the public Nginx document root; that could expose Markdown architecture documents and configuration material.

A same-origin proxy simplifies cookies, CORS, Content Security Policy, and WebSocket access. The frontend currently constructs absolute Node-RED URLs. The implementation needs a small, deliberate frontend migration to same-origin `/api` and `/ws` URLs if cookie-based sessions are adopted. Do not make a half-migration where requests, cookies, and CSP point to different origins.

### 3.5 Python/OpenCV vision service

Keep face recognition in the Python service described by the architecture documents. Do not rebuild it in Node.js just to consolidate the API. Restrict the service's HTTP access and give its MQTT identity permission to publish only the approved face-verification result topic. Never accept an arbitrary client-submitted face match as trusted evidence.

## 4. Existing frontend API compatibility contract

Preserve the route names and response semantics below wherever practical so the redesigned UI can be integrated without another visual redesign. Use a consistent JSON envelope for errors, and document any deliberate contract changes.

| Method | Route | Expected purpose |
|---|---|---|
| `POST` | `/api/auth/login` | Authenticate operator and create a server-side session |
| `POST` | `/api/auth/logout` | Revoke the current session |
| `GET` | `/api/auth/session` | Return the authenticated operator/role and verification state |
| `GET` | `/api/health/live` | Process liveness; no secrets |
| `GET` | `/api/health/ready` | Dependency readiness summary; no secrets |
| `GET` | `/api/logs/access_logs` | Access-event rows |
| `GET` | `/api/logs/camera_events` | Camera-event rows |
| `GET` | `/api/logs/environmental_telemetry` | Persisted environmental rows |
| `GET` | `/api/logs/system_errors` | Fault/error rows |
| `GET` | `/api/logs/system_users` | Safe operator directory fields only |
| `POST` | `/api/command` | Validate, authorize, audit, and dispatch an allowed actuator command |
| `POST` | `/api/provision/user` | Provision an operator and initiate the defined credential workflow |
| `POST` | `/api/auth/admin-profile` | Change the authenticated administrator's username/password |
| `POST` | `/api/users/role` | Change an operator's role |
| `POST` | `/api/users/delete` | Disable/delete an operator and revoke its sessions |
| `GET` | `/api/telemetry/aggregate?range=24h&bucket=15m` | **New required feature**; validated historical time-bucket aggregation |
| `GET` | `/api/camera/snapshot` | Optional safer proxy to Node 3 capture endpoint |

The frontend currently uses:
- HTTP: `/api/auth/login`, `/api/logs/:table`, `/api/command`, `/api/provision/user`, `/api/auth/admin-profile`, `/api/users/role`, and `/api/users/delete`.
- WebSockets: `/ws/telemetry` and `/ws/mfa`.

All queryable table names must be selected from a strict server-side allowlist. Never place an arbitrary path/query parameter directly into SQL. A `system_users` response must not include `password`, `password_hash`, raw PIN, `pin_hash`, session secrets, or biometric embeddings. Return safe metadata such as `id`, `username`, `role`, `rfid_masked` if needed, `pin_configured`, `face_linked`, `enabled`, and timestamps.

### HTTP response semantics

Use meaningful status codes and structured JSON errors. Suggested error shape:

```json
{
  "error": {
    "code": "MQTT_UNAVAILABLE",
    "message": "The command could not be dispatched because the broker is unavailable.",
    "request_id": "server-generated-correlation-id"
  }
}
```

Do not return stack traces, SQL text, passwords, tokens, secret payloads, or internal file paths.

## 5. Authentication, sessions, and role authorization

### Target design

Prefer server-side sessions represented by a random, high-entropy, opaque cookie with:
- `HttpOnly`
- `SameSite=Strict` or a carefully justified alternative
- `Secure` when served over HTTPS
- A reasonable idle and absolute expiration
- Server-side revocation and expiry
- No username/role/permission data embedded in the token itself

Because the browser should not read the session secret, use a same-origin Nginx proxy and update the existing frontend from its current `sessionStorage` Bearer-token model to cookie-based authentication. Add CSRF protection and origin checks for state-changing requests. In a local plain-HTTP lab, document that the transport and cookie are not protected against local network interception; use HTTPS/TLS for a stronger deployment.

If the first implementation must preserve the current Bearer-token frontend temporarily, make this a deliberately marked migration compatibility mode: generate tokens with a cryptographically secure random source, store a verifier/hash server-side, expire/revoke them, never treat a browser-generated token as valid, and plan the HttpOnly-cookie migration. Do not silently keep both auth mechanisms without a clear policy.

### Roles

- **Viewer:** may read permitted telemetry, diagnostics, and audit rows.
- **Admin:** may perform Viewer actions and, subject to server-side policy, manage users/endpoints and request hardware operations.

Every API route must authorize on the server. Hiding a button or checking a browser role is not authorization.

Seed the initial Admin through a one-time setup command or protected bootstrap process using a secret supplied at deployment. Force a credential change where appropriate. Never hardcode `admin/admin`, never prefill defaults, and do not leave a reusable bootstrap password in source control.

### Passwords and PINs

Use Argon2id (or a documented approved alternative) for operator console passwords. Do not use plain SHA-256 for password storage. Enforce length/format policies, rate-limit login attempts, and return generic authentication errors.

The keypad PIN workflow requires special design because Node 1 is documented to validate access credentials locally even when the server is offline. Do not expose PINs in list APIs or logs. Before implementing provisioning, verify what the actual Node 1 firmware accepts. If a raw PIN must be delivered to the controller to support local verification, define a secure provisioning channel and retention policy; do not claim the PIN is protected merely because it is stored as a hash in SQLite while also transmitting it in MQTT or HTTP plaintext. Never silently publish a PIN to a broad MQTT topic.

## 6. MQTT topic and payload contract

### Topics already named in the project documents

These two names appear in the current architecture/workflow documentation:

| Topic | Documented use | Confidence |
|---|---|---|
| `lecf/env/telemetry` | Node 2 publishes environmental telemetry to the central service | Existing documented topic; verify against firmware |
| `lecf/access/mfa_face` | Python vision service publishes a face-verification result for the access workflow | Existing documented topic; verify payload and subscribers |

The existing references do **not** fully specify a complete topic contract for Node 1 state reports, Node 2 actuator commands, device acknowledgements, Node 3 health, or all heartbeat messages. Do not invent compatibility and assume the current firmware supports those topics.

### Proposed additions (require firmware agreement)

The following is a recommended, versionable namespace for new or updated firmware. Treat it as a proposal until implemented and tested on the real nodes.

| Topic | Publisher → subscriber | Purpose |
|---|---|---|
| `lecf/access/state` | Node 1 → backend | Door/lock state and MFA checkpoint/status updates |
| `lecf/access/heartbeat` | Node 1 → backend | Periodic node identity, boot/session identity, sequence, uptime, health |
| `lecf/access/command` | backend → Node 1 | Allowlisted access-controller command |
| `lecf/access/command/ack` | Node 1 → backend | Command ID, accepted/rejected/result state |
| `lecf/env/command` | backend → Node 2 | Fan/light/control-mode request |
| `lecf/env/command/ack` | Node 2 → backend | Command ID and result |
| `lecf/env/heartbeat` | Node 2 → backend | Explicit status/uptime/sequence |
| `lecf/camera/status` | Node 3 → backend | Camera availability/capture state (if supported) |
| `lecf/camera/heartbeat` | Node 3 → backend | Heartbeat or explicit sleep/wake state (if supported) |

Keep `lecf/access/mfa_face` as the existing documented face-result topic unless firmware owners intentionally migrate it. Do not publish sensitive biometric images or embeddings to MQTT.

### Payload requirements

Use UTF-8 JSON with a schema/version field for new contracts, a stable node identifier, monotonic sequence or event ID, and an event timestamp or uptime field.

Example **proposed** Node 2 payload:

```json
{
  "schema_version": 1,
  "node_id": "node2",
  "boot_id": "generated-at-boot",
  "seq": 104,
  "uptime_ms": 123456,
  "temperature_c": 26.5,
  "humidity_pct": 48.2,
  "smoke_gas_ppm": 120,
  "light_state": "OFF",
  "fan_relay": "OFF"
}
```

This is an example contract, not a claim that current firmware sends these exact fields. Confirm the actual units and sensor calibration. In particular, do not convert a boolean `smoke` flag or raw ADC reading into invented PPM values. Validate and normalize accepted firmware aliases at one boundary, then broadcast the field names expected by the current frontend (`temperature` or `temp`, `humidity`, `smoke_gas_level`, `light_state`, `fan_relay`, and `door_state`).

Invalid JSON, unexpected types, impossible ranges, invalid node identities, stale sequence numbers, and oversized messages must be rejected or quarantined and counted, without crashing the service. MQTT QoS 1 can deliver duplicates; use an explicit event ID or `(node_id, boot_id, seq)` deduplication key and a unique database constraint.

### MQTT reliability and retained messages

- Use QoS 1 for persistent telemetry/events and command delivery where device firmware supports acknowledgements and deduplication.
- MQTT QoS 1 is at-least-once delivery and can produce duplicate application messages.
- Do not retain actuation commands. Door-unlock and relay commands must never execute later merely because a disconnected device reconnected.
- Include a unique `command_id`, target, validated action, state, issue time, and a short expiry/deadline in every new command payload.
- Use retained last-known state only where appropriate, and label its freshness at the API/UI level. Retained data is not proof that a node is currently online.
- Add a Last Will where supported, but do not make LWT the only source of device health.
- Device firmware must deduplicate command IDs and must report an explicit acknowledgement. Without firmware acknowledgement support, the backend may report only that a message was submitted/published, not that the hardware action was executed.

## 7. Command workflow and physical safety

The frontend currently requests these command names:

| Command | Allowed state | Destination |
|---|---|---|
| `EMERGENCY_DOOR_UNLOCK` | `OPEN` or `CLOSED` | Node 1 access controller |
| `TOGGLE_HVAC_FAN` | `ON` or `OFF` | Node 2 environmental controller |
| `TOGGLE_AUX_LIGHT` | `ON` or `OFF` | Node 2 environmental controller |
| `SET_CONTROL_MODE` | `AUTO` or `MANUAL` | Node 2 / control workflow, pending firmware contract |

The existing request body includes command, state, and browser node IP values. Treat client-supplied IP values as untrusted input; route each allowed command to server-side configured targets rather than publishing to arbitrary hosts/topics.

Recommended command lifecycle:

1. Verify the server session and Admin role.
2. Validate command and state against explicit allowlists.
3. Check broker/device readiness; fail safely if the command cannot be dispatched.
4. Write an audit record before attempting dispatch.
5. Generate `command_id`, apply a short expiry, and publish only to the correct topic with retain disabled.
6. Await a matching acknowledgement if firmware supports it.
7. Update the command record and response using explicit lifecycle states.
8. Report confirmed device acknowledgement only when received; use telemetry or separate state feedback to confirm observed hardware state where possible.
9. Time out unresolved commands and retain the audit result.

Suggested result meanings:
- `rejected`: validation/authorization failed.
- `unavailable`: broker or target readiness check failed.
- `published`: broker accepted/published the message, but no node acknowledgement has been received.
- `acknowledged`: the intended node accepted the matching command ID.
- `state_confirmed`: reliable subsequent device telemetry confirms the intended state.
- `failed` / `timed_out`: the node rejected the command or did not respond before the deadline.

The existing frontend currently treats any HTTP 2xx from `/api/command` as "Confirmed by Server". Update the response handling/UI minimally so that `published` cannot be mistaken for physical confirmation.

Do not implement the fire response, emergency egress, MFA decision, or autonomous environmental control solely in the Node.js backend. The documented edge logic and hardwired break-glass mechanism must remain independent of browser/network/cloud availability. Never create an API that bypasses MFA policy to unlock a door.

## 8. Database responsibilities and minimum schema

Use versioned migrations. Implement at least these tables, adapting field names to the established API contract and existing log schemas:

- `system_users`: user ID, unique username, role, password hash, optional PIN verifier/status, RFID identifier or safe representation, biometric-linked flag, enabled flag, created/updated timestamps.
- `sessions`: session ID/secret verifier, user ID, creation/expiry/revocation timestamps, and necessary security metadata.
- `access_logs`: access attempt/result, identity reference, time, source, factor/result metadata that is safe to store.
- `camera_events`: capture/verification outcomes and timestamps; avoid storing images or biometric embeddings by default.
- `environmental_telemetry`: node ID, event/receipt time, sequence/deduplication key, validated temperature/humidity/smoke readings, light/fan state, and source metadata.
- `system_errors`: structured error code/message, source, severity, and time.
- `command_audit`: request ID/command ID, actor, target, action/state, dispatch result, acknowledgment/result timestamps, and safe error code.
- Optional `schema_migrations` and `alarms` tables as appropriate.

Enforce unique usernames, foreign keys, suitable indexes for time-ordered queries, and uniqueness for idempotency/deduplication keys. Return only safe columns from API routes. Use transactions when a command or user-management operation changes multiple related records.

Persistent alarm acknowledgement/escalation is not a current frontend capability. If implemented later, design explicit status transitions and audit metadata instead of altering the historical error row silently.

## 9. Historical telemetry rollups

The current frontend has:
- Live 30-sample FIFO charts in browser memory.
- A SQLite history option that loads up to the latest 30 table rows.
- A 24h/7d option that displays a dependency notice; it does not yet call an aggregation API.

Implement a validated endpoint such as:

`GET /api/telemetry/aggregate?range=24h&bucket=15m`

Allow only supported ranges/buckets, bind query parameters, set a sensible maximum window, and return timestamped buckets with sample counts and average/min/max values. Include no fake or extrapolated sample values. The UI should explicitly distinguish live samples, persisted raw records, and server-aggregated results.

## 10. Security and observability requirements

- Validate all HTTP bodies and MQTT payloads using strict schemas and bounded lengths.
- Use parameterized queries only; allowlist table names and command names.
- Use secure password hashes; rate-limit and audit login failures without storing submitted credentials.
- Use server-side sessions, revocation, expiry, CSRF protection, and origin checks for mutations.
- Apply role authorization on every route and MQTT publishing path.
- Restrict Mosquitto topic ACLs per credential; do not use one universal password for all nodes.
- Keep secrets in deployment environment/secrets files excluded from Git. Ship an `.env.example` with placeholders only.
- Redact Authorization headers, cookies, passwords, PINs, full RFID data where unnecessary, face images, and biometric payloads from logs.
- Apply a strict request-body size limit; the JSON command API must not accept arbitrary payloads/topics.
- Configure CORS only if a distinct origin is intentionally retained; never use wildcard origins with credentials.
- Rate-limit login and sensitive administrative endpoints.
- Maintain a restrictive CSP and do not expose private source/configuration files via Nginx.
- Emit structured logs for server start/stop, MQTT connected/disconnected, payload-validation errors, database errors, command state transitions, and auth decisions.
- Provide liveness/readiness checks that report dependency state without revealing credentials or stack traces.
- Handle SIGTERM/SIGINT cleanly: stop accepting requests, close WebSockets, close the MQTT client, flush DB writes, and close SQLite.

## 11. Proposed container layout

The implementation should introduce an explicit target layout similar to:

```text
backend/
  package.json
  Dockerfile
  src/
    server.js
    app.js
    config/
    routes/
    middleware/
    auth/
    mqtt/
    services/
    repositories/
    db/
      migrations/
    websocket/
    validators/
    utils/
  test/
mosquitto/
  mosquitto.conf
  acl
  README.md
frontend/
  nginx.conf (or an equivalent root config)
  # serves dist/ and proxies /api and /ws
data/
  # runtime volume only; never commit the actual SQLite DB
docker-compose.yml
.env.example
```

This is a suggested structure; respect the current repository and avoid duplicating the existing frontend tree unnecessarily. Persistent data directories should not be committed or served by Nginx.

Compose services should include at least:
- `frontend` (Nginx; publicly exposed UI port).
- `backend` (Node.js; internal port).
- `mqtt-service` (Mosquitto; broker port only on the required trusted network).
- An optional `ai-vision-service` if its implementation and dependencies are available in this repository.

Use a private Docker network for service-to-service connections, persistent volumes for database and broker configuration/data as appropriate, health checks, restart policies, environment configuration, and bounded logs. Do not expose internal backend/broker ports to the whole LAN unless a documented device requirement explicitly needs it.

## 12. Backend readiness / completion criteria

The backend is not complete until the following are tested:

1. A clean installation starts the configured services and creates the database through migrations.
2. Anonymous login, invalid credentials, disabled users, expired sessions, and unverified read-only sessions behave as documented.
3. Viewer requests cannot run hardware commands or administrator operations.
4. Admin authorization is validated on the server for every mutation.
5. MQTT anonymous connection is rejected and ACL tests show each node cannot publish/subscribe to unauthorized topics.
6. Valid telemetry is normalized, persisted, deduplicated, and broadcast to authorized WebSocket clients.
7. Malformed, oversized, stale, or duplicate telemetry cannot crash the backend or corrupt current state.
8. Browser REST/WebSocket routes work through the Nginx reverse proxy.
9. Command requests are allowlisted, audited, non-retained, correlated with a command ID, and never falsely marked as physically confirmed.
10. Existing frontend routes and payload fields are supported or documented changes are made coherently.
11. No PIN/password hash/session secret is returned from the user-directory API.
12. SQLite persistence survives container restart and a documented backup can be restored.
13. 24h/7d aggregation returns real server-computed buckets.
14. No internet dependency is required at runtime inside the isolated network.
15. Unit tests, API integration tests, MQTT contract/ACL tests, `npm run lint`, and `npm run build` pass. Hardware integration must be reported separately if real edge devices are unavailable.

## 13. Unresolved compatibility items to settle before production

- Confirm the exact payload published to `lecf/env/telemetry`, including whether smoke is a boolean, calibrated numeric concentration, or raw sensor reading.
- Confirm the exact JSON schema and trust boundary for `lecf/access/mfa_face`.
- Agree and implement Node 1 state/heartbeat topics, Node 2 command/ack topics, and Node 3 health behavior with firmware.
- Define whether remote PIN provisioning is supported by the actual offline firmware and how the credential reaches/stays on the controller securely.
- Verify real Node-RED-era data/API schema before writing migrations against an existing database; export and back up legacy data first.
- Confirm whether Node 3 snapshots will stay direct-to-device or be proxied through the backend.
- Confirm local-network TLS, device credential provisioning, broker exposure, and firewall rules for the final deployment.

Do not resolve any of these by inventing device capabilities. Document each as pending until the actual firmware and service behavior are verified.
