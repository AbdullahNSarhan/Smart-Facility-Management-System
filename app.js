/**
 * LCI-SFM Air-Gapped Dashboard Application Logic (ES6 Standalone Module)
 * - Strictly 3-File Architecture (Chart Engine Embedded)
 * - Backend Server IP: 192.168.43.225:1880
 * - Strict Variable & Table Naming for Node-RED & SQLite Integration
 */

// ============================================================================
// 0. EMBEDDED AIR-GAPPED 30-POINT FIFO SLIDING WINDOW CHART ENGINE
// ============================================================================

export class LocalFIFOChart {
  constructor(canvas, config = {}) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.maxPoints = config.maxPoints || 30;
    this.label = config.label || 'Telemetry';
    this.unit = config.unit || '';
    this.color = config.color || '#60a5fa';
    this.dangerThreshold = config.dangerThreshold ?? null;
    this.minY = config.minY ?? config.min ?? 0;
    this.maxY = config.maxY ?? config.max ?? 100;
    this.labels = [];
    this.data = [];
    this.render();
  }

  pushValue(timestampLabel, numericValue) {
    this.pushDataPoint(timestampLabel, numericValue);
  }

  pushDataPoint(timestampLabel, numericValue) {
    if (this.labels.length >= this.maxPoints) {
      this.labels.shift();
    }
    if (this.data.length >= this.maxPoints) {
      this.data.shift();
    }
    this.labels.push(timestampLabel);
    this.data.push(Number(numericValue));
    this.render();
  }

  draw() {
    this.render();
  }

  render() {
    if (!this.ctx || !this.canvas) return;

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.canvas.width = Math.floor(rect.width);
      this.canvas.height = Math.floor(rect.height);
    }

    const width = this.canvas.width || 540;
    const height = this.canvas.height || 230;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const padLeft = 50;
    const padRight = 18;
    const padTop = 18;
    const padBottom = 28;
    const plotW = Math.max(80, width - padLeft - padRight);
    const plotH = Math.max(60, height - padTop - padBottom);

    ctx.strokeStyle = isLight ? 'rgba(100, 116, 139, 0.15)' : 'rgba(148, 163, 184, 0.12)';
    ctx.lineWidth = 1;
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = isLight ? '#475569' : '#94a3b8';

    for (let i = 0; i <= 4; i++) {
      const ratio = i / 4;
      const y = padTop + plotH - ratio * plotH;
      const val = (this.minY + ratio * (this.maxY - this.minY)).toFixed(0);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.fillText(`${val}${this.unit}`, 6, y + 4);
    }

    if (this.dangerThreshold !== null) {
      const dRatio = Math.min(1, Math.max(0, (this.dangerThreshold - this.minY) / (this.maxY - this.minY)));
      const dy = padTop + plotH - dRatio * plotH;
      ctx.save();
      ctx.strokeStyle = 'rgba(251, 113, 133, 0.75)';
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(padLeft, dy);
      ctx.lineTo(width - padRight, dy);
      ctx.stroke();
      ctx.fillStyle = isLight ? '#e11d48' : '#fb7185';
      ctx.fillText(`ALARM ≥ ${this.dangerThreshold}${this.unit}`, width - 140, dy - 6);
      ctx.restore();
    }

    if (this.data.length === 0) {
      ctx.fillStyle = isLight ? '#64748b' : '#94a3b8';
      ctx.fillText('Awaiting live stream (ws://192.168.43.225:1880/ws/telemetry)...', padLeft + 14, padTop + plotH / 2);
      return;
    }

    const points = this.data.map((val, idx) => {
      const x = padLeft + (idx / Math.max(1, this.maxPoints - 1)) * plotW;
      const clamped = Math.min(this.maxY, Math.max(this.minY, val));
      const y = padTop + plotH - ((clamped - this.minY) / (this.maxY - this.minY)) * plotH;
      return { x, y, val, label: this.labels[idx] || '' };
    });

    if (points.length >= 2) {
      const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
      grad.addColorStop(0, `${this.color}38`);
      grad.addColorStop(1, `${this.color}02`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(points[0].x, padTop + plotH);
      points.forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.lineTo(points[points.length - 1].x, padTop + plotH);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      points.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }

    points.forEach((p, idx) => {
      const isDanger = this.dangerThreshold !== null && p.val >= this.dangerThreshold;
      ctx.fillStyle = isDanger ? '#fb7185' : this.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, idx === points.length - 1 ? 4 : 2.2, 0, Math.PI * 2);
      ctx.fill();

      if (idx === 0 || idx === Math.floor(points.length / 2) || idx === points.length - 1) {
        ctx.fillStyle = '#64748b';
        ctx.fillText(p.label, Math.max(padLeft, p.x - 22), height - 8);
      }
    });
  }
}

