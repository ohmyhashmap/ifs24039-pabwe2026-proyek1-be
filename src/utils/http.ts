import type { Request } from 'express';

/** Ambil query string tunggal; nilai array/objek dianggap tidak ada. */
export function queryParam(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === 'string' ? value : undefined;
}
