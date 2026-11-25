# API, WebSocket & MQTT Integration Map — LCI-SFM (`2.0.0-rc.1`)

## 1. Security & Transport Conventions

- **Origin & Base Paths:** Served from same origin via Nginx (`/` → static SPA, `/api/*` → Express `apiRoutes.js`, `/api/v1/*` → Express `operationsRoutes.js` + `managementRoutes.js`, `/ws/*` → `WsGateway`).
- **Session Cookie:** `lci_sid` (`HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` when `SESSION_SECURE_COOKIE=true`).
- **CSRF Header:** Every state-changing request (`POST`, `PUT`, `PATCH`, `DELETE`) authenticated via cookie **must** send `X-CSRF-Token: <csrfToken>` matching the server session.
- **Correlation Header:** Every HTTP response includes `X-Request-Id` and JSON `request_id`.
- **Body Limit:** `64kb` JSON payload cap (`413 PAYLOAD_TOO_LARGE` above limit).

---

## 2. Complete HTTP REST API Reference

### 2.1 Public & Health Endpoints (`/api/*` — `backend/src/routes/apiRoutes.js`)

| Method | Path | Auth | Rate Limit | Purpose & Response Summary |
|---|---|---|---|---|
| `GET` | `/api/health/live` | Public | None | Container liveness probe (`200 { ok: true, status: "live", uptime_seconds }`). |
| `GET` | `/api/health/ready` | Public | None | Operational readiness (`200` when SQLite WAL+FK ok AND enabled MQTT connected+subscribed; otherwise `503 { status: "degraded" }`). Includes `sqlite`, `mqtt`, and `websocket` stats. |
| `GET` | `/api/public/info` | Public | None | Safe landing metadata (`version`, `deployment_mode`, `simulation`, `database_ok`). |
| `POST` | `/api/auth/login` | Public | 15 / min / IP+user | Verifies `scrypt` password, creates `sessions` row, sets `lci_sid` cookie, returns `{ ok, authenticated, user, csrfToken, expiresAt }`. |
| `POST` | `/api/auth/logout` | Optional Session + CSRF | None | Revokes SQLite session, disconnects session WebSockets, clears `lci_sid` cookie. |
| `GET` | `/api/auth/session` | `requireAuth` | None | Returns active `{ authenticated: true, user: { id, username, role }, csrfToken }`. |

