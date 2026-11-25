// LCI-SFM Reactive Client Store — Auth Session, Theme, Live WebSockets, Toasts, Modals & Slide-Over Drawer
import { api, configureApiClient } from './api.js';
import { el, clear, svgIcon } from './utils.js';

const THEME_KEY = 'lci_sfm_theme_v2';
const SIDEBAR_KEY = 'lci_sfm_sidebar_collapsed';

function safeGet(key, fallback) {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key, val) {
  try {
    window.localStorage.setItem(key, val);
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

const listeners = new Set();
const eventBus = new Map();
let notificationAudioContext = null;
let notificationSoundInitialized = false;
let notificationSoundCursor = 0;

function playCriticalNotificationCue() {
  const context = notificationAudioContext;
  if (!context || context.state !== 'running') return;
  const start = context.currentTime;
  for (const [offset, frequency] of [[0, 880], [0.16, 660]]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = start + offset;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.045, at + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.14);
  }
}

export async function unlockNotificationAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('This browser does not support local audio cues.');
  if (!notificationAudioContext || notificationAudioContext.state === 'closed') {
    notificationAudioContext = new AudioContextClass();
  }
  if (notificationAudioContext.state === 'suspended') await notificationAudioContext.resume();
  if (notificationAudioContext.state !== 'running') {
    throw new Error('Browser audio is still blocked. Use the Enable Audio button again.');
  }
  store.notificationAudioUnlocked = true;
  playCriticalNotificationCue();
  notify();
}

async function refreshCriticalNotificationSound(playNew) {
  if (!store.authenticated || !streamsActive) return;
  try {
    const [prefs, result] = await Promise.all([
      api.getNotificationPrefs(),
      api.listNotifications({ page: 1, limit: 100 })
    ]);
    if (!store.authenticated || !streamsActive) return;
    store.criticalSoundEnabled = Boolean(prefs.critical_sound);
    const latestId = Number(result.latest_id || 0);
    const rows = Array.isArray(result.notifications) ? result.notifications : [];
    if (notificationSoundInitialized && playNew && store.criticalSoundEnabled && store.notificationAudioUnlocked) {
      const hasNewCritical = rows.some((row) => Number(row.id) > notificationSoundCursor && row.severity === 'CRITICAL');
      if (hasNewCritical) playCriticalNotificationCue();
    }
    notificationSoundCursor = Math.max(notificationSoundCursor, latestId);
    notificationSoundInitialized = true;
  } catch {
    // Audio is optional; preference/list failures must never affect console operations.
  }
}

export const store = {
  authChecked: false,
  authenticated: false,
  user: null, // { id, username, role }
  csrfToken: null,
  theme: safeGet(THEME_KEY, 'dark') === 'light' ? 'light' : 'dark',
  sidebarCollapsed: safeGet(SIDEBAR_KEY, '0') === '1',
  mobileNavOpen: false,

  // Live stream states
  wsTelemetry: 'OFFLINE', // CONNECTED | CONNECTING | OFFLINE
  wsNotifications: 'OFFLINE',
  wsMfa: 'OFFLINE',
  unreadCount: 0,
  activeAlarmCount: 0,
  criticalSoundEnabled: false,
  notificationAudioUnlocked: false,
  healthSummary: null,
  lastTelemetryAt: null,
  latestTelemetryByDevice: new Map(), // device_id -> { endpoints: { key: value }, ts }
  telemetrySeries: new Map(), // `${device_id}:${key}` -> number[]

  // Toasts
  toasts: []
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) {
    try {
      fn(store);
    } catch (err) {
      console.error('Store listener error:', err);
    }
  }
}

export function onLiveEvent(type, fn) {
  if (!eventBus.has(type)) eventBus.set(type, new Set());
  eventBus.get(type).add(fn);
  return () => eventBus.get(type)?.delete(fn);
}

function emitLiveEvent(type, payload) {
  const set = eventBus.get(type);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`Live event listener error (${type}):`, err);
    }
  }
}

