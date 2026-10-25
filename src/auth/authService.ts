import { z } from 'zod';
import { hashPassword, signToken, verifyPassword } from './security';
import { DuplicateUsernameError, type PublicUser, type UserRepository } from './userRepository';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 404 | 409
  ) {
    super(message);
  }
}

const name = z.string().trim().min(1, 'Nama wajib diisi').max(100, 'Nama maksimal 100 karakter');
const password = z.string().min(6, 'Password minimal 6 karakter').max(100, 'Password maksimal 100 karakter');

export const RegisterSchema = z.object({
  name,
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_.-]{3,30}$/, 'Username 3-30 karakter: huruf, angka, titik, strip, underscore'),
  password
});
export const LoginSchema = z.object({
  username: z.string().trim().min(1, 'Username wajib diisi'),
  password: z.string().min(1, 'Password wajib diisi')
});
export const ProfileSchema = z.object({ name });
export const PasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Password saat ini wajib diisi'),
  newPassword: password
});

/** Pesan error pertama dari hasil validasi zod. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Data tidak valid';
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AuthError(firstIssue(result.error), 400);
  return result.data;
}

const toPublic = ({ id, username, name }: PublicUser): PublicUser => ({ id, username, name });

export function createAuthService(users: UserRepository) {
  return {
    register(input: unknown) {
      const data = parse(RegisterSchema, input);
      try {
        const user = users.create(data.username, data.name, hashPassword(data.password));
        return { token: signToken(user.id), user };
      } catch (error) {
        if (error instanceof DuplicateUsernameError) throw new AuthError(error.message, 409);
        throw error;
      }
    },
    login(input: unknown) {
      const data = parse(LoginSchema, input);
      const row = users.findByUsername(data.username);
      if (!row || !verifyPassword(data.password, row.password_hash)) {
        throw new AuthError('Username atau password salah', 401);
      }
      return { token: signToken(row.id), user: toPublic(row) };
    },
    me(userId: number): PublicUser {
      const row = users.findById(userId);
      if (!row) throw new AuthError('Pengguna tidak ditemukan', 401);
      return toPublic(row);
    },
    updateProfile(userId: number, input: unknown): PublicUser {
      const data = parse(ProfileSchema, input);
      const user = users.updateName(userId, data.name);
      if (!user) throw new AuthError('Pengguna tidak ditemukan', 401);
      return user;
    },
    changePassword(userId: number, input: unknown): void {
      const data = parse(PasswordSchema, input);
      const row = users.findById(userId);
      if (!row) throw new AuthError('Pengguna tidak ditemukan', 401);
      if (!verifyPassword(data.currentPassword, row.password_hash)) {
        throw new AuthError('Password saat ini salah', 400);
      }
      users.updatePassword(userId, hashPassword(data.newPassword));
    }
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