### 2.2 Multi-Room, Generic Registry, Alarms & Notifications (`/api/v1/*` — `operationsRoutes.js`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/release` | `requireAuth` | Release version (`2.0.0-rc.1`), stage, simulation flag, supported adapters, `retention_days`, `monitoring_error`. |
| `GET` | `/api/v1/capabilities` | `requireAuth` | Returns `CAPABILITY_REGISTRY` (supported `capability`, `data_type`, `widget`, `writable`, `alarm_eligible`). |
| `GET` | `/api/v1/overview` | `requireAuth` | Consolidated KPI summary: `facility`, active `rooms`, `device_summary`, `active_alarms`, `pending_devices`, `unread_notifications`, `recent_notifications`, `recent_alarms`, `health`. |
| `GET` | `/api/v1/diagnostics` | `requireAuth` | Deep system posture: uptime, `sqlite`, `mqtt`, `websocket`, safe `deployment_summary`, `pending_devices_count`, per-device/per-endpoint freshness array. |
| `GET` | `/api/v1/facility` | `requireAuth` | Returns `facility-default` profile and room counts (`total_rooms`, `active_rooms`, `archived_rooms`). |
| `PUT` | `/api/v1/facility` | `requireAdmin` | Updates facility `name`, `description`, `location`, `timezone` with optimistic `version` check (syncs legacy `facility_settings`). |
| `GET` | `/api/v1/rooms` | `requireAuth` | Lists rooms enriched with `device_counts`, `active_alarms`, and `environmental_summary`. Query: `status` (`ACTIVE`\|`ARCHIVED`), `search`. |
| `POST` | `/api/v1/rooms` | `requireAdmin` | Creates room (`room_code`, `name`, `description`, `building`, `floor`). |
| `GET` | `/api/v1/rooms/:roomId` | `requireAuth` | Room detail including assigned `devices`, room `alarms`, and `recent_commands`. |
| `PUT` | `/api/v1/rooms/:roomId` | `requireAdmin` | Updates room metadata (requires matching `version`). |
| `POST` | `/api/v1/rooms/:roomId/archive` | `requireAdmin` | Archives room (rejects `room-001` or rooms with active non-archived devices). |
| `POST` | `/api/v1/rooms/:roomId/restore` | `requireAdmin` | Restores archived room to `ACTIVE`. |
| `GET` | `/api/v1/registry` | `requireAuth` | Lists devices with per-endpoint state & manifest drift. Query: `room_id`, `transport`, `search`, `include_archived`. |
| `POST` | `/api/v1/registry` | `requireAdmin` | Registers new device & endpoints; marks matching `pending_devices` record `APPROVED`. |
| `GET` | `/api/v1/registry/:id` | `requireAuth` | Single device detail with endpoints, freshness, values, manifest, and drift. |
| `PUT` | `/api/v1/registry/:id` | `requireAdmin` | Updates device & endpoints (requires matching `version`; blocks removing sensor endpoints referenced by enabled rules). |
| `POST` | `/api/v1/registry/:id/move` | `requireAdmin` | Moves device to another `ACTIVE` room (`{ room_id, version }`), preserving historical telemetry. |
| `POST` | `/api/v1/registry/:id/archive` | `requireAdmin` | Disables & archives custom device (built-in `slot` nodes cannot be archived) and resolves its open alarms. |
| `POST` | `/api/v1/registry/:id/restore` | `requireAdmin` | Restores archived device (requires target room to be `ACTIVE`). |
| `PUT` | `/api/v1/registry/:id/mqtt-identity` | `requireAdmin` | Updates `mqtt_identity_status` (`UNPROVISIONED`\|`PROVISIONED`\|`LEGACY`\|`NOT_APPLICABLE`) with `version`. |
| `POST` | `/api/v1/registry/:id/maintenance` | `requireAdmin` | Sets/clears maintenance window (`{ minutes: 0..1440, reason }`), suppressing new alarms and remote control. |
| `POST` | `/api/v1/registry/:id/probe` | `requireAdmin` | Performs bounded 3s HTTP JSON GET for `HTTP_JSON_V1` nodes (or passive status check for MQTT/Camera). |
| `GET` | `/api/v1/registry/:id/snapshot` | `requireAuth` | Proxies validated JPEG frame from registered camera LAN IP (`image/jpeg`; `409` in simulator). |
| `GET` | `/api/v1/registry/:id/history` | `requireAuth` | Latest `1..500` raw `device_frames` for a device. |
| `GET` | `/api/v1/registry/:id/endpoints/:endpointKey/history` | `requireAuth` | Time-filtered (`from`, `to`, `limit<=500`) endpoint series + `min`/`max`/`avg`/`latest` summary. |
| `GET` | `/api/v1/registry/:id/commands` | `requireAuth` | Latest 100 `device_commands` rows for the device. |
| `POST` | `/api/v1/registry/:id/commands` | `requireAdmin` | Dispatches non-retained 5s-expiring `MQTT_V1` switch command (`{ endpoint_key, value: "ON"\|"OFF" }`); returns `202`. |
| `GET` | `/api/v1/pending-devices` | `requireAdmin` | Lists quarantined MQTT heartbeat announcements (`status=PENDING\|APPROVED\|DISMISSED`). |
| `POST` | `/api/v1/pending-devices/:id/dismiss` | `requireAdmin` | Marks a quarantined device `DISMISSED`. |
| `GET` | `/api/v1/rules` | `requireAuth` | Lists sensor alarm rules (`room_id`, `device_id` filters). |
| `POST` | `/api/v1/rules` | `requireAdmin` | Creates `SENSOR` alarm rule (`THRESHOLD_HIGH`, `THRESHOLD_LOW`, `BOOLEAN_TRUE`, `BOOLEAN_FALSE`). |
| `PUT` | `/api/v1/rules/:id` | `requireAdmin` | Updates alarm rule with `version` check; resets prior active alarm for re-evaluation. |
| `GET` | `/api/v1/alarms` | `requireAuth` | Paginated/filtered alarms (`state`, `severity`, `device_id`, `room_id`, `search`, `from`, `to`, `page`, `limit`). |
| `GET` | `/api/v1/alarms/:id` | `requireAuth` | Alarm detail with `evidence` JSON and chronological `alarm_events` timeline. |
| `POST` | `/api/v1/alarms/:id/acknowledge` | `requireAdmin` | Records operator acknowledgement + audited `comment`. |
| `POST` | `/api/v1/alarms/:id/resolve` | `requireAdmin` | Resolves alarm with `comment` (blocked with `409 CONDITION_STILL_ACTIVE` if sensor/stale condition has not recovered). |
| `GET` | `/api/v1/notifications` | `requireAuth` | Role/user-scoped inbox (`unread`, `severity`, `category`, `device_id`, `room_id`, `search`, `from`, `to`, `page`, `limit`). |
| `PUT` | `/api/v1/notifications/:id/read` | `requireAuth` | Marks single scoped notification read/unread (`{ read: boolean }`). |
| `PUT` | `/api/v1/notifications/read-all` | `requireAuth` | Marks scoped notifications `id <= through_id` read for current user. |
| `GET` / `PUT` | `/api/v1/notification-preferences` | `requireAuth` | Reads/updates per-user `{ critical_sound: boolean }`. |
| `PUT` | `/api/v1/retention` | `requireAdmin` | Updates notification/frame retention (`7..365` days; default `90`). *(Not currently exposed in v2 UI.)* |
| `POST` | `/api/v1/simulator` | `requireAdmin` | Sets simulator scenario (`normal`\|`alarm`\|`offline`\|`command-failure`); returns `404` outside simulator mode. |