export function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  store.theme = next;
  document.documentElement.setAttribute('data-theme', next);
  safeSet(THEME_KEY, next);
  notify();
}

export function toggleTheme() {
  applyTheme(store.theme === 'dark' ? 'light' : 'dark');
}

export function toggleSidebar() {
  store.sidebarCollapsed = !store.sidebarCollapsed;
  safeSet(SIDEBAR_KEY, store.sidebarCollapsed ? '1' : '0');
  notify();
}

export function setMobileNavOpen(open) {
  store.mobileNavOpen = Boolean(open);
  notify();
}

export function isAdmin() {
  return Boolean(store.authenticated && store.user?.role === 'Admin');
}

// ============================================================================
// FOCUS TRAP HELPER FOR ACCESSIBLE DIALOGS & DRAWERS
// ============================================================================
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function createFocusTrapHandler(container, onEscape) {
  return (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      (node) => node.offsetParent !== null
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first || !container.contains(document.activeElement)) {
        e.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last || !container.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    }
  };
}

function focusInitialElement(container) {
  requestAnimationFrame(() => {
    const focusables = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      (node) => node.offsetParent !== null
    );
    const preferred = focusables.find((n) => n.tagName === 'INPUT' || n.tagName === 'SELECT' || n.tagName === 'TEXTAREA') || focusables[0];
    if (preferred && typeof preferred.focus === 'function') {
      preferred.focus();
    }
  });
}

// ============================================================================
// TOAST NOTIFICATIONS
// ============================================================================
let toastSeq = 0;

export function showToast(title, message = '', variant = 'info', durationMs = 4800) {
  const id = ++toastSeq;
  const item = { id, title, message, variant };
  store.toasts = [item, ...store.toasts].slice(0, 5);
  renderToastHost();
  if (durationMs > 0) {
    setTimeout(() => dismissToast(id), durationMs);
  }
  return id;
}

export function dismissToast(id) {
  store.toasts = store.toasts.filter((t) => t.id !== id);
  renderToastHost();
}

function renderToastHost() {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host', class: 'toast-host', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  clear(host);
  const iconMap = {
    success: 'icon-check-circle',
    warning: 'icon-warning',
    error: 'icon-x-circle',
    info: 'icon-info'
  };
  for (const t of store.toasts) {
    host.appendChild(
      el('div', { class: `toast-item toast-${t.variant}`, role: 'status' }, [
        el('span', { class: `toast-icon toast-icon-${t.variant}` }, [svgIcon(iconMap[t.variant] || 'icon-info', 16)]),
        el('div', { class: 'toast-body' }, [
          el('div', { class: 'toast-title', text: t.title }),
          t.message ? el('div', { class: 'toast-msg', text: t.message }) : null
        ]),
        el('button', {
          type: 'button',
          class: 'toast-close',
          title: 'Dismiss notification',
          'aria-label': 'Dismiss notification',
          onClick: () => dismissToast(t.id)
        }, [svgIcon('icon-close', 14)])
      ])
    );
  }
}

// ============================================================================
// MODAL DIALOG HELPER (Accessible, Focus Trap, Esc-to-close, Zero window.alert)
// ============================================================================
let modalOpener = null;

export function openModal({ title, subtitle = '', body, actions = [], wide = false, onClose = null }) {
  closeModal();
  modalOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const titleId = `modal-title-${Date.now()}`;

  const backdrop = el('div', {
    id: 'active-modal-backdrop',
    class: 'modal-backdrop',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId
  });

  const panel = el('div', { class: `modal-panel${wide ? ' modal-panel-wide' : ''}` }, [
    el('div', { class: 'modal-header' }, [
      el('div', { class: 'modal-header-text' }, [
        subtitle ? el('div', { class: 'modal-kicker', text: subtitle }) : null,
        el('h2', { id: titleId, class: 'modal-title', text: title })
      ]),
      el('button', {
        type: 'button',
        class: 'btn-icon',
        title: 'Close dialog',
        'aria-label': 'Close dialog',
        onClick: closeModal
      }, [svgIcon('icon-close', 16)])
    ]),
    el('div', { class: 'modal-body' }, [body]),
    actions.length > 0 ? el('div', { class: 'modal-footer' }, actions) : null
  ]);

  backdrop.appendChild(panel);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });

  const onKeyDown = createFocusTrapHandler(panel, closeModal);
  backdrop._keyHandler = onKeyDown;
  backdrop._onClose = onClose;
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(backdrop);
  focusInitialElement(panel);
  return { close: closeModal, panel };
}

