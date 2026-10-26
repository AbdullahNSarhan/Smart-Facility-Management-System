import dns from 'node:dns';
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
  constructor({
    config,
    repo,
    wsGateway,
    commandCoordinator,
    dnsLookup = dns.lookup,
    mqttConnect = mqtt.connect
  }) {
    this.config = config;
    this.repo = repo;
    this.wsGateway = wsGateway;
    this.commandCoordinator = commandCoordinator;
    this._dnsLookup = dnsLookup;
    this._mqttConnect = mqttConnect;

    this.client = null;
    this.connected = false;
    this.subscriptionsReady = false;
    this.subscribedTopics = new Set();
    this.failedSubscriptions = new Map();
    this.lastError = null;
    this.lastActivityAt = null;
    this.nodeHeartbeats = new Map();

    this._closing = false;
    this._connecting = false;
    this._retryTimer = null;
    this._dnsAttempt = 0;
    this._connectionGeneration = 0;
  }

  setCommandCoordinator(commandCoordinator) {
    this.commandCoordinator = commandCoordinator;
  }

  isConnected() {
    return Boolean(this.config.mqttEnabled && this.connected && this.client && this.client.connected);
  }

  areSubscriptionsReady() {
    if (!this.config.mqttEnabled) return true;
    if (!this.isConnected()) return false;
    if (this.failedSubscriptions.size > 0) return false;
    if (this.subscriptionsReady) return true;
    if (this.client && typeof this.client.subscribe !== 'function') {
      return true;
    }
    return false;
  }

  getHealthStatus() {
    const now = Date.now();
    const nodeStaleMs = this.config.mqttNodeStaleMs ?? 90000;
    const nodes = {};
    for (const [nodeId, info] of this.nodeHeartbeats.entries()) {
      const observedAt = Date.parse(info.last_seen_at);
      const ageMs = Number.isFinite(observedAt) ? Math.max(0, now - observedAt) : null;
      const fresh = ageMs !== null && ageMs <= nodeStaleMs;
      nodes[nodeId] = {
        ...info,
        reported_status: info.status,
        status: !this.isConnected() ? 'UNKNOWN' : !fresh ? 'STALE' : info.status,
        fresh: Boolean(this.isConnected() && fresh),
        age_ms: ageMs
      };
    }
    const enabled = Boolean(this.config.mqttEnabled);
    const connected = enabled ? this.isConnected() : false;
    const subscriptionsReady = !enabled ? true : this.areSubscriptionsReady();
    const state = !enabled
      ? 'standby'
      : !connected
        ? 'disconnected'
        : subscriptionsReady
          ? 'connected'
          : 'degraded';
    return {
      enabled,
      connected,
      subscriptions_ready: subscriptionsReady,
      subscribed_topics: Array.from(this.subscribedTopics),
      failed_subscriptions: Object.fromEntries(this.failedSubscriptions),
      state,
      last_error: this.lastError || null,
      broker_url: this.config.mqttBrokerUrl,
      last_activity_at: this.lastActivityAt,
      observed_nodes: nodes
    };
  }

  _scheduleDnsRetry() {
    if (this._closing || !this.config.mqttEnabled || this.client || this._retryTimer) {
      return;
    }
    const baseMs = Math.max(50, Number(this.config.mqttDnsRetryBaseMs ?? 1000));
    const maxMs = Math.max(baseMs, Number(this.config.mqttDnsRetryMaxMs ?? 30000));
    const exponent = Math.min(6, Math.max(0, this._dnsAttempt - 1));
    const delayMs = Math.min(maxMs, baseMs * (2 ** exponent));

    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (!this._closing && this.config.mqttEnabled && !this.client) {
        this.connect();
      }
    }, delayMs);

    if (this._retryTimer.unref) {
      this._retryTimer.unref();
    }
  }

  connect() {
    this._closing = false;

    if (!this.config.mqttEnabled) {
      logger.info('MQTT client in standby mode (MQTT_ENABLED=false)');
      return;
    }

    if (this.client || this._connecting) {
      return;
    }

    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }

    let brokerHostname = 'localhost';
    try {
      const parsed = new URL(this.config.mqttBrokerUrl);
      if (parsed.protocol !== 'mqtt:' && parsed.protocol !== 'mqtts:') {
        throw new Error(`Unsupported MQTT protocol "${parsed.protocol}"`);
      }
      if (!parsed.hostname) {
        throw new Error('Missing MQTT broker hostname');
      }
      brokerHostname = parsed.hostname;
    } catch (err) {
      this.lastError = err?.message || 'Invalid MQTT_BROKER_URL';
      logger.error('Invalid MQTT_BROKER_URL; cannot initiate broker connection', {
        broker_url: this.config.mqttBrokerUrl,
        error: this.lastError
      });
      return;
    }

    this._connecting = true;

    this._dnsLookup(brokerHostname, (dnsErr) => {
      this._connecting = false;

      if (this._closing || this.client || !this.config.mqttEnabled) {
        return;
      }

      if (dnsErr) {
        this.connected = false;
        this.subscriptionsReady = false;
        this._dnsAttempt += 1;
        this.lastError = dnsErr.code || dnsErr.message || String(dnsErr);
        if (this._dnsAttempt === 1) {
          logger.info('MQTT broker host is not yet resolvable; scheduling bounded DNS retry', {
            broker_url: this.config.mqttBrokerUrl,
            host: brokerHostname,
            attempt: this._dnsAttempt,
            reason: this.lastError
          });
        }
        this._scheduleDnsRetry();
        return;
      }

      this._dnsAttempt = 0;

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

      this.client = this._mqttConnect(this.config.mqttBrokerUrl, options);
      let loggedOfflineNotice = false;

      this.client.on('connect', () => {
        if (this._closing) return;
        this._connectionGeneration += 1;
        const generation = this._connectionGeneration;
        this.connected = true;
        this.lastError = null;
        this.subscribedTopics.clear();
        this.failedSubscriptions.clear();
        this.subscriptionsReady = false;
        loggedOfflineNotice = false;
        logger.info('MQTT broker connection established');
        this._subscribeAll(generation);
      });

      this.client.on('reconnect', () => {
        this.connected = false;
        this.subscriptionsReady = false;
        this.subscribedTopics.clear();
        if (!loggedOfflineNotice) {
          logger.info('Attempting MQTT broker reconnection...');
        }
      });

      this.client.on('close', () => {
        this.connected = false;
        this.subscriptionsReady = false;
        this.subscribedTopics.clear();
      });

      this.client.on('offline', () => {
        this.connected = false;
        this.subscriptionsReady = false;
        this.subscribedTopics.clear();
      });

      this.client.on('error', (err) => {
        this.connected = false;
        this.subscriptionsReady = false;
        const reason = err?.message || String(err);
        this.lastError = reason;
        if (!loggedOfflineNotice) {
          loggedOfflineNotice = true;
          logger.info('MQTT broker currently unreachable; standing by', {
            broker_url: this.config.mqttBrokerUrl,
            reason
          });
        }
      });

      this.client.on('message', (topic, messageBuffer) => {
        this.handleIncomingMessage(topic, messageBuffer);
      });
    });
  }

  _subscribeAll(generation = this._connectionGeneration) {
    if (!this.client) return;
    const subscriptions = getSubscribedTopics();
    if (subscriptions.length === 0) {
      this.subscriptionsReady = true;
      return;
    }

    for (const sub of subscriptions) {
      this.client.subscribe(sub.topic, { qos: sub.qos }, (err, granted) => {
        if (generation !== this._connectionGeneration || !this.connected || this._closing) {
          return;
        }

        const grantFailure =
          Array.isArray(granted) &&
          granted.some(
            (g) => g && (g.qos === 128 || g.qos === 0x80 || typeof g.qos !== 'number' || g.qos < 0 || g.qos > 2)
          );

        if (err || grantFailure) {
          const reason = err
            ? err.message || String(err)
            : `Broker rejected subscription grant (${JSON.stringify(granted)})`;
          this.failedSubscriptions.set(sub.topic, reason);
          this.subscribedTopics.delete(sub.topic);
          this.subscriptionsReady = false;
          this.lastError = `Subscription failed for ${sub.topic}: ${reason}`;
          logger.error('Failed to subscribe to MQTT topic', {
            topic: sub.topic,
            error: reason
          });
          return;
        }

        this.failedSubscriptions.delete(sub.topic);
        this.subscribedTopics.add(sub.topic);

        const allSubscribed = subscriptions.every((item) => this.subscribedTopics.has(item.topic));
        this.subscriptionsReady = allSubscribed && this.failedSubscriptions.size === 0;

        logger.info('Subscribed to MQTT topic', {
          topic: sub.topic,
          qos: sub.qos,
          status: sub.status
        });
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
      if (topic === MQTT_TOPICS.READER_ENROLL_EVENT.topic) {
        return this.management?.handleEnrollmentEvent(parsed) || { ok: false, error: 'MANAGEMENT_UNAVAILABLE' };
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
      ...this.nodeHeartbeats.get(nodeId),
      status: 'ONLINE',
      last_seen_at: timestamp,
      seq: normalized.seq
    });

    // QoS 1 retransmissions may have the same (node_id, boot_id, seq).
    // A duplicate must not be treated as fresh evidence for command completion.
    if (!insertResult.duplicate && this.commandCoordinator) {
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
      ...this.nodeHeartbeats.get(nodeId),
      status: 'ONLINE',
      last_seen_at: timestamp,
      seq: d.seq ?? null
    });

    if (!logRes.duplicate && this.commandCoordinator) {
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
      const outcome = this.commandCoordinator.handleCommandAck(validation.data, topic);
      return { ...outcome, data: validation.data };
    }
    return { ok: false, error: 'COMMAND_COORDINATOR_UNAVAILABLE' };
  }

  _handleHeartbeat(topic, raw) {
    const validation = mqttHeartbeatSchema.safeParse(raw);
    if (!validation.success) {
      return { ok: false, error: 'SCHEMA_VIOLATION' };
    }
    const d = validation.data;
    const nowIso = new Date().toISOString();
    this.nodeHeartbeats.set(d.node_id, {
      firmware_version: d.firmware_version ?? null,
      capabilities: topic === 'lecf/node1/heartbeat' && d.node_id === this.config.node1Id ? (d.capabilities || []) : [],
      capabilities_seen_at: topic === 'lecf/node1/heartbeat' && d.node_id === this.config.node1Id ? nowIso : null,
      status: d.status,
      boot_id: d.boot_id ?? null,
      seq: d.seq ?? null,
      uptime_ms: d.uptime_ms ?? null,
      last_seen_at: nowIso
    });
    return { ok: true, data: d };
  }

  async close() {
    this._closing = true;
    this._connecting = false;
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    this._connectionGeneration += 1;
    this.connected = false;
    this.subscriptionsReady = false;
    this.subscribedTopics.clear();
    this.failedSubscriptions.clear();

    if (!this.client) return;
    const clientToClose = this.client;
    this.client = null;
    if (typeof clientToClose.end !== 'function') {
      return;
    }
    return new Promise((resolve) => {
      clientToClose.end(true, {}, () => {
        resolve();
      });
    });
  }
}
