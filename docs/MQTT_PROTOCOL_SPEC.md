# LCI-SFM 2.0 — MQTT Protocol Specification (`v1`)

**Release:** `2.0.0-rc.1`  
**Transport:** Eclipse Mosquitto 2.0 over private wired LAN (TCP `1883`, anonymous disabled, per-device credentials & ACLs).

---

## 1. Topic Namespace (`lci/v1`)

Every `MQTT_V1` device is bound to a single immutable `device_id` (matching `^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$`). The Mosquitto ACL restricts each device credential exclusively to its own `lci/v1/devices/<device_id>/#` subtree.

| Direction | Topic | QoS | Purpose |
|---|---|---|---|
| Device → Server | `lci/v1/devices/{device_id}/manifest` | 1 | Self-description of device metadata and endpoints (onboarding & drift detection) |
| Device → Server | `lci/v1/devices/{device_id}/telemetry` | 0/1 | Generic endpoint values payload |
| Device → Server | `lci/v1/devices/{device_id}/heartbeat` | 0/1 | Liveness, uptime, firmware version, health status |
| Server → Device | `lci/v1/devices/{device_id}/cmd` | 1 | Correlated, expiring command dispatch |
| Device → Server | `lci/v1/devices/{device_id}/ack` | 1 | Correlated command acknowledgement & resulting state |

Legacy team topics (`lecf/env/telemetry`, `lecf/access/mfa_face`, etc.) remain supported in parallel for backward compatibility with preloaded room-001 nodes.

---

## 2. Message Contracts

### 2.1 Device Manifest (`.../manifest`)

Published on boot or firmware update. If `{device_id}` is unregistered, the backend places it in the **Pending Devices Quarantine** (`pending_devices`). If already registered, the backend hashes the manifest and flags `manifest_drift = 1` when announced endpoints diverge from the approved registry.

```json
{
  "schema_version": 1,
  "device_id": "lab305-env-01",
  "name": "Lab 305 Multi-Sensor",
  "device_type": "MIXED",
  "firmware_version": "2.0.1",
  "suggested_room_code": "LAB-305",
  "endpoints": [
    {
      "endpoint_key": "temp_c",
      "label": "Temperature",
      "kind": "SENSOR",
      "data_type": "NUMBER",
      "unit": "°C",
      "readable": true,
      "writable": false
    },
    {
      "endpoint_key": "water_leak",
      "label": "Floor Water Leak",
      "kind": "SENSOR",
      "data_type": "BOOLEAN",
      "readable": true,
      "writable": false
    },
    {
      "endpoint_key": "exhaust_fan",
      "label": "Exhaust Fan",
      "kind": "SWITCH",
      "data_type": "ENUM",
      "allowed_values": ["ON", "OFF"],
      "readable": true,
      "writable": true,
      "command_profile": "MQTT_SWITCH_V1"
    }
  ]
}
```

### 2.2 Telemetry Frame (`.../telemetry`)

```json
{
  "schema_version": 1,
  "device_id": "lab305-env-01",
  "boot_id": "boot-94a2",
  "seq": 42,
  "timestamp": "2026-11-24T12:00:00Z",
  "values": {
    "temp_c": 23.8,
    "water_leak": false,
    "exhaust_fan": "OFF"
  }
}
```

**Server validation rules:**
- `payload.device_id` MUST match the topic `{device_id}` (cross-device spoofing is rejected and audited).
- `(device_id, boot_id, seq)` replay protection rejects duplicate or stale sequence numbers within the same boot session.
- Only registered endpoints matching their declared `data_type` are persisted; unknown keys are ignored safely without crashing ingestion.
- Each updated endpoint refreshes its individual `last_reported_at` timestamp for per-endpoint freshness calculation.

### 2.3 Heartbeat (`.../heartbeat`)

```json
{
  "schema_version": 1,
  "device_id": "lab305-env-01",
  "firmware_version": "2.0.1",
  "uptime_s": 86420,
  "status": "ONLINE"
}
```

### 2.4 Command (`.../cmd`) & Acknowledgement (`.../ack`)

**Server command:**
```json
{
  "schema_version": 1,
  "command_id": "cmd-01JABC...",
  "device_id": "lab305-env-01",
  "endpoint_key": "exhaust_fan",
  "value": "ON",
  "issued_at": "2026-11-24T12:01:00Z",
  "expires_at": "2026-11-24T12:01:30Z"
}
```

**Device acknowledgement:**
```json
{
  "schema_version": 1,
  "command_id": "cmd-01JABC...",
  "device_id": "lab305-env-01",
  "endpoint_key": "exhaust_fan",
  "status": "APPLIED",
  "reported_value": "ON",
  "message": "Relay energized"
}
```

Edge devices MUST discard any command where `now > expires_at`, MUST deduplicate by `command_id`, and MUST NOT bypass local hardware safety interlocks.

---

## 3. Per-Device Credential & ACL Provisioning

The backend container never holds root privileges or writes `mosquitto/passwd`. Administrators provision or revoke device broker credentials on the host using the allowlisted CLI helper:

```bash
# Provision a new device identity & scoped ACL block (generates random password, reloads Mosquitto)
sudo ./scripts/provision-mqtt-device.sh add --device-id lab305-env-01 --username dev_lab305_env_01

# Rotate password for an existing device
sudo ./scripts/provision-mqtt-device.sh rotate --device-id lab305-env-01 --username dev_lab305_env_01

# Revoke access and remove ACL block
sudo ./scripts/provision-mqtt-device.sh revoke --device-id lab305-env-01 --username dev_lab305_env_01

# List managed device blocks
sudo ./scripts/provision-mqtt-device.sh list
```

After running the host command, update the device's provisioning status in **Devices → Device Detail → MQTT Identity** (`PUT /api/v1/registry/:deviceId/mqtt-identity`).
