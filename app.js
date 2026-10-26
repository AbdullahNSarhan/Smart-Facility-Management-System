import { mountFacilityConsole } from './facility-console.js';
/**
 * LCI-SFM Enterprise BMS / HMI Operations Console Application Logic (ES6 Module)
 * - Air-Gapped 3-File Frontend Architecture (index.html, styles.css, app.js)
 * - Same-Origin / Configurable Central Backend Gateway (/api/*, /ws/telemetry, /ws/mfa)
 * - Verified Server Authentication (POST /api/auth/login), Dynamic SQLite Explorer (GET /api/logs/:table),
 *   Hardware Command Dispatch (POST /api/command), and User Provisioning (POST /api/provision/user)
 */

// ============================================================================
// 0. EMBEDDED AIR-GAPPED TELEMETRY CHART ENGINE (30-SAMPLE FIFO + SQLITE SERIES)
// ============================================================================

export class LocalFIFOChart {
  constructor(canvas, config = {}) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.maxPoints = config.maxPoints || 30;
    this.label = config.label || 'Telemetry';
    this.unit = config.unit || '';
    this.color = config.color || '#38bdf8';
    this.dangerThreshold = config.dangerThreshold ?? null;
    this.warningThreshold = config.warningThreshold ?? null;
    this.thresholdLabel = config.thresholdLabel || '';
    this.minY = config.minY ?? config.min ?? 0;
    this.maxY = config.maxY ?? config.max ?? 100;
    this.statsElId = config.statsElId || null;
    this.labels = [];
    this.data = [];
    this.hoverIndex = null;
    this.modeLabel = 'Live 30-Sample FIFO';

    if (this.canvas) {
      this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
      this.canvas.addEventListener('mouseleave', () => {
        this.hoverIndex = null;
        this.render();
      });
    }
    this.render();
  }

  pushValue(timestampLabel, numericValue) {
    this.pushDataPoint(timestampLabel, numericValue);
  }

  pushDataPoint(timestampLabel, numericValue) {
    const num = Number(numericValue);
    if (!Number.isFinite(num)) return;
    if (this.labels.length >= this.maxPoints) {
      this.labels.shift();
    }
    if (this.data.length >= this.maxPoints) {
      this.data.shift();
    }
    this.labels.push(String(timestampLabel));
    this.data.push(num);
    this.updateStatsSummary();
    this.render();
  }

  setSeries(labelsArray, dataArray, modeLabel = 'Live 30-Sample FIFO') {
    this.labels = Array.isArray(labelsArray) ? labelsArray.slice(-this.maxPoints).map(String) : [];
    this.data = Array.isArray(dataArray)
      ? dataArray.slice(-this.maxPoints).map(Number).filter(Number.isFinite)
      : [];
    this.modeLabel = modeLabel;
    this.hoverIndex = null;
    this.updateStatsSummary();
    this.render();
  }

  reset() {
    this.labels = [];
    this.data = [];
    this.hoverIndex = null;
    this.updateStatsSummary();
    this.render();
  }

  updateStatsSummary() {
    if (!this.statsElId) return;
    const el = document.getElementById(this.statsElId);
    if (!el) return;
    if (this.data.length === 0) {
      el.textContent = `Samples: 0 / ${this.maxPoints} · Min: — · Max: — · Latest: —`;
      return;
    }
    const minVal = Math.min(...this.data).toFixed(1);
    const maxVal = Math.max(...this.data).toFixed(1);
    const latest = this.data[this.data.length - 1].toFixed(1);
    el.textContent = `Samples: ${this.data.length} / ${this.maxPoints} · Min: ${minVal}${this.unit} · Max: ${maxVal}${this.unit} · Latest: ${latest}${this.unit}`;
  }

  handleMouseMove(e) {
    if (!this.canvas || this.data.length === 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const padLeft = 52;
    const padRight = 20;
    const plotW = Math.max(80, rect.width - padLeft - padRight);

    let closestIdx = 0;
    let minDist = Infinity;
    for (let idx = 0; idx < this.data.length; idx++) {
      const px = padLeft + (idx / Math.max(1, this.maxPoints - 1)) * plotW;
      const dist = Math.abs(mouseX - px);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = idx;
      }
    }
    if (minDist <= 28) {
      if (this.hoverIndex !== closestIdx) {
        this.hoverIndex = closestIdx;
        this.render();
      }
    } else if (this.hoverIndex !== null) {
      this.hoverIndex = null;
      this.render();
    }
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
    const height = this.canvas.height || 220;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const padLeft = 52;
    const padRight = 20;
    const padTop = 18;
    const padBottom = 30;
    const plotW = Math.max(80, width - padLeft - padRight);
    const plotH = Math.max(60, height - padTop - padBottom);

    ctx.strokeStyle = isLight ? 'rgba(100, 116, 139, 0.18)' : 'rgba(148, 163, 184, 0.12)';
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

    const refThreshold = this.dangerThreshold ?? this.warningThreshold;
    if (refThreshold !== null && refThreshold !== undefined) {
      const dRatio = Math.min(1, Math.max(0, (refThreshold - this.minY) / (this.maxY - this.minY)));
      const dy = padTop + plotH - dRatio * plotH;
      ctx.save();
      ctx.strokeStyle = this.dangerThreshold !== null ? 'rgba(244, 63, 94, 0.75)' : 'rgba(245, 158, 11, 0.75)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padLeft, dy);
      ctx.lineTo(width - padRight, dy);
      ctx.stroke();
      ctx.fillStyle = this.dangerThreshold !== null
        ? (isLight ? '#e11d48' : '#f43f5e')
        : (isLight ? '#d97706' : '#f59e0b');
      const labelText = this.thresholdLabel || `Threshold ≥ ${refThreshold}${this.unit}`;
      ctx.fillText(labelText, Math.max(padLeft + 6, width - padRight - ctx.measureText(labelText).width - 4), Math.max(padTop + 11, dy - 5));
      ctx.restore();
    }

    if (this.data.length === 0) {
      ctx.fillStyle = isLight ? '#475569' : '#94a3b8';
      const wsStatus = wsTelemetryState === 'ONLINE' ? 'Connected — awaiting first telemetry packet' : `Stream Offline (${getWsTelemetryUrl()})`;
      ctx.fillText(`No verified samples in buffer · ${wsStatus}`, padLeft + 12, padTop + plotH / 2);
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
      grad.addColorStop(0, `${this.color}30`);
      grad.addColorStop(1, `${this.color}02`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(points[0].x, padTop + plotH);
      points.forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.lineTo(points[points.length - 1].x, padTop + plotH);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      points.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }

    points.forEach((p, idx) => {
      const isAlert = refThreshold !== null && refThreshold !== undefined && p.val >= refThreshold;
      ctx.fillStyle = isAlert ? '#f59e0b' : this.color;
      ctx.beginPath();
      const radius = idx === this.hoverIndex ? 5 : (idx === points.length - 1 ? 3.8 : 2.2);
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();

      if (idx === 0 || idx === Math.floor(points.length / 2) || idx === points.length - 1) {
        ctx.fillStyle = isLight ? '#64748b' : '#64748b';
        ctx.fillText(p.label, Math.max(padLeft, Math.min(width - padRight - 52, p.x - 22)), height - 8);
      }
    });

    if (this.hoverIndex !== null && points[this.hoverIndex]) {
      const hp = points[this.hoverIndex];
      const tipText = `${hp.val.toFixed(1)}${this.unit} @ ${hp.label || `Sample #${this.hoverIndex + 1}`}`;
      const textW = ctx.measureText(tipText).width + 14;
      const boxX = Math.min(width - padRight - textW, Math.max(padLeft, hp.x - textW / 2));
      const boxY = Math.max(padTop + 2, hp.y - 28);

      ctx.fillStyle = isLight ? '#0f172a' : '#1e293b';
      ctx.fillRect(boxX, boxY, textW, 20);
      ctx.strokeStyle = this.color;
      ctx.strokeRect(boxX, boxY, textW, 20);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(tipText, boxX + 7, boxY + 14);
    }
  }
}

// ============================================================================
// 1. SECURITY, INPUT SANITIZATION & STRICT DATA TYPE VALIDATION
// ============================================================================

const IPV4_REGEX = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOST_PORT_REGEX = /^(([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+)(:\d{1,5})?$/;
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

export function isValidHostPort(hostStr) {
  return HOST_PORT_REGEX.test(String(hostStr).trim());
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

async function fetchWithTimeout(url, options = {}, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const isSameOriginTarget =
    typeof window !== 'undefined' &&
    window.location?.host &&
    server_host === window.location.host;
  try {
    return await fetch(url, {
      credentials: isSameOriginTarget ? 'same-origin' : 'include',
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// 2. STRICT GLOBAL VARIABLES & CENTRALIZED NETWORK CONFIGURATION
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

// Dynamic Endpoints (Central Server + Edge Nodes 1, 2, 3)
// Defaults to same-origin host when served by Nginx / Node.js backend.
// Auto-migrates only the known legacy Node-RED host (192.168.43.225:1880) when served from another origin,
// while preserving any intentional custom host and independent edge node IPs.
export const LEGACY_NODE_RED_HOST = '192.168.43.225:1880';

export function resolveInitialServerHost(rawStoredHost, currentBrowserHost = LEGACY_NODE_RED_HOST) {
  const effectiveBrowserHost = isValidHostPort(currentBrowserHost)
    ? String(currentBrowserHost).trim()
    : LEGACY_NODE_RED_HOST;
  const cleanedStored = sanitizeInput(String(rawStoredHost || ''));

  if (
    cleanedStored === LEGACY_NODE_RED_HOST &&
    effectiveBrowserHost !== LEGACY_NODE_RED_HOST
  ) {
    return { host: effectiveBrowserHost, migrated: true };
  }

  if (isValidHostPort(cleanedStored)) {
    return { host: cleanedStored, migrated: false };
  }

  return { host: effectiveBrowserHost, migrated: false };
}

const defaultBrowserHost =
  typeof window !== 'undefined' && window.location?.host
    ? window.location.host
    : LEGACY_NODE_RED_HOST;

const safeStorageGet = (key) => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
};

const safeStorageSet = (key, val) => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, val);
  } catch {}
};

const initialHostResolution = resolveInitialServerHost(
  safeStorageGet('lci_server_host'),
  defaultBrowserHost
);
if (initialHostResolution.migrated) {
  safeStorageSet('lci_server_host', initialHostResolution.host);
}

export let server_host = initialHostResolution.host;
export let ip_node1 = sanitizeInput(safeStorageGet('ip_node1') || '192.168.43.11');
export let ip_node2 = sanitizeInput(safeStorageGet('ip_node2') || '192.168.43.12');
export let ip_node3 = sanitizeInput(safeStorageGet('ip_node3') || '192.168.43.13');

function getNodeRedHttp() {
  const proto =
    typeof window !== 'undefined' &&
    window.location?.protocol === 'https:' &&
    server_host === window.location.host
      ? 'https:'
      : 'http:';
  return `${proto}//${server_host}`;
}

function getWsProtocol() {
  return typeof window !== 'undefined' &&
    window.location?.protocol === 'https:' &&
    server_host === window.location.host
    ? 'wss:'
    : 'ws:';
}

function getWsAuthQuery() {
  const token =
    typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem('lci_session_token') || ''
      : '';
  const isSameOrigin =
    typeof window !== 'undefined' &&
    window.location?.host &&
    server_host === window.location.host;
  if (!isSameOrigin && token && !token.startsWith('UNVERIFIED-') && token !== 'COOKIE_SESSION') {
    return `?token=${encodeURIComponent(token)}`;
  }
  return '';
}

function getWsTelemetryUrl() {
  return `${getWsProtocol()}//${server_host}/ws/telemetry${getWsAuthQuery()}`;
}

function getWsMfaUrl() {
  return `${getWsProtocol()}//${server_host}/ws/mfa${getWsAuthQuery()}`;
}

// Expose variables globally on window for direct browser inspection
if (typeof window !== 'undefined') {
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
    get server_host() { return server_host; },
    get ip_node1() { return ip_node1; },
    get ip_node2() { return ip_node2; },
    get ip_node3() { return ip_node3; }
  };
}

// Independent Evidence & Freshness Tracking per Subsystem
let hasReceivedTelemetry = false;
let lastTelemetryTimestamp = 0;
let lastNode2FrameTimestamp = 0;
let lastNode1EvidenceTimestamp = 0;
let lastNode3CaptureTimestamp = 0;
let node3ProbeStatus = 'STANDBY'; // 'STANDBY' | 'LOADING' | 'ONLINE' | 'UNREACHABLE'
let lastHttpApiSuccessTimestamp = 0;
let httpApiReachable = false;
let lastBackendReadySummary = 'Awaiting Probe';

let wsTelemetryState = 'OFFLINE'; // 'ONLINE' | 'OFFLINE'
let wsMfaState = 'OFFLINE'; // 'ONLINE' | 'OFFLINE'

let activeDbTable = 'access_logs';
let dbTableProvenance = {}; // { tableName: { status: 'LIVE' | 'UNREACHABLE', timestamp: number } }
let dbSortColumn = null;
let dbSortAsc = false;
let dbCurrentPage = 1;
let dbPageSize = 25;
let currentFilteredRows = [];

let activityFeed = [];
let mfaCountdownInterval = null;
let mfaRemainingSeconds = 10;

let tempChart = null;
let humChart = null;
let liveTempSamples = [];
let liveHumSamples = [];
let activeChartMode = 'live'; // 'live' | 'sqlite' | 'agg'

// Environmental Control Mode ("AUTO" | "MANUAL")
let currentControlMode = 'AUTO';

// Provisioning Face Capture State
let centralSettings = null;
let displayThresholds = { temperature_warning: 30, gas_warning_raw: 250, gas_critical_raw: 400 };

// Pending Confirmation Action Callback
let pendingConfirmCallback = null;

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
    if (countLabel) countLabel.textContent = `${count} Notification${count > 1 ? 's' : ''}`;
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
  while (container.children.length >= 3) container.firstElementChild.remove();
  container.appendChild(toast);
  updateToastToolbar();

  setTimeout(() => {
    toast.classList.add('toast-Out');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
        updateToastToolbar();
      }
    }, 220);
  }, 3400);
}

// ============================================================================
// 4. RBAC SESSION MANAGEMENT & SERVER-VERIFIED SECURITY GATING
// ============================================================================

function getActiveRole() {
  return sessionStorage.getItem('lci_rbac_role') || null;
}

function isServerAuthVerified() {
  return sessionStorage.getItem('lci_auth_verified') === 'true';
}

function getAuthHeaders() {
  const token = sessionStorage.getItem('lci_session_token') || '';
  const csrfToken = sessionStorage.getItem('lci_csrf_token') || '';
  const headers = {
    'Content-Type': 'application/json'
  };
  if (token && token !== 'COOKIE_SESSION') {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }
  return headers;
}

