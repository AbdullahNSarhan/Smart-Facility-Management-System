import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import request from 'supertest';
import { WebSocket } from 'ws';
import { createBackendContext } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';
import { createDatabaseBackup, restoreDatabaseBackup } from '../src/db/backup.js';
import {
  LocalFIFOChart,
  sanitizeInput,
  escapeHTML,
  isValidIPv4,
  isValidHostPort,
  isValidHexRFID,
  isValidSixDigitPin,
  resolveInitialServerHost,
  formatReadinessSummary,
  LEGACY_NODE_RED_HOST
} from '../../app.js';

const TEST_ADMIN_USER = 'admin';
const TEST_ADMIN_PASS = 'Str0ng-AirGap-Admin#2026';

describe('LCI-SFM Production Node.js Backend Integration Suite', () => {
  let tmpDir;
  let dbPath;
  let ctx;
  let baseUrl;
  let wsBaseUrl;

  let adminToken;
  let adminCsrf;
  let adminCookie;

  let viewerId;
  let viewerToken;
  let viewerCsrf;

  const publishedMqttMessages = [];

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lci-sfm-test-'));
    dbPath = path.join(tmpDir, 'test_lci_sfm.db');

    ctx = createBackendContext({
      NODE_ENV: 'test',
      PORT: 0,
      HOST: '127.0.0.1',
      TRUST_PROXY: 'false',
      SQLITE_DB_PATH: dbPath,
      MQTT_ENABLED: 'false',
      ALLOW_BEARER_COMPAT: 'true',
      LCI_BOOTSTRAP_ADMIN_USERNAME: TEST_ADMIN_USER,
      LCI_BOOTSTRAP_ADMIN_PASSWORD: TEST_ADMIN_PASS,
      COMMAND_ACK_TIMEOUT_MS: 600
    });

    const addr = await ctx.start();
    baseUrl = `http://127.0.0.1:${addr.port}`;
    wsBaseUrl = `ws://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (ctx) {
      await ctx.stop();
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 1. HEALTH, MIGRATIONS & SQLITE CONFIGURATION
  // --------------------------------------------------------------------------
  it('applies SQLite migrations in WAL mode with foreign_keys=ON and reports healthy readiness', async () => {
    const liveRes = await request(ctx.app).get('/api/health/live');
    assert.equal(liveRes.status, 200);
    assert.equal(liveRes.body.ok, true);
    assert.equal(liveRes.body.status, 'live');
    assert.ok(liveRes.headers['x-request-id']);

    const readyRes = await request(ctx.app).get('/api/health/ready');
    assert.equal(readyRes.status, 200);
    assert.equal(readyRes.body.ok, true);
    assert.equal(String(readyRes.body.sqlite.journal_mode).toLowerCase(), 'wal');
    assert.equal(readyRes.body.sqlite.foreign_keys, 1);
  });

  // --------------------------------------------------------------------------
  // 2. AUTHENTICATION, COOKIES, CSRF & SESSION LIFECYCLE
  // --------------------------------------------------------------------------
  it('rejects invalid credentials with 401 and audits failed login attempt', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .send({ username: TEST_ADMIN_USER, password: 'wrong-password' });

    assert.equal(res.status, 401);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'INVALID_CREDENTIALS');
  });

  it('authenticates bootstrap Admin, sets HttpOnly SameSite=Strict cookie, and verifies session', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .send({ username: TEST_ADMIN_USER, password: TEST_ADMIN_PASS });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.authenticated, true);
    assert.equal(res.body.username, TEST_ADMIN_USER);
    assert.equal(res.body.role, 'Admin');
    assert.ok(res.body.token);
    assert.ok(res.body.csrfToken);

    const setCookieHeader = res.headers['set-cookie'];
    assert.ok(Array.isArray(setCookieHeader) && setCookieHeader.length > 0);
    assert.match(setCookieHeader[0], /HttpOnly/i);
    assert.match(setCookieHeader[0], /SameSite=Strict/i);

    adminToken = res.body.token;
    adminCsrf = res.body.csrfToken;
    adminCookie = setCookieHeader[0].split(';')[0];

    // Verify session via Bearer token
    const sessionBearer = await request(ctx.app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(sessionBearer.status, 200);
    assert.equal(sessionBearer.body.role, 'Admin');

    // Verify session via HttpOnly cookie alone
    const sessionCookie = await request(ctx.app)
      .get('/api/auth/session')
      .set('Cookie', adminCookie);
    assert.equal(sessionCookie.status, 200);
    assert.equal(sessionCookie.body.username, TEST_ADMIN_USER);
  });

  it('enforces CSRF token validation on state-changing requests authenticated via Cookie only', async () => {
    // Cookie-only mutation WITHOUT X-CSRF-Token must be blocked with 403
    const missingCsrfRes = await request(ctx.app)
      .post('/api/provision/user')
      .set('Cookie', adminCookie)
      .send({
        username: 'csrf_test_op',
        password: '123456',
        role: 'Viewer',
        rfid: 'AA:BB:CC:DD',
        pin: '123456'
      });

    assert.equal(missingCsrfRes.status, 403);
    assert.equal(missingCsrfRes.body.code, 'CSRF_INVALID');

    // Cookie-only mutation WITH valid X-CSRF-Token succeeds
    const validCsrfRes = await request(ctx.app)
      .post('/api/provision/user')
      .set('Cookie', adminCookie)
      .set('X-CSRF-Token', adminCsrf)
      .send({
        username: 'viewer_op',
        password: '654321',
        role: 'Viewer',
        rfid: 'A4:9F:21:0B',
        pin: '654321',
        face_linked: true
      });

    assert.equal(validCsrfRes.status, 201);
    assert.equal(validCsrfRes.body.ok, true);
    assert.equal(validCsrfRes.body.user.username, 'viewer_op');
    assert.equal(validCsrfRes.body.user.role, 'Viewer');
    assert.equal(validCsrfRes.body.user.pin_configured, true);
    assert.equal(validCsrfRes.body.user.provisioning_status, 'stored_pending_edge_sync');
    viewerId = validCsrfRes.body.user.id;
  });

  // --------------------------------------------------------------------------
  // 3. USER SAFETY & SECRET OMISSION TESTS
  // --------------------------------------------------------------------------
  it('omits password_hash, pin, and pin_verifier from GET /api/logs/system_users and stores scrypt hashes', async () => {
    const res = await request(ctx.app)
      .get('/api/logs/system_users')
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 2);

    for (const user of res.body) {
      assert.equal(user.password_hash, undefined, 'password_hash must never be exposed');
      assert.equal(user.pin, undefined, 'raw pin must never be exposed');
      assert.equal(user.pin_verifier, undefined, 'pin_verifier must never be exposed');
      assert.equal(typeof user.pin_configured, 'boolean');
    }

    // Inspect raw SQLite row directly to verify scrypt hashing
    const rawViewerRow = ctx.repo.findUserByUsername('viewer_op');
    assert.ok(rawViewerRow.password_hash.startsWith('scrypt$'));
    assert.ok(rawViewerRow.pin_verifier.startsWith('scrypt$'));
    assert.notEqual(rawViewerRow.password_hash, '654321');
    assert.notEqual(rawViewerRow.pin_verifier, '654321');
  });

  // --------------------------------------------------------------------------
  // 4. RBAC ENFORCEMENT & LAST-ADMIN PROTECTION
  // --------------------------------------------------------------------------
  it('enforces Viewer read-only RBAC restrictions across all admin endpoints and system_users', async () => {
    const loginRes = await request(ctx.app)
      .post('/api/auth/login')
      .send({ username: 'viewer_op', password: '654321' });

    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.body.role, 'Viewer');
    viewerToken = loginRes.body.token;
    viewerCsrf = loginRes.body.csrfToken;

    // Viewer CAN read operational logs
    const accessLogsRes = await request(ctx.app)
      .get('/api/logs/access_logs')
      .set('Authorization', `Bearer ${viewerToken}`);
    assert.equal(accessLogsRes.status, 200);
    assert.ok(Array.isArray(accessLogsRes.body));

    // Viewer CANNOT read system_users (403)
    const usersTableRes = await request(ctx.app)
      .get('/api/logs/system_users')
      .set('Authorization', `Bearer ${viewerToken}`);
    assert.equal(usersTableRes.status, 403);

    // Viewer CANNOT dispatch commands (403)
    const cmdRes = await request(ctx.app)
      .post('/api/command')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ command: 'TOGGLE_AUX_LIGHT', state: 'ON' });
    assert.equal(cmdRes.status, 403);

    // Viewer CANNOT provision users (403)
    const provRes = await request(ctx.app)
      .post('/api/provision/user')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        username: 'unauth_user',
        password: '111111',
        role: 'Viewer',
        rfid: '11:22:33:44',
        pin: '111111'
      });
    assert.equal(provRes.status, 403);

    // Viewer CANNOT change roles or delete users (403)
    const roleRes = await request(ctx.app)
      .post('/api/users/role')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ id: viewerId, role: 'Admin' });
    assert.equal(roleRes.status, 403);

    const delRes = await request(ctx.app)
      .post('/api/users/delete')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ id: viewerId });
    assert.equal(delRes.status, 403);
  });

  it('prevents deleting or demoting the last active Administrator account', async () => {
    const adminRow = ctx.repo.findUserByUsername(TEST_ADMIN_USER);

    const demoteRes = await request(ctx.app)
      .post('/api/users/role')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id: adminRow.id, role: 'Viewer' });
    assert.equal(demoteRes.status, 409);
    assert.equal(demoteRes.body.code, 'LAST_ADMIN_PROTECTED');

    const deleteRes = await request(ctx.app)
      .post('/api/users/delete')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id: adminRow.id });
    assert.equal(deleteRes.status, 409);
    assert.equal(deleteRes.body.code, 'LAST_ADMIN_PROTECTED');
  });

  it('blocks SQL injection / non-allowlisted table names on GET /api/logs/:table', async () => {
    const res1 = await request(ctx.app)
      .get('/api/logs/sessions')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(res1.status, 400);
    assert.equal(res1.body.code, 'TABLE_NOT_ALLOWED');

    const res2 = await request(ctx.app)
      .get('/api/logs/access_logs;DROP%20TABLE%20system_users')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(res2.status, 400);
  });

  // --------------------------------------------------------------------------
  // 5. MQTT INGESTION, DEDUPLICATION, WEBSOCKET BROADCAST & AGGREGATION
  // --------------------------------------------------------------------------
  it('rejects unauthenticated WebSocket upgrades with 401 and streams validated MQTT telemetry to authenticated clients', async () => {
    // 1. Unauthenticated WS connection must fail
    await new Promise((resolve) => {
      const unauthWs = new WebSocket(`${wsBaseUrl}/ws/telemetry`);
      unauthWs.on('unexpected-response', (_req, res) => {
        assert.equal(res.statusCode, 401);
        resolve();
      });
      unauthWs.on('error', () => resolve());
    });

    // 2. Authenticated WS connection receives live telemetry broadcast
    const receivedFrames = [];
    const authWs = new WebSocket(`${wsBaseUrl}/ws/telemetry?token=${encodeURIComponent(adminToken)}`);

    await new Promise((resolve, reject) => {
      authWs.once('open', resolve);
      authWs.once('error', reject);
    });

    const framePromise = new Promise((resolve) => {
      authWs.once('message', (data) => {
        const parsed = JSON.parse(data.toString('utf8'));
        receivedFrames.push(parsed);
        resolve(parsed);
      });
    });

    const ingestRes = ctx.mqttService.handleIncomingMessage(
      'lecf/env/telemetry',
      JSON.stringify({
        node_id: 'env_02',
        boot_id: 'boot-alpha',
        seq: 101,
        temperature: 26.4,
        humidity: 48.2,
        smoke_gas_level: 135,
        light_state: 'ON',
        fan_relay: 'OFF',
        door_state: 'CLOSED'
      })
    );

    assert.equal(ingestRes.ok, true);
    assert.equal(ingestRes.duplicate, false);

    const wsFrame = await framePromise;
    assert.equal(wsFrame.temperature, 26.4);
    assert.equal(wsFrame.humidity, 48.2);
    assert.equal(wsFrame.light_state, 'ON');

    // 3. Duplicate (node_id, boot_id, seq) frame is deduplicated and not re-inserted
    const dupRes = ctx.mqttService.handleIncomingMessage(
      'lecf/env/telemetry',
      JSON.stringify({
        node_id: 'env_02',
        boot_id: 'boot-alpha',
        seq: 101,
        temperature: 26.4,
        humidity: 48.2,
        smoke_gas_level: 135
      })
    );
    assert.equal(dupRes.ok, true);
    assert.equal(dupRes.duplicate, true);

    authWs.close();
  });

  it('rejects malformed and out-of-range MQTT payloads and records system_errors without crashing', async () => {
    const badJsonRes = ctx.mqttService.handleIncomingMessage('lecf/env/telemetry', '{bad_json');
    assert.equal(badJsonRes.ok, false);
    assert.equal(badJsonRes.error, 'MQTT_MALFORMED_JSON');

    const badRangeRes = ctx.mqttService.handleIncomingMessage(
      'lecf/env/telemetry',
      JSON.stringify({ temperature: 999.9, humidity: -20 })
    );
    assert.equal(badRangeRes.ok, false);
    assert.equal(badRangeRes.error, 'SCHEMA_VIOLATION');

    const errorsRes = await request(ctx.app)
      .get('/api/logs/system_errors')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(errorsRes.status, 200);
    assert.ok(errorsRes.body.length >= 2);
  });

  it('computes time-bucketed rollups on GET /api/telemetry/aggregate from persisted SQLite telemetry', async () => {
    // Insert a second valid telemetry sample
    ctx.mqttService.handleIncomingMessage(
      'lecf/env/telemetry',
      JSON.stringify({
        node_id: 'env_02',
        boot_id: 'boot-alpha',
        seq: 102,
        temperature: 28.6,
        humidity: 51.8,
        smoke_gas_level: 210,
        light_state: 'ON',
        fan_relay: 'ON'
      })
    );

    const aggRes = await request(ctx.app)
      .get('/api/telemetry/aggregate?range=24h&bucket=15m')
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(aggRes.status, 200);
    assert.equal(aggRes.body.ok, true);
    assert.equal(aggRes.body.range, '24h');
    assert.equal(aggRes.body.bucket, '15m');
    assert.ok(Array.isArray(aggRes.body.series));
    assert.ok(aggRes.body.series.length >= 1);

    const latestBucket = aggRes.body.series[aggRes.body.series.length - 1];
    assert.equal(latestBucket.sample_count, 2);
    assert.equal(latestBucket.temperature_min, 26.4);
    assert.equal(latestBucket.temperature_max, 28.6);
    assert.equal(latestBucket.temperature_avg, 27.5);
    assert.equal(latestBucket.smoke_gas_max, 210);
  });

  // --------------------------------------------------------------------------
  // 6. COMMAND COORDINATOR LIFECYCLE TESTS
  // --------------------------------------------------------------------------
  it('returns 503 unavailable when dispatching a command while MQTT broker is offline', async () => {
    const res = await request(ctx.app)
      .post('/api/command')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        command: 'TOGGLE_HVAC_FAN',
        state: 'ON'
      });

    assert.equal(res.status, 503);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.lifecycle_state, 'unavailable');
    assert.equal(res.body.verified_hardware_ack, false);

    const audit = ctx.repo.getCommandAudit(res.body.command_id);
    assert.ok(audit);
    assert.equal(audit.lifecycle_state, 'unavailable');
  });

  it('publishes valid commands when MQTT is connected, distinguishes published vs acknowledged, and correlates device ACKs', async () => {
    // Enable simulated connected MQTT broker hook
    ctx.mqttService.config.mqttEnabled = true;
    ctx.mqttService.connected = true;
    ctx.mqttService.client = { connected: true };
    ctx.mqttService.publishCommand = async (topic, payload, opts) => {
      publishedMqttMessages.push({ topic, payload, opts });
      return true;
    };

    // 1. Command without immediate device ACK returns lifecycle_state = 'published' (verified_hardware_ack = false)
    const pubRes = await request(ctx.app)
      .post('/api/command')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        command: 'TOGGLE_AUX_LIGHT',
        state: 'ON',
        ip_node2: '10.99.99.99' // Must be ignored in favor of server-authoritative topic mapping
      });

    assert.equal(pubRes.status, 200);
    assert.equal(pubRes.body.ok, true);
    assert.equal(pubRes.body.lifecycle_state, 'published');
    assert.equal(pubRes.body.verified_hardware_ack, false);
    assert.equal(pubRes.body.mqtt_topic, 'lecf/env/command');

    assert.equal(publishedMqttMessages.length, 1);
    assert.equal(publishedMqttMessages[0].topic, 'lecf/env/command');
    assert.equal(publishedMqttMessages[0].opts.retain, false);
    assert.equal(publishedMqttMessages[0].payload.command_id, pubRes.body.command_id);

    // 2. Simulate device ACK arriving on lecf/env/command/ack -> transitions audit row to state_confirmed
    const ackRes = ctx.mqttService.handleIncomingMessage(
      'lecf/env/command/ack',
      JSON.stringify({
        command_id: pubRes.body.command_id,
        node_id: 'env_02',
        status: 'executed',
        observed_state: 'ON'
      })
    );
    assert.equal(ackRes.ok, true);

    const updatedAudit = ctx.repo.getCommandAudit(pubRes.body.command_id);
    assert.equal(updatedAudit.lifecycle_state, 'state_confirmed');

    // 3. Reject invalid command/state combination (e.g. EMERGENCY_DOOR_UNLOCK with ON)
    const invalidStateRes = await request(ctx.app)
      .post('/api/command')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        command: 'EMERGENCY_DOOR_UNLOCK',
        state: 'ON'
      });
    assert.equal(invalidStateRes.status, 400);
    assert.equal(invalidStateRes.body.code, 'INVALID_COMMAND_PAYLOAD');
  });

  it('rejects WebSocket query-string session tokens when Bearer compatibility is disabled', () => {
    const auth = createAuthMiddleware(
      {
        verifySessionToken(token) {
          if (token !== 'test-valid-session') return null;
          return {
            sessionId: 'test-session-id',
            csrfToken: 'test-csrf',
            user: { id: 1, username: 'test-admin', role: 'Admin' }
          };
        }
      },
      {
        sessionCookieName: 'lci_sid',
        allowBearerCompat: false,
        sessionIdleTtlMs: 60000
      }
    );

    const queryOnly = auth.authenticateWsUpgrade({
      headers: {},
      url: '/ws/telemetry?token=test-valid-session'
    });
    assert.equal(queryOnly, null);

    const cookieSession = auth.authenticateWsUpgrade({
      headers: { cookie: 'lci_sid=test-valid-session' },
      url: '/ws/telemetry'
    });
    assert.equal(cookieSession?.user?.role, 'Admin');
    assert.equal(cookieSession?.rawToken, 'test-valid-session');
  });

  // --------------------------------------------------------------------------
  // 7. HOT BACKUP / RESTORE & LOGOUT REVOCATION
  // --------------------------------------------------------------------------
  it('creates a verified SQLite hot backup via VACUUM INTO and restores cleanly', () => {
    const backupFilePath = path.join(tmpDir, 'backups', 'hot_backup.db');
    const outPath = createDatabaseBackup(dbPath, backupFilePath);
    assert.equal(outPath, backupFilePath);
    assert.ok(fs.existsSync(backupFilePath));

    const restoreTarget = path.join(tmpDir, 'restored_lci.db');
    const restoredPath = restoreDatabaseBackup(backupFilePath, restoreTarget);
    assert.equal(restoredPath, restoreTarget);
    assert.ok(fs.existsSync(restoreTarget));
  });

  it('revokes session on POST /api/auth/logout and rejects subsequent requests with old token', async () => {
    const logoutRes = await request(ctx.app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${viewerToken}`)
      .set('X-CSRF-Token', viewerCsrf);

    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.body.logged_out, true);

    const afterLogoutRes = await request(ctx.app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${viewerToken}`);
    assert.equal(afterLogoutRes.status, 401);
  });

  // --------------------------------------------------------------------------
  // 8. PRODUCTION CONFIG HARDENING, ADMIN PROFILE ROTATION & FRONTEND CONTRACTS
  // --------------------------------------------------------------------------
  it('enforces strict production secret validation at startup in loadConfig', () => {
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: 'production',
          LCI_BOOTSTRAP_ADMIN_USERNAME: 'admin',
          LCI_BOOTSTRAP_ADMIN_PASSWORD: 'a'.repeat(32),
          MQTT_ENABLED: 'false'
        }),
      /LCI_BOOTSTRAP_ADMIN_USERNAME/
    );

    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: 'production',
          LCI_BOOTSTRAP_ADMIN_USERNAME: 'sfm_admin',
          LCI_BOOTSTRAP_ADMIN_PASSWORD: 'REPLACE_WITH_A_UNIQUE_RANDOM_PASSWORD_32_CHARS_MINIMUM',
          MQTT_ENABLED: 'false'
        }),
      /LCI_BOOTSTRAP_ADMIN_PASSWORD/
    );

    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: 'production',
          LCI_BOOTSTRAP_ADMIN_USERNAME: 'sfm_admin',
          LCI_BOOTSTRAP_ADMIN_PASSWORD: 'V3ryLongRandomBootstrapSecretValue_2026!',
          MQTT_ENABLED: 'true',
          MQTT_PASSWORD: 'replace_with_mosquitto_backend_secret'
        }),
      /MQTT_PASSWORD/
    );
  });

  it('rotates Administrator credentials via POST /api/auth/admin-profile and invalidates old password', async () => {
    const rotateRes = await request(ctx.app)
      .post('/api/auth/admin-profile')
      .set('Cookie', adminCookie)
      .set('X-CSRF-Token', adminCsrf)
      .send({
        currentUsername: TEST_ADMIN_USER,
        newUsername: 'sfm_chief_admin',
        newPassword: 'Updated-Str0ng-Pass#2026'
      });

    assert.equal(rotateRes.status, 200);
    assert.equal(rotateRes.body.ok, true);
    assert.equal(rotateRes.body.username, 'sfm_chief_admin');

    const oldLoginRes = await request(ctx.app)
      .post('/api/auth/login')
      .send({ username: TEST_ADMIN_USER, password: TEST_ADMIN_PASS });
    assert.equal(oldLoginRes.status, 401);

    const newLoginRes = await request(ctx.app)
      .post('/api/auth/login')
      .send({ username: 'sfm_chief_admin', password: 'Updated-Str0ng-Pass#2026' });
    assert.equal(newLoginRes.status, 200);
    assert.equal(newLoginRes.body.role, 'Admin');
  });

  it('auto-migrates only the legacy 192.168.43.225:1880 host while preserving custom hosts and formats readiness status', async () => {
    // 1. Legacy 192.168.43.225:1880 stored host auto-migrates when served from a different browser origin
    const migrated = resolveInitialServerHost(LEGACY_NODE_RED_HOST, 'localhost:3000');
    assert.equal(migrated.host, 'localhost:3000');
    assert.equal(migrated.migrated, true);

    // 2. Intentional custom host is preserved untouched
    const custom = resolveInitialServerHost('10.20.30.40:3000', 'localhost:3000');
    assert.equal(custom.host, '10.20.30.40:3000');
    assert.equal(custom.migrated, false);

    // 3. Empty/missing stored host defaults to current browser origin
    const empty = resolveInitialServerHost('', '192.168.1.50:8080');
    assert.equal(empty.host, '192.168.1.50:8080');
    assert.equal(empty.migrated, false);

    // 4. Readiness formatter matches real GET /api/health/ready response payload
    const readyRes = await request(ctx.app).get('/api/health/ready');
    assert.equal(readyRes.status, 200);
    assert.equal(readyRes.body.mqtt.state, 'connected');
    const summary = formatReadinessSummary(readyRes.body);
    assert.equal(summary, 'SQLite: OK (WAL) · MQTT: Connected');
    assert.equal(
      formatReadinessSummary({
        ok: true,
        status: 'ready',
        sqlite: { ok: true, journal_mode: 'wal' },
        mqtt: { enabled: false, connected: false, state: 'standby' }
      }),
      'SQLite: OK (WAL) · MQTT: Standby'
    );
  });

  it('enforces liveness vs. readiness contract across MQTT connected, MQTT disconnected, MQTT standby, and SQLite failure states', async () => {
    const origEnabled = ctx.mqttService.config.mqttEnabled;
    const origConnected = ctx.mqttService.connected;
    const origClient = ctx.mqttService.client;
    const origHealthCheck = ctx.db.healthCheck.bind(ctx.db);

    try {
      // Case A: MQTT enabled & connected + SQLite healthy -> 200 ready
      ctx.mqttService.config.mqttEnabled = true;
      ctx.mqttService.connected = true;
      ctx.mqttService.client = { connected: true };
      const resConnected = await request(ctx.app).get('/api/health/ready');
      assert.equal(resConnected.status, 200);
      assert.equal(resConnected.body.ok, true);
      assert.equal(resConnected.body.status, 'ready');
      assert.equal(resConnected.body.mqtt.enabled, true);
      assert.equal(resConnected.body.mqtt.connected, true);
      assert.equal(resConnected.body.mqtt.state, 'connected');
      assert.equal(formatReadinessSummary(resConnected.body), 'SQLite: OK (WAL) · MQTT: Connected');

      // Case B: MQTT enabled & disconnected + SQLite healthy -> 503 degraded, while /api/health/live remains 200
      ctx.mqttService.connected = false;
      ctx.mqttService.client = { connected: false };
      const resDisconnected = await request(ctx.app).get('/api/health/ready');
      assert.equal(resDisconnected.status, 503);
      assert.equal(resDisconnected.body.ok, false);
      assert.equal(resDisconnected.body.status, 'degraded');
      assert.equal(resDisconnected.body.sqlite.ok, true);
      assert.equal(resDisconnected.body.mqtt.enabled, true);
      assert.equal(resDisconnected.body.mqtt.connected, false);
      assert.equal(resDisconnected.body.mqtt.state, 'disconnected');
      assert.equal(
        formatReadinessSummary(resDisconnected.body),
        'DEGRADED · SQLite: OK (WAL) · MQTT: Disconnected'
      );

      const liveDuringOutage = await request(ctx.app).get('/api/health/live');
      assert.equal(liveDuringOutage.status, 200);
      assert.equal(liveDuringOutage.body.ok, true);
      assert.equal(liveDuringOutage.body.status, 'live');

      // Case C: MQTT intentionally disabled (MQTT_ENABLED=false) -> 200 ready with state 'standby' (never pretends connected)
      ctx.mqttService.config.mqttEnabled = false;
      ctx.mqttService.connected = true; // Even if flag were truthy, disabled service must report connected: false, state: 'standby'
      ctx.mqttService.client = { connected: true };
      const resStandby = await request(ctx.app).get('/api/health/ready');
      assert.equal(resStandby.status, 200);
      assert.equal(resStandby.body.ok, true);
      assert.equal(resStandby.body.status, 'ready');
      assert.equal(resStandby.body.mqtt.enabled, false);
      assert.equal(resStandby.body.mqtt.connected, false);
      assert.equal(resStandby.body.mqtt.state, 'standby');
      assert.equal(formatReadinessSummary(resStandby.body), 'SQLite: OK (WAL) · MQTT: Standby');

      // Case D: SQLite failure -> 503 degraded while /api/health/live remains 200
      ctx.mqttService.config.mqttEnabled = true;
      ctx.mqttService.connected = true;
      ctx.mqttService.client = { connected: true };
      ctx.db.healthCheck = () => ({ ok: false, error: 'Simulated SQLite I/O fault' });
      const resDbFault = await request(ctx.app).get('/api/health/ready');
      assert.equal(resDbFault.status, 503);
      assert.equal(resDbFault.body.ok, false);
      assert.equal(resDbFault.body.status, 'degraded');
      assert.equal(resDbFault.body.sqlite.ok, false);
      assert.equal(
        formatReadinessSummary(resDbFault.body),
        'DEGRADED · SQLite: DEGRADED · MQTT: Connected'
      );

      const liveDuringDbFault = await request(ctx.app).get('/api/health/live');
      assert.equal(liveDuringDbFault.status, 200);
      assert.equal(liveDuringDbFault.body.ok, true);
    } finally {
      ctx.mqttService.config.mqttEnabled = origEnabled;
      ctx.mqttService.connected = origConnected;
      ctx.mqttService.client = origClient;
      ctx.db.healthCheck = origHealthCheck;
    }
  });

  it('validates frontend sanitization, strict data types, LocalFIFOChart sliding window, and DOM ID parity', () => {
    const sanitized = sanitizeInput('<script>alert(1)</script>DROP TABLE users;--admin');
    assert.equal(sanitized, 'TABLE usersadmin');
    assert.ok(!sanitized.includes('<script>') && !sanitized.includes('DROP') && !sanitized.includes(';') && !sanitized.includes('--'));
    assert.equal(escapeHTML('<div class="x">&\'</div>'), '&lt;div class=&quot;x&quot;&gt;&amp;&#39;&lt;/div&gt;');
    assert.equal(isValidIPv4('192.168.43.11'), true);
    assert.equal(isValidIPv4('999.168.43.11'), false);
    assert.equal(isValidHostPort('localhost:3000'), true);
    assert.equal(isValidHostPort('192.168.43.225:1880'), true);
    assert.equal(isValidHexRFID('A4:9F:21:0B'), true);
    assert.equal(isValidHexRFID('ZZZZ'), false);
    assert.equal(isValidSixDigitPin('042819'), true);
    assert.equal(isValidSixDigitPin('12345'), false);

    const chart = new LocalFIFOChart(null, { maxPoints: 30, unit: '°C' });
    for (let i = 1; i <= 35; i++) {
      chart.pushValue(`12:00:${String(i).padStart(2, '0')}`, 20 + i * 0.5);
    }
    assert.equal(chart.data.length, 30);
    assert.equal(chart.labels.length, 30);
    assert.equal(chart.data[0], 23.0);
    chart.reset();
    assert.equal(chart.data.length, 0);

    // Verify index.html has zero duplicate IDs and satisfies every getElementById reference in app.js
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
    const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
    const js = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');

    const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    const seen = new Set();
    const duplicates = [];
    for (const id of htmlIds) {
      if (seen.has(id)) duplicates.push(id);
      seen.add(id);
    }
    assert.deepEqual(duplicates, [], `Duplicate DOM IDs found in index.html: ${duplicates.join(', ')}`);

    const jsIds = [...new Set([...js.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]))];
    const missingIds = jsIds.filter((id) => !seen.has(id));
    assert.deepEqual(missingIds, [], `Missing DOM IDs referenced by app.js: ${missingIds.join(', ')}`);
  });

  // --------------------------------------------------------------------------
  // 9. SECURITY HARDENING: COOKIE+BEARER CSRF BYPASS, IDLE/ABS EXPIRY, RATE LIMIT
  // --------------------------------------------------------------------------
  it('blocks CSRF bypass when a valid session cookie is sent alongside an invalid or valid Bearer header', async () => {
    // Re-authenticate as sfm_chief_admin to get fresh cookie, token, and csrfToken
    const loginRes = await request(ctx.app)
      .post('/api/auth/login')
      .send({ username: 'sfm_chief_admin', password: 'Updated-Str0ng-Pass#2026' });
    assert.equal(loginRes.status, 200);
    const freshCookie = loginRes.headers['set-cookie'][0].split(';')[0];
    const freshToken = loginRes.body.token;
    const freshCsrf = loginRes.body.csrfToken;

    // 1. Valid cookie + invalid/arbitrary Bearer token + NO CSRF -> MUST be 403 CSRF_INVALID
    const bypassAttempt1 = await request(ctx.app)
      .post('/api/provision/user')
      .set('Cookie', freshCookie)
      .set('Authorization', 'Bearer arbitrary-invalid-attacker-token')
      .send({
        username: 'attacker_op',
        password: '123456',
        role: 'Admin',
        rfid: 'DE:AD:BE:EF',
        pin: '123456'
      });
    assert.equal(bypassAttempt1.status, 403);
    assert.equal(bypassAttempt1.body.code, 'CSRF_INVALID');

    // 2. Valid cookie + valid Bearer token + NO CSRF -> MUST be 403 CSRF_INVALID because cookie authenticated the request
    const bypassAttempt2 = await request(ctx.app)
      .post('/api/provision/user')
      .set('Cookie', freshCookie)
      .set('Authorization', `Bearer ${freshToken}`)
      .send({
        username: 'attacker_op2',
        password: '123456',
        role: 'Admin',
        rfid: 'DE:AD:BE:E0',
        pin: '123456'
      });
    assert.equal(bypassAttempt2.status, 403);
    assert.equal(bypassAttempt2.body.code, 'CSRF_INVALID');

    // 3. Valid cookie + wrong CSRF token -> 403 CSRF_INVALID
    const wrongCsrfAttempt = await request(ctx.app)
      .post('/api/provision/user')
      .set('Cookie', freshCookie)
      .set('X-CSRF-Token', 'wrong-csrf-token-value')
      .send({
        username: 'attacker_op3',
        password: '123456',
        role: 'Viewer',
        rfid: 'DE:AD:BE:E1',
        pin: '123456'
      });
    assert.equal(wrongCsrfAttempt.status, 403);
    assert.equal(wrongCsrfAttempt.body.code, 'CSRF_INVALID');

    // 4. Invalid cookie + valid Bearer token (when allowBearerCompat=true) -> allowed as bearer
    const fallbackBearerRes = await request(ctx.app)
      .get('/api/auth/session')
      .set('Cookie', 'lci_sid=invalid-expired-cookie-token')
      .set('Authorization', `Bearer ${freshToken}`);
    assert.equal(fallbackBearerRes.status, 200);
    assert.equal(fallbackBearerRes.body.username, 'sfm_chief_admin');

    // 5. Invalid cookie + invalid Bearer token -> 401 UNAUTHORIZED
    const bothInvalidRes = await request(ctx.app)
      .get('/api/auth/session')
      .set('Cookie', 'lci_sid=invalid-cookie')
      .set('Authorization', 'Bearer invalid-bearer');
    assert.equal(bothInvalidRes.status, 401);

    // 6. Cookie-authenticated logout without CSRF token -> 403 CSRF_INVALID (prevents forced logout CSRF)
    const logoutNoCsrf = await request(ctx.app)
      .post('/api/auth/logout')
      .set('Cookie', freshCookie);
    assert.equal(logoutNoCsrf.status, 403);
    assert.equal(logoutNoCsrf.body.code, 'CSRF_INVALID');

    // 7. Cookie-authenticated logout WITH valid CSRF token -> 200 OK
    const logoutValidCsrf = await request(ctx.app)
      .post('/api/auth/logout')
      .set('Cookie', freshCookie)
      .set('X-CSRF-Token', freshCsrf);
    assert.equal(logoutValidCsrf.status, 200);
  });

  it('defaults ALLOW_BEARER_COMPAT to false in production and rejects Bearer/query tokens when disabled', () => {
    const prodConfig = loadConfig({
      NODE_ENV: 'production',
      LCI_BOOTSTRAP_ADMIN_USERNAME: 'sfm_prod_admin',
      LCI_BOOTSTRAP_ADMIN_PASSWORD: 'Prod-Random-Bootstrap-Secret-32Chars!',
      MQTT_ENABLED: 'false'
    });
    assert.equal(prodConfig.allowBearerCompat, false);

    const authStrict = createAuthMiddleware(
      {
        verifySessionToken(token) {
          return token === 'valid-tok'
            ? { sessionId: 's1', csrfToken: 'csrf1', user: { id: 1, username: 'op', role: 'Admin' } }
            : null;
        }
      },
      {
        isProd: true,
        sessionCookieName: 'lci_sid',
        allowBearerCompat: false,
        sessionIdleTtlMs: 60000
      }
    );

    // Bearer-only request must be rejected when allowBearerCompat is false
    const bearerSession = authStrict.resolveRequestSession({
      headers: { authorization: 'Bearer valid-tok' }
    });
    assert.equal(bearerSession, null);
  });

  it('enforces idle and absolute session expiration and prevents X-Forwarded-For rate-limit spoofing', async () => {
    const adminUser = ctx.repo.findUserByUsername('sfm_chief_admin');
    // 1. Create a session with 10ms TTL and verify it expires immediately
    const shortSession = ctx.repo.createSession({
      userId: adminUser.id,
      ttlMs: -1000
    });
    assert.equal(ctx.repo.verifySessionToken(shortSession.rawToken, 60000), null);

    // 2. Create a session and verify idle timeout revokes it when idleTtlMs is exceeded
    const idleSession = ctx.repo.createSession({
      userId: adminUser.id,
      ttlMs: 3600000
    });
    // Backdate last_seen_at by 10 minutes
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    ctx.db
      .prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
      .run(tenMinAgo, idleSession.sessionId);
    assert.equal(ctx.repo.verifySessionToken(idleSession.rawToken, 5 * 60 * 1000), null);

    // 3. Verify rate limiter cannot be bypassed via spoofed X-Forwarded-For headers when trustProxy=false
    for (let i = 0; i < 15; i++) {
      await request(ctx.app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', `203.0.113.${i + 1}`)
        .send({ username: 'rate_limit_probe_user', password: 'bad' });
    }
    const limitedRes = await request(ctx.app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '198.51.100.99')
      .send({ username: 'rate_limit_probe_user', password: 'bad' });
    assert.equal(limitedRes.status, 429);
    assert.equal(limitedRes.body.code, 'RATE_LIMITED');
    assert.ok(limitedRes.headers['retry-after']);
  });

  // --------------------------------------------------------------------------
  // 10. MQTT TRANSIENT DNS RETRY & SUBSCRIPTION READINESS VERIFICATION
  // --------------------------------------------------------------------------
  it('recovers from transient MQTT DNS lookup failures via bounded backoff and verifies topic subscription readiness', async () => {
    const { EventEmitter } = await import('node:events');
    const { MqttService } = await import('../src/mqtt/mqttClient.js');

    let dnsCalls = 0;
    let connectCalls = 0;
    let fakeClient = null;
    let simulateSubErrorTopic = null;
    let simulateSubRejectQosTopic = null;

    const mockDnsLookup = (_host, cb) => {
      dnsCalls += 1;
      if (dnsCalls < 3) {
        const err = new Error('getaddrinfo EAI_AGAIN mqtt-service');
        err.code = 'EAI_AGAIN';
        setImmediate(() => cb(err));
        return;
      }
      setImmediate(() => cb(null, '172.18.0.5', 4));
    };

    const mockMqttConnect = () => {
      connectCalls += 1;
      const emitter = new EventEmitter();
      emitter.connected = false;
      emitter.subscribe = (topic, opts, cb) => {
        setImmediate(() => {
          if (simulateSubErrorTopic === topic) {
            cb(new Error('ACL_DENIED'));
          } else if (simulateSubRejectQosTopic === topic) {
            cb(null, [{ topic, qos: 128 }]);
          } else {
            cb(null, [{ topic, qos: opts?.qos ?? 0 }]);
          }
        });
      };
      emitter.end = (_force, _opts, cb) => {
        emitter.connected = false;
        if (cb) setImmediate(cb);
      };
      fakeClient = emitter;
      setImmediate(() => {
        emitter.connected = true;
        emitter.emit('connect');
      });
      return emitter;
    };

    const mqttSvc = new MqttService({
      config: {
        mqttEnabled: true,
        mqttBrokerUrl: 'mqtt://mqtt-service:1883',
        mqttClientId: 'test-dns-retry-client',
        mqttConnectTimeoutMs: 500,
        mqttReconnectPeriodMs: 500,
        mqttDnsRetryBaseMs: 50,
        mqttDnsRetryMaxMs: 200
      },
      repo: ctx.repo,
      wsGateway: null,
      commandCoordinator: null,
      dnsLookup: mockDnsLookup,
      mqttConnect: mockMqttConnect
    });

    mqttSvc.connect();

    // Wait for 2 failed DNS attempts + 3rd successful DNS attempt + subscription callbacks
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 3000;
      const timer = setInterval(() => {
        const status = mqttSvc.getHealthStatus();
        if (status.connected && status.subscriptions_ready) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error(`Timed out waiting for MQTT DNS retry recovery: ${JSON.stringify(status)}`));
        }
      }, 25);
    });

    assert.equal(dnsCalls, 3, 'Should retry DNS until 3rd attempt succeeds');
    assert.equal(connectCalls, 1, 'Must create exactly one singleton MQTT client');
    const healthyStatus = mqttSvc.getHealthStatus();
    assert.equal(healthyStatus.enabled, true);
    assert.equal(healthyStatus.connected, true);
    assert.equal(healthyStatus.subscriptions_ready, true);
    assert.equal(healthyStatus.state, 'connected');
    assert.equal(healthyStatus.subscribed_topics.length, 6);

    // Simulate reconnect where one required topic receives SUBACK 0x80 (128) failure grant
    simulateSubRejectQosTopic = 'lecf/env/telemetry';
    fakeClient.emit('connect');
    await new Promise((r) => setTimeout(r, 40));

    const degradedSubStatus = mqttSvc.getHealthStatus();
    assert.equal(degradedSubStatus.connected, true);
    assert.equal(degradedSubStatus.subscriptions_ready, false);
    assert.equal(degradedSubStatus.state, 'degraded');
    assert.ok(degradedSubStatus.failed_subscriptions['lecf/env/telemetry']);
    assert.equal(
      formatReadinessSummary({
        ok: false,
        status: 'degraded',
        sqlite: { ok: true, journal_mode: 'wal' },
        mqtt: degradedSubStatus
      }),
      'DEGRADED · SQLite: OK (WAL) · MQTT: Subs Degraded'
    );

    // Clear subscription failure and simulate clean reconnect
    simulateSubRejectQosTopic = null;
    simulateSubErrorTopic = null;
    fakeClient.emit('connect');
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(mqttSvc.getHealthStatus().subscriptions_ready, true);
    assert.equal(mqttSvc.getHealthStatus().state, 'connected');

    await mqttSvc.close();
    assert.equal(mqttSvc.isConnected(), false);
  });

  // --------------------------------------------------------------------------
  // 11. SQLITE PATH VALIDATION, MIGRATION ROLLBACK & BACKUP/RESTORE HARDENING
  // --------------------------------------------------------------------------
  it('enforces fail-fast SQLite path validation, migration rollback on error, and backup/restore integrity checks', async () => {
    const { SqliteDatabase } = await import('../src/db/database.js');

    // 1. Passing a directory as SQLITE_DB_PATH must throw FATAL CONFIG ERROR and never silently fall back
    const dirAsDbPath = path.join(tmpDir, 'directory_not_a_db_file');
    fs.mkdirSync(dirAsDbPath, { recursive: true });
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: 'production',
          SQLITE_DB_PATH: dirAsDbPath,
          LCI_BOOTSTRAP_ADMIN_USERNAME: 'sfm_admin',
          LCI_BOOTSTRAP_ADMIN_PASSWORD: 'V3ryLongRandomBootstrapSecretValue_2026!',
          MQTT_ENABLED: 'false'
        }),
      /FATAL CONFIG ERROR: SQLite database path/
    );

    // 2. Invalid MQTT_BROKER_URL protocol must throw FATAL CONFIG ERROR when MQTT_ENABLED=true
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: 'development',
          MQTT_ENABLED: 'true',
          MQTT_BROKER_URL: 'http://not-an-mqtt-broker:1883'
        }),
      /FATAL CONFIG ERROR: Unsupported MQTT_BROKER_URL/
    );

    // 3. Invalid FRONTEND_BIND_IP must throw FATAL CONFIG ERROR
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: 'development',
          FRONTEND_BIND_IP: '999.168.1.1',
          MQTT_ENABLED: 'false'
        }),
      /FATAL CONFIG ERROR: FRONTEND_BIND_IP/
    );

    // 4. Corrupt / non-SQLite backup file must be rejected by restoreDatabaseBackup without touching target
    const corruptBackupPath = path.join(tmpDir, 'corrupt_backup.db');
    fs.writeFileSync(corruptBackupPath, 'NOT_A_VALID_SQLITE_HEADER_BYTES');
    const safeTargetPath = path.join(tmpDir, 'safe_target.db');
    const validBackupPath = path.join(tmpDir, 'backups', 'hot_backup.db');
    fs.copyFileSync(validBackupPath, safeTargetPath);

    assert.throws(
      () => restoreDatabaseBackup(corruptBackupPath, safeTargetPath),
      /failed|not a database|file is not a database/i
    );

    // 5. Refuse overwriting target when refuseIfActiveWal=true and -wal file exists
    fs.writeFileSync(`${safeTargetPath}-wal`, 'simulated-active-wal');
    assert.throws(
      () => restoreDatabaseBackup(validBackupPath, safeTargetPath, { refuseIfActiveWal: true }),
      /active WAL\/SHM files exist/
    );
    fs.unlinkSync(`${safeTargetPath}-wal`);

    // 6. Failed SQLite migration rolls back and marks healthCheck as ok: false
    const badMigDir = path.join(tmpDir, 'bad_migrations');
    fs.mkdirSync(badMigDir, { recursive: true });
    fs.writeFileSync(
      path.join(badMigDir, '001_broken.sql'),
      'CREATE TABLE test_mig (id INTEGER PRIMARY KEY); INVALID SQL SYNTAX HERE;'
    );
    const migTestDb = new SqliteDatabase(path.join(tmpDir, 'mig_fail.db'));
    assert.throws(() => migTestDb.runMigrations(badMigDir));
    const migHealth = migTestDb.healthCheck();
    assert.equal(migHealth.ok, false);
    assert.match(String(migHealth.error), /migration_failed/);
    migTestDb.close();
  });

  // --------------------------------------------------------------------------
  // 12. COMMAND COORDINATOR EDGE CASES (NODE MISMATCH, UNKNOWN ID, DUPLICATE ACK)
  // --------------------------------------------------------------------------
  it('rejects command ACKs from mismatched nodes or unknown command_ids and ignores duplicate ACKs', async () => {
    ctx.mqttService.config.mqttEnabled = true;
    ctx.mqttService.connected = true;
    ctx.mqttService.client = { connected: true };
    ctx.mqttService.publishCommand = async () => true;

    const adminUser = ctx.repo.findUserByUsername('sfm_chief_admin');
    const dispatchRes = await ctx.commandCoordinator.dispatchCommand({
      command: 'EMERGENCY_DOOR_UNLOCK',
      state: 'OPEN',
      actor: { id: adminUser.id, username: adminUser.username },
      requestId: 'req-edge-case-1',
      waitForAckMs: 20
    });
    assert.equal(dispatchRes.httpStatus, 200);
    const cmdId = dispatchRes.body.command_id;
    assert.equal(dispatchRes.body.target_node, 'node1');

    // 1. Telemetry from env_02 with door_state='OPEN' MUST NOT confirm node1's pending command
    ctx.commandCoordinator.handleObservedState('env_02', { door_state: 'OPEN' });
    assert.equal(ctx.repo.getCommandAudit(cmdId).lifecycle_state, 'published');

    // 2. ACK from wrong node (env_02 instead of node1) MUST be rejected with NODE_MISMATCH
    const wrongNodeAck = ctx.commandCoordinator.handleCommandAck({
      command_id: cmdId,
      node_id: 'env_02',
      status: 'executed',
      observed_state: 'OPEN'
    });
    assert.equal(wrongNodeAck.ok, false);
    assert.equal(wrongNodeAck.reason, 'NODE_MISMATCH');
    assert.equal(ctx.repo.getCommandAudit(cmdId).lifecycle_state, 'published');

    // 3. ACK for unknown command_id MUST be rejected with UNKNOWN_COMMAND_ID
    const unknownAck = ctx.commandCoordinator.handleCommandAck({
      command_id: '00000000-0000-0000-0000-000000000000',
      node_id: 'node1',
      status: 'executed',
      observed_state: 'OPEN'
    });
    assert.equal(unknownAck.ok, false);
    assert.equal(unknownAck.reason, 'UNKNOWN_COMMAND_ID');

    // 4. Valid ACK from node1 transitions command to state_confirmed
    const validAck = ctx.commandCoordinator.handleCommandAck({
      command_id: cmdId,
      node_id: 'node1',
      status: 'executed',
      observed_state: 'OPEN'
    });
    assert.equal(validAck.ok, true);
    assert.equal(validAck.duplicate, false);
    assert.equal(validAck.lifecycle_state, 'state_confirmed');

    // 5. Duplicate ACK for the same command_id is ignored idempotently
    const dupAck = ctx.commandCoordinator.handleCommandAck({
      command_id: cmdId,
      node_id: 'node1',
      status: 'failed',
      message: 'late duplicate frame'
    });
    assert.equal(dupAck.ok, true);
    assert.equal(dupAck.duplicate, true);
    assert.equal(ctx.repo.getCommandAudit(cmdId).lifecycle_state, 'state_confirmed');
  });

  // --------------------------------------------------------------------------
  // 12B. PRE-HARDWARE SAFETY: NODE FRESHNESS & TRUTHFUL ACK LIFECYCLE
  // --------------------------------------------------------------------------
  it('does not call a stale edge node online simply because the broker is connected', () => {
    ctx.mqttService.config.mqttEnabled = true;
    ctx.mqttService.connected = true;
    ctx.mqttService.client = { connected: true };
    ctx.mqttService.config.mqttNodeStaleMs = 1500;
    ctx.mqttService.nodeHeartbeats.set('test-stale-node', {
      status: 'ONLINE',
      last_seen_at: new Date(Date.now() - 60_000).toISOString()
    });
    const healthyBroker = ctx.mqttService.getHealthStatus();
    assert.equal(healthyBroker.connected, true);
    assert.equal(healthyBroker.observed_nodes['test-stale-node'].status, 'STALE');
    assert.equal(healthyBroker.observed_nodes['test-stale-node'].fresh, false);

    ctx.mqttService.connected = false;
    assert.equal(ctx.mqttService.getHealthStatus().observed_nodes['test-stale-node'].status, 'UNKNOWN');
    ctx.mqttService.connected = true;
    ctx.mqttService.config.mqttNodeStaleMs = 90000;
  });

  it('rejects wrong-topic ACKs and mismatched state without claiming physical confirmation', async () => {
    ctx.mqttService.config.mqttEnabled = true;
    ctx.mqttService.connected = true;
    ctx.mqttService.client = { connected: true };
    ctx.mqttService.publishCommand = async () => true;
    const adminUser = ctx.repo.findUserByUsername('sfm_chief_admin');

    const dispatch = (state, requestId) => ctx.commandCoordinator.dispatchCommand({
      command: 'TOGGLE_AUX_LIGHT', state,
      actor: { id: adminUser.id, username: adminUser.username },
      requestId, waitForAckMs: 10
    });

    const first = await dispatch('ON', 'ack-source-check');
    assert.equal(first.body.lifecycle_state, 'published');
    const wrong = ctx.mqttService.handleIncomingMessage('lecf/access/command/ack', JSON.stringify({
      command_id: first.body.command_id, node_id: 'env_02', status: 'executed', observed_state: 'ON'
    }));
    assert.equal(wrong.ok, false);
    assert.equal(wrong.reason, 'TOPIC_MISMATCH');
    assert.equal(ctx.repo.getCommandAudit(first.body.command_id).lifecycle_state, 'published');
    const mismatched = ctx.mqttService.handleIncomingMessage('lecf/env/command/ack', JSON.stringify({
      command_id: first.body.command_id, node_id: 'env_02', status: 'executed', observed_state: 'OFF'
    }));
    assert.equal(mismatched.ok, true);
    assert.equal(ctx.repo.getCommandAudit(first.body.command_id).lifecycle_state, 'failed');

    const second = await dispatch('ON', 'ack-accepted-then-sensed');
    const accepted = ctx.mqttService.handleIncomingMessage('lecf/env/command/ack', JSON.stringify({
      command_id: second.body.command_id, node_id: 'env_02', status: 'acknowledged', observed_state: 'ON'
    }));
    assert.equal(accepted.ok, true);
    assert.equal(ctx.repo.getCommandAudit(second.body.command_id).lifecycle_state, 'acknowledged');
    // Only subsequent matching telemetry may advance an acceptance ACK.
    ctx.commandCoordinator.handleObservedState('env_02', { light_state: 'ON' });
    assert.equal(ctx.repo.getCommandAudit(second.body.command_id).lifecycle_state, 'state_confirmed');

    const third = await dispatch('OFF', 'ack-expiry-check');
    const audit = ctx.repo.getCommandAudit(third.body.command_id);
    assert.equal(audit.lifecycle_state, 'published');
    const late = ctx.commandCoordinator.handleCommandAck({
      command_id: third.body.command_id, node_id: 'env_02',
      status: 'executed', observed_state: 'OFF'
    }, 'lecf/env/command/ack');
    assert.equal(late.ok, true);
    assert.equal(ctx.repo.getCommandAudit(third.body.command_id).lifecycle_state, 'state_confirmed');
  });

  it('preserves an ACK received before MQTT publish resolves', async () => {
    ctx.mqttService.config.mqttEnabled = true;
    ctx.mqttService.connected = true;
    ctx.mqttService.client = { connected: true };
    ctx.mqttService.publishCommand = async (topic, payload) => {
      const ack = ctx.mqttService.handleIncomingMessage('lecf/env/command/ack', JSON.stringify({
        command_id: payload.command_id, node_id: 'env_02',
        status: 'executed', observed_state: payload.state
      }));
      assert.equal(ack.ok, true);
      return true;
    };
    const adminUser = ctx.repo.findUserByUsername('sfm_chief_admin');
    const r = await ctx.commandCoordinator.dispatchCommand({
      command: 'TOGGLE_HVAC_FAN', state: 'OFF',
      actor: { id: adminUser.id, username: adminUser.username },
      requestId: 'ack-before-publish-return', waitForAckMs: 10
    });
    assert.equal(r.body.lifecycle_state, 'state_confirmed');
    assert.equal(r.body.verified_hardware_ack, true);
    assert.equal(ctx.repo.getCommandAudit(r.body.command_id).lifecycle_state, 'state_confirmed');
  });

  // --------------------------------------------------------------------------
  // 13. DEPLOYMENT & UPDATE SCRIPT RECOVERY, ROLLBACK & LOCK CONTENTION TESTS
  // --------------------------------------------------------------------------
  it('rolls back dist/ and Git HEAD to PREV_COMMIT when update.sh fails post-merge readiness and enforces shared lockfile', async () => {
    const { execFileSync, spawn } = await import('node:child_process');
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

    const simRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lci-sfm-update-sim-'));
    const bareRemote = path.join(simRoot, 'origin.git');
    const deployedCheckout = path.join(simRoot, 'deployed');
    const mockBinDir = path.join(simRoot, 'bin');
    const stateDir = path.join(simRoot, 'state');
    const lockFile = path.join(simRoot, 'lci-sfm-deploy.lock');

    fs.mkdirSync(mockBinDir, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });

    try {
      // Create a valid SQLite database to serve as the simulated container DB for backup verification
      const containerDbPath = path.join(stateDir, 'container_lci_sfm.db');
      fs.copyFileSync(dbPath, containerDbPath);

      // Write mock docker binary that simulates candidate build, SQLite backup, compose up, and configurable readiness
      const mockDockerPath = path.join(mockBinDir, 'docker');
      fs.writeFileSync(
        mockDockerPath,
        `#!/usr/bin/env bash
set -e
CMD="$1"
shift || true

if [[ "$CMD" == "info" ]]; then
  exit 0
fi

if [[ "$CMD" == "compose" ]]; then
  for arg in "$@"; do
    if [[ "$arg" == "version" || "$arg" == "config" || "$arg" == "logs" ]]; then
      exit 0
    fi
    if [[ "$arg" == "ps" ]]; then
      printf "mqtt-service\\nbackend\\nfrontend_dashboard\\n"
      exit 0
    fi
    if [[ "$arg" == "up" ]]; then
      echo "compose_up" >> "${stateDir}/docker_events.log"
      exit 0
    fi
    if [[ "$arg" == "exec" ]]; then
      if [[ "\${MOCK_READY_FAIL:-0}" == "1" ]]; then
        exit 1
      fi
      exit 0
    fi
  done
  exit 0
fi

if [[ "$CMD" == "inspect" ]]; then
  exit 0
fi

if [[ "$CMD" == "exec" ]]; then
  CONTAINER="$1"
  shift
  if [[ "$1" == "test" && "$2" == "-s" ]]; then
    test -s "${containerDbPath}"
    exit $?
  fi
  if [[ "$1" == "node" && "$2" == "/app/backend/src/db/backup.js" ]]; then
    cp "${containerDbPath}" "${stateDir}/in_container_backup.db"
    exit 0
  fi
  if [[ "$1" == "rm" ]]; then
    rm -f "${stateDir}/in_container_backup.db"
    exit 0
  fi
  exit 0
fi

if [[ "$CMD" == "cp" ]]; then
  DEST="$2"
  cp "${stateDir}/in_container_backup.db" "$DEST"
  exit 0
fi

if [[ "$CMD" == "run" ]]; then
  # Extract mounted worktree path from -v <path>:/workspace
  WORKTREE_PATH=""
   prev=""
  for a in "$@"; do
    if [[ "$prev" == "-v" ]]; then
      WORKTREE_PATH="\${a%%:/workspace}"
    fi
    prev="$a"
  done
  if [[ "\${MOCK_CANDIDATE_FAIL:-0}" == "1" ]]; then
    echo "Simulated candidate test failure" >&2
    exit 42
  fi
  if [[ -n "$WORKTREE_PATH" ]]; then
    mkdir -p "$WORKTREE_PATH/dist/assets"
    echo "/* new candidate bundle v2 */" > "$WORKTREE_PATH/dist/assets/app-v2.js"
    echo "<html><body>Candidate V2</body></html>" > "$WORKTREE_PATH/dist/index.html"
  fi
  exit 0
fi

exit 0
`,
        { mode: 0o755 }
      );

      // Write mock curl binary for post-readiness HTTP checks
      const mockCurlPath = path.join(mockBinDir, 'curl');
      fs.writeFileSync(
        mockCurlPath,
        `#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" == *"/api/health/ready"* ]]; then
    printf '{"ok":true,"status":"ready","sqlite":{"ok":true,"journal_mode":"wal"},"mqtt":{"enabled":true,"connected":true,"subscriptions_ready":true,"state":"connected"}}'
    exit 0
  fi
done
exit 0
`,
        { mode: 0o755 }
      );

      // Initialize bare remote and deployed checkout
      execFileSync('git', ['init', '--bare', '--quiet', bareRemote]);
      execFileSync('git', ['-C', bareRemote, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
      execFileSync('git', ['init', '--quiet', deployedCheckout]);
      execFileSync('git', ['-C', deployedCheckout, 'config', 'user.name', 'Test Release Bot']);
      execFileSync('git', ['-C', deployedCheckout, 'config', 'user.email', 'bot@example.invalid']);
      execFileSync('git', ['-C', deployedCheckout, 'checkout', '--quiet', '-b', 'main']);

      // Copy required deployment files into deployedCheckout
      fs.mkdirSync(path.join(deployedCheckout, 'mosquitto'), { recursive: true });
      fs.mkdirSync(path.join(deployedCheckout, 'nginx'), { recursive: true });
      fs.mkdirSync(path.join(deployedCheckout, 'backend'), { recursive: true });
      fs.mkdirSync(path.join(deployedCheckout, 'deployment'), { recursive: true });
      fs.copyFileSync(path.join(repoRoot, 'update.sh'), path.join(deployedCheckout, 'update.sh'));
      fs.chmodSync(path.join(deployedCheckout, 'update.sh'), 0o755);
      fs.copyFileSync(path.join(repoRoot, 'docker-compose.yml'), path.join(deployedCheckout, 'docker-compose.yml'));
      fs.copyFileSync(path.join(repoRoot, 'nginx', 'nginx.conf'), path.join(deployedCheckout, 'nginx', 'nginx.conf'));
      fs.copyFileSync(path.join(repoRoot, 'backend', 'Dockerfile'), path.join(deployedCheckout, 'backend', 'Dockerfile'));
      fs.copyFileSync(path.join(repoRoot, 'deployment', 'validation.Dockerfile'), path.join(deployedCheckout, 'deployment', 'validation.Dockerfile'));
      fs.copyFileSync(path.join(repoRoot, 'mosquitto', 'acl'), path.join(deployedCheckout, 'mosquitto', 'acl'));
      fs.copyFileSync(path.join(repoRoot, 'mosquitto', 'mosquitto.conf'), path.join(deployedCheckout, 'mosquitto', 'mosquitto.conf'));
      fs.writeFileSync(path.join(deployedCheckout, 'README.md'), '# V1 Initial Release\n');

      execFileSync('git', ['-C', deployedCheckout, 'add', '.']);
      execFileSync('git', ['-C', deployedCheckout, 'commit', '--quiet', '-m', 'chore: initial release v1']);
      execFileSync('git', ['-C', deployedCheckout, 'remote', 'add', 'origin', bareRemote]);
      execFileSync('git', ['-C', deployedCheckout, 'push', '--quiet', '-u', 'origin', 'main']);

      const baseCommit = execFileSync('git', ['-C', deployedCheckout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

      // Create local untracked runtime files (.env, mosquitto/passwd, dist/) and exclude them in .git/info/exclude
      fs.writeFileSync(path.join(deployedCheckout, '.env'), 'FRONTEND_BIND_IP=127.0.0.1\n', { mode: 0o600 });
      fs.writeFileSync(path.join(deployedCheckout, 'mosquitto', 'passwd'), 'lci_backend:hash\n', { mode: 0o600 });
      fs.mkdirSync(path.join(deployedCheckout, 'dist', 'assets'), { recursive: true });
      fs.writeFileSync(path.join(deployedCheckout, 'dist', 'assets', 'app-v1.js'), '/* original bundle v1 */');
      fs.writeFileSync(path.join(deployedCheckout, 'dist', 'index.html'), '<html><body>Original V1</body></html>');
      fs.writeFileSync(
        path.join(deployedCheckout, '.git', 'info', 'exclude'),
        '/.env\n/mosquitto/passwd\n/dist/\n/backups/\n'
      );

      // Push a V2 commit to origin/main
      const producerClone = path.join(simRoot, 'producer');
      execFileSync('git', ['clone', '--quiet', '--branch', 'main', bareRemote, producerClone]);
      execFileSync('git', ['-C', producerClone, 'config', 'user.name', 'Test Release Bot']);
      execFileSync('git', ['-C', producerClone, 'config', 'user.email', 'bot@example.invalid']);
      fs.writeFileSync(path.join(producerClone, 'README.md'), '# V2 Candidate Release\n');
      execFileSync('git', ['-C', producerClone, 'add', 'README.md']);
      execFileSync('git', ['-C', producerClone, 'commit', '--quiet', '-m', 'feat: release v2']);
      execFileSync('git', ['-C', producerClone, 'push', '--quiet', 'origin', 'main']);
      const v2Commit = execFileSync('git', ['-C', producerClone, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

      const baseEnv = {
        ...process.env,
        PATH: `${mockBinDir}:${process.env.PATH}`,
        LCI_SKIP_ROOT_CHECK: '1',
        LCI_DEPLOY_LOCK_FILE: lockFile,
        LCI_READINESS_TIMEOUT_SEC: '2',
        LCI_READINESS_POLL_SEC: '1'
      };

      // Scenario A: Post-merge readiness check fails -> update.sh MUST restore full dist/ AND rewind Git HEAD to baseCommit!
      let postMergeFailed = false;
      try {
        execFileSync('bash', [path.join(deployedCheckout, 'update.sh')], {
          cwd: deployedCheckout,
          env: { ...baseEnv, MOCK_READY_FAIL: '1' },
          stdio: 'pipe'
        });
      } catch (err) {
        postMergeFailed = true;
        const stderrOut = String(err.stderr || '') + String(err.stdout || '');
        assert.match(stderrOut, /Restored the complete previous dist\/ directory/);
        assert.match(stderrOut, /Rolled back Git working tree to previous commit/);
      }
      assert.equal(postMergeFailed, true, 'update.sh must exit non-zero when readiness check fails');

      // Verify Git HEAD was rolled back to baseCommit (NOT left at v2Commit!)
      const headAfterRollback = execFileSync('git', ['-C', deployedCheckout, 'rev-parse', 'HEAD'], {
        encoding: 'utf8'
      }).trim();
      assert.equal(headAfterRollback, baseCommit, 'Git HEAD must be rewound to PREV_COMMIT after post-merge failure');

      // Verify full dist/ directory was restored (app-v1.js present, app-v2.js removed, index.html is Original V1)
      assert.equal(
        fs.readFileSync(path.join(deployedCheckout, 'dist', 'index.html'), 'utf8'),
        '<html><body>Original V1</body></html>'
      );
      assert.equal(fs.existsSync(path.join(deployedCheckout, 'dist', 'assets', 'app-v1.js')), true);
      assert.equal(fs.existsSync(path.join(deployedCheckout, 'dist', 'assets', 'app-v2.js')), false);

      // Verify SQLite backup was created and preserved in backups/
      const backupsAfterRollback = fs
        .readdirSync(path.join(deployedCheckout, 'backups'))
        .filter((name) => name.endsWith('.db'));
      assert.equal(backupsAfterRollback.length, 1);

      // Scenario B: Now re-run update.sh when readiness succeeds -> because Git HEAD was rolled back,
      // update.sh does NOT falsely say "Already up to date" and deploys V2 cleanly!
      const successOut = execFileSync('bash', [path.join(deployedCheckout, 'update.sh')], {
        cwd: deployedCheckout,
        env: { ...baseEnv, MOCK_READY_FAIL: '0' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
      assert.match(successOut, /LCI-SFM update completed successfully/);
      const headAfterSuccess = execFileSync('git', ['-C', deployedCheckout, 'rev-parse', 'HEAD'], {
        encoding: 'utf8'
      }).trim();
      assert.equal(headAfterSuccess, v2Commit);
      assert.equal(
        fs.readFileSync(path.join(deployedCheckout, 'dist', 'index.html'), 'utf8').trim(),
        '<html><body>Candidate V2</body></html>'
      );
      assert.equal(fs.existsSync(path.join(deployedCheckout, 'dist', 'assets', 'app-v2.js')), true);

      // Scenario C: Shared lock contention prevents concurrent update.sh execution
      const lockHolder = spawn('flock', ['-x', lockFile, '-c', 'sleep 5']);
      await new Promise((r) => setTimeout(r, 150));
      let lockBlocked = false;
      try {
        execFileSync('bash', [path.join(deployedCheckout, 'update.sh')], {
          cwd: deployedCheckout,
          env: baseEnv,
          stdio: 'pipe'
        });
      } catch (err) {
        lockBlocked = true;
        const stderrOut = String(err.stderr || '');
        assert.match(stderrOut, /Another LCI-SFM install or update operation appears to be running/);
      } finally {
        lockHolder.kill('SIGTERM');
      }
      assert.equal(lockBlocked, true, 'Concurrent update.sh must fail fast when lock is held');
    } finally {
      fs.rmSync(simRoot, { recursive: true, force: true });
    }
  });
});

