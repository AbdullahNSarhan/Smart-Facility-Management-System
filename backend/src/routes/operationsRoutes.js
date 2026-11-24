import express from 'express';
import { z } from 'zod';
import { createRateLimiter } from '../middleware/security.js';
import {
  nodeSchema,
  ruleSchema,
  maintenanceSchema,
  alarmActionSchema,
  listSchema,
  switchSchema,
  facilityUpdateSchema,
  roomCreateSchema,
  roomUpdateSchema,
  deviceMoveSchema,
  mqttIdentityStatusSchema
} from '../validators/operationsSchemas.js';
import { readCameraSnapshot } from '../services/cameraSnapshot.js';
import { RELEASE_VERSION, CAPABILITY_REGISTRY } from '../services/releaseOperations.js';

export function createOperationsRouter({ operations: o, authMiddleware, db, snapshotFetch }) {
  const r = express.Router();
  const { requireAuth, requireAdmin } = authMiddleware;
  const mutation = createRateLimiter({ maxRequests: 90, keyPrefix: 'operations' });
  const probes = createRateLimiter({ maxRequests: 20, keyPrefix: 'device_probe' });
  const validate = (s) => (req, res, next) => {
    const p = s.safeParse(req.body);
    if (!p.success) {
      return res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        error: p.error.issues.map((i) => i.message).join('; '),
        request_id: req.requestId
      });
    }
    req.validated = p.data;
    next();
  };
  const query = (req, res, next) => {
    const p = listSchema.safeParse(req.query);
    if (!p.success) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_QUERY',
        error: 'Invalid filter or pagination',
        request_id: req.requestId
      });
    }
    req.filters = p.data;
    next();
  };
  const ok = (res, value, status = 200) => res.status(status).json({ ok: true, ...value });
  const asyncRoute = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);

  // --------------------------------------------------------------------------
  // RELEASE METADATA, OVERVIEW, CAPABILITIES & DIAGNOSTICS
  // --------------------------------------------------------------------------

  r.get('/release', requireAuth, (req, res) =>
    ok(res, {
      version: RELEASE_VERSION,
      stage: 'SOFTWARE_RELEASE_CANDIDATE',
      simulation: o.simulation,
      physical_acceptance: 'PENDING',
      adapters: [
        { id: 'MQTT_V1', description: 'Versioned sensor / switch protocol; requires per-device host CLI broker provisioning' },
        { id: 'HTTP_JSON_V1', description: 'Manual bounded JSON sensor probe against registered private LAN IP' },
        { id: 'CAMERA_JPEG', description: 'Authenticated JPEG capture proxy against registered private LAN IP' }
      ],
      retention_days: db.prepare('SELECT retention_days FROM release_settings WHERE id = 1').get().retention_days,
      monitoring_error: o.lastTickError || null
    })
  );

  r.get('/capabilities', requireAuth, (_req, res) => ok(res, { capabilities: CAPABILITY_REGISTRY }));

  r.get('/overview', requireAuth, (req, res) => ok(res, o.getOverviewSummary(req.user)));

  r.get('/diagnostics', requireAuth, (req, res) => {
    const devices = o.listDevices({ include_archived: false });
    const pending = o.listPendingDevices({ status: 'PENDING' });
    const retentionDays = db.prepare('SELECT retention_days FROM release_settings WHERE id = 1').get().retention_days;
    const sqlite = db.healthCheck();
    const mqtt = o.mqttService.getHealthStatus();
    const websocket = o.wsGateway ? o.wsGateway.getStats() : { total: 0, telemetry: 0, mfa: 0, notifications: 0 };
    return ok(res, {
      version: RELEASE_VERSION,
      started_at: o.startedAt,
      uptime_seconds: Math.round(process.uptime()),
      simulation: o.simulation,
      retention_days: retentionDays,
      monitoring_error: o.lastTickError || null,
      sqlite,
      mqtt,
      websocket,
      deployment_summary: {
        node_env: o.config.nodeEnv,
        mqtt_enabled: o.config.mqttEnabled,
        allow_bearer_compat: o.config.allowBearerCompat,
        session_secure_cookie: o.config.sessionSecureCookie,
        session_idle_minutes: Math.round(o.config.sessionIdleTtlMs / 60000),
        session_absolute_hours: Math.round(o.config.sessionAbsoluteTtlMs / 3600000)
      },
      pending_devices_count: pending.length,
      devices: devices.map((d) => ({
        device_id: d.device_id,
        name: d.name,
        room_id: d.room_id,
        room_code: d.room_code,
        room_name: d.room_name,
        transport: d.transport,
        status: d.status,
        mqtt_identity_status: d.mqtt_identity_status,
        firmware_version: d.firmware_version,
        protocol_version: d.protocol_version,
        last_seen_at: d.last_seen_at,
        age_ms: d.age_ms,
        telemetry_age_ms: d.telemetry_age_ms,
        fresh: d.fresh,
        telemetry_fresh: d.telemetry_fresh,
        in_maintenance: d.in_maintenance,
        manifest_drift: d.manifest_drift,
        endpoints: d.endpoints.map((e) => ({
          endpoint_key: e.endpoint_key,
          label: e.label,
          kind: e.kind,
          data_type: e.data_type,
          status: e.status,
          fresh: e.fresh,
          last_seen_at: e.last_seen_at,
          age_ms: e.age_ms,
          last_value: e.last_value,
          unit: e.unit
        }))
      }))
    });
  });

  // --------------------------------------------------------------------------
  // FACILITY & MULTI-ROOM MANAGEMENT
  // --------------------------------------------------------------------------

  r.get('/facility', requireAuth, (_req, res) => ok(res, { facility: o.getFacility() }));
  r.put('/facility', requireAdmin, mutation, validate(facilityUpdateSchema), (req, res) =>
    ok(res, { facility: o.updateFacility(req.validated, req.user, req.requestId) })
  );

  r.get('/rooms', requireAuth, (req, res) => {
    const parsed = z
      .object({
        status: z.enum(['', 'ACTIVE', 'ARCHIVED']).default(''),
        search: z.string().max(80).default('')
      })
      .safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, code: 'INVALID_QUERY', error: 'Invalid room filter query' });
    }
    return ok(res, { rooms: o.listRooms(parsed.data) });
  });

  r.post('/rooms', requireAdmin, mutation, validate(roomCreateSchema), (req, res) =>
    ok(res, { room: o.createRoom(req.validated, req.user, req.requestId) }, 201)
  );

  r.get('/rooms/:roomId', requireAuth, (req, res) => ok(res, { room: o.getRoom(req.params.roomId) }));

  r.put('/rooms/:roomId', requireAdmin, mutation, validate(roomUpdateSchema), (req, res) =>
    ok(res, { room: o.updateRoom(req.params.roomId, req.validated, req.user, req.requestId) })
  );

  r.post('/rooms/:roomId/archive', requireAdmin, mutation, validate(z.object({}).strict()), (req, res) =>
    ok(res, { room: o.archiveRoom(req.params.roomId, req.user, req.requestId) })
  );

  r.post('/rooms/:roomId/restore', requireAdmin, mutation, validate(z.object({}).strict()), (req, res) =>
    ok(res, { room: o.restoreRoom(req.params.roomId, req.user, req.requestId) })
  );

  // --------------------------------------------------------------------------
  // DEVICE & ENDPOINT REGISTRY + PENDING MANIFEST QUARANTINE
  // --------------------------------------------------------------------------

  r.get('/registry', requireAuth, (req, res) => {
    const parsed = z
      .object({
        room_id: z.string().max(64).default(''),
        transport: z.enum(['', 'LEGACY_V1', 'MQTT_V1', 'HTTP_JSON_V1', 'CAMERA_JPEG']).default(''),
        search: z.string().max(80).default(''),
        include_archived: z.enum(['', 'true', 'false']).default('')
      })
      .safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, code: 'INVALID_QUERY', error: 'Invalid device registry filter' });
    }
    return ok(res, {
      devices: o.listDevices({
        room_id: parsed.data.room_id,
        transport: parsed.data.transport,
        search: parsed.data.search,
        include_archived: parsed.data.include_archived === 'true'
      })
    });
  });

  r.get('/registry/:id', requireAuth, (req, res) => ok(res, { device: o.device(req.params.id) }));

  r.post('/registry', requireAdmin, mutation, validate(nodeSchema), (req, res) =>
    ok(res, { device: o.saveDevice(req.validated, req.user, req.requestId) }, 201)
  );

  r.put('/registry/:id', requireAdmin, mutation, validate(nodeSchema), (req, res) =>
    ok(res, { device: o.saveDevice(req.validated, req.user, req.requestId, req.params.id) })
  );

  r.post('/registry/:id/move', requireAdmin, mutation, validate(deviceMoveSchema), (req, res) =>
    ok(res, { device: o.moveDeviceToRoom(req.params.id, req.validated.room_id, req.validated.version, req.user, req.requestId) })
  );

  r.post('/registry/:id/archive', requireAdmin, mutation, validate(z.object({}).strict()), (req, res) =>
    ok(res, { device: o.archiveDevice(req.params.id, req.user, req.requestId) })
  );

  r.post('/registry/:id/restore', requireAdmin, mutation, validate(z.object({}).strict()), (req, res) =>
    ok(res, { device: o.restoreDevice(req.params.id, req.user, req.requestId) })
  );

  r.put('/registry/:id/mqtt-identity', requireAdmin, mutation, validate(mqttIdentityStatusSchema), (req, res) =>
    ok(res, {
      device: o.setMqttIdentityStatus(req.params.id, req.validated.mqtt_identity_status, req.validated.version, req.user, req.requestId)
    })
  );

  r.post('/registry/:id/maintenance', requireAdmin, mutation, validate(maintenanceSchema), (req, res) =>
    ok(res, { device: o.maintenance(req.params.id, req.validated, req.user, req.requestId) })
  );

  r.post('/registry/:id/probe', requireAdmin, probes, validate(z.object({}).strict()), asyncRoute(async (req, res) =>
    ok(res, await o.probe(req.params.id))
  ));

  r.get('/registry/:id/snapshot', requireAuth, probes, asyncRoute(async (req, res) => {
    if (o.simulation) {
      return res.status(409).json({
        ok: false,
        code: 'SIMULATOR_ISOLATED',
        error: 'Simulator uses a clearly labelled synthetic preview in the browser; no upstream camera is contacted'
      });
    }
    const d = o.device(req.params.id);
    if (!d.enabled || d.archived || !d.endpoints.some((e) => e.kind === 'CAMERA')) {
      return res.status(409).json({ ok: false, error: 'No enabled camera endpoint', code: 'CAMERA_UNAVAILABLE' });
    }
    const jpeg = await readCameraSnapshot(d.ip, snapshotFetch, { port: d.port, path: d.path });
    db.prepare('UPDATE device_registry SET heartbeat_at = ? WHERE device_id = ?').run(new Date(o.clock()).toISOString(), d.device_id);
    res.type('image/jpeg').send(jpeg);
  }));

  r.get('/registry/:id/history', requireAuth, (req, res) => {
    o.device(req.params.id);
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 100), 500);
    ok(res, {
      frames: db
        .prepare('SELECT id, received_at, values_json FROM device_frames WHERE device_id = ? ORDER BY id DESC LIMIT ?')
        .all(req.params.id, limit)
        .map((f) => ({ ...f, values: JSON.parse(f.values_json), values_json: undefined }))
    });
  });

  r.get('/registry/:id/endpoints/:endpointKey/history', requireAuth, (req, res) => {
    const parsed = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(100),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional()
      })
      .safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, code: 'INVALID_QUERY', error: 'Invalid endpoint history range' });
    }
    return ok(res, o.getEndpointHistory(req.params.id, req.params.endpointKey, parsed.data));
  });

  r.get('/registry/:id/commands', requireAuth, (req, res) => {
    o.device(req.params.id);
    ok(res, {
      commands: db
        .prepare('SELECT * FROM device_commands WHERE device_id = ? ORDER BY issued_at DESC LIMIT 100')
        .all(req.params.id)
    });
  });

  r.post('/registry/:id/commands', requireAdmin, mutation, validate(switchSchema), asyncRoute(async (req, res) =>
    ok(res, { command: await o.command(req.params.id, req.validated, req.user) }, 202)
  ));

  // Pending / quarantined devices discovered via MQTT heartbeat
  r.get('/pending-devices', requireAdmin, (req, res) => {
    const status = typeof req.query.status === 'string' && ['PENDING', 'APPROVED', 'DISMISSED'].includes(req.query.status)
      ? req.query.status
      : 'PENDING';
    return ok(res, { pending_devices: o.listPendingDevices({ status }) });
  });

  r.post('/pending-devices/:id/dismiss', requireAdmin, mutation, validate(z.object({}).strict()), (req, res) =>
    ok(res, { pending: o.dismissPendingDevice(req.params.id, req.user, req.requestId) })
  );

  // --------------------------------------------------------------------------
  // ALARM RULES, ALARMS, NOTIFICATIONS, RETENTION & SIMULATOR
  // --------------------------------------------------------------------------

  r.get('/rules', requireAuth, (req, res) => {
    const roomId = typeof req.query.room_id === 'string' ? req.query.room_id.trim() : '';
    const deviceId = typeof req.query.device_id === 'string' ? req.query.device_id.trim() : '';
    const where = ['1=1'];
    const args = [];
    if (roomId) {
      where.push('dr.room_id = ?');
      args.push(roomId);
    }
    if (deviceId) {
      where.push('ar.device_id = ?');
      args.push(deviceId);
    }
    const rules = db
      .prepare(
        `SELECT ar.*, dr.name AS device_name, dr.room_id, rm.name AS room_name, rm.room_code
         FROM alarm_rules ar
         LEFT JOIN device_registry dr ON dr.device_id = ar.device_id
         LEFT JOIN rooms rm ON rm.room_id = dr.room_id
         WHERE ${where.join(' AND ')}
         ORDER BY ar.created_at, ar.rule_id`
      )
      .all(...args);
    return ok(res, { rules });
  });

  r.post('/rules', requireAdmin, mutation, validate(ruleSchema), (req, res) =>
    ok(res, { rule: o.saveRule(req.validated, req.user, req.requestId) }, 201)
  );

  r.put('/rules/:id', requireAdmin, mutation, validate(ruleSchema), (req, res) =>
    ok(res, { rule: o.saveRule(req.validated, req.user, req.requestId, req.params.id) })
  );

  r.get('/alarms', requireAuth, query, (req, res) => ok(res, o.listAlarms(req.filters)));
  r.get('/alarms/:id', requireAuth, (req, res) => ok(res, { alarm: o.alarmDetail(req.params.id) }));

  for (const action of ['acknowledge', 'resolve']) {
    r.post(`/alarms/:id/${action}`, requireAdmin, mutation, validate(alarmActionSchema), (req, res) =>
      ok(res, { alarm: o.alarmAction(req.params.id, action, req.validated.comment, req.user) })
    );
  }

  r.get('/notifications', requireAuth, query, (req, res) => ok(res, o.listNotifications(req.user, req.filters)));
  r.put('/notifications/read-all', requireAuth, mutation, validate(z.object({ through_id: z.number().int().nonnegative() }).strict()), (req, res) => {
    o.readAll(req.user, req.validated.through_id);
    ok(res, {});
  });
  r.put('/notifications/:id/read', requireAuth, mutation, validate(z.object({ read: z.boolean() }).strict()), (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ ok: false, error: 'Invalid notification ID' });
    }
    o.readNotification(req.user, id, req.validated.read);
    ok(res, {});
  });

  r.get('/notification-preferences', requireAuth, (req, res) =>
    ok(res, {
      critical_sound: Boolean(
        db.prepare('SELECT critical_sound FROM notification_preferences WHERE user_id = ?').get(req.user.id)?.critical_sound
      )
    })
  );
  r.put('/notification-preferences', requireAuth, mutation, validate(z.object({ critical_sound: z.boolean() }).strict()), (req, res) => {
    db.prepare(
      'INSERT INTO notification_preferences(user_id,critical_sound) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET critical_sound=excluded.critical_sound'
    ).run(req.user.id, Number(req.validated.critical_sound));
    ok(res, {});
  });

  r.put('/retention', requireAdmin, mutation, validate(z.object({ days: z.number().int().min(7).max(365) }).strict()), (req, res) => {
    db.transaction(() => {
      db.prepare('UPDATE release_settings SET retention_days = ? WHERE id = 1').run(req.validated.days);
      o.management.audit(req.user, 'NOTIFICATION_RETENTION', 'release', { days: req.validated.days }, req.requestId);
    })();
    ok(res, {
      days: req.validated.days,
      note: 'Retention applies to notifications and telemetry history. Alarm/audit evidence is preserved.'
    });
  });

  r.post('/simulator', requireAdmin, mutation, validate(z.object({ scenario: z.enum(['normal', 'alarm', 'offline', 'command-failure']) }).strict()), (req, res) => {
    if (!o.simulation || !o.setScenario) {
      return res.status(404).json({ ok: false, error: 'Simulator is unavailable in this deployment' });
    }
    ok(res, { simulation: true, scenario: o.setScenario(req.validated.scenario) });
  });

  r.use((err, req, res, next) => {
    if (!err.status || !err.code) return next(err);
    res.status(err.status).json({ ok: false, error: err.message, code: err.code, request_id: req.requestId });
  });

  return r;
}
