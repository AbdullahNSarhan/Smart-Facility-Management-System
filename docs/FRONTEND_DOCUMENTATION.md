# LCI-SFM Frontend Documentation

> **Project:** Light Current Infrastructure for Smart Facility Management  
> **Component:** Browser-based BMS/HMI Operations Console  
> **Implementation:** HTML, CSS, vanilla JavaScript ES modules (zero external CDNs/icon libraries)  
> **Primary backend:** Node.js / Express HTTP API + WebSocket Gateway (`/api/*`, `/ws/*`), backed by SQLite (WAL) and MQTT  
> **Operating model:** Local-network / air-gapped-oriented deployment

This document describes the frontend as implemented in `index.html`, `styles.css`, and `app.js`, alongside its integration with the Node.js backend (`backend/src/`) and Nginx reverse proxy (`docker-compose.yml`, `nginx/nginx.conf`).

## Contents

1. [Scope and architecture](#1-scope-and-architecture)
2. [Frontend files](#2-frontend-files)
3. [Running the frontend](#3-running-the-frontend)
4. [Network configuration](#4-network-configuration)
5. [Application views](#5-application-views)
6. [Live data and status logic](#6-live-data-and-status-logic)
7. [API and WebSocket contract](#7-api-and-websocket-contract)
8. [Authentication and roles](#8-authentication-and-roles)
9. [Commands and physical-system safety](#9-commands-and-physical-system-safety)
10. [Audit explorer and CSV export](#10-audit-explorer-and-csv-export)
11. [Deployment notes](#11-deployment-notes)
12. [Security considerations](#12-security-considerations)
13. [Backend capabilities and remaining boundaries](#13-backend-work-still-required)
14. [Validation and troubleshooting](#14-validation-and-troubleshooting)

---

## 1. Scope and architecture

The frontend provides one operator interface for the project's three edge nodes and central services.

- **Node 1 — Smart access:** RFID, keypad PIN, the face/RFID/PIN 2-out-of-3 MFA workflow, door-state monitoring, and magnetic-lock actuation.
- **Node 2 — Environmental monitoring:** temperature, relative humidity, smoke/gas readings, auxiliary-light state, and fan/light relays.
- **Node 3 — Biometric camera:** PIR-triggered camera wake/capture and direct JPEG snapshot endpoint (`http://<ip_node3>/capture.jpg`).
- **Central services:** The Node.js/Express backend handles authentication, RBAC, CSRF enforcement, REST endpoints, WebSocket streams (`/ws/telemetry`, `/ws/mfa`), MQTT broker integration, and SQLite persistence.

The browser application consumes central HTTP and WebSocket endpoints and requests camera snapshots directly from Node 3. It does not implement the node firmware, MQTT broker, SQLite database, or biometric engine.

### High-level flow

```text
Operator's browser
  index.html + styles.css + app.js
       | HTTP: /api/auth/*, /api/logs/*, /api/telemetry/aggregate, /api/command, /api/provision/user, /api/users/*, /api/health/*
       | WebSocket: /ws/telemetry and /ws/mfa
       v
Nginx Reverse Proxy (in Docker) / Vite Dev Middleware
       |
       v
Node.js Central Backend (Express + ws) <----> SQLite (WAL)
       |
       +---- MQTT broker <----> Node 1 / Node 2 / Node 3
       |
       +---- Direct LAN HTTP (Browser <----> http://<ip_node3>/capture.jpg)
```

## 2. Frontend files

| File | Responsibility |
|---|---|
| `index.html` | Application shell, login overlay, six views, tables, chart canvases, modals, and form controls |
| `styles.css` | Dark/light design tokens, status styles, panels, layout, responsive behavior, focus styles, reduced motion |
| `app.js` | Authentication flow, browser state, WebSocket consumers, API calls, charts, table filters, commands, and diagnostics |
| `package.json` | npm scripts and project dependency metadata |
| `docker-compose.yml` | Current Nginx frontend container configuration |

The main frontend uses native HTML/CSS and JavaScript modules. Although `package.json` contains React, Vite, Tailwind, and other dependencies, the current dashboard is not implemented as a React application.

### Design system

The stylesheet uses CSS custom properties to keep dark and light themes consistent.

- **Dark canvas:** `#090e17`
- **Dark panel:** `#111a2b`
- **Dark borders:** `#1e293b`
- **Light canvas:** `#f1f5f9`
- **Light surfaces:** `#ffffff`
- **Primary accent:** cyan/blue
- **Nominal:** emerald
- **Warning/stale:** amber
- **Critical/offline:** rose/crimson
- **Unknown/unverified:** slate

Status meaning must remain explicit in text; color is supplementary. The CSS includes focus-visible styles, responsive breakpoints, and a reduced-motion rule.

## 3. Running the frontend

### Development server

Requirements: Node.js/npm compatible with the versions in `package.json`.

```bash
git clone https://github.com/AbdullahNSarhan/Smart-Facility-Management-System.git
cd Smart-Facility-Management-System
npm install
npm run dev
```

The `dev` script runs `node backend/src/server.js`, which starts the Express + SQLite + WebSocket backend on port 3000 and mounts Vite middleware to serve the frontend from the same origin.

### Lint / test / build / preview

```bash
npm run lint
npm test
npm run build
npm run preview
```

- `npm run lint` runs `node --check` on `app.js` and the backend modules.
- `npm test` runs the Node.js integration test suite (`backend/test/backend.test.js`).
- `npm run build` generates the production static bundle in `dist/`.
- `npm run preview` serves the production build locally.

### Docker / Nginx

The root `docker-compose.yml` builds the multi-stage `Dockerfile`:
- `backend`: runs the Node.js/Express + SQLite service on internal port 3000.
- `frontend`: runs Nginx on port 8080 (`${FRONTEND_PORT:-8080}:80`), serving only the built `dist/` static bundle and reverse-proxying same-origin `/api/` and `/ws/` requests to `backend:3000`.

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
docker compose down
```

## 4. Network configuration

The frontend uses these defaults:

| Setting | Default | Use |
|---|---|---|
| `server_host` | `window.location.host` (fallback `192.168.43.225:1880`) | Central HTTP API (`/api/*`) and WebSocket (`/ws/*`) host |
| `ip_node1` | `192.168.43.11` | Smart access controller (ESP32 Node 1) |
| `ip_node2` | `192.168.43.12` | Environmental controller (ESP32 Node 2) |
| `ip_node3` | `192.168.43.13` | Biometric camera controller (ESP32-CAM Node 3, direct LAN `http://<ip_node3>/capture.jpg`) |

- **Legacy Host Auto-Migration:** If `localStorage.getItem('lci_server_host')` contains the exact legacy Node-RED value `192.168.43.225:1880` and the dashboard is served from a different browser origin (`window.location.host`), the frontend automatically migrates `lci_server_host` to `window.location.host`. Intentional custom hosts (such as a separate LAN appliance IP/port) and all three edge-node IPs (`ip_node1`, `ip_node2`, `ip_node3`) are preserved untouched.
- **Reset to Current Host:** The Login screen, Quick Endpoint Modal, and View 6 Network Configuration form each provide a **Use this dashboard's server / Use Current Host** action to reset `server_host` to `window.location.host` without altering `ip_node1`, `ip_node2`, or `ip_node3`.
- **Protocol Construction:** When `server_host === window.location.host`, HTTP and WebSocket URLs automatically match `window.location.protocol` (`http:`/`https:` and `ws:`/`wss:`).

## 5. Application views

### View 1 — Overview & Command Center

Purpose: quickly assess overall data freshness, the latest environmental state, and the connection condition of central services and edge nodes.

Includes:
- Facility-status banner.
- Door/lock, temperature, humidity, smoke/gas, fan, light, MFA, and connectivity cards.
- Small real-time temperature and humidity sparklines.
- Layer 3 central appliance and Layer 1 edge-node topology.
- Hardware command panel.
- Recent activity feed.

The initial page should report an unknown/awaiting state before valid telemetry arrives. Initial zero values are not evidence that sensors are healthy.

### View 2 — Smart Access & Security

Includes:
- Door reed-switch and fail-safe lock state.
- Three checkpoints: face, RFID card, and PIN.
- 2-out-of-3 MFA state and countdown.
- Node 3 camera snapshot and capture status.
- Recent access/biometric log preview.

The documented MFA window is 10 seconds. The actual decision to grant access belongs to the edge/backend workflow, not to a browser-only calculation.

The Node 3 capture URL is `http://<ip_node3>/capture.jpg`. This node may legitimately sleep until its PIR sensor triggers; a failed snapshot request alone does not prove why it failed. The interface therefore distinguishes capture success from standby/unreachable status, but device diagnosis still requires physical/network verification when necessary.

### View 3 — Environment & Actuator Control

Includes:
- Environmental gauges and numeric readings.
- Temperature and humidity history charts.
- A live 30-sample FIFO source.
- A source that loads up to the latest 30 records from the `environmental_telemetry` API response.
- A visible dependency notice for the 24-hour/7-day aggregation option.
- AUTO/MANUAL mode controls and fan/light overrides.

The temperature chart marks the documented 30 °C fan threshold. The status evaluation treats temperature above 30 °C as an elevated condition. Smoke/gas values from 250 PPM to below 400 PPM are shown as elevated and values at or above 400 PPM as critical in the frontend logic. Confirm the calibration, units, environmental sensor validity, and operating thresholds with the actual hardware/backend before using these values as a safety instrument.

### View 4 — SQLite Audit Log & Event Explorer

Available log tables:
- `access_logs`
- `camera_events`
- `environmental_telemetry`
- `system_errors`

The page offers keyword search, time-window and outcome/severity filters, sortable columns, page sizes of 10/25/50, a JSON-style record inspector, data-provenance status, and CSV export of the currently filtered dataset.

These filters and pagination operate in the browser on the rows returned by the API. They do not replace server-side filtering or pagination for very large databases.

### View 5 — System Health & Device Diagnostics

Displays REST/WebSocket condition and evidence-based statuses for the central service, Node 1, Node 2, and Node 3.

Current evidence rules are heuristic UI indicators, not a substitute for a dedicated heartbeat API:

- **Central service:** based on WebSocket status and recent successful HTTP requests.
- **Node 1:** based on door/MFA events received through the current streams; event silence can mean an idle node rather than a failed node.
- **Node 2:** based on recent environmental frames and telemetry-stream connectivity.
- **Node 3:** based on the last camera probe/capture result; the documented PIR-driven sleep behavior means the node may be in standby without recent captures.

A separate periodic heartbeat payload per controller would make these indicators more authoritative.

### View 6 — Administration

Visible only when the session is both role-Admin and server-verified in the frontend.

Includes:
- User provisioning and credential/biometric linking.
- Administrator username/password change form.
- Server and node endpoint configuration.
- User-directory listing.
- User role change and deletion actions, with confirmation dialogs.

The frontend masks credential fields in the visible directory. The backend should not return PINs or password hashes when the UI does not need them.

## 6. Live data and status logic

### Telemetry freshness

The frontend records the browser receipt time for incoming telemetry. The overall telemetry display considers a frame fresh for up to 10 seconds. After that, it marks the last known reading stale. This is a browser-side freshness heuristic based on receive time, not a timestamp guaranteed by the sensor.

The frontend also tracks the state of `/ws/telemetry` and `/ws/mfa` independently. The Command Center summarizes whether both, one, or neither WebSocket is connected, with HTTP reachability contributing to partial connectivity.

### Facility status thresholds

The current UI logic uses the following conditions after at least one telemetry frame has been received:

| Condition | UI interpretation |
|---|---|
| No telemetry received | Status unknown / awaiting first packet |
| Smoke/gas (geq 400) PPM | Critical smoke/gas alert |
| Smoke/gas (geq 250) and below 400 PPM | Warning / elevated smoke-gas condition |
| Temperature (> 30.0 ^circmathrm{C}) | Warning / temperature threshold active |
| Telemetry WebSocket offline or latest telemetry older than 10 seconds | Telemetry interrupted / stale readings |
| Non-empty current system-error collection | Warning condition |
| Otherwise, fresh stream and nominal readings | Nominal status |

The visual banner evaluates critical smoke/gas before the stale-stream condition. This makes the last received high reading remain visible as critical even when telemetry is interrupted. Operators must still treat a stale reading as uncertain and follow real-site procedures.

These are display rules. They do not themselves implement sensor calibration, alarm detection on the hardware, or the physical fail-safe circuit.

### Device status caveat

Node-specific states are inferred from the available evidence and expected data cadence. They are not cryptographic proof that a device is operational. In particular:
- Node 1 can be idle between events.
- Node 3 may be asleep by design.
- Node 2's telemetry cadence is expected to be approximately 2 seconds per the architecture reference.

The server should expose explicit last-seen timestamps/heartbeat payloads if accurate device health monitoring is required.

### Charts

- Live mode stores up to 30 temperature samples and up to 30 humidity samples in browser memory.
- SQLite-history mode fetches the `environmental_telemetry` table and plots up to its latest 30 records.
- The 24h/7d rollup option currently shows a dependency notice; it does not fetch an aggregate endpoint or produce time-bucketed data.

Refreshing the page resets the in-memory live FIFO. Historical availability depends on what the backend table endpoint returns.

## 7. API and WebSocket contract

The following table documents the interface the frontend expects. The route names are taken from the current frontend code, not independently verified against a running Node-RED server.

### HTTP API

| Method | Route | Expected purpose / request |
|---|---|---|
| `POST` | `/api/auth/login` | Body: `{ "username": "...", "password": "..." }`. Successful JSON must include a non-empty `token`; the UI reads `role` and `username`. HTTP 401/403 means credentials are rejected. |
| `GET` | `/api/logs/access_logs` | Returns access log rows |
| `GET` | `/api/logs/camera_events` | Returns camera-event rows |
| `GET` | `/api/logs/environmental_telemetry` | Returns persisted environmental telemetry rows |
| `GET` | `/api/logs/system_errors` | Returns system error/fault rows |
| `GET` | `/api/logs/system_users` | Returns operator-directory data; should omit secrets entirely |
| `POST` | `/api/command` | Body includes `command`, `state`, `ip_node1`, `ip_node2`, `ip_node3` |
| `POST` | `/api/provision/user` | Provisions an operator. The current UI sends `username`, `password`, `role`, `rfid`, `pin`, and `face_linked`; validate and transform this input securely on the server. |
| `POST` | `/api/auth/admin-profile` | Updates administrator identity/credential data |
| `POST` | `/api/users/role` | Body includes the target user ID and the requested role (`Admin` or `Viewer`). |
| `POST` | `/api/users/delete` | Body: `{ "id": <userId> }` |

Authenticated requests send the browser-held session value as `Authorization: Bearer <token>`. The backend must validate the token and independently authorize each protected operation. Frontend checks are not an authorization boundary.

### Hardware command values

The frontend allowlist contains the following command names:

| Command | States used by the current UI |
|---|---|
| `EMERGENCY_DOOR_UNLOCK` | `OPEN` or `CLOSED` |
| `TOGGLE_HVAC_FAN` | `ON` or `OFF` |
| `TOGGLE_AUX_LIGHT` | `ON` or `OFF` |
| `SET_CONTROL_MODE` | `AUTO` or `MANUAL` |

The command dialog displays the target controller, endpoint, and intended payload for consequential actions. An HTTP 2xx response is treated as a backend acknowledgement; it is not proof that the physical relay or lock reached the intended state. The backend should return a clear structured result and, where possible, the UI should verify the resulting state via telemetry or an explicit controller response.

### WebSockets

| Socket | Purpose | Payload fields used by the frontend |
|---|---|---|
| `ws://<server_host>/ws/telemetry` | Live environmental and current facility state | `temperature` or `temp`, `humidity`, `smoke_gas_level`, `light_state`, `door_state`, `fan_relay`, optionally `node` |
| `ws://<server_host>/ws/mfa` | Smart-access/MFA state | `mfa_status`, `isFacePassed`, `isCardPassed`, `isPinPassed` |

The frontend accepts `door_state` as `OPEN`/`CLOSED`, `light_state` and `fan_relay` as `ON`/`OFF), and the MFA states `IDLE`, `AWAITING_STAGE2`, and `UNLOCKED`. Confirm naming, types, and units against the deployed flows and firmware.

### Camera

`GET http://<ip_node3>/capture.jpg` returns the snapshot expected by the browser. The frontend adds a cache-busting query parameter when requesting a new frame. Browser same-origin and Content Security Policy rules may need to allow the configured local endpoint.

## 8. Authentication and roles

### Verified session flow

1. Operator submits username and password.
2. The browser sends them to `POST /api/auth/login`.
3. On success, the frontend requires a non-empty token and stores the session token, role, operator identity, and verification flag in `sessionStorage`.
4. A verified Admin can access hardware commands and the administrative view.
5. A server rejection is not converted into a local login.

### Unverified read-only inspection mode

When the authentication service cannot be reached, the user may explicitly enter read-only inspection mode. The UI marks this session as unverified and assigns Viewer-level presentation. Privileged commands and administrative configuration are disabled.

This is intended for inspection only; it does not make cached data current or trustworthy. The frontend must not be used to issue hardware commands from this mode.

### Important boundary

The browser's role flag only controls what the interface presents. Node-RED/backend handlers must check the authentication token, role, permissions, allowed command values, input types, and applicable operating rules on every sensitive request.

The frontend submits credentials for server-side validation; it does not itself prove that the backend's password hashing, token generation, token expiry, rate limiting, or session revocation is implemented securely. These must be reviewed in the backend.

## 9. Commands and physical-system safety

The UI validates command names against an allowlist, checks endpoint formatting, requests confirmation for consequential actions, and reports success only after an HTTP-success response is received.

A network response means the backend acknowledged a request. It does not guarantee:
- that a controller received the command;
- that a relay physically switched;
- that a magnetic lock actually unlocked;
- that the door opened; or
- that an emergency condition is resolved.

For production use, the backend should correlate a command with a controller result or later telemetry. Physical emergency egress must remain independent of frontend/browser availability, in accordance with the documented hardwired break-glass design and local safety requirements.

## 10. Audit explorer and CSV export

Search, time filtering, status/severity classification, sorting, and pagination occur on the rows currently held by the browser. CSV export uses the current filtered records and escapes quotes according to standard CSV quoting rules.

The CSV contains the row fields returned to the browser. Therefore:
- Do not include unnecessary secrets in the API response.
- Enforce role-based visibility on the server, not only in the table renderer.
- For large datasets, implement server-side filtering, pagination, and export rather than requiring the browser to fetch every row.
- Check exported data for personal or biometric information before sharing it.

## 11. Deployment notes

The intended overall appliance architecture is documented in `lci_sfm_docker_deployment_architecture.md`. The current Compose file is more limited: it starts only Nginx and mounts the repository root.

For safer deployment:
1. Build the static frontend with `npm run build`.
2. Configure Nginx to serve only the intended output assets.
3. Do not publish Markdown architecture documents, `.env` files, source metadata, or other repository files as public static content.
4. Configure the backend and its authentication policy separately.
5. Keep the dashboard and device endpoints on the intended network.
6. Verify the Content Security Policy against only the local origins actually required.
7. Do not expose Node-RED editor/admin interfaces to untrusted networks.

The architecture document describes a four-service target (Mosquitto, Node-RED/SQLite, Python vision service, and frontend), but these services are not all defined in the current root `docker-compose.yml`. Treat that document as intended architecture and verify the actual deployment files before claiming a one-command full-stack deployment.

## 12. Security considerations

- **Secrets:** mask sensitive values in UI and, preferably, omit them from APIs entirely. Masking a value after it reaches the browser is not sufficient.
- **Authentication:** use suitable password hashing and secure, expiring/revocable sessions on the backend. Do not rely on client-generated session identifiers for authorization.
- **Authorization:** validate all command and user-administration permissions in Node-RED for every request.
- **Transport:** `http://` and `ws://` are unencrypted. Use only on the intended trusted LAN unless the deployment is upgraded with appropriate TLS and configuration.
- **CSP:** maintain a restrictive Content Security Policy; avoid broad allowlists or weakening controls to work around connectivity mistakes.
- **HTML injection:** escape all data originating from APIs before inserting it into dynamic table/record markup.
- **Local browser storage:** endpoint addresses and theme preferences are convenience settings, not secrets. Avoid storing passwords, PINs, or long-lived privileged credentials there.
- **Physical safety:** the frontend is an operator interface, not a safety controller. Safety-critical detection, MFA decisions, and fail-safe egress must remain enforced in the appropriate hardware/backend layers.

## 13. Backend capabilities and remaining boundaries

### Implemented in the Node.js backend (`backend/src/`)

- **Time-bucketed environment aggregation (`GET /api/telemetry/aggregate`):** Supports `range` (`1h`, `6h`, `24h`, `7d`) and `bucket` (`1m`, `5m`, `15m`, `1h`) over `environmental_telemetry`.
- **Readiness & liveness probes (`GET /api/health/live`, `GET /api/health/ready`):** Reports SQLite and MQTT readiness (`checks.sqlite`, `checks.mqtt`), surfaced in View 5 (`#diag-ready-state`).
- **Password & PIN hashing (`backend/src/utils/crypto.js`):** Uses Node's `crypto.scryptSync` (`scrypt$N$r$p$salt$key`) with timing-safe verification. Plaintext passwords, PINs, and hashes are never returned by `/api/logs/system_users`.
- **Session & CSRF protection (`backend/src/middleware/auth.js`):** Issues `HttpOnly; SameSite=Strict` session cookies (`lci_sid`), enforces `X-CSRF-Token` on cookie-authenticated mutations, and supports `Authorization: Bearer <token>` compatibility.

### Remaining hardware / architectural boundaries

- **Persistent alarm acknowledgement workflow:** `system_errors` is currently read-only (`GET /api/logs/system_errors`). Persistent alarm acknowledgement, assignment, and resolution require dedicated backend schema/routes and are not simulated in browser state.
- **Independent edge-node heartbeats:** Node 1, Node 2, and Node 3 statuses in View 5 are inferred from stream/capture evidence and clearly labeled with their evidence source. Dedicated per-node firmware heartbeats are required to distinguish an idle or PIR-sleeping controller from a powered-off device.
- **Branding scope:** The unified `LCI-SFM` shield-and-grid SVG emblem (`#icon-brand-emblem`) is rendered locally from the inline SVG sprite in `index.html`; there is no server-side logo upload or multi-client branding persistence endpoint.

## 14. Validation and troubleshooting

### Validation commands

```bash
npm run lint
npm test
npm run build
```

These verify JavaScript syntax across frontend and backend files, run the 16 automated backend API/WebSocket/RBAC/CSRF integration tests, and build the production bundle in `dist/`.

### Common issues

| Symptom | Checks |
|---|---|
| Login endpoint is unreachable | Click **Use this dashboard's server** on the Login screen to reset `server_host` to the current origin, or verify custom `server_host` reachability and CSP rules |
| Login returns 401/403 | Verify assigned credentials and server-side user record; the frontend never falls back to local Admin authentication |
| Authentication unavailable | Inspect the local network/backend; read-only inspection is unverified and cannot authorize privileged actions |
| Telemetry shows unknown or stale | Check `/ws/telemetry`, MQTT delivery, Node 2 power/network, payload field names, and the last successful packet |
| MFA stream is offline | Check `/ws/mfa` and central backend WebSocket connectivity |
| Camera capture fails | Verify the Node 3 IP (`ip_node3`), `http://<ip_node3>/capture.jpg`, browser CSP, network path, and PIR-triggered wake behavior |
| Command dispatch fails | Confirm a server-verified Admin session, valid `X-CSRF-Token`, endpoint/IP validity, `POST /api/command`, and MQTT broker status |
| Node appears stale/unknown | Current health status is inferred from evidence; check View 5 diagnostics for the specific evidence source and last-seen age |

