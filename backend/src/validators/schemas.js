import { z } from 'zod';

const SAFE_USERNAME_REGEX = /^[A-Za-z0-9 ._,'-]{2,64}$/;
const RFID_HEX_REGEX = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){3,7}$/;
const PIN_SIX_DIGIT_REGEX = /^\d{6}$/;

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128)
});

export const commandRequestSchema = z
  .object({
    command: z.enum([
      'EMERGENCY_DOOR_UNLOCK',
      'TOGGLE_HVAC_FAN',
      'TOGGLE_AUX_LIGHT',
      'SET_CONTROL_MODE'
    ]),
    state: z.enum(['OPEN', 'CLOSED', 'ON', 'OFF', 'AUTO', 'MANUAL']),
    ip_node1: z.string().optional(),
    ip_node2: z.string().optional(),
    ip_node3: z.string().optional()
  })
  .superRefine((val, ctx) => {
    const validStatesByCommand = {
      EMERGENCY_DOOR_UNLOCK: ['OPEN', 'CLOSED'],
      TOGGLE_HVAC_FAN: ['ON', 'OFF'],
      TOGGLE_AUX_LIGHT: ['ON', 'OFF'],
      SET_CONTROL_MODE: ['AUTO', 'MANUAL']
    };
    if (!validStatesByCommand[val.command].includes(val.state)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `State "${val.state}" is not valid for command "${val.command}"`
      });
    }
  });

export const provisionUserSchema = z.object({
  username: z.string().trim().regex(SAFE_USERNAME_REGEX, 'Username must be 2-64 valid characters'),
  password: z.string().trim().min(4).max(64),
  role: z.enum(['Admin', 'Viewer']).optional().default('Viewer'),
  rfid: z.string().trim().regex(RFID_HEX_REGEX, 'RFID UID must match hex format XX:XX:XX:XX'),
  pin: z.union([
    z.string().trim().regex(PIN_SIX_DIGIT_REGEX),
    z.number().int().min(0).max(999999)
  ]),
  face_linked: z.boolean().optional().default(false)
});

export const adminProfileSchema = z.object({
  currentUsername: z.string().trim().min(1).max(64).optional(),
  newUsername: z.string().trim().regex(SAFE_USERNAME_REGEX, 'Admin username must be 2-64 valid characters'),
  newPassword: z.string().min(12, 'Password must be at least 12 characters').max(128)
});

export const updateUserRoleSchema = z.object({
  id: z.number().int().positive(),
  role: z.enum(['Admin', 'Viewer'])
});

export const deleteUserSchema = z.object({
  id: z.number().int().positive()
});

export const telemetryAggregateQuerySchema = z.object({
  range: z.enum(['1h', '24h', '7d']).default('24h'),
  bucket: z.enum(['5m', '15m', '1h']).default('15m')
});

// ----------------------------------------------------------------------------
// MQTT PAYLOAD SCHEMAS
// ----------------------------------------------------------------------------

export const mqttEnvTelemetrySchema = z
  .object({
    schema_version: z.number().int().optional(),
    node: z.string().max(64).optional(),
    node_id: z.string().max(64).optional(),
    boot_id: z.string().max(64).optional(),
    seq: z.number().int().nonnegative().optional(),
    uptime_ms: z.number().int().nonnegative().optional(),
    temperature: z.number().min(-40).max(125).optional(),
    temp: z.number().min(-40).max(125).optional(),
    temperature_c: z.number().min(-40).max(125).optional(),
    humidity: z.number().min(0).max(100).optional(),
    humidity_pct: z.number().min(0).max(100).optional(),
    smoke_gas_level: z.number().min(0).max(10000).optional(),
    smoke_gas_ppm: z.number().min(0).max(10000).optional(),
    smoke: z.boolean().optional(),
    light_state: z.enum(['ON', 'OFF']).optional(),
    fan_relay: z.enum(['ON', 'OFF']).optional(),
    door_state: z.enum(['OPEN', 'CLOSED']).optional()
  })
  .superRefine((data, ctx) => {
    const t = data.temperature ?? data.temp ?? data.temperature_c;
    if (typeof t !== 'number' || Number.isNaN(t)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Environmental telemetry must contain a numeric temperature reading (temperature, temp, or temperature_c)'
      });
    }
  });

export const mqttMfaFaceSchema = z.object({
  status: z.enum(['verified', 'rejected', 'failed', 'error']),
  user_id: z.string().max(64).optional(),
  confidence: z.number().min(0).max(1).optional(),
  node_id: z.string().max(64).optional(),
  boot_id: z.string().max(64).optional(),
  seq: z.number().int().nonnegative().optional()
});

export const mqttAccessStateSchema = z.object({
  node_id: z.string().max(64).optional(),
  boot_id: z.string().max(64).optional(),
  seq: z.number().int().nonnegative().optional(),
  door_state: z.enum(['OPEN', 'CLOSED']).optional(),
  isFacePassed: z.boolean().optional(),
  isCardPassed: z.boolean().optional(),
  isPinPassed: z.boolean().optional(),
  mfa_status: z.enum(['IDLE', 'AWAITING_STAGE2', 'UNLOCKED']).optional(),
  username: z.string().max(64).optional(),
  event: z.string().max(128).optional()
});

export const mqttCommandAckSchema = z.object({
  command_id: z.string().min(4).max(128),
  node_id: z.string().max(64),
  status: z.enum(['acknowledged', 'rejected', 'failed', 'executed']),
  observed_state: z.enum(['OPEN', 'CLOSED', 'ON', 'OFF', 'AUTO', 'MANUAL']).optional(),
  error_code: z.string().max(64).optional(),
  message: z.string().max(256).optional()
});

export const mqttHeartbeatSchema = z.object({
  firmware_version: z.string().max(64).optional(),
  capabilities: z.array(z.string().max(64)).max(20).optional(),
  node_id: z.string().min(1).max(64),
  boot_id: z.string().max(64).optional(),
  seq: z.number().int().nonnegative().optional(),
  uptime_ms: z.number().int().nonnegative().optional(),
  status: z.enum(['ONLINE', 'STANDBY', 'SLEEP', 'ERROR']).default('ONLINE')
});
