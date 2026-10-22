import crypto from 'node:crypto';

const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024
};
const KEY_LEN = 64;

/**
 * Hashes a secret (password or PIN) using Node's memory-hard crypto.scrypt KDF.
 * Format: scrypt$N$r$p$saltHex$derivedKeyHex
 */
export function hashSecret(plainSecret) {
  if (typeof plainSecret !== 'string' || plainSecret.length === 0) {
    throw new Error('Cannot hash empty secret');
  }
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(plainSecret, salt, KEY_LEN, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Verifies a plaintext secret against a stored scrypt hash in constant time.
 */
export function verifySecret(plainSecret, storedHash) {
  if (typeof plainSecret !== 'string' || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'hex');
  const expectedKey = Buffer.from(parts[5], 'hex');
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || salt.length === 0 || expectedKey.length === 0) {
    return false;
  }

  try {
    const derived = crypto.scryptSync(plainSecret, salt, expectedKey.length, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024
    });
    if (derived.length !== expectedKey.length) return false;
    return crypto.timingSafeEqual(derived, expectedKey);
  } catch {
    return false;
  }
}

/**
 * Generates a high-entropy opaque random token (32 bytes = 256 bits, base64url encoded).
 */
export function generateOpaqueToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Computes a SHA-256 hex digest used only for indexing/verifying high-entropy random session tokens.
 * Never used for passwords or low-entropy PINs.
 */
export function hashSessionTokenVerifier(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}
