import type { Database } from 'bun:sqlite';

export type PublicUser = { id: number; username: string; name: string };
type UserRow = PublicUser & { password_hash: string };

export class DuplicateUsernameError extends Error {
  constructor() {
    super('Username sudah dipakai');
  }
}

export function createUserRepository(db: Database) {
  return {
    create(username: string, name: string, passwordHash: string): PublicUser {
      try {
        return db
          .query<PublicUser, [string, string, string]>(
            'INSERT INTO users (username, name, password_hash) VALUES (?, ?, ?) RETURNING id, username, name'
          )
          .get(username, name, passwordHash)!;
      } catch (error) {
        if (error instanceof Error && /UNIQUE/i.test(error.message)) throw new DuplicateUsernameError();
        throw error;
      }
    },
    findByUsername(username: string): UserRow | null {
      return (
        db
          .query<UserRow, [string]>(
            'SELECT id, username, name, password_hash FROM users WHERE username = ?'
          )
          .get(username) ?? null
      );
    },
    findById(id: number): UserRow | null {
      return (
        db
          .query<UserRow, [number]>(
            'SELECT id, username, name, password_hash FROM users WHERE id = ?'
          )
          .get(id) ?? null
      );
    },
    updateName(id: number, name: string): PublicUser | null {
      return (
        db
          .query<PublicUser, [string, number]>(
            'UPDATE users SET name = ? WHERE id = ? RETURNING id, username, name'
          )
          .get(name, id) ?? null
      );
    },
    updatePassword(id: number, passwordHash: string): void {
      db.query('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
    }
  };
}

export type UserRepository = ReturnType<typeof createUserRepository>;
