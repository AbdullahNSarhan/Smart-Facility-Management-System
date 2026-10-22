import crypto from 'node:crypto';
import { hashSecret, verifySecret, generateOpaqueToken, hashSessionTokenVerifier } from '../utils/crypto.js';

export const ALLOWED_LOG_TABLES = new Set([
  'access_logs',
  'camera_events',
  'environmental_telemetry',
  'system_errors',
  'system_users'
]);

const RANGE_MS_MAP = {
  '1h': 3600 * 1000,
  '24h': 24 * 3600 * 1000,
  '7d': 7 * 24 * 3600 * 1000
};

const BUCKET_MS_MAP = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000
};

export class SqliteRepository {
  constructor(sqliteDb) {
    this.sqlite = sqliteDb;
  }

  // --------------------------------------------------------------------------
  // USER & AUTHENTICATION OPERATIONS
  // --------------------------------------------------------------------------

  findUserByUsername(username) {
    return this.sqlite
      .prepare('SELECT * FROM system_users WHERE username = ? LIMIT 1')
      .get(String(username).trim());
  }

  findUserById(userId) {
    return this.sqlite
      .prepare('SELECT * FROM system_users WHERE id = ? LIMIT 1')
      .get(Number(userId));
  }

  countActiveAdmins() {
    const row = this.sqlite
      .prepare("SELECT COUNT(*) AS cnt FROM system_users WHERE role = 'Admin' AND enabled = 1")
      .get();
    return Number(row?.cnt || 0);
  }

