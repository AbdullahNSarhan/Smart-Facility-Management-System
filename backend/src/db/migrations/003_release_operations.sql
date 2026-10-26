CREATE TABLE device_registry (
  device_id TEXT PRIMARY KEY,
  slot TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT 'room-001',
  device_type TEXT NOT NULL CHECK(device_type IN ('SENSORS','CAMERA','ACCESS','RELAY','MIXED')),
  transport TEXT NOT NULL CHECK(transport IN ('LEGACY_V1','MQTT_V1','HTTP_JSON_V1','CAMERA_JPEG')),
  ip TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 80,
  path TEXT NOT NULL DEFAULT '/telemetry',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  stale_after_s INTEGER NOT NULL DEFAULT 90,
  version INTEGER NOT NULL DEFAULT 1,
  maintenance_until TEXT,
  maintenance_reason TEXT,
  firmware_version TEXT,
  heartbeat_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_device_address ON device_registry(ip,port) WHERE enabled=1;
CREATE TABLE device_endpoints (
  device_id TEXT NOT NULL REFERENCES device_registry(device_id),
  endpoint_key TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('SENSOR','SWITCH','CAMERA','ACCESS')),
  unit TEXT NOT NULL DEFAULT '',
  writable INTEGER NOT NULL DEFAULT 0 CHECK(writable IN(0,1)),
  PRIMARY KEY(device_id,endpoint_key)
);
CREATE TABLE device_frames (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES device_registry(device_id),
  boot_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  values_json TEXT NOT NULL,
  UNIQUE(device_id,boot_id,seq)
);
CREATE INDEX idx_frames_device_time ON device_frames(device_id,id DESC);
CREATE TABLE device_observations (
  device_id TEXT PRIMARY KEY REFERENCES device_registry(device_id),
  boot_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  last_seen_at TEXT NOT NULL,
  values_json TEXT NOT NULL
);
CREATE TABLE device_commands (
  command_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES device_registry(device_id),
  endpoint_key TEXT NOT NULL,
  requested_value TEXT NOT NULL,
  observed_value TEXT,
  state TEXT NOT NULL,
  actor TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  error TEXT
);
CREATE INDEX idx_device_commands_time ON device_commands(issued_at DESC);
CREATE TABLE alarm_rules (
  rule_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES device_registry(device_id),
  endpoint_key TEXT NOT NULL,
  name TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('WARNING','CRITICAL')),
  threshold REAL NOT NULL,
  clear_threshold REAL NOT NULL,
  hold_s INTEGER NOT NULL DEFAULT 5,
  clear_hold_s INTEGER NOT NULL DEFAULT 5,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  pending_since TEXT,
  recovery_since TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE alarms (
  alarm_id TEXT PRIMARY KEY,
  dedup_key TEXT NOT NULL,
  device_id TEXT REFERENCES device_registry(device_id),
  rule_id TEXT REFERENCES alarm_rules(rule_id),
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('WARNING','CRITICAL')),
  state TEXT NOT NULL CHECK(state IN ('ACTIVE','ACKNOWLEDGED','RESOLVED')),
  raised_at TEXT NOT NULL,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution TEXT,
  evidence TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX idx_active_alarm ON alarms(dedup_key) WHERE state != 'RESOLVED';
CREATE INDEX idx_alarms_time ON alarms(raised_at DESC);
CREATE TABLE alarm_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alarm_id TEXT NOT NULL REFERENCES alarms(alarm_id),
  timestamp TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT ''
);
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('INFO','WARNING','CRITICAL')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  device_id TEXT,
  alarm_id TEXT,
  audience TEXT NOT NULL DEFAULT 'ALL' CHECK(audience IN ('ALL','ADMIN','USER')),
  owner_id INTEGER REFERENCES system_users(id) ON DELETE CASCADE,
  dedup_key TEXT
);
CREATE INDEX idx_notifications_time ON notifications(id DESC);
CREATE INDEX idx_notifications_dedup ON notifications(dedup_key,timestamp DESC);
CREATE TABLE notification_reads (
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES system_users(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  PRIMARY KEY(notification_id,user_id)
);
CREATE TABLE notification_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES system_users(id) ON DELETE CASCADE,
  critical_sound INTEGER NOT NULL DEFAULT 0 CHECK(critical_sound IN (0,1))
);
CREATE TABLE release_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  retention_days INTEGER NOT NULL DEFAULT 90
);
INSERT INTO release_settings(id) VALUES(1);

