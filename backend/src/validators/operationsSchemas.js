import { z } from 'zod';
import { isPrivateNodeIp } from './managementSchemas.js';
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/, 'Use lowercase letters, numbers, underscore or hyphen');
const label = z.string().trim().min(1).max(80).regex(/^[^\x00-\x1f\x7f]+$/);
const endpoint = z.object({
  endpoint_key: id, label, kind: z.enum(['SENSOR','SWITCH','CAMERA','ACCESS']),
  unit: z.string().trim().max(24).default(''), writable: z.boolean().default(false)
}).strict().refine(e => !e.writable || e.kind==='SWITCH', 'Only switch endpoints support generic remote control');
export const nodeSchema = z.object({
  device_id: id, name: label, description: z.string().trim().max(240).default(''),
  location: label.default('room-001'), device_type: z.enum(['SENSORS','CAMERA','ACCESS','RELAY','MIXED']),
  transport: z.enum(['LEGACY_V1','MQTT_V1','HTTP_JSON_V1','CAMERA_JPEG']),
  ip: z.string().refine(isPrivateNodeIp,'Use a private LAN unicast IPv4 address'),
  port: z.number().int().min(1).max(65535).default(80),
  path: z.string().max(100).regex(/^\/[a-zA-Z0-9_/-]+(?:\.(?:json|jpg))?$/,'Use a simple absolute path without query, encoding or traversal').default('/telemetry'),
  stale_after_s: z.number().int().min(5).max(3600).default(90), enabled: z.boolean().default(true),
  endpoints: z.array(endpoint).min(1).max(24), version: z.number().int().positive().optional()
}).strict().superRefine((d,ctx) => {
  if(new Set(d.endpoints.map(e=>e.endpoint_key)).size!==d.endpoints.length) ctx.addIssue({code:'custom',message:'Endpoint keys must be unique'});
  if(d.transport!=='MQTT_V1' && d.endpoints.some(e=>e.writable)) ctx.addIssue({code:'custom',message:'Writable endpoints require MQTT_V1'});
  const kinds=d.endpoints.map(e=>e.kind), types={SENSORS:['SENSOR'],CAMERA:['CAMERA'],ACCESS:['ACCESS'],RELAY:['SWITCH'],MIXED:['SENSOR','SWITCH','CAMERA','ACCESS']};
  if(kinds.some(k=>!types[d.device_type].includes(k)))ctx.addIssue({code:'custom',message:'Endpoint kind does not match the device type'});
  if(d.transport==='CAMERA_JPEG' && kinds.some(k=>k!=='CAMERA'))ctx.addIssue({code:'custom',message:'CAMERA_JPEG accepts camera endpoints only'});
});
export const frameSchema = z.object({
  schema_version:z.literal(1), device_id:id, boot_id:z.string().min(1).max(64), seq:z.number().int().nonnegative(),
  values:z.record(id,z.union([z.number().finite(),z.boolean(),z.enum(['ON','OFF','OPEN','CLOSED','LOCKED','UNLOCKED'])]))
}).strict();
export const heartbeatSchema = z.object({schema_version:z.literal(1),device_id:id,firmware_version:z.string().max(64).optional()}).strict();
export const switchSchema=z.object({endpoint_key:id,value:z.enum(['ON','OFF'])}).strict();
export const ackSchema=z.object({schema_version:z.literal(1),device_id:id,command_id:z.string().uuid(),status:z.enum(['ACKNOWLEDGED','EXECUTED','REJECTED']),observed_value:z.enum(['ON','OFF']).optional()}).strict();
export const ruleSchema=z.object({
  device_id:id,endpoint_key:id,name:label,severity:z.enum(['WARNING','CRITICAL']),
  threshold:z.number().finite(),clear_threshold:z.number().finite(),
  hold_s:z.number().int().min(0).max(3600).default(5),clear_hold_s:z.number().int().min(0).max(3600).default(5),
  enabled:z.boolean().default(true),version:z.number().int().positive().optional()
}).strict().refine(r=>r.clear_threshold<r.threshold,'Recovery threshold must be below the high limit');
export const maintenanceSchema=z.object({minutes:z.number().int().min(0).max(1440),reason:z.string().trim().min(3).max(240)}).strict();
export const alarmActionSchema=z.object({comment:z.string().trim().min(3).max(240)}).strict();
export const listSchema=z.object({
  page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25),
  search:z.string().max(80).default(''),severity:z.enum(['','INFO','WARNING','CRITICAL']).default(''),
  category:z.enum(['','AUTH','ADMIN','SYSTEM','COMMAND','DEVICE','ALARM']).default(''),
  device_id:z.string().max(48).default(''),unread:z.enum(['','true']).default(''),
  from:z.string().datetime().optional(),to:z.string().datetime().optional(),state:z.enum(['','ACTIVE','ACKNOWLEDGED','RESOLVED']).default('')
}).strict();
