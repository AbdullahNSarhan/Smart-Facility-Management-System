/**
 * Central MQTT Topic Registry for LCI-SFM
 *
 * Explicitly separates:
 * 1. VERIFIED_FIRMWARE topics: confirmed in repository hardware/workflow docs and frontend contracts.
 * 2. PROPOSED_EXTENSION topics: defined in docs/BACKEND_ARCHITECTURE.md for device acknowledgements
 *    and heartbeats; never assumed to be implemented by unverified edge firmware until observed.
 */

export const MQTT_TOPICS = Object.freeze({
  // Verified existing firmware / service topics
  ENV_TELEMETRY: {
    topic: 'lecf/env/telemetry',
    status: 'VERIFIED_FIRMWARE',
    direction: 'subscribe',
    qos: 0,
    description: 'Node 2 (env_02) environmental telemetry frames (temp, humidity, smoke_gas_level, light/fan/door)'
  },
  ACCESS_MFA_FACE: {
    topic: 'lecf/access/mfa_face',
    status: 'VERIFIED_FIRMWARE',
    direction: 'subscribe',
    qos: 1,
    description: 'Python OpenCV vision container biometric verification results'
  },

  // Proposed / target topics from docs/BACKEND_ARCHITECTURE.md
  ACCESS_STATE: {
    topic: 'lecf/access/state',
    status: 'PROPOSED_EXTENSION',
    direction: 'subscribe',
    qos: 1,
    description: 'Node 1 access controller MFA stage state & magnetic door lock state telemetry'
  },
  ACCESS_COMMAND: {
    topic: 'lecf/access/command',
    status: 'PROPOSED_EXTENSION',
    direction: 'publish',
    qos: 1,
    retain: false,
    description: 'Node 1 actuator commands (EMERGENCY_DOOR_UNLOCK)'
  },
  ACCESS_COMMAND_ACK: {
    topic: 'lecf/access/command/ack',
    status: 'PROPOSED_EXTENSION',
    direction: 'subscribe',
    qos: 1,
    description: 'Node 1 command execution acknowledgement'
  },
  ENV_COMMAND: {
    topic: 'lecf/env/command',
    status: 'PROPOSED_EXTENSION',
    direction: 'publish',
    qos: 1,
    retain: false,
    description: 'Node 2 actuator commands (TOGGLE_HVAC_FAN, TOGGLE_AUX_LIGHT, SET_CONTROL_MODE)'
  },
  ENV_COMMAND_ACK: {
    topic: 'lecf/env/command/ack',
    status: 'PROPOSED_EXTENSION',
    direction: 'subscribe',
    qos: 1,
    description: 'Node 2 command execution acknowledgement'
  },
  NODE_HEARTBEAT_WILDCARD: {
    topic: 'lecf/+/heartbeat',
    status: 'PROPOSED_EXTENSION',
    direction: 'subscribe',
    qos: 0,
    description: 'Optional node liveness heartbeats (lecf/node1/heartbeat, lecf/env/heartbeat, lecf/vision/heartbeat)'
  }
});

export function getSubscribedTopics() {
  return Object.values(MQTT_TOPICS).filter((entry) => entry.direction === 'subscribe');
}