### 2.3 People, Credentials, Legacy Settings & Operators (`/api/v1/*` & `/api/*`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` / `PUT` | `/api/v1/settings` | Auth / `requireAdmin` | Reads/updates shared baseline `node1`/`node2`/`node3` names/IPs and display thresholds (`revision`-checked). |
| `GET` | `/api/v1/devices` | `requireAuth` | Baseline 3-node status view enriched with registry metadata. |
| `GET` | `/api/v1/devices/node3/snapshot` | `requireAuth` | Legacy Node 3 camera snapshot proxy (`image/jpeg`). |
| `GET` | `/api/v1/people` | `requireAdmin` | Paginated occupant list (`search`, `page`, `limit`) with masked credentials (`masked_uid`, `status`, `sync_status`). |
| `POST` | `/api/v1/people` | `requireAdmin` | Creates occupant (`{ display_name, reference }`). |
| `PUT` | `/api/v1/people/:id` | `requireAdmin` | Updates occupant (`display_name`, `reference`, `status: ACTIVE\|SUSPENDED`, `version`). |
| `POST` | `/api/v1/people/:id/credentials` | `requireAdmin` | Assigns `{ modality: "RFID", card_uid }` or `{ modality: "PIN", pin }` (`PENDING_DEVICE_SYNC`). |
| `PUT` | `/api/v1/credentials/:id` | `requireAdmin` | Sets credential status to `BLOCKED` or `REVOKED`. |
| `POST` | `/api/v1/people/:id/cards/enrollment-sessions` | `requireAdmin` | Arms online `RFID_ENROLL_V1`-capable Node 1 reader for 45s scan session. |
| `GET` | `/api/v1/enrollment-sessions/:id` | Initiating Admin | Polls enrollment session phase (`ARMING`/`READY`/`CANDIDATE`/`CONFIRMED`/`CANCELLED`/`EXPIRED`/`FAILED`) and `masked_uid`. |
| `POST` | `/api/v1/enrollment-sessions/:id/{confirm,cancel}` | Initiating Admin | Confirms card assignment or cancels scan session and publishes non-retained `CANCEL` to reader. |
| `POST` | `/api/v1/operators` | `requireAdmin` | Creates dashboard-only operator (`username`, `password >= 12 chars`, `role`). |
| `GET` | `/api/v1/management-audit` | `requireAdmin` | Latest 100 `management_audit` rows. |
| `GET` | `/api/v1/commands` | `requireAuth` | Latest 100 legacy `command_audit` rows. |
| `GET` | `/api/logs/:table` | `requireAuth` (`Admin` for `system_users`) | Queries allowlisted `access_logs`, `camera_events`, `environmental_telemetry`, `system_errors`, or secret-free `system_users`. |
| `GET` | `/api/telemetry/aggregate` | `requireAuth` | Legacy `environmental_telemetry` time-bucket rollup (`range=1h\|24h\|7d`, `bucket=5m\|15m\|1h`). *(Unused by v2 UI.)* |
| `POST` | `/api/command` | `requireAdmin` | Legacy actuator command (`EMERGENCY_DOOR_UNLOCK`, `TOGGLE_HVAC_FAN`, `TOGGLE_AUX_LIGHT`, `SET_CONTROL_MODE`). |
| `POST` | `/api/provision/user` | `requireAdmin` | Legacy combined operator+RFID+PIN provisioning route (`password >= 4 chars`). *(Superseded in v2 UI by `/api/v1/operators` + `/api/v1/people`.)* |
| `POST` | `/api/auth/admin-profile` | `requireAdmin` | Rotates Admin username/password. *(Bug: does not verify `currentPassword` — see `TECHNICAL_DEBT_AND_ISSUES.md`.)* |
| `POST` | `/api/users/role` | `requireAdmin` | Changes operator role (`Admin`\|`Viewer`), enforces last-Admin guard, revokes target's sessions & WS. |
| `POST` | `/api/users/delete` | `requireAdmin` | Deletes operator, enforces last-Admin guard, revokes target's sessions & WS. |

