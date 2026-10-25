import { afterEach, describe, expect, it } from 'bun:test';
import { getJwtSecret, hashPassword, signToken, verifyPassword, verifyToken } from './security';

const originalSecret = Bun.env.JWT_SECRET;
const originalEnv = Bun.env.NODE_ENV;

afterEach(() => {
  if (originalSecret === undefined) delete Bun.env.JWT_SECRET;
  else Bun.env.JWT_SECRET = originalSecret;
  if (originalEnv === undefined) delete Bun.env.NODE_ENV;
  else Bun.env.NODE_ENV = originalEnv;
});

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', () => {
    const stored = hashPassword('rahasia123');
    expect(stored).not.toContain('rahasia123');
    expect(verifyPassword('rahasia123', stored)).toBe(true);
    expect(verifyPassword('salah', stored)).toBe(false);
  });

  it('uses a different salt for every hash and rejects malformed hashes', () => {
    expect(hashPassword('a')).not.toBe(hashPassword('a'));
    expect(verifyPassword('a', 'bukan-hash')).toBe(false);
  });
});

describe('tokens', () => {
  it('round-trips a user id', () => {
    const payload = verifyToken(signToken(42));
    expect(payload?.sub).toBe(42);
  });

  it('rejects expired, tampered and malformed tokens', () => {
    const now = Date.now();
    const token = signToken(1, now);
    expect(verifyToken(token, now + 8 * 24 * 3600 * 1000)).toBeNull();

    const [header, payload, signature] = token.split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ sub: 2, exp: 9999999999 })).toString('base64url');
    expect(verifyToken(`${header}.${forged}.${signature}`)).toBeNull();
    expect(verifyToken(`${header}.${payload}.pendek`)).toBeNull();
    expect(verifyToken('a.b')).toBeNull();
  });

  it('rejects correctly signed payloads with the wrong shape', () => {
    const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
    for (const body of ['{"sub":"x","exp":1}', 'bukan json']) {
      const payload = Buffer.from(body).toString('base64url');
      const signature = require('node:crypto')
        .createHmac('sha256', getJwtSecret())
        .update(`${header}.${payload}`)
        .digest('base64url');
      expect(verifyToken(`${header}.${payload}.${signature}`)).toBeNull();
    }
  });

  it('uses JWT_SECRET and demands it in production', () => {
    Bun.env.JWT_SECRET = 'rahasia-test';
    expect(getJwtSecret()).toBe('rahasia-test');
    delete Bun.env.JWT_SECRET;
    expect(getJwtSecret()).toContain('dev-only');
    Bun.env.NODE_ENV = 'production';
    expect(() => getJwtSecret()).toThrow('JWT_SECRET');
  });
});
