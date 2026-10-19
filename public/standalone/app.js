/**
 * LCI-SFM Air-Gapped Smart Facility Management — Modular Vanilla ES6 Logic
 * Strict Global Variable & JSON Naming per Node-RED Specification
 */
import { LocalFIFOChart } from './chart.local.js';

// ============================================================================
// 1. STRICT GLOBAL VARIABLES (Node-RED Backend Contract)
// ============================================================================
export let temperature = 22.4;
export let humidity = 46.0;
export let smoke_gas_level = 118;
export let light_state = 'ON';
export let door_state = 'CLOSED';
export let fan_relay = 'ON';

export let isFacePassed = false;
export let isCardPassed = false;
export let isPinPassed = false;
export let mfa_status = 'IDLE'; // "IDLE" | "AWAITING_STAGE2" | "UNLOCKED"

export let access_logs = [];
export let environmental_telemetry = [];
export let camera_events = [];
export let system_errors = [];

export let ip_node1 = localStorage.getItem('ip_node1') || '';
export let ip_node2 = localStorage.getItem('ip_node2') || '';
export let ip_node3 = localStorage.getItem('ip_node3') || '';

const CENTRAL_SERVER = '192.168.10.2:1880';
let mfaCountdownTimer = null;
let mfaSecondsRemaining = 10;

// ============================================================================
// 2. DYNAMIC IP CONFIGURATION (Startup Modal & LocalStorage)
// ============================================================================
export function checkDynamicIpSetup() {
  ip_node1 = localStorage.getItem('ip_node1') || '';
  ip_node2 = localStorage.getItem('ip_node2') || '';
  ip_node3 = localStorage.getItem('ip_node3') || '';

  const modal = document.getElementById('startup-ip-modal');
  if (!ip_node1 || !ip_node2 || !ip_node3) {
    if (modal) modal.classList.remove('hidden');
  } else {
    if (modal) modal.classList.add('hidden');
    syncNodeIpInputs();
  }
}

export function saveNodeIps(n1, n2, n3) {
  ip_node1 = n1.trim();
  ip_node2 = n2.trim();
  ip_node3 = n3.trim();
  localStorage.setItem('ip_node1', ip_node1);
  localStorage.setItem('ip_node2', ip_node2);
  localStorage.setItem('ip_node3', ip_node3);

  fetch(`http://${CENTRAL_SERVER}/api/config/nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip_node1, ip_node2, ip_node3 })
  }).catch(() => {});
}

function syncNodeIpInputs() {
  const f1 = document.getElementById('mgmt-ip-node1');
  const f2 = document.getElementById('mgmt-ip-node2');
  const f3 = document.getElementById('mgmt-ip-node3');
  if (f1) f1.value = ip_node1;
  if (f2) f2.value = ip_node2;
  if (f3) f3.value = ip_node3;
}

// ============================================================================
// 3. WEBSOCKET REAL-TIME STREAMS (ws://192.168.10.2:1880/ws/telemetry & /ws/mfa)
// ============================================================================
export function connectWebSockets() {
  try {
    const wsTelemetry = new WebSocket(`ws://${CENTRAL_SERVER}/ws/telemetry`);
    wsTelemetry.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      handleTelemetryPayload(payload);
    };
  } catch (e) {
    console.warn('Telemetry WebSocket unreachable in current subnet', e);
  }

  try {
    const wsMfa = new WebSocket(`ws://${CENTRAL_SERVER}/ws/mfa`);
    wsMfa.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      handleMfaPayload(payload);
    };
  } catch (e) {
    console.warn('MFA WebSocket unreachable in current subnet', e);
  }
}

export function handleTelemetryPayload(payload) {
  if (typeof payload.temperature === 'number') temperature = payload.temperature;
  if (typeof payload.humidity === 'number') humidity = payload.humidity;
  if (typeof payload.smoke_gas_level === 'number') smoke_gas_level = payload.smoke_gas_level;
  if (payload.light_state) light_state = payload.light_state;
  if (payload.door_state) door_state = payload.door_state;
  if (payload.fan_relay) fan_relay = payload.fan_relay;

  Object.assign(window, {
    temperature,
    humidity,
    smoke_gas_level,
    light_state,
    door_state,
    fan_relay
  });
}

export function handleMfaPayload(payload) {
  if (typeof payload.isFacePassed === 'boolean') isFacePassed = payload.isFacePassed;
  if (typeof payload.isCardPassed === 'boolean') isCardPassed = payload.isCardPassed;
  if (typeof payload.isPinPassed === 'boolean') isPinPassed = payload.isPinPassed;

  const passedCount = [isFacePassed, isCardPassed, isPinPassed].filter(Boolean).length;
  if (passedCount === 0) {
    mfa_status = 'IDLE';
    clearInterval(mfaCountdownTimer);
  } else if (passedCount === 1) {
    mfa_status = 'AWAITING_STAGE2';
    startMfaCountdown();
  } else if (passedCount >= 2) {
    mfa_status = 'UNLOCKED';
    door_state = 'OPEN';
    clearInterval(mfaCountdownTimer);
  }

  if (payload.mfa_status) {
    mfa_status = payload.mfa_status;
  }

  // Trigger camera frame fetch from ip_node3 when face scan or motion occurs
  if (isFacePassed && ip_node3) {
    const imgEl = document.getElementById('biometric-camera-feed');
    if (imgEl) {
      imgEl.src = `http://${ip_node3}/capture?ts=${Date.now()}`;
    }
  }

  Object.assign(window, { isFacePassed, isCardPassed, isPinPassed, mfa_status });
}

function startMfaCountdown() {
  clearInterval(mfaCountdownTimer);
  mfaSecondsRemaining = 10;
  mfaCountdownTimer = setInterval(() => {
    mfaSecondsRemaining -= 1;
    if (mfaSecondsRemaining <= 0) {
      clearInterval(mfaCountdownTimer);
      isFacePassed = false;
      isCardPassed = false;
      isPinPassed = false;
      mfa_status = 'IDLE';
    }
  }, 1000);
}

// ============================================================================
// 4. HISTORICAL SQLITE REST API INTEGRATION (GET http://192.168.10.2:1880/api/logs/...)
// ============================================================================
export async function fetchSqliteLogs() {
  const tables = ['access_logs', 'environmental_telemetry', 'camera_events', 'system_errors'];
  for (const table of tables) {
    try {
      const res = await fetch(`http://${CENTRAL_SERVER}/api/logs/${table}`);
      if (res.ok) {
        const rows = await res.json();
        if (table === 'access_logs') access_logs = rows;
        if (table === 'environmental_telemetry') environmental_telemetry = rows;
        if (table === 'camera_events') camera_events = rows;
        if (table === 'system_errors') system_errors = rows;
      }
    } catch (_) {
      // Air-gapped offline fallback retained
    }
  }
}
