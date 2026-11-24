-- Additive migration 004: Multi-Room Facility Domain Model, Generic Endpoint Metadata,
-- Per-Endpoint Freshness State, and Pending Device Manifest Quarantine.
-- Preserves 100% of existing accounts, sessions, settings, devices, telemetry, alarms, and audit logs.

CREATE TABLE facilities (
  facility_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE rooms (
  room_id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(facility_id),
  room_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  building TEXT NOT NULL DEFAULT '',
  floor TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(facility_id, room_code)
);
CREATE INDEX idx_rooms_facility_status ON rooms(facility_id, status);

INSERT OR IGNORE INTO facilities (
  facility_id, name, description, location, timezone, version, created_at, updated_at
) VALUES (
  'facility-default',
  COALESCE((SELECT json_extract(document, '$.facility_name') FROM facility_settings WHERE id = 1), 'LCI Smart Facility'),
  'Local-first on-premises smart facility',
  '',
  'UTC',
  1,
  COALESCE((SELECT updated_at FROM facility_settings WHERE id = 1), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  COALESCE((SELECT updated_at FROM facility_settings WHERE id = 1), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT OR IGNORE INTO rooms (
  room_id, facility_id, room_code, name, description, building, floor, status, version, created_at, updated_at
) VALUES (
  'room-001',
  'facility-default',
  'ROOM-001',
  COALESCE((SELECT json_extract(document, '$.room_name') FROM facility_settings WHERE id = 1), 'Smart Room 001'),
  'Primary facility room migrated from single-room baseline',
  '',
  '',
  'ACTIVE',
  1,
  COALESCE((SELECT updated_at FROM facility_settings WHERE id = 1), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  COALESCE((SELECT updated_at FROM facility_settings WHERE id = 1), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Extend device_registry additively for dynamic room assignment, archiving, manifests, and MQTT-only devices.
ALTER TABLE device_registry ADD COLUMN room_id TEXT DEFAULT NULL REFERENCES rooms(room_id);
UPDATE device_registry SET room_id = 'room-001' WHERE room_id IS NULL;
ALTER TABLE device_registry ADD COLUMN archived_at TEXT;
ALTER TABLE device_registry ADD COLUMN protocol_version TEXT NOT NULL DEFAULT '1';
ALTER TABLE device_registry ADD COLUMN capability_manifest_version TEXT;
ALTER TABLE device_registry ADD COLUMN manifest_json TEXT;
ALTER TABLE device_registry ADD COLUMN mqtt_identity_status TEXT NOT NULL DEFAULT 'UNPROVISIONED'
  CHECK(mqtt_identity_status IN ('UNPROVISIONED','PROVISIONED','LEGACY','NOT_APPLICABLE'));

UPDATE device_registry
SET mqtt_identity_status = CASE
  WHEN transport = 'LEGACY_V1' THEN 'LEGACY'
  WHEN transport IN ('HTTP_JSON_V1', 'CAMERA_JPEG') THEN 'NOT_APPLICABLE'
  ELSE 'UNPROVISIONED'
END;

DROP INDEX IF EXISTS idx_device_address;
CREATE UNIQUE INDEX idx_device_address
  ON device_registry(ip, port)
  WHERE enabled = 1 AND archived_at IS NULL AND ip != '';

CREATE INDEX idx_device_registry_room ON device_registry(room_id, enabled, archived_at);

-- Extend device_endpoints additively to separate capability (kind) from data_type and range/display metadata.
ALTER TABLE device_endpoints ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE device_endpoints ADD COLUMN data_type TEXT NOT NULL DEFAULT 'NUMBER'
  CHECK(data_type IN ('NUMBER','BOOLEAN','ENUM','MEDIA','STRING'));
ALTER TABLE device_endpoints ADD COLUMN readable INTEGER NOT NULL DEFAULT 1 CHECK(readable IN (0,1));
ALTER TABLE device_endpoints ADD COLUMN retention_enabled INTEGER NOT NULL DEFAULT 1 CHECK(retention_enabled IN (0,1));
ALTER TABLE device_endpoints ADD COLUMN min_value REAL;
ALTER TABLE device_endpoints ADD COLUMN max_value REAL;
ALTER TABLE device_endpoints ADD COLUMN allowed_values_json TEXT;
ALTER TABLE device_endpoints ADD COLUMN display_config_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE device_endpoints ADD COLUMN command_profile TEXT;
ALTER TABLE device_endpoints ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

UPDATE device_endpoints
SET
  data_type = CASE
    WHEN kind = 'SWITCH' THEN 'ENUM'
    WHEN kind = 'ACCESS' THEN 'ENUM'
    WHEN kind = 'CAMERA' THEN 'MEDIA'
    ELSE 'NUMBER'
  END,
  allowed_values_json = CASE
    WHEN kind = 'SWITCH' THEN '["ON","OFF"]'
    WHEN kind = 'ACCESS' THEN '["OPEN","CLOSED","LOCKED","UNLOCKED"]'
    ELSE NULL
  END,
  command_profile = CASE
    WHEN kind = 'SWITCH' AND writable = 1 THEN 'MQTT_SWITCH_V1'
    ELSE NULL
  END;

-- Track per-endpoint latest validated observation and freshness independently of heartbeat.
CREATE TABLE device_endpoint_state (
  device_id TEXT NOT NULL REFERENCES device_registry(device_id) ON DELETE CASCADE,
  endpoint_key TEXT NOT NULL,
  last_value_json TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  boot_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (device_id, endpoint_key)
);
CREATE INDEX idx_endpoint_state_seen ON device_endpoint_state(device_id, last_seen_at DESC);

-- Quarantine unregistered MQTT devices announcing heartbeats/manifests until Admin review.
CREATE TABLE pending_devices (
  device_id TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  firmware_version TEXT,
  protocol_version TEXT,
  manifest_version TEXT,
  manifest_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','DISMISSED')),
  reviewed_by TEXT,
  reviewed_at TEXT
);
CREATE INDEX idx_pending_devices_status ON pending_devices(status, last_seen_at DESC);

-- Extend alarm_rules to support boolean sensors and low thresholds in addition to numeric high thresholds.
ALTER TABLE alarm_rules ADD COLUMN condition_type TEXT NOT NULL DEFAULT 'THRESHOLD_HIGH'
  CHECK(condition_type IN ('THRESHOLD_HIGH','THRESHOLD_LOW','BOOLEAN_TRUE','BOOLEAN_FALSE'));
