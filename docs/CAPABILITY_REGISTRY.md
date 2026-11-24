# LCI-SFM 2.0 — Generic Capability & Endpoint Registry

**Release:** `2.0.0-rc.1`

---

## 1. Design goal and boundary

The generic endpoint engine reuses shared validation, persistence, freshness, history, alarm evaluation, and UI widgets for the endpoint contracts listed below. A new device can be registered without a new page only when it fits an already implemented capability, data type, and transport adapter.

This does **not** mean arbitrary hardware, new transports, or new endpoint capabilities work automatically. A new capability/transport requires backend validation, an adapter, command/safety policy where applicable, and matching UI/test coverage.

## 2. Implemented endpoint kinds and data types

The endpoint schema currently accepts these combinations:

| Endpoint `kind` | Accepted `data_type` | Writable | Default widget | User-configurable alarm rules |
|---|---|---|---|---|
| `SENSOR` | `NUMBER` | No | `METRIC_TREND` — numeric value, unit, freshness, and history | `THRESHOLD_HIGH`, `THRESHOLD_LOW` |
| `SENSOR` | `BOOLEAN` | No | `BOOLEAN_STATE` — explicit true/false state and freshness | `BOOLEAN_TRUE`, `BOOLEAN_FALSE` |
| `SWITCH` | `ENUM` or `BOOLEAN` | Yes, only with supported MQTT switch command profile | `SWITCH_CONTROL` — Admin command controls and reported state; Viewer read-only | No switch-specific rule type |
| `ACCESS` | `ENUM` | No through the generic switch command path | `ACCESS_STATE` — door/lock state | No user-configurable access rule type |
| `CAMERA` | `MEDIA` or `BOOLEAN` | No | `CAMERA_SNAPSHOT` — authenticated JPEG capture/preview when configured for camera transport | No camera-specific rule type |

The database migration may contain older values for compatibility, but new device/endpoint payloads are validated by the current Zod schemas. Do not assume that `STRING`, `ENUM` sensor values, or arbitrary custom data types are currently ingestible for all endpoint kinds.

The `UNSUPPORTED` widget is a safe rendering fallback; it is not a promise that the backend accepts an unknown capability or data type.

## 3. Transport profiles

| Transport | Direct IPv4 required? | Current behavior |
|---|---|---|
| `MQTT_V1` | No | Devices publish telemetry/heartbeat/ACK; backend publishes non-retained switch commands |
| `HTTP_JSON_V1` | Yes, private LAN IPv4 | Bounded manual JSON probe; read-only unless a future adapter is implemented |
| `CAMERA_JPEG` | Yes, private LAN IPv4 | Authenticated backend JPEG snapshot proxy |
| `LEGACY_V1` | Depends on the legacy device integration | Preserves the preloaded legacy device/topic adapters |

The registry does not configure a physical device's IP address. Changing a registered address changes the server-side destination record only.

## 4. Freshness states

Freshness is based on the endpoint's last accepted observation, not the device heartbeat:

- **ONLINE/FRESH:** a validated endpoint value has been received within the device's configured `stale_after_s`.
- **STALE:** a prior validated value exists, but it is older than the configured freshness window.
- **UNKNOWN:** no validated endpoint value has been received yet, or transport status is unavailable.
- **DISABLED/ARCHIVED:** the device is administratively disabled or archived.

A heartbeat updates device liveness and firmware/manifest metadata; it does not make old sensor readings fresh. The current endpoint API exposes the last accepted time as `last_seen_at`.

## 5. Alarm behavior

User-defined alarm rules are supported only for `SENSOR` endpoints:

- `NUMBER`: high threshold (`THRESHOLD_HIGH`) or low threshold (`THRESHOLD_LOW`) with a recovery threshold.
- `BOOLEAN`: alert while true (`BOOLEAN_TRUE`) or while false (`BOOLEAN_FALSE`).

Rules also support severity, raise dwell, recovery dwell, acknowledgement history, and recovery evidence. Stale-device monitoring is generated separately by the system; it is not an enum/STALE condition that an operator adds as an endpoint rule. `SWITCH`, `ACCESS`, and `CAMERA` do not currently support user-configurable endpoint alarm rules.

## 6. Onboarding a device

1. Create the destination Room in **Rooms**.
2. For an MQTT v1 device, provision a broker identity on the server. The username must equal the immutable device ID:

   ```bash
   sudo ./scripts/provision-mqtt-device.sh add --device-id lab305-env-01 --username lab305-env-01
   ```

3. Configure the device with the one-time credential file written under `mosquitto/provisioned-credentials/`.
4. Have it publish a heartbeat containing its identity and optional `capabilities`/`endpoints` announcement to `lci/v1/devices/{id}/heartbeat`.
5. Unknown device IDs appear in **Devices → Pending Quarantine**. An Admin must explicitly register the device and its approved endpoints before telemetry is accepted. An announcement never changes the approved schema automatically.
6. Confirm the device's MQTT identity status in Device Detail and verify fresh endpoint observations.

For non-MQTT transports, use the appropriate registered private destination address and its transport adapter. A compatible endpoint definition alone does not create a new transport implementation.