// ============================================================================
// 1. STRICT GLOBAL VARIABLES (Matching Node-RED Backend Keys)
// ============================================================================

// Environment Telemetry
export let temperature = 0.0;
export let humidity = 0.0;
export let smoke_gas_level = 0;
export let light_state = "OFF"; // "ON" | "OFF"
export let door_state = "CLOSED"; // "OPEN" | "CLOSED"
export let fan_relay = "OFF"; // "ON" | "OFF"

// MFA Tracker
export let isFacePassed = false;
export let isCardPassed = false;
export let isPinPassed = false;
export let mfa_status = "IDLE"; // "IDLE" | "AWAITING_STAGE2" | "UNLOCKED"

// Database Tables
export let access_logs = [];
export let environmental_telemetry = [];
export let camera_events = [];
export let system_errors = [];

// Dynamic Node IPs
export let ip_node1 = localStorage.getItem('ip_node1') || '';
export let ip_node2 = localStorage.getItem('ip_node2') || '';
export let ip_node3 = localStorage.getItem('ip_node3') || '';

// Expose variables globally on window for direct Node-RED / browser inspection
window.LCI_STATE = {
  get temperature() { return temperature; },
  get humidity() { return humidity; },
  get smoke_gas_level() { return smoke_gas_level; },
  get light_state() { return light_state; },
  get door_state() { return door_state; },
  get fan_relay() { return fan_relay; },
  get isFacePassed() { return isFacePassed; },
  get isCardPassed() { return isCardPassed; },
  get isPinPassed() { return isPinPassed; },
  get mfa_status() { return mfa_status; },
  get access_logs() { return access_logs; },
  get environmental_telemetry() { return environmental_telemetry; },
  get camera_events() { return camera_events; },
  get system_errors() { return system_errors; },
  get ip_node1() { return ip_node1; },
  get ip_node2() { return ip_node2; },
  get ip_node3() { return ip_node3; }
};

// Updated Node-RED Server IP: 192.168.43.225
const NODE_RED_HTTP = 'http://192.168.43.225:1880';
const WS_TELEMETRY_URL = 'ws://192.168.43.225:1880/ws/telemetry';
const WS_MFA_URL = 'ws://192.168.43.225:1880/ws/mfa';

let activeDbTable = 'access_logs';
let activityFeed = [];
let mfaCountdownInterval = null;
let mfaRemainingSeconds = 10;
let lastWsHeartbeat = 0;

let tempChart = null;
let humChart = null;

// ============================================================================
// 2. VANILLA TOAST NOTIFICATION SYSTEM (Stacked, 3-Second Auto-Dismiss)
// ============================================================================

