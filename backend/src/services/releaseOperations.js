import crypto from 'node:crypto';
import { managementError } from './facilityManagement.js';
import {
  frameSchema,
  heartbeatSchema,
  ackSchema,
  CAPABILITY_DATA_TYPES,
  defaultDataTypeForKind
} from '../validators/operationsSchemas.js';

const iso = (ms) => new Date(ms).toISOString();
const error = (status, code, message) => {
  throw managementError(status, code, message);
};
const parseJson = (value, fallback = {}) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};
const cleanTopic = (id) => `lci/v1/devices/${id}`;

export const RELEASE_VERSION = '2.0.0-rc.1';

export const CAPABILITY_REGISTRY = Object.freeze([
  {
    capability: 'SENSOR',
    data_type: 'NUMBER',
    widget: 'METRIC_TREND',
    writable: false,
    alarm_eligible: true,
    description: 'Continuous numeric reading with unit, per-endpoint freshness, range validation, and trend history.'
  },
  {
    capability: 'SENSOR',
    data_type: 'BOOLEAN',
    widget: 'BOOLEAN_STATE',
    writable: false,
    alarm_eligible: true,
    description: 'Binary sensor indicator (motion, dry-contact, smoke/water flag) without fabricated numeric units.'
  },
  {
    capability: 'SWITCH',
    data_type: 'ENUM',
    widget: 'SWITCH_CONTROL',
    writable: true,
    alarm_eligible: false,
    description: 'Stateful ON/OFF output with optional MQTT_V1 confirmed command lifecycle (Published -> Acknowledged -> State Reported).'
  },
  {
    capability: 'SWITCH',
    data_type: 'BOOLEAN',
    widget: 'SWITCH_CONTROL',
    writable: true,
    alarm_eligible: false,
    description: 'Boolean output state with optional confirmed MQTT_V1 switching.'
  },
  {
    capability: 'ACCESS',
    data_type: 'ENUM',
    widget: 'ACCESS_STATE',
    writable: false,
    alarm_eligible: false,
    description: 'Physical access/door state (OPEN/CLOSED/LOCKED/UNLOCKED). Emergency unlock uses its dedicated audited safety workflow.'
  },
  {
    capability: 'CAMERA',
    data_type: 'MEDIA',
    widget: 'CAMERA_SNAPSHOT',
    writable: false,
    alarm_eligible: false,
    description: 'Authenticated backend JPEG snapshot proxy against a registered private LAN camera endpoint.'
  }
]);

export function resolveWidgetType(endpoint) {
  const display = typeof endpoint.display_config === 'object' && endpoint.display_config ? endpoint.display_config : {};
  if (display.widget && display.widget !== 'AUTO') return display.widget;
  const kind = endpoint.kind;
  const dt = endpoint.data_type || defaultDataTypeForKind(kind);
  if (kind === 'SENSOR' && dt === 'NUMBER') return 'METRIC_TREND';
  if (kind === 'SENSOR' && dt === 'BOOLEAN') return 'BOOLEAN_STATE';
  if (kind === 'SWITCH') return 'SWITCH_CONTROL';
  if (kind === 'ACCESS') return 'ACCESS_STATE';
  if (kind === 'CAMERA') return 'CAMERA_SNAPSHOT';
  return 'UNSUPPORTED';
}

export class ReleaseOperations {
  constructor({ db, management, config, mqttService, wsGateway, clock = Date.now, httpFetch = fetch }) {
    Object.assign(this, { db, management, config, mqttService, wsGateway, clock, httpFetch });
    this.simulation = Boolean(config.simulatorMode);
    this.lastNotificationId = 0;
    this.lastCleanup = 0;
    this.startedAt = iso(this.clock());
    this.seed();
    // Unobserved in-flight commands cannot be replayed after a restart.
    for (const c of db
      .prepare("SELECT * FROM device_commands WHERE state IN ('PUBLISHED','ACKNOWLEDGED')")
      .all()) {
      this.failCommand(c, 'FAILED', 'SERVER_RESTART');
    }
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
  }

  seed() {
    const nowTs = iso(this.clock());
    const legacySettings = this.management.settings();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO facilities
         (facility_id, name, description, location, timezone, version, created_at, updated_at)
         VALUES ('facility-default', ?, 'Local-first on-premises smart facility', '', 'UTC', 1, ?, ?)`
      )
      .run(legacySettings.facility_name || 'LCI Smart Facility', nowTs, nowTs);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO rooms
         (room_id, facility_id, room_code, name, description, building, floor, status, version, created_at, updated_at)
         VALUES ('room-001', 'facility-default', 'ROOM-001', ?, 'Primary facility room migrated from single-room baseline', '', '', 'ACTIVE', 1, ?, ?)`
      )
      .run(legacySettings.room_name || 'Smart Room 001', nowTs, nowTs);

    const profiles = {
      node1: {
        type: 'ACCESS',
        endpoints: [['door_state', 'Door state', 'ACCESS', 'ENUM', '', '["OPEN","CLOSED","LOCKED","UNLOCKED"]']]
      },
      node2: {
        type: 'MIXED',
        endpoints: [
          ['temperature', 'Temperature', 'SENSOR', 'NUMBER', '°C', null],
          ['humidity', 'Humidity', 'SENSOR', 'NUMBER', '%', null],
          ['smoke_gas_level', 'MQ-2 reading', 'SENSOR', 'NUMBER', 'raw', null],
          ['fan_relay', 'Fan', 'SWITCH', 'ENUM', '', '["ON","OFF"]'],
          ['light_state', 'Light', 'SWITCH', 'ENUM', '', '["ON","OFF"]']
        ]
      },
      node3: {
        type: 'CAMERA',
        endpoints: [['snapshot', 'Snapshot', 'CAMERA', 'MEDIA', '', null]]
      }
    };

