-- 001_initial_schema.sql
-- LCI-SFM Versioned SQLite Schema (All timestamps in ISO-8601 UTC)

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('Admin', 'Viewer')) DEFAULT 'Viewer',
  password_hash TEXT NOT NULL,
  pin_verifier TEXT,
  pin_configured INTEGER NOT NULL DEFAULT 0 CHECK (pin_configured IN (0, 1)),
  rfid TEXT NOT NULL,
  face_linked INTEGER NOT NULL DEFAULT 0 CHECK (face_linked IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  provisioning_status TEXT NOT NULL DEFAULT 'stored_pending_edge_sync',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_system_users_role_enabled ON system_users(role, enabled);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_verifier TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT,
  ip_address TEXT,
  FOREIGN KEY (user_id) REFERENCES system_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_verifier ON sessions(token_verifier);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS access_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  node_id TEXT NOT NULL DEFAULT 'node1',
  boot_id TEXT,
  seq INTEGER,
  username TEXT,
  modality TEXT NOT NULL,
  event TEXT NOT NULL,
  status TEXT NOT NULL,
  mfa_status TEXT,
  details TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_access_logs_dedup
  ON access_logs(node_id, boot_id, seq)
  WHERE boot_id IS NOT NULL AND seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_access_logs_timestamp ON access_logs(timestamp DESC);

CREATE TABLE IF NOT EXISTS camera_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  node_id TEXT NOT NULL DEFAULT 'node3',
  boot_id TEXT,
  seq INTEGER,
  event TEXT NOT NULL,
  user_id TEXT,
  status TEXT NOT NULL,
  confidence REAL,
  details TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_camera_events_dedup
  ON camera_events(node_id, boot_id, seq)
  WHERE boot_id IS NOT NULL AND seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_camera_events_timestamp ON camera_events(timestamp DESC);

CREATE TABLE IF NOT EXISTS environmental_telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  node_id TEXT NOT NULL DEFAULT 'env_02',
  boot_id TEXT,
  seq INTEGER,
  temperature REAL NOT NULL,
  humidity REAL NOT NULL,
  smoke_gas_level INTEGER NOT NULL DEFAULT 0,
  light_state TEXT NOT NULL CHECK (light_state IN ('ON', 'OFF')) DEFAULT 'OFF',
  fan_relay TEXT NOT NULL CHECK (fan_relay IN ('ON', 'OFF')) DEFAULT 'OFF',
  door_state TEXT NOT NULL CHECK (door_state IN ('OPEN', 'CLOSED')) DEFAULT 'CLOSED'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_env_telemetry_dedup
  ON environmental_telemetry(node_id, boot_id, seq)
  WHERE boot_id IS NOT NULL AND seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_env_telemetry_timestamp_ms ON environmental_telemetry(timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS idx_env_telemetry_timestamp ON environmental_telemetry(timestamp DESC);

CREATE TABLE IF NOT EXISTS system_errors (
  error_id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  source_node TEXT NOT NULL,
  error_code TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'ERROR',
  error_description TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_system_errors_timestamp ON system_errors(timestamp DESC);

CREATE TABLE IF NOT EXISTS command_audit (
  command_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  actor_user_id INTEGER,
  actor_username TEXT NOT NULL,
  command TEXT NOT NULL,
  requested_state TEXT NOT NULL,
  target_node TEXT NOT NULL,
  mqtt_topic TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL CHECK (
    lifecycle_state IN ('rejected', 'unavailable', 'published', 'acknowledged', 'state_confirmed', 'failed', 'timed_out')
  ),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  acknowledged_at TEXT,
  confirmed_at TEXT,
  error_code TEXT,
  details TEXT,
  FOREIGN KEY (actor_user_id) REFERENCES system_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_command_audit_issued_at ON command_audit(issued_at DESC);