export function showToast(title, message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;
  toast.innerHTML = `
    <div class="toast-title">${title}</div>
    <div class="toast-msg">${message}</div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-Out');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 240);
  }, 3000);
}

// ============================================================================
// 3. LIGHT / DARK THEME TOGGLE & COLLAPSIBLE SIDEBAR
// ============================================================================

function initThemeAndSidebar() {
  const savedTheme = localStorage.getItem('lci_theme') || 'dark';
  applyTheme(savedTheme);

  const themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      localStorage.setItem('lci_theme', next);
      showToast('Theme Updated', `Switched to ${next.toUpperCase()} UI mode`, 'info');
    });
  }

  const sidebar = document.getElementById('sidebar');
  const mainShell = document.getElementById('main-shell');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const isCollapsed = localStorage.getItem('lci_sidebar_collapsed') === 'true';

  if (isCollapsed && sidebar && mainShell) {
    sidebar.classList.add('collapsed');
    mainShell.classList.add('expanded');
  }

  if (toggleBtn && sidebar && mainShell) {
    toggleBtn.addEventListener('click', () => {
      const collapsed = sidebar.classList.toggle('collapsed');
      mainShell.classList.toggle('expanded', collapsed);
      localStorage.setItem('lci_sidebar_collapsed', String(collapsed));

      setTimeout(() => {
        if (tempChart) tempChart.draw();
        if (humChart) humChart.draw();
      }, 280);
    });
  }

  window.addEventListener('resize', () => {
    if (tempChart) tempChart.draw();
    if (humChart) humChart.draw();
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const sunIcon = document.getElementById('theme-icon-sun');
  const moonIcon = document.getElementById('theme-icon-moon');
  if (sunIcon && moonIcon) {
    if (theme === 'light') {
      sunIcon.classList.remove('hidden');
      moonIcon.classList.add('hidden');
    } else {
      sunIcon.classList.add('hidden');
      moonIcon.classList.remove('hidden');
    }
  }
  if (tempChart) tempChart.draw();
  if (humChart) humChart.draw();
}

// ============================================================================
// 4. BUTTON LOADING STATES (1.5-Second Anti-Spam Lock + Pure CSS Spinner)
// ============================================================================

function withButtonLoading(buttonEl, actionCallback) {
  if (!buttonEl || buttonEl.disabled) return;

  const originalHtml = buttonEl.innerHTML;
  buttonEl.disabled = true;
  buttonEl.innerHTML = `<span class="css-spinner" aria-hidden="true"></span><span>Processing...</span>`;

  try {
    actionCallback();
  } finally {
    setTimeout(() => {
      buttonEl.disabled = false;
      buttonEl.innerHTML = originalHtml;
    }, 1500);
  }
}

// ============================================================================
// 5. DYNAMIC IP CONFIGURATION MODAL & LOCALSTORAGE
// ============================================================================

function checkNodeIPsOnStartup() {
  const modal = document.getElementById('startup-modal');
  if (!ip_node1 || !ip_node2 || !ip_node3) {
    modal.classList.remove('hidden');
    document.getElementById('modal_ip_node1').value = ip_node1 || '192.168.43.11';
    document.getElementById('modal_ip_node2').value = ip_node2 || '192.168.43.12';
    document.getElementById('modal_ip_node3').value = ip_node3 || '192.168.43.13';
  } else {
    syncIPInputs();
  }
}

function saveNodeIPs(n1, n2, n3) {
  ip_node1 = n1.trim();
  ip_node2 = n2.trim();
  ip_node3 = n3.trim();
  localStorage.setItem('ip_node1', ip_node1);
  localStorage.setItem('ip_node2', ip_node2);
  localStorage.setItem('ip_node3', ip_node3);
  syncIPInputs();
  showToast('Endpoints Saved', `Configured Nodes: ${ip_node1}, ${ip_node2}, ${ip_node3}`, 'success');
}

function syncIPInputs() {
  document.getElementById('set_ip_node1').value = ip_node1;
  document.getElementById('set_ip_node2').value = ip_node2;
  document.getElementById('set_ip_node3').value = ip_node3;
  document.getElementById('hb-ip-node1').textContent = ip_node1;
  document.getElementById('hb-ip-node2').textContent = ip_node2;
  document.getElementById('hb-ip-node3').textContent = ip_node3;
  document.getElementById('cam-endpoint-label').textContent = `http://${ip_node3}/capture.jpg`;
}

function refreshCameraSnapshot() {
  const img = document.getElementById('biometric-camera-img');
  const fallback = document.getElementById('camera-fallback-overlay');
  const fallbackText = document.getElementById('camera-fallback-text');
  if (!img || !ip_node3) return;

  img.onload = () => {
    img.classList.remove('hidden');
    if (fallback) fallback.classList.add('hidden');
  };

  img.onerror = () => {
    img.classList.add('hidden');
    if (fallback) fallback.classList.remove('hidden');
    if (fallbackText) {
      fallbackText.textContent = `Node 3 (${ip_node3}) camera stream offline or unreachable.`;
    }
  };

  img.src = `http://${ip_node3}/capture.jpg?t=${Date.now()}`;
}

