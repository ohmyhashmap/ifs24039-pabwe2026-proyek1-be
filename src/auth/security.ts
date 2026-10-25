import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

export function getJwtSecret(): string {
  const secret = Bun.env.JWT_SECRET;
  if (secret) return secret;
  if (Bun.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET wajib diset di production');
  }
  return 'dev-only-secret-change-me';
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');
const sign = (data: string) => createHmac('sha256', getJwtSecret()).update(data).digest('base64url');

export type TokenPayload = { sub: number; exp: number };

/** Token HS256 berformat JWT standar (header.payload.signature). */
export function signToken(userId: number, now = Date.now()): string {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64(
    JSON.stringify({ sub: userId, exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS })
  );
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
}

export function verifyToken(token: string, now = Date.now()): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];

  const expected = Buffer.from(sign(`${header}.${payload}`));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as TokenPayload;
    if (typeof data.sub !== 'number' || typeof data.exp !== 'number') return null;
    return data.exp * 1000 > now ? data : null;
  } catch {
    return null;
  }
}
