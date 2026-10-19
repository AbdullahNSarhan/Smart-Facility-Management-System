import {
  AccessLogRecord,
  EnvironmentalTelemetryRecord,
  CameraEventRecord,
  SystemErrorRecord,
  ProvisionedUser,
  ActivityFeedItem,
} from '../types/lci';

export const INITIAL_ACCESS_LOGS: AccessLogRecord[] = [
  {
    id: 1048,
    timestamp: '2026-10-19 05:08:12',
    user_name: 'Eng. A. Sarhan',
    card_uid: '04:A2:9F:3B',
    factors_used: 'FACE + RFID_CARD',
    mfa_status: 'UNLOCKED',
    door_state: 'CLOSED',
    node_ip: '192.168.10.11',
  },
  {
    id: 1047,
    timestamp: '2026-10-19 04:52:40',
    user_name: 'Dr. H. El-Masry',
    card_uid: '04:7C:1E:88',
    factors_used: 'RFID_CARD + PIN',
    mfa_status: 'UNLOCKED',
    door_state: 'CLOSED',
    node_ip: '192.168.10.11',
  },
  {
    id: 1046,
    timestamp: '2026-10-19 04:31:09',
    user_name: 'Unknown Subject',
    card_uid: '09:FF:00:12',
    factors_used: 'RFID_CARD ONLY (STAGE 2 TIMEOUT)',
    mfa_status: 'DENIED_TIMEOUT',
    door_state: 'CLOSED',
    node_ip: '192.168.10.11',
  },
  {
    id: 1045,
    timestamp: '2026-10-19 03:58:21',
    user_name: 'Tech. M. Hassan',
    card_uid: '04:B5:44:90',
    factors_used: 'FACE + PIN',
    mfa_status: 'UNLOCKED',
    door_state: 'CLOSED',
    node_ip: '192.168.10.11',
  },
  {
    id: 1044,
    timestamp: '2026-10-19 03:15:04',
    user_name: 'Ops Supervisor K. Nabil',
    card_uid: '04:D1:63:2A',
    factors_used: 'FACE + RFID_CARD',
    mfa_status: 'UNLOCKED',
    door_state: 'CLOSED',
    node_ip: '192.168.10.11',
  },
  {
    id: 1043,
    timestamp: '2026-10-19 02:44:50',
    user_name: 'Control Room Console',
    card_uid: 'SERVER_POST',
    factors_used: 'HTTP_OVERRIDE',
    mfa_status: 'EMERGENCY_OVERRIDE',
    door_state: 'OPEN',
    node_ip: '192.168.10.2',
  },
  {
    id: 1042,
    timestamp: '2026-10-19 02:10:18',
    user_name: 'Eng. A. Sarhan',
    card_uid: '04:A2:9F:3B',
    factors_used: 'FACE + RFID_CARD',
    mfa_status: 'UNLOCKED',
    door_state: 'CLOSED',
    node_ip: '192.168.10.11',
  },
];

export const INITIAL_ENVIRONMENTAL_TELEMETRY: EnvironmentalTelemetryRecord[] = [
  {
    id: 5012,
    timestamp: '2026-10-19 05:08:50',
    temperature: 22.4,
    humidity: 46.2,
    smoke_gas_level: 118,
    light_state: 'ON',
    fan_relay: 'ON',
    door_state: 'CLOSED',
    node_ip: '192.168.10.12',
  },
  {
    id: 5011,
    timestamp: '2026-10-19 05:05:00',
    temperature: 22.6,
    humidity: 46.8,
    smoke_gas_level: 121,
    light_state: 'ON',
    fan_relay: 'ON',
    door_state: 'CLOSED',
    node_ip: '192.168.10.12',
  },
  {
    id: 5010,
    timestamp: '2026-10-19 05:00:00',
    temperature: 22.9,
    humidity: 47.1,
    smoke_gas_level: 125,
    light_state: 'ON',
    fan_relay: 'ON',
    door_state: 'CLOSED',
    node_ip: '192.168.10.12',
  },
  {
    id: 5009,
    timestamp: '2026-10-19 04:55:00',
    temperature: 23.1,
    humidity: 47.5,
    smoke_gas_level: 119,
    light_state: 'OFF',
    fan_relay: 'ON',
    door_state: 'CLOSED',
    node_ip: '192.168.10.12',
  },
  {
    id: 5008,
    timestamp: '2026-10-19 04:50:00',
    temperature: 22.8,
    humidity: 46.9,
    smoke_gas_level: 114,
    light_state: 'OFF',
    fan_relay: 'OFF',
    door_state: 'CLOSED',
    node_ip: '192.168.10.12',
  },
  {
    id: 5007,
    timestamp: '2026-10-19 04:45:00',
    temperature: 22.3,
    humidity: 45.8,
    smoke_gas_level: 112,
    light_state: 'ON',
    fan_relay: 'OFF',
    door_state: 'CLOSED',
    node_ip: '192.168.10.12',
  },
  {
    id: 5006,
    timestamp: '2026-10-19 04:40:00',
    temperature: 22.1,
    humidity: 45.4,
    smoke_gas_level: 115,
    light_state: 'ON',
    fan_relay: 'OFF',
    door_state: 'CLOSED',
    node_ip: '192.168.10.12',
  },
];