function isAuthenticated() {
  return Boolean(sessionStorage.getItem('lci_session_token') && getActiveRole());
}

function isPrivilegedAdmin() {
  return isServerAuthVerified() && getActiveRole() === 'Admin';
}

function applyRBACPermissions() {
  const role = getActiveRole() || 'Viewer';
  const verified = isServerAuthVerified();
  const isAdmin = role === 'Admin' && verified;
  const operatorName = sessionStorage.getItem('lci_operator_id') || 'Viewer';

  const opNameEl = document.getElementById('header-operator-name');
  if (opNameEl) opNameEl.textContent = operatorName;

  const roleHeaderLabel = document.getElementById('header-role-label');
  if (roleHeaderLabel) {
    roleHeaderLabel.textContent = role.toUpperCase();
    roleHeaderLabel.className = isAdmin ? 'text-mint' : 'text-cyber';
  }

  const authModeTag = document.getElementById('header-auth-mode-tag');
  if (authModeTag) {
    authModeTag.textContent = verified ? '· SQLite Verified' : '· Unverified Offline Mode';
    authModeTag.className = `auth-verification-text ${verified ? 'text-mint' : 'text-amber'}`;
  }

  const unverifiedBanner = document.getElementById('unverified-session-banner');
  if (unverifiedBanner) {
    unverifiedBanner.classList.toggle('hidden', verified);
  }

  const dispatchAuthStatus = document.getElementById('dispatch-auth-status');
  if (dispatchAuthStatus) {
    dispatchAuthStatus.textContent = isAdmin
      ? 'Verified Admin (Authorized)'
      : (verified ? 'Read-Only Viewer' : 'Locked (Unverified Offline Session)');
    dispatchAuthStatus.className = isAdmin ? 'text-mint' : 'text-amber';
  }

  // Disable all .action-btn, #open-ip-modal-btn, and .rbac-protected unless verified Admin
  document.querySelectorAll('.action-btn, #open-ip-modal-btn, .rbac-protected').forEach(btn => {
    btn.disabled = !isAdmin;
    btn.title = isAdmin
      ? ''
      : (verified
          ? 'Locked — Viewer role has read-only permissions'
          : 'Locked — Authenticate against the Central Backend to enable hardware control');
  });

  document.querySelectorAll('.rbac-protected-input').forEach(input => {
    input.disabled = !isAdmin;
  });

  document.querySelectorAll('.rbac-lock-tag').forEach(tag => {
    tag.classList.toggle('hidden', isAdmin);
    tag.textContent = verified ? 'Read-Only (Viewer)' : 'Locked (Offline Mode)';
  });

  // Hide Administration (#view-6) for non-Admins
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
      const titleEl = document.getElementById('current-view-title');
      if (titleEl) titleEl.textContent = 'Overview & Command Center';
    }
  } else if (isAdmin && sectionView6) {
    sectionView6.classList.remove('hidden');
  }

  document.getElementById('nav-item-view-7')?.classList.toggle('hidden', !isAdmin);
  document.getElementById('view-7')?.classList.toggle('hidden', !isAdmin);
  if (!isAdmin) document.getElementById('view-7')?.classList.remove('active');
  syncManualControlsPanel();
}

function syncManualControlsPanel() {
  const manualPanel = document.getElementById('manual-controls-panel');
  const modeBadge = document.getElementById('env-active-mode-badge');
  const fanModeSnap = document.getElementById('snap-fan-mode');

  if (modeBadge) {
    modeBadge.textContent = `ACTIVE MODE: ${currentControlMode}`;
    modeBadge.className = `status-tag ${currentControlMode === 'AUTO' ? 'status-nominal' : 'status-warning'}`;
  }
  if (fanModeSnap) {
    fanModeSnap.textContent = `Mode: ${currentControlMode}`;
  }

  if (!manualPanel) return;
  const showManual = isPrivilegedAdmin() && currentControlMode === 'MANUAL';
  manualPanel.classList.toggle('hidden', !showManual);
}

function lockAndLogoutSystem() {
  clearAllToasts();
  if (isServerAuthVerified()) {
    fetchWithTimeout(`${getNodeRedHttp()}/api/auth/logout`, {
      method: 'POST',
      headers: getAuthHeaders()
    }, 1500).catch(() => {});
  }

  sessionStorage.removeItem('lci_session_token');
  sessionStorage.removeItem('lci_csrf_token');
  sessionStorage.removeItem('lci_rbac_role');
  sessionStorage.removeItem('lci_operator_id');
  sessionStorage.removeItem('lci_auth_verified');
  sessionStorage.clear();

  if (authSessionAbortController) {
    authSessionAbortController.abort();
    authSessionAbortController = null;
  }

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
  liveTempSamples = [];
  liveHumSamples = [];

  hasReceivedTelemetry = false;
  lastTelemetryTimestamp = 0;
  lastNode2FrameTimestamp = 0;
  lastNode1EvidenceTimestamp = 0;
  wsTelemetryState = 'OFFLINE';
  wsMfaState = 'OFFLINE';
  currentControlMode = 'AUTO';

  if (tempChart) tempChart.reset();
  if (humChart) humChart.reset();

  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
  document.querySelector('.nav-item[data-view="view-1"]')?.classList.add('active');
  document.getElementById('view-1')?.classList.add('active');

  updateFacilityStatusAndFreshness();
  renderActivityFeed();
  renderMFAUI();
  renderDatabaseTable();
  renderSystemErrors();
  renderUserManagementTable();
  syncManualControlsPanel();

  const loginOverlay = document.getElementById('login-overlay');
  if (loginOverlay) loginOverlay.classList.remove('hidden');

  const passInput = document.getElementById('login_password');
  if (passInput) passInput.value = '';

  showToast('Session Terminated', 'Console locked and authenticated listeners unmounted.', 'info');
}

// ============================================================================
// 5. CONFIRMATION MODAL FOR CRITICAL / DESTRUCTIVE OPERATIONS
// ============================================================================

function openConfirmModal({ kicker, title, description, endpoint, payload, targetNode, confirmLabel, onConfirm }) {
  const modal = document.getElementById('confirm-action-modal');
  if (!modal) {
    if (typeof onConfirm === 'function') onConfirm();
    return;
  }
  const kickerEl = document.getElementById('confirm-modal-kicker');
  const titleEl = document.getElementById('confirm-modal-title');
  const descEl = document.getElementById('confirm-modal-desc');
  const epEl = document.getElementById('confirm-spec-endpoint');
  const payEl = document.getElementById('confirm-spec-payload');
  const nodeEl = document.getElementById('confirm-spec-node');
  const execBtn = document.getElementById('execute-confirm-modal-btn');

  if (kickerEl) kickerEl.textContent = kicker || 'Hardware Override Confirmation';
  if (titleEl) titleEl.textContent = title || 'Confirm Operation';
  if (descEl) descEl.textContent = description || '';
  if (epEl) epEl.textContent = endpoint || `POST ${getNodeRedHttp()}/api/command`;
  if (payEl) payEl.textContent = payload || '';
  if (nodeEl) nodeEl.textContent = targetNode || '';
  if (execBtn) execBtn.textContent = confirmLabel || 'Confirm & Dispatch';

  pendingConfirmCallback = onConfirm;
  modal.classList.remove('hidden');
}

function closeConfirmModal() {
  const modal = document.getElementById('confirm-action-modal');
  if (modal) modal.classList.add('hidden');
  pendingConfirmCallback = null;
}

// ============================================================================
// 6. VIEW 6: SQLITE USER DIRECTORY (/api/logs/system_users) — CREDENTIALS MASKED
// ============================================================================

async function fetchSystemUsers() {
  if (!isPrivilegedAdmin()) return;
  const syncBadge = document.getElementById('user-sync-badge');
  try {
    const res = await fetchWithTimeout(`${getNodeRedHttp()}/api/logs/system_users`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    httpApiReachable = true;
    lastHttpApiSuccessTimestamp = Date.now();
    if (Array.isArray(rows)) {
      system_users = rows;
    }
    if (syncBadge) {
      syncBadge.textContent = 'SQLite Synced';
      syncBadge.className = 'status-tag status-nominal';
    }
  } catch {
    if (syncBadge) {
      syncBadge.textContent = 'Backend Unreachable';
      syncBadge.className = 'status-tag status-offline';
    }
  }
  renderUserManagementTable();
}

function renderUserManagementTable() {
  const tbody = document.getElementById('user-management-table-body');
  const countLabel = document.getElementById('user-count-label');
  if (!tbody) return;

  if (countLabel) {
    countLabel.textContent = `${system_users.length} User${system_users.length === 1 ? '' : 's'}`;
  }

  if (system_users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">${getEmptyTableIllustrationHTML(
      'No User Records Loaded from SQLite "system_users"',
      `Verify connection to ${getNodeRedHttp()}/api/logs/system_users or provision a new operator credential.`
    )}</td></tr>`;
    return;
  }

  tbody.innerHTML = system_users
    .map(u => {
      const uid = u.id;
      const uname = u.username || u.name || '';
      const role = u.role === 'Admin' ? 'Admin' : 'Viewer';

      return `
        <tr>
          <td class="tabular-nums">#${escapeHTML(uid)}</td>
          <td><strong>${escapeHTML(uname)}</strong></td>
          <td>${u.enabled ? 'Enabled' : 'Disabled'}</td>
          <td>
            <span class="status-tag ${role === 'Admin' ? 'status-nominal' : 'status-info'}">${escapeHTML(role)}</span>
          </td>
          <td>
            <div class="table-actions-cell">
              <button type="button" class="btn-cyber btn-sm" data-user-action="toggle-role" data-user-id="${escapeHTML(uid)}" data-username="${escapeHTML(uname)}" data-current-role="${escapeHTML(role)}">
                Set ${role === 'Admin' ? 'Viewer' : 'Admin'}
              </button>
              <button type="button" class="btn-rose btn-sm" data-user-action="delete-user" data-user-id="${escapeHTML(uid)}" data-username="${escapeHTML(uname)}">
                Delete
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

// ============================================================================
// 7. AUTHENTICATED VIEW LISTENERS & INTERACTION HANDLERS
// ============================================================================

function switchActiveView(viewId) {
  const viewTitles = {
    'view-1': 'Overview & Command Center',
    'view-2': 'Smart Access & Biometric MFA',
    'view-3': 'Environment & Actuator Control',
    'view-4': 'Events, Alarms & SQLite Audit Logs',
    'view-5': 'System Health & Device Diagnostics',
    'view-6': 'Dashboard Administration',
    'view-7': 'People & Credentials',
    'view-8': 'Devices & Room'
  };

  if (['view-6', 'view-7'].includes(viewId) && !isPrivilegedAdmin()) {
    showToast('Access Restricted', 'Administration requires a server-verified Admin session.', 'error');
    return;
  }

  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-view') === viewId);
  });
  document.querySelectorAll('.view-section').forEach(s => {
    s.classList.toggle('active', s.id === viewId);
  });

  const titleEl = document.getElementById('current-view-title');
  if (titleEl) titleEl.textContent = viewTitles[viewId] || 'LCI-SFM Console';

  // Close mobile sidebar drawer if open
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar && sidebar.classList.contains('mobile-open')) {
    sidebar.classList.remove('mobile-open');
    if (backdrop) backdrop.classList.add('hidden');
  }

  if (viewId === 'view-3') {
    requestAnimationFrame(() => {
      if (tempChart) tempChart.draw();
      if (humChart) humChart.draw();
    });
  }
  if (viewId === 'view-4') {
    fetchSQLiteLogs(activeDbTable);
  }
  if (viewId === 'view-6') {
    fetchSystemUsers();
  }
}

function requestDoorUnlockAction(triggerBtn) {
  if (!isPrivilegedAdmin()) {
    showToast('Authorization Required', 'Emergency Door Unlock requires a verified Admin session.', 'error');
    return;
  }
  const nextState = door_state === 'OPEN' ? 'CLOSED' : 'OPEN';
  const requireConfirm = document.getElementById('require-door-confirm-toggle')?.checked ?? false;

  const executeUnlock = () => {
    withButtonLoading(triggerBtn, () => {
      sendCommand('EMERGENCY_DOOR_UNLOCK', nextState);
    });
  };

  if (requireConfirm) {
    openConfirmModal({
      kicker: 'Physical Security Override Confirmation',
      title: `Confirm Door Solenoid ${nextState === 'OPEN' ? 'Unlock' : 'Lock'}`,
      description: `This action dispatches an authenticated command to the central backend to ${nextState === 'OPEN' ? 'de-energize (UNLOCK)' : 'energize (LOCK)'} the 12V magnetic lock on Node 1.`,
      endpoint: `POST ${getNodeRedHttp()}/api/command`,
      payload: `EMERGENCY_DOOR_UNLOCK -> ${nextState}`,
      targetNode: `Node 1 (${ip_node1})`,
      confirmLabel: nextState === 'OPEN' ? 'Confirm Emergency Unlock' : 'Confirm Lock Engagement',
      onConfirm: executeUnlock
    });
  } else {
    executeUnlock();
  }
}

