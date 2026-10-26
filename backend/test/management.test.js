import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createBackendContext } from '../src/app.js';
import { verifySecret } from '../src/utils/crypto.js';
import { MQTT_TOPICS } from '../src/mqtt/topics.js';
import { readCameraSnapshot } from '../src/services/cameraSnapshot.js';

describe('Facility management, identity separation and reader enrollment', () => {
  let ctx, dir, cookie, csrf, published;
  const password = 'Test-Admin-Strong-2026!';
  // install.sh validates a checkout containing a production .env. Keep fixture
  // identity independent of that file and of the caller's exported settings.
  const overrides = () => ({
    NODE_ENV: 'test', MQTT_ENABLED: 'false',
    SQLITE_DB_PATH: path.join(dir, 'management.db'),
    LCI_BOOTSTRAP_ADMIN_USERNAME: 'admin', LCI_BOOTSTRAP_ADMIN_PASSWORD: password,
    NODE1_ID: 'node1', NODE2_ID: 'env_02', NODE3_ID: 'node3'
  });
  const mutation = (method, endpoint, body) => request(ctx.app)[method](`/api/v1${endpoint}`).set('Cookie', cookie).set('X-CSRF-Token', csrf).send(body);
  const get = endpoint => request(ctx.app).get(`/api/v1${endpoint}`).set('Cookie', cookie);
  const person = async (name = 'Abdullah Nasser') => {
    const res = await mutation('post','/people',{ display_name: name, reference: 'ECE-001' });
    assert.equal(res.status, 201); return res.body.person;
  };
  const onlineReader = () => {
    ctx.mqttService.connected = true;
    ctx.mqttService.client = { connected: true, end: (_force, _opts, cb) => cb?.() };
    ctx.mqttService.config.mqttEnabled = true;
    ctx.mqttService.handleIncomingMessage('lecf/node1/heartbeat', JSON.stringify({ node_id: 'node1', status: 'ONLINE', capabilities: ['RFID_ENROLL_V1'], firmware_version: 'test-1' }));
    ctx.mqttService.publishCommand = async (topic, payload) => { published.push({ topic, payload }); return true; };
  };
  const event = (payload, event, extras = {}) => ctx.mqttService.handleIncomingMessage(MQTT_TOPICS.READER_ENROLL_EVENT.topic, JSON.stringify({ schema_version: 1, session_id: payload.session_id, node_id: payload.node_id, nonce: payload.nonce, event, ...extras }));

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(),'lci-management-'));
    ctx = createBackendContext(overrides()); published = [];
    const login = await request(ctx.app).post('/api/auth/login').send({ username: 'admin', password });
    assert.equal(login.status, 200, `Fixture login failed: ${JSON.stringify(login.body)}`);
    assert.ok(login.headers['set-cookie']?.length, 'Fixture login must establish a session cookie');
    cookie = login.headers['set-cookie'][0].split(';')[0]; csrf = login.body.csrfToken;
  });
  afterEach(async () => {
    // Do not ask a fake client to perform a real disconnect.
    ctx.mqttService.client = null; ctx.mqttService.connected = false;
    await ctx.stop(); fs.rmSync(dir,{ recursive: true, force: true });
  });

  it('requires server auth, Admin role and cookie CSRF on every management mutation', async () => {
    assert.equal((await request(ctx.app).get('/api/v1/settings')).status,401);
    const settings = (await get('/settings')).body.settings;
    assert.equal((await request(ctx.app).put('/api/v1/settings').set('Cookie',cookie).send(settings)).status,403);
    const op = await mutation('post','/operators',{ username: 'viewer', password: 'Viewer-Password-2026!', role: 'Viewer' });
    assert.equal(op.status,201);
    const login = await request(ctx.app).post('/api/auth/login').send({ username: 'viewer', password: 'Viewer-Password-2026!' });
    const viewerCookie = login.headers['set-cookie'][0].split(';')[0];
    for (const endpoint of ['/people','/management-audit']) assert.equal((await request(ctx.app).get(`/api/v1${endpoint}`).set('Cookie',viewerCookie)).status,403);
    assert.equal((await request(ctx.app).get('/api/v1/devices').set('Cookie',viewerCookie)).status,200);
    assert.equal((await request(ctx.app).post('/api/v1/people').set('Cookie',viewerCookie).set('X-CSRF-Token',login.body.csrfToken).send({ display_name:'Blocked' })).status,403);
  });

  it('persists centrally validated node addresses across restart, audits changes and rejects stale revisions', async () => {
    const { settings } = (await get('/settings')).body;
    const { updated_at, updated_by, ...body } = settings;
    body.nodes.node1.ip = '10.20.0.11'; body.facility_name = 'Engineering Lab';
    const saved = await mutation('put','/settings',body);
    assert.equal(saved.status,200); assert.equal(saved.body.settings.revision,2);
    assert.equal(ctx.config.node1Ip,'10.20.0.11');
    assert.equal((await mutation('put','/settings',body)).status,409);
    assert.equal((await get('/management-audit')).body.events[0].action,'SETTINGS_UPDATED');
    await ctx.stop(); ctx = createBackendContext(overrides());
    assert.equal(ctx.management.settings().nodes.node1.ip,'10.20.0.11');
    assert.equal(ctx.config.node1Ip,'10.20.0.11');
  });

  it('rejects duplicate, public, loopback and malformed addresses and inverted display thresholds', async () => {
    const { updated_at, updated_by, ...body } = (await get('/settings')).body.settings;
    for (const ip of ['127.0.0.1','8.8.8.8','http://10.0.0.1','999.1.2.3',body.nodes.node2.ip]) {
      body.nodes.node1.ip = ip; assert.equal((await mutation('put','/settings',body)).status,400,ip);
    }
    body.nodes.node1.ip = '10.0.0.11'; body.display_thresholds.gas_warning_raw = 500;
    assert.equal((await mutation('put','/settings',body)).status,400);
    assert.equal(ctx.management.settings().revision,1);
  });

  it('separates people and dashboard accounts and never reuses a door PIN as a dashboard password', async () => {
    const p = await person();
    assert.equal(ctx.repo.findUserByUsername(p.display_name),undefined);
    const op = await mutation('post','/operators',{ username:'lab_admin', password:'Long-Dashboard-Password!',role:'Admin' });
    assert.equal(op.status,201);
    const stored = ctx.repo.findUserByUsername('lab_admin');
    assert.equal(stored.provisioning_status,'dashboard_only'); assert.equal(stored.rfid,''); assert.equal(stored.pin_verifier,null);
    assert.equal((await mutation('post','/operators',{ username:'weak', password:'123456',role:'Admin' })).status,400);
    assert.equal((await get('/people')).body.total,1);
  });

  it('preserves rotated administrator credentials across restart without recreating the bootstrap account', async () => {
    const newPassword = 'Quote\'and;spaces 2026!';
    const rotated = await request(ctx.app).post('/api/auth/admin-profile').set('Cookie',cookie).set('X-CSRF-Token',csrf)
      .send({ newUsername:'renamed_admin', newPassword });
    assert.equal(rotated.status,200);
    await ctx.stop(); ctx = createBackendContext(overrides());
    assert.equal(ctx.repo.findUserByUsername('admin'),undefined);
    assert.ok(ctx.repo.verifyUserCredentials('renamed_admin',newPassword));
    assert.equal(ctx.repo.countActiveAdmins(),1);
    const existing = ctx.db.bootstrapAdminIfNeeded({ username:'renamed_admin',password,isProd:false });
    assert.equal(existing.bootstrapped,false);
    assert.ok(ctx.repo.verifyUserCredentials('renamed_admin',newPassword));
  });

  it('retains leading-zero PINs, masks cards, denies duplicate assignments and atomically resets PINs', async () => {
    const a = await person(), b = await person('Second Person');
    assert.equal((await mutation('post',`/people/${a.subject_id}/credentials`,{ modality:'RFID',card_uid:'a4:9f:21:0b' })).status,201);
    const duplicate = await mutation('post',`/people/${b.subject_id}/credentials`,{ modality:'RFID',card_uid:'A4:9F:21:0B' });
    assert.equal(duplicate.status,409);
    assert.equal((await mutation('post',`/people/${a.subject_id}/credentials`,{ modality:'PIN',pin:'001234' })).status,201);
    const secret = ctx.db.prepare("SELECT * FROM physical_credentials WHERE modality = 'PIN'").get();
    assert.ok(verifySecret('001234',secret.pin_verifier));
    const safe = JSON.stringify((await get('/people')).body);
    assert.ok(!safe.includes('001234')); assert.ok(!safe.includes('pin_verifier')); assert.ok(!safe.includes('A4:9F:21:0B'));
    assert.equal((await mutation('post',`/people/${a.subject_id}/credentials`,{ modality:'PIN',pin:1234 })).status,400);
    assert.equal((await mutation('post',`/people/${a.subject_id}/credentials`,{ modality:'PIN',pin:'005678' })).status,201);
    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM physical_credentials WHERE modality = 'PIN' AND status = 'ASSIGNED'").get().n,1);
    assert.ok(!JSON.stringify((await get('/management-audit')).body).includes('005678'));
  });

  it('preserves audit history on suspension/revocation and never claims reader sync or hardware revocation', async () => {
    const p = await person();
    const card = (await mutation('post',`/people/${p.subject_id}/credentials`,{ modality:'RFID', card_uid:'00:11:22:33' })).body.credential;
    const revoked = await mutation('put',`/credentials/${card.credential_id}`,{ status:'REVOKED' });
    assert.equal(revoked.status,200); assert.equal(revoked.body.credential.sync_status,'PENDING_DEVICE_SYNC');
    assert.equal((await mutation('put',`/people/${p.subject_id}`,{ display_name:p.display_name,reference:p.reference,status:'SUSPENDED',version:p.version })).status,200);
    assert.equal((await mutation('put',`/people/${p.subject_id}`,{ display_name:p.display_name,reference:p.reference,status:'ACTIVE',version:p.version })).status,409);
    assert.equal((await mutation('post',`/people/${p.subject_id}/credentials`,{ modality:'RFID',card_uid:'00:11:22:44' })).status,409);
    assert.equal((await get('/people')).body.people[0].credentials.length,1);
  });

  it('supports server search and pagination and rejects unbounded queries', async () => {
    await person('أحمد ناصر'); await person('Other Person');
    assert.equal((await get(`/people?search=${encodeURIComponent('أحمد')}`)).body.total,1);
    assert.equal((await get('/people?limit=1&page=2')).body.people.length,1);
    assert.equal((await get('/people?limit=100000')).status,400);
    assert.equal((await get('/people?search=%25')).body.total,0);
  });

  it('gates reader enrollment on live, capable firmware and rejects wrong-topic capability claims', async () => {
    const p = await person();
    assert.equal((await mutation('post',`/people/${p.subject_id}/cards/enrollment-sessions`,{})).status,503);
    onlineReader();
    ctx.mqttService.handleIncomingMessage('lecf/env/heartbeat', JSON.stringify({ node_id:'node1',status:'ONLINE',capabilities:['RFID_ENROLL_V1'] }));
    assert.equal((await mutation('post',`/people/${p.subject_id}/cards/enrollment-sessions`,{})).body.code,'READER_UNSUPPORTED');
  });

  it('completes reader arming, scan, owner confirmation and persistence with nonce/session replay protection', async () => {
    const p = await person(); onlineReader();
    const started = await mutation('post',`/people/${p.subject_id}/cards/enrollment-sessions`,{});
    assert.equal(started.status,201); assert.equal(started.body.enrollment.status,'ARMING');
    const command = published[0].payload, id = command.session_id;
    assert.ok(!JSON.stringify(started.body).includes(command.nonce));
    assert.equal((await mutation('post',`/people/${p.subject_id}/cards/enrollment-sessions`,{})).status,409);
    assert.equal(event(command,'CARD',{ card_uid:'AA:BB:CC:DD' }).ok,false);
    assert.equal(event({ ...command,nonce:'x'.repeat(48) },'READY').ok,false);
    assert.equal(event(command,'READY').ok,true);
    assert.equal(event(command,'CARD',{ card_uid:'AA:BB:CC:DD' }).ok,true);
    assert.equal(event(command,'CARD',{ card_uid:'11:22:33:44' }).ok,false);
    const candidate = (await get(`/enrollment-sessions/${id}`)).body.enrollment;
    assert.equal(candidate.status,'CANDIDATE'); assert.ok(candidate.masked_uid.endsWith('CC:DD'));
    const confirmed = await mutation('post',`/enrollment-sessions/${id}/confirm`,{});
    assert.equal(confirmed.status,200); assert.equal(confirmed.body.enrollment.status,'CONFIRMED');
    const credential = (await get('/people')).body.people[0].credentials[0];
    assert.equal(credential.sync_status,'PENDING_DEVICE_SYNC');
    assert.equal(event(command,'READY').ok,false);
    assert.equal((await mutation('post',`/enrollment-sessions/${id}/confirm`,{})).status,409);
    assert.equal(published.length,2,'Only scan start and release are published');
    assert.ok(published.every(p => p.topic === MQTT_TOPICS.READER_ENROLL_COMMAND.topic));
    assert.equal(published[1].payload.action,'CANCEL');
  });

  it('rejects cross-owner enrollment reads and expires, cancels and fails sessions safely across restart', async () => {
    const p = await person(); onlineReader();
    const start = async () => (await mutation('post',`/people/${p.subject_id}/cards/enrollment-sessions`,{})).body.enrollment;
    let enrollment = await start();
    await mutation('post','/operators',{ username:'second_admin',password:'Second-Admin-Password!',role:'Admin' });
    const other = await request(ctx.app).post('/api/auth/login').send({ username:'second_admin',password:'Second-Admin-Password!' });
    assert.equal((await request(ctx.app).get(`/api/v1/enrollment-sessions/${enrollment.session_id}`).set('Cookie',other.headers['set-cookie'][0].split(';')[0])).status,403);
    assert.equal((await mutation('post',`/enrollment-sessions/${enrollment.session_id}/cancel`,{})).status,200);
    assert.equal(event(published[0].payload,'READY').ok,false);
    enrollment = await start();
    ctx.db.prepare('UPDATE reader_enrollment_sessions SET expires_at = ? WHERE session_id = ?').run('2000-01-01T00:00:00.000Z',enrollment.session_id);
    assert.equal((await get(`/enrollment-sessions/${enrollment.session_id}`)).body.enrollment.status,'EXPIRED');
    enrollment = await start();
    ctx.mqttService.client = null; await ctx.stop(); ctx = createBackendContext(overrides());
    const stored = ctx.db.prepare('SELECT status FROM reader_enrollment_sessions WHERE session_id = ?').get(enrollment.session_id);
    assert.equal(stored.status,'FAILED');
  });
});