export function closeModal() {
  const existing = document.getElementById('active-modal-backdrop');
  if (existing) {
    if (existing._keyHandler) document.removeEventListener('keydown', existing._keyHandler);
    const cb = existing._onClose;
    existing.remove();
    if (typeof cb === 'function') cb();
    if (modalOpener && document.contains(modalOpener)) {
      modalOpener.focus();
    }
    modalOpener = null;
  }
}

// ============================================================================
// SLIDE-OVER DETAIL DRAWER (Accessible, Focus Trap, Esc-to-close)
// ============================================================================
let drawerOpener = null;

export function openDrawer({ title, subtitle = '', body, actions = [], onClose = null }) {
  closeDrawer();
  drawerOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const titleId = `drawer-title-${Date.now()}`;

  const backdrop = el('div', {
    id: 'active-drawer-backdrop',
    class: 'drawer-backdrop',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId
  });

  const panel = el('aside', { class: 'drawer-panel' }, [
    el('div', { class: 'drawer-header' }, [
      el('div', { class: 'drawer-header-text' }, [
        subtitle ? el('div', { class: 'modal-kicker', text: subtitle }) : null,
        el('h2', { id: titleId, class: 'drawer-title', text: title })
      ]),
      el('button', {
        type: 'button',
        class: 'btn-icon',
        title: 'Close detail drawer',
        'aria-label': 'Close detail drawer',
        onClick: closeDrawer
      }, [svgIcon('icon-close', 16)])
    ]),
    el('div', { class: 'drawer-body' }, [body]),
    actions.length > 0 ? el('div', { class: 'drawer-footer' }, actions) : null
  ]);

  backdrop.appendChild(panel);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeDrawer();
  });

  const onKeyDown = createFocusTrapHandler(panel, closeDrawer);
  backdrop._keyHandler = onKeyDown;
  backdrop._onClose = onClose;
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(backdrop);
  focusInitialElement(panel);
  return { close: closeDrawer, panel };
}

export function closeDrawer() {
  const existing = document.getElementById('active-drawer-backdrop');
  if (existing) {
    if (existing._keyHandler) document.removeEventListener('keydown', existing._keyHandler);
    const cb = existing._onClose;
    existing.remove();
    if (typeof cb === 'function') cb();
    if (drawerOpener && document.contains(drawerOpener)) {
      drawerOpener.focus();
    }
    drawerOpener = null;
  }
}

export function closeAllOverlays() {
  closeModal();
  closeDrawer();
}

export function confirmDialog({
  title,
  subtitle = 'Confirmation Required',
  message,
  confirmLabel = 'Confirm',
  danger = false,
  specs = []
}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(val);
    };

    const body = el('div', { class: 'stack-md' }, [
      el('p', { class: 'text-secondary', text: message }),
      specs.length > 0
        ? el(
            'div',
            { class: 'spec-list' },
            specs.map(([k, v]) =>
              el('div', { class: 'spec-row' }, [
                el('span', { class: 'spec-key', text: k }),
                el('code', { class: 'spec-val', text: String(v) })
              ])
            )
          )
        : null
    ]);

    openModal({
      title,
      subtitle,
      body,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
      actions: [
        el('button', {
          type: 'button',
          class: 'btn btn-secondary',
          text: 'Cancel',
          onClick: () => finish(false)
        }),
        el('button', {
          type: 'button',
          class: danger ? 'btn btn-danger' : 'btn btn-primary',
          text: confirmLabel,
          onClick: () => finish(true)
        })
      ]
    });
  });
}

