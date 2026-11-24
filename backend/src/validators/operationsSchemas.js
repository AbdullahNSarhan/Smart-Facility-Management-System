import { z } from 'zod';
import { isPrivateNodeIp } from './managementSchemas.js';

const id = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/, 'Use lowercase letters, numbers, underscore or hyphen');
const roomCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{1,31}$/, 'Room code must be 2-32 uppercase letters, digits, hyphens, or underscores');
const label = z.string().trim().min(1).max(80).regex(/^[^\x00-\x1f\x7f]+$/);
const shortText = z.string().trim().max(240).regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/);
const optionalShort = z.string().trim().max(80).regex(/^[^\x00-\x1f\x7f]*$/).default('');

export const CAPABILITY_DATA_TYPES = Object.freeze({
  SENSOR: ['NUMBER', 'BOOLEAN'],
  SWITCH: ['ENUM', 'BOOLEAN'],
  ACCESS: ['ENUM'],
  CAMERA: ['MEDIA', 'BOOLEAN']
});

export function defaultDataTypeForKind(kind) {
  switch (kind) {
    case 'SWITCH':
      return 'ENUM';
    case 'ACCESS':
      return 'ENUM';
    case 'CAMERA':
      return 'MEDIA';
    default:
      return 'NUMBER';
  }
}

export const endpointSchema = z
  .object({
    endpoint_key: id,
    label,
    description: shortText.default(''),
    kind: z.enum(['SENSOR', 'SWITCH', 'CAMERA', 'ACCESS']),
    data_type: z.enum(['NUMBER', 'BOOLEAN', 'ENUM', 'MEDIA', 'STRING']).optional(),
    unit: z.string().trim().max(24).default(''),
    readable: z.boolean().default(true),
    writable: z.boolean().default(false),
    retention_enabled: z.boolean().default(true),
    min_value: z.number().finite().nullable().optional(),
    max_value: z.number().finite().nullable().optional(),
    allowed_values: z.array(z.string().trim().min(1).max(32)).max(16).nullable().optional(),
    display_config: z
      .object({
        widget: z.enum(['AUTO', 'METRIC_TREND', 'BOOLEAN_STATE', 'SWITCH_CONTROL', 'ACCESS_STATE', 'CAMERA_SNAPSHOT']).optional(),
        precision: z.number().int().min(0).max(4).optional()
      })
      .strict()
      .optional(),
    command_profile: z.string().trim().max(48).nullable().optional()
  })
  .strict()
  .transform((e) => ({
    ...e,
    data_type: e.data_type || defaultDataTypeForKind(e.kind),
    command_profile:
      e.command_profile !== undefined
        ? e.command_profile
        : e.kind === 'SWITCH' && e.writable
          ? 'MQTT_SWITCH_V1'
          : null
  }))
  .superRefine((e, ctx) => {
    if (e.writable && e.kind !== 'SWITCH') {
      ctx.addIssue({ code: 'custom', message: 'Only switch endpoints support generic remote control' });
    }
    const allowedTypes = CAPABILITY_DATA_TYPES[e.kind] || [];
    if (!allowedTypes.includes(e.data_type)) {
      ctx.addIssue({
        code: 'custom',
        message: `Data type ${e.data_type} is not compatible with ${e.kind} capability (allowed: ${allowedTypes.join(', ')})`
      });
    }
    if (
      typeof e.min_value === 'number' &&
      typeof e.max_value === 'number' &&
      e.min_value >= e.max_value
    ) {
      ctx.addIssue({ code: 'custom', message: 'Endpoint min_value must be below max_value' });
    }
  });

export const facilityUpdateSchema = z
  .object({
    name: label,
    description: shortText.default(''),
    location: shortText.default(''),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_/+.-]+$/, 'Invalid timezone identifier')
      .default('UTC'),
    version: z.number().int().positive()
  })
  .strict();

