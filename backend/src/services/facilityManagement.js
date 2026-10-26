import crypto from 'node:crypto';
import { hashSecret } from '../utils/crypto.js';
import { enrollmentEventSchema } from '../validators/managementSchemas.js';
import { MQTT_TOPICS } from '../mqtt/topics.js';

export function managementError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
const now = () => new Date().toISOString();
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, code, message) => { throw managementError(status, code, message); };

/** Server-owned one-room configuration and physical identity domain. No hardware success is inferred. */
export class FacilityManagement {
  constructor({ db, repo, config, mqttService }) {
    Object.assign(this, { db, repo, config, mqttService });
    const defaults = {
      facility_name: 'LCI Smart Facility', room_name: 'Smart Room 001',
      nodes: {
        node1: { name: 'Access Controller', ip: config.node1Ip },
        node2: { name: 'Environment Controller', ip: config.node2Ip },
        node3: { name: 'Camera Node', ip: config.node3Ip }
      },
      display_thresholds: { temperature_warning: 30, gas_warning_raw: 250, gas_critical_raw: 400 }
    };
    db.prepare('INSERT OR IGNORE INTO facility_settings (id, revision, document, updated_at, updated_by) VALUES (1, 1, ?, ?, ?)')
      .run(JSON.stringify(defaults), now(), 'bootstrap');
    // A process restart invalidates an in-flight reader interaction; no automatic replay.
    db.prepare("UPDATE reader_enrollment_sessions SET status = 'FAILED' WHERE status IN ('ARMING','READY','CANDIDATE')").run();
    this.applyRuntimeIps(this.settings());
  }

