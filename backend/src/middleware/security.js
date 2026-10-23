import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return cookies;

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const rawVal = pair.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(rawVal);
    } catch {
      cookies[key] = rawVal;
    }
  }
  return cookies;
}

export function requestContextMiddleware(req, res, next) {
  const incomingId = req.headers['x-request-id'];
  const requestId =
    typeof incomingId === 'string' && incomingId.trim().length > 0 && incomingId.length <= 128
      ? incomingId.trim()
      : crypto.randomUUID();

  req.requestId = requestId;
  req.cookies = parseCookies(req.headers.cookie);
  res.setHeader('X-Request-Id', requestId);
  next();
}

export function securityHeadersMiddleware(config) {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }

    const origin = req.headers.origin;
    if (origin && config.allowedOrigins && config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-CSRF-Token, X-Request-Id'
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    next();
  };
}

export function createRateLimiter({
  windowMs = 60 * 1000,
  maxRequests = 15,
  maxEntries = 5000,
  keyPrefix = 'rl',
  message = 'Too many requests, please retry after cooldown window.'
} = {}) {
  const buckets = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const usernamePart =
      req.body && typeof req.body.username === 'string'
        ? `:${req.body.username.trim().toLowerCase().slice(0, 64)}`
        : '';
    const key = `${keyPrefix}:${ip}${usernamePart}`;

    let entry = buckets.get(key);
    if (!entry || now >= entry.resetAt) {
      if (buckets.size >= maxEntries) {
        for (const [k, v] of buckets.entries()) {
          if (now >= v.resetAt) buckets.delete(k);
        }
        while (buckets.size >= maxEntries) {
          const oldestKey = buckets.keys().next().value;
          if (oldestKey === undefined) break;
          buckets.delete(oldestKey);
        }
      }
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }

    entry.count += 1;

    const remaining = Math.max(0, maxRequests - entry.count);
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (entry.count > maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        ok: false,
        error: message,
        code: 'RATE_LIMITED',
        retry_after_seconds: retryAfterSec,
        request_id: req.requestId
      });
    }

    next();
  };
}

export function errorHandlerMiddleware(err, req, res, _next) {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({
      ok: false,
      error: 'Request payload exceeds maximum allowed size',
      code: 'PAYLOAD_TOO_LARGE',
      request_id: req.requestId
    });
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({
      ok: false,
      error: 'Malformed JSON in request body',
      code: 'INVALID_JSON',
      request_id: req.requestId
    });
  }

  logger.error('Unhandled HTTP route error', {
    request_id: req.requestId,
    method: req.method,
    path: req.originalUrl,
    error: err?.message || String(err)
  });

  return res.status(500).json({
    ok: false,
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    request_id: req.requestId
  });
}
