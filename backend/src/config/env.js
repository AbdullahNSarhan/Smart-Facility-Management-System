import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'lci_sfm.db');

export function isValidIpv4Address(ipStr) {
  if (typeof ipStr !== 'string') return false;
  const trimmed = ipStr.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const num = Number(part);
    return Number.isInteger(num) && num >= 0 && num <= 255;
  });
}

export function validateMqttBrokerUrl(brokerUrl) {
  if (typeof brokerUrl !== 'string' || brokerUrl.trim().length === 0) {
    throw new Error('FATAL CONFIG ERROR: MQTT_BROKER_URL must be a non-empty mqtt:// or mqtts:// URL.');
  }
  let parsed;
  try {
    parsed = new URL(brokerUrl.trim());
  } catch {
    throw new Error(
      `FATAL CONFIG ERROR: Invalid MQTT_BROKER_URL "${brokerUrl}". Expected mqtt://host:port or mqtts://host:port.`
    );
  }
  if (parsed.protocol !== 'mqtt:' && parsed.protocol !== 'mqtts:') {
    throw new Error(
      `FATAL CONFIG ERROR: Unsupported MQTT_BROKER_URL protocol "${parsed.protocol}". Allowed protocols: mqtt:, mqtts:.`
    );
  }
  if (!parsed.hostname) {
    throw new Error(
      `FATAL CONFIG ERROR: MQTT_BROKER_URL "${brokerUrl}" is missing a valid broker hostname.`
    );
  }
  return parsed;
}

function resolveWritableSqlitePath(requestedPath, { isExplicit = false, isProd = false } = {}) {
  const target = requestedPath ? String(requestedPath).trim() : DEFAULT_DB_PATH;
  if (target === ':memory:') return ':memory:';
  const abs = path.resolve(target);
  const dir = path.dirname(abs);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    if (fs.existsSync(abs)) {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        throw new Error(`Target SQLITE_DB_PATH "${abs}" is a directory, not a file.`);
      }
      fs.accessSync(abs, fs.constants.R_OK | fs.constants.W_OK);
    }
    return abs;
  } catch (err) {
    if (isProd || isExplicit) {
      throw new Error(
        `FATAL CONFIG ERROR: SQLite database path "${abs}" is not writable or its directory "${dir}" could not be initialized: ${err.message}`
      );
    }
    fs.mkdirSync(path.dirname(DEFAULT_DB_PATH), { recursive: true });
    return DEFAULT_DB_PATH;
  }
}

function resolveTrustProxy(rawTrustProxy) {
  if (rawTrustProxy === undefined || rawTrustProxy === null || rawTrustProxy === '') {
    return false;
  }
  if (typeof rawTrustProxy === 'boolean' || typeof rawTrustProxy === 'number') {
    return rawTrustProxy;
  }
  const normalized = String(rawTrustProxy).trim();
  if (normalized.toLowerCase() === 'false' || normalized === '0') return false;
  if (normalized.toLowerCase() === 'true') return 1;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return normalized;
}

