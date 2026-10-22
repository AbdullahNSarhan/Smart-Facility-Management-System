# Coding-Agent Prompt — Implement the LCI-SFM Node.js Backend

Use this prompt with a coding agent that can inspect and edit the repository (for example, a connected GitHub coding agent, Claude Code, or Cursor). It is deliberately specific to this project rather than a generic Express/MQTT starter.

**Read first:** `docs/BACKEND_ARCHITECTURE.md`, `docs/FRONTEND_DOCUMENTATION.md`, `lci_sfm_comprehensive_workflows_system_logic.md`, `hardware_embedded_systems_architecture_reference_lci_sfm.md`, `lci_sfm_ai_software_development_programming_concepts_guide.md`, and the current frontend source.

**Runtime:** Node.js 24 LTS (or another currently supported LTS only if a native dependency makes Node 24 impractical; justify the change). Node.js production guidance recommends LTS releases: https://nodejs.org/en/about/previous-releases

---

## MASTER IMPLEMENTATION PROMPT

You are the senior backend architect, Node.js engineer, MQTT/Mosquitto engineer, SQLite data engineer, application-security engineer, and integration-test engineer for this repository.

Build the **real backend** for LCI-SFM (Light Current Infrastructure for Smart Facility Management). The current frontend has been redesigned, and its routes/data fields are documented in `docs/FRONTEND_DOCUMENTATION.md`. The architecture and proposed contracts are defined in `docs/BACKEND_ARCHITECTURE.md`.

Implement working code, deployment configuration, database migrations, tests, and operator documentation—not just suggestions, pseudocode, diagrams, or mock APIs.

### A. First discover; do not break the existing project

1. Inspect the whole repository, its branch, current tree, all relevant documentation, frontend files, `package.json`, `docker-compose.yml`, `.env.example`, and any existing backend/firmware files.
2. Verify what exists and what does not. The documented architecture mentions Node-RED and a Python vision service, but the target is now **Node.js as the central application/API service**. Do not build parallel Node-RED and Node.js implementations of the same auth, SQL, or command business logic. Do not delete existing firmware or vision code.
3. Read every existing frontend API route, request body, response expectation, WebSocket path/payload field, role check, chart source selector, command name, and table name. Preserve compatibility where practical.
4. Distinguish verified existing firmware topics from proposed topics in the backend architecture document. Never assume a proposed heartbeat/acknowledgement topic exists in installed firmware.
5. Before editing, write a short implementation plan and a contract/dependency matrix in the repo. Then implement in small coherent stages. Do not stop after the plan.
6. When hardware or backend details are unknown, choose a conservative, explicit interface, put the assumption in docs, and continue. Do not block progress with questions. Never claim unverified hardware functionality is implemented.
7. Do not replace the redesigned frontend with a new UI framework, template, mock dashboard, or unrelated visual redesign.

### B. Target service topology

Implement and document this target:

- **Nginx frontend:** serves only compiled frontend assets; proxies same-origin `/api/*` and `/ws/*` routes to Node.js.
- **Node.js backend:** Express HTTP routes, server-side session/authentication, role authorization, input validation, command coordinator, MQTT client, WebSocket broadcasting, SQLite repositories/migrations, audit logging, health/readiness checks.
- **Mosquitto:** broker for authorized local MQTT clients. Anonymous access disabled. Separate identities and least-privilege topic ACLs for backend, Node 1, Node 2, Node 3, and vision service.
- **SQLite:** persistent local database volume; only the backend reads/writes application data.
- **Python/OpenCV service:** remains separate if present/needed; its MQTT identity may publish only the intended face-verification result topic.
- **ESP32 edge nodes:** retain documented local safety, MFA, environmental autonomy, and hardwired emergency egress behavior.

Frontend browser clients must never connect directly to Mosquitto and must never receive broker credentials. In Docker, service-to-service connections use service DNS names such as `mqtt-service:1883`, not `localhost` or dynamic container IPs.

Use Node.js 24 LTS, Express, MQTT.js (`mqtt` package), `ws`, `better-sqlite3` or another justified local SQLite driver, strict request/payload schemas (e.g. Zod), Argon2id password hashing (or a justified supported alternative), security middleware, and structured logging with secret redaction. Pin dependency versions and check their compatibility. Do not add dependencies without a reason.

Official/reference links:
- Node.js releases: https://nodejs.org/en/about/previous-releases
- MQTT.js client: https://github.com/mqttjs/MQTT.js
- Mosquitto configuration/authentication/ACL guidance: https://mosquitto.org/man/mosquitto-conf-5.html
- OWASP password-storage recommendations: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

