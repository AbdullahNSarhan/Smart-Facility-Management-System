# LCI-SFM Frontend Documentation

> **Project:** Light Current Infrastructure for Smart Facility Management  
> **Component:** Browser-based BMS/HMI Operations Console  
> **Implementation:** HTML, CSS, vanilla JavaScript ES modules  
> **Primary backend:** Node-RED HTTP API + WebSockets, backed by SQLite  
> **Operating model:** Local-network / air-gapped-oriented deployment

This document describes the frontend as implemented in the repository. API paths and payloads below describe the contract the current frontend expects; they should be checked against the deployed Node-RED flows before being treated as a guarantee of backend behavior.

**Backend migration:** The proposed next phase moves the central API/workflow role from Node-RED to Node.js while preserving the UI contract where practical. See [Backend Architecture](BACKEND_ARCHITECTURE.md) for the target service design and [Backend Implementation Prompt](BACKEND_IMPLEMENTATION_PROMPT.md) for staged coding-agent instructions. The routes documented here are the frontend's current expectations, not proof that the replacement backend has been implemented.

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
13. [Backend work still required](#13-backend-work-still-required)
14. [Validation and troubleshooting](#14-validation-and-troubleshooting)

---

## 1. Scope and architecture

The frontend provides one operator interface for the project's three edge nodes and central services.

- **Node 1 — Smart access:** RFID, keypad PIN, the face/RFID/PIN 2-out-of-3 MFA workflow, door-state monitoring, and magnetic-lock actuation.
- **Node 2 — Environmental monitoring:** temperature, relative humidity, smoke/gas readings, auxiliary-light state, and fan/light relays.
- **Node 3 — Biometric camera:** PIR-triggered camera wake/capture and JPEG snapshot endpoint.
- **Central services:** Node-RED handles HTTP endpoints and application logic; MQTT carries node telemetry/commands; SQLite persists operational records; a Python/OpenCV service handles face recognition.

The browser application consumes central HTTP and WebSocket endpoints and requests camera snapshots from Node 3. It does not implement the node firmware, MQTT broker, SQLite database, or biometric engine.

### High-level flow

```text
Operator's browser
  index.html + styles.css + app.js
       | HTTP: authentication, logs, commands, admin
       | WebSocket: telemetry and MFA
       v
Node-RED / API and automation flows <----> SQLite
       |
       +---- MQTT broker <----> Node 1 / Node 2 / Node 3
       |
       +---- Python/OpenCV vision service <---- Node 3 JPEG capture
```

This describes the intended integration. Confirm the currently deployed backend flows and actual node firmware before relying on a path or operational behavior.

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

The `dev` script runs Vite on port 3000 and binds to `0.0.0.0`. Use the URL shown by Vite. To access from another computer, ensure port 3000 is reachable and the browser can reach the configured backend and camera endpoints.

### Lint / build / preview

```bash
npm run lint
npm run build
npm run preview
```

- `npm run lint` runs `node --check app.js`; this is a syntax check, not a complete linter or automated test suite.
- `npm run build` generates the production static bundle in `dist/`.
- `npm run preview` serves the production build locally.
- `npm run clean` removes `dist/` and `server.js`.

### Docker / Nginx

The current Compose file publishes port 80 and mounts the repository root read-only at Nginx's document root.

```bash
docker compose up -d
docker compose ps
docker compose logs -f frontend_dashboard
docker compose down
```

**Important:** the current Compose file only deploys the frontend. It does not start Node-RED, Mosquitto, SQLite, the Python/OpenCV service, or edge-node firmware. Before a production deployment, configure Nginx to expose only the intended public frontend files (normally the built `dist/` contents) instead of mounting the entire repository root.

## 4. Network configuration

The frontend uses these defaults:

| Setting | Default | Use |
|---|---|---|
| `server_host` | `192.168.43.225:1880` | Node-RED HTTP API and WebSocket host |
| `ip_node1` | `192.168.43.11` | Smart access controller |
| `ip_node2` | `192.168.43.12` | Environmental controller |
| `ip_node3` | `192.168.43.13` | Biometric camera controller |

These values are local-installation defaults, not a guarantee that devices exist at those addresses. The browser stores the chosen endpoint values in `localStorage` under `lci_server_host`, `ip_node1`, `ip_node2`, and `ip_node3`.

The central server can be adjusted on the login screen. The administrator endpoint settings provide access to the server and node IP fields for a verified Admin.

The frontend constructs HTTP endpoints using `http://<server_host>` and WebSocket endpoints using `ws://<server_host>`. The Content Security Policy in `index.html` also restricts where requests and images may connect. If the installation moves to an address range not included in the policy, update the policy deliberately and narrowly along with the endpoint configuration.

Because the current addresses use plain HTTP/WebSocket, this design should remain on its intended trusted local network unless transport protection and the required CSP changes have been implemented.

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

## 13. Backend work still required

The current frontend deliberately exposes some backend dependencies instead of presenting them as implemented features.

### Time-bucketed environment aggregation

The rollup selector for 24-hour/7-day trends does not call an aggregate endpoint. Add an authenticated, parameter-validated endpoint such as:

`GET /api/telemetry/aggregate?range=24h&bucket=15m`

The backend should constrain supported ranges/buckets, use appropriate indexes, return timestamps and aggregate fields consistently, and enforce permissions. Example response shape:

```json
{
  "range": "24h",
  "bucket": "15m",
  "series": [
    {
      "timestamp": "2026-10-22T12:00:00Z",
      "temperature_avg": 25.4,
      "temperature_min": 24.9,
      "temperature_max": 26.1,
      "humidity_avg": 48.3,
      "sample_count": 8
    }
  ]
}
```

This is a **proposed contract**, not an endpoint currently implemented by the frontend/backend.

### Persistent alarm workflow

The current frontend can display rows from `system_errors`, but persistent acknowledgement, assignment, resolution, and escalation require backend data and routes. A proper implementation should define a status lifecycle, who can change it, audit metadata, and append-only history as appropriate. Do not simulate acknowledgement with browser-only state.

### Independent node heartbeat

The current frontend infers node health from the streams and device evidence available to it. Add explicit per-node heartbeat messages with node identity, sequence/counter, timestamp or uptime, firmware/version details if needed, and health flags. Node 3's planned sleep states need to be distinguished from a failed or unreachable camera.

### Credential API minimization

The user-directory UI masks PIN/password-related values, but the backend should not return `pin`, `password`, or `password_hash` unless a narrowly defined, justified use requires it. Prefer a boolean such as `pin_configured` and a separately maintained credential status. Never transmit plaintext passwords or PINs in a user-list response.

### Operational command acknowledgement

Define the command API's response schema and distinguish request receipt, dispatch, controller acknowledgement, and confirmed hardware state. The frontend currently treats HTTP 2xx as acknowledgement from Node-RED, not proof of physical actuation.

## 14. Validation and troubleshooting

### Validation commands

```bash
npm run lint
npm run build
```

These check JavaScript syntax and the Vite production build. They do not test the real hardware, deployed API permissions, WebSocket schema, CSS layouts at every viewport, or browser accessibility conformance.

### Common issues

| Symptom | Checks |
|---|---|
| Login endpoint is unreachable | Confirm `server_host`, browser-to-server routing, Node-RED availability, port 1880, and firewall/CSP rules |
| Login returns 401/403 | Verify assigned credentials and server-side user record; the frontend intentionally does not fall back to local Admin authentication |
| Authentication unavailable | Inspect the local network/backend; read-only inspection is unverified and cannot authorize privileged actions |
| Telemetry shows unknown or stale | Check `/ws/telemetry`, the Node-RED flow, MQTT delivery, Node 2 power/network, payload field names, and the last successful packet |
| MFA stream is offline | Check `/ws/mfa` and the Node-RED subscription/forwarding flow |
| Camera capture fails | Verify the Node 3 address, endpoint, browser CSP, network path, camera status, PIR-triggered wake behavior, and the returned image |
| Command dispatch fails | Confirm a server-verified Admin session, endpoint/IP validity, `POST /api/command`, the allowlisted command/state, and backend logs |
| Historical chart has few points | The frontend plots at most 30 returned SQLite rows; multi-day bucketed aggregation requires backend support |
| Node appears stale/unknown | Current health status is inferred from evidence; implement dedicated per-node heartbeat data for stronger diagnosis |
| Nginx exposes repository material | Replace the repository-root mount with a build-output-only mount and verify the served file list |

---

## Implementation status summary

**Implemented in the frontend:** the six views, theme and responsive styling, read-only inspection fallback, browser-side status/freshness presentation, live FIFO charts, recent SQLite history mode, client-side audit explorer, CSV export, confirmation/detail modals, endpoint configuration, and command/admin API calls.

**Not implemented solely by the frontend:** SQLite schema and migrations, backend authentication and authorization internals, real alarm acknowledgement/escalation, multi-day telemetry aggregation, authoritative device heartbeats, controller-side command acknowledgements, hardware firmware behavior, and physical safety interlocks.

This distinction is deliberate: the dashboard should communicate its data and capability limits instead of implying unverified system behavior.
