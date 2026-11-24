# LCI-SFM 2.0 — Local-First Architecture

**Release:** `2.0.0-rc.1`

---

## 1. System Topology

```text
  [ Wired LAN Operator Workstations ]
                |
                | HTTP (80) or Local HTTPS (443) + Same-Origin WebSockets (/ws/telemetry, /ws/mfa)
                v
  +---------------------------------------------------------+
  | frontend_dashboard (nginx:1.27-alpine)                  |
  | - Serves compiled local dist/ SPA bundle (zero CDN)     |
  | - History API fallback -> /index.html                   |
  | - Reverse proxies /api/* and /ws/* -> backend:3000      |
  +---------------------------------------------------------+
                | Internal Docker Bridge (lci_internal)
                v
  +---------------------------------------------------------+
  | backend (Node.js 24, non-root, no-new-privileges)       |
  | - Express REST API (/api/*, /api/v1/*)                  |
  | - Session/Cookie/CSRF/RBAC Security Layer               |
  | - Multi-Room & Generic Endpoint Engine                  |
  | - Pending Device Quarantine & Drift Detector            |
  | - Stateful Alarm & Notification Engine                  |
  | - Authenticated Camera JPEG Proxy (SSRF-bounded)        |
  | - WebSocket Telemetry & Event Gateway                   |
  +--------------------------+------------------------------+
             |               |
   SQLite WAL Volume         | Authenticated MQTT (lci_backend)
   (/app/data/lci_sfm.db)    v
  +---------------------------------------------------------+
  | mqtt-service (eclipse-mosquitto:2.0)                    |
  | - Anonymous disabled; per-device passwd + ACL           |
  | - Bound to configured LAN IP (default 127.0.0.1)        |
  +---------------------------------------------------------+
                ^
                | Wired Ethernet / PoE (CAT6)
  +---------------------------------------------------------+
  | Edge Devices (Room Controllers, Sensors, Access Nodes)  |
  | - Retain autonomous local safety logic                  |
  +---------------------------------------------------------+
```

---

## 2. Dynamic Facility Data Hierarchy

LCI-SFM 2.0 models any physical building cleanly via normalized SQLite tables (Migrations `001`–`004`):

1. **Facility** (`facility_settings`): Global site name, contact/timezone metadata, revision counter, and legacy fallback compatibility.
2. **Rooms** (`rooms`): Logical zones (`room_id`, `room_code`, `name`, `building`, `floor`, `status: ACTIVE | ARCHIVED`, `description`, `revision`).
3. **Devices** (`device_registry`): Physical or virtual nodes assigned to a `room_id`, with immutable `device_id`, `device_type`, `transport` (`MQTT_V1`, `HTTP_JSON_V1`, `CAMERA_JPEG`, `LEGACY_MQTT`), optional private IPv4 (required only for HTTP/Camera transports), `stale_after_s`, `protocol_version`, `manifest_hash`, `manifest_drift`, and `maintenance_until`.
4. **Endpoints** (`device_endpoints`): Generic functional points per device (`endpoint_key`, `label`, `kind`, `data_type`, `unit`, `readable`, `writable`, `command_profile`, `allowed_values`, `retention_enabled`, `last_value`, `last_reported_at`, `stale_after_s`).
5. **Time-Series & Frames** (`device_frames`, `endpoint_observations`): Append-only validated telemetry history with per-endpoint freshness timestamps and indexed lookups for fast range queries.
6. **Onboarding Quarantine** (`pending_devices`): Unregistered devices announcing manifests on MQTT are quarantined for Admin review (`PENDING` → `APPROVED` / `REJECTED` / `IGNORED`) without polluting active room telemetry.
7. **MQTT Identity Ledger** (`mqtt_identities`): Tracks broker username, topic prefix, and provisioning status per device (never stores plaintext broker passwords).
8. **Alarms & Notifications** (`alarm_rules`, `alarms`, `alarm_events`, `notifications`, `notification_reads`): Server-evaluated stateful alarm engine supporting numeric (`GREATER_THAN`, `LESS_THAN`), boolean (`EQUALS_BOOLEAN`), enum (`EQUALS_ENUM`), and `STALE` conditions, plus per-user scoped notifications.

---

## 3. Frontend Multi-Page Architecture

The browser application (`/frontend/*`, bundled locally via Vite into `/dist`) uses zero external frameworks or CDNs and implements History API deep-linking:

- **Public Routes:**
  - `/` — Local Facility Landing Page (host capabilities, architecture overview, sign-in entry).
  - `/login` — Dedicated Same-Origin Login Page with safe relative `redirect` validation.
- **Authenticated Operations Shell (`/app/*`):**
  - `/app/overview` — Multi-room KPI summary, active alarm posture, room health grid, live feed.
  - `/app/rooms` & `/app/rooms/:roomId` — Room directory, create/edit/archive modals, room-scoped device cards and endpoint widgets.
  - `/app/devices`, `/app/devices/:deviceId`, `/app/devices/:deviceId/endpoints/:endpointKey` — Fleet directory, Pending Quarantine approval queue, Manifest Drift alerts, Endpoint Manager, Generic Widget Engine, MQTT Identity helper command preview, and deep-linked SVG time-series history view.
  - `/app/alarms` — Active/acknowledged/resolved incidents, rule editor (numeric & boolean), acknowledgement timeline.
  - `/app/notifications` — Per-user unread badge, scoped inbox, mark-read & mark-all snapshot.
  - `/app/events` — Unified audit, command, and access event explorer with client-side CSV export.
  - `/app/diagnostics` — Live `/api/health/ready` & `/api/v1/diagnostics` telemetry, SQLite WAL status, MQTT broker state, WebSocket connectivity, and simulator controls (when enabled).
  - `/app/users` *(Admin)* — Dashboard accounts (`system_users`), people directory, physical credentials.
  - `/app/settings` *(Admin)* — Shared facility profile and optimistic concurrency revision checks.
  - `/app/profile` — Current operator session details, theme preference (`dark` Industrial Graphite default / `light` Neutral), and password change.

---

## 4. Health & Readiness Semantics

| Endpoint | Purpose | HTTP 200 Condition | HTTP 503 Condition |
|---|---|---|---|
| `GET /api/health/live` | Docker container healthcheck | Backend process is running and event loop responds | Process unreachable |
| `GET /api/health/ready` | Deployment & diagnostics operational readiness | SQLite healthy (`WAL`, `foreign_keys=1`) **and** (`MQTT_ENABLED=false` with `mqtt.state="standby"`, OR `MQTT_ENABLED=true` with `mqtt.connected=true` and `mqtt.subscriptions_ready=true`) | SQLite error, enabled MQTT disconnected, or subscriptions not ready |