export const INITIAL_CAMERA_EVENTS: CameraEventRecord[] = [
  {
    id: 309,
    timestamp: '2026-10-19 05:08:10',
    event_type: 'FACE_MATCH',
    subject_name: 'Eng. A. Sarhan',
    confidence: 99.4,
    frame_ref: '/captures/cam03_20261019_050810.jpg',
    node_ip: '192.168.10.13',
  },
  {
    id: 308,
    timestamp: '2026-10-19 04:52:36',
    event_type: 'MOTION_DETECTED',
    subject_name: 'Corridor Sector B',
    confidence: 94.1,
    frame_ref: '/captures/cam03_20261019_045236.jpg',
    node_ip: '192.168.10.13',
  },
  {
    id: 307,
    timestamp: '2026-10-19 04:30:59',
    event_type: 'UNKNOWN_FACE',
    subject_name: 'Unregistered Vector',
    confidence: 41.8,
    frame_ref: '/captures/cam03_20261019_043059.jpg',
    node_ip: '192.168.10.13',
  },
  {
    id: 306,
    timestamp: '2026-10-19 03:58:18',
    event_type: 'FACE_MATCH',
    subject_name: 'Tech. M. Hassan',
    confidence: 98.7,
    frame_ref: '/captures/cam03_20261019_035818.jpg',
    node_ip: '192.168.10.13',
  },
  {
    id: 305,
    timestamp: '2026-10-19 03:15:01',
    event_type: 'FACE_MATCH',
    subject_name: 'Ops Supervisor K. Nabil',
    confidence: 99.1,
    frame_ref: '/captures/cam03_20261019_031501.jpg',
    node_ip: '192.168.10.13',
  },
];

export const INITIAL_SYSTEM_ERRORS: SystemErrorRecord[] = [
  {
    id: 84,
    timestamp: '2026-10-19 04:31:09',
    error_code: 'ERR_MFA_STAGE2_TIMEOUT',
    subsystem: 'NODE_1_ACCESS',
    severity: 'WARNING',
    message: '10-second Stage 2 verification window expired after RFID scan (UID 09:FF:00:12). Solenoid remained locked.',
    resolved: true,
  },
  {
    id: 83,
    timestamp: '2026-10-19 03:42:15',
    error_code: 'WARN_MQ2_CALIBRATION_DRIFT',
    subsystem: 'NODE_2_ENV',
    severity: 'INFO',
    message: 'MQ-2 gas sensor baseline variance +3.2 PPM compensated via Node-RED Kalman filter.',
    resolved: true,
  },
  {
    id: 82,
    timestamp: '2026-10-19 01:19:04',
    error_code: 'ERR_CAM_FRAME_DROP',
    subsystem: 'NODE_3_BIO',
    severity: 'WARNING',
    message: 'ESP32-CAM / RTSP buffer dropped 2 frames during high-lux corridor lighting transition.',
    resolved: true,
  },
];

export const INITIAL_PROVISIONED_USERS: ProvisionedUser[] = [
  {
    id: 'USR-001',
    username: 'Eng. A. Sarhan',
    department: 'Lead Infrastructure Systems',
    rfid_uid: '04:A2:9F:3B',
    face_template_id: 'BIO_VEC_8821',
    pin_configured: true,
    created_at: '2026-09-14',
  },
  {
    id: 'USR-002',
    username: 'Dr. H. El-Masry',
    department: 'Facility Executive Control',
    rfid_uid: '04:7C:1E:88',
    face_template_id: 'BIO_VEC_4410',
    pin_configured: true,
    created_at: '2026-09-18',
  },
  {
    id: 'USR-003',
    username: 'Tech. M. Hassan',
    department: 'HVAC & Telemetry Ops',
    rfid_uid: '04:B5:44:90',
    face_template_id: 'BIO_VEC_9012',
    pin_configured: true,
    created_at: '2026-10-02',
  },
  {
    id: 'USR-004',
    username: 'Ops Supervisor K. Nabil',
    department: 'Physical Security & Biometrics',
    rfid_uid: '04:D1:63:2A',
    face_template_id: 'BIO_VEC_3319',
    pin_configured: true,
    created_at: '2026-10-10',
  },
];

export const INITIAL_ACTIVITY_FEED: ActivityFeedItem[] = [
  {
    id: 'ACT-1',
    timestamp: '05:08:12',
    category: 'ACCESS',
    message: '2-of-3 MFA Verified (Face + RFID Card 04:A2:9F:3B) — Solenoid Unlocked for Eng. A. Sarhan',
    status: 'NOMINAL',
  },
  {
    id: 'ACT-2',
    timestamp: '05:08:10',
    category: 'CAMERA',
    message: 'Biometric Node 3 captured JPEG frame — 99.4% Facial Match confirmed',
    status: 'NOMINAL',
  },
  {
    id: 'ACT-3',
    timestamp: '05:05:00',
    category: 'ENVIRONMENT',
    message: 'HVAC Fan Relay maintained ON (Auto Thermal Setpoint 22.0°C)',
    status: 'NOMINAL',
  },
  {
    id: 'ACT-4',
    timestamp: '04:55:00',
    category: 'ENVIRONMENT',
    message: 'LDR Sensor detected low corridor luminance — Aux Light switched ON',
    status: 'NOMINAL',
  },
  {
    id: 'ACT-5',
    timestamp: '04:31:09',
    category: 'ACCESS',
    message: 'Stage 2 MFA Countdown (10s) expired for Card 09:FF:00:12 — Access Denied',
    status: 'WARNING',
  },
];

export function generateInitialHistoryWindow(points = 30) {
  const now = Date.now();
  const labels: string[] = [];
  const temps: number[] = [];
  const hums: number[] = [];
  const gases: number[] = [];

  for (let i = points - 1; i >= 0; i--) {
    const t = new Date(now - i * 4000);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    labels.push(`${hh}:${mm}:${ss}`);
    temps.push(Number((22.2 + Math.sin(i * 0.35) * 0.9).toFixed(1)));
    hums.push(Number((46.0 + Math.cos(i * 0.25) * 1.8).toFixed(1)));
    gases.push(Math.round(118 + Math.sin(i * 0.4) * 12));
  }

  return { labels, temps, hums, gases };
}