// ============================================================================
// 6. TELEMETRY & MFA PARSING LOGIC (Strict Variable Names)
// ============================================================================

function updateCircularGauge(arcId, value, maxVal) {
  const arc = document.getElementById(arcId);
  if (!arc) return;
  const circumference = 314.16; // 2 * Math.PI * 50
  const clamped = Math.max(0, Math.min(maxVal, value));
  const offset = circumference - (clamped / maxVal) * circumference;
  arc.style.strokeDashoffset = offset.toFixed(2);
}

export function handleTelemetryPayload(payload) {
  lastWsHeartbeat = Date.now();

  if (typeof payload.temperature === 'number') temperature = payload.temperature;
  if (typeof payload.humidity === 'number') humidity = payload.humidity;
  if (typeof payload.smoke_gas_level === 'number') smoke_gas_level = payload.smoke_gas_level;
  if (payload.light_state === 'ON' || payload.light_state === 'OFF') light_state = payload.light_state;
  if (payload.door_state === 'OPEN' || payload.door_state === 'CLOSED') door_state = payload.door_state;
  if (payload.fan_relay === 'ON' || payload.fan_relay === 'OFF') fan_relay = payload.fan_relay;

  // Update View 1 Snapshot
  const snapDoor = document.getElementById('snap-door');
  snapDoor.textContent = door_state;
  snapDoor.className = `card-value tabular-nums ${door_state === 'CLOSED' ? 'text-mint' : 'text-rose'}`;

  const snapLight = document.getElementById('snap-light');
  snapLight.textContent = light_state;
  snapLight.className = `card-value tabular-nums ${light_state === 'ON' ? 'text-mint' : 'text-rose'}`;

  const snapFan = document.getElementById('snap-fan');
  snapFan.textContent = fan_relay;
  snapFan.className = `card-value tabular-nums ${fan_relay === 'ON' ? 'text-mint' : 'text-cyber'}`;

  document.getElementById('snap-temp').textContent = `${temperature.toFixed(1)} °C`;
  document.getElementById('snap-hum').textContent = `${humidity.toFixed(1)} %`;
  document.getElementById('banner-smoke-val').textContent = `${smoke_gas_level} PPM`;

  // Global Status Banner
  const banner = document.getElementById('global-status-banner');
  const bannerTitle = document.getElementById('global-status-title');
  const isEmergency = smoke_gas_level >= 400;
  if (isEmergency) {
    banner.className = 'status-banner emergency';
    bannerTitle.textContent = `Emergency Alert — High Smoke/Gas Detected (${smoke_gas_level} PPM)`;
  } else {
    banner.className = 'status-banner normal';
    bannerTitle.textContent = 'Normal Operations — All Thresholds Nominal';
  }

  // Update View 2 Hardware States
  const reedEl = document.getElementById('access-reed-state');
  reedEl.textContent = door_state === 'CLOSED' ? 'CLOSED (ENGAGED)' : 'OPEN (SEPARATED)';
  reedEl.className = `hw-state ${door_state === 'CLOSED' ? 'text-mint' : 'text-rose'}`;

  const solenoidEl = document.getElementById('access-solenoid-state');
  solenoidEl.textContent = door_state === 'CLOSED' ? 'ENERGIZED (LOCKED)' : 'DE-ENERGIZED (UNLOCKED)';
  solenoidEl.className = `hw-state ${door_state === 'CLOSED' ? 'text-mint' : 'text-rose'}`;

  // Update View 3 Circular Gauges & Charts
  document.getElementById('env-temp-val').textContent = `${temperature.toFixed(1)} °C`;
  document.getElementById('env-hum-val').textContent = `${humidity.toFixed(1)} %`;

  const smokeValEl = document.getElementById('env-smoke-val');
  smokeValEl.textContent = `${smoke_gas_level} PPM`;
  smokeValEl.className = `gauge-num tabular-nums ${isEmergency ? 'text-rose' : 'text-mint'}`;

  const smokeArc = document.getElementById('gauge-arc-smoke');
  if (smokeArc) {
    smokeArc.setAttribute('class', `gauge-arc ${isEmergency ? 'stroke-rose' : 'stroke-mint'}`);
  }

  updateCircularGauge('gauge-arc-temp', temperature, 50);
  updateCircularGauge('gauge-arc-hum', humidity, 100);
  updateCircularGauge('gauge-arc-smoke', smoke_gas_level, 800);

  const timeLabel = new Date().toLocaleTimeString();
  if (tempChart) tempChart.pushValue(timeLabel, temperature);
  if (humChart) humChart.pushValue(timeLabel, humidity);
}

