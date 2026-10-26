import express from 'express';
import { z } from 'zod';
import {
  settingsSchema, personSchema, personUpdateSchema, credentialSchema,
  credentialStateSchema, operatorSchema
} from '../validators/managementSchemas.js';
import { createRateLimiter } from '../middleware/security.js';
import { readCameraSnapshot } from '../services/cameraSnapshot.js';

export function createManagementRouter({ management, authMiddleware, db, snapshotFetch }) {
  const router = express.Router();
  const { requireAuth, requireAdmin } = authMiddleware;
  const limitMutations = createRateLimiter({ maxRequests: 60, keyPrefix: 'management' });
  const validate = schema => (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', error: parsed.error.issues.map(i => i.message).join('; '), request_id: req.requestId });
    req.validated = parsed.data;
    next();
  };
  const ok = (res, payload, status = 200) => res.status(status).json({ ok: true, ...payload });
  router.get('/settings', requireAuth, (req, res) => ok(res, { settings: management.settings() }));
  router.put('/settings', requireAdmin, limitMutations, validate(settingsSchema), (req, res) =>
    ok(res, { settings: management.updateSettings(req.validated, req.user, req.requestId), note: 'Addresses registered centrally. Hardware network configuration and edge thresholds are unchanged.' }));
  router.get('/devices', requireAuth, (req, res) => ok(res, { devices: management.devices() }));
  router.get('/devices/node3/snapshot', requireAuth, createRateLimiter({ maxRequests: 30, keyPrefix: 'camera' }), async (req, res, next) => {
    try {
      if(management.operations?.simulation)return res.status(409).json({ok:false,error:'Physical camera capture is disabled in the isolated simulator'});
      const device=management.operations?.device(management.config.node3Id);
      if(device&&!device.enabled)return res.status(409).json({ok:false,error:'Camera node is disabled'});
      const jpeg = await readCameraSnapshot(management.settings().nodes.node3.ip, snapshotFetch,device?{port:device.port,path:device.path}:{});
      res.type('image/jpeg').send(jpeg);
    } catch (err) { next(err); }
  });
  router.get('/people', requireAdmin, (req, res) => {
    const parsed = z.object({ search: z.string().max(80).default(''), page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ ok: false, code: 'INVALID_QUERY', error: 'Invalid people search or pagination' });
    return ok(res, management.listPeople(parsed.data));
  });
  router.post('/people', requireAdmin, limitMutations, validate(personSchema), (req, res) =>
    ok(res, { person: management.createPerson(req.validated, req.user, req.requestId) }, 201));
  router.put('/people/:id', requireAdmin, limitMutations, validate(personUpdateSchema), (req, res) =>
    ok(res, { person: management.updatePerson(req.params.id, req.validated, req.user, req.requestId) }));
  router.post('/people/:id/credentials', requireAdmin, limitMutations, validate(credentialSchema), (req, res) =>
    ok(res, { credential: management.addCredential(req.params.id, req.validated, req.user, req.requestId), device_sync: 'PENDING_DEVICE_SYNC' }, 201));
  router.put('/credentials/:id', requireAdmin, limitMutations, validate(credentialStateSchema), (req, res) =>
    ok(res, { credential: management.setCredentialState(req.params.id, req.validated.status, req.user, req.requestId) }));
  router.post('/operators', requireAdmin, limitMutations, validate(operatorSchema), (req, res) =>
    ok(res, { user: management.createOperator(req.validated, req.user, req.requestId) }, 201));
  router.get('/management-audit', requireAdmin, (req, res) => ok(res, { events: management.auditRows() }));
  router.get('/commands', requireAuth, (req, res) => ok(res, { commands: db.prepare(`SELECT command_id, actor_username, command, requested_state,
    target_node, lifecycle_state, issued_at, expires_at, error_code FROM command_audit ORDER BY issued_at DESC LIMIT 100`).all() }));
  router.post('/people/:id/cards/enrollment-sessions', requireAdmin, limitMutations, validate(z.object({}).strict()), async (req, res, next) => {
    try { return ok(res, { enrollment: await management.startEnrollment(req.params.id, req.user, req.requestId) }, 201); }
    catch (err) { next(err); }
  });
  router.get('/enrollment-sessions/:id', requireAdmin, (req, res) => ok(res, { enrollment: management.enrollment(req.params.id, req.user) }));
  for (const action of ['confirm','cancel']) {
    router.post(`/enrollment-sessions/:id/${action}`, requireAdmin, limitMutations, validate(z.object({}).strict()), async (req, res, next) => {
      try { return ok(res, { enrollment: await management.finishEnrollment(req.params.id, action, req.user, req.requestId) }); }
      catch (err) { next(err); }
    });
  }
  router.use((err, req, res, next) => {
    if (!err.status || !err.code) return next(err);
    res.status(err.status).json({ ok: false, code: err.code, error: err.message, request_id: req.requestId });
  });
  return router;
}
