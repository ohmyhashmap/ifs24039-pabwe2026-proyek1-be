import { beforeEach, describe, expect, it } from 'bun:test';
import { openDatabase } from '../db/database';
import { AuthError, createAuthService, type AuthService } from './authService';
import { verifyToken } from './security';
import { createUserRepository } from './userRepository';

let service: AuthService;
const valid = { name: 'Budi', username: 'budi', password: 'rahasia123' };

const failure = (fn: () => unknown): AuthError => {
  try {
    fn();
  } catch (error) {
    return error as AuthError;
  }
  throw new Error('expected failure');
};

beforeEach(() => {
  service = createAuthService(createUserRepository(openDatabase(':memory:')));
});

describe('register', () => {
  it('creates a user and returns a token without the password hash', () => {
    const result = service.register(valid);
    expect(result.user).toEqual({ id: 1, username: 'budi', name: 'Budi' });
    expect(verifyToken(result.token)?.sub).toBe(1);
    expect(JSON.stringify(result)).not.toContain('hash');
  });

  it('rejects duplicate usernames case-insensitively with 409', () => {
    service.register(valid);
    const error = failure(() => service.register({ ...valid, username: 'BUDI' }));
    expect(error.status).toBe(409);
    expect(error.message).toBe('Username sudah dipakai');
  });

  it.each([
    [{ ...valid, username: 'a b' }, 'Username'],
    [{ ...valid, password: '123' }, 'Password minimal 6'],
    [{ ...valid, name: '  ' }, 'Nama wajib'],
    [null, 'Data tidak valid']
  ])('rejects invalid input %#', (input, message) => {
    const error = failure(() => service.register(input));
    expect(error.status).toBe(400);
    expect(error.message).toContain(message === 'Data tidak valid' ? '' : message);
  });
});

describe('login', () => {
  it('accepts correct credentials', () => {
    service.register(valid);
    const result = service.login({ username: 'budi', password: 'rahasia123' });
    expect(result.user.username).toBe('budi');
    expect(verifyToken(result.token)?.sub).toBe(1);
  });

  it('gives the same 401 for unknown users and wrong passwords', () => {
    service.register(valid);
    for (const input of [
      { username: 'nope', password: 'rahasia123' },
      { username: 'budi', password: 'salah-salah' }
    ]) {
      const error = failure(() => service.login(input));
      expect(error.status).toBe(401);
      expect(error.message).toBe('Username atau password salah');
    }
    expect(failure(() => service.login({})).status).toBe(400);
  });
});

describe('profile and password', () => {
  it('returns and updates the profile', () => {
    const { user } = service.register(valid);
    expect(service.me(user.id).name).toBe('Budi');
    expect(service.updateProfile(user.id, { name: ' Budi Baru ' }).name).toBe('Budi Baru');
    expect(failure(() => service.updateProfile(user.id, { name: '' })).status).toBe(400);
  });

  it('treats a missing user as an expired session', () => {
    expect(failure(() => service.me(99)).status).toBe(401);
    expect(failure(() => service.updateProfile(99, { name: 'X' })).status).toBe(401);
    expect(failure(() => service.changePassword(99, { currentPassword: 'a', newPassword: 'abcdef' })).status).toBe(401);
  });

  it('changes the password only with the correct current password', () => {
    const { user } = service.register(valid);
    const wrong = failure(() =>
      service.changePassword(user.id, { currentPassword: 'salah', newPassword: 'barubaru' })
    );
    expect(wrong.status).toBe(400);
    expect(wrong.message).toBe('Password saat ini salah');
    expect(failure(() => service.changePassword(user.id, { currentPassword: 'rahasia123', newPassword: '1' })).status).toBe(400);

    service.changePassword(user.id, { currentPassword: 'rahasia123', newPassword: 'barubaru' });
    expect(failure(() => service.login({ username: 'budi', password: 'rahasia123' })).status).toBe(401);
    expect(service.login({ username: 'budi', password: 'barubaru' }).user.id).toBe(user.id);
  });
});
