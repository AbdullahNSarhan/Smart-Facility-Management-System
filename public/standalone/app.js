/**
 * LCI-SFM Air-Gapped Smart Facility Management — Final Production ES6 Module
 * Strictly connected to live WebSockets (ws://192.168.10.2:1880/ws/telemetry & /ws/mfa)
 * and HTTP REST APIs (http://192.168.10.2:1880/api/...).
 * Zero mock generators, zero fake fallbacks, zero console debugging clutter.
 */
import { LocalFIFOChart } from './chart.local.js';

// ============================================================================
// 1. STRICT GLOBAL VARIABLES (Node-RED Backend Contract)
// ============================================================================
export let temperature = 0;
export let humidity = 0;
export let smoke_gas_level = 0;
export let light_state = 'OFF';
export let door_state = 'CLOSED';
export let fan_relay = 'OFF';

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
const SMOKE_DANGER_THRESHOLD = 400;

let mfaCountdownTimer = null;
let mfaSecondsRemaining = 10;
let tempChartInstance = null;
let smokeChartInstance = null;
let activeAuditTable = 'access_logs';
let activityHistory = [];
let wsOnline = false;
let lastWsPingTime = '--:--:--';

// ============================================================================
// 2. LIGHT / DARK MODE TOGGLE (CSS Variables + localStorage)
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
      showToast(`Theme switched to ${next === 'dark' ? 'Dark' : 'Light'} Mode`, 'info');
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
// 3. VANILLA TOAST NOTIFICATION SYSTEM (Stacked, 3s Auto-Dismiss)
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
    <span class="tabular-nums text-secondary" style="font-size: 0.7rem;">3.0s</span>
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
// 4. BUTTON LOADING STATES (1.5s Anti-Spam Lock + Pure CSS Spinner)
// ============================================================================
export function withButtonLoading(buttonEl, actionCallback, durationMs = 1500) {
  if (!buttonEl || buttonEl.disabled) return;

  const originalHtml = buttonEl.innerHTML;
  buttonEl.disabled = true;
  buttonEl.classList.add('is-loading');

  const labelEl = buttonEl.querySelector('.btn-label');
  const labelText = labelEl ? labelEl.textContent : 'Executing';

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
// 5. COLLAPSIBLE SIDEBAR
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
    updateCameraFeedSource();
  }
}

