# LCI-SFM 2.0 — MQTT Protocol Specification (`v1`)

**Release:** `2.0.0-rc.1`  
**Broker:** Eclipse Mosquitto 2.0 over the private wired LAN (TCP `1883` by default, anonymous access disabled, per-device credentials and ACLs).

This document describes the MQTT contract currently accepted by the backend. It does not imply that an untested physical firmware implementation already publishes every frame.

## 1. Device identity and topic namespace

A v1 device ID must match `^[a-z][a-z0-9_-]{0,47}$`. It is immutable after registration. A device's MQTT username must equal that ID because the Mosquitto ACL uses `%u` to restrict the device to its own topic subtree.

| Direction | Topic | QoS | Purpose |
|---|---|---:|---|
| Device → Server | `lci/v1/devices/{device_id}/telemetry` | 0 or 1 | Validated endpoint values |
| Device → Server | `lci/v1/devices/{device_id}/heartbeat` | 0 or 1 | Liveness and optional firmware/capability announcement |
| Server → Device | `lci/v1/devices/{device_id}/command` | 1 | Correlated, expiring switch command; never retained |
| Device → Server | `lci/v1/devices/{device_id}/ack` | 1 | Command acknowledgement or resulting state |

**The current implementation has no separate manifest topic.** A device announces its capability manifest as optional `endpoints` and `capabilities` fields inside its heartbeat. The backend subscribes to heartbeat, telemetry, and ACK topics; it does not subscribe to a standalone manifest topic.

Legacy team topics (including `lecf/env/telemetry` and `lecf/access/mfa_face`) remain supported for the preloaded legacy devices.

## 2. Message contracts

### 2.1 Heartbeat with optional capability manifest

A device may publish a heartbeat on boot and after a firmware/manifest change:

```json
{
  "schema_version": 1,
  "device_id": "lab305-env-01",
  "firmware_version": "2.0.1",
  "protocol_version": "1",
  "uptime_ms": 86400000,
  "manifest_version": "m-1",
  "capabilities": ["SENSOR"],
  "endpoints": [
    {
      "endpoint_key": "temp_c",
      "label": "Temperature",
      "kind": "SENSOR",
      "data_type": "NUMBER",
      "unit": "°C",
      "writable": false
    },
    {
      "endpoint_key": "water_leak",
      "label": "Floor Water Leak",
      "kind": "SENSOR",
      "data_type": "BOOLEAN",
      "writable": false
    }
  ]
}
```

The backend heartbeat schema accepts `schema_version`, `device_id`, and optional `firmware_version`, `protocol_version`, `boot_id`, `uptime_ms`, `manifest_version`, `capabilities`, and `endpoints`. Each endpoint announcement may include `endpoint_key`, `label`, `kind`, `data_type`, `unit`, and `writable`. Unknown fields are rejected because the payload schema is strict.

- If the device ID is not registered, the heartbeat is stored in **Pending Devices Quarantine**. The device is not automatically registered, and its telemetry is rejected until an Admin registers it.
- If the device is registered, the backend compares announced endpoint keys and supported contract fields against the approved registry. Differences are reported as manifest drift; the server does not silently rewrite the registered endpoint schema.
- A heartbeat updates device liveness. It does **not** refresh the last-seen time of sensor endpoints.

### 2.2 Telemetry frame

```json
{
  "schema_version": 1,
  "device_id": "lab305-env-01",
  "boot_id": "boot-94a2",
  "seq": 42,
  "values": {
    "temp_c": 23.8,
    "water_leak": false
  }
}
```

The accepted frame fields are `schema_version`, `device_id`, `boot_id`, `seq`, and `values`. Do not add a top-level timestamp unless the backend schema is explicitly extended.

**Server validation rules:**
- The payload `device_id` must match the ID in the topic.
- `boot_id` identifies a device boot session; `seq` is a non-negative integer.
- Duplicate, replayed, or out-of-order frames are rejected.
- The device must already exist in the approved registry and must be enabled/not archived.
- Every key in `values` must reference a registered endpoint and every value must match its declared capability/data type. A frame with an unknown or invalid endpoint key is rejected as a contract mismatch.
- Accepted endpoint values update their own freshness timestamp and are persisted as observations/history.

The currently accepted telemetry value types are finite numbers, booleans, and the supported state strings (`ON`, `OFF`, `OPEN`, `CLOSED`, `LOCKED`, `UNLOCKED`), subject to the endpoint validator.

### 2.3 Switch command

The server publishes a non-retained command to `.../command`:

```json
{
  "schema_version": 1,
  "command_id": "6e4210c8-b8d8-4c15-9fa6-c5ac653fef01",
  "device_id": "lab305-env-01",
  "endpoint_key": "exhaust_fan",
  "value": "ON",
  "issued_at": "2026-11-24T12:01:00.000Z",
  "expires_at": "2026-11-24T12:01:05.000Z"
}
```

Only registered, enabled, fresh `MQTT_V1` devices with an approved writable `SWITCH` endpoint and a supported command profile can be controlled through this generic command path. Door/access release is not a generic switch command.

### 2.4 Command acknowledgement

The device publishes to `.../ack`:

```json
{
  "schema_version": 1,
  "device_id": "lab305-env-01",
  "command_id": "6e4210c8-b8d8-4c15-9fa6-c5ac653fef01",
  "status": "EXECUTED",
  "observed_value": "ON"
}
```

Accepted `status` values are `ACKNOWLEDGED`, `EXECUTED`, and `REJECTED`. `observed_value` is optional and, for an executed switch command, must match the requested value. An acknowledgement is correlated by command ID, device ID, and expiry. A state report is evidence reported by the device; it is not independent proof of physical actuation.

Edge firmware should discard expired commands, deduplicate command IDs, and retain all local hardware safety interlocks. The broker ACL and backend do not make an unsafe device actuation safe.

## 3. Per-device credentials and ACL provisioning

The backend container does not receive root privileges, the Docker socket, or write access to `mosquitto/passwd`. Provision device credentials on the host:

```bash
# The username must be exactly the same as the device ID.
sudo ./scripts/provision-mqtt-device.sh add --device-id lab305-env-01 --username lab305-env-01

# Rotate a device password.
sudo ./scripts/provision-mqtt-device.sh rotate --device-id lab305-env-01 --username lab305-env-01

# Revoke the device identity.
sudo ./scripts/provision-mqtt-device.sh revoke --device-id lab305-env-01

# List provisioned identities (passwords are never displayed).
sudo ./scripts/provision-mqtt-device.sh list

# Verify the broker ACL contract.
sudo ./scripts/provision-mqtt-device.sh verify-acl
```

The one-time credential file is written under `mosquitto/provisioned-credentials/` with restrictive permissions. Deliver that credential securely to the corresponding device; do not put it in the dashboard, source control, or logs.

After provisioning, register the device in the console and update its MQTT identity status to `PROVISIONED`. Provisioning a broker password alone does not register a device or authorize its endpoints.
