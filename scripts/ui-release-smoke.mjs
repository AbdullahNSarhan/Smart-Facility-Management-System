import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { chromium } from 'playwright';
import { createBackendContext } from '../backend/src/app.js';

const distDir = path.resolve(process.cwd(), 'dist');
if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  throw new Error('dist/index.html missing. Run `npm run build` before `npm run test:ui`.');
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lci-ui-smoke-'));
const adminPass = 'Admin-Smoke-Pass#2026';
const ctx = createBackendContext({
  NODE_ENV: 'test',
  PORT: 0,
  HOST: '127.0.0.1',
  SQLITE_DB_PATH: path.join(tmpDir, 'ui.db'),
  MQTT_ENABLED: 'false',
  LCI_SIMULATOR_MODE: 'true',
  LCI_BOOTSTRAP_ADMIN_USERNAME: 'admin',
  LCI_BOOTSTRAP_ADMIN_PASSWORD: adminPass
});

// Mount compiled dist/ with History API SPA fallback for /, /login, /app/*
ctx.app.use(express.static(distDir));
ctx.app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(distDir, 'index.html'));
});

let browser;
try {
  const addr = await ctx.start();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const allowedOrigin = new URL(baseUrl).origin;

  // Provision a Viewer account via the real HTTP API for RBAC UI verification
  const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: adminPass })
  });
  assert.equal(adminLoginRes.status, 200);
  const adminLoginJson = await adminLoginRes.json();
  const adminCookie = adminLoginRes.headers.get('set-cookie').split(';')[0];
  const provRes = await fetch(`${baseUrl}/api/v1/operators`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie,
      'X-CSRF-Token': adminLoginJson.csrfToken
    },
    body: JSON.stringify({
      username: 'viewer_ui',
      password: 'Viewer-Smoke-Pass#2026',
      role: 'Viewer'
    })
  });
  assert.equal(provRes.status, 201);

  const candidateBrowsers = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome'
  ].filter(Boolean);
  const detectedExecutable = candidateBrowsers.find((p) => fs.existsSync(p));
  const defaultExecutable = chromium.executablePath();
  const launchOpts = { headless: true };
  if (!fs.existsSync(defaultExecutable) && detectedExecutable) {
    launchOpts.executablePath = detectedExecutable;
  }

  browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Deterministic Web Audio stub for the notification sound preference smoke test.
  await page.addInitScript(() => {
    class FakeAudioParam { setValueAtTime() {} exponentialRampToValueAtTime() {} }
    class FakeAudioNode { connect() {} }
    class FakeOscillator extends FakeAudioNode {
      constructor() { super(); this.frequency = new FakeAudioParam(); this.type = 'sine'; }
      start() {}
      stop() {}
    }
    class FakeGain extends FakeAudioNode { constructor() { super(); this.gain = new FakeAudioParam(); } }
    window.AudioContext = class extends FakeAudioNode {
      constructor() { super(); this.state = 'running'; this.currentTime = 0; this.destination = {}; }
      createOscillator() { return new FakeOscillator(); }
      createGain() { return new FakeGain(); }
      resume() { this.state = 'running'; return Promise.resolve(); }
      close() { this.state = 'closed'; return Promise.resolve(); }
    };
  });

  const consoleErrors = [];
  const pageErrors = [];
  const externalRequests = [];
  let expectingReaderOffline503 = false;

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const txt = msg.text();
      if (/status of 401 \(Unauthorized\)/.test(txt) && msg.location()?.url?.includes('/api/auth/session')) {
        return;
      }
      if (expectingReaderOffline503 && txt.includes('503 (Service Unavailable)')) return;
      consoleErrors.push(txt);
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(String(err?.message || err));
  });
  // Strict offline/air-gap enforcement: block and record any external HTTP/WS/font/CDN request
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) {
      await route.continue();
      return;
    }
    try {
      const origin = new URL(url).origin;
      if (origin !== allowedOrigin) {
        externalRequests.push(url);
        await route.abort('blockedbyclient');
        return;
      }
    } catch {
      // allow non-standard internal schemes
    }
    await route.continue();
  });

  async function assertLoadedImages(selector, contextLabel) {
    const stats = await page.locator(selector).evaluateAll((imgs) =>
      imgs.map((img) => ({
        src: img.getAttribute('src') || '',
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight
      }))
    );
    assert.ok(stats.length > 0, `Expected at least 1 local SVG illustration for ${selector} (${contextLabel})`);
    for (const s of stats) {
      assert.equal(s.complete, true, `Illustration incomplete (${contextLabel}): ${s.src}`);
      assert.ok(s.naturalWidth > 0 && s.naturalHeight > 0, `Broken SVG asset (${contextLabel}): ${JSON.stringify(s)}`);
    }
    return stats.length;
  }

  // 1. Local Landing Page (/) — verify simulator banner in BOTH simulator and non-simulator modes
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  assert.match(await page.locator('h1').textContent(), /Local-First Infrastructure Control/i);
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
  await assertLoadedImages('#system-status img', 'Landing Facility Hub illustration');
  // Simulator mode is active on ctx (LCI_SIMULATOR_MODE='true') -> banner & posture must reflect simulation: true
  await page.locator('#landing-simulator-banner').waitFor({ state: 'visible' });
  assert.match(await page.locator('#landing-simulator-banner').textContent(), /ISOLATED SIMULATOR MODE ACTIVE/i);
  assert.match(await page.locator('#system-status').textContent(), /Isolated Simulator/);

  // Verify non-simulator mode (simulation: false) hides banner and displays On-Premises LAN
  await page.route(`${baseUrl}/api/public/info`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        product: 'LCI-SFM',
        version: '2.0.0-rc.1',
        deployment_mode: 'local-first',
        simulation: false,
        database_ok: true
      })
    });
  });
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('#landing-simulator-banner').isHidden(), true, 'Simulator banner must be hidden when simulation === false');
  assert.match(await page.locator('#system-status').textContent(), /On-Premises LAN/);
  await page.unroute(`${baseUrl}/api/public/info`);

  // 2. Unauthenticated deep-link to /app/rooms redirects to /login?next=%2Fapp%2Frooms
  await page.goto(`${baseUrl}/app/rooms`, { waitUntil: 'networkidle' });
  assert.equal(new URL(page.url()).pathname, '/login');
  assert.equal(new URL(page.url()).searchParams.get('next'), '/app/rooms');

  // Verify accessible show/hide password toggle on login
  await page.fill('#login-password', 'test');
  await page.getByRole('button', { name: 'Show password' }).click();
  assert.equal(await page.locator('#login-password').getAttribute('type'), 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  assert.equal(await page.locator('#login-password').getAttribute('type'), 'password');

  // 3. Sign in as Admin -> lands on redirected /app/rooms
  await page.fill('#login-username', 'admin');
  await page.fill('#login-password', adminPass);
  await page.click('#login-submit-btn');
  await page.waitForURL(`${baseUrl}/app/rooms`);
  await page.waitForSelector('#add-room-btn');
  await page.waitForLoadState('networkidle');

  // 4. Create a dynamic room; assert the write response and the subsequent list response separately.
  await page.click('#add-room-btn');
  const modal = page.locator('#active-modal-backdrop');
  await modal.waitFor({ state: 'visible' });
  await modal.locator('input[placeholder="e.g. LAB-102"]').fill('LAB-305');
  await modal.locator('input[placeholder="e.g. Server Rack Room"]').fill('Automation Test Lab');
  const createRoomResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/rooms'
  );
  const refreshRoomsResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/v1/rooms'
  );
  await modal.getByRole('button', { name: 'Create Room' }).click();
  const createRoomResponse = await createRoomResponsePromise;
  const createRoomBody = await createRoomResponse.json().catch(() => ({}));
  assert.equal(createRoomResponse.status(), 201, `Expected Room creation HTTP 201; got ${createRoomResponse.status()}: ${JSON.stringify(createRoomBody)}`);
  await modal.waitFor({ state: 'detached' });
  const refreshRoomsResponse = await refreshRoomsResponsePromise;
  const refreshRoomsBody = await refreshRoomsResponse.json().catch(() => ({}));
  assert.equal(refreshRoomsResponse.status(), 200, `Expected Room refresh HTTP 200; got ${refreshRoomsResponse.status()}: ${JSON.stringify(refreshRoomsBody)}`);
  assert.ok((refreshRoomsBody.rooms || []).some((room) => room.room_code === 'LAB-305'), `Room write succeeded but list response did not include LAB-305: ${JSON.stringify(refreshRoomsBody)}`);
  await page.waitForSelector('text=LAB-305');

  // Deep-link reload test on /app/rooms
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('text=LAB-305');

  // Open Room Detail page (/app/rooms/:roomId) and verify environmental summary strip + recent commands (P2-B)
  await page.locator('table tbody tr', { hasText: 'LAB-305' }).getByRole('button', { name: 'Open' }).click();
  await page.waitForURL(/\/app\/rooms\/.+/);
  await page.waitForSelector('text=Automation Test Lab');
  await page.locator('#room-environmental-strip').waitFor({ state: 'visible' });
  await page.locator('#room-recent-commands').waitFor({ state: 'visible' });

  // Verify Overview "+ Add Room" deep-link opens Room Modal on /app/rooms?action=create (P2-B)
  await page.goto(`${baseUrl}/app/overview`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Add Room' }).click();
  await page.waitForURL(`${baseUrl}/app/rooms`);
  await modal.waitFor({ state: 'visible' });
  await modal.getByRole('button', { name: 'Cancel' }).click();
  await modal.waitFor({ state: 'detached' });

  // 5. Navigate to Devices (/app/devices) and complete the 4-Step Wizard for an MQTT_V1 device WITHOUT IP
  await page.getByRole('link', { name: 'Devices' }).click();
  await page.waitForURL(`${baseUrl}/app/devices`);
  await page.click('#register-device-btn');
  await modal.waitFor({ state: 'visible' });

  // Step 1: Identity — assert the browser validation matches the backend ID contract.
  await modal.locator('#wiz-device-id').fill('1mqtt-ui-sensor');
  const deviceTypeOptions = await modal.locator('#wiz-device-type option').evaluateAll((options) => options.map((option) => option.value));
  assert.deepEqual(deviceTypeOptions, ['SENSORS', 'CAMERA', 'ACCESS', 'RELAY', 'MIXED']);
  await modal.locator('#wiz-device-type').selectOption('SENSORS');
  await modal.locator('#wiz-device-name').fill('UI MQTT Sensor');
  await modal.getByRole('button', { name: 'Continue' }).click();
  await modal.getByText(/Device ID must start with a lowercase letter/).waitFor({ state: 'visible' });
  await modal.locator('#wiz-device-id').fill('mqtt-ui-sensor');
  await modal.getByRole('button', { name: 'Continue' }).click();

  // Step 2: Transport — reject invalid public IPv4 immediately (P1-A) and values outside 5–3600s range.
  await modal.locator('#wiz-device-transport').waitFor({ state: 'visible' });
  await modal.locator('#wiz-device-transport').selectOption('HTTP_JSON_V1');
  await modal.locator('#wiz-device-ip').fill('8.8.8.8');
  await modal.getByRole('button', { name: 'Continue' }).click();
  await modal.getByText(/private unicast LAN IPv4 address/i).waitFor({ state: 'visible' });
  assert.equal(await modal.locator('#wiz-device-transport').isVisible(), true, 'Invalid IP must block progression on Step 2');
  await modal.locator('#wiz-device-transport').selectOption('MQTT_V1');
  await modal.locator('#wiz-device-stale').fill('3601');
  await modal.getByRole('button', { name: 'Continue' }).click();
  await modal.getByText(/between 5 and 3600 seconds/).waitFor({ state: 'visible' });
  await modal.locator('#wiz-device-stale').fill('3600');
  await modal.getByRole('button', { name: 'Continue' }).click();

  // Step 3: Endpoints — reject invalid keys, incompatible device_type/kind, and inverted min/max bounds (P1-A).
  const endpointKeyInput = modal.locator('.endpoint-editor-row input').first();
  await endpointKeyInput.fill('1temperature');
  await modal.getByRole('button', { name: 'Continue' }).click();
  await modal.getByText(/Invalid endpoint key/).waitFor({ state: 'visible' });
  await endpointKeyInput.fill('temperature');
  await modal.locator('.endpoint-editor-row select').first().selectOption('SWITCH');
  await modal.getByRole('button', { name: 'Continue' }).click();
  await modal.getByText(/does not match device type SENSORS/i).waitFor({ state: 'visible' });
  await modal.locator('.endpoint-editor-row select').first().selectOption('SENSOR');
  await modal.locator('#wiz-ep-min-0').fill('90');
  await modal.locator('#wiz-ep-max-0').fill('80');
  await modal.getByRole('button', { name: 'Continue' }).click();
  await modal.getByText(/strictly below max_value/i).waitFor({ state: 'visible' });
  await modal.locator('#wiz-ep-min-0').fill('-10');
  await modal.locator('#wiz-ep-max-0').fill('85');
  await modal.getByRole('button', { name: 'Continue' }).click();

  // Step 4: Review & Register
  await modal.locator('text=Broker-mediated (no direct IP)').waitFor({ state: 'visible' });
  await modal.getByRole('button', { name: 'Register Device' }).click();
  await page.waitForSelector('text=UI MQTT Sensor');

  // 5B. Verify full Endpoint Metadata Preservation on Edit + Device Frame History + SWITCH State-Step Chart (P1-A & P1-C)
  const metaDeviceCreate = await fetch(`${baseUrl}/api/v1/registry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie,
      'X-CSRF-Token': adminLoginJson.csrfToken
    },
    body: JSON.stringify({
      device_id: 'mqtt-meta-device',
      name: 'Metadata Seed Node',
      description: 'Initial metadata node',
      room_id: 'room-001',
      device_type: 'MIXED',
      transport: 'MQTT_V1',
      stale_after_s: 120,
      endpoints: [
        {
          endpoint_key: 'supply_temp',
          label: 'Supply Temp',
          description: 'Chilled water supply probe',
          kind: 'SENSOR',
          data_type: 'NUMBER',
          unit: '°C',
          readable: true,
          writable: false,
          retention_enabled: false,
          min_value: -20,
          max_value: 95,
          display_config: { widget: 'METRIC_TREND', precision: 2 }
        },
        {
          endpoint_key: 'aux_relay',
          label: 'Aux Relay',
          description: 'Exhaust damper relay',
          kind: 'SWITCH',
          data_type: 'ENUM',
          writable: true,
          retention_enabled: true,
          allowed_values: ['ON', 'OFF'],
          command_profile: 'MQTT_SWITCH_V1'
        }
      ]
    })
  });
  assert.equal(metaDeviceCreate.status, 201);

  ctx.operations.ingest('mqtt-meta-device', {
    schema_version: 1,
    device_id: 'mqtt-meta-device',
    boot_id: 'smoke-boot-1',
    seq: 1,
    values: { supply_temp: 18.4, aux_relay: 'OFF' }
  });
  ctx.operations.ingest('mqtt-meta-device', {
    schema_version: 1,
    device_id: 'mqtt-meta-device',
    boot_id: 'smoke-boot-1',
    seq: 2,
    values: { supply_temp: 19.2, aux_relay: 'ON' }
  });

  await page.goto(`${baseUrl}/app/devices/mqtt-meta-device`, { waitUntil: 'networkidle' });
  await page.locator('#device-recent-frames').waitFor({ state: 'visible' });
  assert.match(await page.locator('#device-recent-frames').textContent(), /aux_relay: ON/);

  // Edit Metadata Seed Node through 4-Step Wizard -> verify every non-form endpoint metadata field is preserved
  await page.getByRole('button', { name: 'Edit Device' }).click();
  await modal.waitFor({ state: 'visible' });
  await modal.locator('#wiz-device-name').fill('Metadata Preserved Node');
  await modal.getByRole('button', { name: 'Continue' }).click();
  await modal.getByRole('button', { name: 'Continue' }).click();
  await modal.getByRole('button', { name: 'Continue' }).click();
  const updateMetaPromise = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/v1/registry/mqtt-meta-device'
  );
  await modal.getByRole('button', { name: 'Save Device' }).click();
  assert.equal((await updateMetaPromise).status(), 200);
  await modal.waitFor({ state: 'detached' });

  const verifyMetaRes = await page.request.get(`${baseUrl}/api/v1/registry/mqtt-meta-device`);
  assert.equal(verifyMetaRes.status(), 200);
  const verifiedDev = (await verifyMetaRes.json()).device;
  assert.equal(verifiedDev.name, 'Metadata Preserved Node');
  const verifiedSensor = verifiedDev.endpoints.find((e) => e.endpoint_key === 'supply_temp');
  const verifiedRelay = verifiedDev.endpoints.find((e) => e.endpoint_key === 'aux_relay');
  assert.equal(verifiedSensor.description, 'Chilled water supply probe');
  assert.equal(verifiedSensor.min_value, -20);
  assert.equal(verifiedSensor.max_value, 95);
  assert.equal(verifiedSensor.retention_enabled, false);
  assert.deepEqual(verifiedSensor.display_config, { widget: 'METRIC_TREND', precision: 2 });
  assert.equal(verifiedRelay.description, 'Exhaust damper relay');
  assert.deepEqual(verifiedRelay.allowed_values, ['ON', 'OFF']);
  assert.equal(verifiedRelay.command_profile, 'MQTT_SWITCH_V1');

  // Open SWITCH Endpoint History -> verify state-step chart (OFF/ON Y-axis + H/V step commands) & sample limit control
  await page.goto(`${baseUrl}/app/devices/mqtt-meta-device/endpoints/aux_relay`, { waitUntil: 'networkidle' });
  const relayChartText = await page.locator('.history-chart-svg').textContent();
  assert.match(relayChartText, /OFF/);
  assert.match(relayChartText, /ON/);
  const relayPathD = await page.locator('.history-chart-svg .chart-series-line').getAttribute('d');
  assert.match(relayPathD || '', /H.*V/, 'Expected digital step-after SVG path for SWITCH endpoint');
  await page.getByRole('group', { name: 'History sample limit' }).getByRole('button', { name: '250' }).click();

  // Inspect Device Detail (/app/devices/mqtt-ui-sensor) -> verify Hero Illustration, Generic Endpoint Widget, MQTT CLI & Maintenance Modal (P2-B)
  await page.goto(`${baseUrl}/app/devices`, { waitUntil: 'networkidle' });
  await assertLoadedImages('table tbody img.node-illus-img', 'Devices table node illustrations');
  const staticChipCursor = await page.locator('.cat-chip').first().evaluate((el) => getComputedStyle(el).cursor);
  assert.equal(staticChipCursor, 'default', 'Static category chips must not display pointer cursor');
  await page.locator('table tbody tr', { hasText: 'UI MQTT Sensor' }).getByRole('button', { name: 'Inspect' }).click();
  await page.waitForURL(`${baseUrl}/app/devices/mqtt-ui-sensor`);
  await page.locator('#device-identity-hero.cat-env').waitFor({ state: 'visible' });
  await assertLoadedImages('#device-identity-hero img.node-illus-img', 'Device Detail hero illustration');
  await page.waitForSelector('.widget-card');
  await page.waitForSelector('text=provision-mqtt-device.sh add mqtt-ui-sensor');

  await page.click('#device-maintenance-btn');
  await modal.waitFor({ state: 'visible' });
  await modal.getByRole('group', { name: 'Maintenance duration presets' }).getByRole('button', { name: '4h', exact: true }).click();
  assert.equal(await modal.locator('#maint-minutes-input').inputValue(), '240');
  await modal.locator('#maint-reason-input').fill('Scheduled quarterly calibration');
  const startMaintPromise = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/registry/mqtt-ui-sensor/maintenance'
  );
  await modal.locator('#maint-submit-btn').click();
  assert.equal((await startMaintPromise).status(), 200);
  await modal.waitFor({ state: 'detached' });
  await page.locator('#device-maintenance-banner').waitFor({ state: 'visible' });
  assert.match(await page.locator('#device-maintenance-banner').textContent(), /Scheduled quarterly calibration/);

  await page.locator('#device-maintenance-banner').getByRole('button', { name: 'End Maintenance' }).click();
  await modal.waitFor({ state: 'visible' });
  const endMaintPromise = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/registry/mqtt-ui-sensor/maintenance'
  );
  await modal.getByRole('button', { name: 'End Maintenance' }).click();
  assert.equal((await endMaintPromise).status(), 200);
  await modal.waitFor({ state: 'detached' });
  await page.locator('#device-maintenance-banner').waitFor({ state: 'detached' });

  // Navigate to Endpoint History and switch time preset
  await page.getByRole('button', { name: 'History →' }).first().click();
  await page.waitForURL(`${baseUrl}/app/devices/mqtt-ui-sensor/endpoints/temperature`);
  await page.getByRole('button', { name: '24h' }).click();
  await page.waitForSelector('.history-chart-svg');

  // Verify Simulation Camera Placeholder on node3 & Quarantine Dismiss + Status Filter (P2-A & P2-B)
  await page.goto(`${baseUrl}/app/devices/node3`, { waitUntil: 'networkidle' });
  await page.locator('#device-identity-hero.cat-camera').waitFor({ state: 'visible' });
  await assertLoadedImages('.camera-placeholder-illus', 'Camera synthetic preview SVG illustration');
  await page.getByText(/Synthetic Preview Placeholder/i).waitFor({ state: 'visible' });

  assert.deepEqual(
    ctx.operations.heartbeat('rogue-mqtt-node', {
      schema_version: 1,
      device_id: 'rogue-mqtt-node',
      boot_id: 'rogue-boot-1',
      uptime_ms: 12000,
      firmware_version: '1.4.2',
      endpoints: [{ endpoint_key: 'temp', label: 'Temp', kind: 'SENSOR', data_type: 'NUMBER', unit: '°C' }]
    }),
    { ok: false, error: 'DEVICE_PENDING_APPROVAL', pending: true }
  );
  assert.deepEqual(
    ctx.operations.heartbeat('rogue-viewer-check', {
      schema_version: 1,
      device_id: 'rogue-viewer-check',
      boot_id: 'rogue-boot-2',
      uptime_ms: 8000,
      firmware_version: '1.0.1',
      endpoints: [{ endpoint_key: 'temp', label: 'Temp', kind: 'SENSOR', data_type: 'NUMBER', unit: '°C' }]
    }),
    { ok: false, error: 'DEVICE_PENDING_APPROVAL', pending: true }
  );

  await page.goto(`${baseUrl}/app/devices`, { waitUntil: 'networkidle' });
  const quarantinePanel = page.locator('#quarantine-review-panel');
  await quarantinePanel.waitFor({ state: 'visible' });
  const rogueItem = quarantinePanel.locator('.queue-item', { hasText: 'rogue-mqtt-node' });
  await rogueItem.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await modal.waitFor({ state: 'visible' });
  const dismissRoguePromise = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/pending-devices/rogue-mqtt-node/dismiss'
  );
  await modal.getByRole('button', { name: 'Dismiss Announcement', exact: true }).click();
  assert.equal((await dismissRoguePromise).status(), 200);
  await modal.waitFor({ state: 'detached' });

  await quarantinePanel.getByRole('group', { name: 'Quarantine status filter' }).getByRole('button', { name: 'Dismissed', exact: true }).click();
  await quarantinePanel.getByText('rogue-mqtt-node').waitFor({ state: 'visible' });
  await quarantinePanel.getByRole('group', { name: 'Quarantine status filter' }).getByRole('button', { name: 'Pending', exact: true }).click();

  // 6. Interactive Network & Connectivity Topology (/app/network)
  await page.getByRole('link', { name: 'Network' }).click();
  await page.waitForURL(`${baseUrl}/app/network`);
  await page.waitForSelector('.topology-svg');
  await assertLoadedImages('#network-node-inspector img.node-illus-img', 'Network core node inspector illustration');
  await page.locator('[data-topo-node-id="dev:mqtt-ui-sensor"]').click();
  await page.waitForSelector('#network-node-inspector >> text=UI MQTT Sensor');
  await assertLoadedImages('#network-node-inspector img.node-illus-img', 'Network device node inspector illustration');

  // 7. Alarms & Rules — verify strict hysteresis validation (< / >), create rule with hold_s=0, trigger alarm, and test ?alarm_id= deep-link (P1-A & P2-C)
  await page.getByRole('link', { name: 'Alarms & Rules' }).click();
  await page.waitForURL(`${baseUrl}/app/alarms`);
  await page.click('#create-rule-btn');
  await modal.waitFor({ state: 'visible' });
  await modal.locator('input[placeholder="e.g. High Rack Temperature"]').fill('UI Smoke Temp Alert');
  await modal.locator('#rule-device-select').selectOption('mqtt-ui-sensor');
  await modal.locator('#rule-threshold-input').fill('30');
  await modal.locator('#rule-clear-threshold-input').fill('30');
  await modal.getByRole('button', { name: 'Create Rule' }).click();
  await modal.locator('.form-error').filter({ hasText: /strictly below/i }).waitFor({ state: 'visible' });
  await modal.locator('#rule-clear-threshold-input').fill('28');
  await modal.locator('#rule-hold-input').fill('0');
  await modal.getByRole('button', { name: 'Create Rule' }).click();
  await modal.waitFor({ state: 'detached' });
  await page.getByRole('tab', { name: 'Monitoring Rules' }).click();
  await page.waitForSelector('text=UI Smoke Temp Alert');

  // Trigger live alarm on mqtt-ui-sensor -> verify Notifications "Inspect Alarm" deep-links into open Alarm Timeline Drawer
  ctx.operations.ingest('mqtt-ui-sensor', {
    schema_version: 1,
    device_id: 'mqtt-ui-sensor',
    boot_id: 'alarm-boot-1',
    seq: 1,
    values: { temperature: 35.4 }
  });
  await page.goto(`${baseUrl}/app/notifications`, { waitUntil: 'networkidle' });
  const inspectAlarmBtn = page.getByRole('button', { name: 'Inspect Alarm' }).first();
  await inspectAlarmBtn.waitFor({ state: 'visible' });
  await inspectAlarmBtn.click();
  await page.waitForURL(`${baseUrl}/app/alarms`);
  await page.locator('#active-drawer-backdrop >> text=LIFECYCLE TIMELINE').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page.waitForSelector('#active-drawer-backdrop', { state: 'detached' });

  // 8. Events & Audit Logs + Camera Events + Env Telemetry Rollups + Slide-Over Detail Drawer (P1-C & P2-A)
  ctx.repo.insertCameraEvent({
    node_id: 'node3',
    boot_id: 'cam-boot-1',
    seq: 1,
    event: 'FACE_VERIFIED',
    user_id: 'emp_nadia',
    status: 'VERIFIED',
    confidence: 96.4,
    details: 'Door 1 MFA verified'
  });
  await page.getByRole('link', { name: 'Events & Audit' }).click();
  await page.waitForURL(`${baseUrl}/app/events`);
  assert.equal(await page.getByRole('tab', { name: 'Admin Audit' }).count(), 0, 'Do not expose an unimplemented admin_audit log table');
  await page.getByRole('tab', { name: 'Camera Events' }).click();
  await page.locator('#camera-events-boundary-banner').waitFor({ state: 'visible' });
  await page.getByRole('cell', { name: 'emp_nadia' }).waitFor({ state: 'visible' });
  await page.getByRole('cell', { name: /96\.4%/ }).waitFor({ state: 'visible' });
  await page.getByRole('group', { name: 'Event log row limit' }).getByRole('button', { name: '250', exact: true }).click();

  await page.getByRole('tab', { name: 'Env Telemetry' }).click();
  await page.locator('#env-telemetry-rollup-panel').waitFor({ state: 'visible' });
  await page.locator('#env-telemetry-rollup-panel >> text=/No environmental rollup samples in 24H window/i').waitFor({ state: 'visible' });
  await assertLoadedImages('#env-telemetry-rollup-panel .empty-state-illus img', 'Env Telemetry empty state illustration');

  // Seed 2 legacy environmental_telemetry rows in isolated test DB and verify populated rollup view
  const nowMs = Date.now();
  ctx.repo.insertEnvironmentalTelemetry({
    timestamp_ms: nowMs - 10 * 60 * 1000,
    node_id: 'env_02',
    boot_id: 'env-boot-1',
    seq: 1,
    temperature: 22.4,
    humidity: 44.0,
    smoke_gas_level: 115,
    light_state: 'OFF',
    fan_relay: 'OFF',
    door_state: 'CLOSED'
  });
  ctx.repo.insertEnvironmentalTelemetry({
    timestamp_ms: nowMs - 2 * 60 * 1000,
    node_id: 'env_02',
    boot_id: 'env-boot-1',
    seq: 2,
    temperature: 26.6,
    humidity: 50.0,
    smoke_gas_level: 185,
    light_state: 'ON',
    fan_relay: 'OFF',
    door_state: 'CLOSED'
  });
  await page.getByRole('group', { name: 'Rollup bucket interval' }).getByRole('button', { name: '5m', exact: true }).click();
  await page.locator('#env-telemetry-rollup-panel .chart-band-area').waitFor({ state: 'visible' });
  assert.match(await page.locator('#env-telemetry-rollup-panel').textContent(), /185 raw/);

  await page.getByRole('tab', { name: 'Management Audit' }).click();
  await page.waitForSelector('table tbody tr');
  await page.locator('table tbody tr').first().getByRole('button', { name: 'Inspect' }).click();
  await page.waitForSelector('#active-drawer-backdrop');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#active-drawer-backdrop', { state: 'detached' });

  // 9. Separated Users & Access Tabs (Operators role confirmation + Facility People Edit & Credentials via /api/v1/people)
  await page.getByRole('link', { name: 'Users & Access' }).click();
  await page.waitForURL(`${baseUrl}/app/users`);
  await page.waitForSelector('text=viewer_ui');
  const viewerOpRow = page.locator('tr').filter({ hasText: 'viewer_ui' });
  await viewerOpRow.getByRole('button', { name: 'Promote to Admin' }).click();
  await modal.waitFor({ state: 'visible' });
  assert.match(await modal.textContent(), /revokes all active console sessions/i);
  await modal.getByRole('button', { name: 'Cancel' }).click();
  await modal.waitFor({ state: 'detached' });

  await page.getByRole('tab', { name: 'Facility People & Credentials' }).click();
  await page.waitForSelector('text=Physical Credential Policy Boundary');
  await page.getByRole('button', { name: 'Add Account / Person' }).click();
  await modal.waitFor({ state: 'visible' });
  await modal.locator('#person-create-name').fill('Reader UI Smoke Person');
  await modal.getByRole('button', { name: 'Add Person' }).click();
  await page.getByRole('table', { name: 'Facility people and physical' }).getByText('Reader UI Smoke Person').waitFor();
  const peopleLookup = await page.request.get(`${baseUrl}/api/v1/people?search=Reader%20UI%20Smoke%20Person`);
  assert.equal(peopleLookup.status(), 200);
  const peoplePayload = await peopleLookup.json();
  const smokePerson = (peoplePayload.people || []).find((person) => person.display_name === 'Reader UI Smoke Person');
  assert.ok(smokePerson?.subject_id, `Expected the People API to expose subject_id: ${JSON.stringify(peoplePayload)}`);
  const smokePersonRow = page.getByRole('table', { name: 'Facility people and physical' }).locator('tr').filter({ hasText: 'Reader UI Smoke Person' });

  // Edit Facility Person display_name / reference (P2-C)
  await smokePersonRow.getByRole('button', { name: 'Edit Reader UI Smoke Person' }).click();
  await modal.waitFor({ state: 'visible' });
  await modal.locator('#person-edit-ref').fill('SEC-OPS-42');
  const editPersonPromise = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/v1/people/${encodeURIComponent(smokePerson.subject_id)}`
  );
  await modal.getByRole('button', { name: 'Save Person' }).click();
  assert.equal((await editPersonPromise).status(), 200);
  await modal.waitFor({ state: 'detached' });
  await smokePersonRow.getByText('SEC-OPS-42').waitFor({ state: 'visible' });
  const suspendPersonPromise = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/v1/people/${encodeURIComponent(smokePerson.subject_id)}`);
  await smokePersonRow.getByRole('button', { name: 'Suspend' }).click();
  const suspendPersonResponse = await suspendPersonPromise;
  const suspendPersonBody = await suspendPersonResponse.json().catch(() => ({}));
  assert.equal(suspendPersonResponse.status(), 200, `Expected Person suspension HTTP 200; got ${suspendPersonResponse.status()}: ${JSON.stringify(suspendPersonBody)}`);
  await smokePersonRow.getByRole('button', { name: 'Activate' }).waitFor({ state: 'visible' });
  const activatePersonPromise = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/v1/people/${encodeURIComponent(smokePerson.subject_id)}`);
  await smokePersonRow.getByRole('button', { name: 'Activate' }).click();
  const activatePersonResponse = await activatePersonPromise;
  const activatePersonBody = await activatePersonResponse.json().catch(() => ({}));
  assert.equal(activatePersonResponse.status(), 200, `Expected Person reactivation HTTP 200; got ${activatePersonResponse.status()}: ${JSON.stringify(activatePersonBody)}`);
  await smokePersonRow.getByRole('button', { name: 'Suspend' }).waitFor({ state: 'visible' });
  const enrollmentStartPromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === `/api/v1/people/${encodeURIComponent(smokePerson.subject_id)}/cards/enrollment-sessions`
  );
  expectingReaderOffline503 = true;
  await page.getByRole('button', { name: 'Scan on Reader' }).first().click();
  const enrollmentStart = await enrollmentStartPromise;
  const enrollmentError = await enrollmentStart.json().catch(() => ({}));
  assert.equal(enrollmentStart.status(), 503, `Expected READER_OFFLINE for the real Person ID; got ${enrollmentStart.status()}: ${JSON.stringify(enrollmentError)}`);
  assert.equal(enrollmentError.code, 'READER_OFFLINE');
  await modal.getByText(/door reader must be online/i).waitFor({ state: 'visible' });
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  expectingReaderOffline503 = false;

  // 9B. Verify Physical Credential Lifecycle UI (ASSIGNED -> BLOCKED -> REVOKED + masked_uid + PIN masking)
  assert.match(await smokePersonRow.textContent(), /None issued/);

  // Issue RFID credential -> verify masked_uid ('RFID · ••:••:C3:D4'), Assigned status, and Block + Revoke actions
  await smokePersonRow.getByRole('button', { name: '+ Credential' }).click();
  await modal.waitFor({ state: 'visible' });
  await modal.getByLabel('Card UID *').fill('a1:b2:c3:d4');
  const addRfidPromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === `/api/v1/people/${encodeURIComponent(smokePerson.subject_id)}/credentials`
  );
  await modal.getByRole('button', { name: 'Save Credential' }).click();
  const addRfidRes = await addRfidPromise;
  assert.equal(addRfidRes.status(), 201);
  const addedRfidBody = await addRfidRes.json();
  const rfidCredId = addedRfidBody.credential.credential_id;
  await modal.waitFor({ state: 'detached' });

  const rfidRow = smokePersonRow.locator(`[data-credential-id="${rfidCredId}"]`);
  await rfidRow.waitFor({ state: 'visible' });
  assert.equal(await rfidRow.getAttribute('data-credential-status'), 'ASSIGNED');
  assert.match(await rfidRow.textContent(), /RFID · ••:••:C3:D4/);
  assert.match(await rfidRow.textContent(), /Assigned/);
  assert.match(await rfidRow.textContent(), /Pending Sync/);
  assert.equal(await rfidRow.getByRole('button', { name: /Block RFID credential/i }).isVisible(), true);
  assert.equal(await rfidRow.getByRole('button', { name: /Revoke RFID credential/i }).isVisible(), true);

  // Issue PIN credential -> verify masked PIN ('PIN · ••••••'), Assigned status, zero raw PIN leak
  await smokePersonRow.getByRole('button', { name: '+ Credential' }).click();
  await modal.waitFor({ state: 'visible' });
  await modal.getByLabel('Credential Modality').selectOption('PIN');
  await modal.getByLabel('Keypad PIN *').fill('042819');
  const addPinPromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === `/api/v1/people/${encodeURIComponent(smokePerson.subject_id)}/credentials`
  );
  await modal.getByRole('button', { name: 'Save Credential' }).click();
  const addPinRes = await addPinPromise;
  assert.equal(addPinRes.status(), 201);
  const addedPinBody = await addPinRes.json();
  const pinCredId = addedPinBody.credential.credential_id;
  await modal.waitFor({ state: 'detached' });

  const pinRow = smokePersonRow.locator(`[data-credential-id="${pinCredId}"]`);
  await pinRow.waitFor({ state: 'visible' });
  assert.equal(await pinRow.getAttribute('data-credential-status'), 'ASSIGNED');
  assert.match(await pinRow.textContent(), /PIN · ••••••/);
  assert.equal((await smokePersonRow.textContent()).includes('042819'), false, 'Raw PIN must never appear in DOM');

  // Block the ASSIGNED RFID credential -> verify confirmation dialog, PUT /api/v1/credentials/:id, immediate BLOCKED state
  await rfidRow.getByRole('button', { name: /Block RFID credential/i }).click();
  await modal.waitFor({ state: 'visible' });
  assert.match(await modal.textContent(), /Block RFID · ••:••:C3:D4\?/);
  const blockRfidPromise = page.waitForResponse((response) =>
    response.request().method() === 'PUT' &&
    new URL(response.url()).pathname === `/api/v1/credentials/${encodeURIComponent(rfidCredId)}`
  );
  await modal.getByRole('button', { name: 'Block Credential' }).click();
  const blockRfidRes = await blockRfidPromise;
  assert.equal(blockRfidRes.status(), 200);
  await modal.waitFor({ state: 'detached' });
  assert.equal(await rfidRow.getAttribute('data-credential-status'), 'BLOCKED');
  assert.match(await rfidRow.textContent(), /Blocked/);
  assert.equal(await rfidRow.getByRole('button', { name: /Block RFID credential/i }).count(), 0, 'Block button must hide once BLOCKED');
  assert.equal(await rfidRow.getByRole('button', { name: /Revoke RFID credential/i }).isVisible(), true, 'Revoke remains available when BLOCKED');

  // Revoke the BLOCKED RFID credential -> verify destructive confirmation dialog, PUT /api/v1/credentials/:id, immediate REVOKED state
  await rfidRow.getByRole('button', { name: /Revoke RFID credential/i }).click();
  await modal.waitFor({ state: 'visible' });
  assert.match(await modal.textContent(), /Permanently revoke RFID · ••:••:C3:D4\?/);
  const revokeRfidPromise = page.waitForResponse((response) =>
    response.request().method() === 'PUT' &&
    new URL(response.url()).pathname === `/api/v1/credentials/${encodeURIComponent(rfidCredId)}`
  );
  await modal.getByRole('button', { name: 'Revoke Credential' }).click();
  const revokeRfidRes = await revokeRfidPromise;
  assert.equal(revokeRfidRes.status(), 200);
  await modal.waitFor({ state: 'detached' });
  assert.equal(await rfidRow.getAttribute('data-credential-status'), 'REVOKED');
  assert.match(await rfidRow.textContent(), /Revoked/);
  assert.equal(await rfidRow.getByRole('button', { name: /Block RFID credential/i }).count(), 0);
  assert.equal(await rfidRow.getByRole('button', { name: /Revoke RFID credential/i }).count(), 0, 'Revoke button must hide once REVOKED');

  // 10. Visit Diagnostics & verify release stage/adapters + WS client snapshot + Settings Retention & Display Thresholds (P1-B, P2-C & Polish)
  await page.goto(`${baseUrl}/app/diagnostics`, { waitUntil: 'networkidle' });
  await page.locator('#diag-platform-card').waitFor({ state: 'visible' });
  const diagPlatformText = await page.locator('#diag-platform-card').textContent();
  assert.match(diagPlatformText, /Extensible Adapters/);
  assert.match(diagPlatformText, /LEGACY_V1 \(Built-in\)/);
  assert.match(await page.locator('#diag-posture-card').textContent(), /8 hr/);
  // Verify Diagnostics receives final WebSocket client counts once all 3 channels are connected
  await page.locator('#diag-mqtt-ws-card').getByText('1').first().waitFor({ state: 'visible' });
  const diagWsText = await page.locator('#diag-mqtt-ws-card').textContent();
  assert.match(diagWsText, /WS Telemetry Clients1/);
  assert.match(diagWsText, /WS Notification Clients1/);
  assert.match(diagWsText, /WS MFA Clients1/);

  // Verify Overview Readiness Strip Browser Live Streams converges to Telemetry + Alerts reactively + Clickability Cues
  await page.goto(`${baseUrl}/app/overview`, { waitUntil: 'networkidle' });
  await page.locator('#overview-ws-readiness-value').getByText('Telemetry + Alerts').waitFor({ state: 'visible', timeout: 5000 });
  assert.ok(await page.locator('.kpi-card.kpi-clickable .kpi-action-cue').count() >= 4, 'Expected explicit action cues on clickable KPI cards');
  assert.ok(await page.locator('a.interactive-card.room-card').count() >= 1, 'Expected semantic clickable room cards on Overview');
  const iconBtnsMissingA11y = await page.locator('.btn-icon:visible').evaluateAll((btns) =>
    btns.filter((b) => !b.getAttribute('aria-label') || !b.getAttribute('title')).map((b) => b.outerHTML)
  );
  assert.deepEqual(iconBtnsMissingA11y, [], `Visible .btn-icon missing aria-label or title: ${iconBtnsMissingA11y.join(' | ')}`);

  for (const route of ['/app/notifications', '/app/settings', '/app/profile']) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.app-content');
  }

  // Verify Profile password show/hide toggles for Admin (P2-C)
  await page.goto(`${baseUrl}/app/profile`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Show current password' }).click();
  assert.equal(await page.locator('#profile-current-password').getAttribute('type'), 'text');
  await page.getByRole('button', { name: 'Hide current password' }).click();
  assert.equal(await page.locator('#profile-current-password').getAttribute('type'), 'password');

  // 10B. Verify Retention Policy Editor & Display Thresholds on isolated test DB (/app/settings)
  await page.goto(`${baseUrl}/app/settings`, { waitUntil: 'networkidle' });
  const retentionCard = page.locator('#settings-retention-card');
  await retentionCard.waitFor({ state: 'visible' });
  assert.match(await retentionCard.textContent(), /Active: 90 days/);

  await page.fill('#settings-retention-days', '5');
  await page.click('#save-retention-btn');
  await retentionCard.locator('.form-error').filter({ hasText: /between 7 and 365 days/i }).waitFor({ state: 'visible' });

  await retentionCard.getByRole('button', { name: '30 days' }).click();
  await page.click('#save-retention-btn');
  await modal.waitFor({ state: 'visible' });
  assert.match(await modal.textContent(), /Reduce retention window from 90 to 30 days\?/);
  const saveRetentionPromise = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/v1/retention'
  );
  await modal.getByRole('button', { name: 'Apply 30-Day Retention' }).click();
  assert.equal((await saveRetentionPromise).status(), 200);
  await modal.waitFor({ state: 'detached' });
  await page.locator('#settings-retention-card >> text=Active: 30 days').waitFor({ state: 'visible' });

  const baselineCard = page.locator('#settings-baseline-nodes-card');
  await page.fill('#settings-gas-warning', '450');
  await page.fill('#settings-gas-critical', '400');
  await baselineCard.getByRole('button', { name: 'Save Baseline Settings' }).click();
  await baselineCard.locator('.form-error').filter({ hasText: /strictly below/i }).waitFor({ state: 'visible' });
  await page.fill('#settings-gas-warning', '260');
  await page.fill('#settings-gas-critical', '420');
  const saveBaselinePromise = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/v1/settings'
  );
  await baselineCard.getByRole('button', { name: 'Save Baseline Settings' }).click();
  assert.equal((await saveBaselinePromise).status(), 200);

  // Verify audio requires a deliberate user gesture and preference is persisted per operator.
  await page.goto(`${baseUrl}/app/notifications`, { waitUntil: 'networkidle' });
  await page.locator('#notification-audio-enable').click();
  await page.getByText('Audio is enabled for this browser session').waitFor();
  await page.locator('#notification-critical-sound').check();
  await page.getByText('Critical alert sound enabled.').waitFor();

  // 11. Toggle Dark -> Light -> Dark theme
  await page.goto(baseUrl + '/app/profile', { waitUntil: 'networkidle' });
  await page.click('#profile-theme-toggle');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light');
  await page.click('#profile-theme-toggle');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');

  // 12. Full 16-Route Responsive Matrix (1440x900, 768x1024, 390x844, 360x800) — zero horizontal overflow + mobile cards
  const overflowByViewport = {};
  const viewports = [
    { width: 1440, height: 900, label: '1440x900' },
    { width: 768, height: 1024, label: '768x1024' },
    { width: 390, height: 844, label: '390x844' },
    { width: 360, height: 800, label: '360x800' }
  ];
  const authedRoutesForMatrix = [
    '/',
    '/app/overview',
    '/app/rooms',
    '/app/rooms/room-001',
    '/app/devices',
    '/app/devices/mqtt-ui-sensor',
    '/app/devices/mqtt-ui-sensor/endpoints/temperature',
    '/app/network',
    '/app/alarms',
    '/app/notifications',
    '/app/events',
    '/app/diagnostics',
    '/app/users',
    '/app/settings',
    '/app/profile'
  ];
  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const checkPath of authedRoutesForMatrix) {
      await page.goto(`${baseUrl}${checkPath}`, { waitUntil: 'networkidle' });
      if (checkPath === '/app/network') {
        const hintVisible = await page.locator('#topology-scroll-hint').isVisible();
        if (vp.width <= 390) {
          assert.equal(hintVisible, true, `Expected topology scroll hint visible at ${vp.label}`);
        } else if (vp.width >= 1440) {
          assert.equal(hintVisible, false, `Expected topology scroll hint hidden at ${vp.label}`);
        }
      }
      if (checkPath === '/app/events' && vp.width === 360) {
        await page.getByRole('tab', { name: 'Env Telemetry' }).click();
        await page.locator('#env-telemetry-rollup-panel').waitFor({ state: 'visible' });
        const bucketAligned = await page.evaluate(() => {
          const groups = Array.from(document.querySelectorAll('#env-telemetry-rollup-panel .rollup-control-group'));
          const bucketGroup = groups.find((g) => g.textContent.includes('Bucket:'));
          if (!bucketGroup) return false;
          const lbl = bucketGroup.querySelector('span');
          const seg = bucketGroup.querySelector('[role="group"]');
          if (!lbl || !seg) return false;
          return Math.abs(lbl.getBoundingClientRect().top - seg.getBoundingClientRect().top) < 16;
        });
        assert.equal(bucketAligned, true, 'Expected Bucket label to stay on same line as its segmented controls at 360x800');
      }
      if (checkPath === '/app/users') {
        if (vp.width <= 768) {
          // Verify mobile operator card renders Promote/Delete buttons (P2-C)
          await page.locator('.adaptive-mobile-cards >> text=Promote to Admin').first().waitFor({ state: 'visible' });
        }
        await page.getByRole('tab', { name: 'Facility People & Credentials' }).click();
        await page.locator('[data-credential-status="REVOKED"]:visible').first().waitFor({ state: 'visible' });
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      overflowByViewport[`${vp.label}:${checkPath}`] = overflow;
      assert.ok(overflow <= 2, `Expected zero horizontal overflow at ${vp.label} on ${checkPath}, got ${overflow}px`);
      if (vp.width <= 768 && (checkPath === '/app/devices' || checkPath === '/app/users')) {
        const cardsVisible = await page.locator('.adaptive-mobile-cards').isVisible();
        assert.equal(cardsVisible, true, `Expected stacked mobile cards at ${vp.label} on ${checkPath}`);
      }
    }
  }

  // 13. Sign out, verify /login across all 4 viewports (16th SPA route), & verify Viewer RBAC UI gating
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${baseUrl}/app/profile`, { waitUntil: 'networkidle' });
  await page.locator('.app-content').getByRole('button', { name: 'Sign Out' }).click();
  await page.waitForURL(`${baseUrl}/login`);
  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    overflowByViewport[`${vp.label}:/login`] = overflow;
    assert.ok(overflow <= 2, `Expected zero horizontal overflow at ${vp.label} on /login, got ${overflow}px`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.fill('#login-username', 'viewer_ui');
  await page.fill('#login-password', 'Viewer-Smoke-Pass#2026');
  const viewerLoginResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/auth/login'
  );
  await page.click('#login-submit-btn');
  const viewerLoginResponse = await viewerLoginResponsePromise;
  const viewerLoginBody = await viewerLoginResponse.json().catch(() => ({}));
  assert.equal(viewerLoginResponse.status(), 200, `Viewer login failed with HTTP ${viewerLoginResponse.status()}: ${JSON.stringify(viewerLoginBody)}`);
  assert.equal(viewerLoginBody.user?.role, 'Viewer', `Expected Viewer role from server: ${JSON.stringify(viewerLoginBody.user || {})}`);
  await page.waitForURL(baseUrl + '/app/overview', { timeout: 10000 }).catch(async () => {
    const errors = await page.locator('.alert-error').allTextContents().catch(() => []);
    throw new Error(`Viewer login returned HTTP 200 but did not reach Overview. Current URL: ${page.url()}. Visible errors: ${errors.join(' | ')}`);
  });

  // Viewer must not see Users & Access or Settings in sidebar
  assert.equal(await page.getByRole('link', { name: 'Users & Access' }).count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Settings' }).count(), 0);
  // Viewer must not see Add Room button on /app/rooms
  await page.getByRole('link', { name: 'Rooms' }).click();
  await page.waitForURL(`${baseUrl}/app/rooms`);
  assert.equal(await page.locator('#add-room-btn').count(), 0);

  // Viewer on /app/devices sees Admin-only quarantine explanation banner when pending_devices > 0 (P2-B)
  await page.goto(`${baseUrl}/app/devices`, { waitUntil: 'networkidle' });
  await page.locator('#viewer-quarantine-banner').waitFor({ state: 'visible' });

  // Viewer CAN inspect Camera Events tab on /app/events (requireAuth parity, P2-A)
  await page.goto(`${baseUrl}/app/events`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Camera Events' }).click();
  await page.getByRole('cell', { name: 'emp_nadia' }).waitFor({ state: 'visible' });

  // Sign Out is part of the Profile page; verify Viewer profile credential rotation notice first (P2-C)
  await page.goto(`${baseUrl}/app/profile`, { waitUntil: 'networkidle' });
  await page.locator('#viewer-profile-credential-notice').waitFor({ state: 'visible' });
  await page.locator('.app-content').getByRole('button', { name: 'Sign Out' }).click();
  await page.waitForURL(`${baseUrl}/login`);

  // Return to Admin and verify the implemented operator deletion route.
  await page.locator('#login-username').waitFor({ state: 'visible' });
  await page.fill('#login-username', 'admin');
  await page.fill('#login-password', adminPass);
  const adminReloginPromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/auth/login'
  );
  await page.click('#login-submit-btn');
  const adminReloginRes = await adminReloginPromise;
  const adminReloginBody = await adminReloginRes.json().catch(() => ({}));
  assert.equal(adminReloginRes.status(), 200, `Admin re-login failed (${adminReloginRes.status()}): ${JSON.stringify(adminReloginBody)}`);
  await page.waitForURL(`${baseUrl}/app/overview`, { timeout: 10000 }).catch(async () => {
    const errs = await page.locator('.form-error').allTextContents().catch(() => []);
    throw new Error(`Admin re-login HTTP 200 did not reach /app/overview. URL=${page.url()} errors=${errs.join(' | ')}`);
  });
  await page.goto(`${baseUrl}/app/users`, { waitUntil: 'networkidle' });
  const viewerRow = page.locator('tr').filter({ hasText: 'viewer_ui' });
  await viewerRow.getByRole('button', { name: 'Delete' }).click();
  await modal.waitFor({ state: 'visible' });
  const deleteOperatorPromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/users/delete'
  );
  await modal.getByRole('button', { name: 'Delete Operator' }).click();
  const deleteOperatorResponse = await deleteOperatorPromise;
  const deleteOperatorBody = await deleteOperatorResponse.json().catch(() => ({}));
  assert.equal(deleteOperatorResponse.status(), 200, `Expected operator deletion HTTP 200; got ${deleteOperatorResponse.status()}: ${JSON.stringify(deleteOperatorBody)}`);
  await page.locator('tr').filter({ hasText: 'viewer_ui' }).waitFor({ state: 'detached', timeout: 5000 });

  // 14. Strict Air-Gap & Error Assertions
  assert.deepEqual(
    externalRequests,
    [],
    `External network requests detected (violates air-gap): ${externalRequests.join(', ')}`
  );
  assert.deepEqual(pageErrors, [], `Unhandled page errors: ${pageErrors.join(' | ')}`);
  assert.deepEqual(consoleErrors, [], `Console errors: ${consoleErrors.join(' | ')}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        verified_routes: [
          '/',
          '/login',
          '/app/overview',
          '/app/rooms',
          '/app/rooms/:id',
          '/app/devices',
          '/app/devices/:id',
          '/app/devices/:id/endpoints/:key',
          '/app/network',
          '/app/alarms',
          '/app/notifications',
          '/app/events',
          '/app/diagnostics',
          '/app/users',
          '/app/settings',
          '/app/profile'
        ],
        external_requests: 0,
        overflow_by_viewport: overflowByViewport,
        rbac_viewer_gated: true
      },
      null,
      2
    )
  );
} finally {
  if (browser) await browser.close();
  await ctx.stop();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