---

## 3. WebSocket Channels (`backend/src/websocket/wsServer.js`)

All 3 channels require valid session cookie authentication on HTTP `Upgrade` (`401` if unauthenticated) and disconnect with `1008` if buffered bytes exceed `256 KB`, `4001` on logout, or `4002` on user role/deletion update:

1. `/ws/telemetry`: Pushes live `{ type: "device_telemetry", device_id, room_id, timestamp, values }` (from `MQTT_V1` / HTTP probes), legacy `{ timestamp, node_id, temperature, humidity, smoke_gas_level, light_state, fan_relay, door_state }`, and `{ type: "command_ack", ... }`.
2. `/ws/notifications`: Pushes lightweight invalidation signal `{ type: "notifications_changed" }` whenever `MAX(notifications.id)` advances; clients then fetch their own role/user-scoped records via `GET /api/v1/notifications`.
3. `/ws/mfa`: Pushes `{ timestamp, node_id, isFacePassed, isCardPassed, isPinPassed, mfa_status, door_state, username }` from legacy `lecf/access/mfa_face` and `lecf/access/state`. *(Connected by `frontend/store.js`, but currently has no UI subscribers in v2 pages.)*

---

## 4. MQTT Topic & Payload Contracts (`backend/src/mqtt/`)

| Topic | Direction | QoS / Retain | Broker ACL Identity | Purpose & Payload Contract |
|---|---|---|---|---|
| `lci/v1/devices/{id}/heartbeat` | Device → Backend | QoS 0/1, `retain=false` | `%u == {id}` (`write`) | Liveness + optional capability/endpoint manifest (`schema_version: 1`, `device_id`, `firmware_version?`, `manifest_version?`, `endpoints?`). Quarantines unknown IDs; flags drift on registered IDs. |
| `lci/v1/devices/{id}/telemetry` | Device → Backend | QoS 0/1, `retain=false` | `%u == {id}` (`write`) | `{ schema_version: 1, device_id, boot_id, seq, values: { [endpoint_key]: number\|boolean\|enum } }`. Rejects unknown keys, retained frames, or duplicate/old `(boot_id, seq)`. |
| `lci/v1/devices/{id}/command` | Backend → Device | QoS 1, `retain=false` | `lci_backend` (`write`), `%u` (`read`) | `{ schema_version: 1, command_id, device_id, endpoint_key, value: "ON"\|"OFF", issued_at, expires_at }`. |
| `lci/v1/devices/{id}/ack` | Device → Backend | QoS 1, `retain=false` | `%u == {id}` (`write`) | `{ schema_version: 1, device_id, command_id, status: "ACKNOWLEDGED"\|"EXECUTED"\|"REJECTED", observed_value? }`. |
| `lecf/env/telemetry` | Node 2 → Backend | Sub QoS 0 | `node2_env` (`write`) | Legacy environmental telemetry (`node_id`, `boot_id?`, `seq?`, `temperature_c`/`temp`, `humidity_pct`, `smoke_gas_level`/`smoke`, `fan_relay`, `light_state`). |
| `lecf/access/mfa_face` | Vision → Node 1 & Backend | QoS 1 | `vision_service` (`write`), `node1_access` (`read`) | `{ status: "verified"\|"rejected"\|"failed"\|"error", user_id?, confidence?, node_id?, boot_id?, seq? }`. |
| `lecf/access/state` | Node 1 → Backend | QoS 1 | `node1_access` (`write`) | Door state & 2-of-3 MFA stage flags (`door_state`, `isFacePassed`, `isCardPassed`, `isPinPassed`, `mfa_status`). |
| `lecf/access/command` & `/ack` | Backend ↔ Node 1 | QoS 1, `retain=false` | `lci_backend` ↔ `node1_access` | Legacy `EMERGENCY_DOOR_UNLOCK` dispatch and correlated ACK. |
| `lecf/env/command` & `/ack` | Backend ↔ Node 2 | QoS 1, `retain=false` | `lci_backend` ↔ `node2_env` | Legacy `TOGGLE_HVAC_FAN`, `TOGGLE_AUX_LIGHT`, `SET_CONTROL_MODE` dispatch and correlated ACK. |
| `lecf/access/enrollment/{command,event}` | Backend ↔ Node 1 | QoS 1, `retain=false` | `lci_backend` ↔ `node1_access` | Nonce-bound 45s RFID scan `START`/`CANCEL` and `READY`/`CARD`/`FAILED` events. |
| `lecf/+/heartbeat` | Nodes → Backend | Sub QoS 0 | `node1_access`, `node2_env`, `vision_service` | Legacy node liveness & `RFID_ENROLL_V1` capability advertisement (`lecf/node1/heartbeat`). |

