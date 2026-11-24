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
  const provRes = await fetch(`${baseUrl}/api/provision/user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie,
      'X-CSRF-Token': adminLoginJson.csrfToken
    },
    body: JSON.stringify({
      username: 'viewer_ui',
      password: 'Viewer-Smoke-Pass#2026',
      role: 'Viewer',
      rfid: 'AA:BB:CC:DD',
      pin: '123456',
      face_linked: false
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
  const context = await browser.newContext({ viewport: { width: 1366, height: 860 } });
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

  // 3. Sign in as Admin -> lands on redirected /app/rooms
  await page.fill('#login-username', 'admin');
  await page.fill('#login-password', adminPass);
  await page.click('#login-submit-btn');
  await page.waitForURL(`${baseUrl}/app/rooms`);
  await page.waitForSelector('#create-room-btn');

  // 4. Create a dynamic room via UI modal and verify deep-link reload
  await page.click('#create-room-btn');
  const modal = page.locator('#active-modal-backdrop');
  await modal.waitFor({ state: 'visible' });
  await modal.locator('input[placeholder="e.g. LAB-201"]').fill('LAB-305');
  await modal.locator('input[placeholder="e.g. Server Room West"]').fill('Automation Test Lab');
  await modal.getByRole('button', { name: 'Create Room' }).click();
  await page.waitForSelector('text=LAB-305');

  // Deep-link reload test on /app/rooms
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('text=LAB-305');

  // Open Room Detail page (/app/rooms/:roomId)
  await page.getByRole('button', { name: 'LAB-305' }).click();
  await page.waitForURL(/\/app\/rooms\/.+/);
  await page.waitForSelector('text=Automation Test Lab');

  // 5. Navigate to Devices (/app/devices) and register an MQTT_V1 device WITHOUT an IP
  await page.getByRole('link', { name: 'Devices' }).click();
  await page.waitForURL(`${baseUrl}/app/devices`);
  await page.click('#register-device-btn');
  await modal.waitFor({ state: 'visible' });
  await modal.locator('input[placeholder="e.g. env-lab-201"]').fill('mqtt-ui-sensor');
  await modal.locator('input[placeholder="e.g. Lab 201 Environmental Sensor"]').fill('UI MQTT Sensor');
  await modal.getByRole('button', { name: 'Register Device' }).click();
  await page.waitForSelector('text=UI MQTT Sensor');

  // Inspect Device Detail (/app/devices/mqtt-ui-sensor) -> verify Generic Endpoint Widget renders
  await page.getByRole('button', { name: 'UI MQTT Sensor' }).click();
  await page.waitForURL(`${baseUrl}/app/devices/mqtt-ui-sensor`);
  await page.waitForSelector('.endpoint-widget');
  await page.waitForSelector('text=provision-mqtt-device.sh add mqtt-ui-sensor');

  // 6. Visit remaining core routes & verify zero errors
  for (const route of [
    '/app/overview',
    '/app/alarms',
    '/app/notifications',
    '/app/events',
    '/app/diagnostics',
    '/app/users',
    '/app/settings',
    '/app/profile'
  ]) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.app-content');
  }

  // 7. Toggle Dark -> Light -> Dark theme
  await page.getByRole('button', { name: 'Switch Light / Dark Theme' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light');
  await page.getByRole('button', { name: 'Switch Light / Dark Theme' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');

  // 8. Mobile 390px responsiveness check (no horizontal overflow)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/app/overview`, { waitUntil: 'networkidle' });
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  assert.ok(mobileOverflow <= 2, `Expected zero horizontal overflow at 390px, got ${mobileOverflow}px`);

  // 9. Sign out & verify Viewer RBAC UI gating
  await page.setViewportSize({ width: 1366, height: 860 });
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
  // Viewer must not see Create Room button on /app/rooms
  await page.getByRole('link', { name: 'Rooms' }).click();
  await page.waitForURL(`${baseUrl}/app/rooms`);
  assert.equal(await page.locator('#create-room-btn').count(), 0);

  // 10. Strict Air-Gap & Error Assertions
  assert.deepEqual(externalRequests, [], `External network requests detected (violates air-gap): ${externalRequests.join(', ')}`);
  assert.deepEqual(pageErrors, [], `Unhandled page errors: ${pageErrors.join(' | ')}`);
  assert.deepEqual(consoleErrors, [], `Console errors: ${consoleErrors.join(' | ')}`);

  console.log(JSON.stringify({
    ok: true,
    verified_routes: ['/', '/login', '/app/overview', '/app/rooms', '/app/rooms/:id', '/app/devices', '/app/devices/:id', '/app/alarms', '/app/notifications', '/app/events', '/app/diagnostics', '/app/users', '/app/settings', '/app/profile'],
    external_requests: 0,
    mobile_overflow_px: mobileOverflow,
    rbac_viewer_gated: true
  }, null, 2));
} finally {
  if (browser) await browser.close();
  await ctx.stop();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
