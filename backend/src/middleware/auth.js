import crypto from 'node:crypto';
import { parseCookies } from './security.js';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function extractBearerToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

export function setSessionCookie(res, rawToken, config) {
  const maxAgeSec = Math.floor(config.sessionAbsoluteTtlMs / 1000);
  const parts = [
    `${config.sessionCookieName}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSec}`
  ];
  if (config.sessionSecureCookie) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res, config) {
  const parts = [
    `${config.sessionCookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0'
  ];
  if (config.sessionSecureCookie) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function safeCompareTokens(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createAuthMiddleware(repo, config) {
  function resolveRequestSession(req) {
    const cookies = req.cookies || parseCookies(req.headers.cookie);
    const cookieToken = cookies[config.sessionCookieName] || null;
    const bearerToken = config.allowBearerCompat
      ? extractBearerToken(req.headers.authorization)
      : null;

    if (cookieToken) {
      const session = repo.verifySessionToken(cookieToken, config.sessionIdleTtlMs);
      if (session) {
        return {
          ...session,
          rawToken: cookieToken,
          authTransport: bearerToken ? 'cookie+bearer' : 'cookie'
        };
      }
    }

    if (bearerToken) {
      const session = repo.verifySessionToken(bearerToken, config.sessionIdleTtlMs);
      if (session) {
        return {
          ...session,
          rawToken: bearerToken,
          authTransport: 'bearer'
        };
      }
    }

    return null;
  }

  function requireAuth(req, res, next) {
    const session = resolveRequestSession(req);
    if (!session) {
      return res.status(401).json({
        ok: false,
        error: 'Authentication required or session expired',
        code: 'UNAUTHORIZED',
        request_id: req.requestId
      });
    }

    // Enforce CSRF check on state-changing requests authenticated solely via cookie
    // or whenever X-CSRF-Token is explicitly supplied
    if (STATE_CHANGING_METHODS.has(req.method)) {
      const csrfHeader = req.headers['x-csrf-token'];
      if (session.authTransport === 'cookie') {
        if (!csrfHeader || !safeCompareTokens(String(csrfHeader), session.csrfToken)) {
          return res.status(403).json({
            ok: false,
            error: 'Invalid or missing CSRF token for cookie-authenticated mutation',
            code: 'CSRF_INVALID',
            request_id: req.requestId
          });
        }
      } else if (csrfHeader && !safeCompareTokens(String(csrfHeader), session.csrfToken)) {
        return res.status(403).json({
          ok: false,
          error: 'Invalid CSRF token',
          code: 'CSRF_INVALID',
          request_id: req.requestId
        });
      }
    }

    req.session = session;
    req.user = session.user;
    next();
  }

  function requireAdmin(req, res, next) {
    requireAuth(req, res, () => {
      if (!req.user || req.user.role !== 'Admin') {
        return res.status(403).json({
          ok: false,
          error: 'Forbidden: Administrator role is required for this operation',
          code: 'FORBIDDEN_ADMIN_REQUIRED',
          request_id: req.requestId
        });
      }
      next();
    });
  }

  function authenticateWsUpgrade(req) {
    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies[config.sessionCookieName] || null;
    const bearerToken = config.allowBearerCompat
      ? extractBearerToken(req.headers.authorization)
      : null;

    // URL query tokens are enabled only for the temporary Bearer compatibility mode.
    // Query strings may be written to proxy/access logs, so cookie-only deployments
    // must not accept a token from the WebSocket URL.
    let queryToken = null;
    if (config.allowBearerCompat) {
      try {
        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        queryToken = parsedUrl.searchParams.get('token');
      } catch {
        queryToken = null;
      }
    }

    const candidates = [cookieToken, bearerToken, queryToken].filter(Boolean);
    for (const token of candidates) {
      const session = repo.verifySessionToken(token, config.sessionIdleTtlMs);
      if (session) {
        return { ...session, rawToken: token };
      }
    }
    return null;
  }

  return {
    resolveRequestSession,
    requireAuth,
    requireAdmin,
    authenticateWsUpgrade
  };
}
