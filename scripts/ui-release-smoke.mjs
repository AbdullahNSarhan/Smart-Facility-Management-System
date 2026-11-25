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
  SIMULATOR_ENABLED: 'true',
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

  const consoleErrors = [];
  const pageErrors = [];
  const externalRequests = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const txt = msg.text();
      if (/status of 401 \(Unauthorized\)/.test(txt) && msg.location()?.url?.includes('/api/auth/session')) {
        return;
      }
      consoleErrors.push(txt);
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(String(err?.message || err));
  });
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return;
    try {
      const origin = new URL(url).origin;
      if (origin !== allowedOrigin) {
        externalRequests.push(url);
      }
    } catch {
      // ignore non-URL schemes
    }
  });

  // 1. Local Landing Page (/) & Air-Gap posture
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  assert.match(await page.locator('h1').textContent(), /Local-First Infrastructure Control/i);
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');

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

  // 4. Create a dynamic room via UI modal and verify deep-link reload
  await page.click('#add-room-btn');
  const modal = page.locator('#active-modal-backdrop');
  await modal.waitFor({ state: 'visible' });
  await modal.locator('input[placeholder="e.g. LAB-102"]').fill('LAB-305');
  await modal.locator('input[placeholder="e.g. Server Rack Room"]').fill('Automation Test Lab');
  await modal.getByRole('button', { name: 'Create Room' }).click();
  await page.waitForSelector('text=LAB-305');

  // Deep-link reload test on /app/rooms
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('text=LAB-305');

  // Open Room Detail page (/app/rooms/:roomId)
  await page.locator('table tbody tr', { hasText: 'LAB-305' }).getByRole('button', { name: 'Open' }).click();
  await page.waitForURL(/\/app\/rooms\/.+/);
  await page.waitForSelector('text=Automation Test Lab');

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

  // Step 2: Transport — reject values outside the server's 5–3600 second range.
  await modal.locator('#wiz-device-transport').waitFor({ state: 'visible' });
  await modal.locator('#wiz-device-stale').fill('3601');
  await modal.getByRole('button', { name: 'Continue' }).click();
  await modal.getByText(/between 5 and 3600 seconds/).waitFor({ state: 'visible' });
  await modal.locator('#wiz-device-stale').fill('3600');
  await modal.getByRole('button', { name: 'Continue' }).click();

  // Step 3: Endpoints — reject keys that the backend schema cannot accept.
  const endpointKeyInput = modal.locator('.endpoint-editor-row input').first();
  await endpointKeyInput.fill('1temperature');
  await modal.getByRole('button', { name: 'Continue' }).click();
  await modal.getByText(/Invalid endpoint key/).waitFor({ state: 'visible' });
  await endpointKeyInput.fill('temperature');
  await modal.getByRole('button', { name: 'Continue' }).click();

  // Step 4: Review & Register
  await modal.locator('text=Broker-mediated (no direct IP)').waitFor({ state: 'visible' });
  await modal.getByRole('button', { name: 'Register Device' }).click();
  await page.waitForSelector('text=UI MQTT Sensor');

  // Inspect Device Detail (/app/devices/mqtt-ui-sensor) -> verify Generic Endpoint Widget & MQTT CLI
  await page.locator('table tbody tr', { hasText: 'UI MQTT Sensor' }).getByRole('button', { name: 'Inspect' }).click();
  await page.waitForURL(`${baseUrl}/app/devices/mqtt-ui-sensor`);
  await page.waitForSelector('.widget-card');
  await page.waitForSelector('text=provision-mqtt-device.sh add mqtt-ui-sensor');

  // Navigate to Endpoint History and switch time preset
  await page.getByRole('button', { name: 'History →' }).first().click();
  await page.waitForURL(`${baseUrl}/app/devices/mqtt-ui-sensor/endpoints/temperature`);
  await page.getByRole('button', { name: '24h' }).click();
  await page.waitForSelector('.history-chart-svg');

  // 6. Interactive Network & Connectivity Topology (/app/network)
  await page.getByRole('link', { name: 'Network' }).click();
  await page.waitForURL(`${baseUrl}/app/network`);
  await page.waitForSelector('.topology-svg');
  await page.locator('[data-topo-node-id="dev:mqtt-ui-sensor"]').click();
  await page.waitForSelector('#network-node-inspector >> text=UI MQTT Sensor');

  // 7. Alarms & Rules — create a deterministic sensor rule matching ruleSchema
  await page.getByRole('link', { name: 'Alarms & Rules' }).click();
  await page.waitForURL(`${baseUrl}/app/alarms`);
  await page.click('#create-rule-btn');
  await modal.waitFor({ state: 'visible' });
  await modal.locator('input[placeholder="e.g. High Rack Temperature"]').fill('UI Smoke Temp Alert');
  await modal.getByRole('button', { name: 'Create Rule' }).click();
  await page.getByRole('tab', { name: 'Monitoring Rules' }).click();
  await page.waitForSelector('text=UI Smoke Temp Alert');

  // 8. Events & Audit Logs + Slide-Over Detail Drawer
  await page.getByRole('link', { name: 'Events & Audit' }).click();
  await page.waitForURL(`${baseUrl}/app/events`);
  assert.equal(await page.getByRole('tab', { name: 'Admin Audit' }).count(), 0, 'Do not expose an unimplemented admin_audit log table');
  await page.getByRole('tab', { name: 'Management Audit' }).click();
  await page.waitForSelector('table tbody tr');
  await page.locator('table tbody tr').first().getByRole('button', { name: 'Inspect' }).click();
  await page.waitForSelector('#active-drawer-backdrop');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#active-drawer-backdrop', { state: 'detached' });

  // 9. Separated Users & Access Tabs (Operators + Facility People via /api/v1/people)
  await page.getByRole('link', { name: 'Users & Access' }).click();
  await page.waitForURL(`${baseUrl}/app/users`);
  await page.waitForSelector('text=viewer_ui');
  await page.getByRole('tab', { name: 'Facility People & Credentials' }).click();
  await page.waitForSelector('text=Physical Credential Policy Boundary');
  await page.getByRole('button', { name: 'Add Account / Person' }).click();
  await modal.waitFor({ state: 'visible' });
  await modal.locator('input').first().fill('Reader UI Smoke Person');
  await modal.getByRole('button', { name: 'Add Person' }).click();
  await page.getByText('Reader UI Smoke Person').waitFor();
  await page.getByRole('button', { name: 'Scan on Reader' }).first().click();
  await modal.getByText(/door reader must be online/i).waitFor({ state: 'visible' });
  await modal.getByRole('button', { name: 'Close' }).click();

  // 10. Visit remaining core routes & verify zero errors
  for (const route of ['/app/overview', '/app/notifications', '/app/diagnostics', '/app/settings', '/app/profile']) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.app-content');
  }

  // 11. Toggle Dark -> Light -> Dark theme
  await page.click('#profile-theme-toggle');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light');
  await page.click('#profile-theme-toggle');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');

  // 12. Responsive matrix checks (1440, 768, 390, 360px) — zero horizontal overflow + mobile cards visible
  const overflowByViewport = {};
  for (const vp of [
    { width: 1440, height: 900, label: '1440x900' },
    { width: 768, height: 1024, label: '768x1024' },
    { width: 390, height: 844, label: '390x844' },
    { width: 360, height: 800, label: '360x800' }
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${baseUrl}/app/devices`, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    overflowByViewport[vp.label] = overflow;
    assert.ok(overflow <= 2, `Expected zero horizontal overflow at ${vp.label}, got ${overflow}px`);
    if (vp.width <= 768) {
      const cardsVisible = await page.locator('.adaptive-mobile-cards').isVisible();
      assert.equal(cardsVisible, true, `Expected stacked mobile cards at ${vp.label}`);
    }
  }

  // 13. Sign out & verify Viewer RBAC UI gating
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${baseUrl}/app/profile`, { waitUntil: 'networkidle' });
  await page.locator('.app-content').getByRole('button', { name: 'Sign Out' }).click();
  await page.waitForURL(`${baseUrl}/login`);

  await page.fill('#login-username', 'viewer_ui');
  await page.fill('#login-password', 'Viewer-Smoke-Pass#2026');
  await page.click('#login-submit-btn');
  await page.waitForURL(`${baseUrl}/app/overview`);

  // Viewer must not see Users & Access or Settings in sidebar
  assert.equal(await page.getByRole('link', { name: 'Users & Access' }).count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Settings' }).count(), 0);
  // Viewer must not see Add Room button on /app/rooms
  await page.getByRole('link', { name: 'Rooms' }).click();
  await page.waitForURL(`${baseUrl}/app/rooms`);
  assert.equal(await page.locator('#add-room-btn').count(), 0);

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