  /**
   * Returns safe operator directory projection — strictly omits password_hash, pin, and pin_verifier!
   */
  listSafeSystemUsers() {
    const rows = this.sqlite
      .prepare(
        `SELECT
           id,
           username,
           role,
           rfid,
           pin_configured,
           face_linked,
           enabled,
           provisioning_status,
           created_at,
           updated_at
         FROM system_users
         ORDER BY id ASC`
      )
      .all();

    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      role: r.role,
      rfid: r.rfid,
      pin_configured: Boolean(r.pin_configured),
      face_linked: Boolean(r.face_linked),
      enabled: Boolean(r.enabled),
      provisioning_status: r.provisioning_status,
      created_at: r.created_at,
      updated_at: r.updated_at
    }));
  }

  provisionUser({ username, password, role = 'Viewer', rfid, pin, face_linked = false }) {
    const now = new Date().toISOString();
    const passwordHash = hashSecret(String(password));
    const pinStr = pin !== undefined && pin !== null ? String(pin).padStart(6, '0') : null;
    const pinVerifier = pinStr ? hashSecret(pinStr) : null;
    const pinConfigured = pinVerifier ? 1 : 0;
    const faceLinkedInt = face_linked ? 1 : 0;
    const normalizedRole = role === 'Admin' ? 'Admin' : 'Viewer';

    const tx = this.sqlite.transaction(() => {
      const existing = this.findUserByUsername(username);
      if (existing) {
        const err = new Error('Username already exists');
        err.code = 'USER_ALREADY_EXISTS';
        throw err;
      }

      const res = this.sqlite
        .prepare(
          `INSERT INTO system_users
           (username, role, password_hash, pin_verifier, pin_configured, rfid, face_linked, enabled, provisioning_status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'stored_pending_edge_sync', ?, ?)`
        )
        .run(
          username,
          normalizedRole,
          passwordHash,
          pinVerifier,
          pinConfigured,
          rfid.toUpperCase(),
          faceLinkedInt,
          now,
          now
        );

      this.insertAccessLog({
        timestamp: now,
        node_id: 'backend',
        username,
        modality: 'ADMIN_PROVISION',
        event: `Provisioned operator ${username} (${normalizedRole})`,
        status: 'STORED_SQLITE',
        details: 'PIN verifier hashed in SQLite; offline Node 1 EEPROM sync pending firmware provisioning channel'
      });

      return Number(res.lastInsertRowid);
    });

    const newId = tx();
    return this.listSafeSystemUsers().find((u) => u.id === newId);
  }

  updateAdminCredentials({ actorUserId, currentUsername, newUsername, newPassword }) {
    const now = new Date().toISOString();
    const newHash = hashSecret(String(newPassword));

    const tx = this.sqlite.transaction(() => {
      const target =
        this.findUserById(actorUserId) || this.findUserByUsername(currentUsername);
      if (!target || target.role !== 'Admin') {
        const err = new Error('Target Administrator account not found');
        err.code = 'ADMIN_NOT_FOUND';
        throw err;
      }

      const conflict = this.findUserByUsername(newUsername);
      if (conflict && conflict.id !== target.id) {
        const err = new Error('Requested username is already in use');
        err.code = 'USERNAME_CONFLICT';
        throw err;
      }

      this.sqlite
        .prepare(
          `UPDATE system_users
           SET username = ?, password_hash = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(newUsername, newHash, now, target.id);

      this.insertAccessLog({
        timestamp: now,
        node_id: 'backend',
        username: newUsername,
        modality: 'ADMIN_PROFILE',
        event: `Rotated Administrator credentials (${target.username} -> ${newUsername})`,
        status: 'UPDATED'
      });

      return target.id;
    });

    return tx();
  }

  updateUserRole({ targetUserId, newRole, actorUsername }) {
    const normalizedRole = newRole === 'Admin' ? 'Admin' : 'Viewer';
    const now = new Date().toISOString();

    const tx = this.sqlite.transaction(() => {
      const user = this.findUserById(targetUserId);
      if (!user) {
        const err = new Error('User not found');
        err.code = 'USER_NOT_FOUND';
        throw err;
      }

      if (user.role === 'Admin' && normalizedRole !== 'Admin' && user.enabled === 1) {
        if (this.countActiveAdmins() <= 1) {
          const err = new Error('Cannot demote the last active Administrator');
          err.code = 'LAST_ADMIN_PROTECTED';
          throw err;
        }
      }

      this.sqlite
        .prepare('UPDATE system_users SET role = ?, updated_at = ? WHERE id = ?')
        .run(normalizedRole, now, user.id);

      // Revoke existing sessions for this user so new role takes effect cleanly
      this.revokeAllSessionsForUser(user.id);

      this.insertAccessLog({
        timestamp: now,
        node_id: 'backend',
        username: user.username,
        modality: 'RBAC_UPDATE',
        event: `Role changed to ${normalizedRole} by ${actorUsername}`,
        status: 'UPDATED'
      });

      return { id: user.id, username: user.username, role: normalizedRole };
    });

    return tx();
  }

  deleteUser({ targetUserId, actorUsername }) {
    const now = new Date().toISOString();

    const tx = this.sqlite.transaction(() => {
      const user = this.findUserById(targetUserId);
      if (!user) {
        const err = new Error('User not found');
        err.code = 'USER_NOT_FOUND';
        throw err;
      }

      if (user.role === 'Admin' && user.enabled === 1 && this.countActiveAdmins() <= 1) {
        const err = new Error('Cannot delete the last active Administrator account');
        err.code = 'LAST_ADMIN_PROTECTED';
        throw err;
      }

      this.revokeAllSessionsForUser(user.id);
      this.sqlite.prepare('DELETE FROM system_users WHERE id = ?').run(user.id);

      this.insertAccessLog({
        timestamp: now,
        node_id: 'backend',
        username: user.username,
        modality: 'USER_REVOKE',
        event: `Deleted operator ${user.username} (#${user.id}) by ${actorUsername}`,
        status: 'DELETED'
      });

      return { id: user.id, username: user.username };
    });

    return tx();
  }

  // --------------------------------------------------------------------------
  // SERVER-SIDE SESSIONS
  // --------------------------------------------------------------------------

  createSession({ userId, ttlMs, userAgent = '', ipAddress = '' }) {
    const sessionId = crypto.randomUUID();
    const rawToken = generateOpaqueToken(32);
    const csrfToken = generateOpaqueToken(24);
    const tokenVerifier = hashSessionTokenVerifier(rawToken);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const expiresIso = new Date(nowMs + ttlMs).toISOString();

    this.sqlite
      .prepare(
        `INSERT INTO sessions
         (id, token_verifier, csrf_token, user_id, created_at, last_seen_at, expires_at, revoked_at, user_agent, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(sessionId, tokenVerifier, csrfToken, userId, nowIso, nowIso, expiresIso, userAgent.slice(0, 255), ipAddress.slice(0, 64));

    return {
      sessionId,
      rawToken,
      csrfToken,
      expiresAt: expiresIso
    };
  }

  verifySessionToken(rawToken, idleTtlMs = 30 * 60 * 1000) {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 16) {
      return null;
    }
    const tokenVerifier = hashSessionTokenVerifier(rawToken);
    const row = this.sqlite
      .prepare(
        `SELECT
           s.id AS session_id,
           s.csrf_token,
           s.user_id,
           s.created_at,
           s.last_seen_at,
           s.expires_at,
           s.revoked_at,
           u.username,
           u.role,
           u.enabled
         FROM sessions s
         INNER JOIN system_users u ON u.id = s.user_id
         WHERE s.token_verifier = ?
         LIMIT 1`
      )
      .get(tokenVerifier);

    if (!row) return null;
    if (row.revoked_at) return null;
    if (!row.enabled) return null;

    const nowMs = Date.now();
    const expiresMs = Date.parse(row.expires_at);
    const lastSeenMs = Date.parse(row.last_seen_at);

    if (Number.isNaN(expiresMs) || nowMs >= expiresMs) {
      this.revokeSessionById(row.session_id);
      return null;
    }
    if (!Number.isNaN(lastSeenMs) && nowMs - lastSeenMs > idleTtlMs) {
      this.revokeSessionById(row.session_id);
      return null;
    }

    const nowIso = new Date(nowMs).toISOString();
    this.sqlite
      .prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
      .run(nowIso, row.session_id);

    return {
      sessionId: row.session_id,
      csrfToken: row.csrf_token,
      user: {
        id: row.user_id,
        username: row.username,
        role: row.role
      }
    };
  }

  revokeSessionByToken(rawToken) {
    if (!rawToken) return;
    const verifier = hashSessionTokenVerifier(rawToken);
    this.sqlite
      .prepare('UPDATE sessions SET revoked_at = ? WHERE token_verifier = ? AND revoked_at IS NULL')
      .run(new Date().toISOString(), verifier);
  }

  revokeSessionById(sessionId) {
    this.sqlite
      .prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(new Date().toISOString(), sessionId);
  }

  revokeAllSessionsForUser(userId) {
    this.sqlite
      .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .run(new Date().toISOString(), Number(userId));
  }

  // --------------------------------------------------------------------------
  // TELEMETRY, ACCESS LOGS, CAMERA EVENTS & SYSTEM ERRORS
  // --------------------------------------------------------------------------

  insertEnvironmentalTelemetry(record) {
    const nowMs = record.timestamp_ms ?? Date.now();
    const timestamp = record.timestamp || new Date(nowMs).toISOString();
    const nodeId = record.node_id || record.node || 'env_02';
    const bootId = record.boot_id ?? null;
    const seq = record.seq !== undefined && record.seq !== null ? Number(record.seq) : null;

    try {
      const res = this.sqlite
        .prepare(
          `INSERT INTO environmental_telemetry
           (timestamp, timestamp_ms, node_id, boot_id, seq, temperature, humidity, smoke_gas_level, light_state, fan_relay, door_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          timestamp,
          nowMs,
          nodeId,
          bootId,
          seq,
          Number(record.temperature),
          Number(record.humidity),
          Number(record.smoke_gas_level ?? 0),
          record.light_state === 'ON' ? 'ON' : 'OFF',
          record.fan_relay === 'ON' ? 'ON' : 'OFF',
          record.door_state === 'OPEN' ? 'OPEN' : 'CLOSED'
        );
      return { inserted: true, duplicate: false, id: Number(res.lastInsertRowid), timestamp };
    } catch (err) {
      if (String(err.message).includes('UNIQUE constraint failed')) {
        return { inserted: false, duplicate: true };
      }
      throw err;
    }
  }

  getLatestTelemetry() {
    return this.sqlite
      .prepare('SELECT * FROM environmental_telemetry ORDER BY timestamp_ms DESC, id DESC LIMIT 1')
      .get();
  }

  insertAccessLog(entry) {
    const timestamp = entry.timestamp || new Date().toISOString();
    try {
      const res = this.sqlite
        .prepare(
          `INSERT INTO access_logs
           (timestamp, node_id, boot_id, seq, username, modality, event, status, mfa_status, details)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          timestamp,
          entry.node_id || 'node1',
          entry.boot_id ?? null,
          entry.seq ?? null,
          entry.username || 'system',
          entry.modality || 'ACCESS',
          entry.event || 'Access event',
          entry.status || 'INFO',
          entry.mfa_status ?? null,
          entry.details ?? null
        );
      return { inserted: true, duplicate: false, id: Number(res.lastInsertRowid) };
    } catch (err) {
      if (String(err.message).includes('UNIQUE constraint failed')) {
        return { inserted: false, duplicate: true };
      }
      throw err;
    }
  }

  insertCameraEvent(entry) {
    const timestamp = entry.timestamp || new Date().toISOString();
    try {
      const res = this.sqlite
        .prepare(
          `INSERT INTO camera_events
           (timestamp, node_id, boot_id, seq, event, user_id, status, confidence, details)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          timestamp,
          entry.node_id || 'node3',
          entry.boot_id ?? null,
          entry.seq ?? null,
          entry.event || 'FACE_VERIFICATION',
          entry.user_id || 'unknown',
          entry.status || 'UNVERIFIED',
          entry.confidence ?? null,
          entry.details ?? null
        );
      return { inserted: true, duplicate: false, id: Number(res.lastInsertRowid) };
    } catch (err) {
      if (String(err.message).includes('UNIQUE constraint failed')) {
        return { inserted: false, duplicate: true };
      }
      throw err;
    }
  }

  insertSystemError({ source_node = 'backend', error_code = 'SYSTEM_FAULT', severity = 'ERROR', error_description }) {
    const timestamp = new Date().toISOString();
    const res = this.sqlite
      .prepare(
        `INSERT INTO system_errors (timestamp, source_node, error_code, severity, error_description)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(timestamp, source_node, error_code, severity, error_description);
    return Number(res.lastInsertRowid);
  }

  /**
   * Queries an allowlisted SQLite table with safe projection and bounded row count.
   */
  queryAllowlistedTable(tableName, limit = 250) {
    if (!ALLOWED_LOG_TABLES.has(tableName)) {
      const err = new Error(`Table "${tableName}" is not in the query allowlist`);
      err.code = 'TABLE_NOT_ALLOWED';
      throw err;
    }

    const safeLimit = Math.min(1000, Math.max(1, Number(limit) || 250));

    if (tableName === 'system_users') {
      return this.listSafeSystemUsers();
    }
    if (tableName === 'access_logs') {
      return this.sqlite
        .prepare('SELECT id, timestamp, node_id, username, modality, event, status, mfa_status, details FROM access_logs ORDER BY id DESC LIMIT ?')
        .all(safeLimit);
    }
    if (tableName === 'camera_events') {
      return this.sqlite
        .prepare('SELECT id, timestamp, node_id, event, user_id, status, confidence, details FROM camera_events ORDER BY id DESC LIMIT ?')
        .all(safeLimit);
    }
    if (tableName === 'environmental_telemetry') {
      return this.sqlite
        .prepare('SELECT id, timestamp, node_id, seq, temperature, humidity, smoke_gas_level, light_state, fan_relay, door_state FROM environmental_telemetry ORDER BY id DESC LIMIT ?')
        .all(safeLimit);
    }
    if (tableName === 'system_errors') {
      return this.sqlite
        .prepare('SELECT error_id, timestamp, source_node, error_code, severity, error_description FROM system_errors ORDER BY error_id DESC LIMIT ?')
        .all(safeLimit);
    }
    return [];
  }

  /**
   * Computes time-bucketed environmental telemetry rollups from real SQLite records.
   */
  getTelemetryAggregation({ range = '24h', bucket = '15m' } = {}) {
    const rangeMs = RANGE_MS_MAP[range];
    const bucketMs = BUCKET_MS_MAP[bucket];
    if (!rangeMs || !bucketMs) {
      const err = new Error('Unsupported range or bucket parameter');
      err.code = 'INVALID_AGGREGATION_PARAMS';
      throw err;
    }

    const cutoffMs = Date.now() - rangeMs;
    const rows = this.sqlite
      .prepare(
        `SELECT
           CAST(timestamp_ms / ? AS INTEGER) * CAST(? AS INTEGER) AS bucket_start_ms,
           ROUND(AVG(temperature), 2) AS temperature_avg,
           ROUND(MIN(temperature), 2) AS temperature_min,
           ROUND(MAX(temperature), 2) AS temperature_max,
           ROUND(AVG(humidity), 2) AS humidity_avg,
           ROUND(MIN(humidity), 2) AS humidity_min,
           ROUND(MAX(humidity), 2) AS humidity_max,
           MAX(smoke_gas_level) AS smoke_gas_max,
           COUNT(*) AS sample_count
         FROM environmental_telemetry
         WHERE timestamp_ms >= ?
         GROUP BY bucket_start_ms
         ORDER BY bucket_start_ms ASC
         LIMIT 500`
      )
      .all(bucketMs, bucketMs, cutoffMs);

    return {
      range,
      bucket,
      bucket_ms: bucketMs,
      series: rows.map((r) => ({
        timestamp: new Date(Number(r.bucket_start_ms)).toISOString(),
        timestamp_ms: Number(r.bucket_start_ms),
        temperature_avg: Number(r.temperature_avg),
        temperature_min: Number(r.temperature_min),
        temperature_max: Number(r.temperature_max),
        humidity_avg: Number(r.humidity_avg),
        humidity_min: Number(r.humidity_min),
        humidity_max: Number(r.humidity_max),
        smoke_gas_max: Number(r.smoke_gas_max),
        sample_count: Number(r.sample_count)
      }))
    };
  }

  // --------------------------------------------------------------------------
  // COMMAND AUDIT RECORDS
  // --------------------------------------------------------------------------

  createCommandAudit(entry) {
    this.sqlite
      .prepare(
        `INSERT INTO command_audit
         (command_id, request_id, actor_user_id, actor_username, command, requested_state, target_node, mqtt_topic, lifecycle_state, issued_at, expires_at, error_code, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.command_id,
        entry.request_id,
        entry.actor_user_id ?? null,
        entry.actor_username,
        entry.command,
        entry.requested_state,
        entry.target_node,
        entry.mqtt_topic,
        entry.lifecycle_state,
        entry.issued_at,
        entry.expires_at,
        entry.error_code ?? null,
        entry.details ?? null
      );
  }

  updateCommandAuditState(commandId, { lifecycle_state, acknowledged_at = null, confirmed_at = null, error_code = null, details = null }) {
    this.sqlite
      .prepare(
        `UPDATE command_audit
         SET lifecycle_state = ?,
             acknowledged_at = COALESCE(?, acknowledged_at),
             confirmed_at = COALESCE(?, confirmed_at),
             error_code = COALESCE(?, error_code),
             details = COALESCE(?, details)
         WHERE command_id = ?`
      )
      .run(lifecycle_state, acknowledged_at, confirmed_at, error_code, details, commandId);
  }

  getCommandAudit(commandId) {
    return this.sqlite
      .prepare('SELECT * FROM command_audit WHERE command_id = ? LIMIT 1')
      .get(commandId);
  }

  verifyUserCredentials(username, plainPassword) {
    const user = this.findUserByUsername(username);
    if (!user || !user.enabled) return null;
    const valid = verifySecret(plainPassword, user.password_hash);
    if (!valid) return null;
    return {
      id: user.id,
      username: user.username,
      role: user.role
    };
  }
}