  audit(actor, action, entity, details, requestId = null) {
    this.db.prepare('INSERT INTO management_audit (timestamp, actor, action, entity_id, details, request_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(now(), actor.username, action, entity, JSON.stringify(details), requestId);
  }

  settings() {
    const r = this.db.prepare('SELECT * FROM facility_settings WHERE id = 1').get();
    return { ...JSON.parse(r.document), revision: r.revision, updated_at: r.updated_at, updated_by: r.updated_by };
  }

  applyRuntimeIps(settings) {
    for (const key of ['node1','node2','node3']) this.config[`${key}Ip`] = settings.nodes[key].ip;
  }

  updateSettings(data, actor, requestId) {
    const result = this.db.transaction(() => {
      const previous = this.settings();
      if (data.revision !== previous.revision) fail(409, 'REVISION_CONFLICT', 'Settings changed in another session. Refresh before saving.');
      const { revision, ...document } = data;
      this.db.prepare('UPDATE facility_settings SET revision = revision + 1, document = ?, updated_at = ?, updated_by = ? WHERE id = 1')
        .run(JSON.stringify(document), now(), actor.username);
      this.audit(actor, 'SETTINGS_UPDATED', 'room-001', { before: previous, after: document }, requestId);
      return this.settings();
    })();
    this.applyRuntimeIps(result);
    return result;
  }

  devices() {
    const health = this.mqttService.getHealthStatus();
    const settings = this.settings();
    return ['node1','node2','node3'].map(key => {
      const deviceId = this.config[`${key}Id`];
      const observation = health.observed_nodes?.[deviceId];
      return {
        key, device_id: deviceId, room_id: 'room-001', ...settings.nodes[key],
        status: observation?.status || 'UNKNOWN', last_seen_at: observation?.last_seen_at || null,
        age_ms: observation?.age_ms ?? null, fresh: Boolean(observation?.fresh),
        firmware_version: observation?.firmware_version || null,
        capabilities: observation?.capabilities || [],
        capabilities_seen_at: observation?.capabilities_seen_at || null,
        address_status: 'REGISTERED_ONLY', policy_sync_status: 'FIRMWARE_INTEGRATION_REQUIRED'
      };
    });
  }

  person(id) {
    const row = this.db.prepare('SELECT * FROM people WHERE subject_id = ?').get(id);
    if (!row) fail(404, 'PERSON_NOT_FOUND', 'Person was not found');
    return { ...row, credentials: this.credentials(id) };
  }

  listPeople({ search = '', page = 1, limit = 20 }) {
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    const where = "display_name LIKE ? ESCAPE '\\' OR reference LIKE ? ESCAPE '\\'";
    const total = this.db.prepare(`SELECT COUNT(*) AS total FROM people WHERE ${where}`).get(pattern, pattern).total;
    const people = this.db.prepare(`SELECT * FROM people WHERE ${where} ORDER BY created_at DESC, subject_id LIMIT ? OFFSET ?`)
      .all(pattern, pattern, limit, (page - 1) * limit).map(p => ({ ...p, credentials: this.credentials(p.subject_id) }));
    return { people, total, page, limit };
  }

  createPerson(data, actor, requestId) {
    return this.db.transaction(() => {
      const id = crypto.randomUUID(), timestamp = now();
      this.db.prepare('INSERT INTO people (subject_id, display_name, reference, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, data.display_name, data.reference, timestamp, timestamp);
      this.audit(actor, 'PERSON_CREATED', id, data, requestId);
      return this.person(id);
    })();
  }

  updatePerson(id, data, actor, requestId) {
    return this.db.transaction(() => {
      const previous = this.person(id);
      if (previous.version !== data.version) fail(409, 'VERSION_CONFLICT', 'Person changed in another session. Refresh before saving.');
      this.db.prepare('UPDATE people SET display_name = ?, reference = ?, status = ?, version = version + 1, updated_at = ? WHERE subject_id = ?')
        .run(data.display_name, data.reference, data.status, now(), id);
      this.audit(actor, 'PERSON_UPDATED', id, { display_name: data.display_name, reference: data.reference, status: data.status, device_sync: 'PENDING_DEVICE_SYNC' }, requestId);
      return this.person(id);
    })();
  }

  credentials(id) {
    return this.db.prepare(`SELECT credential_id, subject_id, modality,
      CASE WHEN card_uid IS NOT NULL THEN '••:••:' || substr(card_uid, -5) ELSE NULL END AS masked_uid,
      status, sync_status, created_at, updated_at FROM physical_credentials WHERE subject_id = ? ORDER BY created_at DESC`).all(id);
  }

  addCredential(id, data, actor, requestId) {
    return this.db.transaction(() => {
      if (this.person(id).status !== 'ACTIVE') fail(409, 'PERSON_SUSPENDED', 'Reactivate this person before adding credentials');
      const credentialId = crypto.randomUUID(), timestamp = now();
      if (data.modality === 'RFID') {
        if (this.db.prepare("SELECT 1 FROM physical_credentials WHERE card_uid = ? AND status != 'REVOKED'").get(data.card_uid))
          fail(409, 'CARD_ALREADY_ASSIGNED', 'This card is already assigned. Revoke its existing assignment first.');
      } else {
        // Reset atomically revokes the old PIN; no raw PIN or verifier appears in API/audit/MQTT.
        this.db.prepare("UPDATE physical_credentials SET status = 'REVOKED', updated_at = ? WHERE subject_id = ? AND modality = 'PIN' AND status != 'REVOKED'")
          .run(timestamp, id);
      }
      this.db.prepare('INSERT INTO physical_credentials (credential_id, subject_id, modality, card_uid, pin_verifier, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(credentialId, id, data.modality, data.card_uid || null, data.modality === 'PIN' ? hashSecret(data.pin) : null, timestamp, timestamp);
      this.audit(actor, data.modality === 'PIN' ? 'PIN_SET_OR_RESET' : 'CARD_ASSIGNED', id, { credential_id: credentialId, modality: data.modality, device_sync: 'PENDING_DEVICE_SYNC' }, requestId);
      return this.credentials(id).find(c => c.credential_id === credentialId);
    })();
  }

  setCredentialState(id, status, actor, requestId) {
    return this.db.transaction(() => {
      const c = this.db.prepare('SELECT credential_id, subject_id, status FROM physical_credentials WHERE credential_id = ?').get(id);
      if (!c) fail(404, 'CREDENTIAL_NOT_FOUND', 'Credential was not found');
      if (c.status === 'REVOKED') fail(409, 'CREDENTIAL_REVOKED', 'A revoked credential cannot be changed');
      this.db.prepare('UPDATE physical_credentials SET status = ?, updated_at = ? WHERE credential_id = ?').run(status, now(), id);
      this.audit(actor, `CREDENTIAL_${status}`, id, { subject_id: c.subject_id, device_sync: 'PENDING_DEVICE_SYNC' }, requestId);
      return this.credentials(c.subject_id).find(r => r.credential_id === id);
    })();
  }

  createOperator(data, actor, requestId) {
    return this.db.transaction(() => {
      if (this.repo.findUserByUsername(data.username)) fail(409, 'USER_ALREADY_EXISTS', 'Username already exists');
      const timestamp = now();
      const r = this.db.prepare(`INSERT INTO system_users
        (username, role, password_hash, rfid, provisioning_status, created_at, updated_at)
        VALUES (?, ?, ?, '', 'dashboard_only', ?, ?)`)
        .run(data.username, data.role, hashSecret(data.password), timestamp, timestamp);
      this.audit(actor, 'OPERATOR_CREATED', String(r.lastInsertRowid), { username: data.username, role: data.role }, requestId);
      return { id: Number(r.lastInsertRowid), username: data.username, role: data.role };
    })();
  }

  auditRows(limit = 100) {
    return this.db.prepare('SELECT * FROM management_audit ORDER BY id DESC LIMIT ?').all(limit)
      .map(r => ({ ...r, details: JSON.parse(r.details) }));
  }

  expireEnrollments() {
    this.db.prepare("UPDATE reader_enrollment_sessions SET status = 'EXPIRED' WHERE status IN ('ARMING','READY','CANDIDATE') AND expires_at <= ?").run(now());
  }

  enrollment(id, actor) {
    this.expireEnrollments();
    const row = this.db.prepare('SELECT * FROM reader_enrollment_sessions WHERE session_id = ?').get(id);
    if (!row) fail(404, 'ENROLLMENT_NOT_FOUND', 'Enrollment was not found');
    if (row.operator_id !== actor.id) fail(403, 'ENROLLMENT_OWNER_REQUIRED', 'Only the initiating administrator can manage this enrollment');
    const { nonce_digest, candidate_uid, ...safe } = row;
    return { ...safe, masked_uid: candidate_uid ? `••:••:${candidate_uid.slice(-5)}` : null };
  }

  async startEnrollment(subjectId, actor, requestId) {
    if (this.person(subjectId).status !== 'ACTIVE') fail(409, 'PERSON_SUSPENDED', 'Person is suspended');
    const reader = this.devices()[0];
    if (!reader.fresh || reader.status !== 'ONLINE') fail(503, 'READER_OFFLINE', 'The door reader must be online');
    const capabilityAge = Date.now() - Date.parse(reader.capabilities_seen_at || '');
    if (!reader.capabilities.includes('RFID_ENROLL_V1') || !Number.isFinite(capabilityAge) || capabilityAge > this.config.mqttNodeStaleMs)
      fail(409, 'READER_UNSUPPORTED', 'Reader firmware must freshly advertise RFID_ENROLL_V1 on its own heartbeat');
    this.expireEnrollments();
    if (this.db.prepare("SELECT 1 FROM reader_enrollment_sessions WHERE device_id = ? AND status IN ('ARMING','READY','CANDIDATE')").get(reader.device_id))
      fail(409, 'READER_BUSY', 'Another enrollment currently owns this reader');
    const id = crypto.randomUUID(), nonce = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 45000).toISOString();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO reader_enrollment_sessions
        (session_id, subject_id, operator_id, device_id, nonce_digest, status, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'ARMING', ?, ?)`)
        .run(id, subjectId, actor.id, reader.device_id, digest(nonce), expires, now());
      this.audit(actor, 'READER_ENROLLMENT_STARTED', id, { subject_id: subjectId, device_id: reader.device_id }, requestId);
    })();
    try {
      await this.mqttService.publishCommand(MQTT_TOPICS.READER_ENROLL_COMMAND.topic, {
        schema_version: 1, action: 'START', session_id: id, node_id: reader.device_id, nonce, expires_at: expires
      });
    } catch {
      this.db.prepare("UPDATE reader_enrollment_sessions SET status = 'FAILED' WHERE session_id = ?").run(id);
      fail(503, 'READER_PUBLISH_FAILED', 'Could not publish enrollment request');
    }
    return this.enrollment(id, actor);
  }

  handleEnrollmentEvent(raw) {
    this.expireEnrollments();
    const parsed = enrollmentEventSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'SCHEMA_VIOLATION' };
    const d = parsed.data;
    const row = this.db.prepare('SELECT * FROM reader_enrollment_sessions WHERE session_id = ?').get(d.session_id);
    if (!row || row.device_id !== d.node_id || row.nonce_digest !== digest(d.nonce) || !['ARMING','READY'].includes(row.status))
      return { ok: false, error: 'INVALID_ENROLLMENT_EVENT' };
    if (d.event === 'CARD' && (row.status !== 'READY' || !d.card_uid)) return { ok: false, error: 'READER_NOT_READY' };
    const status = d.event === 'CARD' ? 'CANDIDATE' : d.event;
    // Duplicate READY may be retried; an old READY never clears a candidate.
    this.db.prepare('UPDATE reader_enrollment_sessions SET status = ?, candidate_uid = ? WHERE session_id = ?')
      .run(status, d.card_uid || null, row.session_id);
    return { ok: true, status };
  }

  async finishEnrollment(id, action, actor, requestId) {
    const result = this.db.transaction(() => {
      const session = this.enrollment(id, actor);
      if (!['ARMING','READY','CANDIDATE'].includes(session.status)) fail(409, 'ENROLLMENT_CLOSED', 'This enrollment is already closed');
      if (action === 'confirm') {
        if (session.status !== 'CANDIDATE') fail(409, 'NO_CARD_CANDIDATE', 'Wait for an acknowledged reader scan');
        const raw = this.db.prepare('SELECT candidate_uid FROM reader_enrollment_sessions WHERE session_id = ?').get(id);
        // Inline transaction body avoids nesting BEGINs while retaining atomic card assignment.
        if (this.person(session.subject_id).status !== 'ACTIVE') fail(409, 'PERSON_SUSPENDED', 'Person is suspended');
        if (this.db.prepare("SELECT 1 FROM physical_credentials WHERE card_uid = ? AND status != 'REVOKED'").get(raw.candidate_uid))
          fail(409, 'CARD_ALREADY_ASSIGNED', 'This card is already assigned');
        const credentialId = crypto.randomUUID(), timestamp = now();
        this.db.prepare(`INSERT INTO physical_credentials (credential_id, subject_id, modality, card_uid, created_at, updated_at)
          VALUES (?, ?, 'RFID', ?, ?, ?)`).run(credentialId, session.subject_id, raw.candidate_uid, timestamp, timestamp);
        this.audit(actor, 'CARD_ASSIGNED_FROM_READER', session.subject_id, { credential_id: credentialId, session_id: id, device_sync: 'PENDING_DEVICE_SYNC' }, requestId);
      }
      this.db.prepare('UPDATE reader_enrollment_sessions SET status = ? WHERE session_id = ?')
        .run(action === 'confirm' ? 'CONFIRMED' : 'CANCELLED', id);
      if (action === 'cancel') this.audit(actor, 'READER_ENROLLMENT_CANCELLED', id, {}, requestId);
      return this.enrollment(id, actor);
    })();
    // Best-effort reader release is outside the DB transaction. A device must also
    // enforce the original deadline locally if the release packet is lost.
    try {
      await this.mqttService.publishCommand(MQTT_TOPICS.READER_ENROLL_COMMAND.topic, {
        schema_version: 1, action: 'CANCEL', session_id: id,
        node_id: result.device_id, expires_at: result.expires_at
      });
      return { ...result, reader_release: 'REQUESTED' };
    } catch { return { ...result, reader_release: 'WAIT_FOR_EXPIRY' }; }
  }
}
