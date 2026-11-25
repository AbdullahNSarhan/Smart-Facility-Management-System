# Codebase Structure — LCI-SFM (`2.0.0-rc.1`)

## 1. Project Root Directory Layout (`/opt/lci-sfm`)

```text
/opt/lci-sfm/
├── .dockerignore                         # Excludes secrets, DBs, git, docs, node_modules from Docker build context
├── .env                                  # [LOCAL SECRET - 0600] Active host environment & credentials (untracked)
├── .env.example                          # Tracked environment template with documented defaults & placeholders
├── .gitignore                            # Untracks node_modules, dist, .env*, DBs, backups, mosquitto secrets
├── .github/workflows/
│   └── deployment-validation.yml         # Full CI pipeline: shell/ACL checks, lint, tests, Playwright UI, Docker Compose + live Mosquitto smoke, updater rollback test
├── CHANGELOG.md                          # Release notes for 2.0.0-rc.1 and 1.1.0-rc.1
├── DEPLOYMENT-CREDENTIALS.txt            # [LOCAL SECRET - 0600] Generated initial Admin & MQTT backend credentials (untracked)
├── README.md                             # Primary project overview, quickstart, CLI commands, and implementation boundaries
├── index.html                            # SPA HTML shell, strict air-gapped CSP, local 24x24 SVG icon sprite, #app-root
├── styles.css                            # Complete local CSS design system (Dark Graphite & Light Neutral themes, responsive layouts)
├── app.js                                # Browser module entrypoint (mounts frontend/main.js + exports legacy tested helpers)
├── facility-console.js                   # [DEPRECATED / UNUSED] Legacy v1.0 single-room management UI module
├── release-console.js                    # [DEPRECATED / UNUSED] Legacy v1.1 single-page operations UI module
├── metadata.json                         # [LEGACY ARTIFACT] Old Google AI Studio scaffold metadata
├── hardware_embedded_systems_architecture_reference_lci_sfm.md   # Layer 1/2 BOM, ESP32-S3 pinout traps, 2-of-3 MFA & break-glass hardware spec
├── lci_sfm_ai_software_development_programming_concepts_guide.md # [PARTIALLY OUTDATED] Embedded C++ hints + outdated Node-RED references
├── lci_sfm_comprehensive_workflows_system_logic.md               # [PARTIALLY OUTDATED] Edge FSM & failure workflows + outdated Node-RED references
├── lci_sfm_docker_deployment_architecture.md                     # [OUTDATED] Old 4-container Node-RED + Python Vision architecture doc
├── package.json / package-lock.json      # Root workspace scripts (dev, build, lint, test, test:ui, test:load, simulate) & dependencies
├── docker-compose.yml                    # Production 3-service stack (frontend_dashboard, backend, mqtt-service)
├── docker-compose.tls.yml                # Optional Compose override adding HTTPS port 443 & TLS certs to Nginx
├── install.sh                            # Guided Q1–Q6 / --discover-only / --non-interactive Ubuntu Server installer
├── update.sh                             # Guarded online Git fast-forward updater with worktree validation, DB backup & rollback
├── install-offline.sh                    # Air-gapped offline bundle installer (SHA256SUMS + docker load)
├── update-offline.sh                     # Air-gapped offline bundle updater with backup & rollback
├── frontend/                             # Active v2.0 modular Vanilla ES frontend source
├── backend/                              # Node.js 24 backend service, SQLite migrations, MQTT client & integration tests
├── mosquitto/                            # Eclipse Mosquitto 2.0 config, ACLs, and local untracked password files
├── nginx/                                # Hardened HTTP and HTTPS Nginx reverse-proxy configs
├── deployment/                           # Validator container Dockerfile (node:24-alpine + git/bash/flock/python3)
├── scripts/                              # Host provisioning, TLS, Netplan, offline bundler, simulator, E2E & load tests
├── docs/                                 # Architecture, MQTT v1 spec, capability registry, deployment & audit docs
├── public/assets/aistudio/               # Legacy AI Studio frontend redesign prompt/plan markdown files
├── dist/                                 # [GENERATED] Vite-compiled production static frontend bundle mounted by Nginx
├── data/                                 # [LOCAL RUNTIME] Local dev/simulator SQLite directory (Docker uses sqlite_data volume)
└── backups/                              # [LOCAL SECRET - 0700] Pre-update SQLite backup snapshots (untracked)
```

---

## 2. Frontend Directory (`frontend/`)

