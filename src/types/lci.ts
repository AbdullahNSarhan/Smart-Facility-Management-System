export type LightState = 'ON' | 'OFF';
export type DoorState = 'OPEN' | 'CLOSED';
export type FanRelayState = 'ON' | 'OFF';
export type MfaStatus = 'IDLE' | 'AWAITING_STAGE2' | 'UNLOCKED';
export type ControlMode = 'AUTO' | 'MANUAL';

export interface EnvironmentTelemetryPayload {
  temperature: number;
  humidity: number;
  smoke_gas_level: number;
  light_state: LightState;
  door_state: DoorState;
  fan_relay: FanRelayState;
  timestamp?: string;
}

export interface MfaTrackerPayload {
  isFacePassed: boolean;
  isCardPassed: boolean;
  isPinPassed: boolean;
  mfa_status: MfaStatus;
  user?: string;
  card_uid?: string;
  timestamp?: string;
}

export interface AccessLogRecord {
  id: number;
  timestamp: string;
  user_name: string;
  card_uid: string;
  factors_used: string;
  mfa_status: MfaStatus | 'DENIED_TIMEOUT' | 'EMERGENCY_OVERRIDE';
  door_state: DoorState;
  node_ip: string;
}

export interface EnvironmentalTelemetryRecord {
  id: number;
  timestamp: string;
  temperature: number;
  humidity: number;
  smoke_gas_level: number;
  light_state: LightState;
  fan_relay: FanRelayState;
  door_state: DoorState;
  node_ip: string;
}

export interface CameraEventRecord {
  id: number;
  timestamp: string;
  event_type: 'FACE_MATCH' | 'MOTION_DETECTED' | 'UNKNOWN_FACE' | 'MANUAL_SNAPSHOT';
  subject_name: string;
  confidence: number;
  frame_ref: string;
  node_ip: string;
}

export interface SystemErrorRecord {
  id: number;
  timestamp: string;
  error_code: string;
  subsystem: 'NODE_1_ACCESS' | 'NODE_2_ENV' | 'NODE_3_BIO' | 'CENTRAL_SERVER';
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  message: string;
  resolved: boolean;
}

export interface ProvisionedUser {
  id: string;
  username: string;
  department: string;
  rfid_uid: string;
  face_template_id: string;
  pin_configured: boolean;
  created_at: string;
}

export interface ActivityFeedItem {
  id: string;
  timestamp: string;
  category: 'ACCESS' | 'ENVIRONMENT' | 'CAMERA' | 'SYSTEM';
  message: string;
  status: 'NOMINAL' | 'WARNING' | 'ALERT';
}

export interface NodeHeartbeatStatus {
  id: 'central' | 'node1' | 'node2' | 'node3';
  name: string;
  role: string;
  ip: string;
  online: boolean;
  latencyMs: number;
  lastPing: string;
  packetLoss: number;
}

declare global {
  interface Window {
    // Strict global variables required by Node-RED backend spec
    temperature: number;
    humidity: number;
    smoke_gas_level: number;
    light_state: LightState;
    door_state: DoorState;
    fan_relay: FanRelayState;
    isFacePassed: boolean;
    isCardPassed: boolean;
    isPinPassed: boolean;
    mfa_status: MfaStatus;
    access_logs: AccessLogRecord[];
    environmental_telemetry: EnvironmentalTelemetryRecord[];
    camera_events: CameraEventRecord[];
    system_errors: SystemErrorRecord[];
    ip_node1: string;
    ip_node2: string;
    ip_node3: string;
  }
}
