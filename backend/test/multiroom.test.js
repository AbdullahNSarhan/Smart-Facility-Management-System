import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import { createBackendContext } from '../src/app.js';
import { SqliteDatabase } from '../src/db/database.js';

describe('Multi-room facility domain, generic endpoint engine, manifest quarantine & MQTT provisioning CLI', () => {
  let ctx;
  let tmp;
  let now;
  let cookie;
  let csrf;
  let viewerCookie;
  let viewerCsrf;
  const password = 'MultiRoom-Test-Password-2026!';

  const opts = () => ({
    NODE_ENV: 'test',
    MQTT_ENABLED: 'false',
    PORT: 0,
    HOST: '127.0.0.1',
    TRUST_PROXY: 'false',
    SQLITE_DB_PATH: path.join(tmp, 'multiroom.db'),
    LCI_BOOTSTRAP_ADMIN_USERNAME: 'mr_admin',
    LCI_BOOTSTRAP_ADMIN_PASSWORD: password,
    NODE1_ID: 'node1',
    NODE2_ID: 'env_02',
    NODE3_ID: 'node3',
    IP_NODE1: '192.168.43.11',
    IP_NODE2: '192.168.43.12',
    IP_NODE3: '192.168.43.13',
    clock: () => now
  });

  const mutate = (method, url, body, asViewer = false) =>
    request(ctx.app)
      [method]('/api/v1' + url)
      .set('Cookie', asViewer ? viewerCookie : cookie)
      .set('X-CSRF-Token', asViewer ? viewerCsrf : csrf)
      .send(body);

  const get = (url, asViewer = false) =>
    request(ctx.app)
      .get('/api/v1' + url)
      .set('Cookie', asViewer ? viewerCookie : cookie);

  const onlineMqtt = () => {
    ctx.mqttService.config.mqttEnabled = true;
    ctx.mqttService.connected = true;
    ctx.mqttService.client = { connected: true };
    ctx.mqttService.publishCommand = async () => true;
  };

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lci-mr-'));
    now = Date.now();
    ctx = createBackendContext(opts());
    const login = await request(ctx.app).post('/api/auth/login').send({ username: 'mr_admin', password });
    assert.equal(login.status, 200);
    cookie = login.headers['set-cookie'][0].split(';')[0];
    csrf = login.body.csrfToken;

    const op = await mutate('post', '/operators', { username: 'mr_viewer', password, role: 'Viewer' });
    assert.equal(op.status, 201);
    const vLogin = await request(ctx.app).post('/api/auth/login').send({ username: 'mr_viewer', password });
    viewerCookie = vLogin.headers['set-cookie'][0].split(';')[0];
    viewerCsrf = vLogin.body.csrfToken;
  });

  afterEach(async () => {
    ctx.mqttService.client = null;
    ctx.mqttService.connected = false;
    await ctx.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('manages facility profile and dynamic rooms with duplicate code checks, revision conflicts, and safe archive rules', async () => {
    const facRes = await get('/facility');
    assert.equal(facRes.status, 200);
    assert.equal(facRes.body.facility.facility_id, 'facility-default');
    assert.equal(facRes.body.facility.active_rooms, 1);

    // Update facility profile with optimistic revision
    const facUpd = await mutate('put', '/facility', {
      name: 'Central Engineering Campus',
      description: 'Air-gapped wired test facility',
      location: 'Building A',
      timezone: 'Africa/Cairo',
      version: facRes.body.facility.version
    });
    assert.equal(facUpd.status, 200);
    assert.equal(facUpd.body.facility.name, 'Central Engineering Campus');
    assert.equal(facUpd.body.facility.version, 2);
    // Stale version fails with 409
    assert.equal((await mutate('put', '/facility', { name: 'Stale', description: '', location: '', timezone: 'UTC', version: 1 })).status, 409);

    // Viewer cannot create rooms
    assert.equal((await mutate('post', '/rooms', { room_code: 'LAB-02', name: 'Robotics Lab' }, true)).status, 403);

    // Create Room B
    const created = await mutate('post', '/rooms', {
      room_code: 'LAB-02',
      name: 'Server & Power Room',
      description: 'UPS and chilled rack zone',
      building: 'North Wing',
      floor: '2F'
    });
    assert.equal(created.status, 201);
    const roomB = created.body.room;
    assert.equal(roomB.room_code, 'LAB-02');
    assert.equal(roomB.status, 'ACTIVE');

    // Duplicate room code rejected
    assert.equal((await mutate('post', '/rooms', { room_code: 'lab-02', name: 'Duplicate Code' })).status, 409);

    // Cannot archive baseline room-001
    assert.equal((await mutate('post', '/rooms/room-001/archive', {})).status, 409);

    // Edit Room B and verify version check
    const edited = await mutate('put', `/rooms/${roomB.room_id}`, {
      room_code: 'LAB-02',
      name: 'Server & UPS Room',
      description: 'Updated description',
      building: 'North Wing',
      floor: '2F',
      version: roomB.version
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.room.version, 2);

    // Archive and restore empty Room B
    const archived = await mutate('post', `/rooms/${roomB.room_id}/archive`, {});
    assert.equal(archived.status, 200);
    assert.equal(archived.body.room.status, 'ARCHIVED');

    const restored = await mutate('post', `/rooms/${roomB.room_id}/restore`, {});
    assert.equal(restored.status, 200);
    assert.equal(restored.body.room.status, 'ACTIVE');
  });

  it('registers MQTT-only devices without IP, moves devices across rooms without losing telemetry history, and tracks per-endpoint freshness', async () => {
    const roomB = (await mutate('post', '/rooms', { room_code: 'CLEAN-02', name: 'Clean Room 2' })).body.room;

    // Two MQTT_V1 devices with empty IP must both succeed (no IP collision!)
    const devA = (
      await mutate('post', '/registry', {
        device_id: 'mqtt_co2_a',
        name: 'Clean Room CO2 & Motion',
        room_id: roomB.room_id,
        device_type: 'SENSORS',
        transport: 'MQTT_V1',
        ip: '',
        stale_after_s: 10,
        endpoints: [
          { endpoint_key: 'co2_ppm', label: 'CO2 Level', kind: 'SENSOR', data_type: 'NUMBER', unit: 'ppm', min_value: 0, max_value: 5000 },
          { endpoint_key: 'motion_detected', label: 'Motion Sensor', kind: 'SENSOR', data_type: 'BOOLEAN', unit: '' }
        ]
      })
    );
    assert.equal(devA.status, 201, JSON.stringify(devA.body));
    assert.equal(devA.body.device.ip, '');
    assert.equal(devA.body.device.room_id, roomB.room_id);
    assert.equal(devA.body.device.endpoints.find((e) => e.endpoint_key === 'co2_ppm').widget_type, 'METRIC_TREND');
    assert.equal(devA.body.device.endpoints.find((e) => e.endpoint_key === 'motion_detected').widget_type, 'BOOLEAN_STATE');

    const devB = await mutate('post', '/registry', {
      device_id: 'mqtt_co2_b',
      name: 'Secondary MQTT Sensor',
      room_id: roomB.room_id,
      device_type: 'SENSORS',
      transport: 'MQTT_V1',
      ip: '',
      endpoints: [{ endpoint_key: 'temp', label: 'Ambient Temp', kind: 'SENSOR', data_type: 'NUMBER', unit: '°C' }]
    });
    assert.equal(devB.status, 201);

    // HTTP_JSON_V1 without IP must still be rejected
    const badHttp = await mutate('post', '/registry', {
      device_id: 'http_no_ip',
      name: 'Missing IP HTTP',
      room_id: roomB.room_id,
      device_type: 'SENSORS',
      transport: 'HTTP_JSON_V1',
      ip: '',
      endpoints: [{ endpoint_key: 'temp', label: 'Temp', kind: 'SENSOR', data_type: 'NUMBER', unit: '°C' }]
    });
    assert.equal(badHttp.status, 400);

    // Room B cannot be archived while active devices are assigned
    assert.equal((await mutate('post', `/rooms/${roomB.room_id}/archive`, {})).status, 409);

    // Ingest telemetry for co2_ppm first, then later only motion_detected -> independent per-endpoint freshness!
    onlineMqtt();
    assert.equal(
      ctx.mqttService.handleIncomingMessage(
        'lci/v1/devices/mqtt_co2_a/telemetry',
        JSON.stringify({ schema_version: 1, device_id: 'mqtt_co2_a', boot_id: 'b1', seq: 1, values: { co2_ppm: 640, motion_detected: false } })
      ).ok,
      true
    );
    // Out-of-range value rejected
    assert.equal(
      ctx.mqttService.handleIncomingMessage(
        'lci/v1/devices/mqtt_co2_a/telemetry',
        JSON.stringify({ schema_version: 1, device_id: 'mqtt_co2_a', boot_id: 'b1', seq: 2, values: { co2_ppm: 9999 } })
      ).ok,
      false
    );
    now += 12000;
    // Only motion_detected updates -> motion_detected is FRESH while co2_ppm is STALE
    assert.equal(
      ctx.mqttService.handleIncomingMessage(
        'lci/v1/devices/mqtt_co2_a/telemetry',
        JSON.stringify({ schema_version: 1, device_id: 'mqtt_co2_a', boot_id: 'b1', seq: 3, values: { motion_detected: true } })
      ).ok,
      true
    );
    const inspected = (await get('/registry/mqtt_co2_a')).body.device;
    const epCo2 = inspected.endpoints.find((e) => e.endpoint_key === 'co2_ppm');
    const epMotion = inspected.endpoints.find((e) => e.endpoint_key === 'motion_detected');
    assert.equal(epMotion.fresh, true);
    assert.equal(epMotion.last_value, true);
    assert.equal(epCo2.fresh, false);
    assert.equal(epCo2.status, 'STALE');

    // Boolean alarm rule raises on motion_detected === true and clears on false
    const boolRule = await mutate('post', '/rules', {
      device_id: 'mqtt_co2_a',
      endpoint_key: 'motion_detected',
      name: 'After-hours motion alert',
      severity: 'WARNING',
      condition_type: 'BOOLEAN_TRUE',
      hold_s: 0,
      clear_hold_s: 0,
      enabled: true
    });
    assert.equal(boolRule.status, 201);
    ctx.operations.tick();
    assert.equal((await get(`/alarms?room_id=${roomB.room_id}`)).body.alarms.length, 1);

    // Move mqtt_co2_a to room-001 and verify historical frames & endpoint history remain intact!
    const moved = await mutate('post', '/registry/mqtt_co2_a/move', {
      room_id: 'room-001',
      version: inspected.version
    });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.device.room_id, 'room-001');

    const epHist = await get('/registry/mqtt_co2_a/endpoints/co2_ppm/history');
    assert.equal(epHist.status, 200);
    assert.equal(epHist.body.room_id, 'room-001');
    assert.equal(epHist.body.summary.latest, 640);
    assert.equal(epHist.body.points.length, 1);
  });

  it('quarantines unregistered MQTT devices as PENDING, detects manifest drift without auto-mutating schema, and tracks MQTT identity status', async () => {
    onlineMqtt();
    // Unregistered device sends heartbeat + manifest -> quarantined, NOT auto-registered!
    const hbRes = ctx.mqttService.handleIncomingMessage(
      'lci/v1/devices/new_edge_09/heartbeat',
      JSON.stringify({
        schema_version: 1,
        device_id: 'new_edge_09',
        firmware_version: '2.1.0',
        protocol_version: '1',
        manifest_version: 'm-1',
        capabilities: ['SENSOR'],
        endpoints: [{ endpoint_key: 'pressure', label: 'Pressure', kind: 'SENSOR', data_type: 'NUMBER', unit: 'hPa' }]
      })
    );
    assert.equal(hbRes.ok, false);
    assert.equal(hbRes.error, 'DEVICE_PENDING_APPROVAL');

    // Telemetry from pending device must still be rejected
    const telRes = ctx.mqttService.handleIncomingMessage(
      'lci/v1/devices/new_edge_09/telemetry',
      JSON.stringify({ schema_version: 1, device_id: 'new_edge_09', boot_id: 'b1', seq: 1, values: { pressure: 1013 } })
    );
    assert.equal(telRes.ok, false);
    assert.equal(telRes.error, 'DEVICE_NOT_REGISTERED');

    // Admin sees it in pending queue; Viewer is forbidden
    assert.equal((await get('/pending-devices', true)).status, 403);
    const pendingList = (await get('/pending-devices')).body.pending_devices;
    assert.equal(pendingList.length, 1);
    assert.equal(pendingList[0].device_id, 'new_edge_09');

    // Register the device -> clears PENDING to APPROVED
    const reg = await mutate('post', '/registry', {
      device_id: 'new_edge_09',
      name: 'Barometric Node 09',
      room_id: 'room-001',
      device_type: 'SENSORS',
      transport: 'MQTT_V1',
      ip: '',
      endpoints: [{ endpoint_key: 'pressure', label: 'Pressure', kind: 'SENSOR', data_type: 'NUMBER', unit: 'hPa' }]
    });
    assert.equal(reg.status, 201);
    assert.equal((await get('/pending-devices')).body.pending_devices.length, 0);

    // Update MQTT identity status tracking without exposing any secret
    const idStat = await mutate('put', '/registry/new_edge_09/mqtt-identity', {
      mqtt_identity_status: 'PROVISIONED',
      version: reg.body.device.version
    });
    assert.equal(idStat.status, 200);
    assert.equal(idStat.body.device.mqtt_identity_status, 'PROVISIONED');

    // Device later announces unexpected endpoint in manifest -> manifest_drift flagged, endpoints untouched!
    ctx.mqttService.handleIncomingMessage(
      'lci/v1/devices/new_edge_09/heartbeat',
      JSON.stringify({
        schema_version: 1,
        device_id: 'new_edge_09',
        manifest_version: 'm-2',
        endpoints: [
          { endpoint_key: 'pressure', kind: 'SENSOR', data_type: 'BOOLEAN', unit: 'psi' },
          { endpoint_key: 'rogue_relay', kind: 'SWITCH', data_type: 'ENUM', writable: true }
        ]
      })
    );
    const afterDrift = (await get('/registry/new_edge_09')).body.device;
    assert.equal(afterDrift.manifest_drift.has_drift, true);
    assert.deepEqual(afterDrift.manifest_drift.unexpected_keys, ['rogue_relay']);
    assert.deepEqual(afterDrift.manifest_drift.changed_keys, ['pressure']);
    assert.equal(afterDrift.endpoints.length, 1);

    // An explicitly empty endpoint manifest means all registered endpoints disappeared.
    ctx.mqttService.handleIncomingMessage(
      'lci/v1/devices/new_edge_09/heartbeat',
      JSON.stringify({ schema_version: 1, device_id: 'new_edge_09', manifest_version: 'm-3', endpoints: [] })
    );
    const emptyManifest = (await get('/registry/new_edge_09')).body.device;
    assert.equal(emptyManifest.manifest_drift.has_drift, true);
    assert.deepEqual(emptyManifest.manifest_drift.missing_keys, ['pressure']);
  });

  it('upgrades a populated 1.1.0-rc.1 (001+002+003) SQLite database cleanly to 004 without losing rows or credentials', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lci-mig004-'));
    const preDir = path.join(dir, 'migrations');
    fs.mkdirSync(preDir);
    for (const file of ['001_initial_schema.sql', '002_facility_management.sql', '003_release_operations.sql']) {
      fs.copyFileSync(new URL(`../src/db/migrations/${file}`, import.meta.url), path.join(preDir, file));
    }
    const dbFile = path.join(dir, 'rc1.db');
    const preDb = new SqliteDatabase(dbFile);
    preDb.runMigrations(preDir);
    preDb.bootstrapAdminIfNeeded({ username: 'legacy_admin', password: 'Legacy-Password-2026!', isProd: false });
    preDb
      .prepare("INSERT INTO device_registry(device_id,name,location,device_type,transport,ip,created_at,updated_at) VALUES('custom_rc1','RC1 Node','room-001','SENSORS','MQTT_V1','10.10.0.50','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')")
      .run();
    preDb
      .prepare("INSERT INTO device_endpoints(device_id,endpoint_key,label,kind,unit,writable) VALUES('custom_rc1','temp','Temp','SENSOR','°C',0)")
      .run();
    preDb.close();

    const upgraded = createBackendContext({
      NODE_ENV: 'test',
      MQTT_ENABLED: 'false',
      SQLITE_DB_PATH: dbFile,
      LCI_BOOTSTRAP_ADMIN_USERNAME: 'ignored_admin',
      LCI_BOOTSTRAP_ADMIN_PASSWORD: 'Ignored-Password-2026!'
    });
    try {
      assert.equal(upgraded.db.healthCheck().ok, true);
      assert.equal(upgraded.db.healthCheck().latestMigration, '004_multi_room_platform.sql');
      assert.ok(upgraded.repo.findUserByUsername('legacy_admin'));
      const migratedDev = upgraded.operations.device('custom_rc1');
      assert.equal(migratedDev.room_id, 'room-001');
      assert.equal(migratedDev.endpoints[0].data_type, 'NUMBER');
      assert.equal(upgraded.operations.listRooms().length, 1);
    } finally {
      await upgraded.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('validates ACL rules and rejects reserved/invalid device identities in provision-mqtt-device.sh', () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
    const scriptPath = path.join(repoRoot, 'scripts', 'provision-mqtt-device.sh');
    const aclVerifyOut = execFileSync('bash', [scriptPath, 'verify-acl', '--acl-file', path.join(repoRoot, 'mosquitto', 'acl')], {
      encoding: 'utf8'
    });
    assert.match(aclVerifyOut, /ACL verification PASSED/);

    assert.throws(() => {
      execFileSync('bash', [scriptPath, 'add', 'lci_backend', '--no-reload'], { stdio: 'pipe' });
    }, /reserved/i);

    assert.throws(() => {
      execFileSync('bash', [scriptPath, 'add', '../bad_id', '--no-reload'], { stdio: 'pipe' });
    }, /Invalid device_id/i);

    const cliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lci-mqtt-cli-'));
    try {
      const passwdFile = path.join(cliDir, 'passwd');
      const outDir = path.join(cliDir, 'credentials');

      assert.throws(() => {
        execFileSync('bash', [
          scriptPath, 'add', '--device-id', 'lab305-env-01', '--username', 'dev_lab305_env_01',
          '--passwd-file', passwdFile, '--out-dir', outDir, '--no-reload'
        ], { stdio: 'pipe' });
      }, /MQTT username must match device_id/i);
      assert.equal(fs.existsSync(passwdFile), false);

      const listOut = execFileSync('bash', [
        scriptPath, 'list', '--passwd-file', path.join(cliDir, 'not-created-passwd')
      ], { encoding: 'utf8' });
      assert.match(listOut, /Password file not found/);

      // End-to-end add / status / revoke using mock mosquitto_passwd without touching live broker
      const mockBin = path.join(cliDir, 'bin');
      fs.mkdirSync(mockBin, { recursive: true });
      fs.writeFileSync(
        path.join(mockBin, 'mosquitto_passwd'),
        `#!/usr/bin/env bash
set -e
if [[ "$1" == "-b" ]]; then
  FILE="$2"; USER="$3"; PASS="$4"
  grep -v "^\\\${USER}:" "$FILE" 2>/dev/null > "$FILE.tmp" || true
  printf '%s:mock_hash_%s\\n' "$USER" "\${#PASS}" >> "$FILE.tmp"
  mv "$FILE.tmp" "$FILE"
elif [[ "$1" == "-D" ]]; then
  FILE="$2"; USER="$3"
  grep -v "^\\\${USER}:" "$FILE" 2>/dev/null > "$FILE.tmp" || true
  mv "$FILE.tmp" "$FILE"
fi
`,
        { mode: 0o755 }
      );

      const envWithMock = { ...process.env, PATH: `${mockBin}:${process.env.PATH}`, LCI_SKIP_ROOT_CHECK: '1' };
      execFileSync('bash', [
        scriptPath, 'add', 'sensor_room2',
        '--passwd-file', passwdFile,
        '--acl-file', path.join(repoRoot, 'mosquitto', 'acl'),
        '--out-dir', outDir,
        '--no-reload'
      ], { env: envWithMock, stdio: 'pipe' });

      const credFile = path.join(outDir, 'sensor_room2.cred');
      assert.equal(fs.existsSync(credFile), true);
      assert.equal(fs.statSync(outDir).mode & 0o777, 0o700);
      assert.equal(fs.statSync(credFile).mode & 0o777, 0o600);

      const statusOut = execFileSync('bash', [
        scriptPath, 'status', 'sensor_room2', '--passwd-file', passwdFile
      ], { env: envWithMock, encoding: 'utf8' }).trim();
      assert.equal(statusOut, 'PROVISIONED sensor_room2');

      execFileSync('bash', [
        scriptPath, 'revoke', 'sensor_room2',
        '--passwd-file', passwdFile,
        '--out-dir', outDir,
        '--no-reload'
      ], { env: envWithMock, stdio: 'pipe' });
      assert.equal(fs.existsSync(credFile), false);
    } finally {
      fs.rmSync(cliDir, { recursive: true, force: true });
    }
  });

  it('enforces Git/Docker ignore hygiene and Mosquitto GID 1883 / scoped safe.directory guards in operational scripts', () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
    const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
    const dockerignore = fs.readFileSync(path.join(repoRoot, '.dockerignore'), 'utf8');

    assert.match(gitignore, /^mosquitto\/provisioned-credentials\/$/m);
    assert.match(gitignore, /^dist-release\/$/m);
    assert.doesNotMatch(gitignore, /project-knowledge/);

    assert.match(dockerignore, /^mosquitto\/provisioned-credentials$/m);
    assert.match(dockerignore, /^dist-release$/m);

    for (const rel of ['install.sh', 'update.sh', 'scripts/provision-mqtt-device.sh']) {
      const fullPath = path.join(repoRoot, rel);
      execFileSync('bash', ['-n', fullPath], { stdio: 'pipe' });
      const content = fs.readFileSync(fullPath, 'utf8');
      assert.doesNotMatch(content, /chown\s+1883:1883/, `${rel} must preserve repo owner UID with GID 1883`);
      assert.match(content, /:1883/, `${rel} must grant group 1883 access`);
      assert.match(content, /0640/, `${rel} must use mode 0640 for Mosquitto config/secret files`);
      assert.doesNotMatch(content, /safe\.directory\s+['"]?\*['"]?/, `${rel} must never use wildcard safe.directory`);
    }
  });
});
