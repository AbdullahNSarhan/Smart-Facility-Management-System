import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'lci_sfm.db');

export function loadConfig(overrides = {}) {
  const nodeEnv = overrides.NODE_ENV || process.env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';

  const config = {
    nodeEnv,
    isProd,
    port: Number(overrides.PORT ?? process.env.PORT ?? 3000),
    host: overrides.HOST || process.env.HOST || '0.0.0.0',
    sqlitePath: overrides.SQLITE_DB_PATH || process.env.SQLITE_DB_PATH || DEFAULT_DB_PATH,

    // MQTT Broker configuration (Docker internal DNS default: mqtt://mqtt-service:1883)
    mqttBrokerUrl: overrides.MQTT_BROKER_URL || process.env.MQTT_BROKER_URL || 'mqtt://mqtt-service:1883',
    mqttUsername: overrides.MQTT_USERNAME ?? process.env.MQTT_USERNAME ?? 'lci_backend',
    mqttPassword: overrides.MQTT_PASSWORD ?? process.env.MQTT_PASSWORD ?? '',
    mqttClientId: overrides.MQTT_CLIENT_ID || process.env.MQTT_CLIENT_ID || `lci-backend-${process.pid}`,
    mqttConnectTimeoutMs: Number(overrides.MQTT_CONNECT_TIMEOUT_MS ?? process.env.MQTT_CONNECT_TIMEOUT_MS ?? 4000),
    mqttReconnectPeriodMs: Number(overrides.MQTT_RECONNECT_PERIOD_MS ?? process.env.MQTT_RECONNECT_PERIOD_MS ?? 5000),
    mqttEnabled: (overrides.MQTT_ENABLED ?? process.env.MQTT_ENABLED ?? 'true') !== 'false',

    // Session & Auth configuration
    sessionCookieName: overrides.SESSION_COOKIE_NAME || process.env.SESSION_COOKIE_NAME || 'lci_sid',
    sessionIdleTtlMs: Number(overrides.SESSION_IDLE_TTL_MS ?? process.env.SESSION_IDLE_TTL_MS ?? 30 * 60 * 1000), // 30m
    sessionAbsoluteTtlMs: Number(overrides.SESSION_ABSOLUTE_TTL_MS ?? process.env.SESSION_ABSOLUTE_TTL_MS ?? 8 * 60 * 60 * 1000), // 8h
    sessionSecureCookie: (overrides.SESSION_SECURE_COOKIE ?? process.env.SESSION_SECURE_COOKIE ?? 'false') === 'true',
    allowBearerCompat: (overrides.ALLOW_BEARER_COMPAT ?? process.env.ALLOW_BEARER_COMPAT ?? 'true') !== 'false',
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

  if (isProd) {
    if (config.mqttEnabled && !config.mqttPassword) {
      throw new Error(
        'FATAL CONFIG ERROR: MQTT_PASSWORD is required in production mode when MQTT_ENABLED=true.'
      );
    }
    if (
      config.bootstrapAdminPassword &&
      (config.bootstrapAdminPassword.length < 8 || config.bootstrapAdminPassword.toLowerCase() === 'admin')
    ) {
      throw new Error(
        'FATAL CONFIG ERROR: LCI_BOOTSTRAP_ADMIN_PASSWORD in production must be at least 8 characters and must never be "admin".'
      );
    }
  }

  return config;
}