export const roomCreateSchema = z
  .object({
    room_code: roomCode,
    name: label,
    description: shortText.default(''),
    building: optionalShort,
    floor: optionalShort
  })
  .strict();

export const roomUpdateSchema = z
  .object({
    room_code: roomCode,
    name: label,
    description: shortText.default(''),
    building: optionalShort,
    floor: optionalShort,
    version: z.number().int().positive()
  })
  .strict();

export const deviceMoveSchema = z
  .object({
    room_id: z.string().trim().min(1).max(64),
    version: z.number().int().positive()
  })
  .strict();

export const mqttIdentityStatusSchema = z
  .object({
    mqtt_identity_status: z.enum(['UNPROVISIONED', 'PROVISIONED', 'LEGACY', 'NOT_APPLICABLE']),
    version: z.number().int().positive()
  })
  .strict();

export const nodeSchema = z
  .object({
    device_id: id,
    name: label,
    description: shortText.default(''),
    room_id: z.string().trim().min(1).max(64).optional(),
    location: label.default('room-001'),
    device_type: z.enum(['SENSORS', 'CAMERA', 'ACCESS', 'RELAY', 'MIXED']),
    transport: z.enum(['LEGACY_V1', 'MQTT_V1', 'HTTP_JSON_V1', 'CAMERA_JPEG']),
    ip: z.string().trim().nullable().optional().default(''),
    port: z.number().int().min(1).max(65535).default(80),
    path: z
      .string()
      .max(100)
      .regex(/^\/[a-zA-Z0-9_/-]+(?:\.(?:json|jpg))?$/, 'Use a simple absolute path without query, encoding or traversal')
      .default('/telemetry'),
    stale_after_s: z.number().int().min(5).max(3600).default(90),
    enabled: z.boolean().default(true),
    protocol_version: z.string().trim().min(1).max(24).default('1'),
    mqtt_identity_status: z.enum(['UNPROVISIONED', 'PROVISIONED', 'LEGACY', 'NOT_APPLICABLE']).optional(),
    endpoints: z.array(endpointSchema).min(1).max(24),
    version: z.number().int().positive().optional()
  })
  .strict()
  .superRefine((d, ctx) => {
    const normalizedIp = d.ip ? String(d.ip).trim() : '';
    if (d.transport === 'MQTT_V1') {
      if (normalizedIp && !isPrivateNodeIp(normalizedIp)) {
        ctx.addIssue({ code: 'custom', path: ['ip'], message: 'Use a private LAN unicast IPv4 address or leave empty for MQTT-only nodes' });
      }
    } else if (!isPrivateNodeIp(normalizedIp)) {
      ctx.addIssue({ code: 'custom', path: ['ip'], message: 'Use a private LAN unicast IPv4 address' });
    }
    if (new Set(d.endpoints.map((e) => e.endpoint_key)).size !== d.endpoints.length) {
      ctx.addIssue({ code: 'custom', message: 'Endpoint keys must be unique' });
    }
    if (d.transport !== 'MQTT_V1' && d.endpoints.some((e) => e.writable)) {
      ctx.addIssue({ code: 'custom', message: 'Writable endpoints require MQTT_V1' });
    }
    const kinds = d.endpoints.map((e) => e.kind);
    const types = {
      SENSORS: ['SENSOR'],
      CAMERA: ['CAMERA'],
      ACCESS: ['ACCESS'],
      RELAY: ['SWITCH'],
      MIXED: ['SENSOR', 'SWITCH', 'CAMERA', 'ACCESS']
    };
    if (kinds.some((k) => !types[d.device_type].includes(k))) {
      ctx.addIssue({ code: 'custom', message: 'Endpoint kind does not match the device type' });
    }
    if (d.transport === 'CAMERA_JPEG' && kinds.some((k) => k !== 'CAMERA')) {
      ctx.addIssue({ code: 'custom', message: 'CAMERA_JPEG accepts camera endpoints only' });
    }
  });