export function handleMFAPayload(payload) {
  lastWsHeartbeat = Date.now();

  if (typeof payload.isFacePassed === 'boolean') isFacePassed = payload.isFacePassed;
  if (typeof payload.isCardPassed === 'boolean') isCardPassed = payload.isCardPassed;
  if (typeof payload.isPinPassed === 'boolean') isPinPassed = payload.isPinPassed;
  if (payload.mfa_status) mfa_status = payload.mfa_status;

  const passedCount = [isFacePassed, isCardPassed, isPinPassed].filter(Boolean).length;
  if (!payload.mfa_status) {
    if (passedCount >= 2) mfa_status = 'UNLOCKED';
    else if (passedCount === 1) mfa_status = 'AWAITING_STAGE2';
    else mfa_status = 'IDLE';
  }

  if (mfa_status === 'UNLOCKED') {
    door_state = 'OPEN';
    stopMfaCountdown();
    pushActivityEvent('MFA UNLOCKED (2-of-3 Verified) — Solenoid Released');
    showToast('Access Granted', '2-out-of-3 MFA completed. Solenoid unlocked.', 'success');
  } else if (mfa_status === 'AWAITING_STAGE2') {
    startMfaCountdown();
    pushActivityEvent('MFA Stage 1 Passed — Awaiting Stage 2 (10s window)');
    showToast('MFA Stage 1 Passed', 'Provide a second factor within 10 seconds.', 'info');
  } else {
    stopMfaCountdown();
  }

  renderMFAUI();
}

function renderMFAUI() {
  const passedCount = [isFacePassed, isCardPassed, isPinPassed].filter(Boolean).length;
  const pct = Math.min(100, (passedCount / 2) * 100);
  document.getElementById('mfa-progress-fill').style.width = `${pct}%`;

  const statusLabel = document.getElementById('mfa-status-label');
  statusLabel.textContent = mfa_status;
  statusLabel.className = mfa_status === 'UNLOCKED' ? 'text-mint' : 'text-cyber';

  const cpFace = document.getElementById('cp-face');
  cpFace.className = `checkpoint ${isFacePassed ? 'passed' : ''}`;
  cpFace.querySelector('.cp-var').textContent = `isFacePassed: ${isFacePassed}`;

  const cpCard = document.getElementById('cp-card');
  cpCard.className = `checkpoint ${isCardPassed ? 'passed' : ''}`;
  cpCard.querySelector('.cp-var').textContent = `isCardPassed: ${isCardPassed}`;

  const cpPin = document.getElementById('cp-pin');
  cpPin.className = `checkpoint ${isPinPassed ? 'passed' : ''}`;
  cpPin.querySelector('.cp-var').textContent = `isPinPassed: ${isPinPassed}`;
}

function startMfaCountdown() {
  stopMfaCountdown();
  mfaRemainingSeconds = 10;
  document.getElementById('mfa-timer-label').textContent = `${mfaRemainingSeconds}s`;

  mfaCountdownInterval = setInterval(() => {
    mfaRemainingSeconds -= 1;
    document.getElementById('mfa-timer-label').textContent = `${mfaRemainingSeconds}s`;
    if (mfaRemainingSeconds <= 0) {
      stopMfaCountdown();
      isFacePassed = false;
      isCardPassed = false;
      isPinPassed = false;
      mfa_status = 'IDLE';
      renderMFAUI();
      pushActivityEvent('MFA Timeout — Stage 2 window expired');
      showToast('MFA Window Expired', 'Stage-2 timeout reached. Checkpoints reset.', 'error');
    }
  }, 1000);
}

