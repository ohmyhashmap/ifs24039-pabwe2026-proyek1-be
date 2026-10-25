import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    lat REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lon REAL NOT NULL CHECK (lon BETWEEN -180 AND 180),
    description TEXT NOT NULL CHECK (length(description) BETWEEN 3 AND 500),
    severity TEXT NOT NULL DEFAULT 'sedang' CHECK (severity IN ('rendah', 'sedang', 'tinggi')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS reports_created_at_idx ON reports (created_at DESC);
  CREATE INDEX IF NOT EXISTS reports_user_idx ON reports (user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS hotspots (
    id TEXT PRIMARY KEY,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    confidence REAL NOT NULL,
    detected_at TEXT NOT NULL,
    source TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS hotspots_detected_idx ON hotspots (detected_at);

  CREATE TABLE IF NOT EXISTS air_quality_logs (
    uid INTEGER PRIMARY KEY,
    city_name TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    aqi REAL NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

/** Membuka database SQLite dan memastikan skema tersedia. `:memory:` dipakai untuk test. */
export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

let instance: Database | undefined;

export function getDb(): Database {
  instance ??= openDatabase(Bun.env.SQLITE_PATH || './data/sigapasap.db');
  return instance;
}

export function closeDb() {
  instance?.close();
  instance = undefined;
}
