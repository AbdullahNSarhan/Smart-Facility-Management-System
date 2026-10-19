/**
 * LCI-SFM Air-Gapped Smart Facility Management — Modular Vanilla ES6 Logic
 * Includes:
 * 1. Light/Dark Theme Toggle with localStorage persistence
 * 2. Soft/Muted Color Palette (Soft Mint, Soft Coral, Slate Blue-Gray)
 * 3. Vanilla Toast Notification System (Stacked, 3-second auto-dismiss)
 * 4. Anti-Spam Quick Action Buttons (1.5-second disabled + CSS loading spinner)
 * 5. Collapsible Sidebar with smooth layout & chart expansion
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
let tempChartInstance = null;
let smokeChartInstance = null;

// ============================================================================
// 2. FEATURE 1: LIGHT / DARK MODE TOGGLE (CSS Variables + localStorage)
// ============================================================================
export function initThemeToggle() {
  const savedTheme = localStorage.getItem('lci_theme') || 'dark';
  applyTheme(savedTheme);

  const toggleBtn = document.getElementById('theme-toggle-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      localStorage.setItem('lci_theme', next);
      showToast(`Switched to ${next === 'dark' ? 'Dark' : 'Light'} Mode`, 'info');
    });
  }
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const iconEl = document.getElementById('theme-toggle-icon');
  const textEl = document.getElementById('theme-toggle-text');
  if (iconEl) iconEl.textContent = theme === 'dark' ? '☀' : '☾';
  if (textEl) textEl.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
}

// ============================================================================
// 3. FEATURE 3: VANILLA TOAST NOTIFICATION SYSTEM (Stacked, 3s Auto-Dismiss)
// ============================================================================
export function showToast(message, type = 'info', durationMs = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;

  const indicatorColor =
    type === 'success'
      ? 'var(--soft-mint)'
      : type === 'error'
      ? 'var(--soft-coral)'
      : 'var(--soft-blue)';

  toast.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px;">
      <span style="width: 8px; height: 8px; border-radius: 50%; background: ${indicatorColor}; flex-shrink: 0;"></span>
      <span>${message}</span>
    </div>
    <span class="tabular-nums" style="font-size: 0.7rem; color: var(--text-secondary);">3.0s</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 220);
  }, durationMs);
}

// ============================================================================
// 4. FEATURE 4: BUTTON LOADING STATES (1.5s Anti-Spam + Pure CSS Spinner)
// ============================================================================
export function withButtonLoading(buttonEl, actionCallback, durationMs = 1500) {
  if (!buttonEl || buttonEl.disabled) return;

  const originalHtml = buttonEl.innerHTML;
  buttonEl.disabled = true;
  buttonEl.classList.add('is-loading');

  const labelEl = buttonEl.querySelector('.btn-label');
  const labelText = labelEl ? labelEl.textContent : 'Processing';

  buttonEl.innerHTML = `
    <span style="display: inline-flex; align-items: center; gap: 8px;">
      <span class="css-spinner" aria-hidden="true"></span>
      <span>${labelText}...</span>
    </span>
    <span class="tabular-nums" style="font-size: 0.75rem;">1.5s LOCK</span>
  `;

  setTimeout(async () => {
    try {
      await actionCallback();
    } finally {
      buttonEl.disabled = false;
      buttonEl.classList.remove('is-loading');
      buttonEl.innerHTML = originalHtml;
      updateDashboardDom();
    }
  }, durationMs);
}

// ============================================================================
// 5. FEATURE 5: COLLAPSIBLE SIDEBAR (Smooth Content & Chart Expansion)
// ============================================================================
export function initCollapsibleSidebar() {
  const sidebar = document.getElementById('app-sidebar');
  const mainShell = document.getElementById('main-shell');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const toggleLabel = document.getElementById('sidebar-toggle-label');

  const savedCollapsed = localStorage.getItem('lci_sidebar_collapsed') === 'true';
  if (savedCollapsed && sidebar && mainShell) {
    sidebar.classList.add('collapsed');
    mainShell.classList.add('expanded');
    if (toggleLabel) toggleLabel.textContent = 'Expand Menu';
  }

  if (toggleBtn && sidebar && mainShell) {
    toggleBtn.addEventListener('click', () => {
      const isCollapsed = sidebar.classList.toggle('collapsed');
      mainShell.classList.toggle('expanded', isCollapsed);
      localStorage.setItem('lci_sidebar_collapsed', String(isCollapsed));
      if (toggleLabel) {
        toggleLabel.textContent = isCollapsed ? 'Expand Menu' : 'Collapse Menu';
      }
      // Redraw charts after sidebar transition so canvas fills expanded width
      setTimeout(() => {
        if (tempChartInstance) tempChartInstance.render();
        if (smokeChartInstance) smokeChartInstance.render();
      }, 220);
    });
  }
}

// ============================================================================
// 6. DYNAMIC IP CONFIGURATION (Startup Modal & localStorage)
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
  syncNodeIpInputs();

  fetch(`http://${CENTRAL_SERVER}/api/config/nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip_node1, ip_node2, ip_node3 }),
  }).catch(() => {});

  showToast(`Saved Node IPs (${ip_node1}, ${ip_node2}, ${ip_node3})`, 'success');
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
// 7. WEBSOCKET REAL-TIME STREAMS (ws://192.168.10.2:1880/ws/telemetry & /ws/mfa)
// ============================================================================
export function connectWebSockets() {
  try {
    const wsTelemetry = new WebSocket(`ws://${CENTRAL_SERVER}/ws/telemetry`);
    wsTelemetry.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      handleTelemetryPayload(payload);
    };
  } catch (_) {
    // Fallback to local air-gapped state when offline
  }

  try {
    const wsMfa = new WebSocket(`ws://${CENTRAL_SERVER}/ws/mfa`);
    wsMfa.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      handleMfaPayload(payload);
    };
  } catch (_) {
    // Fallback to local air-gapped state when offline
  }
}

export function handleTelemetryPayload(payload) {
  if (typeof payload.temperature === 'number') temperature = payload.temperature;
  if (typeof payload.humidity === 'number') humidity = payload.humidity;
  if (typeof payload.smoke_gas_level === 'number') smoke_gas_level = payload.smoke_gas_level;
  if (payload.light_state) light_state = payload.light_state;
  if (payload.door_state) door_state = payload.door_state;
  if (payload.fan_relay) fan_relay = payload.fan_relay;

  const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
  if (tempChartInstance) tempChartInstance.pushDataPoint(ts, temperature);
  if (smokeChartInstance) smokeChartInstance.pushDataPoint(ts, smoke_gas_level);

  updateDashboardDom();
  Object.assign(window, {
    temperature,
    humidity,
    smoke_gas_level,
    light_state,
    door_state,
    fan_relay,
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
    showToast('Stage 1 Verified — 10s Stage 2 countdown started', 'info');
  } else if (passedCount >= 2) {
    mfa_status = 'UNLOCKED';
    door_state = 'OPEN';
    clearInterval(mfaCountdownTimer);
    showToast('2-of-3 MFA Passed — Solenoid Lock UNLOCKED', 'success');
  }

  if (payload.mfa_status) {
    mfa_status = payload.mfa_status;
  }

  if (isFacePassed && ip_node3) {
    const imgEl = document.getElementById('biometric-camera-feed');
    if (imgEl) {
      imgEl.src = `http://${ip_node3}/capture?ts=${Date.now()}`;
    }
  }

  updateDashboardDom();
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
      showToast('MFA Stage 2 (10s) expired — Reset to IDLE', 'error');
      updateDashboardDom();
    }
  }, 1000);
}

// ============================================================================
// 8. HISTORICAL SQLITE REST API INTEGRATION (GET http://192.168.10.2:1880/api/logs/...)
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
      // Offline air-gapped state preserved
    }
  }
}

function updateDashboardDom() {
  const doorEl = document.getElementById('snap-door-state');
  const lightEl = document.getElementById('snap-light-state');
  const fanEl = document.getElementById('snap-fan-relay');
  const tempEl = document.getElementById('snap-temp');
  const humEl = document.getElementById('snap-hum');
  const btnFanState = document.getElementById('btn-fan-state');
  const btnLightState = document.getElementById('btn-light-state');

  if (doorEl) {
    doorEl.textContent = door_state;
    doorEl.className = `tabular-nums ${door_state === 'CLOSED' ? 'text-mint' : 'text-coral'}`;
  }
  if (lightEl) {
    lightEl.textContent = light_state;
    lightEl.className = `tabular-nums ${light_state === 'ON' ? 'text-mint' : 'text-coral'}`;
  }
  if (fanEl) {
    fanEl.textContent = fan_relay;
    fanEl.className = `tabular-nums ${fan_relay === 'ON' ? 'text-mint' : 'text-coral'}`;
  }
  if (tempEl) tempEl.textContent = `${temperature.toFixed(1)}°C`;
  if (humEl) humEl.textContent = `${humidity.toFixed(1)}%`;
  if (btnFanState) btnFanState.textContent = fan_relay;
  if (btnLightState) btnLightState.textContent = light_state;
}

// ============================================================================
// 9. DOM BOOTSTRAP & EVENT WIRING
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initCollapsibleSidebar();
  checkDynamicIpSetup();
  connectWebSockets();
  fetchSqliteLogs();

  // Initialize Soft UI Charts (Soft Blue & Soft Mint)
  const tempCanvas = document.getElementById('chart-temperature');
  if (tempCanvas) {
    tempChartInstance = new LocalFIFOChart(tempCanvas, {
      maxPoints: 30,
      label: 'Temperature',
      unit: '°C',
      color: '#60a5fa',
      minY: 10,
      maxY: 45,
      initialLabels: ['05:00', '05:01', '05:02', '05:03'],
      initialData: [22.1, 22.3, 22.5, 22.4],
    });
  }

  const smokeCanvas = document.getElementById('chart-smoke');
  if (smokeCanvas) {
    smokeChartInstance = new LocalFIFOChart(smokeCanvas, {
      maxPoints: 30,
      label: 'Smoke/Gas',
      unit: ' PPM',
      color: '#34d399',
      dangerThreshold: 400,
      minY: 0,
      maxY: 700,
      initialLabels: ['05:00', '05:01', '05:02', '05:03'],
      initialData: [115, 118, 120, 118],
    });
  }

  // Sidebar View Switching
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.view-container').forEach((v) => v.classList.remove('active'));
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-view');
      const viewEl = targetId ? document.getElementById(targetId) : null;
      if (viewEl) viewEl.classList.add('active');
    });
  });

  // Feature 4: Anti-Spam Quick Action Buttons with 1.5s Spinner + Toast Feedback
  const btnEmergency = document.getElementById('btn-emergency-unlock');
  if (btnEmergency) {
    btnEmergency.addEventListener('click', () => {
      withButtonLoading(btnEmergency, async () => {
        door_state = 'OPEN';
        mfa_status = 'UNLOCKED';
        await fetch(`http://${CENTRAL_SERVER}/api/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'EMERGENCY_DOOR_UNLOCK', target_ip: ip_node1 }),
        }).catch(() => {});
        showToast(`Emergency Door Unlock dispatched to Node 1 (${ip_node1 || '192.168.10.11'})`, 'error');
      });
    });
  }

  const btnFan = document.getElementById('btn-toggle-fan');
  if (btnFan) {
    btnFan.addEventListener('click', () => {
      withButtonLoading(btnFan, async () => {
        fan_relay = fan_relay === 'ON' ? 'OFF' : 'ON';
        await fetch(`http://${CENTRAL_SERVER}/api/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'TOGGLE_HVAC_FAN', fan_relay, target_ip: ip_node2 }),
        }).catch(() => {});
        showToast(`HVAC Fan Relay switched ${fan_relay}`, fan_relay === 'ON' ? 'success' : 'info');
      });
    });
  }

  const btnLight = document.getElementById('btn-toggle-light');
  if (btnLight) {
    btnLight.addEventListener('click', () => {
      withButtonLoading(btnLight, async () => {
        light_state = light_state === 'ON' ? 'OFF' : 'ON';
        await fetch(`http://${CENTRAL_SERVER}/api/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'TOGGLE_AUX_LIGHT', light_state, target_ip: ip_node2 }),
        }).catch(() => {});
        showToast(`Auxiliary Light switched ${light_state}`, light_state === 'ON' ? 'success' : 'info');
      });
    });
  }

  // Startup IP Modal Submission
  const startupForm = document.getElementById('startup-ip-form');
  if (startupForm) {
    startupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const n1 = document.getElementById('input-ip-node1')?.value || '192.168.10.11';
      const n2 = document.getElementById('input-ip-node2')?.value || '192.168.10.12';
      const n3 = document.getElementById('input-ip-node3')?.value || '192.168.10.13';
      saveNodeIps(n1, n2, n3);
      document.getElementById('startup-ip-modal')?.classList.add('hidden');
    });
  }

  const openModalBtn = document.getElementById('open-ip-modal-btn');
  if (openModalBtn) {
    openModalBtn.addEventListener('click', () => {
      document.getElementById('startup-ip-modal')?.classList.remove('hidden');
    });
  }
});
