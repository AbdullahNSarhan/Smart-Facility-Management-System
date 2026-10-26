import { z } from 'zod';
import { isIP } from 'node:net';

const label = z.string().trim().min(1).max(80).regex(/^[^\x00-\x1f\x7f]+$/);
export function isPrivateNodeIp(value) {
  if (isIP(value) !== 4) return false;
  const [a, b, , d] = value.split('.').map(Number);
  return (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) && d !== 0 && d !== 255;
}
const node = z.object({ name: label, ip: z.string().refine(isPrivateNodeIp, 'Use a private unicast LAN IPv4 address') }).strict();
export const settingsSchema = z.object({
  revision: z.number().int().positive(),
  facility_name: label,
  room_name: label,
  nodes: z.object({ node1: node, node2: node, node3: node }).strict(),
  display_thresholds: z.object({
    temperature_warning: z.number().min(0).max(80),
    gas_warning_raw: z.number().int().min(1).max(9999),
    gas_critical_raw: z.number().int().min(2).max(10000)
  }).strict()
}).strict().superRefine((d, ctx) => {
  if (new Set(Object.values(d.nodes).map(n => n.ip)).size !== 3) ctx.addIssue({ code: 'custom', message: 'Each node must have a unique IP address' });
  if (d.display_thresholds.gas_warning_raw >= d.display_thresholds.gas_critical_raw) ctx.addIssue({ code: 'custom', message: 'Gas warning must be below critical' });
});
export const personSchema = z.object({ display_name: label, reference: z.string().trim().max(80).default('') }).strict();
export const personUpdateSchema = z.object({
  display_name: label, reference: z.string().trim().max(80),
  status: z.enum(['ACTIVE','SUSPENDED']), version: z.number().int().positive()
}).strict();
export const cardUid = z.string().trim().toUpperCase().regex(/^(?:[0-9A-F]{2}:){3}[0-9A-F]{2}$|^(?:[0-9A-F]{2}:){6}[0-9A-F]{2}$|^(?:[0-9A-F]{2}:){9}[0-9A-F]{2}$/, 'RFID UID must contain 4, 7 or 10 colon-separated hex bytes');
export const credentialSchema = z.discriminatedUnion('modality', [
  z.object({ modality: z.literal('RFID'), card_uid: cardUid }).strict(),
  z.object({ modality: z.literal('PIN'), pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly six digits') }).strict()
]);
export const credentialStateSchema = z.object({ status: z.enum(['BLOCKED','REVOKED']) }).strict();
export const operatorSchema = z.object({
  username: z.string().trim().regex(/^[A-Za-z0-9 ._,'-]{2,64}$/),
  password: z.string().min(12).max(128), role: z.enum(['Admin','Viewer'])
}).strict();
export const enrollmentEventSchema = z.object({
  schema_version: z.literal(1), session_id: z.string().uuid(), node_id: z.string().max(64),
  nonce: z.string().min(32).max(128), event: z.enum(['READY','CARD','FAILED']),
  card_uid: cardUid.optional()
}).strict();
