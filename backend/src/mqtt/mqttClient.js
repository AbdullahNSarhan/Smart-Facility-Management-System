import mqtt from 'mqtt';
import { MQTT_TOPICS, getSubscribedTopics } from './topics.js';
import {
  mqttEnvTelemetrySchema,
  mqttMfaFaceSchema,
  mqttAccessStateSchema,
  mqttCommandAckSchema,
  mqttHeartbeatSchema
} from '../validators/schemas.js';
import { logger } from '../utils/logger.js';

export class MqttService {
  constructor({ config, repo, wsGateway, commandCoordinator }) {
    this.config = config;
    this.repo = repo;
    this.wsGateway = wsGateway;
    this.commandCoordinator = commandCoordinator;

    this.client = null;
    this.connected = false;
    this.lastActivityAt = null;
    this.nodeHeartbeats = new Map();
  }

  setCommandCoordinator(commandCoordinator) {
    this.commandCoordinator = commandCoordinator;
  }

  isConnected() {
    return Boolean(this.connected && this.client && this.client.connected);
  }

  getHealthStatus() {
    const nodes = {};
    for (const [nodeId, info] of this.nodeHeartbeats.entries()) {
      nodes[nodeId] = info;
    }
    return {
      enabled: this.config.mqttEnabled,
      connected: this.isConnected(),
      broker_url: this.config.mqttBrokerUrl,
      last_activity_at: this.lastActivityAt,
      observed_nodes: nodes
    };
  }

  connect() {
    if (!this.config.mqttEnabled) {
      logger.info('MQTT client disabled by configuration (MQTT_ENABLED=false)');
      return;
    }

    if (this.client) {
      return;
    }

    const options = {
      clientId: this.config.mqttClientId,
      clean: true,
      connectTimeout: this.config.mqttConnectTimeoutMs,
      reconnectPeriod: this.config.mqttReconnectPeriodMs,
      username: this.config.mqttUsername || undefined,
      password: this.config.mqttPassword || undefined
    };

    logger.info('Connecting singleton MQTT client to broker', {
      broker_url: this.config.mqttBrokerUrl,
      client_id: options.clientId,
      username: options.username
    });

    this.client = mqtt.connect(this.config.mqttBrokerUrl, options);

    this.client.on('connect', () => {
      this.connected = true;
      logger.info('MQTT broker connection established');
      this._subscribeAll();
    });

    this.client.on('reconnect', () => {
      logger.info('Attempting MQTT broker reconnection...');
    });

    this.client.on('close', () => {
      this.connected = false;
    });

    this.client.on('offline', () => {
      this.connected = false;
    });

    this.client.on('error', (err) => {
      this.connected = false;
      logger.warn('MQTT client error', { error: err?.message || String(err) });
    });

    this.client.on('message', (topic, messageBuffer) => {
      this.handleIncomingMessage(topic, messageBuffer);
    });
  }

  _subscribeAll() {
    if (!this.client) return;
    const subscriptions = getSubscribedTopics();
    for (const sub of subscriptions) {
      this.client.subscribe(sub.topic, { qos: sub.qos }, (err) => {
        if (err) {
          logger.error('Failed to subscribe to MQTT topic', {
            topic: sub.topic,
            error: err.message
          });
        } else {
          logger.info('Subscribed to MQTT topic', {
            topic: sub.topic,
            qos: sub.qos,
            status: sub.status
          });
        }
      });
    }
  }