// ============================================================================
// SESSION & AUTH LIFECYCLE
// ============================================================================
let onSessionExpiredCallback = null;

export function setSessionExpiredHandler(fn) {
  onSessionExpiredCallback = fn;
}

configureApiClient({
  getCsrfToken: () => store.csrfToken,
  onUnauthorized: () => {
    if (store.authenticated) {
      clearSessionState();
      showToast('Session expired', 'Please sign in again to continue.', 'warning');
      if (onSessionExpiredCallback) onSessionExpiredCallback();
    }
  }
});

export function setSessionState(payload) {
  store.authChecked = true;
  store.authenticated = Boolean(payload?.authenticated);
  store.user = store.authenticated
    ? {
        id: payload.user?.id ?? payload.id ?? null,
        username: payload.user?.username ?? payload.username ?? 'operator',
        role: payload.user?.role ?? payload.role ?? 'Viewer'
      }
    : null;
  store.csrfToken = payload?.csrfToken || null;
  notify();
  if (store.authenticated) {
    startLiveStreams();
    refreshHeaderCounters();
  } else {
    stopLiveStreams();
  }
}

export function clearSessionState() {
  store.authChecked = true;
  store.authenticated = false;
  store.user = null;
  store.csrfToken = null;
  store.unreadCount = 0;
  store.activeAlarmCount = 0;
  stopLiveStreams();
  notify();
}

export async function checkSession() {
  try {
    const res = await api.getSession();
    setSessionState(res);
    return store.authenticated;
  } catch {
    clearSessionState();
    return false;
  }
}

export async function signOut() {
  try {
    await api.logout();
  } catch {
    // Clear local state regardless
  }
  clearSessionState();
}

export async function refreshHeaderCounters() {
  if (!store.authenticated) return;
  try {
    const [notifRes, healthRes] = await Promise.allSettled([
      api.listNotifications({ unread: 'true', limit: 1 }),
      api.getHealthReady()
    ]);
    if (notifRes.status === 'fulfilled') {
      store.unreadCount = Number(notifRes.value?.unread ?? notifRes.value?.unread_count ?? 0);
    }
    if (healthRes.status === 'fulfilled') {
      store.healthSummary = healthRes.value;
    }
    notify();
  } catch {
    // Non-fatal background refresh
  }
}

// ============================================================================
// WEBSOCKET MANAGER (Same-Origin Cookie Authenticated + Exponential Backoff)
// ============================================================================
const sockets = {
  telemetry: null,
  notifications: null,
  mfa: null
};
const reconnectTimers = {};
const reconnectAttempts = {};
let streamsActive = false;

function wsUrl(path) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
}

function recordSeriesValue(deviceId, key, val) {
  const num = typeof val === 'boolean' ? (val ? 1 : 0) : Number(val);
  if (!Number.isFinite(num)) return;
  const k = `${deviceId}:${key}`;
  const arr = store.telemetrySeries.get(k) || [];
  arr.push(num);
  if (arr.length > 36) arr.shift();
  store.telemetrySeries.set(k, arr);
}