### C. Implement staged milestones

#### Milestone 1 — Backend scaffold and configuration

Create a clear structure similar to:

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
    db/migrations/
    websocket/
    validators/
    utils/
  test/
mosquitto/
  mosquitto.conf
  acl
  README.md
frontend/ or existing root frontend files
  nginx.conf
docker-compose.yml
.env.example
docs/
```

Adapt this to the existing repo instead of duplicating existing source files.

Requirements:
- Separate application construction from listening, so API tests can import the app.
- Validate required environment values on startup and fail clearly for missing mandatory production secrets.
- Use graceful SIGINT/SIGTERM shutdown.
- Add request IDs, structured logs, body-size limits, consistent JSON errors, safe error handling, and basic request-rate limits.
- Add `GET /api/health/live` and `GET /api/health/ready`. Liveness should not fail just because MQTT is down; readiness should describe dependency conditions without exposing credentials.
- Provide a safe `.env.example` containing placeholders only. No secret, password, token, PIN, broker credential, database file, or real biometric image may be committed.
- Do not serve the source repository root via Nginx; serve only build output and explicit public assets.

#### Milestone 2 — SQLite schema and migrations

Implement versioned migrations for at least:
- `system_users`
- `sessions`
- `access_logs`
- `camera_events`
- `environmental_telemetry`
- `system_errors`
- `command_audit`
- `schema_migrations`

Add necessary timestamps, foreign keys, unique constraints, sequence/deduplication keys, and indexes. Decide and document the UTC timestamp format consistently. Use parameterized queries/prepared statements and transactions when operations affect multiple rows. Configure a persistent path, bounded busy timeout, and a suitable journal mode. Implement a backup/restore procedure.

If the repository contains a legacy database or Node-RED schema, inspect and document it before migration. Do not overwrite, silently recreate, or delete an existing database. Prefer explicit schema migrations and an optional tested import path that backs up the source first.

Store console passwords using Argon2id (or documented approved alternative), never plain SHA-256. Avoid storing PINs in plaintext. Since Node 1 is documented to support offline local PIN verification, define the provisioning contract with its actual firmware rather than falsely claiming a central hash alone enables local keypad verification. Never broadcast raw PINs across a general-purpose MQTT topic.

#### Milestone 3 — Authentication and authorization

Implement:
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`

Preferred mode: same-origin server-side sessions with an opaque random HttpOnly cookie, expiry/revocation, `SameSite`, `Secure` under HTTPS, CSRF protection, and origin checks. Update the existing frontend's auth requests consistently to this mode if needed; do not leave half of the API using cookies and half using stale browser Bearer-token logic.

For a brief migration-only Bearer compatibility mode, token entropy must come from a cryptographically secure random source and validation/expiry/revocation must be server-side. Never accept a token generated by the browser as proof of identity. Document and test the sunset of compatibility mode.

Roles:
- Viewer: read only.
- Admin: read plus server-authorized operator/configuration actions and approved commands.

Create a one-time secure bootstrap process for the first administrator using a deployment secret or interactive setup command. No hardcoded `admin/admin` credentials. Never return password hashes, PIN values/hashes, session secrets, biometric embeddings, or unnecessary full RFID values from list endpoints. Login rate limits and generic failure responses are required.

Every route and every protected mutation must check authorization on the server. Disabled or deleted users must not keep valid sessions.

#### Milestone 4 — MQTT service and strict topic policy

Create one owned MQTT client inside the backend service. Implement reconnect/backoff, connection/disconnection health state, subscription management, validation, deduplication, and controlled graceful shutdown. Do not spawn a fresh MQTT connection per HTTP request.

Mosquitto requirements:
- Anonymous connections disabled.
- Distinct usernames per backend and device/service.
- Least-privilege ACLs.
- Persistent configuration/credentials.
- No broad wildcard permissions if a narrow topic rule will work.
- No retained actuator commands.
- Limit payload size; configure broker listener/firewall exposure deliberately.
- No secret values inside committed files.

Topics that are explicitly named in the current project docs:
- `lecf/env/telemetry` — documented Node 2 environmental telemetry.
- `lecf/access/mfa_face` — documented face-verification result from the vision workflow.

The current documents do not prove that all proposed node state, heartbeat, actuator-command, or acknowledgement topics exist in firmware. Create a versioned topic registry in code/docs. Keep verified topics and proposed topics clearly separate. Implement a topic only when a payload schema and publisher/subscriber ownership are defined. If firmware has not yet implemented a command/ack topic, expose the feature as unavailable or published-only; do not claim node acknowledgement.

