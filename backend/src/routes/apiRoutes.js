import express from 'express';
import {
  loginSchema,
  commandRequestSchema,
  provisionUserSchema,
  adminProfileSchema,
  updateUserRoleSchema,
  deleteUserSchema,
  telemetryAggregateQuerySchema
} from '../validators/schemas.js';
import { ALLOWED_LOG_TABLES } from '../repositories/sqliteRepository.js';
import { setSessionCookie, clearSessionCookie } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/security.js';
import { logger } from '../utils/logger.js';

export function createApiRouter({
  config,
  db,
  repo,
  authMiddleware,
  mqttService,
  wsGateway,
  commandCoordinator
}) {
  const router = express.Router();
  const { requireAuth, requireAdmin } = authMiddleware;

  const loginRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 15,
    keyPrefix: 'login',
    message: 'Too many authentication attempts. Please wait before retrying.'
  });

  const adminMutationLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 40,
    keyPrefix: 'admin_mut',
    message: 'Rate limit exceeded for administrative mutations.'
  });

  // --------------------------------------------------------------------------
  // 1. HEALTH & READINESS ENDPOINTS
  // --------------------------------------------------------------------------

  router.get('/health/live', (req, res) => {
    return res.status(200).json({
      ok: true,
      status: 'live',
      service: 'lci-sfm-backend',
      uptime_seconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      request_id: req.requestId
    });
  });

  router.get('/health/ready', (req, res) => {
    const dbCheck = db.healthCheck();
    const rawMqtt = mqttService
      ? mqttService.getHealthStatus()
      : { enabled: false, connected: false, subscriptions_ready: true, state: 'standby' };
    const mqttEnabled = Boolean(rawMqtt.enabled);
    const mqttConnected = mqttEnabled ? Boolean(rawMqtt.connected) : false;
    const mqttSubsReady = !mqttEnabled
      ? true
      : Boolean(mqttConnected && rawMqtt.subscriptions_ready !== false);
    const mqttState = !mqttEnabled
      ? 'standby'
      : !mqttConnected
        ? 'disconnected'
        : mqttSubsReady
          ? 'connected'
          : 'degraded';
    const mqttStatus = {
      ...rawMqtt,
      enabled: mqttEnabled,
      connected: mqttConnected,
      subscriptions_ready: mqttSubsReady,
      state: mqttState
    };
    const wsStats = wsGateway ? wsGateway.getStats() : { totalClients: 0 };

    const sqliteReady = Boolean(dbCheck && dbCheck.ok);
    const mqttReady = mqttEnabled ? (mqttConnected && mqttSubsReady) : true;
    const ready = sqliteReady && mqttReady;

    return res.status(ready ? 200 : 503).json({
      ok: ready,
      status: ready ? 'ready' : 'degraded',
      sqlite: dbCheck,
      mqtt: mqttStatus,
      websocket: wsStats,
      timestamp: new Date().toISOString(),
      request_id: req.requestId
    });
  });

  // --------------------------------------------------------------------------
  // 2. AUTHENTICATION & SERVER-SIDE SESSIONS
  // --------------------------------------------------------------------------

  router.post('/auth/login', loginRateLimiter, (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: 'Username and password are required',
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues.map((i) => i.message),
        request_id: req.requestId
      });
    }

    const { username, password } = parsed.data;
    const verifiedUser = repo.verifyUserCredentials(username, password);

    if (!verifiedUser) {
      repo.insertAccessLog({
        node_id: 'backend',
        username,
        modality: 'WEB_LOGIN',
        event: `Failed login attempt for "${username}"`,
        status: 'DENIED'
      });

      return res.status(401).json({
        ok: false,
        error: 'Invalid operator username or password',
        code: 'INVALID_CREDENTIALS',
        request_id: req.requestId
      });
    }

    const session = repo.createSession({
      userId: verifiedUser.id,
      ttlMs: config.sessionAbsoluteTtlMs,
      userAgent: String(req.headers['user-agent'] || ''),
      ipAddress: String(req.ip || req.socket?.remoteAddress || '')
    });

    setSessionCookie(res, session.rawToken, config);

    repo.insertAccessLog({
      node_id: 'backend',
      username: verifiedUser.username,
      modality: 'WEB_LOGIN',
      event: `Authenticated console session (${verifiedUser.role})`,
      status: 'GRANTED'
    });

    const responsePayload = {
      ok: true,
      authenticated: true,
      user: {
        id: verifiedUser.id,
        username: verifiedUser.username,
        role: verifiedUser.role
      },
      username: verifiedUser.username,
      role: verifiedUser.role,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      request_id: req.requestId
    };

    if (config.allowBearerCompat) {
      responsePayload.token = session.rawToken;
    }

    return res.status(200).json(responsePayload);
  });

  router.post('/auth/logout', (req, res) => {
    const activeSession = authMiddleware.resolveRequestSession(req);
    if (activeSession) {
      if (typeof authMiddleware.verifyCsrfForRequest === 'function') {
        const csrfCheck = authMiddleware.verifyCsrfForRequest(req, activeSession);
        if (!csrfCheck.ok) {
          return res.status(403).json({
            ok: false,
            error: csrfCheck.error,
            code: csrfCheck.code,
            request_id: req.requestId
          });
        }
      }
      repo.revokeSessionByToken(activeSession.rawToken);
      if (wsGateway) {
        wsGateway.disconnectSession(activeSession.sessionId);
      }
      repo.insertAccessLog({
        node_id: 'backend',
        username: activeSession.user.username,
        modality: 'WEB_LOGOUT',
        event: 'Operator terminated console session',
        status: 'LOGGED_OUT'
      });
    }

    clearSessionCookie(res, config);
    return res.status(200).json({
      ok: true,
      logged_out: true,
      request_id: req.requestId
    });
  });

  router.get('/auth/session', requireAuth, (req, res) => {
    return res.status(200).json({
      ok: true,
      authenticated: true,
      user: req.user,
      username: req.user.username,
      role: req.user.role,
      csrfToken: req.session.csrfToken,
      request_id: req.requestId
    });
  });

  // --------------------------------------------------------------------------
  // 3. ALLOWLISTED SQLITE LOGS & USER DIRECTORY
  // --------------------------------------------------------------------------

  router.get('/logs/:table', requireAuth, (req, res) => {
    const tableName = String(req.params.table || '').trim();

    if (!ALLOWED_LOG_TABLES.has(tableName)) {
      return res.status(400).json({
        ok: false,
        error: `Table "${tableName}" is not permitted. Allowed tables: ${Array.from(ALLOWED_LOG_TABLES).join(', ')}`,
        code: 'TABLE_NOT_ALLOWED',
        request_id: req.requestId
      });
    }

    if (tableName === 'system_users' && req.user.role !== 'Admin') {
      return res.status(403).json({
        ok: false,
        error: 'Forbidden: Viewing system_users requires Administrator clearance',
        code: 'FORBIDDEN_ADMIN_REQUIRED',
        request_id: req.requestId
      });
    }

    const limit = req.query.limit ? Number(req.query.limit) : 250;
    const rows = repo.queryAllowlistedTable(tableName, limit);
    return res.status(200).json(rows);
  });

  // --------------------------------------------------------------------------
  // 4. TELEMETRY AGGREGATION (24H / 7D ROLLUPS)
  // --------------------------------------------------------------------------

  router.get('/telemetry/aggregate', requireAuth, (req, res) => {
    const parsed = telemetryAggregateQuerySchema.safeParse({
      range: req.query.range || '24h',
      bucket: req.query.bucket || '15m'
    });

    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid telemetry aggregation parameters. Allowed range: 1h|24h|7d, bucket: 5m|15m|1h',
        code: 'INVALID_AGGREGATION_PARAMS',
        request_id: req.requestId
      });
    }

    const rollup = repo.getTelemetryAggregation(parsed.data);
    return res.status(200).json({
      ok: true,
      ...rollup,
      request_id: req.requestId
    });
  });

  // --------------------------------------------------------------------------
  // 5. HARDWARE COMMAND DISPATCH (ADMIN ONLY, TRUTHFUL LIFECYCLE)
  // --------------------------------------------------------------------------

  router.post('/command', requireAdmin, adminMutationLimiter, async (req, res, next) => {
    try {
      const parsed = commandRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          status: 'rejected',
          lifecycle_state: 'rejected',
          error: parsed.error.issues.map((i) => i.message).join('; '),
          code: 'INVALID_COMMAND_PAYLOAD',
          request_id: req.requestId
        });
      }

      const { command, state } = parsed.data;
      const result = await commandCoordinator.dispatchCommand({
        command,
        state,
        actor: req.user,
        requestId: req.requestId
      });

      return res.status(result.httpStatus).json(result.body);
    } catch (err) {
      next(err);
    }
  });

  // --------------------------------------------------------------------------
  // 6. USER PROVISIONING & RBAC USER MANAGEMENT (ADMIN ONLY)
  // --------------------------------------------------------------------------

  router.post('/provision/user', requireAdmin, adminMutationLimiter, (req, res) => {
    const parsed = provisionUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: parsed.error.issues.map((i) => i.message).join('; '),
        code: 'VALIDATION_ERROR',
        request_id: req.requestId
      });
    }

    try {
      const createdUser = repo.provisionUser(parsed.data);
      return res.status(201).json({
        ok: true,
        user: createdUser,
        provisioning_status: 'stored_pending_edge_sync',
        note: 'Operator credentials hashed and persisted in SQLite. Offline Node 1 EEPROM sync awaits firmware provisioning channel.',
        request_id: req.requestId
      });
    } catch (err) {
      if (err.code === 'USER_ALREADY_EXISTS') {
        return res.status(409).json({
          ok: false,
          error: err.message,
          code: err.code,
          request_id: req.requestId
        });
      }
      logger.error('Failed to provision user', { error: err.message, request_id: req.requestId });
      return res.status(500).json({
        ok: false,
        error: 'Failed to provision operator in SQLite',
        code: 'PROVISION_ERROR',
        request_id: req.requestId
      });
    }
  });

  router.post('/auth/admin-profile', requireAdmin, adminMutationLimiter, (req, res) => {
    const parsed = adminProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: parsed.error.issues.map((i) => i.message).join('; '),
        code: 'VALIDATION_ERROR',
        request_id: req.requestId
      });
    }

    try {
      const updatedId = repo.updateAdminCredentials({
        actorUserId: req.user.id,
        currentUsername: parsed.data.currentUsername || req.user.username,
        newUsername: parsed.data.newUsername,
        newPassword: parsed.data.newPassword
      });

      return res.status(200).json({
        ok: true,
        id: updatedId,
        username: parsed.data.newUsername,
        request_id: req.requestId
      });
    } catch (err) {
      const status =
        err.code === 'USERNAME_CONFLICT' ? 409 : err.code === 'ADMIN_NOT_FOUND' ? 404 : 400;
      return res.status(status).json({
        ok: false,
        error: err.message,
        code: err.code || 'ADMIN_PROFILE_UPDATE_FAILED',
        request_id: req.requestId
      });
    }
  });

  router.post('/users/role', requireAdmin, adminMutationLimiter, (req, res) => {
    const parsed = updateUserRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: parsed.error.issues.map((i) => i.message).join('; '),
        code: 'VALIDATION_ERROR',
        request_id: req.requestId
      });
    }

    try {
      const updated = repo.updateUserRole({
        targetUserId: parsed.data.id,
        newRole: parsed.data.role,
        actorUsername: req.user.username
      });

      if (wsGateway) {
        wsGateway.disconnectUser(parsed.data.id);
      }

      return res.status(200).json({
        ok: true,
        user: updated,
        request_id: req.requestId
      });
    } catch (err) {
      const status =
        err.code === 'USER_NOT_FOUND'
          ? 404
          : err.code === 'LAST_ADMIN_PROTECTED'
            ? 409
            : 400;
      return res.status(status).json({
        ok: false,
        error: err.message,
        code: err.code || 'ROLE_UPDATE_FAILED',
        request_id: req.requestId
      });
    }
  });

  router.post('/users/delete', requireAdmin, adminMutationLimiter, (req, res) => {
    const parsed = deleteUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: parsed.error.issues.map((i) => i.message).join('; '),
        code: 'VALIDATION_ERROR',
        request_id: req.requestId
      });
    }

    try {
      const deleted = repo.deleteUser({
        targetUserId: parsed.data.id,
        actorUsername: req.user.username
      });

      if (wsGateway) {
        wsGateway.disconnectUser(parsed.data.id);
      }

      return res.status(200).json({
        ok: true,
        deleted,
        request_id: req.requestId
      });
    } catch (err) {
      const status =
        err.code === 'USER_NOT_FOUND'
          ? 404
          : err.code === 'LAST_ADMIN_PROTECTED'
            ? 409
            : 400;
      return res.status(status).json({
        ok: false,
        error: err.message,
        code: err.code || 'DELETE_USER_FAILED',
        request_id: req.requestId
      });
    }
  });

  // Catch-all for unknown /api/* endpoints
  router.use((req, res) => {
    return res.status(404).json({
      ok: false,
      error: `API route not found: ${req.method} ${req.originalUrl}`,
      code: 'ROUTE_NOT_FOUND',
      request_id: req.requestId
    });
  });

  return router;
}