---

## 5. End-to-End Data Flows

1. **Telemetry Flow (`MQTT_V1`):**
   `Edge Node` → publishes JSON to `lci/v1/devices/<id>/telemetry` → `Mosquitto` verifies `%u == <id>` ACL → `MqttService.handleIncomingMessage()` rejects if `retain=true` or `>64KB` → `ReleaseOperations.ingest()` validates `frameSchema`, checks device enabled & endpoint types/ranges, rejects duplicate/replayed `(boot_id, seq)`, writes `device_frames` + `device_observations` + `device_endpoint_state` in one `BEGIN IMMEDIATE` transaction, runs `evaluateDevice()` for sensor alarm rules → `WsGateway.broadcastTelemetry()` pushes to authenticated browsers → `store.js` updates live cache/sparklines & triggers debounced page refresh.
2. **Switch Command Flow (`MQTT_V1`):**
   `Admin Browser` → confirms modal → `POST /api/v1/registry/<id>/commands` with Cookie + `X-CSRF-Token` → `ReleaseOperations.command()` checks Admin role, device enabled/not archived/not in maintenance/fresh, inserts `PUBLISHED` row into `device_commands` (`expires_at = +5s`) → `MqttService.publishCommand()` sends QoS 1 `retain=false` to `lci/v1/devices/<id>/command` → `Edge Node` replies on `/ack` → `ReleaseOperations.acknowledgeCommand()` transitions row to `ACKNOWLEDGED` or `STATE_REPORTED` (or `tick()` marks `TIMED_OUT` after 5s and raises a `COMMAND:<id>` alarm + `WARNING` notification).
3. **Notification Flow:**
   Either `ReleaseOperations.notify()` (alarms, quarantine, drift, room/device events) or **SQLite triggers** (`notify_auth`, `notify_management`, `notify_command_failure`, `notify_command_unavailable`, `notify_system_error`) insert into `notifications` → 1-second `tick()` detects `MAX(id)` change → broadcasts `{ type: "notifications_changed" }` on `/ws/notifications` → each browser calls `GET /api/v1/notifications` to pull only notifications permitted for its user/role.
