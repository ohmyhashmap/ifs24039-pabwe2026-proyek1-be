import type { Database } from 'bun:sqlite';
import { Router } from 'express';
import { getDb } from '../db/database';
import { queryParam } from '../utils/http';
import { parseCoordinates } from '../utils/coordinates';

export const statsRoute = Router();

// Data pusat provinsi & Bounding Box untuk perhitungan
const PROVINCES = [
  { name: 'Aceh', center: [4.6951, 96.7494], bounds: [2.0, 6.0, 95.0, 98.0] },
  { name: 'Sumatera Utara', center: [3.5952, 98.6722], bounds: [1.0, 5.0, 96.0, 100.0] },
  { name: 'Sumatera Barat', center: [-0.9471, 100.4172], bounds: [-3.0, 0.5, 98.0, 102.0] },
  { name: 'Riau', center: [0.5071, 101.4478], bounds: [0.0, 2.5, 100.0, 105.0] },
  { name: 'Jambi', center: [-1.6101, 103.6131], bounds: [-2.5, -1.0, 101.0, 104.0] },
  { name: 'Sumatera Selatan', center: [-3.3194, 103.9144], bounds: [-5.0, -1.5, 102.0, 106.0] },
  { name: 'Bengkulu', center: [-3.7928, 102.2608], bounds: [-5.5, -2.0, 101.0, 104.0] },
  { name: 'Lampung', center: [-4.5586, 105.4068], bounds: [-6.0, -4.0, 103.0, 106.0] },
  { name: 'Bangka Belitung', center: [-2.7411, 106.4406], bounds: [-3.5, -1.0, 105.0, 109.0] },
  { name: 'Kepulauan Riau', center: [3.9456, 108.1428], bounds: [-1.0, 4.0, 104.0, 109.0] },
  { name: 'Kalimantan Barat', center: [-0.2788, 111.4753], bounds: [-3.0, 2.0, 108.0, 114.0] },
  { name: 'Kalimantan Tengah', center: [-1.6815, 113.3824], bounds: [-4.0, -1.0, 111.0, 116.0] },
  { name: 'Kalimantan Selatan', center: [-3.0926, 115.2838], bounds: [-4.5, -1.5, 114.0, 117.0] },
  { name: 'Kalimantan Timur', center: [0.5387, 116.4194], bounds: [-2.0, 2.0, 115.0, 119.0] },
  { name: 'Kalimantan Utara', center: [3.0731, 116.0414], bounds: [1.0, 4.5, 114.0, 118.0] }
] as const;

// Rumus Haversine untuk menghitung jarak (km)
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}


type Box = { minLat: number; maxLat: number; minLon: number; maxLon: number };

function countHotspots(db: Database, since: string, box?: Box): number {
  const row = box
    ? db
        .query<{ n: number }, [string, number, number, number, number]>(
          `SELECT COUNT(*) AS n FROM hotspots
           WHERE detected_at >= ? AND lat >= ? AND lat <= ? AND lon >= ? AND lon <= ?`
        )
        .get(since, box.minLat, box.maxLat, box.minLon, box.maxLon)
    : db
        .query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM hotspots WHERE detected_at >= ?')
        .get(since);
  return row?.n ?? 0;
}

function aqiDistributionOf(db: Database, box?: Box): number[] {
  const rows = box
    ? db
        .query<{ aqi: number }, [number, number, number, number]>(
          'SELECT aqi FROM air_quality_logs WHERE lat >= ? AND lat <= ? AND lon >= ? AND lon <= ?'
        )
        .all(box.minLat, box.maxLat, box.minLon, box.maxLon)
    : db.query<{ aqi: number }, []>('SELECT aqi FROM air_quality_logs').all();

  const distribution = [0, 0, 0, 0];
  for (const { aqi } of rows) {
    const bucket = aqi <= 50 ? 0 : aqi <= 100 ? 1 : aqi <= 200 ? 2 : 3;
    distribution[bucket] = (distribution[bucket] ?? 0) + 1;
  }
  return distribution;
}

statsRoute.get('/', (req, res) => {
  const latQuery = queryParam(req, 'lat');
  const lonQuery = queryParam(req, 'lon');
  const isLocal = latQuery !== undefined || lonQuery !== undefined;
  let lat = 0;
  let lon = 0;

  if (isLocal) {
    try {
      ({ lat, lon } = parseCoordinates(latQuery, lonQuery));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Koordinat tidak valid';
      res.status(400).json({ success: false, error: message });
      return;
    }
  }

  try {
    const db = getDb();
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const sinceIso = since.toISOString();

    // Mode lokal: radius ~330 km dari GPS user. Mode nasional: seluruh data.
    const delta = 3.0;
    const area: Box | undefined = isLocal
      ? { minLat: lat - delta, maxLat: lat + delta, minLon: lon - delta, maxLon: lon + delta }
      : undefined;

    const provinces = PROVINCES.map((prov) => {
      const [minLat, maxLat, minLon, maxLon] = prov.bounds;
      return {
        name: prov.name,
        count: countHotspots(db, sinceIso, { minLat, maxLat, minLon, maxLon }),
        distance: isLocal ? getDistance(lat, lon, prov.center[0], prov.center[1]) : 0
      };
    });
    const topProvinces = isLocal
      ? provinces.toSorted((a, b) => a.distance - b.distance).slice(0, 10)
      : provinces.toSorted((a, b) => b.count - a.count).slice(0, 10);

    res.json({
      success: true,
      data: {
        isLocal,
        totalHotspots: countHotspots(db, sinceIso, area),
        topProvinces,
        aqiDistribution: aqiDistributionOf(db, area)
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal mengambil statistik';
    res.status(500).json({ success: false, error: message });
  }
});
