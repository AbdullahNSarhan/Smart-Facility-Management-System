import crypto from 'node:crypto';
import { MQTT_TOPICS } from '../mqtt/topics.js';
import { logger } from '../utils/logger.js';

const COMMAND_TARGET_MAP = Object.freeze({
  EMERGENCY_DOOR_UNLOCK: {
    targetNodeKey: 'node1Id',
    defaultNode: 'node1',
    topic: MQTT_TOPICS.ACCESS_COMMAND.topic,
    ackTopic: MQTT_TOPICS.ACCESS_COMMAND_ACK.topic,
    telemetryField: 'door_state'
  },
  TOGGLE_HVAC_FAN: {
    targetNodeKey: 'node2Id',
    defaultNode: 'env_02',
    topic: MQTT_TOPICS.ENV_COMMAND.topic,
    ackTopic: MQTT_TOPICS.ENV_COMMAND_ACK.topic,
    telemetryField: 'fan_relay'
  },
  TOGGLE_AUX_LIGHT: {
    targetNodeKey: 'node2Id',
    defaultNode: 'env_02',
    topic: MQTT_TOPICS.ENV_COMMAND.topic,
    ackTopic: MQTT_TOPICS.ENV_COMMAND_ACK.topic,
    telemetryField: 'light_state'
  },
  SET_CONTROL_MODE: {
    targetNodeKey: 'node2Id',
    defaultNode: 'env_02',
    topic: MQTT_TOPICS.ENV_COMMAND.topic,
    ackTopic: MQTT_TOPICS.ENV_COMMAND_ACK.topic,
    telemetryField: 'control_mode'
  }
});

export class CommandCoordinator {
  constructor({ repo, mqttService, wsGateway, config }) {
    this.repo = repo;
    this.mqttService = mqttService;
    this.wsGateway = wsGateway;
    this.config = config;

    // Map<command_id, { command, requestedState, targetNode, telemetryField, timer, resolveHttp, settled }>
    this.pendingCommands = new Map();
  }

  setMqttService(mqttService) {
    this.mqttService = mqttService;
  }

