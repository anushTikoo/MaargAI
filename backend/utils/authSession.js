import crypto from 'crypto';

const AUTH_COOKIE_NAME = 'maargai_auth';
const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || 'maargai-dev-auth-secret';
const AUTH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function getSignature(payloadPart) {
  return crypto.createHmac('sha256', AUTH_TOKEN_SECRET).update(payloadPart).digest('base64url');
}

function safeEqual(leftValue, rightValue) {
  const leftBuffer = Buffer.from(leftValue);
  const rightBuffer = Buffer.from(rightValue);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function createAuthToken(user) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    sub: String(user.id),
    email: user.email,
    iat: issuedAt,
    exp: issuedAt + AUTH_TOKEN_TTL_SECONDS,
  };

  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signature = getSignature(payloadPart);

  return `${payloadPart}.${signature}`;
}

export function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const [payloadPart, signature] = token.split('.');

  if (!payloadPart || !signature) {
    return null;
  }

  if (!safeEqual(getSignature(payloadPart), signature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadPart));

    if (!payload.exp || payload.exp * 1000 <= Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function getCookieValue(cookieHeader, cookieName) {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(';').map((entry) => entry.trim());
  const match = cookies.find((entry) => entry.startsWith(`${cookieName}=`));

  if (!match) {
    return null;
  }

  return match.slice(cookieName.length + 1);
}

export function getBearerTokenFromRequest(request) {
  const authorizationHeader = request.headers.authorization || '';

  if (!authorizationHeader.startsWith('Bearer ')) {
    return null;
  }

  return authorizationHeader.slice('Bearer '.length).trim() || null;
}

export function getAuthTokenFromRequest(request) {
  return getBearerTokenFromRequest(request) || getCookieValue(request.headers.cookie, AUTH_COOKIE_NAME);
}

export function serializeAuthCookie(token) {
  const cookieParts = [
    `${AUTH_COOKIE_NAME}=${token}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${AUTH_TOKEN_TTL_SECONDS}`,
    'SameSite=Lax',
  ];

  if (process.env.NODE_ENV === 'production') {
    cookieParts.push('Secure');
  }

  return cookieParts.join('; ');
}

export function serializeClearAuthCookie() {
  const cookieParts = [
    `${AUTH_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'Max-Age=0',
    'SameSite=Lax',
  ];

  if (process.env.NODE_ENV === 'production') {
    cookieParts.push('Secure');
  }

  return cookieParts.join('; ');
}