describe('Camera snapshot boundary', () => {
  it('uses only the registered literal LAN address and fixed path, with no redirects or invalid JPEG bodies', async () => {
    const jpeg = new Uint8Array([0xff,0xd8,0xff,0xd9]);
    const result = await readCameraSnapshot('10.20.0.13', async (url, options) => {
      assert.equal(url,'http://10.20.0.13/capture.jpg'); assert.equal(options.redirect,'manual');
      return new Response(jpeg,{ headers: { 'content-type':'image/jpeg' } });
    });
    assert.deepEqual(result,Buffer.from(jpeg));
    await assert.rejects(() => readCameraSnapshot('127.0.0.1'), { code:'CAMERA_ADDRESS_INVALID' });
    await assert.rejects(() => readCameraSnapshot('10.0.0.13',async () => new Response(null,{ status:302,headers:{ location:'http://127.0.0.1' } })),{ code:'CAMERA_INVALID_RESPONSE' });
    await assert.rejects(() => readCameraSnapshot('10.0.0.13',async () => new Response('not a frame',{ headers:{ 'content-type':'image/jpeg' } })),{ code:'CAMERA_INVALID_JPEG' });
  });

  it('rejects oversized frames and reports transport timeouts without exposing internal details', async () => {
    await assert.rejects(() => readCameraSnapshot('10.0.0.13',async () => new Response(new Uint8Array(2*1024*1024+1),{ headers:{ 'content-type':'image/jpeg' } })),{ code:'CAMERA_FRAME_TOO_LARGE' });
    await assert.rejects(() => readCameraSnapshot('10.0.0.13',async () => { throw new Error('internal transport details'); }),{ code:'CAMERA_UNAVAILABLE' });
  });
});