export async function saveNodeIps(n1, n2, n3) {
  ip_node1 = n1.trim();
  ip_node2 = n2.trim();
  ip_node3 = n3.trim();
  localStorage.setItem('ip_node1', ip_node1);
  localStorage.setItem('ip_node2', ip_node2);
  localStorage.setItem('ip_node3', ip_node3);
  syncNodeIpInputs();
  updateCameraFeedSource();
  renderHeartbeatGrid();

  try {
    const res = await fetch(`http://${CENTRAL_SERVER}/api/config/nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip_node1, ip_node2, ip_node3 }),
    });
    if (!res.ok) throw new Error('HTTP status ' + res.status);
    showToast('Node IPs saved to localStorage and synced with Node-RED', 'success');
  } catch (_) {
    showToast('Saved Node IPs to localStorage (Node-RED server unreachable)', 'error');
  }
}

function syncNodeIpInputs() {
  const f1 = document.getElementById('mgmt-ip-node1');
  const f2 = document.getElementById('mgmt-ip-node2');
  const f3 = document.getElementById('mgmt-ip-node3');
  if (f1) f1.value = ip_node1;
  if (f2) f2.value = ip_node2;
  if (f3) f3.value = ip_node3;
}

function updateCameraFeedSource() {
  const imgEl = document.getElementById('biometric-camera-feed');
  if (imgEl && ip_node3) {
    imgEl.src = `http://${ip_node3}/capture?ts=${Date.now()}`;
  }
}

// ============================================================================
// 7. LIVE WEBSOCKETS (ws://192.168.10.2:1880/ws/telemetry & /ws/mfa)
// ============================================================================
export function connectWebSockets() {
  try {
    const wsTelemetry = new WebSocket(`ws://${CENTRAL_SERVER}/ws/telemetry`);
    wsTelemetry.onopen = () => {
      wsOnline = true;
      lastWsPingTime = new Date().toLocaleTimeString('en-GB', { hour12: false });
      updateConnectionIndicators();
      showToast('Connected to Node-RED Telemetry WebSocket', 'success');
    };
    wsTelemetry.onmessage = (event) => {
      wsOnline = true;
      lastWsPingTime = new Date().toLocaleTimeString('en-GB', { hour12: false });
      const payload = JSON.parse(event.data);
      handleTelemetryPayload(payload);
    };
    wsTelemetry.onerror = () => {
      wsOnline = false;
      updateConnectionIndicators();
      showToast('WebSocket connection error (ws://192.168.10.2:1880/ws/telemetry)', 'error');
    };
    wsTelemetry.onclose = () => {
      wsOnline = false;
      updateConnectionIndicators();
    };
  } catch (_) {
    wsOnline = false;
    updateConnectionIndicators();
    showToast('Unable to initialize Telemetry WebSocket', 'error');
  }

  try {
    const wsMfa = new WebSocket(`ws://${CENTRAL_SERVER}/ws/mfa`);
    wsMfa.onmessage = (event) => {
      lastWsPingTime = new Date().toLocaleTimeString('en-GB', { hour12: false });
      const payload = JSON.parse(event.data);
      handleMfaPayload(payload);
    };
    wsMfa.onerror = () => {
      showToast('MFA WebSocket connection failed (ws://192.168.10.2:1880/ws/mfa)', 'error');
    };
  } catch (_) {
    showToast('Unable to initialize MFA WebSocket', 'error');
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

  pushActivityEvent(`Telemetry update: ${temperature.toFixed(1)}°C, ${humidity.toFixed(1)}%, Gas ${smoke_gas_level} PPM`);
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
    pushActivityEvent('MFA Stage 1 Passed — Awaiting Stage 2 (10s window)');
    showToast('Stage 1 Verified — 10s Stage 2 countdown started', 'info');
  } else if (passedCount >= 2) {
    mfa_status = 'UNLOCKED';
    door_state = 'OPEN';
    clearInterval(mfaCountdownTimer);
    pushActivityEvent('2-of-3 MFA Verified — Solenoid Lock UNLOCKED');
    showToast('2-of-3 MFA Verified — Solenoid Lock UNLOCKED', 'success');
  }

  if (payload.mfa_status) {
    mfa_status = payload.mfa_status;
  }

  if (isFacePassed) {
    updateCameraFeedSource();
  }

  updateDashboardDom();
  Object.assign(window, { isFacePassed, isCardPassed, isPinPassed, mfa_status });
}

function startMfaCountdown() {
  clearInterval(mfaCountdownTimer);
  mfaSecondsRemaining = 10;
  mfaCountdownTimer = setInterval(() => {
    mfaSecondsRemaining -= 1;
    updateDashboardDom();
    if (mfaSecondsRemaining <= 0) {
      clearInterval(mfaCountdownTimer);
      isFacePassed = false;
      isCardPassed = false;
      isPinPassed = false;
      mfa_status = 'IDLE';
      pushActivityEvent('MFA Stage 2 (10s) expired — Reset to IDLE');
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
  let failed = false;

  for (const table of tables) {
    try {
      const res = await fetch(`http://${CENTRAL_SERVER}/api/logs/${table}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rows = await res.json();
      if (table === 'access_logs') access_logs = Array.isArray(rows) ? rows : [];
      if (table === 'environmental_telemetry') environmental_telemetry = Array.isArray(rows) ? rows : [];
      if (table === 'camera_events') camera_events = Array.isArray(rows) ? rows : [];
      if (table === 'system_errors') system_errors = Array.isArray(rows) ? rows : [];
    } catch (_) {
      failed = true;
    }
  }

  if (failed) {
    showToast('SQLite REST API unreachable (http://192.168.10.2:1880/api/logs/...)', 'error');
  }

  renderAuditTable();
  renderSystemErrorsTable();
  Object.assign(window, { access_logs, environmental_telemetry, camera_events, system_errors });
}

function pushActivityEvent(text) {
  const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
  activityHistory = [{ ts, text }, ...activityHistory.slice(0, 4)];
  const listEl = document.getElementById('live-activity-list');
  if (!listEl) return;
  listEl.innerHTML = activityHistory
    .map((item) => `<li class="tabular-nums">[${item.ts}] ${item.text}</li>`)
    .join('');
}

function updateConnectionIndicators() {
  const statusEl = document.getElementById('ws-sidebar-status');
  if (statusEl) {
    statusEl.textContent = wsOnline ? 'ONLINE' : 'OFFLINE';
    statusEl.className = wsOnline ? 'text-mint' : 'text-coral';
  }
  renderHeartbeatGrid();
}

function renderHeartbeatGrid() {
  const grid = document.getElementById('heartbeat-grid');
  if (!grid) return;
  const nodes = [
    { name: 'Central Node-RED Server', ip: CENTRAL_SERVER },
    { name: 'Node 1 (Access)', ip: ip_node1 || 'Unconfigured' },
    { name: 'Node 2 (Environment)', ip: ip_node2 || 'Unconfigured' },
    { name: 'Node 3 (Face Biometrics)', ip: ip_node3 || 'Unconfigured' },
  ];
  grid.innerHTML = nodes
    .map(
      (n) => `
      <div class="glass-card">
        <div class="card-label">${n.name}</div>
        <div class="${wsOnline ? 'text-mint' : 'text-coral'}" style="font-weight: 700;">
          ${wsOnline ? 'ONLINE' : 'OFFLINE'}
        </div>
        <div class="text-secondary" style="font-size: 0.75rem; margin-top: 4px;">
          IP: ${n.ip} · Last Ping: ${lastWsPingTime}
        </div>
      </div>`
    )
    .join('');
}

function renderAuditTable() {
  const tbody = document.getElementById('audit-table-body');
  if (!tbody) return;
  const query = (document.getElementById('audit-search-input')?.value || '').toLowerCase();
  const source =
    activeAuditTable === 'access_logs'
      ? access_logs
      : activeAuditTable === 'camera_events'
      ? camera_events
      : environmental_telemetry;

  const filtered = source.filter((row) => JSON.stringify(row).toLowerCase().includes(query));
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-secondary">No records in ${activeAuditTable}.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .slice(0, 15)
    .map((row) => {
      const ts = row.timestamp || '--';
      const col2 = row.user_name || row.subject_name || `Temp: ${row.temperature ?? '--'}°C`;
      const col3 = row.mfa_status || row.event_type || `Gas: ${row.smoke_gas_level ?? '--'} PPM`;
      const col4 = row.node_ip || '--';
      return `<tr><td>${ts}</td><td>${col2}</td><td>${col3}</td><td>${col4}</td></tr>`;
    })
    .join('');
}

function renderSystemErrorsTable() {
  const tbody = document.getElementById('system-errors-body');
  if (!tbody) return;
  if (system_errors.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-secondary">No system errors reported.</td></tr>`;
    return;
  }
  tbody.innerHTML = system_errors
    .map(
      (err) =>
        `<tr><td>${err.timestamp || '--'}</td><td class="text-coral">${err.error_code || '--'}</td><td>${
          err.subsystem || '--'
        }</td><td>${err.message || '--'}</td></tr>`
    )
    .join('');
}

function updateDashboardDom() {
  const isEmergency = smoke_gas_level >= SMOKE_DANGER_THRESHOLD;
  const bannerEl = document.getElementById('global-status-banner');
  const bannerTitle = document.getElementById('global-status-title');
  const bannerSmoke = document.getElementById('banner-smoke-readout');

  if (bannerEl) bannerEl.classList.toggle('emergency', isEmergency);
  if (bannerTitle) {
    bannerTitle.textContent = isEmergency
      ? 'GLOBAL FACILITY STATUS: EMERGENCY ALERT'
      : 'GLOBAL FACILITY STATUS: NORMAL OPERATION';
  }
  if (bannerSmoke) bannerSmoke.textContent = `SMOKE/GAS: ${smoke_gas_level} PPM`;

  const doorEl = document.getElementById('snap-door-state');
  const lightEl = document.getElementById('snap-light-state');
  const fanEl = document.getElementById('snap-fan-relay');
  const tempEl = document.getElementById('snap-temp');
  const humEl = document.getElementById('snap-hum');

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

  const btnFanState = document.getElementById('btn-fan-state');
  const btnLightState = document.getElementById('btn-light-state');
  if (btnFanState) btnFanState.textContent = fan_relay;
  if (btnLightState) btnLightState.textContent = light_state;

  // View 2 Access & MFA DOM
  const reedEl = document.getElementById('access-reed-state');
  const solEl = document.getElementById('access-solenoid-state');
  const mfaLabel = document.getElementById('mfa-status-label');
  const mfaBar = document.getElementById('mfa-progress-bar');
  const chkFace = document.getElementById('chk-face');
  const chkCard = document.getElementById('chk-card');
  const chkPin = document.getElementById('chk-pin');

  if (reedEl) reedEl.textContent = door_state;
  if (solEl) solEl.textContent = mfa_status === 'UNLOCKED' ? 'UNLOCKED' : 'LOCKED';
  if (mfaLabel) {
    mfaLabel.textContent =
      mfa_status === 'AWAITING_STAGE2'
        ? `mfa_status: AWAITING_STAGE2 · Countdown: ${mfaSecondsRemaining}s`
        : `mfa_status: ${mfa_status}`;
  }
  if (mfaBar) {
    const passed = [isFacePassed, isCardPassed, isPinPassed].filter(Boolean).length;
    mfaBar.style.transform = `scaleX(${Math.min(1, passed / 2)})`;
  }
  if (chkFace) chkFace.textContent = `isFacePassed: ${isFacePassed}`;
  if (chkCard) chkCard.textContent = `isCardPassed: ${isCardPassed}`;
  if (chkPin) chkPin.textContent = `isPinPassed: ${isPinPassed}`;

  // View 3 Gauges
  const gTemp = document.getElementById('gauge-temp');
  const gHum = document.getElementById('gauge-hum');
  const gSmoke = document.getElementById('gauge-smoke');
  if (gTemp) gTemp.textContent = `${temperature.toFixed(1)}°C`;
  if (gHum) gHum.textContent = `${humidity.toFixed(1)}%`;
  if (gSmoke) {
    gSmoke.textContent = `${smoke_gas_level} PPM`;
    gSmoke.className = `tabular-nums ${isEmergency ? 'text-coral' : 'text-mint'}`;
  }
}

// ============================================================================
// 9. PRODUCTION DOM BOOTSTRAP
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initCollapsibleSidebar();
  checkDynamicIpSetup();
  renderHeartbeatGrid();
  connectWebSockets();
  fetchSqliteLogs();

  // 5-second WebSocket heartbeat status refresh
  setInterval(renderHeartbeatGrid, 5000);

  const tempCanvas = document.getElementById('chart-temperature');
  if (tempCanvas) {
    tempChartInstance = new LocalFIFOChart(tempCanvas, {
      maxPoints: 30,
      label: 'Temperature',
      unit: '°C',
      color: '#60a5fa',
      minY: 0,
      maxY: 50,
    });
  }

  const smokeCanvas = document.getElementById('chart-smoke');
  if (smokeCanvas) {
    smokeChartInstance = new LocalFIFOChart(smokeCanvas, {
      maxPoints: 30,
      label: 'Smoke/Gas',
      unit: ' PPM',
      color: '#34d399',
      dangerThreshold: SMOKE_DANGER_THRESHOLD,
      minY: 0,
      maxY: 1000,
    });
  }

  // Sidebar Navigation
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

  // Audit Table Tabs & Search
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeAuditTable = btn.getAttribute('data-table') || 'access_logs';
      renderAuditTable();
    });
  });

  document.getElementById('audit-search-input')?.addEventListener('input', renderAuditTable);
  document.getElementById('btn-refresh-logs')?.addEventListener('click', fetchSqliteLogs);

  // Quick Action Buttons (1.5s Anti-Spam + Live HTTP POST)
  const btnEmergency = document.getElementById('btn-emergency-unlock');
  if (btnEmergency) {
    btnEmergency.addEventListener('click', () => {
      withButtonLoading(btnEmergency, async () => {
        try {
          const res = await fetch(`http://${CENTRAL_SERVER}/api/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'EMERGENCY_DOOR_UNLOCK', target_ip: ip_node1 }),
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          showToast('Emergency Door Unlock dispatched to Node-RED', 'success');
        } catch (_) {
          showToast('Failed to reach Node-RED for Emergency Door Unlock', 'error');
        }
      });
    });
  }

  const btnFan = document.getElementById('btn-toggle-fan');
  if (btnFan) {
    btnFan.addEventListener('click', () => {
      withButtonLoading(btnFan, async () => {
        const nextFan = fan_relay === 'ON' ? 'OFF' : 'ON';
        try {
          const res = await fetch(`http://${CENTRAL_SERVER}/api/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'TOGGLE_HVAC_FAN', fan_relay: nextFan, target_ip: ip_node2 }),
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          fan_relay = nextFan;
          showToast(`HVAC Fan Relay switched ${fan_relay}`, 'success');
        } catch (_) {
          showToast('Failed to reach Node-RED for HVAC Fan command', 'error');
        }
      });
    });
  }

  const btnLight = document.getElementById('btn-toggle-light');
  if (btnLight) {
    btnLight.addEventListener('click', () => {
      withButtonLoading(btnLight, async () => {
        const nextLight = light_state === 'ON' ? 'OFF' : 'ON';
        try {
          const res = await fetch(`http://${CENTRAL_SERVER}/api/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'TOGGLE_AUX_LIGHT', light_state: nextLight, target_ip: ip_node2 }),
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          light_state = nextLight;
          showToast(`Auxiliary Light switched ${light_state}`, 'success');
        } catch (_) {
          showToast('Failed to reach Node-RED for Aux Light command', 'error');
        }
      });
    });
  }

  // Startup & Management Node IP Forms
  document.getElementById('startup-ip-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const n1 = document.getElementById('input-ip-node1')?.value || '';
    const n2 = document.getElementById('input-ip-node2')?.value || '';
    const n3 = document.getElementById('input-ip-node3')?.value || '';
    saveNodeIps(n1, n2, n3);
    document.getElementById('startup-ip-modal')?.classList.add('hidden');
  });

  document.getElementById('node-ip-update-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const n1 = document.getElementById('mgmt-ip-node1')?.value || '';
    const n2 = document.getElementById('mgmt-ip-node2')?.value || '';
    const n3 = document.getElementById('mgmt-ip-node3')?.value || '';
    saveNodeIps(n1, n2, n3);
  });

  document.getElementById('user-provision-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('prov-username')?.value || '';
    const rfid = document.getElementById('prov-rfid')?.value || '';
    const face = document.getElementById('prov-face')?.value || '';
    try {
      const res = await fetch(`http://${CENTRAL_SERVER}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, rfid_uid: rfid, face_template_id: face }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      showToast(`Operator "${username}" provisioned on Node-RED`, 'success');
      e.target.reset();
    } catch (_) {
      showToast('Failed to provision user: Node-RED backend offline', 'error');
    }
  });

  document.getElementById('open-ip-modal-btn')?.addEventListener('click', () => {
    document.getElementById('startup-ip-modal')?.classList.remove('hidden');
  });
});