    for (const slot of Object.keys(profiles)) {
      const { name, ip } = legacySettings.nodes[slot];
      const id = this.config[`${slot}Id`];
      const p = profiles[slot];
      this.db
        .prepare(
          `INSERT OR IGNORE INTO device_registry
           (device_id, slot, room_id, name, device_type, transport, ip, path, mqtt_identity_status, created_at, updated_at)
           VALUES (?, ?, 'room-001', ?, ?, 'LEGACY_V1', ?, ?, 'LEGACY', ?, ?)`
        )
        .run(id, slot, name, p.type, ip, slot === 'node3' ? '/capture.jpg' : '/telemetry', nowTs, nowTs);
      for (const [key, label, kind, dataType, unit, allowedJson] of p.endpoints) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO device_endpoints
             (device_id, endpoint_key, label, kind, data_type, unit, allowed_values_json)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, key, label, kind, dataType, unit, allowedJson);
      }
    }
  }

  // --------------------------------------------------------------------------
  // FACILITY & MULTI-ROOM MANAGEMENT
  // --------------------------------------------------------------------------

  getFacility() {
    const row = this.db.prepare("SELECT * FROM facilities WHERE facility_id = 'facility-default'").get();
    if (!row) error(404, 'FACILITY_NOT_FOUND', 'Facility profile was not found');
    const roomCounts = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total_rooms,
           SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_rooms,
           SUM(CASE WHEN status = 'ARCHIVED' THEN 1 ELSE 0 END) AS archived_rooms
         FROM rooms WHERE facility_id = ?`
      )
      .get(row.facility_id);
    return {
      ...row,
      total_rooms: Number(roomCounts?.total_rooms || 0),
      active_rooms: Number(roomCounts?.active_rooms || 0),
      archived_rooms: Number(roomCounts?.archived_rooms || 0)
    };
  }

  updateFacility(data, actor, requestId) {
    return this.db.transaction(() => {
      const current = this.db
        .prepare("SELECT * FROM facilities WHERE facility_id = 'facility-default'")
        .get();
      if (!current) error(404, 'FACILITY_NOT_FOUND', 'Facility profile was not found');
      if (data.version !== current.version) {
        error(409, 'VERSION_CONFLICT', 'Facility profile changed in another session. Refresh before saving.');
      }
      const ts = iso(this.clock());
      this.db
        .prepare(
          `UPDATE facilities
           SET name = ?, description = ?, location = ?, timezone = ?, version = version + 1, updated_at = ?
           WHERE facility_id = 'facility-default'`
        )
        .run(data.name, data.description, data.location, data.timezone, ts);

      // Keep legacy facility_settings.facility_name synchronized
      const legacy = this.management.settings();
      if (legacy.facility_name !== data.name) {
        const { revision, updated_at, updated_by, ...doc } = legacy;
        doc.facility_name = data.name;
        this.db
          .prepare('UPDATE facility_settings SET revision = revision + 1, document = ?, updated_at = ?, updated_by = ? WHERE id = 1')
          .run(JSON.stringify(doc), ts, actor.username);
      }

      this.management.audit(actor, 'FACILITY_UPDATED', 'facility-default', { name: data.name, timezone: data.timezone }, requestId);
      return this.getFacility();
    })();
  }

  _enrichRoom(roomRow, allDevices = null) {
    const devices = allDevices
      ? allDevices.filter((d) => d.room_id === roomRow.room_id && !d.archived)
      : this.listDevices({ room_id: roomRow.room_id, include_archived: false });
    const counts = { total: devices.length, online: 0, stale: 0, unknown: 0, disabled: 0, maintenance: 0 };
    const envSummary = { temperature: null, humidity: null, smoke_gas_level: null };

    for (const d of devices) {
      if (d.status === 'ONLINE') counts.online += 1;
      else if (d.status === 'STALE') counts.stale += 1;
      else if (d.status === 'DISABLED') counts.disabled += 1;
      else counts.unknown += 1;
      if (d.in_maintenance) counts.maintenance += 1;

      if (d.telemetry_fresh && d.values) {
        if (envSummary.temperature === null && typeof d.values.temperature === 'number') {
          envSummary.temperature = { value: d.values.temperature, unit: '°C', device_id: d.device_id };
        }
        if (envSummary.humidity === null && typeof d.values.humidity === 'number') {
          envSummary.humidity = { value: d.values.humidity, unit: '%', device_id: d.device_id };
        }
        if (envSummary.smoke_gas_level === null && typeof d.values.smoke_gas_level === 'number') {
          envSummary.smoke_gas_level = { value: d.values.smoke_gas_level, unit: 'raw', device_id: d.device_id };
        }
      }
    }

    const activeAlarms = this.db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM alarms a
         INNER JOIN device_registry dr ON dr.device_id = a.device_id
         WHERE dr.room_id = ? AND a.state != 'RESOLVED'`
      )
      .get(roomRow.room_id).n;

    return {
      ...roomRow,
      device_counts: counts,
      active_alarms: Number(activeAlarms || 0),
      environmental_summary: envSummary
    };
  }

  listRooms({ status = '', search = '' } = {}) {
    const where = ["facility_id = 'facility-default'"];
    const args = [];
    if (status && ['ACTIVE', 'ARCHIVED'].includes(status)) {
      where.push('status = ?');
      args.push(status);
    }
    if (search) {
      const pattern = `%${String(search).replace(/[\\%_]/g, '\\$&')}%`;
      where.push("(name LIKE ? ESCAPE '\\' OR room_code LIKE ? ESCAPE '\\' OR building LIKE ? ESCAPE '\\')");
      args.push(pattern, pattern, pattern);
    }
    const rows = this.db
      .prepare(`SELECT * FROM rooms WHERE ${where.join(' AND ')} ORDER BY CASE WHEN room_id = 'room-001' THEN 0 ELSE 1 END, room_code ASC`)
      .all(...args);
    const allDevices = this.listDevices({ include_archived: false });
    return rows.map((row) => this._enrichRoom(row, allDevices));
  }

  getRoom(roomId) {
    const row = this.db.prepare('SELECT * FROM rooms WHERE room_id = ?').get(roomId);
    if (!row) error(404, 'ROOM_NOT_FOUND', 'Room was not found');
    const devices = this.listDevices({ room_id: roomId, include_archived: true });
    const enriched = this._enrichRoom(row, devices);
    const alarms = this.listAlarms({ room_id: roomId, page: 1, limit: 25 }).alarms;
    const recentCommands = this.db
      .prepare(
        `SELECT dc.*, dr.name AS device_name
         FROM device_commands dc
         INNER JOIN device_registry dr ON dr.device_id = dc.device_id
         WHERE dr.room_id = ?
         ORDER BY dc.issued_at DESC LIMIT 20`
      )
      .all(roomId);
    return { ...enriched, devices, alarms, recent_commands: recentCommands };
  }

  createRoom(data, actor, requestId) {
    return this.db.transaction(() => {
      if (
        this.db
          .prepare("SELECT 1 FROM rooms WHERE facility_id = 'facility-default' AND room_code = ?")
          .get(data.room_code)
      ) {
        error(409, 'ROOM_CODE_EXISTS', `Room code "${data.room_code}" already exists in this facility`);
      }
      const roomId = `room-${crypto.randomUUID().slice(0, 8)}`;
      const ts = iso(this.clock());
      this.db
        .prepare(
          `INSERT INTO rooms
           (room_id, facility_id, room_code, name, description, building, floor, status, version, created_at, updated_at)
           VALUES (?, 'facility-default', ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?)`
        )
        .run(roomId, data.room_code, data.name, data.description, data.building, data.floor, ts, ts);
      this.management.audit(actor, 'ROOM_CREATED', roomId, { room_code: data.room_code, name: data.name }, requestId);
      this.notify({
        category: 'ADMIN',
        severity: 'INFO',
        title: 'Room created',
        message: `${data.room_code} · ${data.name}`,
        audience: 'ADMIN'
      });
      return this.getRoom(roomId);
    })();
  }

  updateRoom(roomId, data, actor, requestId) {
    return this.db.transaction(() => {
      const current = this.db.prepare('SELECT * FROM rooms WHERE room_id = ?').get(roomId);
      if (!current) error(404, 'ROOM_NOT_FOUND', 'Room was not found');
      if (data.version !== current.version) {
        error(409, 'VERSION_CONFLICT', 'Room changed in another session. Refresh before saving.');
      }
      if (
        this.db
          .prepare("SELECT 1 FROM rooms WHERE facility_id = 'facility-default' AND room_code = ? AND room_id != ?")
          .get(data.room_code, roomId)
      ) {
        error(409, 'ROOM_CODE_EXISTS', `Room code "${data.room_code}" is already used by another room`);
      }
      const ts = iso(this.clock());
      this.db
        .prepare(
          `UPDATE rooms
           SET room_code = ?, name = ?, description = ?, building = ?, floor = ?, version = version + 1, updated_at = ?
           WHERE room_id = ?`
        )
        .run(data.room_code, data.name, data.description, data.building, data.floor, ts, roomId);

      // Update denormalized device_registry.location label for consistency
      this.db.prepare('UPDATE device_registry SET location = ? WHERE room_id = ?').run(data.name, roomId);

      if (roomId === 'room-001') {
        const legacy = this.management.settings();
        if (legacy.room_name !== data.name) {
          const { revision, updated_at, updated_by, ...doc } = legacy;
          doc.room_name = data.name;
          this.db
            .prepare('UPDATE facility_settings SET revision = revision + 1, document = ?, updated_at = ?, updated_by = ? WHERE id = 1')
            .run(JSON.stringify(doc), ts, actor.username);
        }
      }

      this.management.audit(actor, 'ROOM_UPDATED', roomId, { room_code: data.room_code, name: data.name }, requestId);
      return this.getRoom(roomId);
    })();
  }

  archiveRoom(roomId, actor, requestId) {
    return this.db.transaction(() => {
      const current = this.db.prepare('SELECT * FROM rooms WHERE room_id = ?').get(roomId);
      if (!current) error(404, 'ROOM_NOT_FOUND', 'Room was not found');
      if (roomId === 'room-001') {
        error(409, 'DEFAULT_ROOM_PROTECTED', 'The primary baseline room cannot be archived');
      }
      const activeDeviceCount = this.db
        .prepare('SELECT COUNT(*) AS n FROM device_registry WHERE room_id = ? AND archived_at IS NULL')
        .get(roomId).n;
      if (activeDeviceCount > 0) {
        error(409, 'ROOM_HAS_ACTIVE_DEVICES', 'Move or archive all active devices in this room before archiving it');
      }
      const ts = iso(this.clock());
      this.db
        .prepare("UPDATE rooms SET status = 'ARCHIVED', version = version + 1, updated_at = ? WHERE room_id = ?")
        .run(ts, roomId);
      this.management.audit(actor, 'ROOM_ARCHIVED', roomId, { room_code: current.room_code }, requestId);
      return this.getRoom(roomId);
    })();
  }

  restoreRoom(roomId, actor, requestId) {
    return this.db.transaction(() => {
      const current = this.db.prepare('SELECT * FROM rooms WHERE room_id = ?').get(roomId);
      if (!current) error(404, 'ROOM_NOT_FOUND', 'Room was not found');
      const ts = iso(this.clock());
      this.db
        .prepare("UPDATE rooms SET status = 'ACTIVE', version = version + 1, updated_at = ? WHERE room_id = ?")
        .run(ts, roomId);
      this.management.audit(actor, 'ROOM_RESTORED', roomId, { room_code: current.room_code }, requestId);
      return this.getRoom(roomId);
    })();
  }

  moveDeviceToRoom(deviceId, targetRoomId, version, actor, requestId) {
    return this.db.transaction(() => {
      const current = this.device(deviceId);
      if (version !== current.version) {
        error(409, 'VERSION_CONFLICT', 'Refresh the device before moving it to another room');
      }
      const targetRoom = this.db.prepare('SELECT * FROM rooms WHERE room_id = ?').get(targetRoomId);
      if (!targetRoom) error(404, 'ROOM_NOT_FOUND', 'Target room was not found');
      if (targetRoom.status !== 'ACTIVE') {
        error(409, 'ROOM_ARCHIVED', 'Cannot assign a device to an archived room');
      }
      if (current.room_id === targetRoomId) {
        return current;
      }
      const ts = iso(this.clock());
      this.db
        .prepare(
          `UPDATE device_registry
           SET room_id = ?, location = ?, version = version + 1, updated_at = ?
           WHERE device_id = ?`
        )
        .run(targetRoomId, targetRoom.name, ts, deviceId);
      this.management.audit(
        actor,
        'DEVICE_MOVED',
        deviceId,
        { from_room_id: current.room_id, to_room_id: targetRoomId, to_room_code: targetRoom.room_code },
        requestId
      );
      this.notify({
        category: 'DEVICE',
        severity: 'INFO',
        title: 'Device reassigned to room',
        message: `${current.name} moved to ${targetRoom.name} (${targetRoom.room_code}); telemetry history preserved.`,
        device_id: deviceId
      });
      return this.device(deviceId);
    })();
  }

  archiveDevice(deviceId, actor, requestId) {
    return this.db.transaction(() => {
      const current = this.device(deviceId);
      if (current.slot) {
        error(409, 'LEGACY_PROFILE_LOCKED', 'Built-in baseline nodes can be disabled but not archived');
      }
      const ts = iso(this.clock());
      this.db
        .prepare(
          'UPDATE device_registry SET enabled = 0, archived_at = ?, version = version + 1, updated_at = ? WHERE device_id = ?'
        )
        .run(ts, ts, deviceId);
      this.resolveDeviceAlarms(deviceId, actor.username, 'Device archived; monitoring suppressed');
      this.management.audit(actor, 'DEVICE_ARCHIVED', deviceId, { name: current.name }, requestId);
      return this.device(deviceId);
    })();
  }

  restoreDevice(deviceId, actor, requestId) {
    return this.db.transaction(() => {
      const current = this.device(deviceId);
      const room = this.db.prepare('SELECT status FROM rooms WHERE room_id = ?').get(current.room_id);
      if (!room || room.status !== 'ACTIVE') {
        error(409, 'ROOM_ARCHIVED', 'Restore the assigned room or move this device before restoring it');
      }
      const ts = iso(this.clock());
      this.db
        .prepare('UPDATE device_registry SET archived_at = NULL, version = version + 1, updated_at = ? WHERE device_id = ?')
        .run(ts, deviceId);
      this.management.audit(actor, 'DEVICE_RESTORED', deviceId, { name: current.name }, requestId);
      return this.device(deviceId);
    })();
  }

  setMqttIdentityStatus(deviceId, status, version, actor, requestId) {
    return this.db.transaction(() => {
      const current = this.device(deviceId);
      if (version !== current.version) {
        error(409, 'VERSION_CONFLICT', 'Refresh the device before updating MQTT identity status');
      }
      const ts = iso(this.clock());
      this.db
        .prepare('UPDATE device_registry SET mqtt_identity_status = ?, version = version + 1, updated_at = ? WHERE device_id = ?')
        .run(status, ts, deviceId);
      this.management.audit(actor, 'MQTT_IDENTITY_STATUS_UPDATED', deviceId, { status }, requestId);
      return this.device(deviceId);
    })();
  }

  // --------------------------------------------------------------------------
  // NOTIFICATIONS
  // --------------------------------------------------------------------------

  notify({
    category = 'SYSTEM',
    severity = 'INFO',
    title,
    message = '',
    device_id = null,
    alarm_id = null,
    audience = 'ALL',
    owner_id = null,
    dedup_key = null,
    cooldown_s = 0
  }) {
    if (
      dedup_key &&
      cooldown_s > 0 &&
      this.db
        .prepare('SELECT 1 FROM notifications WHERE dedup_key = ? AND timestamp >= ?')
        .get(dedup_key, iso(this.clock() - cooldown_s * 1000))
    ) {
      return;
    }
    this.db
      .prepare(
        'INSERT INTO notifications(timestamp,category,severity,title,message,device_id,alarm_id,audience,owner_id,dedup_key) VALUES(?,?,?,?,?,?,?,?,?,?)'
      )
      .run(
        iso(this.clock()),
        category,
        severity,
        String(title || '').slice(0, 120),
        String(message || '').slice(0, 300),
        device_id,
        alarm_id,
        audience,
        owner_id,
        dedup_key
      );
  }

  // --------------------------------------------------------------------------
  // GENERIC DEVICE & ENDPOINT ENGINE
  // --------------------------------------------------------------------------

  _computeManifestDrift(endpoints, manifest) {
    if (!manifest || !Array.isArray(manifest.endpoints)) {
      return { has_drift: false, unexpected_keys: [], missing_keys: [], changed_keys: [] };
    }
    const registeredMap = new Map(endpoints.map((e) => [e.endpoint_key, e]));
    const manifestKeys = new Set();
    const unexpected = [];
    const changed = [];

    for (const announced of manifest.endpoints) {
      if (!announced?.endpoint_key) continue;
      manifestKeys.add(announced.endpoint_key);
      const registered = registeredMap.get(announced.endpoint_key);

      if (!registered || registered.kind !== announced.kind) {
        unexpected.push(announced.endpoint_key);
        continue;
      }

      const contractChanged =
        (announced.data_type !== undefined && announced.data_type !== registered.data_type) ||
        (announced.writable !== undefined && Boolean(announced.writable) !== Boolean(registered.writable)) ||
        (announced.unit !== undefined && announced.unit !== (registered.unit || ''));

      if (contractChanged) changed.push(announced.endpoint_key);
    }

    const missing = endpoints
      .filter((endpoint) => !manifestKeys.has(endpoint.endpoint_key))
      .map((endpoint) => endpoint.endpoint_key);

    return {
      has_drift: unexpected.length > 0 || missing.length > 0 || changed.length > 0,
      unexpected_keys: unexpected,
      missing_keys: missing,
      changed_keys: changed
    };
  }

  device(id) {
    const d = this.db
      .prepare(
        `SELECT dr.*, r.room_code, r.name AS room_name, r.status AS room_status
         FROM device_registry dr
         LEFT JOIN rooms r ON r.room_id = dr.room_id
         WHERE dr.device_id = ?`
      )
      .get(id);
    if (!d) error(404, 'DEVICE_NOT_FOUND', 'Device was not found');
    const o = this.db.prepare('SELECT * FROM device_observations WHERE device_id = ?').get(id);
    const legacy = d.slot ? this.mqttService.getHealthStatus().observed_nodes?.[id] : null;
    const last = [o?.last_seen_at, d.heartbeat_at, legacy?.last_seen_at].filter(Boolean).sort().at(-1) || null;
    const age = last ? Math.max(0, this.clock() - Date.parse(last)) : null;
    const telemetryAge = o ? Math.max(0, this.clock() - Date.parse(o.last_seen_at)) : null;
    const transportUp =
      this.simulation || !['LEGACY_V1', 'MQTT_V1'].includes(d.transport) || this.mqttService.isConnected();
    const values = parseJson(o?.values_json, {});

    const epStates = new Map(
      this.db
        .prepare('SELECT * FROM device_endpoint_state WHERE device_id = ?')
        .all(id)
        .map((row) => [row.endpoint_key, row])
    );

    const endpoints = this.db
      .prepare('SELECT * FROM device_endpoints WHERE device_id = ? ORDER BY endpoint_key')
      .all(id)
      .map((e) => {
        const stateRow = epStates.get(e.endpoint_key);
        const epSeenAt = stateRow?.last_seen_at || (e.endpoint_key in values ? o?.last_seen_at : null) || null;
        const epAgeMs = epSeenAt ? Math.max(0, this.clock() - Date.parse(epSeenAt)) : null;
        const epFresh = Boolean(d.enabled && !d.archived_at && transportUp && epAgeMs !== null && epAgeMs <= d.stale_after_s * 1000);
        const epVal = stateRow ? parseJson(stateRow.last_value_json, null) : (e.endpoint_key in values ? values[e.endpoint_key] : null);
        const displayConfig = parseJson(e.display_config_json, {});
        const allowedValues = e.allowed_values_json ? parseJson(e.allowed_values_json, null) : null;
        const normalizedEp = {
          device_id: e.device_id,
          endpoint_key: e.endpoint_key,
          label: e.label,
          description: e.description || '',
          kind: e.kind,
          capability: e.kind,
          data_type: e.data_type || defaultDataTypeForKind(e.kind),
          unit: e.unit || '',
          readable: Boolean(e.readable ?? 1),
          writable: Boolean(e.writable),
          retention_enabled: Boolean(e.retention_enabled ?? 1),
          min_value: e.min_value ?? null,
          max_value: e.max_value ?? null,
          allowed_values: allowedValues,
          display_config: displayConfig,
          command_profile: e.command_profile || null,
          version: e.version || 1,
          last_value: epVal,
          last_seen_at: epSeenAt,
          age_ms: epAgeMs,
          fresh: epFresh,
          status: !d.enabled || d.archived_at ? 'DISABLED' : !transportUp ? 'UNKNOWN' : epAgeMs === null ? 'UNKNOWN' : epFresh ? 'ONLINE' : 'STALE'
        };
        normalizedEp.widget_type = resolveWidgetType(normalizedEp);
        return normalizedEp;
      });

    const manifest = d.manifest_json ? parseJson(d.manifest_json, null) : null;
    const manifestDrift = this._computeManifestDrift(endpoints, manifest);
    const inMaintenance = Boolean(d.maintenance_until && d.maintenance_until > iso(this.clock()));
    const archived = Boolean(d.archived_at);

    return {
      ...d,
      enabled: Boolean(d.enabled),
      archived,
      endpoints,
      values,
      manifest,
      manifest_drift: manifestDrift,
      last_seen_at: last,
      age_ms: age,
      telemetry_age_ms: telemetryAge,
      fresh: Boolean(d.enabled && !archived && transportUp && age !== null && age <= d.stale_after_s * 1000),
      telemetry_fresh: Boolean(
        d.enabled && !archived && transportUp && telemetryAge !== null && telemetryAge <= d.stale_after_s * 1000
      ),
      status: archived
        ? 'ARCHIVED'
        : !d.enabled
          ? 'DISABLED'
          : !transportUp
            ? 'UNKNOWN'
            : age === null
              ? 'UNKNOWN'
              : age > d.stale_after_s * 1000
                ? 'STALE'
                : 'ONLINE',
      in_maintenance: inMaintenance,
      mqtt_base: d.transport === 'MQTT_V1' ? cleanTopic(id) : null,
      simulation: this.simulation
    };
  }

  listDevices({ room_id = '', include_archived = false, transport = '', search = '' } = {}) {
    const where = ['1=1'];
    const args = [];
    if (!include_archived) {
      where.push('archived_at IS NULL');
    }
    if (room_id) {
      where.push('room_id = ?');
      args.push(room_id);
    }
    if (transport) {
      where.push('transport = ?');
      args.push(transport);
    }
    if (search) {
      const pattern = `%${String(search).replace(/[\\%_]/g, '\\$&')}%`;
      where.push("(device_id LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
      args.push(pattern, pattern, pattern);
    }
    return this.db
      .prepare(`SELECT device_id FROM device_registry WHERE ${where.join(' AND ')} ORDER BY slot IS NULL, slot, created_at, device_id`)
      .all(...args)
      .map((d) => this.device(d.device_id));
  }

  validateLegacySettings(data) {
    for (const [slot, n] of Object.entries(data.nodes)) {
      const current = this.db.prepare('SELECT port FROM device_registry WHERE slot = ?').get(slot);
      if (
        this.db
          .prepare("SELECT 1 FROM device_registry WHERE ip = ? AND port = ? AND enabled = 1 AND archived_at IS NULL AND ip != '' AND slot IS NULL")
          .get(n.ip, current?.port || 80)
      ) {
        error(409, 'DEVICE_ADDRESS_CONFLICT', 'This address is assigned to another registered node');
      }
    }
  }

  syncLegacy(settings) {
    // Two-step update allows atomic swaps of two built-in addresses.
    this.db.prepare('UPDATE device_registry SET enabled = 0 WHERE slot IS NOT NULL AND enabled = 1').run();
    for (const [slot, n] of Object.entries(settings.nodes)) {
      this.db
        .prepare('UPDATE device_registry SET name = ?, ip = ?, version = version + 1, updated_at = ? WHERE slot = ?')
        .run(n.name, n.ip, iso(this.clock()), slot);
    }
    // Called with remembered enable state to avoid re-enabling a disabled node.
    for (const id of this._legacyEnabled || []) {
      this.db.prepare('UPDATE device_registry SET enabled = 1 WHERE device_id = ?').run(id);
    }
    // Keep facility and default room names synchronized when updated via legacy /settings
    const ts = iso(this.clock());
    if (settings.facility_name) {
      this.db
        .prepare("UPDATE facilities SET name = ?, updated_at = ? WHERE facility_id = 'facility-default'")
        .run(settings.facility_name, ts);
    }
    if (settings.room_name) {
      this.db
        .prepare("UPDATE rooms SET name = ?, updated_at = ? WHERE room_id = 'room-001'")
        .run(settings.room_name, ts);
    }
  }

  beforeLegacySync(data) {
    this.validateLegacySettings(data);
    this._legacyEnabled = this.db
      .prepare('SELECT device_id FROM device_registry WHERE slot IS NOT NULL AND enabled = 1')
      .all()
      .map((d) => d.device_id);
  }

  saveDevice(data, actor, requestId, existingId = null) {
    const result = this.db.transaction(() => {
      const old = existingId ? this.device(existingId) : null;
      if (!old && this.db.prepare('SELECT COUNT(*) AS n FROM device_registry WHERE archived_at IS NULL').get().n >= 512) {
        error(409, 'REGISTRY_LIMIT', 'This release supports up to 512 active registered nodes');
      }
      if (old && (data.device_id !== existingId || data.version !== old.version)) {
        error(409, 'VERSION_CONFLICT', 'Refresh the device before saving; identity is immutable');
      }
      if (!old && this.db.prepare('SELECT 1 FROM device_registry WHERE device_id = ?').get(data.device_id)) {
        error(409, 'DEVICE_EXISTS', 'Device identity is already registered');
      }
      if (!old && ['lci_backend', 'node1_access', 'node2_env', 'vision_service'].includes(data.device_id)) {
        error(400, 'RESERVED_ID', 'This identity is reserved for a service');
      }
      if (data.transport === 'LEGACY_V1' && (!old?.slot || data.device_type !== old.device_type)) {
        error(400, 'LEGACY_PROFILE_LOCKED', 'Built-in protocol profiles cannot be assigned to additional devices');
      }
      if (
        old?.slot &&
        (data.transport !== 'LEGACY_V1' ||
          JSON.stringify(data.endpoints.map((e) => [e.endpoint_key, e.kind, e.writable]).sort()) !==
            JSON.stringify(old.endpoints.map((e) => [e.endpoint_key, e.kind, e.writable]).sort()))
      ) {
        error(409, 'LEGACY_PROFILE_LOCKED', 'Use the existing built-in endpoint profile');
      }

      const targetRoomId = data.room_id || old?.room_id || 'room-001';
      const room = this.db.prepare('SELECT * FROM rooms WHERE room_id = ?').get(targetRoomId);
      if (!room) error(404, 'ROOM_NOT_FOUND', `Room "${targetRoomId}" was not found`);
      if (room.status !== 'ACTIVE' && (!old || old.room_id !== targetRoomId)) {
        error(409, 'ROOM_ARCHIVED', 'Assign devices to an active room');
      }

      const normalizedIp = data.ip ? String(data.ip).trim() : '';
      if (
        data.enabled &&
        normalizedIp &&
        this.db
          .prepare(
            "SELECT 1 FROM device_registry WHERE ip = ? AND port = ? AND enabled = 1 AND archived_at IS NULL AND ip != '' AND device_id != ?"
          )
          .get(normalizedIp, data.port, data.device_id)
      ) {
        error(409, 'DEVICE_ADDRESS_CONFLICT', 'An enabled device already uses this address and port');
      }

      // Endpoint shape changes are a new device contract; reject while rules/commands still depend on it.
      if (old && !old.slot) {
        const referenced = this.db
          .prepare('SELECT endpoint_key FROM alarm_rules WHERE device_id = ? AND enabled = 1')
          .all(old.device_id);
        if (
          referenced.some(
            (r) => !data.endpoints.some((e) => e.endpoint_key === r.endpoint_key && e.kind === 'SENSOR')
          )
        ) {
          error(409, 'ENDPOINT_IN_USE', 'Disable dependent rules before removing their sensor endpoint');
        }
        if (
          this.db
            .prepare("SELECT 1 FROM device_commands WHERE device_id = ? AND state IN ('PUBLISHED','ACKNOWLEDGED')")
            .get(old.device_id)
        ) {
          error(409, 'COMMAND_PENDING', 'Wait for the active command before editing this device');
        }
      }

      const defaultMqttStatus =
        data.transport === 'LEGACY_V1'
          ? 'LEGACY'
          : data.transport === 'MQTT_V1'
            ? old?.mqtt_identity_status === 'PROVISIONED'
              ? 'PROVISIONED'
              : 'UNPROVISIONED'
            : 'NOT_APPLICABLE';
      const mqttIdentityStatus = data.mqtt_identity_status || defaultMqttStatus;
      const locationLabel = room.name || data.location || 'room-001';
      const timestamp = iso(this.clock());

      if (old) {
        this.db
          .prepare(
            `UPDATE device_registry
             SET room_id = ?, name = ?, description = ?, location = ?, device_type = ?, transport = ?,
                 ip = ?, port = ?, path = ?, enabled = ?, stale_after_s = ?, protocol_version = ?,
                 mqtt_identity_status = ?, version = version + 1, updated_at = ?
             WHERE device_id = ?`
          )
          .run(
            targetRoomId,
            data.name,
            data.description,
            locationLabel,
            data.device_type,
            data.transport,
            normalizedIp,
            data.port,
            data.path,
            Number(data.enabled),
            data.stale_after_s,
            data.protocol_version || '1',
            mqttIdentityStatus,
            timestamp,
            existingId
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO device_registry
             (device_id, room_id, name, description, location, device_type, transport, ip, port, path, enabled, stale_after_s, protocol_version, mqtt_identity_status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            data.device_id,
            targetRoomId,
            data.name,
            data.description,
            locationLabel,
            data.device_type,
            data.transport,
            normalizedIp,
            data.port,
            data.path,
            Number(data.enabled),
            data.stale_after_s,
            data.protocol_version || '1',
            mqttIdentityStatus,
            timestamp,
            timestamp
          );
      }

      this.db.prepare('DELETE FROM device_endpoints WHERE device_id = ?').run(data.device_id);
      for (const e of data.endpoints) {
        this.db
          .prepare(
            `INSERT INTO device_endpoints
             (device_id, endpoint_key, label, description, kind, data_type, unit, readable, writable, retention_enabled, min_value, max_value, allowed_values_json, display_config_json, command_profile)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            data.device_id,
            e.endpoint_key,
            e.label,
            e.description || '',
            e.kind,
            e.data_type || defaultDataTypeForKind(e.kind),
            e.unit || '',
            Number(e.readable ?? true),
            Number(e.writable ?? false),
            Number(e.retention_enabled ?? true),
            e.min_value ?? null,
            e.max_value ?? null,
            e.allowed_values ? JSON.stringify(e.allowed_values) : null,
            JSON.stringify(e.display_config || {}),
            e.command_profile ?? null
          );
      }

      if (old?.slot) {
        const s = this.management.settings();
        s.nodes[old.slot] = { name: data.name, ip: normalizedIp };
        const { revision, updated_at, updated_by, ...document } = s;
        this.db
          .prepare('UPDATE facility_settings SET revision = revision + 1, document = ?, updated_at = ?, updated_by = ? WHERE id = 1')
          .run(JSON.stringify(document), timestamp, actor.username);
      }

      if (old && (old.ip !== normalizedIp || old.port !== data.port || old.transport !== data.transport)) {
        this.db.prepare('DELETE FROM device_observations WHERE device_id = ?').run(data.device_id);
        this.db.prepare('DELETE FROM device_endpoint_state WHERE device_id = ?').run(data.device_id);
        this.db.prepare('UPDATE device_registry SET heartbeat_at = NULL WHERE device_id = ?').run(data.device_id);
      }

      // Mark any quarantined pending device record as APPROVED when registered
      this.db
        .prepare("UPDATE pending_devices SET status = 'APPROVED', reviewed_by = ?, reviewed_at = ? WHERE device_id = ? AND status = 'PENDING'")
        .run(actor.username, timestamp, data.device_id);

      this.management.audit(
        actor,
        old ? 'DEVICE_UPDATED' : 'DEVICE_CREATED',
        data.device_id,
        { room_id: targetRoomId, type: data.device_type, transport: data.transport, enabled: data.enabled },
        requestId
      );
      this.notify({
        category: 'DEVICE',
        title: old ? 'Device configuration updated' : 'Device registered',
        message: `${data.name} (${room.room_code})`,
        device_id: data.device_id,
        dedup_key: `DEVICE_CONFIG:${data.device_id}`,
        cooldown_s: 5
      });
      if (!data.enabled) {
        this.resolveDeviceAlarms(data.device_id, actor.username, 'Device disabled; monitoring suppressed');
        this.mqttService.nodeHeartbeats?.delete(data.device_id);
      }
      return this.device(data.device_id);
    })();
    this.management.applyRuntimeIps(this.management.settings());
    return result;
  }

  maintenance(id, data, actor, requestId) {
    this.device(id);
    return this.db.transaction(() => {
      const until = data.minutes ? iso(this.clock() + data.minutes * 60000) : null;
      this.db
        .prepare(
          'UPDATE device_registry SET maintenance_until = ?, maintenance_reason = ?, version = version + 1, updated_at = ? WHERE device_id = ?'
        )
        .run(until, data.reason, iso(this.clock()), id);
      this.management.audit(actor, 'DEVICE_MAINTENANCE', id, { until, reason: data.reason }, requestId);
      this.db.prepare('UPDATE alarm_rules SET pending_since = NULL, recovery_since = NULL WHERE device_id = ?').run(id);
      return this.device(id);
    })();
  }

  // --------------------------------------------------------------------------
  // PENDING DEVICE QUARANTINE & MANIFEST APPROVAL
  // --------------------------------------------------------------------------

  recordPendingDevice(id, raw) {
    const parsed = heartbeatSchema.safeParse(raw);
    if (!parsed.success || parsed.data.device_id !== id) {
      return { ok: false, error: 'INVALID_HEARTBEAT' };
    }
    if (['lci_backend', 'node1_access', 'node2_env', 'vision_service'].includes(id)) {
      return { ok: false, error: 'RESERVED_ID' };
    }
    const p = parsed.data;
    const ts = iso(this.clock());
    const manifestObj = {
      protocol_version: p.protocol_version || '1',
      manifest_version: p.manifest_version || null,
      capabilities: p.capabilities || [],
      endpoints: p.endpoints || []
    };
    const existing = this.db.prepare('SELECT status FROM pending_devices WHERE device_id = ?').get(id);
    if (existing) {
      this.db
        .prepare(
          `UPDATE pending_devices
           SET last_seen_at = ?, firmware_version = COALESCE(?, firmware_version),
               protocol_version = COALESCE(?, protocol_version),
               manifest_version = COALESCE(?, manifest_version),
               manifest_json = ?
           WHERE device_id = ?`
        )
        .run(ts, p.firmware_version || null, p.protocol_version || null, p.manifest_version || null, JSON.stringify(manifestObj), id);
    } else {
      this.db
        .prepare(
          `INSERT INTO pending_devices
           (device_id, first_seen_at, last_seen_at, firmware_version, protocol_version, manifest_version, manifest_json, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`
        )
        .run(
          id,
          ts,
          ts,
          p.firmware_version || null,
          p.protocol_version || '1',
          p.manifest_version || null,
          JSON.stringify(manifestObj)
        );
      this.notify({
        category: 'DEVICE',
        severity: 'WARNING',
        title: 'Unregistered device awaiting approval',
        message: `Device "${id}" announced a heartbeat/manifest. Review and approve before accepting telemetry or commands.`,
        device_id: id,
        audience: 'ADMIN',
        dedup_key: `PENDING_DEVICE:${id}`,
        cooldown_s: 300
      });
    }
    return { ok: false, error: 'DEVICE_PENDING_APPROVAL', pending: true };
  }

  listPendingDevices({ status = 'PENDING' } = {}) {
    const rows = status
      ? this.db.prepare('SELECT * FROM pending_devices WHERE status = ? ORDER BY last_seen_at DESC').all(status)
      : this.db.prepare('SELECT * FROM pending_devices ORDER BY last_seen_at DESC').all();
    return rows.map((r) => ({ ...r, manifest: parseJson(r.manifest_json, {}) }));
  }

  dismissPendingDevice(deviceId, actor, requestId) {
    const row = this.db.prepare('SELECT * FROM pending_devices WHERE device_id = ?').get(deviceId);
    if (!row) error(404, 'PENDING_DEVICE_NOT_FOUND', 'Pending device record was not found');
    const ts = iso(this.clock());
    this.db
      .prepare("UPDATE pending_devices SET status = 'DISMISSED', reviewed_by = ?, reviewed_at = ? WHERE device_id = ?")
      .run(actor.username, ts, deviceId);
    this.management.audit(actor, 'PENDING_DEVICE_DISMISSED', deviceId, {}, requestId);
    return { device_id: deviceId, status: 'DISMISSED' };
  }

  // --------------------------------------------------------------------------
  // TELEMETRY INGESTION, PER-ENDPOINT VALIDATION & HEARTBEAT
  // --------------------------------------------------------------------------

  _validateEndpointValue(endpoint, value) {
    const kind = endpoint.kind;
    const dt = endpoint.data_type || defaultDataTypeForKind(kind);
    if (kind === 'SENSOR') {
      if (dt === 'NUMBER') {
        if (typeof value !== 'number' || !Number.isFinite(value)) return false;
        if (typeof endpoint.min_value === 'number' && value < endpoint.min_value) return false;
        if (typeof endpoint.max_value === 'number' && value > endpoint.max_value) return false;
        return true;
      }
      if (dt === 'BOOLEAN') return typeof value === 'boolean';
      return false;
    }
    if (kind === 'SWITCH') {
      if (dt === 'BOOLEAN') return typeof value === 'boolean';
      return ['ON', 'OFF'].includes(value);
    }
    if (kind === 'ACCESS') {
      return ['OPEN', 'CLOSED', 'LOCKED', 'UNLOCKED'].includes(value);
    }
    if (kind === 'CAMERA') {
      return typeof value === 'boolean';
    }
    return false;
  }

  ingest(id, raw) {
    const parsed = frameSchema.safeParse(raw);
    if (!parsed.success || parsed.data.device_id !== id) return { ok: false, error: 'INVALID_FRAME' };
    const existing = this.db.prepare('SELECT 1 FROM device_registry WHERE device_id = ?').get(id);
    if (!existing) return { ok: false, error: 'DEVICE_NOT_REGISTERED' };
    const d = this.device(id);
    const p = parsed.data;
    if (!d.enabled || d.archived) return { ok: false, error: 'DEVICE_DISABLED' };
    const entries = Object.entries(p.values);
    if (entries.length > 24 || entries.length === 0) {
      return { ok: false, error: 'ENDPOINT_CONTRACT_MISMATCH' };
    }
    for (const [key, val] of entries) {
      const ep = d.endpoints.find((e) => e.endpoint_key === key);
      if (!ep || !this._validateEndpointValue(ep, val)) {
        return { ok: false, error: 'ENDPOINT_CONTRACT_MISMATCH' };
      }
    }

    const current = this.db.prepare('SELECT boot_id, seq FROM device_observations WHERE device_id = ?').get(id);
    if (
      current &&
      ((current.boot_id === p.boot_id && p.seq <= current.seq) ||
        (current.boot_id !== p.boot_id &&
          this.db.prepare('SELECT 1 FROM device_frames WHERE device_id = ? AND boot_id = ?').get(id, p.boot_id)))
    ) {
      return { ok: false, error: 'DUPLICATE_OR_OLD_FRAME' };
    }

    const timestamp = iso(this.clock());
    const outcome = this.db.transaction(() => {
      const inserted = this.db
        .prepare('INSERT OR IGNORE INTO device_frames(device_id,boot_id,seq,received_at,values_json) VALUES(?,?,?,?,?)')
        .run(id, p.boot_id, p.seq, timestamp, JSON.stringify(p.values));
      if (!inserted.changes) return { ok: false, error: 'DUPLICATE_OR_OLD_FRAME' };

      // Merge into latest observation values so partial frames don't erase sibling endpoints
      const mergedValues = { ...d.values, ...p.values };
      this.db
        .prepare(
          `INSERT INTO device_observations(device_id,boot_id,seq,last_seen_at,values_json)
           VALUES(?,?,?,?,?)
           ON CONFLICT(device_id) DO UPDATE SET
             boot_id = excluded.boot_id,
             seq = excluded.seq,
             last_seen_at = excluded.last_seen_at,
             values_json = excluded.values_json`
        )
        .run(id, p.boot_id, p.seq, timestamp, JSON.stringify(mergedValues));

      const upsertEp = this.db.prepare(
        `INSERT INTO device_endpoint_state(device_id,endpoint_key,last_value_json,last_seen_at,boot_id,seq)
         VALUES(?,?,?,?,?,?)
         ON CONFLICT(device_id,endpoint_key) DO UPDATE SET
           last_value_json = excluded.last_value_json,
           last_seen_at = excluded.last_seen_at,
           boot_id = excluded.boot_id,
           seq = excluded.seq`
      );
      for (const [key, val] of entries) {
        upsertEp.run(id, key, JSON.stringify(val), timestamp, p.boot_id, p.seq);
      }

      this.evaluateDevice(id);
      return { ok: true };
    })();

    if (outcome.ok && this.wsGateway) {
      this.wsGateway.broadcastTelemetry({
        type: 'device_telemetry',
        device_id: id,
        room_id: d.room_id,
        timestamp,
        values: p.values
      });
    }
    return outcome;
  }

  ingestLegacy(id, values, meta = {}) {
    if (!this.db.prepare('SELECT 1 FROM device_registry WHERE device_id = ?').get(id)) return;
    const d = this.device(id);
    const allowed = Object.fromEntries(
      Object.entries(values).filter(
        ([k, v]) => d.endpoints.some((e) => e.endpoint_key === k && this._validateEndpointValue(e, v))
      )
    );
    if (!Object.keys(allowed).length) return;
    const current = this.db.prepare('SELECT seq FROM device_observations WHERE device_id = ?').get(id);
    this.ingest(id, {
      schema_version: 1,
      device_id: id,
      boot_id: meta.boot_id || 'legacy-server-stream',
      seq: meta.seq ?? (current?.seq || 0) + 1,
      values: allowed
    });
  }

  heartbeat(id, raw) {
    const p = heartbeatSchema.safeParse(raw);
    if (!p.success || p.data.device_id !== id) return { ok: false, error: 'INVALID_HEARTBEAT' };
    const exists = this.db.prepare('SELECT 1 FROM device_registry WHERE device_id = ?').get(id);
    if (!exists) {
      return this.recordPendingDevice(id, raw);
    }
    const d = this.device(id);
    if (!d.enabled || d.archived) return { ok: false, error: 'DEVICE_DISABLED' };

    const ts = iso(this.clock());
    const hasManifestPayload = Boolean(p.data.manifest_version || p.data.capabilities || p.data.endpoints);
    const manifestObj = hasManifestPayload
      ? {
          protocol_version: p.data.protocol_version || d.protocol_version || '1',
          manifest_version: p.data.manifest_version || null,
          capabilities: p.data.capabilities || [],
          endpoints: p.data.endpoints || []
        }
      : null;

    this.db
      .prepare(
        `UPDATE device_registry
         SET heartbeat_at = ?,
             firmware_version = COALESCE(?, firmware_version),
             protocol_version = COALESCE(?, protocol_version),
             capability_manifest_version = COALESCE(?, capability_manifest_version),
             manifest_json = COALESCE(?, manifest_json)
         WHERE device_id = ?`
      )
      .run(
        ts,
        p.data.firmware_version || null,
        p.data.protocol_version || null,
        p.data.manifest_version || null,
        manifestObj ? JSON.stringify(manifestObj) : null,
        id
      );

    if (manifestObj) {
      const drift = this._computeManifestDrift(d.endpoints, manifestObj);
      if (drift.has_drift) {
        this.notify({
          category: 'SYSTEM',
          severity: 'WARNING',
          title: 'Device manifest drift detected',
          message: `${d.name} announced endpoints differing from its approved registry schema (unexpected: ${drift.unexpected_keys.join(', ') || 'none'}). Operational schema was not altered automatically.`,
          device_id: id,
          audience: 'ADMIN',
          dedup_key: `MANIFEST_DRIFT:${id}:${p.data.manifest_version || 'v1'}`,
          cooldown_s: 300
        });
      }
    }

    return { ok: true };
  }

  getEndpointHistory(deviceId, endpointKey, { limit = 100, from = null, to = null } = {}) {
    const d = this.device(deviceId);
    const ep = d.endpoints.find((e) => e.endpoint_key === endpointKey);
    if (!ep) error(404, 'ENDPOINT_NOT_FOUND', `Endpoint "${endpointKey}" is not registered on "${deviceId}"`);

    const where = ['device_id = ?'];
    const args = [deviceId];
    if (from) {
      where.push('received_at >= ?');
      args.push(from);
    }
    if (to) {
      where.push('received_at <= ?');
      args.push(to);
    }

    const rows = this.db
      .prepare(`SELECT id, received_at, values_json FROM device_frames WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`)
      .all(...args, Math.min(Math.max(1, Number(limit) || 100), 500));

    const points = [];
    for (const row of rows) {
      const vals = parseJson(row.values_json, {});
      if (Object.prototype.hasOwnProperty.call(vals, endpointKey)) {
        points.push({ id: row.id, timestamp: row.received_at, value: vals[endpointKey] });
      }
    }
    points.reverse();

    let summary = { count: points.length };
    if (ep.data_type === 'NUMBER') {
      const nums = points.map((p) => p.value).filter((v) => typeof v === 'number' && Number.isFinite(v));
      if (nums.length > 0) {
        const sum = nums.reduce((acc, v) => acc + v, 0);
        summary = {
          count: nums.length,
          min: Math.min(...nums),
          max: Math.max(...nums),
          avg: Number((sum / nums.length).toFixed(2)),
          latest: nums[nums.length - 1]
        };
      }
    } else if (points.length > 0) {
      summary = { count: points.length, latest: points[points.length - 1].value };
    }

    return { device_id: deviceId, room_id: d.room_id, endpoint: ep, summary, points };
  }

  async probe(id) {
    const d = this.device(id);
    if (!d.enabled || d.archived) error(409, 'DEVICE_DISABLED', 'Device is disabled');
    if (this.simulation) {
      return {
        device: d,
        probe: {
          kind: 'SIMULATION',
          ok: d.fresh,
          note: 'Isolated simulation evidence only; no upstream network request'
        }
      };
    }
    if (d.transport === 'MQTT_V1' || (d.slot && d.slot !== 'node3')) {
      return {
        device: d,
        probe: {
          kind: 'PASSIVE',
          ok: d.fresh,
          note: 'Status uses validated incoming device observations; no network scan was performed.'
        }
      };
    }
    if (d.device_type === 'CAMERA') {
      return {
        device: d,
        probe: { kind: 'CAMERA', ok: d.fresh, note: 'Use Capture to test the configured JPEG endpoint.' }
      };
    }
    let response;
    try {
      response = await this.httpFetch(`http://${d.ip}:${d.port}${d.path}`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(3000),
        headers: { Accept: 'application/json' }
      });
      if (response.status !== 200 || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) {
        throw new Error('Invalid JSON response');
      }
      const reader = response.body.getReader();
      const parts = [];
      let size = 0;
      try {
        for (;;) {
          const c = await reader.read();
          if (c.done) break;
          size += c.value.length;
          if (size > 32768) throw new Error('Response too large');
          parts.push(Buffer.from(c.value));
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const result = this.ingest(id, JSON.parse(Buffer.concat(parts).toString('utf8')));
      if (!result.ok && result.error !== 'DUPLICATE_OR_OLD_FRAME') throw new Error('Contract mismatch');
      return {
        device: this.device(id),
        probe: {
          kind: 'HTTP_JSON',
          ok: true,
          ingest: result,
          note: result.ok
            ? 'New validated sample stored'
            : 'Endpoint responded; duplicate sample did not refresh telemetry age'
        }
      };
    } catch {
      await response?.body?.cancel().catch(() => {});
      error(502, 'PROBE_FAILED', 'Endpoint did not return a valid bounded v1 JSON telemetry frame');
    }
  }

  // --------------------------------------------------------------------------
  // GENERALIZED ALARM ENGINE (NUMERIC HIGH/LOW + BOOLEAN)
  // --------------------------------------------------------------------------

  saveRule(data, actor, requestId, id = null) {
    const d = this.device(data.device_id);
    const ep = d.endpoints.find((e) => e.endpoint_key === data.endpoint_key && e.kind === 'SENSOR');
    if (!ep) error(400, 'RULE_ENDPOINT_INVALID', 'Choose a registered sensor endpoint');
    const isBoolRule = data.condition_type === 'BOOLEAN_TRUE' || data.condition_type === 'BOOLEAN_FALSE';
    if (isBoolRule && ep.data_type !== 'BOOLEAN') {
      error(400, 'RULE_ENDPOINT_INVALID', 'Boolean alarm rules require a BOOLEAN sensor endpoint');
    }
    if (!isBoolRule && ep.data_type !== 'NUMBER') {
      error(400, 'RULE_ENDPOINT_INVALID', 'Threshold alarm rules require a NUMBER sensor endpoint');
    }
    return this.db.transaction(() => {
      const previous = id ? this.db.prepare('SELECT * FROM alarm_rules WHERE rule_id = ?').get(id) : null;
      if (id && !previous) error(404, 'RULE_NOT_FOUND', 'Rule was not found');
      if (previous && data.version !== previous.version) {
        error(409, 'VERSION_CONFLICT', 'Refresh the rule before saving');
      }
      if (previous && (previous.device_id !== data.device_id || previous.endpoint_key !== data.endpoint_key)) {
        error(409, 'RULE_TARGET_IMMUTABLE', 'Create a new rule for a different sensor');
      }
      const ruleId = id || crypto.randomUUID();
      if (id) {
        this.db
          .prepare(
            `UPDATE alarm_rules
             SET name = ?, severity = ?, condition_type = ?, threshold = ?, clear_threshold = ?,
                 hold_s = ?, clear_hold_s = ?, enabled = ?, version = version + 1,
                 pending_since = NULL, recovery_since = NULL
             WHERE rule_id = ?`
          )
          .run(
            data.name,
            data.severity,
            data.condition_type,
            data.threshold,
            data.clear_threshold,
            data.hold_s,
            data.clear_hold_s,
            Number(data.enabled),
            id
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO alarm_rules
             (rule_id, device_id, endpoint_key, name, severity, condition_type, threshold, clear_threshold, hold_s, clear_hold_s, enabled, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            ruleId,
            data.device_id,
            data.endpoint_key,
            data.name,
            data.severity,
            data.condition_type,
            data.threshold,
            data.clear_threshold,
            data.hold_s,
            data.clear_hold_s,
            Number(data.enabled),
            iso(this.clock())
          );
      }
      if (previous) {
        this.resolveByKey(
          `RULE:${ruleId}`,
          actor.username,
          data.enabled ? 'Rule configuration changed; awaiting new evaluation' : 'Rule disabled; monitoring suppressed'
        );
      }
      this.management.audit(
        actor,
        id ? 'ALARM_RULE_UPDATED' : 'ALARM_RULE_CREATED',
        ruleId,
        { device_id: data.device_id, endpoint_key: data.endpoint_key, condition_type: data.condition_type, enabled: data.enabled },
        requestId
      );
      return this.db.prepare('SELECT * FROM alarm_rules WHERE rule_id = ?').get(ruleId);
    })();
  }

  raise({ key, device_id, rule_id = null, title, severity = 'WARNING', evidence = {} }) {
    const existing = this.db.prepare("SELECT * FROM alarms WHERE dedup_key = ? AND state != 'RESOLVED'").get(key);
    if (existing) return existing.alarm_id;
    const id = crypto.randomUUID();
    const timestamp = iso(this.clock());
    this.db
      .prepare(
        "INSERT INTO alarms(alarm_id,dedup_key,device_id,rule_id,title,severity,state,raised_at,evidence) VALUES(?,?,?,?,?,?,'ACTIVE',?,?)"
      )
      .run(id, key, device_id, rule_id, title, severity, timestamp, JSON.stringify(evidence));
    this.db
      .prepare("INSERT INTO alarm_events(alarm_id,timestamp,actor,action) VALUES(?,?,'system','RAISED')")
      .run(id, timestamp);
    this.notify({
      category: 'ALARM',
      severity,
      title,
      message: 'New alarm requires operator review.',
      device_id,
      alarm_id: id
    });
    return id;
  }

  resolveByKey(key, actor, reason) {
    const a = this.db.prepare("SELECT * FROM alarms WHERE dedup_key = ? AND state != 'RESOLVED'").get(key);
    if (!a) return;
    this.db
      .prepare("UPDATE alarms SET state = 'RESOLVED', resolved_at = ?, resolved_by = ?, resolution = ? WHERE alarm_id = ?")
      .run(iso(this.clock()), actor, reason, a.alarm_id);
    this.db
      .prepare("INSERT INTO alarm_events(alarm_id,timestamp,actor,action,comment) VALUES(?,?,?,'RESOLVED',?)")
      .run(a.alarm_id, iso(this.clock()), actor, reason);
    this.notify({
      category: 'ALARM',
      severity: 'INFO',
      title: 'Alarm resolved',
      message: `${a.title}: ${reason}`,
      device_id: a.device_id,
      alarm_id: a.alarm_id
    });
  }

  resolveDeviceAlarms(id, actor, reason) {
    for (const a of this.db.prepare("SELECT dedup_key FROM alarms WHERE device_id = ? AND state != 'RESOLVED'").all(id)) {
      this.resolveByKey(a.dedup_key, actor, reason);
    }
  }

  _ruleCondition(rule, value) {
    const cond = rule.condition_type || 'THRESHOLD_HIGH';
    if (cond === 'BOOLEAN_TRUE') {
      if (typeof value !== 'boolean') return { valid: false };
      return { valid: true, breached: value === true, recovered: value === false };
    }
    if (cond === 'BOOLEAN_FALSE') {
      if (typeof value !== 'boolean') return { valid: false };
      return { valid: true, breached: value === false, recovered: value === true };
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) return { valid: false };
    if (cond === 'THRESHOLD_LOW') {
      return { valid: true, breached: value <= rule.threshold, recovered: value >= rule.clear_threshold };
    }
    return { valid: true, breached: value >= rule.threshold, recovered: value <= rule.clear_threshold };
  }

  alarmAction(id, action, comment, actor) {
    return this.db.transaction(() => {
      const a = this.db.prepare('SELECT * FROM alarms WHERE alarm_id = ?').get(id);
      if (!a) error(404, 'ALARM_NOT_FOUND', 'Alarm was not found');
      if (a.state === 'RESOLVED') error(409, 'ALARM_CLOSED', 'Alarm is already resolved');
      if (action === 'acknowledge') {
        if (a.state === 'ACKNOWLEDGED') return this.alarmDetail(id);
        this.db
          .prepare("UPDATE alarms SET state = 'ACKNOWLEDGED', acknowledged_at = ?, acknowledged_by = ? WHERE alarm_id = ?")
          .run(iso(this.clock()), actor.username, id);
        this.db
          .prepare("INSERT INTO alarm_events(alarm_id,timestamp,actor,action,comment) VALUES(?,?,?,'ACKNOWLEDGED',?)")
          .run(id, iso(this.clock()), actor.username, comment);
        this.notify({ category: 'ALARM', title: 'Alarm acknowledged', message: a.title, device_id: a.device_id, alarm_id: id });
      } else {
        const d = this.device(a.device_id);
        if (a.dedup_key.startsWith('RULE:')) {
          const r = this.db.prepare('SELECT * FROM alarm_rules WHERE rule_id = ?').get(a.rule_id);
          const ep = r ? d.endpoints.find((e) => e.endpoint_key === r.endpoint_key) : null;
          const evalRes = r ? this._ruleCondition(r, d.values[r.endpoint_key]) : null;
          if (r?.enabled && (!d.telemetry_fresh || !ep?.fresh || !evalRes?.valid || !evalRes.recovered)) {
            error(
              409,
              'CONDITION_STILL_ACTIVE',
              'Wait for fresh recovery evidence or disable the rule with an audited reason'
            );
          }
        } else if (a.dedup_key.startsWith('STALE:') && !this.monitorFresh(d)) {
          error(409, 'CONDITION_STILL_ACTIVE', 'Device data has not recovered');
        }
        this.resolveByKey(a.dedup_key, actor.username, comment);
      }
      return this.alarmDetail(id);
    })();
  }

  alarmDetail(id) {
    const a = this.db
      .prepare(
        `SELECT a.*, dr.name AS device_name, dr.room_id, r.name AS room_name, r.room_code
         FROM alarms a
         LEFT JOIN device_registry dr ON dr.device_id = a.device_id
         LEFT JOIN rooms r ON r.room_id = dr.room_id
         WHERE a.alarm_id = ?`
      )
      .get(id);
    if (!a) error(404, 'ALARM_NOT_FOUND', 'Alarm was not found');
    return {
      ...a,
      evidence: parseJson(a.evidence, {}),
      events: this.db.prepare('SELECT * FROM alarm_events WHERE alarm_id = ? ORDER BY id').all(id)
    };
  }

  monitorFresh(d) {
    return d.endpoints.some((e) => e.kind === 'SENSOR') ? d.telemetry_fresh : d.fresh;
  }

  evaluateDevice(id) {
    const d = this.device(id);
    if (!d.enabled || d.archived || d.in_maintenance) return;
    if (this.monitorFresh(d)) this.resolveByKey(`STALE:${id}`, 'system', 'Fresh device evidence received');
    for (const r of this.db.prepare('SELECT * FROM alarm_rules WHERE device_id = ? AND enabled = 1').all(id)) {
      const ep = d.endpoints.find((e) => e.endpoint_key === r.endpoint_key);
      const value = d.values[r.endpoint_key];
      const cond = this._ruleCondition(r, value);
      if (!d.telemetry_fresh || !ep?.fresh || !cond.valid) {
        this.db.prepare('UPDATE alarm_rules SET pending_since = NULL, recovery_since = NULL WHERE rule_id = ?').run(r.rule_id);
        continue;
      }
      const active = this.db
        .prepare("SELECT alarm_id FROM alarms WHERE dedup_key = ? AND state != 'RESOLVED'")
        .get(`RULE:${r.rule_id}`);
      if (!active && cond.breached) {
        const since = r.pending_since || iso(this.clock());
        this.db
          .prepare('UPDATE alarm_rules SET pending_since = ?, recovery_since = NULL WHERE rule_id = ?')
          .run(since, r.rule_id);
        if (this.clock() - Date.parse(since) >= r.hold_s * 1000) {
          this.raise({
            key: `RULE:${r.rule_id}`,
            device_id: id,
            rule_id: r.rule_id,
            title: r.name,
            severity: r.severity,
            evidence: {
              room_id: d.room_id,
              endpoint_key: r.endpoint_key,
              condition_type: r.condition_type || 'THRESHOLD_HIGH',
              value,
              unit: ep.unit,
              threshold: r.threshold
            }
          });
        }
      } else if (active && cond.recovered) {
        const since = r.recovery_since || iso(this.clock());
        this.db
          .prepare('UPDATE alarm_rules SET recovery_since = ?, pending_since = NULL WHERE rule_id = ?')
          .run(since, r.rule_id);
        if (this.clock() - Date.parse(since) >= r.clear_hold_s * 1000) {
          this.resolveByKey(`RULE:${r.rule_id}`, 'system', 'Fresh readings remained within the recovery condition');
          this.db.prepare('UPDATE alarm_rules SET pending_since = NULL, recovery_since = NULL WHERE rule_id = ?').run(r.rule_id);
        }
      } else {
        this.db.prepare('UPDATE alarm_rules SET pending_since = NULL, recovery_since = NULL WHERE rule_id = ?').run(r.rule_id);
      }
    }
  }

  // --------------------------------------------------------------------------
  // SAFE COMMAND DISPATCH & ACK LIFECYCLE
  // --------------------------------------------------------------------------

  async command(id, body, actor) {
    const d = this.device(id);
    const e = d.endpoints.find((ep) => ep.endpoint_key === body.endpoint_key);
    if (!d.enabled || d.archived || d.in_maintenance) {
      error(409, 'DEVICE_NOT_CONTROLLABLE', 'Device is disabled, archived, or in maintenance');
    }
    if (d.transport !== 'MQTT_V1' || !e?.writable || e.kind !== 'SWITCH') {
      error(400, 'COMMAND_UNSUPPORTED', 'This endpoint has no supported writable MQTT switch adapter');
    }
    if (!d.fresh) {
      error(409, 'DEVICE_NOT_FRESH', 'A fresh device observation is required before control');
    }
    const commandId = crypto.randomUUID();
    const timestamp = iso(this.clock());
    const expires = iso(this.clock() + 5000);
    this.db
      .prepare(
        "INSERT INTO device_commands(command_id,device_id,endpoint_key,requested_value,state,actor,issued_at,expires_at,updated_at) VALUES(?,?,?,?,'PUBLISHED',?,?,?,?)"
      )
      .run(commandId, id, e.endpoint_key, body.value, actor.username, timestamp, expires, timestamp);
    const c = this.db.prepare('SELECT * FROM device_commands WHERE command_id = ?').get(commandId);
    try {
      if (this.simulation) {
        if (!this.simulationDriver) throw new Error('No isolated simulation driver');
        await this.simulationDriver(c);
      } else {
        await this.mqttService.publishCommand(`${cleanTopic(id)}/command`, {
          schema_version: 1,
          command_id: commandId,
          device_id: id,
          endpoint_key: e.endpoint_key,
          value: body.value,
          issued_at: timestamp,
          expires_at: expires
        });
      }
    } catch {
      this.failCommand(c, 'UNAVAILABLE', 'PUBLISH_UNAVAILABLE');
    }
    this.management.audit(actor, 'DEVICE_COMMAND', id, { command_id: commandId, endpoint_key: e.endpoint_key, value: body.value });
    return this.db.prepare('SELECT * FROM device_commands WHERE command_id = ?').get(commandId);
  }

  failCommand(c, state, reason) {
    this.db
      .prepare('UPDATE device_commands SET state = ?, error = ?, updated_at = ? WHERE command_id = ?')
      .run(state, reason, iso(this.clock()), c.command_id);
    this.notify({
      category: 'COMMAND',
      severity: 'WARNING',
      title: 'Device command failed',
      message: `${c.endpoint_key}: ${reason}`,
      device_id: c.device_id,
      audience: 'ADMIN'
    });
    this.raise({
      key: `COMMAND:${c.command_id}`,
      device_id: c.device_id,
      title: `Command ${c.endpoint_key}: ${reason}`,
      evidence: { command_id: c.command_id }
    });
  }

  acknowledgeCommand(id, raw) {
    const p = ackSchema.safeParse(raw);
    if (!p.success || p.data.device_id !== id) return { ok: false, error: 'INVALID_ACK' };
    const a = p.data;
    const c = this.db.prepare('SELECT * FROM device_commands WHERE command_id = ?').get(a.command_id);
    if (!c || c.device_id !== id || !['PUBLISHED', 'ACKNOWLEDGED'].includes(c.state) || c.expires_at <= iso(this.clock())) {
      return { ok: false, error: 'ACK_MISMATCH_OR_EXPIRED' };
    }
    if (a.status === 'REJECTED') {
      this.failCommand(c, 'REJECTED', 'DEVICE_REJECTED');
      return { ok: true };
    }
    if (a.status === 'EXECUTED' && a.observed_value !== c.requested_value) {
      this.failCommand(c, 'FAILED', 'OBSERVED_VALUE_MISMATCH');
      return { ok: false, error: 'OBSERVED_VALUE_MISMATCH' };
    }
    this.db
      .prepare('UPDATE device_commands SET state = ?, observed_value = ?, updated_at = ? WHERE command_id = ?')
      .run(a.status === 'EXECUTED' ? 'STATE_REPORTED' : 'ACKNOWLEDGED', a.observed_value || null, iso(this.clock()), c.command_id);
    return { ok: true };
  }

  // --------------------------------------------------------------------------
  // SCOPED NOTIFICATIONS, ALARMS & OVERVIEW QUERIES
  // --------------------------------------------------------------------------

  scope(user) {
    return {
      sql: "(n.audience='ALL' OR (n.audience='ADMIN' AND ?='Admin') OR (n.audience='USER' AND n.owner_id=?))",
      args: [user.role, user.id]
    };
  }

  listNotifications(user, q) {
    const s = this.scope(user);
    const where = [s.sql];
    const args = [...s.args];
    for (const [key, column] of [
      ['severity', 'severity'],
      ['category', 'category'],
      ['device_id', 'device_id']
    ]) {
      if (q[key]) {
        where.push(`n.${column} = ?`);
        args.push(q[key]);
      }
    }
    if (q.room_id) {
      where.push('dr.room_id = ?');
      args.push(q.room_id);
    }
    if (q.search) {
      where.push('(n.title LIKE ? OR n.message LIKE ?)');
      args.push(`%${q.search}%`, `%${q.search}%`);
    }
    if (q.from) {
      where.push('n.timestamp >= ?');
      args.push(q.from);
    }
    if (q.to) {
      where.push('n.timestamp <= ?');
      args.push(q.to);
    }
    if (q.unread === 'true') where.push('r.notification_id IS NULL');

    const join = `FROM notifications n
      LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
      LEFT JOIN device_registry dr ON dr.device_id = n.device_id
      LEFT JOIN rooms rm ON rm.room_id = dr.room_id`;
    const total = this.db.prepare(`SELECT COUNT(*) AS n ${join} WHERE ${where.join(' AND ')}`).get(user.id, ...args).n;
    const rows = this.db
      .prepare(
        `SELECT n.*, r.read_at, dr.room_id, rm.name AS room_name, rm.room_code ${join}
         WHERE ${where.join(' AND ')}
         ORDER BY n.id DESC LIMIT ? OFFSET ?`
      )
      .all(user.id, ...args, q.limit, (q.page - 1) * q.limit);
    const unread = this.db
      .prepare(`SELECT COUNT(*) AS n FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ? WHERE ${s.sql} AND r.notification_id IS NULL`)
      .get(user.id, ...s.args).n;
    const latest = this.db
      .prepare(`SELECT COALESCE(MAX(n.id), 0) AS id FROM notifications n WHERE ${s.sql}`)
      .get(...s.args).id;
    return { notifications: rows, total, unread, latest_id: latest, page: q.page, limit: q.limit };
  }

  readNotification(user, id, read = true) {
    const s = this.scope(user);
    if (!this.db.prepare(`SELECT 1 FROM notifications n WHERE n.id = ? AND ${s.sql}`).get(id, ...s.args)) {
      error(404, 'NOTIFICATION_NOT_FOUND', 'Notification was not found');
    }
    if (read) {
      this.db
        .prepare('INSERT OR IGNORE INTO notification_reads(notification_id,user_id,read_at) VALUES(?,?,?)')
        .run(id, user.id, iso(this.clock()));
    } else {
      this.db.prepare('DELETE FROM notification_reads WHERE notification_id = ? AND user_id = ?').run(id, user.id);
    }
  }

  readAll(user, throughId) {
    const s = this.scope(user);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO notification_reads(notification_id,user_id,read_at)
         SELECT n.id, ?, ? FROM notifications n WHERE ${s.sql} AND n.id <= ?`
      )
      .run(user.id, iso(this.clock()), ...s.args, throughId);
  }

  listAlarms(q) {
    const where = ['1=1'];
    const args = [];
    for (const [key, column] of [
      ['state', 'a.state'],
      ['severity', 'a.severity'],
      ['device_id', 'a.device_id']
    ]) {
      if (q[key]) {
        where.push(`${column} = ?`);
        args.push(q[key]);
      }
    }
    if (q.room_id) {
      where.push('dr.room_id = ?');
      args.push(q.room_id);
    }
    if (q.search) {
      where.push('(a.title LIKE ? OR dr.name LIKE ?)');
      args.push(`%${q.search}%`, `%${q.search}%`);
    }
    if (q.from) {
      where.push('a.raised_at >= ?');
      args.push(q.from);
    }
    if (q.to) {
      where.push('a.raised_at <= ?');
      args.push(q.to);
    }
    const join = `FROM alarms a
      LEFT JOIN device_registry dr ON dr.device_id = a.device_id
      LEFT JOIN rooms r ON r.room_id = dr.room_id`;
    const total = this.db.prepare(`SELECT COUNT(*) AS n ${join} WHERE ${where.join(' AND ')}`).get(...args).n;
    const alarms = this.db
      .prepare(
        `SELECT a.*, dr.name AS device_name, dr.room_id, r.name AS room_name, r.room_code ${join}
         WHERE ${where.join(' AND ')}
         ORDER BY a.raised_at DESC LIMIT ? OFFSET ?`
      )
      .all(...args, q.limit, (q.page - 1) * q.limit)
      .map((a) => ({ ...a, evidence: parseJson(a.evidence, {}) }));
    const active = this.db.prepare("SELECT COUNT(*) AS n FROM alarms WHERE state != 'RESOLVED'").get().n;
    return { alarms, total, page: q.page, limit: q.limit, active };
  }

  getOverviewSummary(user) {
    const facility = this.getFacility();
    const rooms = this.listRooms({ status: 'ACTIVE' });
    const devices = this.listDevices({ include_archived: false });
    const deviceSummary = {
      registered: devices.length,
      online: 0,
      stale: 0,
      unknown: 0,
      disabled: 0,
      maintenance: 0
    };
    for (const d of devices) {
      if (d.status === 'ONLINE') deviceSummary.online += 1;
      else if (d.status === 'STALE') deviceSummary.stale += 1;
      else if (d.status === 'DISABLED') deviceSummary.disabled += 1;
      else deviceSummary.unknown += 1;
      if (d.in_maintenance) deviceSummary.maintenance += 1;
    }
    const activeAlarms = this.db.prepare("SELECT COUNT(*) AS n FROM alarms WHERE state != 'RESOLVED'").get().n;
    const pendingDevices = this.db.prepare("SELECT COUNT(*) AS n FROM pending_devices WHERE status = 'PENDING'").get().n;
    const notifSummary = this.listNotifications(user, { page: 1, limit: 8, search: '', severity: '', category: '', device_id: '', room_id: '', unread: '' });
    const recentAlarms = this.listAlarms({ page: 1, limit: 6, search: '', severity: '', device_id: '', room_id: '', state: '' }).alarms;

    return {
      version: RELEASE_VERSION,
      simulation: this.simulation,
      facility,
      rooms,
      device_summary: deviceSummary,
      active_alarms: Number(activeAlarms || 0),
      pending_devices: Number(pendingDevices || 0),
      unread_notifications: notifSummary.unread,
      recent_notifications: notifSummary.notifications,
      recent_alarms: recentAlarms,
      health: {
        sqlite: this.db.healthCheck(),
        mqtt: this.mqttService.getHealthStatus(),
        websocket: this.wsGateway ? this.wsGateway.getStats() : { total: 0, telemetry: 0, mfa: 0, notifications: 0 }
      }
    };
  }

  tick() {
    try {
      for (const d of this.listDevices()) {
        if (!d.enabled || d.in_maintenance) continue;
        if (!this.monitorFresh(d) && this.clock() - Date.parse(d.created_at) > d.stale_after_s * 1000) {
          this.raise({
            key: `STALE:${d.device_id}`,
            device_id: d.device_id,
            title: `${d.name}: no recent ${d.endpoints.some((e) => e.kind === 'SENSOR') ? 'sensor data' : 'device evidence'}`,
            evidence: {
              room_id: d.room_id,
              last_seen_at: d.last_seen_at,
              telemetry_age_ms: d.telemetry_age_ms,
              transport: d.transport
            }
          });
        }
        this.evaluateDevice(d.device_id);
      }
      for (const c of this.db
        .prepare("SELECT * FROM device_commands WHERE state IN ('PUBLISHED','ACKNOWLEDGED') AND expires_at <= ?")
        .all(iso(this.clock()))) {
        this.failCommand(c, 'TIMED_OUT', 'DEVICE_CONFIRMATION_TIMEOUT');
      }
      for (const c of this.db
        .prepare(
          "SELECT * FROM command_audit c WHERE c.lifecycle_state IN ('failed','timed_out','unavailable','rejected') AND c.issued_at >= ? AND NOT EXISTS (SELECT 1 FROM alarms a WHERE a.dedup_key = 'LEGACY_COMMAND:' || c.command_id) LIMIT 100"
        )
        .all(this.startedAt)) {
        if (this.db.prepare('SELECT 1 FROM device_registry WHERE device_id = ?').get(c.target_node)) {
          this.raise({
            key: `LEGACY_COMMAND:${c.command_id}`,
            device_id: c.target_node,
            title: `${c.command}: ${c.lifecycle_state}`,
            evidence: { command_id: c.command_id }
          });
        }
      }
      const latest = this.db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM notifications').get().id;
      if (latest !== this.lastNotificationId) {
        this.lastNotificationId = latest;
        this.wsGateway?.broadcastNotifications({ type: 'notifications_changed' });
      }
      if (this.clock() - this.lastCleanup > 3600000) {
        this.lastCleanup = this.clock();
        const days = this.db.prepare('SELECT retention_days FROM release_settings WHERE id = 1').get().retention_days;
        const cutoff = iso(this.clock() - days * 86400000);
        this.db.prepare('DELETE FROM notifications WHERE timestamp < ?').run(cutoff);
        this.db
          .prepare(
            'DELETE FROM device_frames WHERE received_at < ? AND id NOT IN (SELECT MAX(id) FROM device_frames GROUP BY device_id, boot_id)'
          )
          .run(cutoff);
      }
      this.lastTickError = null;
    } catch (err) {
      this.lastTickError = err.message;
    }
  }

  close() {
    clearInterval(this.timer);
  }
}