  /**
   * Dispatches a validated operator command to the target MQTT topic,
   * records a durable command_audit row, and tracks acknowledgement/timeout.
   */
  async dispatchCommand({ command, state, actor, requestId, waitForAckMs = 150 }) {
    const mapping = COMMAND_TARGET_MAP[command];
    if (!mapping) {
      return {
        httpStatus: 400,
        body: {
          ok: false,
          status: 'rejected',
          lifecycle_state: 'rejected',
          error: `Unsupported command: ${command}`,
          code: 'INVALID_COMMAND',
          request_id: requestId
        }
      };
    }

    const commandId = crypto.randomUUID();
    const targetNode = this.config[mapping.targetNodeKey] || mapping.defaultNode;
    const nowMs = Date.now();
    const issuedAt = new Date(nowMs).toISOString();
    const ackTimeoutMs = this.config.commandAckTimeoutMs || 5000;
    const expiresAt = new Date(nowMs + ackTimeoutMs).toISOString();

    // Verify MQTT broker availability before claiming publish
    if (!this.mqttService || !this.mqttService.isConnected()) {
      this.repo.createCommandAudit({
        command_id: commandId,
        request_id: requestId,
        actor_user_id: actor.id,
        actor_username: actor.username,
        command,
        requested_state: state,
        target_node: targetNode,
        mqtt_topic: mapping.topic,
        lifecycle_state: 'unavailable',
        issued_at: issuedAt,
        expires_at: expiresAt,
        error_code: 'MQTT_BROKER_UNAVAILABLE',
        details: 'MQTT broker connection is offline; command could not be published'
      });

      this.repo.insertAccessLog({
        timestamp: issuedAt,
        node_id: targetNode,
        username: actor.username,
        modality: 'REMOTE_CMD',
        event: `${command} -> ${state}`,
        status: 'UNAVAILABLE',
        details: `Command ${commandId} aborted: MQTT broker unavailable`
      });

      return {
        httpStatus: 503,
        body: {
          ok: false,
          command_id: commandId,
          command,
          state,
          target_node: targetNode,
          mqtt_topic: mapping.topic,
          status: 'unavailable',
          lifecycle_state: 'unavailable',
          verified_hardware_ack: false,
          error: 'MQTT broker is currently disconnected; command was not published to edge hardware.',
          code: 'MQTT_UNAVAILABLE',
          request_id: requestId
        }
      };
    }

    // Record initial command audit row prior to publish
    this.repo.createCommandAudit({
      command_id: commandId,
      request_id: requestId,
      actor_user_id: actor.id,
      actor_username: actor.username,
      command,
      requested_state: state,
      target_node: targetNode,
      mqtt_topic: mapping.topic,
      lifecycle_state: 'published',
      issued_at: issuedAt,
      expires_at: expiresAt,
      details: 'Published to MQTT broker (retain=false, qos=1); awaiting device acknowledgement or telemetry state confirmation'
    });

    const mqttPayload = {
      schema_version: 1,
      command_id: commandId,
      request_id: requestId,
      command,
      state,
      target_node: targetNode,
      issued_by: actor.username,
      issued_at: issuedAt,
      expires_at: expiresAt
    };

    try {
      await this.mqttService.publishCommand(mapping.topic, mqttPayload, { qos: 1, retain: false });
    } catch (err) {
      const errMsg = err?.message || 'MQTT publish failed';
      this.repo.updateCommandAuditState(commandId, {
        lifecycle_state: 'failed',
        error_code: 'MQTT_PUBLISH_ERROR',
        details: errMsg
      });

      this.repo.insertAccessLog({
        timestamp: issuedAt,
        node_id: targetNode,
        username: actor.username,
        modality: 'REMOTE_CMD',
        event: `${command} -> ${state}`,
        status: 'FAILED',
        details: `Command ${commandId} publish error: ${errMsg}`
      });

      return {
        httpStatus: 502,
        body: {
          ok: false,
          command_id: commandId,
          command,
          state,
          target_node: targetNode,
          mqtt_topic: mapping.topic,
          status: 'failed',
          lifecycle_state: 'failed',
          verified_hardware_ack: false,
          error: `Failed to publish command to MQTT broker: ${errMsg}`,
          code: 'MQTT_PUBLISH_FAILED',
          request_id: requestId
        }
      };
    }

    this.repo.insertAccessLog({
      timestamp: issuedAt,
      node_id: targetNode,
      username: actor.username,
      modality: 'REMOTE_CMD',
      event: `${command} -> ${state}`,
      status: 'PUBLISHED',
      details: `Command ${commandId} published to ${mapping.topic}`
    });

    // Wait briefly (waitForAckMs) in case a fast device or test simulator acknowledges immediately,
    // while maintaining background timeout tracking up to ackTimeoutMs.
    const outcome = await this._trackPendingCommand({
      commandId,
      command,
      requestedState: state,
      targetNode,
      telemetryField: mapping.telemetryField,
      ackTimeoutMs,
      waitForAckMs: Math.min(waitForAckMs, ackTimeoutMs)
    });

    const isConfirmed =
      outcome.lifecycle_state === 'acknowledged' || outcome.lifecycle_state === 'state_confirmed';
    const isFailed =
      outcome.lifecycle_state === 'failed' || outcome.lifecycle_state === 'rejected';

    return {
      httpStatus: isFailed ? 422 : 200,
      body: {
        ok: !isFailed,
        command_id: commandId,
        command,
        state,
        target_node: targetNode,
        mqtt_topic: mapping.topic,
        status: outcome.lifecycle_state,
        lifecycle_state: outcome.lifecycle_state,
        verified_hardware_ack: isConfirmed,
        observed_state: outcome.observed_state || null,
        issued_at: issuedAt,
        expires_at: expiresAt,
        note: isConfirmed
          ? 'Edge node confirmed command execution.'
          : 'Command published to MQTT broker. Physical actuation confirmation awaits device ACK or next telemetry frame.',
        request_id: requestId
      }
    };
  }