  /**
   * Publishes a non-retained command payload to the broker.
   */
  publishCommand(topic, payloadObj, options = { qos: 1, retain: false }) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        return reject(new Error('MQTT client is not connected'));
      }
      const serialized = JSON.stringify(payloadObj);
      this.client.publish(
        topic,
        serialized,
        { qos: options.qos ?? 1, retain: false },
        (err) => {
          if (err) return reject(err);
          resolve(true);
        }
      );
    });
  }

  /**
   * Processes and validates an incoming MQTT message from the broker (or test harness).
   */
  handleIncomingMessage(topic, rawPayload) {
    this.lastActivityAt = new Date().toISOString();
    const payloadStr = Buffer.isBuffer(rawPayload)
      ? rawPayload.toString('utf8')
      : String(rawPayload);

    let parsed;
    try {
      parsed = JSON.parse(payloadStr);
    } catch (err) {
      logger.warn('Rejected malformed JSON on MQTT topic', {
        topic,
        error: err.message
      });
      this.repo.insertSystemError({
        source_node: topic,
        error_code: 'MQTT_MALFORMED_JSON',
        severity: 'WARN',
        error_description: `Malformed JSON payload received on topic "${topic}"`
      });
      return { ok: false, error: 'MQTT_MALFORMED_JSON' };
    }

    try {
      if (topic === MQTT_TOPICS.ENV_TELEMETRY.topic) {
        return this._handleEnvTelemetry(topic, parsed);
      }
      if (topic === MQTT_TOPICS.ACCESS_MFA_FACE.topic) {
        return this._handleMfaFace(topic, parsed);
      }
      if (topic === MQTT_TOPICS.ACCESS_STATE.topic) {
        return this._handleAccessState(topic, parsed);
      }
      if (
        topic === MQTT_TOPICS.ACCESS_COMMAND_ACK.topic ||
        topic === MQTT_TOPICS.ENV_COMMAND_ACK.topic
      ) {
        return this._handleCommandAck(topic, parsed);
      }
      if (/^lecf\/[^/]+\/heartbeat$/.test(topic)) {
        return this._handleHeartbeat(topic, parsed);
      }

      logger.warn('Ignored message on unhandled MQTT topic', { topic });
      return { ok: false, error: 'UNHANDLED_TOPIC' };
    } catch (err) {
      logger.error('Error processing MQTT message', {
        topic,
        error: err?.message || String(err)
      });
      return { ok: false, error: 'INTERNAL_PROCESSING_ERROR' };
    }
  }

  _handleEnvTelemetry(topic, raw) {
    const validation = mqttEnvTelemetrySchema.safeParse(raw);
    if (!validation.success) {
      const reason = validation.error.issues.map((i) => i.message).join('; ');
      logger.warn('Rejected invalid environmental telemetry payload', { topic, reason });
      this.repo.insertSystemError({
        source_node: raw?.node || raw?.node_id || 'env_02',
        error_code: 'MQTT_SCHEMA_VIOLATION',
        severity: 'WARN',
        error_description: `Invalid payload on ${topic}: ${reason}`
      });
      return { ok: false, error: 'SCHEMA_VIOLATION', details: reason };
    }

    const d = validation.data;
    const nodeId = d.node_id || d.node || 'env_02';
    const temperature = Number(d.temperature ?? d.temp ?? d.temperature_c);
    const humidity = Number(d.humidity ?? d.humidity_pct ?? 0);
    const smokeGasLevel =
      d.smoke_gas_level !== undefined
        ? Number(d.smoke_gas_level)
        : d.smoke_gas_ppm !== undefined
          ? Number(d.smoke_gas_ppm)
          : d.smoke === true
            ? 650
            : 120;

    // Infer fan_relay if firmware sent only temperature (documenting firmware threshold >= 28.0C)
    const fanRelay = d.fan_relay || (temperature >= 28.0 ? 'ON' : 'OFF');
    const lightState = d.light_state || 'OFF';
    const doorState = d.door_state || 'CLOSED';
    const nowMs = Date.now();
    const timestamp = new Date(nowMs).toISOString();

    const normalized = {
      timestamp,
      timestamp_ms: nowMs,
      node_id: nodeId,
      boot_id: d.boot_id ?? null,
      seq: d.seq ?? null,
      temperature,
      humidity,
      smoke_gas_level: smokeGasLevel,
      light_state: lightState,
      fan_relay: fanRelay,
      door_state: doorState
    };

    const insertResult = this.repo.insertEnvironmentalTelemetry(normalized);
    this.nodeHeartbeats.set(nodeId, {
      status: 'ONLINE',
      last_seen_at: timestamp,
      seq: normalized.seq
    });

    if (this.commandCoordinator) {
      this.commandCoordinator.handleObservedState(nodeId, normalized);
    }

    if (!insertResult.duplicate && this.wsGateway) {
      this.wsGateway.broadcastTelemetry(normalized);
    }

    return { ok: true, duplicate: insertResult.duplicate, data: normalized };
  }

  _handleMfaFace(topic, raw) {
    const validation = mqttMfaFaceSchema.safeParse(raw);
    if (!validation.success) {
      const reason = validation.error.issues.map((i) => i.message).join('; ');
      logger.warn('Rejected invalid MFA face payload', { topic, reason });
      this.repo.insertSystemError({
        source_node: 'node3',
        error_code: 'MQTT_SCHEMA_VIOLATION',
        severity: 'WARN',
        error_description: `Invalid payload on ${topic}: ${reason}`
      });
      return { ok: false, error: 'SCHEMA_VIOLATION', details: reason };
    }

    const d = validation.data;
    const timestamp = new Date().toISOString();
    const isVerified = d.status === 'verified';
    const userId = d.user_id || 'unknown';

    const cameraRes = this.repo.insertCameraEvent({
      timestamp,
      node_id: d.node_id || 'node3',
      boot_id: d.boot_id ?? null,
      seq: d.seq ?? null,
      event: 'FACE_VERIFICATION',
      user_id: userId,
      status: d.status.toUpperCase(),
      confidence: d.confidence ?? null,
      details: `Biometric result from vision service: ${d.status}`
    });

    this.repo.insertAccessLog({
      timestamp,
      node_id: d.node_id || 'node3',
      boot_id: d.boot_id ?? null,
      seq: d.seq ?? null,
      username: userId,
      modality: 'FACE_BIO',
      event: `Face verification ${d.status}`,
      status: isVerified ? 'VERIFIED' : 'REJECTED',
      mfa_status: isVerified ? 'AWAITING_STAGE2' : 'IDLE'
    });

    const mfaWsPayload = {
      timestamp,
      node_id: d.node_id || 'node3',
      user_id: userId,
      username: userId,
      status: d.status,
      isFacePassed: isVerified,
      mfa_status: isVerified ? 'AWAITING_STAGE2' : 'IDLE',
      confidence: d.confidence ?? null
    };

    if (!cameraRes.duplicate && this.wsGateway) {
      this.wsGateway.broadcastMfa(mfaWsPayload);
    }

    return { ok: true, duplicate: cameraRes.duplicate, data: mfaWsPayload };
  }

  _handleAccessState(topic, raw) {
    const validation = mqttAccessStateSchema.safeParse(raw);
    if (!validation.success) {
      const reason = validation.error.issues.map((i) => i.message).join('; ');
      this.repo.insertSystemError({
        source_node: 'node1',
        error_code: 'MQTT_SCHEMA_VIOLATION',
        severity: 'WARN',
        error_description: `Invalid payload on ${topic}: ${reason}`
      });
      return { ok: false, error: 'SCHEMA_VIOLATION', details: reason };
    }

    const d = validation.data;
    const timestamp = new Date().toISOString();
    const nodeId = d.node_id || 'node1';

    const logRes = this.repo.insertAccessLog({
      timestamp,
      node_id: nodeId,
      boot_id: d.boot_id ?? null,
      seq: d.seq ?? null,
      username: d.username || 'edge_user',
      modality: 'MFA_CONTROLLER',
      event: d.event || `MFA state -> ${d.mfa_status || d.door_state || 'UPDATE'}`,
      status: d.door_state === 'OPEN' || d.mfa_status === 'UNLOCKED' ? 'GRANTED' : 'INFO',
      mfa_status: d.mfa_status || null
    });

    this.nodeHeartbeats.set(nodeId, {
      status: 'ONLINE',
      last_seen_at: timestamp,
      seq: d.seq ?? null
    });

    if (this.commandCoordinator) {
      this.commandCoordinator.handleObservedState(nodeId, d);
    }

    if (!logRes.duplicate && this.wsGateway) {
      this.wsGateway.broadcastMfa({
        timestamp,
        node_id: nodeId,
        door_state: d.door_state,
        isFacePassed: d.isFacePassed,
        isCardPassed: d.isCardPassed,
        isPinPassed: d.isPinPassed,
        mfa_status: d.mfa_status,
        username: d.username
      });

      if (d.door_state) {
        this.wsGateway.broadcastTelemetry({
          timestamp,
          node_id: nodeId,
          door_state: d.door_state
        });
      }
    }

    return { ok: true, duplicate: logRes.duplicate, data: d };
  }

  _handleCommandAck(topic, raw) {
    const validation = mqttCommandAckSchema.safeParse(raw);
    if (!validation.success) {
      const reason = validation.error.issues.map((i) => i.message).join('; ');
      this.repo.insertSystemError({
        source_node: raw?.node_id || 'unknown',
        error_code: 'MQTT_ACK_SCHEMA_VIOLATION',
        severity: 'WARN',
        error_description: `Invalid command ack on ${topic}: ${reason}`
      });
      return { ok: false, error: 'SCHEMA_VIOLATION', details: reason };
    }

    if (this.commandCoordinator) {
      this.commandCoordinator.handleCommandAck(validation.data);
    }
    return { ok: true, data: validation.data };
  }

  _handleHeartbeat(topic, raw) {
    const validation = mqttHeartbeatSchema.safeParse(raw);
    if (!validation.success) {
      return { ok: false, error: 'SCHEMA_VIOLATION' };
    }
    const d = validation.data;
    const nowIso = new Date().toISOString();
    this.nodeHeartbeats.set(d.node_id, {
      status: d.status,
      boot_id: d.boot_id ?? null,
      seq: d.seq ?? null,
      uptime_ms: d.uptime_ms ?? null,
      last_seen_at: nowIso
    });
    return { ok: true, data: d };
  }

  async close() {
    if (!this.client) return;
    if (typeof this.client.end !== 'function') {
      this.connected = false;
      this.client = null;
      return;
    }
    return new Promise((resolve) => {
      this.client.end(true, {}, () => {
        this.connected = false;
        this.client = null;
        resolve();
      });
    });
  }
}