function mountAuthenticatedViewListeners() {
  if (authSessionAbortController) {
    authSessionAbortController.abort();
  }
  authSessionAbortController = new AbortController();
  const { signal } = authSessionAbortController;

  // Primary Sidebar Navigation
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const viewId = btn.getAttribute('data-view');
      if (viewId) switchActiveView(viewId);
    }, { signal });
  });

  // Quick Jump Links (e.g., "Full Audit Log", "Open Full Diagnostics")
  document.querySelectorAll('[data-nav-jump]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.getAttribute('data-nav-jump');
      if (targetView) switchActiveView(targetView);
    }, { signal });
  });

  // View 1 & View 2 Quick Action Buttons
  const btnUnlockDoor = document.getElementById('cmd-unlock-door');
  if (btnUnlockDoor) {
    btnUnlockDoor.addEventListener('click', () => requestDoorUnlockAction(btnUnlockDoor), { signal });
  }

  const accessViewUnlockBtn = document.getElementById('access-view-unlock-btn');
  if (accessViewUnlockBtn) {
    accessViewUnlockBtn.addEventListener('click', () => requestDoorUnlockAction(accessViewUnlockBtn), { signal });
  }

  const btnToggleFan = document.getElementById('cmd-toggle-fan');
  if (btnToggleFan) {
    btnToggleFan.addEventListener('click', () => {
      if (!isPrivilegedAdmin()) return;
      withButtonLoading(btnToggleFan, () => {
        const next = fan_relay === 'ON' ? 'OFF' : 'ON';
        sendCommand('TOGGLE_HVAC_FAN', next);
      });
    }, { signal });
  }

  const btnToggleLight = document.getElementById('cmd-toggle-light');
  if (btnToggleLight) {
    btnToggleLight.addEventListener('click', () => {
      if (!isPrivilegedAdmin()) return;
      withButtonLoading(btnToggleLight, () => {
        const next = light_state === 'ON' ? 'OFF' : 'ON';
        sendCommand('TOGGLE_AUX_LIGHT', next);
      });
    }, { signal });
  }

  // View 2 Camera Refresh
  const refreshCamBtn = document.getElementById('refresh-cam-btn');
  if (refreshCamBtn) {
    refreshCamBtn.addEventListener('click', () => {
      refreshCameraSnapshot(true);
    }, { signal });
  }

  // View 3 Telemetry Chart Data Source Segmented Control
  const chartLiveBtn = document.getElementById('chart-mode-live-btn');
  const chartSqliteBtn = document.getElementById('chart-mode-sqlite-btn');
  const chartAggBtn = document.getElementById('chart-mode-agg-btn');
  const chartAggNotice = document.getElementById('chart-agg-notice');
  const chartWindowDesc = document.getElementById('chart-window-desc');

  const setChartMode = async (mode) => {
    activeChartMode = mode;
    [chartLiveBtn, chartSqliteBtn, chartAggBtn].forEach(b => b?.classList.remove('active'));
    if (mode === 'live') chartLiveBtn?.classList.add('active');
    if (mode === 'sqlite') chartSqliteBtn?.classList.add('active');
    if (mode === 'agg') chartAggBtn?.classList.add('active');

    if (chartAggNotice) chartAggNotice.classList.toggle('hidden', mode !== 'agg');

    if (mode === 'live') {
      if (chartWindowDesc) {
        chartWindowDesc.innerHTML = `Displaying real-time 30-sample FIFO sliding window captured from <code>${escapeHTML(getWsTelemetryUrl())}</code> (Node 2 polls every 2,000 ms).`;
      }
      syncChartsWithActiveMode();
    } else if (mode === 'sqlite') {
      if (chartWindowDesc) {
        chartWindowDesc.innerHTML = `Displaying up to 30 recent persisted records from SQLite <code>environmental_telemetry</code> via <code>GET /api/logs/environmental_telemetry</code>.`;
      }
      await fetchSQLiteLogs('environmental_telemetry');
      syncChartsWithActiveMode();
    } else if (mode === 'agg') {
      if (chartWindowDesc) {
        chartWindowDesc.innerHTML = `Displaying 24-hour time-bucketed rollups (15m intervals) from <code>GET /api/telemetry/aggregate?range=24h&amp;bucket=15m</code>.`;
      }
      await fetchTelemetryAggregation('24h', '15m');
    }
  };

  chartLiveBtn?.addEventListener('click', () => setChartMode('live'), { signal });
  chartSqliteBtn?.addEventListener('click', () => setChartMode('sqlite'), { signal });
  chartAggBtn?.addEventListener('click', () => setChartMode('agg'), { signal });

  // View 3 Override Mode Buttons (AUTO / MANUAL)
  const autoBtn = document.getElementById('mode-auto-btn');
  const manualBtn = document.getElementById('mode-manual-btn');

  autoBtn?.addEventListener('click', async () => {
    if (!isPrivilegedAdmin()) return;
    const ok = await sendCommand('SET_CONTROL_MODE', 'AUTO');
    if (ok || !httpApiReachable) {
      currentControlMode = 'AUTO';
      autoBtn.className = 'btn-mint rbac-protected';
      if (manualBtn) manualBtn.className = 'btn-outline rbac-protected';
      syncManualControlsPanel();
    }
  }, { signal });

  manualBtn?.addEventListener('click', async () => {
    if (!isPrivilegedAdmin()) return;
    const ok = await sendCommand('SET_CONTROL_MODE', 'MANUAL');
    if (ok || !httpApiReachable) {
      currentControlMode = 'MANUAL';
      manualBtn.className = 'btn-cyber rbac-protected';
      if (autoBtn) autoBtn.className = 'btn-outline rbac-protected';
      syncManualControlsPanel();
    }
  }, { signal });

  const envManualFanBtn = document.getElementById('env-manual-toggle-fan');
  envManualFanBtn?.addEventListener('click', () => {
    if (!isPrivilegedAdmin() || currentControlMode !== 'MANUAL') return;
    withButtonLoading(envManualFanBtn, () => {
      const next = fan_relay === 'ON' ? 'OFF' : 'ON';
      sendCommand('TOGGLE_HVAC_FAN', next);
    });
  }, { signal });

  const envManualLightBtn = document.getElementById('env-manual-toggle-light');
  envManualLightBtn?.addEventListener('click', () => {
    if (!isPrivilegedAdmin() || currentControlMode !== 'MANUAL') return;
    withButtonLoading(envManualLightBtn, () => {
      const next = light_state === 'ON' ? 'OFF' : 'ON';
      sendCommand('TOGGLE_AUX_LIGHT', next);
    });
  }, { signal });

  // View 4 Database Explorer Tabs, Filters, Search, Sort, Pagination & CSV Export
  document.querySelectorAll('.tab-btn').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeDbTable = tab.getAttribute('data-table') || 'access_logs';
      dbCurrentPage = 1;
      dbSortColumn = null;
      fetchSQLiteLogs(activeDbTable);
    }, { signal });
  });

  const searchInput = document.getElementById('db-search-input');
  const searchClearBtn = document.getElementById('db-search-clear-btn');

  searchInput?.addEventListener('input', () => {
    const cleaned = sanitizeInput(searchInput.value);
    if (searchInput.value !== cleaned) {
      searchInput.value = cleaned;
    }
    searchClearBtn?.classList.toggle('hidden', searchInput.value.length === 0);
    dbCurrentPage = 1;
    renderDatabaseTable();
  }, { signal });

  searchClearBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    searchClearBtn.classList.add('hidden');
    dbCurrentPage = 1;
    renderDatabaseTable();
    searchInput?.focus();
  }, { signal });

  document.getElementById('db-time-filter')?.addEventListener('change', () => {
    dbCurrentPage = 1;
    renderDatabaseTable();
  }, { signal });

  document.getElementById('db-status-filter')?.addEventListener('change', () => {
    dbCurrentPage = 1;
    renderDatabaseTable();
  }, { signal });

  document.getElementById('db-page-size')?.addEventListener('change', (e) => {
    dbPageSize = Number(e.target.value) || 25;
    dbCurrentPage = 1;
    renderDatabaseTable();
  }, { signal });

  document.getElementById('db-prev-page-btn')?.addEventListener('click', () => {
    if (dbCurrentPage > 1) {
      dbCurrentPage -= 1;
      renderDatabaseTable();
    }
  }, { signal });

  document.getElementById('db-next-page-btn')?.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(currentFilteredRows.length / dbPageSize));
    if (dbCurrentPage < totalPages) {
      dbCurrentPage += 1;
      renderDatabaseTable();
    }
  }, { signal });

  document.getElementById('db-refresh-btn')?.addEventListener('click', () => {
    fetchSQLiteLogs(activeDbTable, true);
  }, { signal });

  document.getElementById('db-export-csv-btn')?.addEventListener('click', () => {
    exportCurrentTableToCSV();
  }, { signal });

  // Column Sorting & Row Detail Inspector on View 4 Table
  document.getElementById('db-table-head')?.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort-col]');
    if (!th) return;
    const col = th.getAttribute('data-sort-col');
    if (dbSortColumn === col) {
      dbSortAsc = !dbSortAsc;
    } else {
      dbSortColumn = col;
      dbSortAsc = true;
    }
    renderDatabaseTable();
  }, { signal });

  document.getElementById('db-table-body')?.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-row-idx]');
    if (!tr) return;
    const idx = Number(tr.getAttribute('data-row-idx'));
    const record = currentFilteredRows[idx];
    if (record) {
      openEventDetailModal(activeDbTable, record);
    }
  }, { signal });

  // View 5 Diagnostics Probe & Refresh Errors
  document.getElementById('refresh-errors-btn')?.addEventListener('click', () => {
    fetchSQLiteLogs('system_errors', true);
  }, { signal });

  document.getElementById('probe-health-btn')?.addEventListener('click', async () => {
    showToast('Probing Subsystems', `Checking REST & readiness endpoints on ${getNodeRedHttp()}...`, 'info');
    await probeBackendReadiness();
    await fetchSQLiteLogs('system_errors');
    await fetchSQLiteLogs('access_logs');
    updateHeartbeatDiagnosticsUI();
  }, { signal });

  // View 6: Refresh SQLite Users Button
  document.getElementById('refresh-users-btn')?.addEventListener('click', () => {
    fetchSystemUsers();
  }, { signal });

  // View 6: Admin Profile Form (Update Admin Username & Password in SQLite)
  document.getElementById('admin-profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isPrivilegedAdmin()) return;

    const newUsername = sanitizeInput(document.getElementById('admin_new_username').value);
    const newPassword = document.getElementById('admin_new_password').value;
    const confirmPassEl = document.getElementById('admin_confirm_password');
    const confirmPassword = confirmPassEl ? confirmPassEl.value : newPassword;

    if (!SAFE_NAME_REGEX.test(newUsername)) {
      showToast('Validation Error', 'Admin Username must be 2–32 alphanumeric characters.', 'error');
      return;
    }
    if (newPassword.length < 12) {
      showToast('Validation Error', 'Admin Password must be at least 12 characters.', 'error');
      return;
    }
    if (confirmPassEl && newPassword !== confirmPassword) {
      showToast('Validation Error', 'Password confirmation does not match.', 'error');
      return;
    }

    const currentUsername = sessionStorage.getItem('lci_operator_id') || 'admin';
    const submitBtn = document.getElementById('admin-profile-submit-btn');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetchWithTimeout(`${getNodeRedHttp()}/api/auth/admin-profile`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          currentUsername,
          newUsername,
          newPassword
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      sessionStorage.setItem('lci_operator_id', newUsername);
      document.getElementById('admin_new_password').value = '';
      if (confirmPassEl) confirmPassEl.value = '';
      applyRBACPermissions();
      pushActivityEvent('SECURITY', `Admin Profile Updated in SQLite: ${newUsername}`);
      showToast('Credentials Updated', `Administrator profile updated in SQLite for "${newUsername}".`, 'success');
      await fetchSystemUsers();
    } catch {
      showToast('Update Failed', `Could not reach ${getNodeRedHttp()}/api/auth/admin-profile. Credentials unchanged.`, 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = !isPrivilegedAdmin();
    }
  }, { signal });

  // View 6: IP Settings Form & Reset-to-Current-Host Action
  document.getElementById('settings-reset-host-btn')?.addEventListener('click', () => {
    if (!isPrivilegedAdmin()) return;
    const setSrv = document.getElementById('set_server_host');
    if (setSrv) setSrv.value = defaultBrowserHost;
    showToast('Current Host Populated', `Central server field set to ${defaultBrowserHost}. Click Save & Reconnect to apply.`, 'info');
  }, { signal });

  document.getElementById('settings-ip-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isPrivilegedAdmin()) return;
    const rawHost = document.getElementById('set_server_host')?.value || server_host;
    await saveNodeIPs(
      document.getElementById('set_ip_node1').value,
      document.getElementById('set_ip_node2').value,
      document.getElementById('set_ip_node3').value,
      rawHost
    );
  }, { signal });

  // View 6: User Management Table Row Actions (With Confirmation & Real Backend Verification)
  document.getElementById('user-management-table-body')?.addEventListener('click', (e) => {
    if (!isPrivilegedAdmin()) return;
    const btn = e.target.closest('button[data-user-action]');
    if (!btn) return;

    const action = btn.getAttribute('data-user-action');
    const userId = Number.parseInt(btn.getAttribute('data-user-id'), 10);
    const uname = btn.getAttribute('data-username') || `User #${userId}`;
    if (!Number.isInteger(userId)) return;

    if (action === 'toggle-role') {
      const currentRole = btn.getAttribute('data-current-role') === 'Admin' ? 'Admin' : 'Viewer';
      const nextRole = currentRole === 'Admin' ? 'Viewer' : 'Admin';

      openConfirmModal({
        kicker: 'Role Clearance Modification',
        title: `Change Clearance for ${uname}`,
        description: `Modify operator role from ${currentRole} to ${nextRole} in SQLite system_users.`,
        endpoint: `POST ${getNodeRedHttp()}/api/users/role`,
        payload: `id: ${userId}, role: "${nextRole}"`,
        targetNode: 'SQLite Database (system_users)',
        confirmLabel: `Set Role to ${nextRole}`,
        onConfirm: async () => {
          try {
            const res = await fetchWithTimeout(`${getNodeRedHttp()}/api/users/role`, {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify({ id: userId, role: nextRole })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            pushActivityEvent('ADMIN', `Updated Role for ${uname} -> ${nextRole}`);
            showToast('Role Updated', `${uname} clearance updated to ${nextRole} in SQLite.`, 'success');
            await fetchSystemUsers();
          } catch {
            showToast('Role Update Failed', `Central backend unreachable; role was not modified.`, 'error');
          }
        }
      });
    } else if (action === 'delete-user') {
      openConfirmModal({
        kicker: 'Destructive Credential Revocation',
        title: `Delete Operator "${uname}"`,
        description: `Permanently revoke RFID, PIN, and console access for ${uname} (#${userId}) from SQLite system_users.`,
        endpoint: `POST ${getNodeRedHttp()}/api/users/delete`,
        payload: `id: ${userId}`,
        targetNode: 'SQLite Database (system_users)',
        confirmLabel: 'Confirm Delete User',
        onConfirm: async () => {
          try {
            const res = await fetchWithTimeout(`${getNodeRedHttp()}/api/users/delete`, {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify({ id: userId })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            pushActivityEvent('ADMIN', `Revoked & Deleted User: ${uname}`);
            showToast('User Deleted', `Removed ${uname} from SQLite system_users.`, 'info');
            await fetchSystemUsers();
          } catch {
            showToast('Deletion Failed', `Central backend unreachable; user was not deleted.`, 'error');
          }
        }
      });
    }
  }, { signal });
}

// ============================================================================
// 8. HEADER UTILITIES: LIVE DIGITAL CLOCK, FULLSCREEN, THEME & RESPONSIVE SIDEBAR
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
      showToast('Fullscreen Unavailable', 'Fullscreen mode is restricted by the current browser environment.', 'info');
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
    });
  }

  const sidebar = document.getElementById('sidebar');
  const mainShell = document.getElementById('main-shell');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const backdrop = document.getElementById('sidebar-backdrop');
  const isCollapsed = localStorage.getItem('lci_sidebar_collapsed') === 'true';

  if (isCollapsed && sidebar && mainShell && window.innerWidth > 960) {
    sidebar.classList.add('collapsed');
    mainShell.classList.add('expanded');
  }

  if (toggleBtn && sidebar && mainShell) {
    toggleBtn.addEventListener('click', () => {
      if (window.innerWidth <= 960) {
        const isOpen = sidebar.classList.toggle('mobile-open');
        backdrop?.classList.toggle('hidden', !isOpen);
      } else {
        const collapsed = sidebar.classList.toggle('collapsed');
        mainShell.classList.toggle('expanded', collapsed);
        localStorage.setItem('lci_sidebar_collapsed', String(collapsed));
        setTimeout(() => {
          if (tempChart) tempChart.draw();
          if (humChart) humChart.draw();
        }, 220);
      }
    });
  }

  backdrop?.addEventListener('click', () => {
    sidebar?.classList.remove('mobile-open');
    backdrop.classList.add('hidden');
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 960) {
      sidebar?.classList.remove('mobile-open');
      backdrop?.classList.add('hidden');
    }
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
// 9. BUTTON LOADING STATES (1.5-Second Anti-Spam Lock + Pure CSS Spinner)
// ============================================================================

function withButtonLoading(buttonEl, actionCallback) {
  if (!buttonEl || buttonEl.disabled) return;

  const originalHtml = buttonEl.innerHTML;
  buttonEl.disabled = true;
  buttonEl.innerHTML = `<span class="css-spinner" aria-hidden="true"></span><span>Dispatching...</span>`;

  try {
    actionCallback();
  } finally {
    setTimeout(() => {
      buttonEl.disabled = !isPrivilegedAdmin();
      buttonEl.innerHTML = originalHtml;
    }, 1500);
  }
}

// ============================================================================
// 10. DYNAMIC IP & SERVER HOST CONFIGURATION
// ============================================================================

function openIpModal() {
  if (!isPrivilegedAdmin()) {
    showToast('Authorization Required', 'Endpoint configuration requires a verified Admin session.', 'error');
    return;
  }
  const modal = document.getElementById('startup-modal');
  const srvInput = document.getElementById('modal_server_host');
  if (srvInput) srvInput.value = server_host || defaultBrowserHost;
  document.getElementById('modal_ip_node1').value = ip_node1 || '192.168.43.11';
  document.getElementById('modal_ip_node2').value = ip_node2 || '192.168.43.12';
  document.getElementById('modal_ip_node3').value = ip_node3 || '192.168.43.13';
  modal?.classList.remove('hidden');
}

function closeIpModal() {
  document.getElementById('startup-modal')?.classList.add('hidden');
}

function checkNodeIPsOnStartup() {
  if (!isValidIPv4(ip_node1)) ip_node1 = '192.168.43.11';
  if (!isValidIPv4(ip_node2)) ip_node2 = '192.168.43.12';
  if (!isValidIPv4(ip_node3)) ip_node3 = '192.168.43.13';
  if (!isValidHostPort(server_host)) server_host = defaultBrowserHost;
  syncIPInputs();
}

async function saveNodeIPs(rawN1, rawN2, rawN3, rawServerHost = server_host) {
  const n1 = sanitizeInput(rawN1);
  const n2 = sanitizeInput(rawN2);
  const n3 = sanitizeInput(rawN3);
  const srv = sanitizeInput(rawServerHost || server_host);

  if (!isValidIPv4(n1) || !isValidIPv4(n2) || !isValidIPv4(n3)) {
    showToast('Invalid IPv4 Address', 'Nodes 1, 2, and 3 must be valid IPv4 addresses (e.g. 192.168.43.11).', 'error');
    return false;
  }
  if (!isValidHostPort(srv)) {
    showToast('Invalid Server Host', 'Server host must be a valid host or IPv4:Port (e.g. localhost:3000 or 192.168.43.225:3000).', 'error');
    return false;
  }

  if (!isPrivilegedAdmin()) return false;
  try {
    const current = centralSettings || (await managementApi('/settings')).settings;
    const payload = {
      revision: current.revision, facility_name: current.facility_name, room_name: current.room_name,
      nodes: { node1: { ...current.nodes.node1, ip: n1 }, node2: { ...current.nodes.node2, ip: n2 }, node3: { ...current.nodes.node3, ip: n3 } },
      display_thresholds: current.display_thresholds
    };
    const saved = await managementApi('/settings', { method: 'PUT', body: payload });
    applyCentralSettings(saved.settings);
    document.dispatchEvent(new CustomEvent('lci-settings-updated', { detail: saved.settings }));
    const hostChanged = srv !== server_host;
    if (hostChanged) {
      // End the current session at its original host before changing the gateway.
      lockAndLogoutSystem();
      server_host = srv;
      safeStorageSet('lci_server_host', server_host);
      centralSettings = null;
      syncIPInputs();
    }
    showToast('Shared Addresses Saved', hostChanged ? 'Gateway changed. Sign in to the selected server.' : 'Node addresses saved centrally. Configure the physical device network separately.', 'success');
    return true;
  } catch (error) {
    showToast('Settings Not Saved', error.message, 'error');
    return false;
  }
}

async function managementApi(path, options = {}) {
  const res = await fetchWithTimeout(`${getNodeRedHttp()}/api/v1${path}`, {
    ...options, headers: getAuthHeaders(),
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  }, 8000);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function applyCentralSettings(settings) {
  centralSettings = settings;
  ip_node1 = settings.nodes.node1.ip;
  ip_node2 = settings.nodes.node2.ip;
  ip_node3 = settings.nodes.node3.ip;
  displayThresholds = settings.display_thresholds;
  syncIPInputs();
  if (tempChart) {
    tempChart.warningThreshold = displayThresholds.temperature_warning;
    tempChart.thresholdLabel = 'Display warning';
    tempChart.draw();
  }
  updateFacilityStatusAndFreshness();
}

function syncIPInputs() {
  const setSrv = document.getElementById('set_server_host');
  if (setSrv) setSrv.value = server_host;
  const loginSrv = document.getElementById('login_server_host');
  if (loginSrv) loginSrv.value = server_host;
  const modalSrv = document.getElementById('modal_server_host');
  if (modalSrv) modalSrv.value = server_host;
  const setN1 = document.getElementById('set_ip_node1');
  if (setN1) setN1.value = ip_node1;
  const setN2 = document.getElementById('set_ip_node2');
  if (setN2) setN2.value = ip_node2;
  const setN3 = document.getElementById('set_ip_node3');
  if (setN3) setN3.value = ip_node3;

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  setText('header-server-host', server_host);
  setText('offline-banner-host', server_host);
  setText('login-endpoint-display', `${getNodeRedHttp()}/api/auth/login`);
  setText('login-summary-host', server_host);
  setText('hb-ip-server', server_host);
  setText('hb-ip-node1', ip_node1);
  setText('hb-ip-node2', ip_node2);
  setText('hb-ip-node3', ip_node3);
  setText('topo-ip-server', server_host);
  setText('topo-ip-node1', ip_node1);
  setText('topo-ip-node2', ip_node2);
  setText('topo-ip-node3', ip_node3);
  setText('access-node1-ip', ip_node1);
  setText('cam-endpoint-label', `http://${ip_node3}/capture.jpg`);
  setText('diag-effective-http', `${getNodeRedHttp()}/api/*`);
  setText('diag-effective-ws-tel', `${getWsProtocol()}//${server_host}/ws/telemetry`);
  setText('diag-effective-ws-mfa', `${getWsProtocol()}//${server_host}/ws/mfa`);
}

async function refreshCameraSnapshot(userInitiated = false) {
  const img = document.getElementById('biometric-camera-img');
  const fallback = document.getElementById('camera-fallback-overlay');
  const fallbackTitle = document.getElementById('camera-fallback-title');
  const fallbackText = document.getElementById('camera-fallback-text');
  const camBadge = document.getElementById('cam-status-badge');
  const lastAttemptEl = document.getElementById('cam-last-attempt');

  if (!img || !isValidIPv4(ip_node3)) return;

  node3ProbeStatus = 'LOADING';
  if (camBadge) {
    camBadge.textContent = 'REQUESTING...';
    camBadge.className = 'status-tag status-warning';
  }
  if (lastAttemptEl) {
    lastAttemptEl.textContent = `Last request: ${new Date().toLocaleTimeString()}`;
  }

  img.onload = () => {
    node3ProbeStatus = 'ONLINE';
    lastNode3CaptureTimestamp = Date.now();
    img.classList.remove('hidden');
    fallback?.classList.add('hidden');
    if (camBadge) {
      camBadge.textContent = 'FRAME CAPTURED';
      camBadge.className = 'status-tag status-nominal';
    }
    if (userInitiated) {
      showToast('Frame Captured', `Received JPEG snapshot from Node 3 (${ip_node3}).`, 'success');
    }
    updateHeartbeatDiagnosticsUI();
  };

  img.onerror = () => {
    node3ProbeStatus = 'UNREACHABLE';
    img.classList.add('hidden');
    fallback?.classList.remove('hidden');
    if (fallbackTitle) fallbackTitle.textContent = 'Node 3 Optical Endpoint Unreachable / Asleep';
    if (fallbackText) {
      fallbackText.textContent = `Could not retrieve http://${ip_node3}/capture.jpg. Node 3 stays in low-power sleep until PIR motion wakes the OV2640 sensor, or the node is offline.`;
    }
    if (camBadge) {
      camBadge.textContent = 'UNREACHABLE / SLEEP';
      camBadge.className = 'status-tag status-offline';
    }
    if (userInitiated) {
      showToast('Camera Unreachable', `No response from http://${ip_node3}/capture.jpg.`, 'error');
    }
    updateHeartbeatDiagnosticsUI();
  };

  try {
    const response = await fetchWithTimeout(`${getNodeRedHttp()}/api/v1/devices/node3/snapshot?t=${Date.now()}`, { headers: getAuthHeaders() }, 6000);
    if (!response.ok) throw new Error('Snapshot unavailable');
    const objectUrl = URL.createObjectURL(await response.blob());
    const loaded = img.onload, failed = img.onerror;
    img.onload = () => { URL.revokeObjectURL(objectUrl); loaded(); };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); failed(); };
    img.src = objectUrl;
  } catch { img.onerror?.(); }
}

