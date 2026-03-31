const crypto = require('node:crypto');

function parseCookieHeader(headerValue) {
  const header = typeof headerValue === 'string' ? headerValue : '';
  if (!header.trim()) return {};

  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    const rawVal = part.slice(idx + 1).trim();
    const val = rawVal.startsWith('"') && rawVal.endsWith('"') ? rawVal.slice(1, -1) : rawVal;
    out[key] = decodeURIComponent(val);
  }
  return out;
}

function safeEqual(a, b) {
  const aStr = typeof a === 'string' ? a : '';
  const bStr = typeof b === 'string' ? b : '';
  const aBuf = Buffer.from(aStr, 'utf8');
  const bBuf = Buffer.from(bStr, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function extractBearerToken(authorizationHeader) {
  const h = typeof authorizationHeader === 'string' ? authorizationHeader.trim() : '';
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return null;
  const token = (m[1] || '').trim();
  return token || null;
}

function isAuthorized({ cookieHeader, authorizationHeader }, expectedToken) {
  const token = typeof expectedToken === 'string' ? expectedToken : '';
  if (!token) return true; // auth disabled

  const bearer = extractBearerToken(authorizationHeader);
  if (bearer && safeEqual(bearer, token)) return true;

  const cookies = parseCookieHeader(cookieHeader);
  const cookieToken = cookies.cc_web_auth;
  if (cookieToken && safeEqual(cookieToken, token)) return true;

  return false;
}

function isSameOrigin(originHeader, { protocol, host }) {
  const origin = typeof originHeader === 'string' ? originHeader.trim() : '';
  if (!origin) return true; // non-browser clients or same-site GETs
  if (!protocol || !host) return false;

  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  const expected = `${protocol}://${host}`;
  return url.origin === expected;
}

function normalizeNextPath(nextPath) {
  const raw = typeof nextPath === 'string' ? nextPath.trim() : '';
  if (!raw) return null;

  // Only allow relative paths. Reject protocol-relative and absolute URLs.
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  if (raw.startsWith('/\\')) return null;
  if (raw.includes('\u0000')) return null;

  // Avoid header splitting and other weirdness.
  if (raw.includes('\r') || raw.includes('\n')) return null;

  return raw;
}

module.exports = {
  parseCookieHeader,
  safeEqual,
  extractBearerToken,
  isAuthorized,
  isSameOrigin,
  normalizeNextPath,
};
