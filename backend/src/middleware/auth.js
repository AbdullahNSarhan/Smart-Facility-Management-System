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

    // If a valid session cookie is present, it authenticates the request as 'cookie'.
    // Never classify a cookie-authenticated request as 'cookie+bearer' based on an
    // unverified or secondary Authorization header, as that would allow CSRF bypass.
    if (cookieToken) {
      const session = repo.verifySessionToken(cookieToken, config.sessionIdleTtlMs);
      if (session) {
        return {
          ...session,
          rawToken: cookieToken,
          authTransport: 'cookie',
          source: 'cookie'
        };
      }
    }

    if (bearerToken) {
      const session = repo.verifySessionToken(bearerToken, config.sessionIdleTtlMs);
      if (session) {
        return {
          ...session,
          rawToken: bearerToken,
          authTransport: 'bearer',
          source: 'bearer'
        };
      }
    }

    return null;
  }

  function verifyCsrfForRequest(req, session) {
    if (!STATE_CHANGING_METHODS.has(req.method)) {
      return { ok: true };
    }
    const csrfHeader = req.headers['x-csrf-token'];
    const isCookieAuth = session.authTransport === 'cookie' || session.source === 'cookie';

    if (isCookieAuth) {
      if (
        typeof csrfHeader !== 'string' ||
        csrfHeader.length === 0 ||
        !safeCompareTokens(csrfHeader, session.csrfToken)
      ) {
        return {
          ok: false,
          error: 'Invalid or missing CSRF token for cookie-authenticated mutation',
          code: 'CSRF_INVALID'
        };
      }
    } else if (csrfHeader !== undefined) {
      if (typeof csrfHeader !== 'string' || !safeCompareTokens(csrfHeader, session.csrfToken)) {
        return {
          ok: false,
          error: 'Invalid CSRF token',
          code: 'CSRF_INVALID'
        };
      }
    }

    return { ok: true };
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

    const csrfCheck = verifyCsrfForRequest(req, session);
    if (!csrfCheck.ok) {
      return res.status(403).json({
        ok: false,
        error: csrfCheck.error,
        code: csrfCheck.code,
        request_id: req.requestId
      });
    }

    req.session = session;
    req.auth = session;
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
    if (cookieToken) {
      const session = repo.verifySessionToken(cookieToken, config.sessionIdleTtlMs);
      if (session) {
        return {
          ...session,
          rawToken: cookieToken,
          authTransport: 'cookie',
          source: 'cookie'
        };
      }
    }

    if (!config.allowBearerCompat) {
      return null;
    }

    const bearerToken = extractBearerToken(req.headers.authorization);
    if (bearerToken) {
      const session = repo.verifySessionToken(bearerToken, config.sessionIdleTtlMs);
      if (session) {
        return {
          ...session,
          rawToken: bearerToken,
          authTransport: 'bearer',
          source: 'bearer'
        };
      }
    }

    // URL query tokens are restricted to non-production Bearer compatibility mode
    // (or explicit allowWsQueryToken) to prevent session tokens from leaking into production proxy logs.
    if (!config.isProd || config.allowWsQueryToken) {
      try {
        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        const queryToken = parsedUrl.searchParams.get('token');
        if (queryToken) {
          const session = repo.verifySessionToken(queryToken, config.sessionIdleTtlMs);
          if (session) {
            return {
              ...session,
              rawToken: queryToken,
              authTransport: 'query',
              source: 'query'
            };
          }
        }
      } catch {
        // ignore malformed URL
      }
    }

    return null;
  }

  return {
    resolveRequestSession,
    verifyCsrfForRequest,
    requireAuth,
    requireAdmin,
    authenticateWsUpgrade
  };
}