// ============================================================================
// 11. TELEMETRY, SPARKLINES, MFA & OPERATIONAL OVERVIEW LOGIC
// ============================================================================

function updateCircularGauge(arcId, value, maxVal) {
  const arc = document.getElementById(arcId);
  if (!arc) return;
  const circumference = 314.16;
  const clamped = Math.max(0, Math.min(maxVal, Number(value) || 0));
  const offset = circumference - (clamped / maxVal) * circumference;
  arc.style.strokeDashoffset = offset.toFixed(2);
}

function renderMiniSparkline(svgId, values, minVal, maxVal, strokeColor) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  if (!Array.isArray(values) || values.length < 2) {
    svg.innerHTML = '';
    return;
  }
  const w = 80;
  const h = 24;
  const recent = values.slice(-15);
  const pts = recent.map((v, idx) => {
    const x = (idx / Math.max(1, recent.length - 1)) * w;
    const clamped = Math.max(minVal, Math.min(maxVal, v));
    const y = h - 2 - ((clamped - minVal) / Math.max(1, maxVal - minVal)) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  svg.innerHTML = `<polyline fill="none" stroke="${strokeColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${pts}"></polyline>`;
}

export function handleTelemetryPayload(payload) {
  if (!payload || typeof payload !== 'object') return;

  if (payload.type === 'command_ack') {
    const lastResultEl = document.getElementById('dispatch-last-result');
    if (lastResultEl) {
      lastResultEl.textContent = `Hardware ACK (${payload.lifecycle_state}): ${payload.node_id} @ ${new Date().toLocaleTimeString()}`;
      lastResultEl.className = 'tabular-nums text-mint';
    }
    pushActivityEvent('ACK', `Edge node ${payload.node_id} confirmed command (${payload.lifecycle_state})`);
    return;
  }

  const now = Date.now();
  hasReceivedTelemetry = true;
  lastTelemetryTimestamp = now;
  lastNode2FrameTimestamp = now;

  if (payload.door_state !== undefined || payload.node === 'access_01' || payload.node_id === 'node1') {
    lastNode1EvidenceTimestamp = now;
  }

  if (typeof payload.temperature === 'number' && Number.isFinite(payload.temperature)) {
    temperature = payload.temperature;
  } else if (typeof payload.temp === 'number' && Number.isFinite(payload.temp)) {
    temperature = payload.temp;
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
  if (snapDoor) {
    snapDoor.textContent = door_state;
    snapDoor.className = `card-value tabular-nums ${door_state === 'CLOSED' ? 'text-mint' : 'text-rose'}`;
  }

  const snapLight = document.getElementById('snap-light');
  if (snapLight) {
    snapLight.textContent = light_state;
    snapLight.className = `card-value tabular-nums ${light_state === 'ON' ? 'text-mint' : 'text-cyber'}`;
  }

  const snapFan = document.getElementById('snap-fan');
  if (snapFan) {
    snapFan.textContent = fan_relay;
    snapFan.className = `card-value tabular-nums ${fan_relay === 'ON' ? 'text-mint' : 'text-cyber'}`;
  }

  const manualFanLabel = document.getElementById('manual-fan-state-label');
  if (manualFanLabel) manualFanLabel.textContent = fan_relay;
  const manualLightLabel = document.getElementById('manual-light-state-label');
  if (manualLightLabel) manualLightLabel.textContent = light_state;

  const snapTemp = document.getElementById('snap-temp');
  if (snapTemp) {
    snapTemp.textContent = `${temperature.toFixed(1)} °C`;
    snapTemp.className = `card-value tabular-nums ${temperature > displayThresholds.temperature_warning ? 'text-amber' : 'text-cyber'}`;
  }

  const snapHum = document.getElementById('snap-hum');
  if (snapHum) {
    snapHum.textContent = `${humidity.toFixed(1)} %`;
    snapHum.className = 'card-value tabular-nums text-cyber';
  }

  const isEmergency = smoke_gas_level >= displayThresholds.gas_critical_raw;
  const snapSmoke = document.getElementById('snap-smoke');
  if (snapSmoke) {
    snapSmoke.textContent = `${smoke_gas_level} raw`;
    snapSmoke.className = `card-value tabular-nums ${isEmergency ? 'text-rose' : (smoke_gas_level >= displayThresholds.gas_warning_raw ? 'text-amber' : 'text-mint')}`;
  }

  const bannerSmoke = document.getElementById('banner-smoke-val');
  if (bannerSmoke) bannerSmoke.textContent = `${smoke_gas_level} raw`;

  const reedEl = document.getElementById('access-reed-state');
  if (reedEl) {
    reedEl.textContent = door_state === 'CLOSED' ? 'CLOSED (ENGAGED)' : 'OPEN (SEPARATED)';
    reedEl.className = `hw-state ${door_state === 'CLOSED' ? 'text-mint' : 'text-rose'}`;
  }

  const solenoidEl = document.getElementById('access-solenoid-state');
  if (solenoidEl) {
    solenoidEl.textContent = door_state === 'CLOSED' ? 'ENERGIZED (LOCKED)' : 'DE-ENERGIZED (UNLOCKED)';
    solenoidEl.className = `hw-state ${door_state === 'CLOSED' ? 'text-mint' : 'text-rose'}`;
  }

  const envTempVal = document.getElementById('env-temp-val');
  if (envTempVal) envTempVal.textContent = `${temperature.toFixed(1)} °C`;
  const envHumVal = document.getElementById('env-hum-val');
  if (envHumVal) envHumVal.textContent = `${humidity.toFixed(1)} %`;

  const smokeValEl = document.getElementById('env-smoke-val');
  if (smokeValEl) {
    smokeValEl.textContent = `${smoke_gas_level} raw`;
    smokeValEl.className = `gauge-num tabular-nums ${isEmergency ? 'text-rose' : 'text-mint'}`;
  }

  const smokeArc = document.getElementById('gauge-arc-smoke');
  if (smokeArc) {
    smokeArc.setAttribute('class', `gauge-arc ${isEmergency ? 'stroke-rose' : 'stroke-mint'}`);
  }

  // Update View 3 Gauge Status Badges
  const tempStatus = document.getElementById('env-temp-status');
  if (tempStatus) {
    tempStatus.textContent = temperature > displayThresholds.temperature_warning ? 'ABOVE DISPLAY LIMIT' : 'NOMINAL';
    tempStatus.className = `status-tag ${temperature > displayThresholds.temperature_warning ? 'status-warning' : 'status-nominal'}`;
  }
  const humStatus = document.getElementById('env-hum-status');
  if (humStatus) {
    humStatus.textContent = 'NOMINAL';
    humStatus.className = 'status-tag status-nominal';
  }
  const smokeStatus = document.getElementById('env-smoke-status');
  if (smokeStatus) {
    smokeStatus.textContent = isEmergency ? 'CRITICAL ALARM' : (smoke_gas_level >= displayThresholds.gas_warning_raw ? 'ELEVATED' : 'NOMINAL');
    smokeStatus.className = `status-tag ${isEmergency ? 'status-critical' : (smoke_gas_level >= displayThresholds.gas_warning_raw ? 'status-warning' : 'status-nominal')}`;
  }

  updateCircularGauge('gauge-arc-temp', temperature, 50);
  updateCircularGauge('gauge-arc-hum', humidity, 100);
  updateCircularGauge('gauge-arc-smoke', smoke_gas_level, 800);

  const timeLabel = new Date().toLocaleTimeString();
  liveTempSamples.push({ time: timeLabel, val: temperature });
  liveHumSamples.push({ time: timeLabel, val: humidity });
  if (liveTempSamples.length > 30) liveTempSamples.shift();
  if (liveHumSamples.length > 30) liveHumSamples.shift();

  renderMiniSparkline('spark-temp', liveTempSamples.map(s => s.val), 0, 50, '#38bdf8');
  renderMiniSparkline('spark-hum', liveHumSamples.map(s => s.val), 0, 100, '#10b981');

  if (activeChartMode === 'live') {
    if (tempChart) tempChart.pushValue(timeLabel, temperature);
    if (humChart) humChart.pushValue(timeLabel, humidity);
  }

  updateFacilityStatusAndFreshness();
  updateHeartbeatDiagnosticsUI();
}

async function fetchTelemetryAggregation(range = '24h', bucket = '15m') {
  const chartAggNotice = document.getElementById('chart-agg-notice');
  try {
    const res = await fetchWithTimeout(
      `${getNodeRedHttp()}/api/telemetry/aggregate?range=${encodeURIComponent(range)}&bucket=${encodeURIComponent(bucket)}`,
      {
        method: 'GET',
        headers: getAuthHeaders()
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const series = Array.isArray(data.series) ? data.series : [];

    const labels = series.map(b => new Date(b.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    const temps = series.map(b => Number(b.temperature_avg ?? 0));
    const hums = series.map(b => Number(b.humidity_avg ?? 0));

    if (tempChart) tempChart.setSeries(labels, temps, `${range} Rollup (${bucket})`);
    if (humChart) humChart.setSeries(labels, hums, `${range} Rollup (${bucket})`);

    if (chartAggNotice) {
      chartAggNotice.innerHTML = `<strong>Verified SQLite Aggregation (<code>GET /api/telemetry/aggregate</code>):</strong> Loaded <strong>${series.length}</strong> time bucket(s) over range <code>${escapeHTML(range)}</code> with bucket width <code>${escapeHTML(bucket)}</code>.`;
    }
  } catch {
    if (chartAggNotice) {
      chartAggNotice.innerHTML = `<strong>Historical Time-Bucket Aggregation Unavailable:</strong> Could not reach <code>GET /api/telemetry/aggregate</code> on ${escapeHTML(getNodeRedHttp())}.`;
    }
  }
}

function syncChartsWithActiveMode() {
  if (!tempChart || !humChart) return;
  if (activeChartMode === 'live') {
    tempChart.setSeries(liveTempSamples.map(s => s.time), liveTempSamples.map(s => s.val), 'Live 30-Sample FIFO');
    humChart.setSeries(liveHumSamples.map(s => s.time), liveHumSamples.map(s => s.val), 'Live 30-Sample FIFO');
  } else if (activeChartMode === 'sqlite') {
    const recentRows = environmental_telemetry.slice(0, 30).reverse();
    const labels = recentRows.map(r => String(r.timestamp || r.time || r.id || '').slice(-8));
    const temps = recentRows.map(r => Number(r.temperature ?? r.temp ?? 0));
    const hums = recentRows.map(r => Number(r.humidity ?? r.hum ?? 0));
    tempChart.setSeries(labels, temps, 'SQLite History');
    humChart.setSeries(labels, hums, 'SQLite History');
  }
}

export function handleMFAPayload(payload) {
  if (!payload || typeof payload !== 'object') return;
  const now = Date.now();
  lastNode1EvidenceTimestamp = now;

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
    pushActivityEvent('ACCESS', 'MFA UNLOCKED (2-of-3 Verified) — Solenoid Released');
    showToast('Access Granted', '2-out-of-3 MFA completed. Solenoid unlocked.', 'success');
  } else if (mfa_status === 'AWAITING_STAGE2') {
    startMfaCountdown();
    pushActivityEvent('MFA', 'MFA Stage 1 Passed — Awaiting Stage 2 (10s window)');
    showToast('MFA Stage 1 Passed', 'Provide a second distinct factor within 10 seconds.', 'info');
  } else {
    stopMfaCountdown();
  }

  renderMFAUI();
  updateFacilityStatusAndFreshness();
  updateHeartbeatDiagnosticsUI();
}

function renderMFAUI() {
  const passedCount = [isFacePassed, isCardPassed, isPinPassed].filter(Boolean).length;
  const pct = Math.min(100, (passedCount / 2) * 100);
  const fillEl = document.getElementById('mfa-progress-fill');
  if (fillEl) fillEl.style.width = `${pct}%`;

  const statusLabel = document.getElementById('mfa-status-label');
  if (statusLabel) {
    statusLabel.textContent = mfa_status;
    statusLabel.className = mfa_status === 'UNLOCKED' ? 'text-mint' : (mfa_status === 'AWAITING_STAGE2' ? 'text-amber' : 'text-cyber');
  }

  const snapMfa = document.getElementById('snap-mfa');
  if (snapMfa) {
    snapMfa.textContent = mfa_status;
    snapMfa.className = `card-value tabular-nums ${mfa_status === 'UNLOCKED' ? 'text-mint' : (mfa_status === 'AWAITING_STAGE2' ? 'text-amber' : 'text-cyber')}`;
  }
  const snapFactors = document.getElementById('snap-mfa-factors');
  if (snapFactors) {
    snapFactors.textContent = `${passedCount} / 2 Factors Passed`;
  }

  const updateCheckpoint = (id, badgeId, varName, passed) => {
    const cp = document.getElementById(id);
    const badge = document.getElementById(badgeId);
    if (cp) {
      cp.className = `checkpoint ${passed ? 'passed' : ''}`;
      const codeEl = cp.querySelector('.cp-var');
      if (codeEl) codeEl.textContent = `${varName}: ${passed}`;
    }
    if (badge) {
      badge.textContent = passed ? 'VERIFIED' : 'PENDING';
    }
  };

  updateCheckpoint('cp-face', 'cp-face-badge', 'isFacePassed', isFacePassed);
  updateCheckpoint('cp-card', 'cp-card-badge', 'isCardPassed', isCardPassed);
  updateCheckpoint('cp-pin', 'cp-pin-badge', 'isPinPassed', isPinPassed);
}

function startMfaCountdown() {
  stopMfaCountdown();
  mfaRemainingSeconds = 10;
  const timerEl = document.getElementById('mfa-timer-label');
  if (timerEl) timerEl.textContent = `${mfaRemainingSeconds}s`;

  mfaCountdownInterval = setInterval(() => {
    mfaRemainingSeconds -= 1;
    if (timerEl) timerEl.textContent = `${mfaRemainingSeconds}s`;
    if (mfaRemainingSeconds <= 0) {
      stopMfaCountdown();
      isFacePassed = false;
      isCardPassed = false;
      isPinPassed = false;
      mfa_status = 'IDLE';
      renderMFAUI();
      pushActivityEvent('MFA', 'MFA Timeout — Stage 2 window expired (Flags reset)');
      showToast('MFA Window Expired', '10-second Stage-2 timeout reached. Checkpoints reset.', 'error');
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

function pushActivityEvent(categoryOrText, maybeText) {
  const hasCat = maybeText !== undefined;
  const category = hasCat ? sanitizeInput(String(categoryOrText)) : 'EVENT';
  const cleanText = sanitizeInput(String(hasCat ? maybeText : categoryOrText));
  const time = new Date().toLocaleTimeString();
  activityFeed.unshift({ time, category, text: cleanText });
  activityFeed = activityFeed.slice(0, 6);
  renderActivityFeed();
}

function renderActivityFeed() {
  const ul = document.getElementById('live-activity-list');
  if (!ul) return;

  if (activityFeed.length === 0) {
    ul.innerHTML = `
      <li class="empty-state-box">
        <svg class="empty-state-svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
        </svg>
        <strong class="empty-state-title">No Live Activity Recorded Yet</strong>
        <span class="empty-state-sub">Awaiting real-time telemetry, MFA transitions, or operator dispatches from ${escapeHTML(server_host)}.</span>
      </li>
    `;
    return;
  }

  ul.innerHTML = activityFeed
    .map(item => `
      <li>
        <div class="activity-item-left">
          <span class="activity-cat-tag">${escapeHTML(item.category || 'EVENT')}</span>
          <span>${escapeHTML(item.text)}</span>
        </div>
        <code class="text-cyber tabular-nums">${escapeHTML(item.time)}</code>
      </li>
    `)
    .join('');
}

// ============================================================================
// 12. WEBSOCKET CLIENTS & SQLITE REST EXPLORER
// ============================================================================

function connectWebSockets() {
  if (wsTelemetryInstance) {
    try { wsTelemetryInstance.close(); } catch {}
    wsTelemetryInstance = null;
  }
  if (wsMfaInstance) {
    try { wsMfaInstance.close(); } catch {}
    wsMfaInstance = null;
  }

  const telUrl = getWsTelemetryUrl();
  const mfaUrl = getWsMfaUrl();

  try {
    wsTelemetryInstance = new WebSocket(telUrl);
    wsTelemetryInstance.onopen = () => {
      wsTelemetryState = 'ONLINE';
      const dot = document.getElementById('ws-telemetry-dot');
      const status = document.getElementById('ws-telemetry-status');
      if (dot) dot.className = 'dot dot-green';
      if (status) status.textContent = 'ONLINE';
      updateFacilityStatusAndFreshness();
      updateHeartbeatDiagnosticsUI();
    };
    wsTelemetryInstance.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleTelemetryPayload(data);
      } catch {
        showToast('Telemetry Parse Error', 'Malformed JSON frame received on /ws/telemetry.', 'error');
      }
    };
    wsTelemetryInstance.onerror = () => {
      wsTelemetryState = 'OFFLINE';
      const dot = document.getElementById('ws-telemetry-dot');
      const status = document.getElementById('ws-telemetry-status');
      if (dot) dot.className = 'dot dot-red';
      if (status) status.textContent = 'OFFLINE';
      updateFacilityStatusAndFreshness();
      updateHeartbeatDiagnosticsUI();
    };
    wsTelemetryInstance.onclose = () => {
      wsTelemetryState = 'OFFLINE';
      const dot = document.getElementById('ws-telemetry-dot');
      const status = document.getElementById('ws-telemetry-status');
      if (dot) dot.className = 'dot dot-red';
      if (status) status.textContent = 'OFFLINE';
      updateFacilityStatusAndFreshness();
      updateHeartbeatDiagnosticsUI();
    };
  } catch {
    wsTelemetryState = 'OFFLINE';
  }

  try {
    wsMfaInstance = new WebSocket(mfaUrl);
    wsMfaInstance.onopen = () => {
      wsMfaState = 'ONLINE';
      const dot = document.getElementById('ws-mfa-dot');
      const status = document.getElementById('ws-mfa-status');
      if (dot) dot.className = 'dot dot-green';
      if (status) status.textContent = 'ONLINE';
      const accessBadge = document.getElementById('access-stream-badge');
      if (accessBadge) {
        accessBadge.textContent = 'MFA Stream Online';
        accessBadge.className = 'status-tag status-nominal';
      }
      updateFacilityStatusAndFreshness();
      updateHeartbeatDiagnosticsUI();
    };
    wsMfaInstance.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleMFAPayload(data);
      } catch {
        showToast('MFA Stream Error', 'Malformed JSON payload on /ws/mfa.', 'error');
      }
    };
    wsMfaInstance.onerror = () => {
      wsMfaState = 'OFFLINE';
      const dot = document.getElementById('ws-mfa-dot');
      const status = document.getElementById('ws-mfa-status');
      if (dot) dot.className = 'dot dot-red';
      if (status) status.textContent = 'OFFLINE';
      updateFacilityStatusAndFreshness();
      updateHeartbeatDiagnosticsUI();
    };
    wsMfaInstance.onclose = () => {
      wsMfaState = 'OFFLINE';
      const dot = document.getElementById('ws-mfa-dot');
      const status = document.getElementById('ws-mfa-status');
      if (dot) dot.className = 'dot dot-red';
      if (status) status.textContent = 'OFFLINE';
      const accessBadge = document.getElementById('access-stream-badge');
      if (accessBadge) {
        accessBadge.textContent = 'MFA Stream Offline';
        accessBadge.className = 'status-tag status-offline';
      }
      updateFacilityStatusAndFreshness();
      updateHeartbeatDiagnosticsUI();
    };
  } catch {
    wsMfaState = 'OFFLINE';
  }
}

async function fetchSQLiteLogs(tableName, notifyOnError = false) {
  const allowedTables = new Set([
    'access_logs',
    'camera_events',
    'environmental_telemetry',
    'system_errors',
    'system_users'
  ]);
  if (!allowedTables.has(tableName)) return;

  try {
    const res = await fetchWithTimeout(`${getNodeRedHttp()}/api/logs/${tableName}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();

    httpApiReachable = true;
    lastHttpApiSuccessTimestamp = Date.now();
    dbTableProvenance[tableName] = { status: 'LIVE', timestamp: Date.now() };

    if (tableName === 'access_logs') access_logs = Array.isArray(rows) ? rows : [];
    if (tableName === 'camera_events') camera_events = Array.isArray(rows) ? rows : [];
    if (tableName === 'environmental_telemetry') {
      environmental_telemetry = Array.isArray(rows) ? rows : [];
      if (activeChartMode === 'sqlite') syncChartsWithActiveMode();
    }
    if (tableName === 'system_errors') system_errors = Array.isArray(rows) ? rows : [];
    if (tableName === 'system_users' && Array.isArray(rows)) {
      system_users = rows;
    }
  } catch {
    dbTableProvenance[tableName] = { status: 'UNREACHABLE', timestamp: Date.now() };
    if (notifyOnError) {
      showToast('SQLite Endpoint Unreachable', `Could not fetch /api/logs/${tableName} from ${getNodeRedHttp()}.`, 'error');
    }
  }

  renderDatabaseTable();
  renderRecentAccessLogsPreview();
  renderSystemErrors();
  renderUserManagementTable();
  updateFacilityStatusAndFreshness();
  updateHeartbeatDiagnosticsUI();
}

function getEmptyTableIllustrationHTML(title, subtitle) {
  return `
    <div class="empty-state-box">
      <svg class="empty-state-svg" width="38" height="38" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <ellipse cx="32" cy="16" rx="20" ry="8"></ellipse>
        <path d="M12 16v16c0 4.4 9 8 20 8s20-3.6 20-8V16"></path>
        <path d="M12 32v16c0 4.4 9 8 20 8s20-3.6 20-8V32"></path>
      </svg>
      <strong class="empty-state-title">${escapeHTML(title)}</strong>
      <span class="empty-state-sub">${escapeHTML(subtitle)}</span>
    </div>
  `;
}

function classifyRecordSeverity(row) {
  const text = Object.values(row || {}).join(' ').toLowerCase();
  if (text.includes('error') || text.includes('denied') || text.includes('fail') || text.includes('alarm') || text.includes('critical') || text.includes('breach')) {
    return 'critical';
  }
  if (text.includes('warn') || text.includes('timeout') || text.includes('stale') || text.includes('manual') || text.includes('awaiting')) {
    return 'warning';
  }
  return 'nominal';
}

function matchesTimeWindow(row, windowCode) {
  if (!windowCode || windowCode === 'all') return true;
  const rawTs = row.timestamp || row.created_at || row.time || row.date;
  if (!rawTs) return true;
  const parsed = Date.parse(rawTs);
  if (Number.isNaN(parsed)) return true;
  const ageMs = Date.now() - parsed;
  if (windowCode === '1h') return ageMs <= 3600 * 1000;
  if (windowCode === '24h') return ageMs <= 24 * 3600 * 1000;
  if (windowCode === '7d') return ageMs <= 7 * 24 * 3600 * 1000;
  return true;
}

function renderDatabaseTable() {
  const thead = document.getElementById('db-table-head');
  const tbody = document.getElementById('db-table-body');
  const provBadge = document.getElementById('db-provenance-badge');
  const syncLabel = document.getElementById('db-last-sync-label');
  const pageInfo = document.getElementById('db-pagination-info');
  const pageIndicator = document.getElementById('db-page-indicator');
  const prevBtn = document.getElementById('db-prev-page-btn');
  const nextBtn = document.getElementById('db-next-page-btn');
  const exportBtn = document.getElementById('db-export-csv-btn');

  if (!thead || !tbody) return;

  const prov = dbTableProvenance[activeDbTable];
  if (provBadge) {
    if (!prov) {
      provBadge.textContent = 'Awaiting Fetch';
      provBadge.className = 'text-muted';
    } else if (prov.status === 'LIVE') {
      provBadge.textContent = 'LIVE (SQLite Verified)';
      provBadge.className = 'text-mint';
    } else {
      provBadge.textContent = 'BACKEND UNREACHABLE';
      provBadge.className = 'text-rose';
    }
  }
  if (syncLabel) {
    syncLabel.textContent = prov?.timestamp ? new Date(prov.timestamp).toLocaleTimeString() : '—';
  }

  const query = sanitizeInput(document.getElementById('db-search-input')?.value || '').toLowerCase();
  const timeFilter = document.getElementById('db-time-filter')?.value || 'all';
  const statusFilter = document.getElementById('db-status-filter')?.value || 'all';

  let dataset = access_logs;
  if (activeDbTable === 'camera_events') dataset = camera_events;
  if (activeDbTable === 'environmental_telemetry') dataset = environmental_telemetry;
  if (activeDbTable === 'system_errors') dataset = system_errors;

  currentFilteredRows = dataset.filter(row => {
    const matchesQuery = !query || Object.values(row).some(v => String(v).toLowerCase().includes(query));
    const matchesTime = matchesTimeWindow(row, timeFilter);
    const matchesStatus = statusFilter === 'all' || classifyRecordSeverity(row) === statusFilter;
    return matchesQuery && matchesTime && matchesStatus;
  });

  if (dbSortColumn) {
    currentFilteredRows.sort((a, b) => {
      const va = a[dbSortColumn] ?? '';
      const vb = b[dbSortColumn] ?? '';
      const na = Number(va);
      const nb = Number(vb);
      if (Number.isFinite(na) && Number.isFinite(nb) && va !== '' && vb !== '') {
        return dbSortAsc ? na - nb : nb - na;
      }
      return dbSortAsc
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
  }

  if (exportBtn) {
    exportBtn.disabled = currentFilteredRows.length === 0;
  }

  const totalRecords = currentFilteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / dbPageSize));
  if (dbCurrentPage > totalPages) dbCurrentPage = totalPages;

  const startIdx = (dbCurrentPage - 1) * dbPageSize;
  const pageSlice = currentFilteredRows.slice(startIdx, startIdx + dbPageSize);

  if (pageInfo) {
    pageInfo.textContent = totalRecords === 0
      ? 'Showing 0 of 0 records'
      : `Showing ${startIdx + 1}–${startIdx + pageSlice.length} of ${totalRecords} records`;
  }
  if (pageIndicator) {
    pageIndicator.textContent = `Page ${dbCurrentPage} / ${totalPages}`;
  }
  if (prevBtn) prevBtn.disabled = dbCurrentPage <= 1;
  if (nextBtn) nextBtn.disabled = dbCurrentPage >= totalPages;

  if (pageSlice.length === 0) {
    thead.innerHTML = '<tr><th>SQLite Table Status</th></tr>';
    const reason = prov?.status === 'UNREACHABLE'
      ? `Central backend SQLite service at ${getNodeRedHttp()} is currently unreachable.`
      : `Table "${activeDbTable}" returned 0 matching records for the current filter.`;
    tbody.innerHTML = `<tr><td>${getEmptyTableIllustrationHTML(
      `No Records Displayed for "${activeDbTable}"`,
      reason
    )}</td></tr>`;
    return;
  }

  const columns = Object.keys(pageSlice[0]);
  thead.innerHTML = `<tr>${columns.map(c => {
    const arrow = dbSortColumn === c ? (dbSortAsc ? ' ▲' : ' ▼') : '';
    return `<th class="sortable-th" data-sort-col="${escapeHTML(c)}">${escapeHTML(c)}${arrow}</th>`;
  }).join('')}</tr>`;

  tbody.innerHTML = pageSlice
    .map((row, sliceIdx) => {
      const globalIdx = startIdx + sliceIdx;
      return `<tr class="clickable-row" data-row-idx="${globalIdx}" title="Click to inspect full SQLite record">${columns.map(c => `<td class="tabular-nums">${escapeHTML(row[c])}</td>`).join('')}</tr>`;
    })
    .join('');
}

function openEventDetailModal(tableName, record) {
  const modal = document.getElementById('event-detail-modal');
  const kicker = document.getElementById('event-detail-kicker');
  const title = document.getElementById('event-detail-title');
  const grid = document.getElementById('event-detail-grid');
  const rawPre = document.getElementById('event-detail-json');
  if (!modal || !grid || !rawPre) return;

  if (kicker) kicker.textContent = `SQLite Table · ${tableName}`;
  const recId = record.id ?? record.error_id ?? record.seq ?? 'Record';
  if (title) title.textContent = `Record Inspection (#${recId})`;

  grid.innerHTML = Object.entries(record)
    .map(([k, v]) => `
      <div class="detail-kv-item">
        <span class="detail-kv-key">${escapeHTML(k)}</span>
        <span class="detail-kv-val tabular-nums">${escapeHTML(v)}</span>
      </div>
    `)
    .join('');

  rawPre.textContent = JSON.stringify(record, null, 2);
  modal.classList.remove('hidden');
}

function closeEventDetailModal() {
  document.getElementById('event-detail-modal')?.classList.add('hidden');
}

function exportCurrentTableToCSV() {
  if (!Array.isArray(currentFilteredRows) || currentFilteredRows.length === 0) {
    showToast('Export Unavailable', 'No records available in the current view to export.', 'info');
    return;
  }
  const columns = Object.keys(currentFilteredRows[0]);
  const escapeCsvCell = (val) => {
    const str = String(val ?? '').replace(/"/g, '""');
    return `"${str}"`;
  };
  const headerLine = columns.map(escapeCsvCell).join(',');
  const dataLines = currentFilteredRows.map(row =>
    columns.map(col => escapeCsvCell(row[col])).join(',')
  );
  const csvContent = [headerLine, ...dataLines].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `lci_sfm_${activeDbTable}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast('CSV Exported', `Exported ${currentFilteredRows.length} rows from ${activeDbTable}.`, 'success');
}

function renderRecentAccessLogsPreview() {
  const tbody = document.getElementById('access-recent-logs-body');
  if (!tbody) return;

  const combined = [...access_logs, ...camera_events].slice(0, 5);
  if (combined.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-muted">No recent access records fetched from SQLite (${escapeHTML(server_host)}).</td></tr>`;
    return;
  }

  tbody.innerHTML = combined
    .map(r => {
      const ts = r.timestamp || r.time || r.created_at || '—';
      const user = r.username || r.user_id || r.user || r.node || 'Node 1';
      const modality = r.event || r.method || r.modality || r.action || 'Access Check';
      const status = r.status || r.result || 'Logged';
      const sev = classifyRecordSeverity(r);
      const badgeClass = sev === 'critical' ? 'status-critical' : (sev === 'warning' ? 'status-warning' : 'status-nominal');
      return `
        <tr>
          <td class="tabular-nums">${escapeHTML(ts)}</td>
          <td><strong>${escapeHTML(user)}</strong></td>
          <td>${escapeHTML(modality)}</td>
          <td><span class="status-tag ${badgeClass}">${escapeHTML(status)}</span></td>
        </tr>
      `;
    })
    .join('');
}

function renderSystemErrors() {
  const tbody = document.getElementById('system-errors-body');
  const errCountEl = document.getElementById('banner-error-count');
  if (errCountEl) {
    errCountEl.textContent = String(system_errors.length);
    errCountEl.className = `tabular-nums ${system_errors.length > 0 ? 'text-rose' : ''}`;
  }

  if (!tbody) return;
  if (system_errors.length === 0) {
    const prov = dbTableProvenance['system_errors'];
    const msg = prov?.status === 'LIVE'
      ? 'Zero active hardware or sequence faults recorded in SQLite system_errors.'
      : `Awaiting connection to ${getNodeRedHttp()}/api/logs/system_errors.`;
    tbody.innerHTML = `<tr><td colspan="5">${getEmptyTableIllustrationHTML(
      'No System Errors Logged',
      msg
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
          <td class="tabular-nums">#${escapeHTML(id)}</td>
          <td class="tabular-nums">${escapeHTML(ts)}</td>
          <td><code>${escapeHTML(node)}</code></td>
          <td><span class="status-tag status-critical">${escapeHTML(code)}</span></td>
          <td>${escapeHTML(desc)}</td>
        </tr>
      `;
    })
    .join('');
}

// ============================================================================
// 13. HARDWARE COMMAND DISPATCH (STRICT VERIFICATION & HONEST FEEDBACK)
// ============================================================================

async function sendCommand(command, targetState) {
  if (!isPrivilegedAdmin()) {
    showToast('Permission Denied', 'Commands require a server-verified Admin session.', 'error');
    return false;
  }

  const cleanCmd = String(command).trim();
  const cleanState = String(targetState).trim();

  if (!ALLOWED_COMMANDS.has(cleanCmd) || !ALLOWED_COMMAND_STATES.has(cleanState)) {
    showToast('Security Block', 'Blocked unrecognized command or state parameter.', 'error');
    return false;
  }

  if (!isValidIPv4(ip_node1) || !isValidIPv4(ip_node2) || !isValidIPv4(ip_node3)) {
    showToast('Invalid Node IP', 'Verify Node IPv4 addresses before dispatching hardware commands.', 'error');
    return false;
  }

  const strictBody = {
    command: cleanCmd,
    state: cleanState,
    ip_node1: String(ip_node1),
    ip_node2: String(ip_node2),
    ip_node3: String(ip_node3)
  };

  const lastResultEl = document.getElementById('dispatch-last-result');
  if (lastResultEl) {
    lastResultEl.textContent = `Pending: ${cleanCmd} -> ${cleanState}...`;
    lastResultEl.className = 'tabular-nums text-amber';
  }

  try {
    const response = await fetchWithTimeout(`${getNodeRedHttp()}/api/command`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(strictBody)
    });

    let resData = {};
    try {
      resData = await response.json();
    } catch {
      resData = {};
    }

    if (!response.ok) {
      const lifecycle = resData.lifecycle_state || resData.status || 'failed';
      const errMsg = resData.error || `HTTP ${response.status}`;
      if (lastResultEl) {
        lastResultEl.textContent = `${lifecycle.toUpperCase()}: ${cleanCmd} (${errMsg})`;
        lastResultEl.className = 'tabular-nums text-rose';
      }
      pushActivityEvent('ERROR', `Command ${lifecycle.toUpperCase()}: ${cleanCmd} -> ${cleanState}`);
      showToast(
        lifecycle === 'unavailable' ? 'MQTT Broker Unavailable' : 'Command Rejected / Failed',
        errMsg,
        'error'
      );
      updateHeartbeatDiagnosticsUI();
      return false;
    }

    httpApiReachable = true;
    lastHttpApiSuccessTimestamp = Date.now();
    const lifecycleState = resData.lifecycle_state || resData.status || 'published';
    const isHardwareAcked =
      Boolean(resData.verified_hardware_ack) ||
      lifecycleState === 'acknowledged' ||
      lifecycleState === 'state_confirmed';

    if (lastResultEl) {
      lastResultEl.textContent = isHardwareAcked
        ? `Confirmed (${lifecycleState}): ${cleanCmd} (${cleanState}) @ ${new Date().toLocaleTimeString()}`
        : `Published to MQTT (Awaiting Node ACK): ${cleanCmd} (${cleanState}) @ ${new Date().toLocaleTimeString()}`;
      lastResultEl.className = `tabular-nums ${isHardwareAcked ? 'text-mint' : 'text-cyber'}`;
    }

    pushActivityEvent(
      'DISPATCH',
      isHardwareAcked
        ? `Confirmed by Edge Node: ${cleanCmd} -> ${cleanState}`
        : `Published to MQTT (${lifecycleState}): ${cleanCmd} -> ${cleanState}`
    );

    showToast(
      isHardwareAcked ? 'Command Confirmed by Edge Node' : 'Command Published to MQTT',
      isHardwareAcked
        ? `Edge hardware confirmed ${cleanCmd} -> ${cleanState}.`
        : `Backend published ${cleanCmd} -> ${cleanState} to MQTT broker. Awaiting device ACK or telemetry state change.`,
      isHardwareAcked ? 'success' : 'info'
    );
    updateHeartbeatDiagnosticsUI();
    return true;
  } catch {
    if (lastResultEl) {
      lastResultEl.textContent = `Failed (Server Unreachable): ${cleanCmd}`;
      lastResultEl.className = 'tabular-nums text-rose';
    }
    pushActivityEvent('ERROR', `Dispatch Failed (Unreachable): ${cleanCmd} -> ${cleanState}`);
    showToast('Dispatch Failed — Server Offline', `Backend (${getNodeRedHttp()}) did not respond to ${cleanCmd}. Hardware state unverified.`, 'error');
    updateHeartbeatDiagnosticsUI();
    return false;
  }
}

// ============================================================================
// 14. INDEPENDENT SUBSYSTEM DIAGNOSTICS & FACILITY STATUS EVALUATION
// ============================================================================

function formatAgeSeconds(timestampMs) {
  if (!timestampMs) return 'Never';
  const sec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s ago`;
}

function updateFacilityStatusAndFreshness() {
  const now = Date.now();
  const telAgeMs = hasReceivedTelemetry ? (now - lastTelemetryTimestamp) : Infinity;
  const isTelFresh = hasReceivedTelemetry && telAgeMs <= 10000;
  const isTelStale = hasReceivedTelemetry && telAgeMs > 10000;

  // Global Header Freshness Indicator
  const globalFreshEl = document.getElementById('global-freshness-label');
  if (globalFreshEl) {
    if (!hasReceivedTelemetry) {
      globalFreshEl.textContent = 'No Data Received';
      globalFreshEl.className = 'tabular-nums text-muted';
    } else if (isTelFresh) {
      globalFreshEl.textContent = `Live (${formatAgeSeconds(lastTelemetryTimestamp)})`;
      globalFreshEl.className = 'tabular-nums text-mint';
    } else {
      globalFreshEl.textContent = `Stale (${formatAgeSeconds(lastTelemetryTimestamp)})`;
      globalFreshEl.className = 'tabular-nums text-amber';
    }
  }

  // Metric Card Freshness Labels
  const freshLabel = !hasReceivedTelemetry
    ? 'Awaiting Stream'
    : (isTelFresh ? `Live · ${formatAgeSeconds(lastTelemetryTimestamp)}` : `Stale · ${formatAgeSeconds(lastTelemetryTimestamp)}`);
  ['fresh-door', 'fresh-temp', 'fresh-hum', 'fresh-smoke', 'fresh-fan', 'fresh-light'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = freshLabel;
  });

  const freshMfaEl = document.getElementById('fresh-mfa');
  if (freshMfaEl) {
    freshMfaEl.textContent = wsMfaState === 'ONLINE'
      ? (lastNode1EvidenceTimestamp ? `Live · ${formatAgeSeconds(lastNode1EvidenceTimestamp)}` : 'Stream Open')
      : 'Stream Offline';
  }

  // Connectivity Metric Card (#snap-conn)
  const openStreamCount = (wsTelemetryState === 'ONLINE' ? 1 : 0) + (wsMfaState === 'ONLINE' ? 1 : 0);
  const snapConn = document.getElementById('snap-conn');
  const snapConnDetail = document.getElementById('snap-conn-detail');
  const freshConn = document.getElementById('fresh-conn');
  const bannerStreamState = document.getElementById('banner-stream-state');

  if (snapConn) {
    if (openStreamCount === 2) {
      snapConn.textContent = 'ONLINE';
      snapConn.className = 'card-value text-mint tabular-nums';
    } else if (openStreamCount === 1 || httpApiReachable) {
      snapConn.textContent = 'PARTIAL';
      snapConn.className = 'card-value text-amber tabular-nums';
    } else {
      snapConn.textContent = 'OFFLINE';
      snapConn.className = 'card-value text-rose tabular-nums';
    }
  }
  if (snapConnDetail) {
    snapConnDetail.textContent = `${openStreamCount} / 2 WS Active · REST ${httpApiReachable ? 'OK' : 'Offline'}`;
  }
  if (freshConn) {
    freshConn.textContent = openStreamCount === 2 ? 'Connected' : 'Degraded / Offline';
  }
  if (bannerStreamState) {
    bannerStreamState.textContent = openStreamCount === 2 ? '2/2 WS ONLINE' : (openStreamCount === 1 ? '1/2 PARTIAL' : 'DISCONNECTED');
  }

  // Facility Status Banner (#global-status-banner)
  const banner = document.getElementById('global-status-banner');
  const kicker = document.getElementById('global-status-kicker');
  const title = document.getElementById('global-status-title');
  const subtitle = document.getElementById('global-status-subtitle');
  if (!banner || !title) return;

  if (!hasReceivedTelemetry) {
    banner.className = 'status-banner status-unknown';
    if (kicker) kicker.textContent = 'Facility Operating State · Unverified';
    title.textContent = wsTelemetryState === 'ONLINE'
      ? 'Stream Connected — Awaiting Initial Sensor Packet'
      : 'Awaiting Telemetry Stream — Status Unknown';
    if (subtitle) {
      subtitle.innerHTML = `No verified telemetry frames received from <code>${escapeHTML(getWsTelemetryUrl())}</code>. Initial zero values do not confirm normal sensor operation.`;
    }
    return;
  }

  const isSmokeCritical = smoke_gas_level >= displayThresholds.gas_critical_raw;
  const isSmokeElevated = smoke_gas_level >= displayThresholds.gas_warning_raw && smoke_gas_level < displayThresholds.gas_critical_raw;
  const isTempElevated = temperature > displayThresholds.temperature_warning;

  if (isSmokeCritical && !isTelStale && wsTelemetryState === 'ONLINE') {
    banner.className = 'status-banner emergency';
    if (kicker) kicker.textContent = 'Critical Facility Alarm · Immediate Attention Required';
    title.textContent = `Display Alert — High MQ-2 Raw Reading (${smoke_gas_level} raw)`;
    if (subtitle) {
      subtitle.textContent = `MQ-2 raw reading exceeds the configured display limit on Node 2 (${ip_node2}). Calibration and physical actuator state are not established by this warning.`;
    }
  } else if (wsTelemetryState === 'OFFLINE' || isTelStale) {
    banner.className = 'status-banner warning';
    if (kicker) kicker.textContent = 'Telemetry Degraded · Stale Readings Displayed';
    title.textContent = `Telemetry Stream Interrupted — Last Frame ${formatAgeSeconds(lastTelemetryTimestamp)}`;
    if (subtitle) {
      subtitle.textContent = `Displayed metrics reflect the last known frame prior to disconnection. Local device behavior depends on its firmware policy.`;
    }
  } else if (isSmokeElevated || isTempElevated || system_errors.length > 0) {
    banner.className = 'status-banner warning';
    if (kicker) kicker.textContent = 'Facility Operating State · Warning / Threshold Active';
    const reasons = [];
    if (isTempElevated) reasons.push(`Temperature ${temperature.toFixed(1)} °C (> ${displayThresholds.temperature_warning} °C display limit)`);
    if (isSmokeElevated) reasons.push(`Elevated Smoke/Gas (${smoke_gas_level} raw)`);
    if (system_errors.length > 0) reasons.push(`${system_errors.length} System Error(s) Logged`);
    title.textContent = `Warning Condition — ${reasons.join(' · ')}`;
    if (subtitle) {
      subtitle.textContent = 'Telemetry stream is live and verified, but one or more parameters require operator review.';
    }
  } else {
    banner.className = 'status-banner normal';
    if (kicker) kicker.textContent = 'Facility Operating State · Verified Nominal';
    title.textContent = 'Normal Operations — All Thresholds Nominal';
    if (subtitle) {
      subtitle.textContent = `Verified live telemetry from Node 2 (${ip_node2}) within nominal environmental bounds (Temp ${temperature.toFixed(1)} °C, Smoke ${smoke_gas_level} raw).`;
    }
  }
}

export function formatReadinessSummary(data) {
  if (!data || typeof data !== 'object') {
    return 'SQLite: unknown · MQTT: unknown';
  }
  const sqliteStatus =
    data?.sqlite?.ok === true
      ? `OK (${String(data.sqlite.journal_mode || 'WAL').toUpperCase()})`
      : data?.sqlite?.ok === false
        ? 'DEGRADED'
        : (data?.checks?.sqlite || 'unknown');
  const mqttStateRaw = String(data?.mqtt?.state || '').toLowerCase();
  const subsReady = data?.mqtt?.subscriptions_ready !== false;
  const mqttStatus =
    data?.mqtt?.enabled === true && data?.mqtt?.connected === true && !subsReady
      ? 'Subs Degraded'
      : mqttStateRaw === 'degraded'
        ? 'Subs Degraded'
        : mqttStateRaw === 'connected'
          ? 'Connected'
          : mqttStateRaw === 'standby' || mqttStateRaw === 'disabled'
            ? 'Standby'
            : mqttStateRaw === 'disconnected'
              ? 'Disconnected'
              : typeof data?.mqtt?.connected === 'boolean'
                ? (data.mqtt.connected && data?.mqtt?.enabled !== false
                    ? (subsReady ? 'Connected' : 'Subs Degraded')
                    : (data.mqtt.enabled === false ? 'Standby' : 'Disconnected'))
                : (data?.checks?.mqtt || 'unknown');
  const isDegraded =
    data?.ok === false ||
    data?.status === 'degraded' ||
    (data?.status !== undefined && data?.status !== 'ready') ||
    data?.sqlite?.ok === false ||
    (data?.mqtt?.enabled === true && data?.mqtt?.connected !== true) ||
    (data?.mqtt?.enabled === true && data?.mqtt?.subscriptions_ready === false) ||
    mqttStateRaw === 'disconnected' ||
    mqttStateRaw === 'degraded';
  const prefix = isDegraded ? 'DEGRADED · ' : '';
  return `${prefix}SQLite: ${sqliteStatus} · MQTT: ${mqttStatus}`;
}

async function probeBackendReadiness() {
  try {
    const res = await fetchWithTimeout(`${getNodeRedHttp()}/api/health/ready`, {
      method: 'GET'
    }, 2000);
    const data = await res.json().catch(() => ({}));
    if (res.ok || res.status === 503) {
      httpApiReachable = true;
      lastHttpApiSuccessTimestamp = Date.now();
      const effectivePayload =
        res.status === 503 && (!data || typeof data !== 'object' || data.ok !== false)
          ? { ...(data && typeof data === 'object' ? data : {}), ok: false, status: 'degraded' }
          : data;
      lastBackendReadySummary = formatReadinessSummary(effectivePayload);
    } else {
      lastBackendReadySummary = `HTTP ${res.status}`;
    }
  } catch {
    lastBackendReadySummary = 'Unreachable';
  }
  updateHeartbeatDiagnosticsUI();
}

function updateHeartbeatDiagnosticsUI() {
  const now = Date.now();

  // 1. Central Server (#hb-server)
  const srvOnline = wsTelemetryState === 'ONLINE' || wsMfaState === 'ONLINE' || (httpApiReachable && (now - lastHttpApiSuccessTimestamp) < 15000);
  const srvPartial = !srvOnline && httpApiReachable;
  const hbServer = document.getElementById('hb-server');
  const topoServer = document.getElementById('topo-status-server');
  if (hbServer) {
    hbServer.className = `hb-pill ${srvOnline ? 'online' : (srvPartial ? 'warning' : 'offline')}`;
    hbServer.textContent = srvOnline ? 'ONLINE (<5s)' : (srvPartial ? 'REST ONLY' : 'OFFLINE (>5s)');
  }
  if (topoServer) {
    topoServer.className = `status-tag ${srvOnline ? 'status-nominal' : (srvPartial ? 'status-warning' : 'status-offline')}`;
    topoServer.textContent = srvOnline ? 'ONLINE' : (srvPartial ? 'PARTIAL' : 'OFFLINE');
  }

  const lastServerTs = Math.max(lastTelemetryTimestamp, lastNode1EvidenceTimestamp, lastHttpApiSuccessTimestamp);
  const setDiagText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  setDiagText('diag-http-state', httpApiReachable ? `OK (${formatAgeSeconds(lastHttpApiSuccessTimestamp)})` : 'Unreachable');
  setDiagText('diag-ready-state', lastBackendReadySummary);
  setDiagText('diag-ws-tel-state', wsTelemetryState);
  setDiagText('diag-ws-mfa-state', wsMfaState);
  setDiagText('diag-server-last', formatAgeSeconds(lastServerTs));
  setDiagText('topo-ws-tel', wsTelemetryState);
  setDiagText('topo-ws-mfa', wsMfaState);
  setDiagText('diag-effective-http', `${getNodeRedHttp()}/api/*`);
  setDiagText('diag-effective-ws-tel', `${getWsProtocol()}//${server_host}/ws/telemetry`);
  setDiagText('diag-effective-ws-mfa', `${getWsProtocol()}//${server_host}/ws/mfa`);

  // 2. Node 1 (#hb-node1) — Evaluated strictly from Node 1 MFA/Door evidence
  const n1Age = lastNode1EvidenceTimestamp ? (now - lastNode1EvidenceTimestamp) : Infinity;
  const hbNode1 = document.getElementById('hb-node1');
  const topoNode1 = document.getElementById('topo-status-node1');
  if (n1Age <= 6000) {
    if (hbNode1) { hbNode1.className = 'hb-pill online'; hbNode1.textContent = 'ONLINE (<5s)'; }
    if (topoNode1) { topoNode1.className = 'status-tag status-nominal'; topoNode1.textContent = 'ONLINE'; }
  } else if (n1Age <= 20000) {
    if (hbNode1) { hbNode1.className = 'hb-pill stale'; hbNode1.textContent = `STALE (${Math.floor(n1Age / 1000)}s)`; }
    if (topoNode1) { topoNode1.className = 'status-tag status-warning'; topoNode1.textContent = 'STALE'; }
  } else if (wsMfaState === 'ONLINE') {
    if (hbNode1) { hbNode1.className = 'hb-pill unknown'; hbNode1.textContent = 'IDLE / AWAITING'; }
    if (topoNode1) { topoNode1.className = 'status-tag status-unknown'; topoNode1.textContent = 'AWAITING EVENT'; }
  } else {
    if (hbNode1) { hbNode1.className = 'hb-pill offline'; hbNode1.textContent = 'OFFLINE (>5s)'; }
    if (topoNode1) { topoNode1.className = 'status-tag status-offline'; topoNode1.textContent = 'OFFLINE'; }
  }
  setDiagText('diag-node1-last', formatAgeSeconds(lastNode1EvidenceTimestamp));

  // 3. Node 2 (#hb-node2) — Evaluated strictly from Node 2 Environmental Telemetry
  const n2Age = lastNode2FrameTimestamp ? (now - lastNode2FrameTimestamp) : Infinity;
  const hbNode2 = document.getElementById('hb-node2');
  const topoNode2 = document.getElementById('topo-status-node2');
  if (n2Age <= 6000 && wsTelemetryState === 'ONLINE') {
    if (hbNode2) { hbNode2.className = 'hb-pill online'; hbNode2.textContent = 'ONLINE (<5s)'; }
    if (topoNode2) { topoNode2.className = 'status-tag status-nominal'; topoNode2.textContent = 'ONLINE'; }
  } else if (n2Age <= 15000) {
    if (hbNode2) { hbNode2.className = 'hb-pill stale'; hbNode2.textContent = `STALE (${Math.floor(n2Age / 1000)}s)`; }
    if (topoNode2) { topoNode2.className = 'status-tag status-warning'; topoNode2.textContent = 'STALE'; }
  } else {
    if (hbNode2) { hbNode2.className = 'hb-pill offline'; hbNode2.textContent = 'OFFLINE (>5s)'; }
    if (topoNode2) { topoNode2.className = 'status-tag status-offline'; topoNode2.textContent = 'OFFLINE'; }
  }
  setDiagText('diag-node2-last', formatAgeSeconds(lastNode2FrameTimestamp));

  // 4. Node 3 (#hb-node3) — Evaluated strictly from Camera Probe / Biometric Face Event
  const n3Age = lastNode3CaptureTimestamp ? (now - lastNode3CaptureTimestamp) : Infinity;
  const hbNode3 = document.getElementById('hb-node3');
  const topoNode3 = document.getElementById('topo-status-node3');
  if (node3ProbeStatus === 'ONLINE' && n3Age <= 30000) {
    if (hbNode3) { hbNode3.className = 'hb-pill online'; hbNode3.textContent = 'ONLINE (CAPTURED)'; }
    if (topoNode3) { topoNode3.className = 'status-tag status-nominal'; topoNode3.textContent = 'ONLINE'; }
  } else if (node3ProbeStatus === 'UNREACHABLE') {
    if (hbNode3) { hbNode3.className = 'hb-pill offline'; hbNode3.textContent = 'OFFLINE / SLEEP'; }
    if (topoNode3) { topoNode3.className = 'status-tag status-offline'; topoNode3.textContent = 'UNREACHABLE'; }
  } else {
    if (hbNode3) { hbNode3.className = 'hb-pill unknown'; hbNode3.textContent = 'PIR STANDBY'; }
    if (topoNode3) { topoNode3.className = 'status-tag status-unknown'; topoNode3.textContent = 'PIR STANDBY'; }
  }
  setDiagText('diag-node3-probe', node3ProbeStatus);
  setDiagText('diag-node3-last', formatAgeSeconds(lastNode3CaptureTimestamp));
}

function startHeartbeatMonitor() {
  setInterval(() => {
    updateFacilityStatusAndFreshness();
    updateHeartbeatDiagnosticsUI();
  }, 1000);
}

// ============================================================================
// 15. INITIALIZATION & VERIFIED SERVER AUTHENTICATION WORKFLOW
// ============================================================================

function bootAuthenticatedSession() {
  const loginOverlay = document.getElementById('login-overlay');
  if (loginOverlay) loginOverlay.classList.add('hidden');

  const operatorName = sessionStorage.getItem('lci_operator_id') || 'Operator';
  const adminUserField = document.getElementById('admin_new_username');
  if (adminUserField) adminUserField.value = operatorName;

  applyRBACPermissions();
  mountAuthenticatedViewListeners();
  checkNodeIPsOnStartup();
  if (isServerAuthVerified()) {
    mountFacilityConsole({
      api: managementApi, isAdmin: isPrivilegedAdmin, applySettings: applyCentralSettings,
      notify: showToast, confirm: openConfirmModal, signal: authSessionAbortController.signal
    });
    document.addEventListener('lci-operators-updated', fetchSystemUsers, { signal: authSessionAbortController.signal });
  }
  updateFacilityStatusAndFreshness();
  updateHeartbeatDiagnosticsUI();
  renderActivityFeed();
  renderMFAUI();
  renderUserManagementTable();

  connectWebSockets();
  probeBackendReadiness();
  fetchSQLiteLogs('access_logs');
  fetchSQLiteLogs('system_errors');
  if (isPrivilegedAdmin()) {
    fetchSystemUsers();
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('DOMContentLoaded', () => {
    const tempCanvas = document.getElementById('temp-chart-canvas');
  const humCanvas = document.getElementById('hum-chart-canvas');
  if (tempCanvas) {
    tempChart = new LocalFIFOChart(tempCanvas, {
      color: '#38bdf8',
      min: 0,
      max: 50,
      unit: '°C',
      warningThreshold: 30,
      thresholdLabel: 'Display warning',
      statsElId: 'temp-chart-stats'
    });
  }
  if (humCanvas) {
    humChart = new LocalFIFOChart(humCanvas, {
      color: '#10b981',
      min: 0,
      max: 100,
      unit: '%',
      statsElId: 'hum-chart-stats'
    });
  }

  checkNodeIPsOnStartup();
  startLiveDigitalClock();
  initFullscreenToggle();
  initThemeAndSidebar();
  startHeartbeatMonitor();
  renderActivityFeed();
  renderDatabaseTable();
  renderSystemErrors();
  renderUserManagementTable();

  // Toast Clear All (X) Button
  document.getElementById('toast-clear-all-btn')?.addEventListener('click', clearAllToasts);

  // Login Screen Server Host Override & Reset to Current Origin
  const loginServerHostInput = document.getElementById('login_server_host');
  if (loginServerHostInput) loginServerHostInput.value = server_host;
  document.getElementById('login-apply-host-btn')?.addEventListener('click', () => {
    const candidate = sanitizeInput(loginServerHostInput?.value || '');
    if (!isValidHostPort(candidate)) {
      showToast('Invalid Host Format', 'Enter a valid host or IPv4:Port (e.g. localhost:3000 or 192.168.43.225:3000).', 'error');
      return;
    }
    server_host = candidate;
    localStorage.setItem('lci_server_host', server_host);
    syncIPInputs();
    showToast('Gateway Host Updated', `Authentication endpoint set to ${getNodeRedHttp()}.`, 'info');
  });

  document.getElementById('login-reset-host-btn')?.addEventListener('click', () => {
    server_host = defaultBrowserHost;
    localStorage.setItem('lci_server_host', server_host);
    syncIPInputs();
    showToast('Using Current Host', `Authentication endpoint reset to ${getNodeRedHttp()}.`, 'info');
  });

  document.getElementById('modal-reset-host-btn')?.addEventListener('click', () => {
    const modalSrv = document.getElementById('modal_server_host');
    if (modalSrv) modalSrv.value = defaultBrowserHost;
    showToast('Current Host Populated', `Central server field set to ${defaultBrowserHost}. Click Save & Reconnect to apply.`, 'info');
  });

  // Strict Server-Verified Authentication Flow:
  // 1) Sends POST http://<server_host>/api/auth/login
  // 2) On 200 OK -> Unlocks console with server-verified role & token (lci_auth_verified = 'true')
  // 3) On 401 -> Rejects login ("Invalid Credentials")
  // 4) On Network Error / Timeout -> NEVER silently elevates to Admin! Displays #login-offline-alert
  //    allowing explicit entry into Unverified Read-Only Inspection Mode (Viewer only, controls locked).
  const loginForm = document.getElementById('login-form');
  const loginSubmitBtn = document.getElementById('login-submit-btn');
  const loginOfflineAlert = document.getElementById('login-offline-alert');
  const loginOfflineDesc = document.getElementById('login-offline-desc');

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawUsername = document.getElementById('login_username')?.value || '';
    const rawPassword = document.getElementById('login_password')?.value || '';

    const cleanUsername = rawUsername.trim();
    // Passwords are opaque secrets; sanitization would change valid quotes/spaces.
    const cleanPassword = rawPassword;

    if (!cleanUsername || !cleanPassword) {
      showToast('Credentials Required', 'Enter both operator username and password.', 'error');
      return;
    }

    if (loginSubmitBtn) loginSubmitBtn.disabled = true;
    loginOfflineAlert?.classList.add('hidden');

    try {
      const response = await fetchWithTimeout(`${getNodeRedHttp()}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: String(cleanUsername),
          password: String(cleanPassword)
        })
      }, 2500);

      if (response.status === 401 || response.status === 403) {
        showToast('Authentication Rejected', 'Invalid username or password rejected by SQLite backend.', 'error');
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const authData = await response.json();
      const token = String(authData.token || (authData.authenticated ? 'COOKIE_SESSION' : ''));
      if (!token) {
        throw new Error('Missing session token from backend');
      }
      const csrfToken = String(authData.csrfToken || '');
      const role = authData.role === 'Admin' ? 'Admin' : 'Viewer';
      const verifiedUser = String(authData.username || cleanUsername);

      httpApiReachable = true;
      lastHttpApiSuccessTimestamp = Date.now();

      sessionStorage.setItem('lci_session_token', token);
      if (csrfToken) sessionStorage.setItem('lci_csrf_token', csrfToken);
      sessionStorage.setItem('lci_rbac_role', role);
      sessionStorage.setItem('lci_operator_id', verifiedUser);
      sessionStorage.setItem('lci_auth_verified', 'true');

      bootAuthenticatedSession();
      pushActivityEvent('AUTH', `Verified SQLite Login: ${verifiedUser} (${role})`);
      showToast('Session Authenticated', `Signed in as ${verifiedUser} [${role}]`, 'success');
    } catch {
      httpApiReachable = false;
      if (loginOfflineAlert) {
        loginOfflineAlert.classList.remove('hidden');
      }
      if (loginOfflineDesc) {
        loginOfflineDesc.textContent = `Could not reach ${getNodeRedHttp()}/api/auth/login. Server verification is required for Administrator clearance and actuator control. You may retry after verifying network connectivity or enter Unverified Read-Only Inspection Mode.`;
      }
      const statusBadge = document.getElementById('login-server-status-badge');
      if (statusBadge) {
        statusBadge.textContent = 'Server Unreachable';
        statusBadge.className = 'status-tag status-offline';
      }
      showToast('Authentication Service Offline', `Cannot verify credentials against ${getNodeRedHttp()}.`, 'error');
    } finally {
      if (loginSubmitBtn) loginSubmitBtn.disabled = false;
    }
  });

  // Explicit Unverified Read-Only Offline Inspection Mode Button
  document.getElementById('login-offline-readonly-btn')?.addEventListener('click', () => {
    const enteredUser = sanitizeInput(document.getElementById('login_username')?.value || '') || 'offline-inspector';
    sessionStorage.setItem('lci_session_token', `UNVERIFIED-READONLY-${Date.now()}`);
    sessionStorage.setItem('lci_rbac_role', 'Viewer');
    sessionStorage.setItem('lci_operator_id', enteredUser);
    sessionStorage.setItem('lci_auth_verified', 'false');

    bootAuthenticatedSession();
    pushActivityEvent('AUTH', `Entered Unverified Read-Only Mode (${enteredUser})`);
    showToast('Read-Only Inspection Mode', 'Viewing console without server verification. All control actions are locked.', 'info');
  });

  // Return to Login Overlay from Unverified Banner to Retry Server Auth
  document.getElementById('retry-server-auth-btn')?.addEventListener('click', () => {
    lockAndLogoutSystem();
  });

  // Lock System / Logout Button
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    lockAndLogoutSystem();
  });

  // Endpoint Configuration Modal Controls
  document.getElementById('open-ip-modal-btn')?.addEventListener('click', openIpModal);
  document.getElementById('close-ip-modal-x')?.addEventListener('click', closeIpModal);
  document.getElementById('cancel-ip-modal-btn')?.addEventListener('click', closeIpModal);

  document.getElementById('startup-ip-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isPrivilegedAdmin()) {
      showToast('Read-Only Session', 'Endpoint changes require a verified Admin session.', 'error');
      return;
    }
    const ok = await saveNodeIPs(
      document.getElementById('modal_ip_node1').value,
      document.getElementById('modal_ip_node2').value,
      document.getElementById('modal_ip_node3').value,
      document.getElementById('modal_server_host')?.value || server_host
    );
    if (ok) closeIpModal();
  });

  // Confirmation Modal Controls
  document.getElementById('close-confirm-modal-x')?.addEventListener('click', closeConfirmModal);
  document.getElementById('cancel-confirm-modal-btn')?.addEventListener('click', closeConfirmModal);
  document.getElementById('execute-confirm-modal-btn')?.addEventListener('click', () => {
    const cb = pendingConfirmCallback;
    closeConfirmModal();
    if (typeof cb === 'function') cb();
  });

  // Event Detail Inspector Modal Controls
  document.getElementById('close-event-detail-x')?.addEventListener('click', closeEventDetailModal);
  document.getElementById('close-event-detail-btn')?.addEventListener('click', closeEventDetailModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeIpModal();
      closeConfirmModal();
      closeEventDetailModal();
    }
  });

  if (isAuthenticated()) {
    bootAuthenticatedSession();
  } else {
    // Check if an active server-side HttpOnly cookie session exists
    fetchWithTimeout(`${getNodeRedHttp()}/api/auth/session`, {
      method: 'GET',
      headers: getAuthHeaders()
    }, 1500)
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.authenticated && data.username) {
          sessionStorage.setItem('lci_session_token', 'COOKIE_SESSION');
          if (data.csrfToken) sessionStorage.setItem('lci_csrf_token', String(data.csrfToken));
          sessionStorage.setItem('lci_rbac_role', data.role === 'Admin' ? 'Admin' : 'Viewer');
          sessionStorage.setItem('lci_operator_id', String(data.username));
          sessionStorage.setItem('lci_auth_verified', 'true');
          bootAuthenticatedSession();
        }
      })
      .catch(() => {});
  }
  });
}