  _trackPendingCommand({
    commandId,
    command,
    requestedState,
    targetNode,
    telemetryField,
    ackTimeoutMs,
    waitForAckMs
  }) {
    return new Promise((resolve) => {
      let httpResolved = false;

      const finishHttp = (result) => {
        if (!httpResolved) {
          httpResolved = true;
          resolve(result);
        }
      };

      const ackTimer = setTimeout(() => {
        const entry = this.pendingCommands.get(commandId);
        if (!entry || entry.settled) return;
        entry.settled = true;
        this.pendingCommands.delete(commandId);

        this.repo.updateCommandAuditState(commandId, {
          lifecycle_state: 'timed_out',
          error_code: 'ACK_TIMEOUT',
          details: `No device ACK received on proposed ack topic within ${ackTimeoutMs}ms`
        });

        finishHttp({
          lifecycle_state: 'timed_out',
          observed_state: null
        });
      }, ackTimeoutMs);

      if (ackTimer.unref) ackTimer.unref();

      const fastReturnTimer = setTimeout(() => {
        finishHttp({
          lifecycle_state: 'published',
          observed_state: null
        });
      }, waitForAckMs);

      if (fastReturnTimer.unref) fastReturnTimer.unref();

      this.pendingCommands.set(commandId, {
        commandId,
        command,
        requestedState,
        targetNode,
        telemetryField,
        ackTimer,
        fastReturnTimer,
        finishHttp,
        settled: false
      });
    });
  }

  /**
   * Called when an explicit MQTT command acknowledgement arrives on
   * lecf/access/command/ack or lecf/env/command/ack.
   */
  handleCommandAck(ackPayload) {
    const { command_id: commandId, node_id: nodeId, status, observed_state: observedState, error_code: errorCode, message } = ackPayload;
    const nowIso = new Date().toISOString();

    const lifecycleState =
      status === 'executed' || status === 'acknowledged'
        ? observedState
          ? 'state_confirmed'
          : 'acknowledged'
        : status === 'rejected'
          ? 'rejected'
          : 'failed';

    this.repo.updateCommandAuditState(commandId, {
      lifecycle_state: lifecycleState,
      acknowledged_at: nowIso,
      confirmed_at: lifecycleState === 'state_confirmed' ? nowIso : null,
      error_code: errorCode || null,
      details: message || `Device ${nodeId} reported status=${status}`
    });

    const pending = this.pendingCommands.get(commandId);
    if (pending && !pending.settled) {
      pending.settled = true;
      clearTimeout(pending.ackTimer);
      clearTimeout(pending.fastReturnTimer);
      this.pendingCommands.delete(commandId);
      pending.finishHttp({
        lifecycle_state: lifecycleState,
        observed_state: observedState || pending.requestedState
      });
    }

    if (this.wsGateway) {
      this.wsGateway.broadcastTelemetry({
        type: 'command_ack',
        command_id: commandId,
        node_id: nodeId,
        lifecycle_state: lifecycleState,
        observed_state: observedState || null,
        timestamp: nowIso
      });
    }

    logger.info('Processed MQTT command acknowledgement', {
      command_id: commandId,
      node_id: nodeId,
      lifecycle_state: lifecycleState
    });
  }

  /**
   * Correlates incoming telemetry/access state with pending published commands
   * so physical state confirmation is recorded even on firmware without explicit /ack topics.
   */
  handleObservedState(nodeId, stateRecord) {
    const nowIso = new Date().toISOString();
    for (const [commandId, pending] of this.pendingCommands.entries()) {
      if (pending.settled) continue;
      const field = pending.telemetryField;
      if (!field || stateRecord[field] === undefined) continue;

      if (stateRecord[field] === pending.requestedState) {
        pending.settled = true;
        clearTimeout(pending.ackTimer);
        clearTimeout(pending.fastReturnTimer);
        this.pendingCommands.delete(commandId);

        this.repo.updateCommandAuditState(commandId, {
          lifecycle_state: 'state_confirmed',
          confirmed_at: nowIso,
          details: `Physical state (${field}=${pending.requestedState}) confirmed via incoming telemetry from ${nodeId}`
        });

        pending.finishHttp({
          lifecycle_state: 'state_confirmed',
          observed_state: pending.requestedState
        });
      }
    }
  }

  shutdown() {
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.ackTimer);
      clearTimeout(pending.fastReturnTimer);
    }
    this.pendingCommands.clear();
  }
}
