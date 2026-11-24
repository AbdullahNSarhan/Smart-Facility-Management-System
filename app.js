// LCI-SFM Platform Entrypoint & Shared Pure Utilities
// Preserves tested validation, sanitization, FIFO chart, host migration, and readiness summary exports
// while mounting the modular multi-page console (/, /login, /app/*) into #app-root.

import { mountLciPlatform } from './frontend/main.js';

export class LocalFIFOChart {
  constructor(canvas, config = {}) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.maxPoints = config.maxPoints || 30;
    this.label = config.label || 'Telemetry';
    this.unit = config.unit || '';
    this.color = config.color || '#2f81f7';
    this.dangerThreshold = config.dangerThreshold ?? null;
    this.warningThreshold = config.warningThreshold ?? null;
    this.thresholdLabel = config.thresholdLabel || '';
    this.minY = config.minY ?? config.min ?? 0;
    this.maxY = config.maxY ?? config.max ?? 100;
    this.labels = [];
    this.data = [];
    this.hoverIndex = null;
  }

  pushValue(timestampLabel, numericValue) {
    this.pushDataPoint(timestampLabel, numericValue);
  }

  pushDataPoint(timestampLabel, numericValue) {
    const num = Number(numericValue);
    if (!Number.isFinite(num)) return;
    if (this.labels.length >= this.maxPoints) this.labels.shift();
    if (this.data.length >= this.maxPoints) this.data.shift();
    this.labels.push(String(timestampLabel));
    this.data.push(num);
  }

  setSeries(labelsArray, dataArray) {
    this.labels = Array.isArray(labelsArray) ? labelsArray.slice(-this.maxPoints).map(String) : [];
    this.data = Array.isArray(dataArray)
      ? dataArray.slice(-this.maxPoints).map(Number).filter(Number.isFinite)
      : [];
    this.hoverIndex = null;
  }

  reset() {
    this.labels = [];
    this.data = [];
    this.hoverIndex = null;
  }
}

const IPV4_REGEX = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOST_PORT_REGEX = /^(([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+)(:\d{1,5})?$/;
const RFID_HEX_REGEX = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){3,7}$/;
const PIN_SIX_DIGIT_REGEX = /^\d{6}$/;

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

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mountLciPlatform());
  } else {
    mountLciPlatform();
  }
}
