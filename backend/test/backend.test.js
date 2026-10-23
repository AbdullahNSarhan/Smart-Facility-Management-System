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
    const summary = formatReadinessSummary(readyRes.body);
    assert.equal(summary, 'SQLite: OK (WAL) · MQTT: Connected');
    assert.equal(
      formatReadinessSummary({
        sqlite: { ok: true, journal_mode: 'wal' },
        mqtt: { enabled: false, connected: false }
      }),
      'SQLite: OK (WAL) · MQTT: Standby'
    );
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
});