| File | Lines | Purpose |
|---|---:|---|
| `frontend/main.js` | 14 | Applies saved theme and starts History API router on `#app-root`. |
| `frontend/router.js` | 276 | Client-side router mapping `/`, `/login`, and 13 `/app/*` routes (including parameterized room, device, and endpoint paths), enforcing auth redirects and running view/overlay cleanup hooks. |
| `frontend/api.js` | 239 | Centralized same-origin `fetch` client (`ApiError`, automatic `X-CSRF-Token` header on mutations, 401 expiry callback) wrapping `/api/*` and `/api/v1/*`. |
| `frontend/store.js` | 713 | Reactive client store, live WebSocket manager (`/ws/telemetry`, `/ws/notifications`, `/ws/mfa` with backoff), Web Audio critical alert cue, toast notifications, focus-trapped modals (`openModal`, `confirmDialog`), and slide-over drawers (`openDrawer`). |
| `frontend/utils.js` | 330 | Safe DOM builder (`el()` using `textContent`, zero `innerHTML`), SVG icon helper, age/timestamp/uptime formatters, formula-injection-safe CSV exporter, inline SVG sparkline & history trend chart builders. |
| `frontend/widgets.js` | 287 | Metadata-driven Generic Endpoint Widget Engine (`METRIC_TREND`, `BOOLEAN_STATE`, `SWITCH_CONTROL`, `ACCESS_STATE`, `CAMERA_SNAPSHOT`, `UNSUPPORTED`), including audited `MQTT_V1` switch controls, legacy Node 1/2 controls, and Blob-URL camera capture. |
| `frontend/components/ui.js` | 410 | Shared UI primitives: 6-tone `statusIndicator`, `pageHeader`, `kpiCard`, `loadingSkeleton`, `emptyState`, `errorPanel`, `disclaimerBanner`, `copyableValue`, `keyValueList`, `timelineList`, `segmentedFilter`, and `renderAdaptiveCollection` (desktop table + mobile cards). |
| `frontend/pages/shell.js` | 309 | Authenticated layout shell: collapsible grouped sidebar (`Facility`, `Monitoring`, `Administration`), mobile drawer, breadcrumbs, live stream status pill, unread notification badge, active alarm counter, theme toggle, and profile/sign-out controls. |
| `frontend/pages/landing.js` | 241 | Unauthenticated local appliance landing page (`/`) displaying architecture posture and live `/api/public/info` status. |
| `frontend/pages/login.js` | 166 | Operator login view (`/login`) with show/hide password toggle and sanitized `?next=/app/...` redirect. |
| `frontend/pages/overview.js` | 526 | Facility Command Center (`/app/overview`): KPI cards, Service Readiness Strip, Managed Rooms grid, Priority Attention Queue (alarms, quarantine, drift), and Recent Activity feed with slide-over drawer. |
| `frontend/pages/rooms.js` | 729 | Rooms directory (`/app/rooms`) and Room detail (`/app/rooms/:roomId`) with create/edit/archive/restore modals and room-to-room device move workflow. |
| `frontend/pages/devices.js` | 1,581 | Device inventory (`/app/devices`), Pending Quarantine approval queue, Guided 4-Step Device Registration/Edit Wizard, Device detail (`/app/devices/:deviceId`), and Endpoint history (`/app/devices/:deviceId/endpoints/:endpointKey`) with `1h`/`6h`/`24h`/`7d`/`All` presets and CSV export. |
| `frontend/pages/network.js` | 596 | Interactive SVG Network & Connectivity view (`/app/network`) with keyboard/click-selectable nodes, live inspector panel, and Device Connectivity Matrix. |
| `frontend/pages/operations.js` | 1,469 | Alarms & Monitoring Rules (`/app/alarms` with lifecycle drawer + numeric/boolean rule editor), Notification Center (`/app/notifications` with per-user read state & critical audio toggle), and Events & Audit Explorer (`/app/events` with slide-over record inspector & CSV export). |
| `frontend/pages/admin.js` | 1,244 | Diagnostics (`/app/diagnostics` + gated simulator scenario controls), Users & Access (`/app/users`: Dashboard Operators tab + Facility People/Credentials & RFID Reader Enrollment modal), Facility Settings (`/app/settings`), and Operator Profile (`/app/profile`). |

---

## 3. Backend Directory (`backend/`)