function connectSocket(channel, path, stateKey, onMessage) {
  if (!streamsActive || !store.authenticated) return;
  if (sockets[channel] && sockets[channel].readyState <= 1) return;

  store[stateKey] = 'CONNECTING';
  notify();

  let ws;
  try {
    ws = new WebSocket(wsUrl(path));
  } catch {
    store[stateKey] = 'OFFLINE';
    notify();
    return;
  }
  sockets[channel] = ws;

  ws.addEventListener('open', () => {
    reconnectAttempts[channel] = 0;
    store[stateKey] = 'CONNECTED';
    notify();
  });

  ws.addEventListener('message', (evt) => {
    try {
      const parsed = JSON.parse(evt.data);
      onMessage(parsed);
    } catch {
      // Ignore malformed frames
    }
  });

  const scheduleReconnect = () => {
    sockets[channel] = null;
    store[stateKey] = 'OFFLINE';
    notify();
    if (!streamsActive || !store.authenticated) return;
    const attempt = (reconnectAttempts[channel] || 0) + 1;
    reconnectAttempts[channel] = attempt;
    const delay = Math.min(15000, 1000 * Math.pow(1.6, Math.min(attempt, 6)));
    clearTimeout(reconnectTimers[channel]);
    reconnectTimers[channel] = setTimeout(() => connectSocket(channel, path, stateKey, onMessage), delay);
  };

  ws.addEventListener('close', scheduleReconnect);
  ws.addEventListener('error', () => {
    try {
      ws.close();
    } catch {
      // ignore
    }
  });
}

let healthPollTimer = null;

export function startLiveStreams() {
  if (streamsActive) return;
  streamsActive = true;
  notificationSoundInitialized = false;
  notificationSoundCursor = 0;
  refreshCriticalNotificationSound(false);

  connectSocket('telemetry', '/ws/telemetry', 'wsTelemetry', (msg) => {
    const now = msg.timestamp || new Date().toISOString();
    store.lastTelemetryAt = now;

    if (msg.type === 'device_telemetry' && msg.device_id && msg.values) {
      const prev = store.latestTelemetryByDevice.get(msg.device_id) || { endpoints: {} };
      const endpoints = { ...prev.endpoints, ...msg.values };
      store.latestTelemetryByDevice.set(msg.device_id, { endpoints, ts: now });
      for (const [k, v] of Object.entries(msg.values)) {
        recordSeriesValue(msg.device_id, k, v);
      }
      emitLiveEvent('telemetry', msg);
    } else if (msg.node_id) {
      const devId = msg.node_id;
      const prev = store.latestTelemetryByDevice.get(devId) || { endpoints: {} };
      const merged = { ...prev.endpoints };
      for (const field of ['temperature', 'humidity', 'smoke_gas_level', 'fan_relay', 'light_state', 'door_state']) {
        if (msg[field] !== undefined) {
          merged[field] = msg[field];
          recordSeriesValue(devId, field, msg[field]);
        }
      }
      store.latestTelemetryByDevice.set(devId, { endpoints: merged, ts: now });
      emitLiveEvent('telemetry', msg);
    }
    notify();
  });

  connectSocket('notifications', '/ws/notifications', 'wsNotifications', (msg) => {
    refreshHeaderCounters();
    refreshCriticalNotificationSound(true);
    emitLiveEvent('notifications', msg);
  });

  connectSocket('mfa', '/ws/mfa', 'wsMfa', (msg) => {
    emitLiveEvent('mfa', msg);
  });

  clearInterval(healthPollTimer);
  healthPollTimer = setInterval(refreshHeaderCounters, 20000);
}

export function stopLiveStreams() {
  streamsActive = false;
  clearInterval(healthPollTimer);
  healthPollTimer = null;
  for (const key of Object.keys(reconnectTimers)) {
    clearTimeout(reconnectTimers[key]);
    delete reconnectTimers[key];
  }
  for (const key of Object.keys(sockets)) {
    if (sockets[key]) {
      try {
        sockets[key].close();
      } catch {
        // ignore
      }
      sockets[key] = null;
    }
  }
  store.wsTelemetry = 'OFFLINE';
  store.wsNotifications = 'OFFLINE';
  store.wsMfa = 'OFFLINE';
  store.criticalSoundEnabled = false;
  store.notificationAudioUnlocked = false;
  notificationSoundInitialized = false;
  notificationSoundCursor = 0;
  if (notificationAudioContext) {
    try { notificationAudioContext.close(); } catch { /* ignore */ }
    notificationAudioContext = null;
  }
}
