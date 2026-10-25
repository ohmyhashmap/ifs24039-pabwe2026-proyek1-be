import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUserRepository } from '../auth/userRepository';
import { createSqliteReportsRepository } from '../routes/reports';
import { closeDb, getDb, openDatabase } from './database';

const originalPath = Bun.env.SQLITE_PATH;

afterEach(() => {
  closeDb();
  if (originalPath === undefined) delete Bun.env.SQLITE_PATH;
  else Bun.env.SQLITE_PATH = originalPath;
});

describe('database', () => {
  it('creates the schema, including for a file path in a new directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sigapasap-'));
    try {
      const db = openDatabase(join(dir, 'nested', 'test.db'));
      const tables = db
        .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name);
      expect(tables).toEqual(expect.arrayContaining(['users', 'reports', 'hotspots', 'air_quality_logs']));
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('getDb returns a singleton and honours SQLITE_PATH', () => {
    Bun.env.SQLITE_PATH = ':memory:';
    expect(getDb()).toBe(getDb());
    closeDb();
    closeDb();
  });

  it('falls back to the default file path', () => {
    delete Bun.env.SQLITE_PATH;
    const cwd = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), 'sigapasap-'));
    process.chdir(dir);
    try {
      expect(getDb().query('SELECT 1 AS ok').get()).toEqual({ ok: 1 });
      closeDb();
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('user and report repositories', () => {
  it('rethrows non-unique database errors', () => {
    const db = openDatabase(':memory:');
    const users = createUserRepository(db);
    db.close();
    expect(() => users.create('x', 'X', 'h')).toThrow();
  });

  it('stores reports per user and orders them newest first', () => {
    const db = openDatabase(':memory:');
    const users = createUserRepository(db);
    const reports = createSqliteReportsRepository(db);
    const a = users.create('a', 'A', 'h');
    const b = users.create('b', 'B', 'h');

    const input = { lat: 3.5, lon: 98.6, description: 'Asap tebal', severity: 'tinggi' as const };
    reports.create(input, a.id);
    db.query("UPDATE reports SET created_at = '2026-01-01T00:00:00.000Z'").run();
    reports.create({ ...input, description: 'Asap baru' }, a.id);
    reports.create({ ...input, description: 'Laporan tamu' });
    reports.create({ ...input, description: 'Laporan B' }, b.id);

    expect(reports.list(10)).toHaveLength(4);
    const mine = reports.listByUser(a.id, 10);
    expect(mine.map((r) => r.description)).toEqual(['Asap baru', 'Asap tebal']);
    expect(mine[0]).not.toHaveProperty('user_id');
    expect(reports.listByUser(a.id, 1)).toHaveLength(1);
  });

  it('enforces column constraints', () => {
    const reports = createSqliteReportsRepository(openDatabase(':memory:'));
    const bad = { lat: 100, lon: 0, description: 'ok ok', severity: 'sedang' as const };
    expect(() => reports.create(bad)).toThrow();
  });
});