function stopMfaCountdown() {
  if (mfaCountdownInterval) {
    clearInterval(mfaCountdownInterval);
    mfaCountdownInterval = null;
  }
  document.getElementById('mfa-timer-label').textContent = '10s';
}

function pushActivityEvent(text) {
  const time = new Date().toLocaleTimeString();
  activityFeed.unshift({ time, text });
  activityFeed = activityFeed.slice(0, 5);

  const ul = document.getElementById('live-activity-list');
  if (!ul) return;
  ul.innerHTML = activityFeed
    .map(item => `<li><span>${item.text}</span><code class="text-cyber">${item.time}</code></li>`)
    .join('');
}

// ============================================================================
// 7. WEBSOCKET CLIENTS & SQLITE REST FETCH (192.168.43.225:1880)
// ============================================================================

function connectWebSockets() {
  try {
    const wsTel = new WebSocket(WS_TELEMETRY_URL);
    wsTel.onopen = () => {
      document.getElementById('ws-telemetry-dot').className = 'dot dot-green';
      document.getElementById('ws-telemetry-status').textContent = 'ONLINE';
      showToast('Telemetry Stream Connected', WS_TELEMETRY_URL, 'success');
    };
    wsTel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleTelemetryPayload(data);
      } catch {
        showToast('Telemetry Parse Error', 'Malformed JSON frame received.', 'error');
      }
    };
    wsTel.onerror = () => {
      document.getElementById('ws-telemetry-dot').className = 'dot dot-red';
      document.getElementById('ws-telemetry-status').textContent = 'OFFLINE';
    };
    wsTel.onclose = () => {
      document.getElementById('ws-telemetry-dot').className = 'dot dot-red';
      document.getElementById('ws-telemetry-status').textContent = 'OFFLINE';
    };
  } catch {
    document.getElementById('ws-telemetry-status').textContent = 'OFFLINE';
  }

  try {
    const wsMfa = new WebSocket(WS_MFA_URL);
    wsMfa.onopen = () => {
      document.getElementById('ws-mfa-dot').className = 'dot dot-green';
      document.getElementById('ws-mfa-status').textContent = 'ONLINE';
    };
    wsMfa.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleMFAPayload(data);
      } catch {
        showToast('MFA Stream Error', 'Malformed MFA JSON payload.', 'error');
      }
    };
    wsMfa.onerror = () => {
      document.getElementById('ws-mfa-dot').className = 'dot dot-red';
      document.getElementById('ws-mfa-status').textContent = 'OFFLINE';
    };
    wsMfa.onclose = () => {
      document.getElementById('ws-mfa-dot').className = 'dot dot-red';
      document.getElementById('ws-mfa-status').textContent = 'OFFLINE';
    };
  } catch {
    document.getElementById('ws-mfa-status').textContent = 'OFFLINE';
  }
}

