-- Additive upgrade: existing operator accounts, sessions and logs remain intact.
CREATE TABLE facility_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 1,
  document TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE people (
  subject_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED')) DEFAULT 'ACTIVE',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE physical_credentials (
  credential_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES people(subject_id),
  modality TEXT NOT NULL CHECK (modality IN ('RFID', 'PIN')),
  card_uid TEXT,
  pin_verifier TEXT,
  status TEXT NOT NULL CHECK (status IN ('ASSIGNED', 'BLOCKED', 'REVOKED')) DEFAULT 'ASSIGNED',
  sync_status TEXT NOT NULL DEFAULT 'PENDING_DEVICE_SYNC' CHECK (sync_status = 'PENDING_DEVICE_SYNC'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((modality = 'RFID' AND card_uid IS NOT NULL AND pin_verifier IS NULL)
    OR (modality = 'PIN' AND card_uid IS NULL AND pin_verifier IS NOT NULL))
);
CREATE UNIQUE INDEX idx_card_assignment ON physical_credentials(card_uid)
  WHERE modality = 'RFID' AND status != 'REVOKED';
CREATE UNIQUE INDEX idx_person_pin ON physical_credentials(subject_id)
  WHERE modality = 'PIN' AND status != 'REVOKED';
CREATE INDEX idx_credentials_subject ON physical_credentials(subject_id);

CREATE TABLE management_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details TEXT NOT NULL,
  request_id TEXT
);
CREATE INDEX idx_management_audit_time ON management_audit(id DESC);

CREATE TABLE reader_enrollment_sessions (
  session_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES people(subject_id),
  operator_id INTEGER NOT NULL REFERENCES system_users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  nonce_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ARMING','READY','CANDIDATE','CONFIRMED','CANCELLED','EXPIRED','FAILED')),
  candidate_uid TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_reader_exclusive ON reader_enrollment_sessions(device_id)
  WHERE status IN ('ARMING','READY','CANDIDATE');
