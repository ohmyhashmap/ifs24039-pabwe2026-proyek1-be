import type { Database } from 'bun:sqlite';
import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth, requireAuth } from '../auth/middleware';
import { getDb } from '../db/database';
import { queryParam } from '../utils/http';

export type ReportRow = {
  id: string;
  lat: number;
  lon: number;
  description: string;
  severity: 'rendah' | 'sedang' | 'tinggi';
  created_at: string;
};

const ReportInputSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  description: z.string().trim().min(3).max(500),
  severity: z.enum(['rendah', 'sedang', 'tinggi']).default('sedang')
});

export type ReportInput = z.infer<typeof ReportInputSchema>;

export interface ReportsRepository {
  list(limit: number): ReportRow[];
  listByUser(userId: number, limit: number): ReportRow[];
  create(input: ReportInput, userId?: number): ReportRow;
}

const COLUMNS = 'id, lat, lon, description, severity, created_at';

export function createSqliteReportsRepository(db: Database): ReportsRepository {
  return {
    list: (limit) =>
      db
        .query<ReportRow, [number]>(`SELECT ${COLUMNS} FROM reports ORDER BY created_at DESC LIMIT ?`)
        .all(limit),
    listByUser: (userId, limit) =>
      db
        .query<ReportRow, [number, number]>(
          `SELECT ${COLUMNS} FROM reports WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
        )
        .all(userId, limit),
    create: (input, userId) =>
      db
        .query<ReportRow, [string, number | null, number, number, string, string]>(
          `INSERT INTO reports (id, user_id, lat, lon, description, severity)
           VALUES (?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`
        )
        .get(crypto.randomUUID(), userId ?? null, input.lat, input.lon, input.description, input.severity)!
  };
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) return 50;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(100, Math.max(1, Math.trunc(parsed)));
}

export function createReportsRoute(repository?: ReportsRepository) {
  const repo = () => repository ?? createSqliteReportsRepository(getDb());
  const route = Router();

  route.get('/', (req, res) => {
    try {
      res.json({ success: true, source: 'db', data: repo().list(parseLimit(queryParam(req, 'limit'))) });
    } catch (error) {
      console.error('[REPORTS GET]', error);
      res.status(500).json({ success: false, error: 'Gagal mengambil laporan' });
    }
  });

  // Laporan milik user yang sedang login (dipakai halaman Dashboard & Laporan Saya).
  route.get('/mine', requireAuth, (req, res) => {
    try {
      res.json({
        success: true,
        data: repo().listByUser(req.userId!, parseLimit(queryParam(req, 'limit')))
      });
    } catch (error) {
      console.error('[REPORTS MINE]', error);
      res.status(500).json({ success: false, error: 'Gagal mengambil laporan' });
    }
  });

  route.post('/', optionalAuth, (req, res) => {
    const parsed = ReportInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Data tidak lengkap atau tidak valid',
        details: parsed.error.flatten().fieldErrors
      });
      return;
    }

    try {
      res.status(201).json({ success: true, data: repo().create(parsed.data, req.userId) });
    } catch (error) {
      console.error('[REPORTS INSERT]', error);
      res.status(500).json({ success: false, error: 'Gagal menyimpan laporan' });
    }
  });

  return route;
}

export const reportsRoute = createReportsRoute();
