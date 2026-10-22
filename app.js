/**
 * LCI-SFM Air-Gapped Dashboard Application Logic (ES6 Standalone Module)
 * - Strictly 3-File Architecture (Chart Engine Embedded)
 * - Backend Server IP: 192.168.43.225:1880 (Node-RED + SQLite3 /home/ubuntu/lci_sfm.db)
 * - Real SQLite Authentication (POST /api/auth/login), Dynamic system_users Table (GET /api/logs/system_users),
 *   and Secure User Provisioning (POST /api/provision/user)
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
    this.labels.push(String(timestampLabel));
    this.data.push(Number(numericValue));
    this.render();
  }

  reset() {
    this.labels = [];
    this.data = [];
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
      ctx.fillText('Offline / Awaiting stream (ws://192.168.43.225:1880/ws/telemetry)...', padLeft + 14, padTop + plotH / 2);
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
// 1. SECURITY, INPUT SANITIZATION & STRICT DATA TYPE VALIDATION
// ============================================================================

const IPV4_REGEX = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const RFID_HEX_REGEX = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){3,7}$/;
const PIN_SIX_DIGIT_REGEX = /^\d{6}$/;
const SAFE_NAME_REGEX = /^[A-Za-z0-9 ._,'-]{2,64}$/;
const ALLOWED_COMMANDS = new Set([
  'EMERGENCY_DOOR_UNLOCK',
  'TOGGLE_HVAC_FAN',
  'TOGGLE_AUX_LIGHT',
  'SET_CONTROL_MODE'
]);
const ALLOWED_COMMAND_STATES = new Set(['OPEN', 'CLOSED', 'ON', 'OFF', 'AUTO', 'MANUAL']);

export function sanitizeInput(rawValue) {
  if (typeof rawValue !== 'string') return '';
  return rawValue
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]*>?/gm, '')
    .replace(/['";`\\]|--|\/\*|\*\//g, '')
    .replace(/\b(DROP|UNION|SELECT|INSERT|DELETE|UPDATE|ALTER|EXEC|CAST)\b/gi, '')
    .trim();
}

export function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isValidIPv4(ip) {
  return IPV4_REGEX.test(String(ip).trim());
}

export function isValidHexRFID(rfid) {
  return RFID_HEX_REGEX.test(String(rfid).trim());
}

export function isValidSixDigitPin(pinStr) {
  const cleaned = String(pinStr).trim();
  if (!PIN_SIX_DIGIT_REGEX.test(cleaned)) return false;
  const num = Number(cleaned);
  return Number.isInteger(num) && num >= 0 && num <= 999999;
}

// ============================================================================
// 2. STRICT GLOBAL VARIABLES (Matching Node-RED Backend & SQLite Keys)
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

// SQLite Database Tables
export let access_logs = [];
export let environmental_telemetry = [];
export let camera_events = [];
export let system_errors = [];
export let system_users = [];

// Dynamic Node IPs
export let ip_node1 = sanitizeInput(localStorage.getItem('ip_node1') || '');
export let ip_node2 = sanitizeInput(localStorage.getItem('ip_node2') || '');
export let ip_node3 = sanitizeInput(localStorage.getItem('ip_node3') || '');

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
  get system_users() { return system_users; },
  get ip_node1() { return ip_node1; },
  get ip_node2() { return ip_node2; },
  get ip_node3() { return ip_node3; }
};

// Node-RED Server IP: 192.168.43.225
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

// Environmental Control Mode ("AUTO" | "MANUAL")
let currentControlMode = 'AUTO';

// Provisioning Face Capture State
let capturedFaceUrlForProvision = '';

// Authenticated Session & Listener Lifecycle Controller
let authSessionAbortController = null;
let wsTelemetryInstance = null;
let wsMfaInstance = null;

// ============================================================================
// 3. VANILLA TOAST NOTIFICATION SYSTEM WITH "CLEAR ALL (X)"
// ============================================================================

function updateToastToolbar() {
  const container = document.getElementById('toast-container');
  const toolbar = document.getElementById('toast-toolbar');
  const countLabel = document.getElementById('toast-count-label');
  if (!container || !toolbar) return;

  const count = container.children.length;
  if (count > 0) {
    toolbar.classList.remove('hidden');
    if (countLabel) countLabel.textContent = `${count} Active Notification${count > 1 ? 's' : ''}`;
  } else {
    toolbar.classList.add('hidden');
  }
}

export function clearAllToasts() {
  const container = document.getElementById('toast-container');
  if (!container) return;
  container.innerHTML = '';
  updateToastToolbar();
}

export function showToast(title, message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${escapeHTML(type)}`;

  const titleEl = document.createElement('div');
  titleEl.className = 'toast-title';
  titleEl.textContent = sanitizeInput(String(title));

  const msgEl = document.createElement('div');
  msgEl.className = 'toast-msg';
  msgEl.textContent = sanitizeInput(String(message));

  toast.appendChild(titleEl);
  toast.appendChild(msgEl);
  container.appendChild(toast);
  updateToastToolbar();

  setTimeout(() => {
    toast.classList.add('toast-Out');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
        updateToastToolbar();
      }
    }, 240);
  }, 3000);
}

// ============================================================================
// 4. RBAC SESSION MANAGEMENT, VIEW 6 VISIBILITY & LOGIN / LOGOUT SECURITY
// ============================================================================

function getActiveRole() {
  return sessionStorage.getItem('lci_rbac_role') || null;
}

function getAuthHeaders() {
  const token = sessionStorage.getItem('lci_session_token') || '';
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

function isAuthenticated() {
  return Boolean(sessionStorage.getItem('lci_session_token') && getActiveRole());
}

function applyRBACPermissions() {
  const role = getActiveRole() || 'Viewer';
  const isAdmin = role === 'Admin';

  const roleHeaderLabel = document.getElementById('header-role-label');
  if (roleHeaderLabel) {
    roleHeaderLabel.textContent = role.toUpperCase();
    roleHeaderLabel.className = isAdmin ? 'text-mint' : 'text-cyber';
  }

  // Disable all .action-btn, #open-ip-modal-btn, and .rbac-protected for Viewers
  document.querySelectorAll('.action-btn, #open-ip-modal-btn, .rbac-protected').forEach(btn => {
    btn.disabled = !isAdmin;
    btn.title = isAdmin ? '' : 'Locked — Viewer role has read-only permissions';
  });

  document.querySelectorAll('.rbac-protected-input').forEach(input => {
    input.disabled = !isAdmin;
  });

  document.querySelectorAll('.rbac-lock-tag').forEach(tag => {
    tag.classList.toggle('hidden', isAdmin);
  });

  // Completely hide #view-6 and its sidebar navigation item for Viewers
  const navView6 = document.getElementById('nav-item-view-6');
  const navDivider6 = document.getElementById('nav-divider-view-6');
  const sectionView6 = document.getElementById('view-6');

  if (navView6) navView6.classList.toggle('hidden', !isAdmin);
  if (navDivider6) navDivider6.classList.toggle('hidden', !isAdmin);

  if (!isAdmin && sectionView6) {
    sectionView6.classList.remove('active');
    sectionView6.classList.add('hidden');
    const view1 = document.getElementById('view-1');
    const nav1 = document.querySelector('.nav-item[data-view="view-1"]');
    if (view1 && !document.querySelector('.view-section.active')) {
      view1.classList.add('active');
      if (nav1) nav1.classList.add('active');
      document.getElementById('current-view-title').textContent = 'Main Command Center (Executive Overview)';
    }
  } else if (isAdmin && sectionView6) {
    sectionView6.classList.remove('hidden');
  }

  syncManualControlsPanel();
}

function syncManualControlsPanel() {
  const manualPanel = document.getElementById('manual-controls-panel');
  if (!manualPanel) return;
  const isAdmin = getActiveRole() === 'Admin';
  const showManual = isAdmin && currentControlMode === 'MANUAL';
  manualPanel.classList.toggle('hidden', !showManual);
}

function lockAndLogoutSystem() {
  // 1. Explicitly clear sessionStorage
  sessionStorage.removeItem('lci_session_token');
  sessionStorage.removeItem('lci_rbac_role');
  sessionStorage.removeItem('lci_operator_id');
  sessionStorage.clear();

  // 2. Forcibly unmount authenticated view listeners
  if (authSessionAbortController) {
    authSessionAbortController.abort();
    authSessionAbortController = null;
  }

  // 3. Close live WebSockets and reset runtime state variables
  if (wsTelemetryInstance) {
    try { wsTelemetryInstance.close(); } catch {}
    wsTelemetryInstance = null;
  }
  if (wsMfaInstance) {
    try { wsMfaInstance.close(); } catch {}
    wsMfaInstance = null;
  }

  stopMfaCountdown();
  temperature = 0.0;
  humidity = 0.0;
  smoke_gas_level = 0;
  light_state = "OFF";
  door_state = "CLOSED";
  fan_relay = "OFF";
  isFacePassed = false;
  isCardPassed = false;
  isPinPassed = false;
  mfa_status = "IDLE";
  access_logs = [];
  environmental_telemetry = [];
  camera_events = [];
  system_errors = [];
  system_users = [];
  activityFeed = [];
  lastWsHeartbeat = 0;
  currentControlMode = 'AUTO';

  if (tempChart) tempChart.reset();
  if (humChart) humChart.reset();

  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
  document.querySelector('.nav-item[data-view="view-1"]')?.classList.add('active');
  document.getElementById('view-1')?.classList.add('active');

  renderActivityFeed();
  renderMFAUI();
  renderDatabaseTable();
  renderSystemErrors();
  renderUserManagementTable();
  syncManualControlsPanel();

  // 4. Show Login Overlay
  const loginOverlay = document.getElementById('login-overlay');
  if (loginOverlay) loginOverlay.classList.remove('hidden');

  showToast('System Locked', 'Session cleared and authenticated listeners unmounted.', 'info');
}

// ============================================================================
// 5. VIEW 6: DYNAMIC SQLITE USER MANAGEMENT TABLE (/api/logs/system_users)
// ============================================================================

async function fetchSystemUsers() {
  if (getActiveRole() !== 'Admin') return;
  try {
    const res = await fetch(`${NODE_RED_HTTP}/api/logs/system_users`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    system_users = Array.isArray(rows) ? rows : [];
  } catch {
    showToast('User Directory Offline', `Could not fetch /api/logs/system_users from ${NODE_RED_HTTP}.`, 'error');
  }
  renderUserManagementTable();
}

function renderUserManagementTable() {
  const tbody = document.getElementById('user-management-table-body');
  const countLabel = document.getElementById('user-count-label');
  if (!tbody) return;

  if (countLabel) {
    countLabel.textContent = `${system_users.length} SQLite User${system_users.length === 1 ? '' : 's'}`;
  }

  if (system_users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7">${getEmptyTableIllustrationHTML(
      'No Records in SQLite "system_users"',
      `Ensure the Node-RED SQLite Setup Flow has been initialized on ${NODE_RED_HTTP} or provision a new user.`
    )}</td></tr>`;
    return;
  }

  tbody.innerHTML = system_users
    .map(u => {
      const uid = u.id;
      const uname = u.username || u.name || '';
      const rfid = u.rfid || '—';
      const pin = u.pin ?? '••••••';
      const faceLinked = Boolean(u.face_linked);
      const role = u.role === 'Admin' ? 'Admin' : 'Viewer';

      return `
        <tr>
          <td class="tabular-nums">#${escapeHTML(uid)}</td>
          <td><strong>${escapeHTML(uname)}</strong></td>
          <td><code>${escapeHTML(rfid)}</code></td>
          <td class="tabular-nums"><code>${escapeHTML(pin)}</code></td>
          <td>
            <span class="${faceLinked ? 'text-mint' : 'text-cyber'}">
              ${faceLinked ? 'Linked (Node 3)' : 'Unlinked'}
            </span>
          </td>
          <td>
            <strong class="${role === 'Admin' ? 'text-mint' : 'text-cyber'}">${escapeHTML(role)}</strong>
          </td>
          <td>
            <div class="table-actions-cell">
              <button type="button" class="btn-cyber btn-sm" data-user-action="toggle-role" data-user-id="${escapeHTML(uid)}" data-current-role="${escapeHTML(role)}">
                Toggle Role (Admin/Viewer)
              </button>
              <button type="button" class="btn-rose btn-sm" data-user-action="delete-user" data-user-id="${escapeHTML(uid)}" data-username="${escapeHTML(uname)}">
                Delete User
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function mountAuthenticatedViewListeners() {
  if (authSessionAbortController) {
    authSessionAbortController.abort();
  }
  authSessionAbortController = new AbortController();
  const { signal } = authSessionAbortController;

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
      const viewId = btn.getAttribute('data-view');
      if (viewId === 'view-6' && getActiveRole() !== 'Admin') {
        showToast('Access Denied', 'System Management is restricted to Admin accounts.', 'error');
        return;
      }

      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(viewId).classList.add('active');
      document.getElementById('current-view-title').textContent = viewTitles[viewId] || 'LCI-SFM';
      if (viewId === 'view-3') {
        requestAnimationFrame(() => {
          if (tempChart) tempChart.draw();
          if (humChart) humChart.draw();
        });
      }
      if (viewId === 'view-6') {
        fetchSystemUsers();
      }
    }, { signal });
  });

  // View 1 Quick Action Buttons with RBAC check + 1.5s Anti-Spam Spinner
  const btnUnlockDoor = document.getElementById('cmd-unlock-door');
  btnUnlockDoor.addEventListener('click', () => {
    if (getActiveRole() !== 'Admin') return;
    withButtonLoading(btnUnlockDoor, () => {
      const next = door_state === 'OPEN' ? 'CLOSED' : 'OPEN';
      sendCommand('EMERGENCY_DOOR_UNLOCK', next);
    });
  }, { signal });

  const btnToggleFan = document.getElementById('cmd-toggle-fan');
  btnToggleFan.addEventListener('click', () => {
    if (getActiveRole() !== 'Admin') return;
    withButtonLoading(btnToggleFan, () => {
      const next = fan_relay === 'ON' ? 'OFF' : 'ON';
      sendCommand('TOGGLE_HVAC_FAN', next);
    });
  }, { signal });

  const btnToggleLight = document.getElementById('cmd-toggle-light');
  btnToggleLight.addEventListener('click', () => {
    if (getActiveRole() !== 'Admin') return;
    withButtonLoading(btnToggleLight, () => {
      const next = light_state === 'ON' ? 'OFF' : 'ON';
      sendCommand('TOGGLE_AUX_LIGHT', next);
    });
  }, { signal });

  // View 2 Camera Refresh
  document.getElementById('refresh-cam-btn').addEventListener('click', () => {
    refreshCameraSnapshot();
    showToast('Camera Frame Requested', `Pulling snapshot from http://${ip_node3}/capture.jpg`, 'info');
  }, { signal });

  // View 3 Override Mode Buttons (AUTO hides Manual Controls Panel; MANUAL reveals it)
  const autoBtn = document.getElementById('mode-auto-btn');
  const manualBtn = document.getElementById('mode-manual-btn');

  autoBtn.addEventListener('click', () => {
    if (getActiveRole() !== 'Admin') return;
    currentControlMode = 'AUTO';
    autoBtn.className = 'btn-mint rbac-protected';
    manualBtn.className = 'btn-outline rbac-protected';
    syncManualControlsPanel();
    sendCommand('SET_CONTROL_MODE', 'AUTO');
  }, { signal });

  manualBtn.addEventListener('click', () => {
    if (getActiveRole() !== 'Admin') return;
    currentControlMode = 'MANUAL';
    manualBtn.className = 'btn-cyber rbac-protected';
    autoBtn.className = 'btn-outline rbac-protected';
    syncManualControlsPanel();
    sendCommand('SET_CONTROL_MODE', 'MANUAL');
  }, { signal });

  // View 3 Manual Controls Panel Buttons ("Toggle HVAC Fan" & "Toggle Aux Light")
  const envManualFanBtn = document.getElementById('env-manual-toggle-fan');
  envManualFanBtn.addEventListener('click', () => {
    if (getActiveRole() !== 'Admin' || currentControlMode !== 'MANUAL') return;
    withButtonLoading(envManualFanBtn, () => {
      const next = fan_relay === 'ON' ? 'OFF' : 'ON';
      sendCommand('TOGGLE_HVAC_FAN', next);
    });
  }, { signal });

  const envManualLightBtn = document.getElementById('env-manual-toggle-light');
  envManualLightBtn.addEventListener('click', () => {
    if (getActiveRole() !== 'Admin' || currentControlMode !== 'MANUAL') return;
    withButtonLoading(envManualLightBtn, () => {
      const next = light_state === 'ON' ? 'OFF' : 'ON';
      sendCommand('TOGGLE_AUX_LIGHT', next);
    });
  }, { signal });

  // View 4 Database Tabs & Search with Dynamic Clear (X) Button
  document.querySelectorAll('.tab-btn').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeDbTable = tab.getAttribute('data-table');
      fetchSQLiteLogs(activeDbTable);
    }, { signal });
  });

  const searchInput = document.getElementById('db-search-input');
  const searchClearBtn = document.getElementById('db-search-clear-btn');

  searchInput.addEventListener('input', () => {
    const cleaned = sanitizeInput(searchInput.value);
    if (searchInput.value !== cleaned) {
      searchInput.value = cleaned;
    }
    searchClearBtn.classList.toggle('hidden', searchInput.value.length === 0);
    renderDatabaseTable();
  }, { signal });

  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchClearBtn.classList.add('hidden');
    renderDatabaseTable();
    searchInput.focus();
  }, { signal });

  document.getElementById('db-refresh-btn').addEventListener('click', () => {
    fetchSQLiteLogs(activeDbTable);
  }, { signal });

  document.getElementById('refresh-errors-btn').addEventListener('click', () => {
    fetchSQLiteLogs('system_errors');
  }, { signal });

  // View 6: Refresh SQLite Users Button
  const refreshUsersBtn = document.getElementById('refresh-users-btn');
  if (refreshUsersBtn) {
    refreshUsersBtn.addEventListener('click', () => {
      fetchSystemUsers();
    }, { signal });
  }

  // View 6: Capture Face from Node 3 inside Provisioning Form
  const captureFaceBtn = document.getElementById('prov-capture-face-btn');
  const facePreviewImg = document.getElementById('prov-face-preview-img');
  const facePlaceholder = document.getElementById('prov-face-placeholder');
  const faceStatusText = document.getElementById('prov-face-status-text');

  captureFaceBtn.addEventListener('click', () => {
    if (getActiveRole() !== 'Admin') return;
    if (!isValidIPv4(ip_node3)) {
      showToast('Invalid Node 3 IP', 'Configure a valid IPv4 address for Node 3 first.', 'error');
      return;
    }

    const snapshotUrl = `http://${ip_node3}/capture.jpg?t=${Date.now()}`;
    capturedFaceUrlForProvision = snapshotUrl;

    facePreviewImg.onload = () => {
      facePreviewImg.classList.remove('hidden');
      if (facePlaceholder) facePlaceholder.classList.add('hidden');
      showToast('Face Captured', `Linked biometric frame from ${ip_node3}`, 'success');
    };

    facePreviewImg.onerror = () => {
      facePreviewImg.classList.add('hidden');
      if (facePlaceholder) facePlaceholder.classList.remove('hidden');
      if (faceStatusText) faceStatusText.textContent = 'Node 3 Frame Linked';
      showToast('Face Endpoint Linked', `Associated http://${ip_node3}/capture.jpg with new user profile.`, 'info');
    };

    facePreviewImg.src = snapshotUrl;
  }, { signal });

  // View 6: User Provisioning Form Submission (POST /api/provision/user -> SQLite system_users)
  document.getElementById('user-provision-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (getActiveRole() !== 'Admin') return;

    const cleanUsername = sanitizeInput(document.getElementById('prov_name').value);
    const cleanRfid = sanitizeInput(document.getElementById('prov_rfid').value).toUpperCase();
    const cleanPinStr = sanitizeInput(document.getElementById('prov_pin').value);

    if (!SAFE_NAME_REGEX.test(cleanUsername)) {
      showToast('Validation Error', 'Username must be 2–64 alphanumeric characters.', 'error');
      return;
    }
    if (!isValidHexRFID(cleanRfid)) {
      showToast('Validation Error', 'RFID UID must match hex format XX:XX:XX:XX (e.g. A4:9F:21:0B).', 'error');
      return;
    }
    if (!isValidSixDigitPin(cleanPinStr)) {
      showToast('Validation Error', 'Keypad PIN must be an exact 6-digit integer (000000–999999).', 'error');
      return;
    }

    const strictPayload = {
      username: String(cleanUsername),
      password: String(cleanPinStr),
      role: 'Viewer',
      rfid: String(cleanRfid),
      pin: Number.parseInt(cleanPinStr, 10),
      face_linked: Boolean(capturedFaceUrlForProvision)
    };

    try {
      const res = await fetch(`${NODE_RED_HTTP}/api/provision/user`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(strictPayload)
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      // Reset Face preview state
      capturedFaceUrlForProvision = '';
      facePreviewImg.classList.add('hidden');
      if (facePlaceholder) facePlaceholder.classList.remove('hidden');
      if (faceStatusText) faceStatusText.textContent = 'No Face Linked';
      e.target.reset();

      pushActivityEvent(`Provisioned SQLite User: ${cleanUsername} (RFID: ${cleanRfid})`);
      showToast('User Provisioned', `${cleanUsername} hashed & saved to SQLite system_users.`, 'success');

      // Reload dynamic table from /api/logs/system_users
      await fetchSystemUsers();
    } catch (err) {
      showToast('Provisioning Failed', err.message || `Unable to reach ${NODE_RED_HTTP}/api/provision/user.`, 'error');
    }
  }, { signal });

  // View 6: Admin Profile Form (POST /api/auth/admin-profile to update SQLite Admin credentials)
  document.getElementById('admin-profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (getActiveRole() !== 'Admin') return;

    const newUsername = sanitizeInput(document.getElementById('admin_new_username').value);
    const newPassword = sanitizeInput(document.getElementById('admin_new_password').value);

    if (!SAFE_NAME_REGEX.test(newUsername)) {
      showToast('Validation Error', 'Admin Username must be 2–32 alphanumeric characters.', 'error');
      return;
    }
    if (newPassword.length < 4) {
      showToast('Validation Error', 'Admin Password must be at least 4 characters.', 'error');
      return;
    }

    try {
      const res = await fetch(`${NODE_RED_HTTP}/api/auth/admin-profile`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          currentUsername: sessionStorage.getItem('lci_operator_id') || 'admin',
          newUsername,
          newPassword
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      sessionStorage.setItem('lci_operator_id', newUsername);
      document.getElementById('admin_new_password').value = '';
      pushActivityEvent(`Updated SQLite Admin Profile: ${newUsername}`);
      showToast('Admin Profile Updated', `Admin credentials updated in SQLite for "${newUsername}".`, 'success');
      await fetchSystemUsers();
    } catch {
      showToast('Update Failed', `Could not update Admin credentials on ${NODE_RED_HTTP}.`, 'error');
    }
  }, { signal });

  // View 6: IP Settings Form
  document.getElementById('settings-ip-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (getActiveRole() !== 'Admin') return;
    saveNodeIPs(
      document.getElementById('set_ip_node1').value,
      document.getElementById('set_ip_node2').value,
      document.getElementById('set_ip_node3').value
    );
  }, { signal });

  // View 6: User Management Table Row Actions (Toggle Role & Delete User in SQLite)
  document.getElementById('user-management-table-body').addEventListener('click', async (e) => {
    if (getActiveRole() !== 'Admin') return;
    const btn = e.target.closest('button[data-user-action]');
    if (!btn) return;

    const action = btn.getAttribute('data-user-action');
    const userId = Number.parseInt(btn.getAttribute('data-user-id'), 10);
    if (!Number.isInteger(userId)) return;

    if (action === 'toggle-role') {
      const currentRole = btn.getAttribute('data-current-role') === 'Admin' ? 'Admin' : 'Viewer';
      const nextRole = currentRole === 'Admin' ? 'Viewer' : 'Admin';
      try {
        const res = await fetch(`${NODE_RED_HTTP}/api/users/role`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ id: userId, role: nextRole })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        pushActivityEvent(`SQLite User #${userId} Role -> ${nextRole}`);
        showToast('Role Updated', `User #${userId} role changed to ${nextRole}.`, 'info');
        await fetchSystemUsers();
      } catch {
        showToast('Role Update Failed', `Could not update role in SQLite on ${NODE_RED_HTTP}.`, 'error');
      }
    } else if (action === 'delete-user') {
      const uname = btn.getAttribute('data-username') || `#${userId}`;
      try {
        const res = await fetch(`${NODE_RED_HTTP}/api/users/delete`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ id: userId })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        pushActivityEvent(`Deleted SQLite User: ${uname}`);
        showToast('User Deleted', `Removed ${uname} from SQLite system_users.`, 'error');
        await fetchSystemUsers();
      } catch {
        showToast('Delete Failed', `Could not delete user #${userId} on ${NODE_RED_HTTP}.`, 'error');
      }
    }
  }, { signal });
}

// ============================================================================
// 6. HEADER UTILITIES: LIVE DIGITAL CLOCK, FULLSCREEN, THEME & SIDEBAR
// ============================================================================

function startLiveDigitalClock() {
  const timeEl = document.getElementById('live-clock-time');
  const dateEl = document.getElementById('live-clock-date');
  const tick = () => {
    const now = new Date();
    if (timeEl) {
      timeEl.textContent = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    }
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric'
      });
    }
  };
  tick();
  setInterval(tick, 1000);
}

function initFullscreenToggle() {
  const fsBtn = document.getElementById('fullscreen-toggle-btn');
  const expandIcon = document.getElementById('fs-icon-expand');
  const compressIcon = document.getElementById('fs-icon-compress');
  if (!fsBtn) return;

  const syncFsIcons = () => {
    const isFs = Boolean(document.fullscreenElement);
    if (expandIcon && compressIcon) {
      expandIcon.classList.toggle('hidden', isFs);
      compressIcon.classList.toggle('hidden', !isFs);
    }
  };

  fsBtn.addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
      syncFsIcons();
    } catch {
      showToast('Fullscreen Unavailable', 'Fullscreen mode is restricted by the current browser container.', 'info');
    }
  });

  document.addEventListener('fullscreenchange', syncFsIcons);
}

function initThemeAndSidebar() {
  const savedTheme = localStorage.getItem('lci_theme') === 'light' ? 'light' : 'dark';
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
// 7. BUTTON LOADING STATES (1.5-Second Anti-Spam Lock + Pure CSS Spinner)
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
      const isAdmin = getActiveRole() === 'Admin';
      buttonEl.disabled = !isAdmin;
      buttonEl.innerHTML = originalHtml;
    }, 1500);
  }
}

// ============================================================================
// 8. DYNAMIC IP CONFIGURATION MODAL & STRICT IPV4 ENFORCEMENT
// ============================================================================

function openIpModal() {
  if (getActiveRole() !== 'Admin') {
    showToast('Read-Only Access', 'Viewer role cannot modify Node IP endpoints.', 'error');
    return;
  }
  const modal = document.getElementById('startup-modal');
  document.getElementById('modal_ip_node1').value = ip_node1 || '192.168.43.11';
  document.getElementById('modal_ip_node2').value = ip_node2 || '192.168.43.12';
  document.getElementById('modal_ip_node3').value = ip_node3 || '192.168.43.13';
  modal.classList.remove('hidden');
}

function closeIpModal() {
  document.getElementById('startup-modal').classList.add('hidden');
}

function checkNodeIPsOnStartup() {
  if (!isValidIPv4(ip_node1) || !isValidIPv4(ip_node2) || !isValidIPv4(ip_node3)) {
    ip_node1 = '192.168.43.11';
    ip_node2 = '192.168.43.12';
    ip_node3 = '192.168.43.13';
    syncIPInputs();
    if (getActiveRole() === 'Admin') {
      openIpModal();
    }
  } else {
    syncIPInputs();
  }
}

function saveNodeIPs(rawN1, rawN2, rawN3) {
  const n1 = sanitizeInput(rawN1);
  const n2 = sanitizeInput(rawN2);
  const n3 = sanitizeInput(rawN3);

  if (!isValidIPv4(n1) || !isValidIPv4(n2) || !isValidIPv4(n3)) {
    showToast('Invalid IPv4 Format', 'All 3 Node IPs must be valid IPv4 addresses (e.g. 192.168.43.11).', 'error');
    return false;
  }

  ip_node1 = n1;
  ip_node2 = n2;
  ip_node3 = n3;
  localStorage.setItem('ip_node1', ip_node1);
  localStorage.setItem('ip_node2', ip_node2);
  localStorage.setItem('ip_node3', ip_node3);
  syncIPInputs();
  showToast('Endpoints Saved', `Validated Nodes: ${ip_node1}, ${ip_node2}, ${ip_node3}`, 'success');
  return true;
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
  const fallbackTitle = document.getElementById('camera-fallback-title');
  const fallbackText = document.getElementById('camera-fallback-text');
  if (!img || !isValidIPv4(ip_node3)) return;

  img.onload = () => {
    img.classList.remove('hidden');
    if (fallback) fallback.classList.add('hidden');
  };

  img.onerror = () => {
    img.classList.add('hidden');
    if (fallback) fallback.classList.remove('hidden');
    if (fallbackTitle) fallbackTitle.textContent = 'Node 3 Optical Stream Unreachable';
    if (fallbackText) {
      fallbackText.textContent = `Could not retrieve capture.jpg from http://${ip_node3}/capture.jpg.`;
    }
  };

  img.src = `http://${ip_node3}/capture.jpg?t=${Date.now()}`;
}

// ============================================================================
// 9. TELEMETRY & MFA PARSING LOGIC (Strict Variable Names)
// ============================================================================

function updateCircularGauge(arcId, value, maxVal) {
  const arc = document.getElementById(arcId);
  if (!arc) return;
  const circumference = 314.16;
  const clamped = Math.max(0, Math.min(maxVal, Number(value) || 0));
  const offset = circumference - (clamped / maxVal) * circumference;
  arc.style.strokeDashoffset = offset.toFixed(2);
}

export function handleTelemetryPayload(payload) {
  if (!payload || typeof payload !== 'object') return;
  lastWsHeartbeat = Date.now();

  if (typeof payload.temperature === 'number' && Number.isFinite(payload.temperature)) {
    temperature = payload.temperature;
  }
  if (typeof payload.humidity === 'number' && Number.isFinite(payload.humidity)) {
    humidity = payload.humidity;
  }
  if (typeof payload.smoke_gas_level === 'number' && Number.isFinite(payload.smoke_gas_level)) {
    smoke_gas_level = payload.smoke_gas_level;
  }
  if (payload.light_state === 'ON' || payload.light_state === 'OFF') light_state = payload.light_state;
  if (payload.door_state === 'OPEN' || payload.door_state === 'CLOSED') door_state = payload.door_state;
  if (payload.fan_relay === 'ON' || payload.fan_relay === 'OFF') fan_relay = payload.fan_relay;

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

  const reedEl = document.getElementById('access-reed-state');
  reedEl.textContent = door_state === 'CLOSED' ? 'CLOSED (ENGAGED)' : 'OPEN (SEPARATED)';
  reedEl.className = `hw-state ${door_state === 'CLOSED' ? 'text-mint' : 'text-rose'}`;

  const solenoidEl = document.getElementById('access-solenoid-state');
  solenoidEl.textContent = door_state === 'CLOSED' ? 'ENERGIZED (LOCKED)' : 'DE-ENERGIZED (UNLOCKED)';
  solenoidEl.className = `hw-state ${door_state === 'CLOSED' ? 'text-mint' : 'text-rose'}`;

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
  if (!payload || typeof payload !== 'object') return;
  lastWsHeartbeat = Date.now();

  if (typeof payload.isFacePassed === 'boolean') isFacePassed = payload.isFacePassed;
  if (typeof payload.isCardPassed === 'boolean') isCardPassed = payload.isCardPassed;
  if (typeof payload.isPinPassed === 'boolean') isPinPassed = payload.isPinPassed;
  if (
    payload.mfa_status === 'IDLE' ||
    payload.mfa_status === 'AWAITING_STAGE2' ||
    payload.mfa_status === 'UNLOCKED'
  ) {
    mfa_status = payload.mfa_status;
  }

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
  const fillEl = document.getElementById('mfa-progress-fill');
  if (fillEl) fillEl.style.width = `${pct}%`;

  const statusLabel = document.getElementById('mfa-status-label');
  if (statusLabel) {
    statusLabel.textContent = mfa_status;
    statusLabel.className = mfa_status === 'UNLOCKED' ? 'text-mint' : 'text-cyber';
  }

  const cpFace = document.getElementById('cp-face');
  if (cpFace) {
    cpFace.className = `checkpoint ${isFacePassed ? 'passed' : ''}`;
    cpFace.querySelector('.cp-var').textContent = `isFacePassed: ${isFacePassed}`;
  }

  const cpCard = document.getElementById('cp-card');
  if (cpCard) {
    cpCard.className = `checkpoint ${isCardPassed ? 'passed' : ''}`;
    cpCard.querySelector('.cp-var').textContent = `isCardPassed: ${isCardPassed}`;
  }

  const cpPin = document.getElementById('cp-pin');
  if (cpPin) {
    cpPin.className = `checkpoint ${isPinPassed ? 'passed' : ''}`;
    cpPin.querySelector('.cp-var').textContent = `isPinPassed: ${isPinPassed}`;
  }
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
  const timerEl = document.getElementById('mfa-timer-label');
  if (timerEl) timerEl.textContent = '10s';
}

function pushActivityEvent(text) {
  const cleanText = sanitizeInput(String(text));
  const time = new Date().toLocaleTimeString();
  activityFeed.unshift({ time, text: cleanText });
  activityFeed = activityFeed.slice(0, 5);
  renderActivityFeed();
}

function renderActivityFeed() {
  const ul = document.getElementById('live-activity-list');
  if (!ul) return;

  if (activityFeed.length === 0) {
    ul.innerHTML = `
      <li class="empty-state-box">
        <svg class="empty-state-svg" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
        </svg>
        <strong class="empty-state-title">No Live Activity Recorded Yet</strong>
        <span class="empty-state-sub">Awaiting real-time telemetry or MFA frames from 192.168.43.225:1880.</span>
      </li>
    `;
    return;
  }

  ul.innerHTML = activityFeed
    .map(item => `<li><span>${escapeHTML(item.text)}</span><code class="text-cyber">${escapeHTML(item.time)}</code></li>`)
    .join('');
}

// ============================================================================
// 10. WEBSOCKET CLIENTS & SQLITE REST FETCH (192.168.43.225:1880)
// ============================================================================

function connectWebSockets() {
  try {
    wsTelemetryInstance = new WebSocket(WS_TELEMETRY_URL);
    wsTelemetryInstance.onopen = () => {
      document.getElementById('ws-telemetry-dot').className = 'dot dot-green';
      document.getElementById('ws-telemetry-status').textContent = 'ONLINE';
      showToast('Telemetry Stream Connected', WS_TELEMETRY_URL, 'success');
    };
    wsTelemetryInstance.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleTelemetryPayload(data);
      } catch {
        showToast('Telemetry Parse Error', 'Malformed JSON frame received.', 'error');
      }
    };
    wsTelemetryInstance.onerror = () => {
      document.getElementById('ws-telemetry-dot').className = 'dot dot-red';
      document.getElementById('ws-telemetry-status').textContent = 'OFFLINE';
    };
    wsTelemetryInstance.onclose = () => {
      document.getElementById('ws-telemetry-dot').className = 'dot dot-red';
      document.getElementById('ws-telemetry-status').textContent = 'OFFLINE';
    };
  } catch {
    document.getElementById('ws-telemetry-status').textContent = 'OFFLINE';
  }

  try {
    wsMfaInstance = new WebSocket(WS_MFA_URL);
    wsMfaInstance.onopen = () => {
      document.getElementById('ws-mfa-dot').className = 'dot dot-green';
      document.getElementById('ws-mfa-status').textContent = 'ONLINE';
    };
    wsMfaInstance.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleMFAPayload(data);
      } catch {
        showToast('MFA Stream Error', 'Malformed MFA JSON payload.', 'error');
      }
    };
    wsMfaInstance.onerror = () => {
      document.getElementById('ws-mfa-dot').className = 'dot dot-red';
      document.getElementById('ws-mfa-status').textContent = 'OFFLINE';
    };
    wsMfaInstance.onclose = () => {
      document.getElementById('ws-mfa-dot').className = 'dot dot-red';
      document.getElementById('ws-mfa-status').textContent = 'OFFLINE';
    };
  } catch {
    document.getElementById('ws-mfa-status').textContent = 'OFFLINE';
  }
}

async function fetchSQLiteLogs(tableName) {
  const allowedTables = new Set([
    'access_logs',
    'camera_events',
    'environmental_telemetry',
    'system_errors',
    'system_users'
  ]);
  if (!allowedTables.has(tableName)) return;

  try {
    const res = await fetch(`${NODE_RED_HTTP}/api/logs/${tableName}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();

    if (tableName === 'access_logs') access_logs = Array.isArray(rows) ? rows : [];
    if (tableName === 'camera_events') camera_events = Array.isArray(rows) ? rows : [];
    if (tableName === 'environmental_telemetry') environmental_telemetry = Array.isArray(rows) ? rows : [];
    if (tableName === 'system_errors') system_errors = Array.isArray(rows) ? rows : [];
    if (tableName === 'system_users') system_users = Array.isArray(rows) ? rows : [];
  } catch {
    showToast('Database Unreachable', `Could not fetch /api/logs/${tableName} from ${NODE_RED_HTTP}.`, 'error');
  }
  renderDatabaseTable();
  renderSystemErrors();
  renderUserManagementTable();
}

function getEmptyTableIllustrationHTML(title, subtitle) {
  return `
    <div class="empty-state-box">
      <svg class="empty-state-svg" width="44" height="44" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <ellipse cx="32" cy="16" rx="20" ry="8"></ellipse>
        <path d="M12 16v16c0 4.4 9 8 20 8s20-3.6 20-8V16"></path>
        <path d="M12 32v16c0 4.4 9 8 20 8s20-3.6 20-8V32"></path>
      </svg>
      <strong class="empty-state-title">${escapeHTML(title)}</strong>
      <span class="empty-state-sub">${escapeHTML(subtitle)}</span>
    </div>
  `;
}

function renderDatabaseTable() {
  const thead = document.getElementById('db-table-head');
  const tbody = document.getElementById('db-table-body');
  if (!thead || !tbody) return;

  const query = sanitizeInput(document.getElementById('db-search-input')?.value || '').toLowerCase();

  let dataset = access_logs;
  if (activeDbTable === 'camera_events') dataset = camera_events;
  if (activeDbTable === 'environmental_telemetry') dataset = environmental_telemetry;

  const filtered = dataset.filter(row =>
    Object.values(row).some(v => String(v).toLowerCase().includes(query))
  );

  if (filtered.length === 0) {
    thead.innerHTML = '<tr><th>SQLite Table Status</th></tr>';
    tbody.innerHTML = `<tr><td>${getEmptyTableIllustrationHTML(
      `No Records Found in "${activeDbTable}"`,
      `Connect to the Node-RED SQLite backend (${NODE_RED_HTTP}) or clear active search filters.`
    )}</td></tr>`;
    return;
  }

  const columns = Object.keys(filtered[0]);
  thead.innerHTML = `<tr>${columns.map(c => `<th>${escapeHTML(c)}</th>`).join('')}</tr>`;
  tbody.innerHTML = filtered
    .map(row => `<tr>${columns.map(c => `<td>${escapeHTML(row[c])}</td>`).join('')}</tr>`)
    .join('');
}

function renderSystemErrors() {
  const tbody = document.getElementById('system-errors-body');
  if (!tbody) return;
  if (system_errors.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">${getEmptyTableIllustrationHTML(
      'No System Errors Logged',
      `Table "system_errors" is clean or awaiting connection to ${NODE_RED_HTTP}.`
    )}</td></tr>`;
    return;
  }
  tbody.innerHTML = system_errors
    .map(err => {
      const id = err.error_id ?? err.id ?? '';
      const ts = err.timestamp ?? '';
      const node = err.source_node ?? err.node ?? '';
      const code = err.error_code ?? err.severity ?? '';
      const desc = err.error_description ?? err.message ?? '';
      return `
        <tr>
          <td>#${escapeHTML(id)}</td>
          <td>${escapeHTML(ts)}</td>
          <td><code>${escapeHTML(node)}</code></td>
          <td><span class="text-rose">${escapeHTML(code)}</span></td>
          <td>${escapeHTML(desc)}</td>
        </tr>
      `;
    })
    .join('');
}

async function sendCommand(command, targetState) {
  if (getActiveRole() !== 'Admin') {
    showToast('Permission Denied', 'Viewer role is restricted from dispatching commands.', 'error');
    return;
  }

  const cleanCmd = String(command).trim();
  const cleanState = String(targetState).trim();

  if (!ALLOWED_COMMANDS.has(cleanCmd) || !ALLOWED_COMMAND_STATES.has(cleanState)) {
    showToast('Security Block', 'Blocked untyped or unrecognized command payload.', 'error');
    return;
  }

  if (!isValidIPv4(ip_node1) || !isValidIPv4(ip_node2) || !isValidIPv4(ip_node3)) {
    showToast('Invalid Node IP', 'Verify Node IPv4 addresses before dispatching hardware commands.', 'error');
    return;
  }

  const strictBody = {
    command: cleanCmd,
    state: cleanState,
    ip_node1: String(ip_node1),
    ip_node2: String(ip_node2),
    ip_node3: String(ip_node3)
  };

  pushActivityEvent(`Command Sent: ${cleanCmd} -> ${cleanState}`);
  try {
    const response = await fetch(`${NODE_RED_HTTP}/api/command`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(strictBody)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    showToast('Command Executed', `${cleanCmd} set to ${cleanState}`, 'success');
  } catch {
    showToast('Command Failed', `Node-RED (${NODE_RED_HTTP}) unreachable for ${cleanCmd}`, 'error');
  }
}

// ============================================================================
// 11. 5-SECOND HEARTBEAT WATCHDOG
// ============================================================================

function startHeartbeatMonitor() {
  setInterval(() => {
    const isOnline = lastWsHeartbeat > 0 && (Date.now() - lastWsHeartbeat) <= 5000;
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
// 12. INITIALIZATION & REAL SQLITE AUTHENTICATION (POST /api/auth/login)
// ============================================================================

function bootAuthenticatedSession() {
  const loginOverlay = document.getElementById('login-overlay');
  if (loginOverlay) loginOverlay.classList.add('hidden');

  const operatorName = sessionStorage.getItem('lci_operator_id') || 'admin';
  const adminUserField = document.getElementById('admin_new_username');
  if (adminUserField) adminUserField.value = operatorName;

  applyRBACPermissions();
  mountAuthenticatedViewListeners();
  checkNodeIPsOnStartup();
  renderActivityFeed();
  renderMFAUI();

  connectWebSockets();
  fetchSQLiteLogs('access_logs');
  fetchSQLiteLogs('system_errors');
  if (getActiveRole() === 'Admin') {
    fetchSystemUsers();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const tempCanvas = document.getElementById('temp-chart-canvas');
  const humCanvas = document.getElementById('hum-chart-canvas');
  if (tempCanvas) tempChart = new LocalFIFOChart(tempCanvas, { color: '#60a5fa', min: 0, max: 50, unit: '°C' });
  if (humCanvas) humChart = new LocalFIFOChart(humCanvas, { color: '#34d399', min: 0, max: 100, unit: '%' });

  startLiveDigitalClock();
  initFullscreenToggle();
  initThemeAndSidebar();
  startHeartbeatMonitor();
  renderActivityFeed();
  renderDatabaseTable();
  renderSystemErrors();
  renderUserManagementTable();

  // Toast Clear All (X) Button
  const clearToastsBtn = document.getElementById('toast-clear-all-btn');
  if (clearToastsBtn) {
    clearToastsBtn.addEventListener('click', clearAllToasts);
  }

  // Real Database Authentication via HTTP POST to http://192.168.43.225:1880/api/auth/login
  const loginForm = document.getElementById('login-form');
  const loginSubmitBtn = document.getElementById('login-submit-btn');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawUsername = document.getElementById('login_username').value;
    const rawPassword = document.getElementById('login_password').value;

    const cleanUsername = sanitizeInput(rawUsername);
    const cleanPassword = sanitizeInput(rawPassword);

    if (!cleanUsername || !cleanPassword) {
      showToast('Validation Error', 'Both Username and Password are required.', 'error');
      return;
    }

    if (loginSubmitBtn) loginSubmitBtn.disabled = true;

    try {
      const response = await fetch(`${NODE_RED_HTTP}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: String(cleanUsername),
          password: String(cleanPassword)
        })
      });

      if (response.status === 401) {
        showToast('Invalid Credentials', 'Username or password rejected by SQLite authentication.', 'error');
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const authData = await response.json();
      const token = sanitizeInput(String(authData.token || ''));
      const role = authData.role === 'Admin' ? 'Admin' : 'Viewer';
      const verifiedUser = sanitizeInput(String(authData.username || cleanUsername));

      if (!token) {
        showToast('Authentication Error', 'Malformed token response from server.', 'error');
        return;
      }

      sessionStorage.setItem('lci_session_token', token);
      sessionStorage.setItem('lci_rbac_role', role);
      sessionStorage.setItem('lci_operator_id', verifiedUser);

      bootAuthenticatedSession();
      pushActivityEvent(`SQLite Auth Success: ${verifiedUser} (${role})`);
      showToast('Console Unlocked', `Authenticated as ${verifiedUser} [${role}]`, 'success');
    } catch {
      showToast('Authentication Server Offline', `Could not reach ${NODE_RED_HTTP}/api/auth/login.`, 'error');
    } finally {
      if (loginSubmitBtn) loginSubmitBtn.disabled = false;
    }
  });

  // Lock System / Logout Button
  document.getElementById('logout-btn').addEventListener('click', () => {
    lockAndLogoutSystem();
  });

  // Startup / Node IP Modal Controls ((X), Cancel, Save)
  document.getElementById('open-ip-modal-btn').addEventListener('click', () => {
    openIpModal();
  });

  document.getElementById('close-ip-modal-x').addEventListener('click', () => {
    closeIpModal();
  });

  document.getElementById('cancel-ip-modal-btn').addEventListener('click', () => {
    closeIpModal();
  });

  document.getElementById('startup-ip-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (getActiveRole() !== 'Admin') {
      showToast('Read-Only Mode', 'Viewer role cannot overwrite Node IP configuration.', 'error');
      return;
    }
    const ok = saveNodeIPs(
      document.getElementById('modal_ip_node1').value,
      document.getElementById('modal_ip_node2').value,
      document.getElementById('modal_ip_node3').value
    );
    if (ok) closeIpModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeIpModal();
    }
  });

  // Auto-restore session if already authenticated in current tab sessionStorage
  if (isAuthenticated()) {
    bootAuthenticatedSession();
  }
});