Validate each MQTT payload before it reaches database/state logic:
- Valid JSON and bounded length.
- Known topic and source identity.
- Strict field types and units.
- Allowed numeric ranges only after sensor calibration/range is verified.
- Sequence/event IDs and duplicate handling.
- Safe handling of malformed input without crashing the client process.

MQTT QoS 1 may deliver duplicates. Use a unique event key such as `(node_id, boot_id, seq)` only when the payload actually supplies these fields, or a stable event ID. Do not fabricate them and pretend to deduplicate. Treat retained state as last-known state, not proof of current connectivity.

Proposed new topics are suggestions until firmware agreement:
- `lecf/access/state`
- `lecf/access/heartbeat`
- `lecf/access/command`
- `lecf/access/command/ack`
- `lecf/env/command`
- `lecf/env/command/ack`
- `lecf/env/heartbeat`
- `lecf/camera/status`
- `lecf/camera/heartbeat`

Do not rename the known topics without a planned coordinated firmware migration.

#### Milestone 5 — REST APIs required by the existing UI

Support and test these routes with consistent response schemas:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `GET /api/health/live`
- `GET /api/health/ready`
- `GET /api/logs/access_logs`
- `GET /api/logs/camera_events`
- `GET /api/logs/environmental_telemetry`
- `GET /api/logs/system_errors`
- `GET /api/logs/system_users`
- `POST /api/command`
- `POST /api/provision/user`
- `POST /api/auth/admin-profile`
- `POST /api/users/role`
- `POST /api/users/delete`
- `GET /api/telemetry/aggregate?range=24h&bucket=15m` (new requirement).

Check the exact current UI payload/response assumptions before coding. Use server-side allowlists for log tables; never insert route parameters directly into SQL. Return only safe user-directory fields. Do not let a request specify an arbitrary MQTT topic, arbitrary host/IP, SQL string, or command.

Use strict validation and meaningful status codes. Return generic client-safe messages with request IDs; preserve detailed causes only in secret-redacted server logs.

#### Milestone 6 — WebSocket integration

Implement `/ws/telemetry` and `/ws/mfa` attached to the same HTTP server and available through Nginx upgrade proxying.

Requirements:
- Authenticate/authorize the browser WebSocket connection using the chosen session mechanism and origin policy.
- Broadcast the field names the redesigned frontend currently expects.
- Normalize accepted device/firmware field aliases at the backend boundary; do not scatter alias logic through UI clients.
- Send a connection/status message only if the frontend contract is updated to understand it.
- Validate MQTT-originated messages before broadcasting.
- Bound message rates and outbound buffers; disconnect slow or abusive clients safely.
- Clean up on logout and shutdown.
- Do not broadcast secrets, raw PINs, session cookies, or biometric images/embeddings.
- Provide honest initial/stale/unknown semantics; do not publish fake initial zero telemetry to force a green status.

The backend should send an initial state snapshot only if it is built from real, persisted/received values, including timestamp and freshness metadata where supported. Do not imply that stale retained values are live.

#### Milestone 7 — Command coordinator and audit

Support only these existing frontend command names until the device contract changes:

- `EMERGENCY_DOOR_UNLOCK`: `OPEN` / `CLOSED`, target Node 1.
- `TOGGLE_HVAC_FAN`: `ON` / `OFF`, target Node 2.
- `TOGGLE_AUX_LIGHT`: `ON` / `OFF`, target Node 2.
- `SET_CONTROL_MODE`: `AUTO` / `MANUAL`, target to be confirmed with the current firmware contract.

Implement server-side validation and verified Admin authorization, command ID, actor/audit record, fixed server-side topic mapping, bounded command deadline, publish with retain disabled, response schema, and duplicate/idempotency policy.

Never trust arbitrary destination IPs or MQTT topics supplied by the browser. Do not bypass the 2-out-of-3 MFA state machine or hardwired break-glass behavior. The backend is a supervisory service, not the only safety layer.

Distinguish at least:
- rejected (policy/validation);
- unavailable (broker/target not ready);
- published (broker accepted publish; device execution not confirmed);
- acknowledged (matching device command acknowledgement received);
- state_confirmed (subsequent trusted telemetry verifies requested state);
- failed or timed_out.

Do not return "hardware confirmed" just because MQTT publish returned successfully or the HTTP request returned 200. Update the existing frontend minimally to use truthful command states. If installed firmware does not support correlated acknowledgements, ship published-only behavior and document the firmware work, rather than inventing ACKs.