export const frameSchema = z
  .object({
    schema_version: z.literal(1),
    device_id: id,
    boot_id: z.string().min(1).max(64),
    seq: z.number().int().nonnegative(),
    values: z.record(
      id,
      z.union([z.number().finite(), z.boolean(), z.enum(['ON', 'OFF', 'OPEN', 'CLOSED', 'LOCKED', 'UNLOCKED'])])
    )
  })
  .strict();

const manifestEndpointSchema = z
  .object({
    endpoint_key: id,
    label: label.optional(),
    kind: z.enum(['SENSOR', 'SWITCH', 'CAMERA', 'ACCESS']),
    data_type: z.enum(['NUMBER', 'BOOLEAN', 'ENUM', 'MEDIA', 'STRING']).optional(),
    unit: z.string().trim().max(24).optional(),
    writable: z.boolean().optional()
  })
  .strict();

export const heartbeatSchema = z
  .object({
    schema_version: z.literal(1),
    device_id: id,
    firmware_version: z.string().max(64).optional(),
    protocol_version: z.string().max(24).optional(),
    boot_id: z.string().min(1).max(64).optional(),
    uptime_ms: z.number().int().nonnegative().optional(),
    manifest_version: z.string().max(32).optional(),
    capabilities: z.array(z.string().trim().min(1).max(48)).max(24).optional(),
    endpoints: z.array(manifestEndpointSchema).max(24).optional()
  })
  .strict();

export const switchSchema = z
  .object({
    endpoint_key: id,
    value: z.enum(['ON', 'OFF'])
  })
  .strict();

export const ackSchema = z
  .object({
    schema_version: z.literal(1),
    device_id: id,
    command_id: z.string().uuid(),
    status: z.enum(['ACKNOWLEDGED', 'EXECUTED', 'REJECTED']),
    observed_value: z.enum(['ON', 'OFF']).optional()
  })
  .strict();

export const ruleSchema = z
  .object({
    device_id: id,
    endpoint_key: id,
    name: label,
    severity: z.enum(['WARNING', 'CRITICAL']),
    condition_type: z
      .enum(['THRESHOLD_HIGH', 'THRESHOLD_LOW', 'BOOLEAN_TRUE', 'BOOLEAN_FALSE'])
      .default('THRESHOLD_HIGH'),
    threshold: z.number().finite().default(1),
    clear_threshold: z.number().finite().default(0),
    hold_s: z.number().int().min(0).max(3600).default(5),
    clear_hold_s: z.number().int().min(0).max(3600).default(5),
    enabled: z.boolean().default(true),
    version: z.number().int().positive().optional()
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.condition_type === 'THRESHOLD_HIGH' && r.clear_threshold >= r.threshold) {
      ctx.addIssue({ code: 'custom', message: 'Recovery threshold must be below the high limit' });
    }
    if (r.condition_type === 'THRESHOLD_LOW' && r.clear_threshold <= r.threshold) {
      ctx.addIssue({ code: 'custom', message: 'Recovery threshold must be above the low limit' });
    }
  });

export const maintenanceSchema = z
  .object({
    minutes: z.number().int().min(0).max(1440),
    reason: z.string().trim().min(3).max(240)
  })
  .strict();

export const alarmActionSchema = z
  .object({
    comment: z.string().trim().min(3).max(240)
  })
  .strict();

export const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().max(80).default(''),
    severity: z.enum(['', 'INFO', 'WARNING', 'CRITICAL']).default(''),
    category: z.enum(['', 'AUTH', 'ADMIN', 'SYSTEM', 'COMMAND', 'DEVICE', 'ALARM']).default(''),
    device_id: z.string().max(48).default(''),
    room_id: z.string().max(64).default(''),
    unread: z.enum(['', 'true']).default(''),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    state: z.enum(['', 'ACTIVE', 'ACKNOWLEDGED', 'RESOLVED']).default('')
  })
  .strict();