async function fetchSQLiteLogs(tableName) {
  try {
    const res = await fetch(`${NODE_RED_HTTP}/api/logs/${tableName}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();

    if (tableName === 'access_logs') access_logs = Array.isArray(rows) ? rows : [];
    if (tableName === 'camera_events') camera_events = Array.isArray(rows) ? rows : [];
    if (tableName === 'environmental_telemetry') environmental_telemetry = Array.isArray(rows) ? rows : [];
    if (tableName === 'system_errors') system_errors = Array.isArray(rows) ? rows : [];
  } catch {
    showToast('Database Unreachable', `Could not fetch /api/logs/${tableName} from ${NODE_RED_HTTP}.`, 'error');
  }
  renderDatabaseTable();
  renderSystemErrors();
}

function renderDatabaseTable() {
  const thead = document.getElementById('db-table-head');
  const tbody = document.getElementById('db-table-body');
  const query = (document.getElementById('db-search-input')?.value || '').toLowerCase();

  let dataset = access_logs;
  if (activeDbTable === 'camera_events') dataset = camera_events;
  if (activeDbTable === 'environmental_telemetry') dataset = environmental_telemetry;

  const filtered = dataset.filter(row =>
    Object.values(row).some(v => String(v).toLowerCase().includes(query))
  );

  if (filtered.length === 0) {
    thead.innerHTML = '<tr><th>Status</th></tr>';
    tbody.innerHTML = `<tr><td>No records available in <code>${activeDbTable}</code>. Connect to Node-RED SQLite endpoint (<code>${NODE_RED_HTTP}</code>) to populate.</td></tr>`;
    return;
  }

  const columns = Object.keys(filtered[0]);
  thead.innerHTML = `<tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr>`;
  tbody.innerHTML = filtered
    .map(row => `<tr>${columns.map(c => `<td>${row[c]}</td>`).join('')}</tr>`)
    .join('');
}

function renderSystemErrors() {
  const tbody = document.getElementById('system-errors-body');
  if (!tbody) return;
  if (system_errors.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">No system errors logged or database offline.</td></tr>';
    return;
  }
  tbody.innerHTML = system_errors
    .map(err => `
      <tr>
        <td>#${err.id}</td>
        <td>${err.timestamp}</td>
        <td><code>${err.node}</code></td>
        <td><span class="text-rose">${err.severity}</span></td>
        <td>${err.message}</td>
      </tr>
    `)
    .join('');
}

async function sendCommand(command, targetState) {
  pushActivityEvent(`Command Sent: ${command} -> ${targetState}`);
  try {
    const response = await fetch(`${NODE_RED_HTTP}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, state: targetState, ip_node1, ip_node2, ip_node3 })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    showToast('Command Executed', `${command} set to ${targetState}`, 'success');
  } catch {
    showToast('Command Failed', `Node-RED (${NODE_RED_HTTP}) unreachable for ${command}`, 'error');
  }
}

// ============================================================================
// 8. 5-SECOND HEARTBEAT WATCHDOG
// ============================================================================

function startHeartbeatMonitor() {
  setInterval(() => {
    const isOnline = (Date.now() - lastWsHeartbeat) <= 5000;
    const ids = ['hb-server', 'hb-node1', 'hb-node2', 'hb-node3'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.className = `hb-pill ${isOnline ? 'online' : 'offline'}`;
      el.textContent = isOnline ? 'ONLINE (<5s)' : 'OFFLINE (>5s)';
    });
  }, 1000);
}

// ============================================================================
// 9. INITIALIZATION & UI EVENT LISTENERS
// ============================================================================

