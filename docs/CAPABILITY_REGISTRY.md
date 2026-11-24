# LCI-SFM 2.0 — Generic Capability & Endpoint Registry

**Release:** `2.0.0-rc.1`

---

## 1. Design Goal

Adding a new sensor, relay, contact switch, power meter, or camera to LCI-SFM requires **zero custom frontend pages, zero custom API routes, and zero hardcoded backend device logic**. Every device exposes one or more **Endpoints** defined by orthogonal `kind` (capability) and `data_type` metadata.

---

## 2. Capability (`kind`) vs. Data Type (`data_type`)

| Endpoint `kind` | Supported `data_type` | Writable | Default UI Widget (`frontend/widgets.js`) | Supported Alarm Conditions |
|---|---|---|---|---|
| `SENSOR` | `NUMBER` | No | `METRIC_TREND` — live numeric readout, unit, freshness badge, local SVG sparkline, deep-link to history chart | `GREATER_THAN`, `LESS_THAN`, `STALE` |
| `SENSOR` | `BOOLEAN` | No | `BOOLEAN_STATE` — explicit binary indicator (`ACTIVE` / `NORMAL` or `TRUE` / `FALSE`) + freshness | `EQUALS_BOOLEAN`, `STALE` |
| `SENSOR` | `ENUM` / `STRING` | No | `METRIC_TREND` / state tile — discrete value readout + freshness | `EQUALS_ENUM`, `STALE` |
| `SWITCH` | `ENUM` (`["ON","OFF"]`) or `BOOLEAN` | Yes (`MQTT_SWITCH_V1`) | `SWITCH_CONTROL` — reported state + Admin command buttons with correlation toast; Viewer sees read-only state | `EQUALS_ENUM`, `EQUALS_BOOLEAN`, `STALE` |
| `ACCESS_STATE` | `ENUM` / `STRING` | Optional (door profile) | `ACCESS_STATE` — door/lock/MFA state indicator + timestamp | `EQUALS_ENUM`, `STALE` |
| `CAMERA_SNAPSHOT` | `BINARY_IMAGE` | No | `CAMERA_SNAPSHOT` — authenticated backend JPEG capture button + modal/preview | `STALE` |
| `STATUS` | `STRING` / `ENUM` / `BOOLEAN` | No | `BOOLEAN_STATE` or compact status indicator | `EQUALS_ENUM`, `EQUALS_BOOLEAN`, `STALE` |
| *(Unknown / Future)* | *(Any)* | No | `UNSUPPORTED` — safe generic fallback displaying raw value, type badge, and last reported time | `STALE` |

---

## 3. Transport Profiles

| Transport | Network IP Required? | Telemetry Ingestion | Command Path |
|---|---|---|---|
| `MQTT_V1` | **No** (`ip` may be empty) | Push via `lci/v1/devices/{id}/telemetry` & `heartbeat` | `lci/v1/devices/{id}/cmd` + `ack` |
| `HTTP_JSON_V1` | **Yes** (Private RFC1918 IPv4 only) | Manual bounded diagnostic/poll (`POST /api/v1/devices/:id/probe`) | Read-only unless paired with command profile |
| `CAMERA_JPEG` | **Yes** (Private RFC1918 IPv4 only) | On-demand authenticated backend JPEG proxy (`GET /api/v1/devices/:id/snapshot`) | Read-only capture |
| `LEGACY_MQTT` | Optional (preserved for preloaded team nodes) | Existing `lecf/*` topic mapping | Legacy allowlisted command coordinator |

---

## 4. Per-Endpoint Freshness States

Every endpoint tracks its own `last_reported_at` timestamp independently of device-level heartbeats:

- **FRESH:** `now - last_reported_at <= effective_stale_after_s` (endpoint override or device default `stale_after_s`).
- **STALE:** `now - last_reported_at > effective_stale_after_s` (rendered explicitly in amber; never silently shown as live).
- **UNKNOWN:** Endpoint has never reported a validated value since registration (rendered neutrally; never defaults to `0`, `OFF`, or `CLOSED`).

---

## 5. Adding a New Device Without Writing Code

1. Create or choose a Room in **Rooms** (`/app/rooms`).
2. Provision a scoped MQTT identity on the host (`sudo ./scripts/provision-mqtt-device.sh add ...`).
3. Either:
   - Have the device publish its `lci/v1/devices/{id}/manifest` frame and click **Approve** in **Devices → Pending Quarantine**, **or**
   - Register the device manually in **Devices → Register Device** and add its endpoints.
4. Immediately view live widgets inside `/app/rooms/:roomId` and `/app/devices/:deviceId`, inspect historical curves at `/app/devices/:deviceId/endpoints/:endpointKey`, and attach numeric or boolean alarm rules in **Alarms** (`/app/alarms`).