| File | Lines | Purpose |
|---|---:|---|
| `backend/Dockerfile` | 28 | Production image (`node:24-alpine`, `npm ci --omit=dev`, runs as `USER node`, `/api/health/live` healthcheck). |
| `backend/package.json` | 24 | Backend-only manifest used inside `backend/Dockerfile` (`dotenv`, `express`, `mqtt`, `ws`, `zod`). |
| `backend/src/server.js` | 96 | Process entrypoint; mounts Vite dev middleware or `dist/` when `SERVE_FRONTEND !== 'false'`; handles `SIGINT`/`SIGTERM`. |
| `backend/src/app.js` | 135 | `createBackendContext()` factory wiring DB, repositories, middleware, WS, MQTT, services, and Express routers; exposes `start()` and `stop()` for clean integration testing. |
| `backend/src/config/env.js` | 216 | Loads `.env`, validates IPv4/MQTT URLs/writable SQLite path, blocks simulator in production, and enforces >=24-char non-placeholder secrets when `NODE_ENV=production`. |
| `backend/src/db/database.js` | 219 | `SqliteDatabase` wrapper over `node:sqlite` (`DatabaseSync`), WAL/FK pragmas, `BEGIN IMMEDIATE` transactions, migration runner, one-time Admin bootstrap, `VACUUM INTO` hot backup, and `healthCheck()`. |
| `backend/src/db/backup.js` | 133 | CLI & programmatic SQLite backup/restore utility with `PRAGMA integrity_check` and active WAL protection. |
| `backend/src/db/migrations/*.sql` | 4 files | `001_initial_schema.sql`, `002_facility_management.sql`, `003_release_operations.sql`, `004_multi_room_platform.sql`. |
| `backend/src/middleware/auth.js` | 225 | Session cookie (`lci_sid`) + optional Bearer resolution, timing-safe `X-CSRF-Token` check, `requireAuth`, `requireAdmin`, and WebSocket upgrade authenticator. |
| `backend/src/middleware/security.js` | 153 | `X-Request-Id` context, security headers, allowlisted CORS, bounded-memory rate limiter, and structured JSON error handler (`413`, `400`, `500`). |
| `backend/src/mqtt/topics.js` | 89 | Frozen registry of `VERIFIED_FIRMWARE` (`lecf/env/telemetry`, `lecf/access/mfa_face`) and `PROPOSED_EXTENSION` (`lci/v1/devices/+/...`, `lecf/...`) topics. |
| `backend/src/mqtt/mqttClient.js` | 672 | Singleton `MqttService` with DNS retry backoff, subscription grant verification, 64 KiB payload cap, retained-frame rejection, legacy normalization, and routing to `ReleaseOperations`, `FacilityManagement`, and `CommandCoordinator`. |
| `backend/src/repositories/sqliteRepository.js` | 632 | Data access for `system_users` (secret-free projections, last-admin guard), `sessions` (SHA-256 token verifiers, idle/absolute TTL), `access_logs`, `camera_events`, `environmental_telemetry` (with time-bucket rollups), `system_errors`, and `command_audit`. |
| `backend/src/services/releaseOperations.js` | 1,962 | Core v2 domain engine: `facilities`, `rooms`, `device_registry`, `device_endpoints`, `device_endpoint_state`, `pending_devices`, manifest drift, HTTP JSON probe, numeric/boolean `alarm_rules` & `alarms`, `MQTT_V1` `device_commands`, scoped `notifications`, 1s `tick()`, and retention cleanup. |
| `backend/src/services/facilityManagement.js` | 262 | Shared 3-node settings (`facility_settings`), `people`, `physical_credentials` (RFID masking, scrypt PINs), `operators`, `management_audit`, and 45s RFID reader enrollment FSM (`reader_enrollment_sessions`). |
| `backend/src/services/commandCoordinator.js` | 503 | Legacy actuator command dispatcher (`EMERGENCY_DOOR_UNLOCK`, `TOGGLE_HVAC_FAN`, `TOGGLE_AUX_LIGHT`, `SET_CONTROL_MODE`), correlating `/ack` and telemetry feedback. |
| `backend/src/services/cameraSnapshot.js` | 41 | SSRF-bounded private-LAN JPEG proxy (`4s` timeout, `2 MiB` cap, no redirects, `FFD8..FFD9` validation). |
| `backend/src/routes/operationsRoutes.js` | 406 | `/api/v1` router for release, capabilities, overview, diagnostics, facility, rooms, registry, pending-devices, rules, alarms, notifications, retention, and simulator. |
| `backend/src/routes/managementRoutes.js` | 68 | `/api/v1` router for legacy settings, baseline devices, node3 snapshot, people, credentials, operators, management-audit, commands, and enrollment-sessions. |
| `backend/src/routes/apiRoutes.js` | 499 | `/api` router for health (`live`, `ready`), `public/info`, `auth/*`, allowlisted `logs/:table`, `telemetry/aggregate`, legacy `command`, `provision/user`, and `users/{role,delete}`. |
| `backend/src/validators/*.js` | 3 files | Zod schemas: `schemas.js` (core/legacy HTTP & MQTT), `managementSchemas.js` (RFC1918 IP, settings, people, RFID/PIN, enrollment), `operationsSchemas.js` (rooms, generic endpoints, `MQTT_V1` frames/heartbeats/ACKs, alarm rules). |
| `backend/src/websocket/wsServer.js` | 182 | `WsGateway` managing `/ws/telemetry`, `/ws/notifications`, `/ws/mfa` channels, 256 KB backpressure eviction, and session revocation disconnects. |
| `backend/src/utils/crypto.js` | 68 | `scrypt` (`N=16384, r=8, p=1`) secret hashing, `timingSafeEqual` verification, 256-bit opaque token generation, and SHA-256 session verifier hashing. |
| `backend/src/utils/logger.js` | 76 | Structured JSON stdout/stderr logger with recursive key-based secret redaction (`password`, `pin`, `token`, `cookie`, partial `rfid` masking). |
| `backend/test/*.test.js` | 4 files | 65 integration tests: `backend.test.js`, `management.test.js`, `operations.test.js`, `multiroom.test.js`. |