export function loadConfig(overrides = {}) {
  const nodeEnv = overrides.NODE_ENV || process.env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';
  if(isProd && String(overrides.LCI_SIMULATOR_MODE ?? process.env.LCI_SIMULATOR_MODE)==='true')throw new Error('Simulator mode is forbidden in production');

  const explicitSqlitePath = overrides.SQLITE_DB_PATH ?? process.env.SQLITE_DB_PATH;
  const rawSqlitePath = explicitSqlitePath || DEFAULT_DB_PATH;

  const rawBearerCompat = overrides.ALLOW_BEARER_COMPAT ?? process.env.ALLOW_BEARER_COMPAT;
  const allowBearerCompat =
    rawBearerCompat !== undefined
      ? String(rawBearerCompat).trim().toLowerCase() === 'true'
      : !isProd;

  const rawFrontendBindIp = overrides.FRONTEND_BIND_IP ?? process.env.FRONTEND_BIND_IP;
  const rawMqttBindIp = overrides.MQTT_BIND_IP ?? process.env.MQTT_BIND_IP;

  if (rawFrontendBindIp !== undefined && String(rawFrontendBindIp).trim() !== '') {
    if (!isValidIpv4Address(String(rawFrontendBindIp))) {
      throw new Error(
        `FATAL CONFIG ERROR: FRONTEND_BIND_IP "${rawFrontendBindIp}" is not a valid IPv4 address.`
      );
    }
  }
  if (rawMqttBindIp !== undefined && String(rawMqttBindIp).trim() !== '') {
    if (!isValidIpv4Address(String(rawMqttBindIp))) {
      throw new Error(
        `FATAL CONFIG ERROR: MQTT_BIND_IP "${rawMqttBindIp}" is not a valid IPv4 address.`
      );
    }
  }

  const config = {
    // Simulator is an explicit development-only process with a separate database.
    simulatorMode: !isProd && String(overrides.LCI_SIMULATOR_MODE ?? process.env.LCI_SIMULATOR_MODE) === 'true',
    nodeEnv,
    isProd,
    port: Number(overrides.PORT ?? process.env.PORT ?? 3000),
    host: overrides.HOST || process.env.HOST || '0.0.0.0',
    trustProxy: resolveTrustProxy(overrides.TRUST_PROXY ?? process.env.TRUST_PROXY),
    sqlitePath: resolveWritableSqlitePath(rawSqlitePath, {
      isExplicit: explicitSqlitePath !== undefined && String(explicitSqlitePath).trim() !== '',
      isProd
    }),

    // MQTT Broker configuration (Docker internal DNS default: mqtt://mqtt-service:1883)
    mqttBrokerUrl: overrides.MQTT_BROKER_URL || process.env.MQTT_BROKER_URL || 'mqtt://mqtt-service:1883',
    mqttUsername: overrides.MQTT_USERNAME ?? process.env.MQTT_USERNAME ?? 'lci_backend',
    mqttPassword: overrides.MQTT_PASSWORD ?? process.env.MQTT_PASSWORD ?? '',
    mqttClientId: overrides.MQTT_CLIENT_ID || process.env.MQTT_CLIENT_ID || `lci-backend-${process.pid}`,
    mqttConnectTimeoutMs: Number(overrides.MQTT_CONNECT_TIMEOUT_MS ?? process.env.MQTT_CONNECT_TIMEOUT_MS ?? 4000),
    mqttReconnectPeriodMs: Number(overrides.MQTT_RECONNECT_PERIOD_MS ?? process.env.MQTT_RECONNECT_PERIOD_MS ?? 5000),
    mqttDnsRetryBaseMs: Number(overrides.MQTT_DNS_RETRY_BASE_MS ?? process.env.MQTT_DNS_RETRY_BASE_MS ?? 1000),
    mqttDnsRetryMaxMs: Number(overrides.MQTT_DNS_RETRY_MAX_MS ?? process.env.MQTT_DNS_RETRY_MAX_MS ?? 30000),
    // Device activity is independent of broker readiness. Missing/stale devices must
    // never make the central service unhealthy before hardware is provisioned.
    mqttNodeStaleMs: Number(overrides.MQTT_NODE_STALE_MS ?? process.env.MQTT_NODE_STALE_MS ?? 90000),
    mqttEnabled:
      overrides.MQTT_ENABLED !== undefined
        ? String(overrides.MQTT_ENABLED) !== 'false'
        : process.env.MQTT_ENABLED !== undefined
          ? String(process.env.MQTT_ENABLED) !== 'false'
          : Boolean(overrides.MQTT_BROKER_URL || process.env.MQTT_BROKER_URL || isProd),

    // Session & Auth configuration
    sessionCookieName: overrides.SESSION_COOKIE_NAME || process.env.SESSION_COOKIE_NAME || 'lci_sid',
    sessionIdleTtlMs: Number(overrides.SESSION_IDLE_TTL_MS ?? process.env.SESSION_IDLE_TTL_MS ?? 30 * 60 * 1000), // 30m
    sessionAbsoluteTtlMs: Number(overrides.SESSION_ABSOLUTE_TTL_MS ?? process.env.SESSION_ABSOLUTE_TTL_MS ?? 8 * 60 * 60 * 1000), // 8h
    sessionSecureCookie: (overrides.SESSION_SECURE_COOKIE ?? process.env.SESSION_SECURE_COOKIE ?? 'false') === 'true',
    allowBearerCompat,
    allowedOrigins: (overrides.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),

    // One-time Admin Bootstrap secret (never hardcoded to admin/admin)
    bootstrapAdminUsername: overrides.LCI_BOOTSTRAP_ADMIN_USERNAME || process.env.LCI_BOOTSTRAP_ADMIN_USERNAME || 'admin',
    bootstrapAdminPassword: overrides.LCI_BOOTSTRAP_ADMIN_PASSWORD || process.env.LCI_BOOTSTRAP_ADMIN_PASSWORD || '',

    // Edge Node target identifiers & default LAN endpoints (server-authoritative)
    node1Id: overrides.NODE1_ID || process.env.NODE1_ID || 'node1',
    node2Id: overrides.NODE2_ID || process.env.NODE2_ID || 'env_02',
    node3Id: overrides.NODE3_ID || process.env.NODE3_ID || 'node3',
    node1Ip: overrides.IP_NODE1 || process.env.IP_NODE1 || '192.168.43.11',
    node2Ip: overrides.IP_NODE2 || process.env.IP_NODE2 || '192.168.43.12',
    node3Ip: overrides.IP_NODE3 || process.env.IP_NODE3 || '192.168.43.13',

    // Command Coordinator timeouts
    commandAckTimeoutMs: Number(overrides.COMMAND_ACK_TIMEOUT_MS ?? process.env.COMMAND_ACK_TIMEOUT_MS ?? 5000)
  };

  if (!Number.isInteger(config.mqttNodeStaleMs) || config.mqttNodeStaleMs < 1000 || config.mqttNodeStaleMs > 3600000) {
    throw new Error('FATAL CONFIG ERROR: MQTT_NODE_STALE_MS must be an integer between 1000 and 3600000 milliseconds.');
  }

  if (config.mqttEnabled) {
    validateMqttBrokerUrl(config.mqttBrokerUrl);
  }

  if (isProd) {
    const looksLikePlaceholder = (value) =>
      /^(replace|change_me|changeme|example|your_|set_me)/i.test(String(value || '').trim());

    if (config.bootstrapAdminUsername.trim().toLowerCase() === 'admin') {
      throw new Error(
        'FATAL CONFIG ERROR: Set LCI_BOOTSTRAP_ADMIN_USERNAME to a non-default administrator name in production.'
      );
    }
    if (
      !config.bootstrapAdminPassword ||
      config.bootstrapAdminPassword.length < 24 ||
      looksLikePlaceholder(config.bootstrapAdminPassword)
    ) {
      throw new Error(
        'FATAL CONFIG ERROR: Set LCI_BOOTSTRAP_ADMIN_PASSWORD to a unique, randomly generated secret of at least 24 characters before production start.'
      );
    }
    if (config.mqttEnabled && (
      !config.mqttPassword ||
      config.mqttPassword.length < 24 ||
      looksLikePlaceholder(config.mqttPassword)
    )) {
      throw new Error(
        'FATAL CONFIG ERROR: Set MQTT_PASSWORD to the matching Mosquitto backend credential (at least 24 characters) before enabling MQTT in production.'
      );
    }
  }

  return config;
}