window.addEventListener('DOMContentLoaded', () => {
  const tempCanvas = document.getElementById('temp-chart-canvas');
  const humCanvas = document.getElementById('hum-chart-canvas');
  if (tempCanvas) tempChart = new LocalFIFOChart(tempCanvas, { color: '#60a5fa', min: 0, max: 50, unit: '°C' });
  if (humCanvas) humChart = new LocalFIFOChart(humCanvas, { color: '#34d399', min: 0, max: 100, unit: '%' });

  initThemeAndSidebar();
  checkNodeIPsOnStartup();
  renderMFAUI();

  // Sidebar View Navigation
  const viewTitles = {
    'view-1': 'Main Command Center (Executive Overview)',
    'view-2': 'Smart Access & Biometrics',
    'view-3': 'Environmental Monitoring',
    'view-4': 'Audit Logs & Database Explorer',
    'view-5': 'System Health & Diagnostics',
    'view-6': 'System Management & Provisioning'
  };

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      const viewId = btn.getAttribute('data-view');
      document.getElementById(viewId).classList.add('active');
      document.getElementById('current-view-title').textContent = viewTitles[viewId] || 'LCI-SFM';
      if (viewId === 'view-3') {
        requestAnimationFrame(() => {
          if (tempChart) tempChart.draw();
          if (humChart) humChart.draw();
        });
      }
    });
  });

  // Startup Modal Form
  document.getElementById('startup-ip-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveNodeIPs(
      document.getElementById('modal_ip_node1').value,
      document.getElementById('modal_ip_node2').value,
      document.getElementById('modal_ip_node3').value
    );
    document.getElementById('startup-modal').classList.add('hidden');
  });

  document.getElementById('open-ip-modal-btn').addEventListener('click', () => {
    document.getElementById('startup-modal').classList.remove('hidden');
  });

  // View 6 IP Settings Form
  document.getElementById('settings-ip-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveNodeIPs(
      document.getElementById('set_ip_node1').value,
      document.getElementById('set_ip_node2').value,
      document.getElementById('set_ip_node3').value
    );
  });

  // View 6 User Provisioning Form
  document.getElementById('user-provision-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('prov_name').value.trim();
    const rfid = document.getElementById('prov_rfid').value.trim();
    const pin = document.getElementById('prov_pin').value.trim();

    try {
      const res = await fetch(`${NODE_RED_HTTP}/api/provision/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, rfid, pin })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      pushActivityEvent(`Provisioned User: ${name} (RFID: ${rfid})`);
      showToast('User Provisioned', `${name} registered in SQLite access control.`, 'success');
      e.target.reset();
    } catch {
      showToast('Provisioning Failed', `Unable to reach Node-RED (${NODE_RED_HTTP}) provisioning endpoint.`, 'error');
    }
  });

  // Quick Action Buttons with 1.5s Anti-Spam Spinner
  const btnUnlockDoor = document.getElementById('cmd-unlock-door');
  btnUnlockDoor.addEventListener('click', () => {
    withButtonLoading(btnUnlockDoor, () => {
      const next = door_state === 'OPEN' ? 'CLOSED' : 'OPEN';
      sendCommand('EMERGENCY_DOOR_UNLOCK', next);
    });
  });

  const btnToggleFan = document.getElementById('cmd-toggle-fan');
  btnToggleFan.addEventListener('click', () => {
    withButtonLoading(btnToggleFan, () => {
      const next = fan_relay === 'ON' ? 'OFF' : 'ON';
      sendCommand('TOGGLE_HVAC_FAN', next);
    });
  });

  const btnToggleLight = document.getElementById('cmd-toggle-light');
  btnToggleLight.addEventListener('click', () => {
    withButtonLoading(btnToggleLight, () => {
      const next = light_state === 'ON' ? 'OFF' : 'ON';
      sendCommand('TOGGLE_AUX_LIGHT', next);
    });
  });

  // Camera Refresh
  document.getElementById('refresh-cam-btn').addEventListener('click', () => {
    refreshCameraSnapshot();
    showToast('Camera Frame Requested', `Pulling snapshot from http://${ip_node3}/capture.jpg`, 'info');
  });

  // View 3 Override Mode Buttons
  const autoBtn = document.getElementById('mode-auto-btn');
  const manualBtn = document.getElementById('mode-manual-btn');
  autoBtn.addEventListener('click', () => {
    autoBtn.className = 'btn-mint';
    manualBtn.className = 'btn-outline';
    sendCommand('SET_CONTROL_MODE', 'AUTO');
  });
  manualBtn.addEventListener('click', () => {
    manualBtn.className = 'btn-cyber';
    autoBtn.className = 'btn-outline';
    sendCommand('SET_CONTROL_MODE', 'MANUAL');
  });

  // View 4 Database Tabs & Search
  document.querySelectorAll('.tab-btn').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeDbTable = tab.getAttribute('data-table');
      fetchSQLiteLogs(activeDbTable);
    });
  });

  document.getElementById('db-search-input').addEventListener('input', renderDatabaseTable);
  document.getElementById('db-refresh-btn').addEventListener('click', () => {
    fetchSQLiteLogs(activeDbTable);
  });

  document.getElementById('refresh-errors-btn').addEventListener('click', () => {
    fetchSQLiteLogs('system_errors');
  });

  // Connect strictly to live WebSockets and SQLite REST endpoints at 192.168.43.225:1880
  connectWebSockets();
  fetchSQLiteLogs('access_logs');
  fetchSQLiteLogs('system_errors');
  startHeartbeatMonitor();
});
