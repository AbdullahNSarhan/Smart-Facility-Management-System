/**
 * CI-only pre-hardware end-to-end contract smoke test.
 *
 * Uses REAL Mosquitto + backend + Nginx on loopback; the simulated Node 2
 * identity is created with ephemeral credentials by the GitHub Actions job.
 * NEVER run this test against production or connect physical actuators.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import mqtt from 'mqtt';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
if (process.env.LCI_SIMULATOR_CI_ONLY !== '1') {
  throw new Error('Refusing to run simulator without LCI_SIMULATOR_CI_ONLY=1 (CI test only).');
}
const secretPath = process.env.CI_MQTT_NODE2_SECRET_FILE;
if (!secretPath || !fs.existsSync(secretPath)) {
  throw new Error('Missing CI_MQTT_NODE2_SECRET_FILE.');
}
const nodePassword = fs.readFileSync(secretPath, 'utf8').trim();
if (!nodePassword) throw new Error('Empty test MQTT secret');

const origin = 'http://127.0.0.1';
const broker = 'mqtt://127.0.0.1:1883';
const nodeId = 'env_02';
const bootId = 'ci-' + crypto.randomUUID();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollUntil(description, fn, attempts = 40) {
  for (let n = 0; n < attempts; n++) {
    const value = await fn();
    if (value) return value;
    await sleep(250);
  }
  throw new Error('Timed out waiting for ' + description);
}

function connectClient() {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(broker, {
      username: 'node2_env',
      password: nodePassword,
      clientId: 'ci-node2-' + crypto.randomUUID(),
      reconnectPeriod: 0,
      connectTimeout: 5000,
      clean: true,
      protocolVersion: 4
    });
    const timer = setTimeout(() => { client.end(true); reject(new Error('MQTT connect timeout')); }, 8000);
    client.once('error', (error) => {
      clearTimeout(timer);
      client.end(true);
      reject(error);
    });
    client.once('connect', () => {
      clearTimeout(timer);
      resolve(client);
    });
  });
}

async function publish(client, topic, payload, qos = 1) {
  return new Promise((resolve, reject) => {
    client.publish(topic, JSON.stringify(payload), { qos, retain: false }, (error) =>
      error ? reject(error) : resolve()
    );
  });
}

function subscribe(client, topic) {
  return new Promise((resolve, reject) => {
    client.subscribe(topic, { qos: 1 }, (error, grants) => {
      if (error || !grants?.length || grants[0].qos === 128) {
        return reject(error || new Error('MQTT subscription refused for ' + topic));
      }
      resolve();
    });
  });
}

async function readJson(path, init = {}) {
  const response = await fetch(origin + path, { ...init, signal: AbortSignal.timeout(5000) });
  const body = await response.json();
  return { response, body };
}

async function main() {
  const { response: loginResponse, body: login } = await readJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.LCI_BOOTSTRAP_ADMIN_USERNAME,
      password: process.env.LCI_BOOTSTRAP_ADMIN_PASSWORD
    })
  });
  assert.equal(loginResponse.status, 200, 'CI Admin login failed');
  assert.equal(login.authenticated, true);
  assert.equal(login.user?.role, 'Admin');
  assert.ok(login.csrfToken);
  const cookie = loginResponse.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'Login failed to return session cookie');
  const authHeaders = { Cookie: cookie };

  async function logs(table) {
    const { response, body } = await readJson('/api/logs/' + table + '?limit=250', { headers: authHeaders });
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body));
    return body;
  }

  const node = await connectClient();
  let ackedCommand = null;
  try {
    // Wait for the backend to subscribe before testing device traffic.
    await pollUntil('backend MQTT subscription readiness', async () => {
      const { response, body } = await readJson('/api/health/ready');
      return response.status === 200 && body.mqtt?.subscriptions_ready === true;
    });

    await subscribe(node, 'lecf/env/command');
    node.on('message', (topic, buf) => {
      if (topic !== 'lecf/env/command') return;
      let msg;
      try { msg = JSON.parse(buf.toString('utf8')); } catch { return; }
      if (msg.command !== 'TOGGLE_AUX_LIGHT' || msg.state !== 'ON') return;
      assert.equal(msg.target_node, nodeId);
      assert.ok(msg.command_id);
      assert.ok(Date.parse(msg.expires_at) > Date.now() - 1000);
      ackedCommand = msg.command_id;
      publish(node, 'lecf/env/command/ack', {
        command_id: msg.command_id,
        node_id: nodeId,
        status: 'executed',
        observed_state: 'ON'
      }).catch((e) => { console.error('CI device ACK publish failed:', e.message); });
    });

    const sample = {
      schema_version: 1,
      node_id: nodeId,
      boot_id: bootId,
      seq: 1,
      temperature_c: 24.5,
      humidity_pct: 48.5,
      smoke_gas_level: 150,
      light_state: 'OFF',
      fan_relay: 'OFF'
    };
    await publish(node, 'lecf/env/telemetry', sample);
    const inserted = await pollUntil('valid telemetry persistence via MQTT', async () =>
      (await logs('environmental_telemetry')).find((r) => r.boot_id === bootId && r.seq === 1)
    );
    assert.equal(inserted.temperature, 24.5);
    assert.equal(inserted.node_id, nodeId);
    console.log('PASS: real MQTT telemetry -> schema validation -> SQLite');

    await publish(node, 'lecf/env/telemetry', sample);
    await sleep(350);
    const copies = (await logs('environmental_telemetry')).filter((r) => r.boot_id === bootId && r.seq === 1);
    assert.equal(copies.length, 1, 'Duplicate QoS telemetry was inserted again');
    console.log('PASS: duplicate telemetry is idempotent');

    await publish(node, 'lecf/env/telemetry', { ...sample, seq: 2, temperature_c: 999 });
    await pollUntil('invalid telemetry audit record', async () =>
      (await logs('system_errors')).some((r) =>
        r.error_code === 'MQTT_SCHEMA_VIOLATION' &&
        String(r.error_description).includes('lecf/env/telemetry'))
    );
    console.log('PASS: invalid sensor telemetry rejected and audited');

    const { response: cmdResponse, body: command } = await readJson('/api/command', {
      method: 'POST',
      headers: { ...authHeaders, 'X-CSRF-Token': login.csrfToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'TOGGLE_AUX_LIGHT', state: 'ON' })
    });
    assert.equal(cmdResponse.status, 200);
    assert.ok(command.command_id, 'Missing command ID');
    assert.notEqual(command.lifecycle_state, 'failed');
    await pollUntil('actual simulated device command and ACK', async () =>
      ackedCommand === command.command_id
    );
    // The command_audit table is intentionally NOT a public /api/logs table.
    // Inspect it only from the isolated CI host through Docker, read-only.
    await pollUntil('matching MQTT command ACK audit', async () => {
      const sql = "const { DatabaseSync } = require('node:sqlite');" +
        "const db = new DatabaseSync('/app/data/lci_sfm.db', { readOnly: true });" +
        "const r = db.prepare('SELECT lifecycle_state FROM command_audit WHERE command_id = ?').get(process.argv[1]);" +
        "console.log(r ? r.lifecycle_state : ''); db.close();";
      const lifecycle = execFileSync('docker', [
        'compose', 'exec', '-T', 'backend', 'node', '-e', sql, command.command_id
      ], { encoding: 'utf8', timeout: 5000 }).trim();
      return lifecycle === 'state_confirmed';
    });
    console.log('PASS: Admin CSRF-protected API -> broker -> simulated Node2 -> ACK -> SQLite');

    const { response: readyResponse, body: health } = await readJson('/api/health/ready');
    assert.equal(readyResponse.status, 200);
    assert.equal(health.sqlite?.ok, true);
    assert.equal(health.mqtt?.state, 'connected');
    assert.equal(health.mqtt?.observed_nodes?.[nodeId]?.fresh, true);
    console.log('PASS: broker readiness and fresh simulated node are reported separately');
    console.log('CI MQTT simulated-endpoint contract smoke passed (no physical hardware tested).');
  } finally {
    node.end(true);
  }
}

main().catch((error) => {
  console.error('CI MQTT simulated-endpoint contract smoke failed:', error.message);
  process.exitCode = 1;
});
