const REDACTED_KEYS = new Set([
  'password',
  'newpassword',
  'confirmpassword',
  'password_hash',
  'pin',
  'pin_verifier',
  'token',
  'token_verifier',
  'csrf_token',
  'authorization',
  'cookie',
  'set-cookie',
  'mqttpassword',
  'bootstrapadminpassword',
  'face_image',
  'biometric_embedding'
]);

export function redactSensitive(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, depth + 1));
  }
  const copy = {};
  for (const [k, v] of Object.entries(value)) {
    const lower = k.toLowerCase();
    if (REDACTED_KEYS.has(lower) || lower.includes('password') || lower.includes('secret') || lower.includes('token')) {
      copy[k] = '[REDACTED]';
    } else if (lower === 'rfid' && typeof v === 'string' && v.length > 5) {
      copy[k] = `${v.slice(0, 5)}:**:**`;
    } else {
      copy[k] = redactSensitive(v, depth + 1);
    }
  }
  return copy;
}

export const logger = {
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),

  write(level, msg, meta = {}) {
    if (this.level === 'silent') return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: 'lci-sfm-backend',
      msg,
      ...redactSensitive(meta)
    };
    const line = JSON.stringify(entry);
    if (level === 'error') {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  },

  info(msg, meta) {
    this.write('info', msg, meta);
  },

  warn(msg, meta) {
    this.write('warn', msg, meta);
  },

  error(msg, meta) {
    this.write('error', msg, meta);
  }
};