#### Milestone 8 — Operator administration and security-sensitive workflows

Implement the existing UI contracts for user provision, admin credential change, role changes, and deletion. Validate fields and authorize each request. Prevent removing/disabling the last enabled administrator, protect self-lockout where appropriate, revoke affected sessions, and write audit events.

Masking data in the browser is not enough. The API must not send secrets it does not need to display. Review the current user provisioning form's `password` and `pin` fields and explicitly document how the actual controller receives the credential required for local offline verification. Do not implement insecure plaintext provisioning simply to make the form pass.

Implement only behavior supported by the actual database, backend, and firmware. If a route needs secure provisioning transport or an unimplemented controller topic, return a clear not-implemented/unavailable response and document its dependency.

#### Milestone 9 — History rollups and honest health status

Implement `GET /api/telemetry/aggregate` using allowlisted ranges/buckets and parameterized SQL. Return actual time buckets, timestamps, sample counts, and relevant min/average/max values. Do not interpolate or invent missing sensor records. Bound the query window and add appropriate indexes.

Implement separate readiness/evidence state for central HTTP service and MQTT. Use independent node status only when independent node evidence exists. Node 1 can be idle between events, and Node 3 may sleep by design after PIR-triggered activity; silence does not prove failure. If a per-node heartbeat topic is not supported, mark the controller state as unknown/idle according to available evidence and list the firmware requirement.

#### Milestone 10 — Compose deployment and operational docs

Build a tested Docker Compose target with:
- Nginx frontend;
- Node.js backend;
- Mosquitto;
- optional vision service only if its implementation is available and configured.

Use a private Docker network, persistent SQLite and Mosquitto volumes, health checks, restart policies, reasonable log rotation, resource/request limits where appropriate, and environment-based configuration. Do not expose the backend or broker ports to every interface without a documented need. Use service names for container communication. The frontend Nginx config must serve only build assets and proxy `/api`/`ws`.

Do not use public cloud dependencies at runtime. Document how images/npm packages are prepared before air-gapped deployment.

Provide:
- `.env.example` with placeholders;
- Mosquitto configuration and ACL samples;
- backend Dockerfile;
- updated `docker-compose.yml`;
- development and deployment instructions;
- one-time Admin bootstrap procedure;
- database migration/backup/restore procedures;
- topic and API reference;
- safe credential rotation steps.

Never commit production secrets, real database files, MQTT password files, camera snapshots, or biometric data.

#### Milestone 11 — Testing and real validation

Use an automated test suite (e.g. Node's test runner or Vitest/Jest, with Supertest for HTTP integration tests). Avoid requiring physical hardware for unit tests. Use integration tests with a dedicated test database and, where practical, a disposable Mosquitto container.

Test:
- Input validation and error handling.
- Login success/rejection, lockout/rate limiting, expiry/revocation, disabled accounts.
- Viewer denied from all mutation routes.
- Admin authorization.
- User-directory response contains no password/PIN/hash/session secrets.
- SQLite migrations and restart persistence.
- MQTT validation, authorization/ACLs, duplicate messages and reconnect behavior.
- WebSocket route/auth and normalized payload delivery.
- Command allowlist, correct fixed topic, no retained commands, lifecycle states and timeout behavior.
- Aggregation window validation and query results.
- Nginx same-origin HTTP and WebSocket proxying.
- Security-sensitive negative cases.
- `npm run lint`, `npm run build`, and automated tests.

If real devices are unavailable, mark hardware integration as not tested. Never claim a door lock, sensor, relay, camera, MFA or firmware feature was physically verified when only a mock or broker publish was tested.

### D. Required implementation output

At the end, provide:
1. Actual changed/new file list.
2. Architecture and request/data flow summary.
3. Setup/run commands for development and Compose.
4. Environment variables explained.
5. API endpoints and schemas.
6. Verified versus proposed MQTT topic/payload table.
7. Migration and backup/restore instructions.
8. Security notes and secrets bootstrap/rotation process.
9. Test commands and exact results.
10. Backend features still blocked by firmware/API mismatch.
11. Any frontend contract changes required and the reason for each.

Do not say "complete" if core APIs are stubs, Mosquitto is unsecured, database persistence is absent, protected routes are untested, or frontend integration is not working.

**Start now:** inspect the repository and its documentation, record the implementation plan, then implement and validate Milestone 1 before continuing sequentially. Do not ask follow-up questions; document any assumptions you had to make.