---

## 4. Infrastructure, Scripts & Secret Locations

### Scripts (`scripts/`)
- `provision-mqtt-device.sh`: Host CLI managing per-device `mosquitto/passwd` entries, ACL checks, SIGHUP reload, and one-time credential files.
- `configure-static-ip.sh`: Ubuntu Netplan static IPv4 generator with ARP conflict check and `netplan try` rollback.
- `setup-local-tls.sh`: Generates 4096-bit local Root CA and 2048-bit SAN server certificate in `nginx/certs/`.
- `build-offline-bundle.sh`: Packages `dist/`, `backend/`, configs, scripts, and optional Docker OCI `.tar.gz` images with `SHA256SUMS`.
- `simulator.mjs`: Standalone loopback demo server (`127.0.0.1:3101`) using isolated SQLite DB `data/simulator/lci_sfm.sqlite`.
- `ui-release-smoke.mjs`: Headless Playwright E2E test across all routes, viewports (`1440`/`768`/`390`/`360`), RBAC, and air-gap request check.
- `load-test.mjs`: Scale benchmark (20 rooms, 100 devices, 500 endpoints, 10,000 frames, 20 WS clients, 25 concurrent API clients).
- `ci-mqtt-contract-smoke.mjs` & `ci-device-v1-smoke.mjs`: CI-gated (`LCI_SIMULATOR_CI_ONLY=1`) live-Mosquitto integration tests.

### Sensitive / Secret Locations (Never Disclose Values)
1. `/opt/lci-sfm/.env` (`0600`): Contains `LCI_BOOTSTRAP_ADMIN_PASSWORD` and `MQTT_PASSWORD` (`lci_backend` broker secret).
2. `/opt/lci-sfm/DEPLOYMENT-CREDENTIALS.txt` (`0600`): Generated by `install.sh` on initial install with initial Admin and MQTT backend credentials.
3. `/opt/lci-sfm/mosquitto/passwd` (`0600`): Hashed Mosquitto passwords for `lci_backend`, `node1_access`, `node2_env`, `vision_service`, and provisioned v1 devices.
4. `/opt/lci-sfm/mosquitto/device-credentials.txt` (`0600`): Generated by `install.sh` containing initial plaintext MQTT passwords for the 4 baseline identities.
5. `/opt/lci-sfm/mosquitto/provisioned-credentials/<device_id>.cred` (`0600`, created on demand by `provision-mqtt-device.sh`): One-time plaintext device MQTT credentials (**Warning:** directory is not currently in `.gitignore` — see `TECHNICAL_DEBT_AND_ISSUES.md`).
6. `/opt/lci-sfm/nginx/certs/local-ca.key` & `server.key` (`0600`, created when local TLS is enabled): Private TLS keys.
7. `/opt/lci-sfm/backups/*.db` (`0600`) & Docker volume `sqlite_data` (`/app/data/lci_sfm.db`): Contain `scrypt` password/PIN hashes, SHA-256 session verifiers, RFID UIDs, and operational audit logs.