-- Event producers write only metadata, never credentials or raw device payloads.
CREATE TRIGGER notify_auth AFTER INSERT ON access_logs
WHEN NEW.modality IN ('WEB_LOGIN','WEB_LOGOUT')
BEGIN
  INSERT INTO notifications(timestamp,category,severity,title,message,audience,owner_id,dedup_key)
  SELECT NEW.timestamp,'AUTH',CASE WHEN NEW.status='DENIED' THEN 'WARNING' ELSE 'INFO' END,
    CASE WHEN NEW.status='DENIED' THEN 'Dashboard sign-in rejected' WHEN NEW.modality='WEB_LOGOUT' THEN 'Signed out' ELSE 'Signed in' END,
    CASE WHEN NEW.status='DENIED' THEN 'An authentication attempt was rejected. Review the access audit for details.' ELSE 'Dashboard session event recorded.' END,
    CASE WHEN NEW.status='DENIED' THEN 'ADMIN' ELSE 'USER' END,
    CASE WHEN NEW.status='DENIED' THEN NULL ELSE (SELECT id FROM system_users WHERE username=NEW.username) END,
    CASE WHEN NEW.status='DENIED' THEN 'AUTH_FAILURE' ELSE NULL END
  WHERE NEW.status!='DENIED' OR NOT EXISTS(
    SELECT 1 FROM notifications WHERE dedup_key='AUTH_FAILURE' AND timestamp>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 seconds')
  );
END;
CREATE TRIGGER notify_management AFTER INSERT ON management_audit
WHEN NEW.action NOT IN ('DEVICE_CREATED','DEVICE_UPDATED')
BEGIN
  INSERT INTO notifications(timestamp,category,severity,title,message,audience)
  VALUES(NEW.timestamp,'ADMIN','INFO','Administration change',NEW.actor || ': ' || NEW.action,'ADMIN');
END;
CREATE TRIGGER notify_command_failure AFTER UPDATE OF lifecycle_state ON command_audit
WHEN NEW.lifecycle_state IN ('failed','timed_out') AND NEW.lifecycle_state!=OLD.lifecycle_state
BEGIN
  INSERT INTO notifications(timestamp,category,severity,title,message,device_id,audience)
  VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'COMMAND','WARNING','Control command failed',NEW.command || ': ' || NEW.lifecycle_state,NEW.target_node,'ADMIN');
END;
CREATE TRIGGER notify_command_unavailable AFTER INSERT ON command_audit
WHEN NEW.lifecycle_state IN ('unavailable','rejected')
BEGIN
  INSERT INTO notifications(timestamp,category,severity,title,message,device_id,audience)
  VALUES(NEW.issued_at,'COMMAND','WARNING','Control command unavailable',NEW.command || ': ' || NEW.lifecycle_state,NEW.target_node,'ADMIN');
END;
CREATE TRIGGER notify_system_error AFTER INSERT ON system_errors
BEGIN
  INSERT INTO notifications(timestamp,category,severity,title,message,device_id,audience,dedup_key)
  SELECT NEW.timestamp,'SYSTEM','WARNING','System diagnostic event',NEW.error_code,NEW.source_node,'ADMIN',NEW.source_node || ':' || NEW.error_code
  WHERE NOT EXISTS(SELECT 1 FROM notifications WHERE dedup_key=NEW.source_node || ':' || NEW.error_code AND timestamp>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 seconds'));
END;
