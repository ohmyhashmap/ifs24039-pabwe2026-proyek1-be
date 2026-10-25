import { z } from 'zod';

const ConfidenceSchema = z.union([z.number().finite(), z.enum(['l', 'n', 'h'])]);

export const HotspotSchema = z.object({
  id: z.string(),
  source: z.literal('NASA_FIRMS'),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  confidence: ConfidenceSchema,
  detected_at: z.string().datetime({ offset: true })
});

export type Hotspot = z.infer<typeof HotspotSchema>;

type CsvState = {
  rows: string[][];
  row: string[];
  value: string;
  quoted: boolean;
  skipNextCharacter: boolean;
};

function consumeQuotedCharacter(text: string, index: number, state: CsvState): void {
  const char = text[index]!;
  if (char !== '"') {
    state.value += char;
    return;
  }

  if (text[index + 1] === '"') {
    state.value += '"';
    state.skipNextCharacter = true;
    return;
  }

  state.quoted = false;
}

function finishCsvRow(state: CsvState): void {
  state.row.push(state.value);
  if (state.row.some((field) => field.length > 0)) state.rows.push(state.row);
  state.row = [];
  state.value = '';
}

function consumeUnquotedCharacter(text: string, index: number, state: CsvState): void {
  const char = text[index]!;
  if (char === '"' && state.value.length === 0) {
    state.quoted = true;
  } else if (char === ',') {
    state.row.push(state.value);
    state.value = '';
  } else if (char === '\n' || char === '\r') {
    finishCsvRow(state);
  } else {
    state.value += char;
  }
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const state: CsvState = { rows, row: [], value: '', quoted: false, skipNextCharacter: false };

  for (let i = 0; i < text.length; i++) {
    if (state.skipNextCharacter) {
      state.skipNextCharacter = false;
      continue;
    }
    if (state.quoted) consumeQuotedCharacter(text, i, state);
    else consumeUnquotedCharacter(text, i, state);
  }

  if (state.quoted) throw new Error('Respons CSV NASA memiliki tanda kutip yang tidak lengkap');
  finishCsvRow(state);
  return rows;
}

export function validateNasaRequest(bbox: string, days: number): void {
  const coordinates = bbox.split(',').map(Number);
  const [west, south, east, north] = coordinates;

  if (
    coordinates.length !== 4 ||
    coordinates.some((coordinate) => !Number.isFinite(coordinate)) ||
    west! < -180 ||
    west! > 180 ||
    east! < -180 ||
    east! > 180 ||
    south! < -90 ||
    south! > 90 ||
    north! < -90 ||
    north! > 90 ||
    west! >= east! ||
    south! >= north!
  ) {
    throw new Error('bbox harus berisi west,south,east,north dengan koordinat yang valid');
  }

  if (!Number.isInteger(days) || days < 1 || days > 10) {
    throw new Error('days harus berupa bilangan bulat antara 1 dan 10');
  }
}

export async function fetchNasaHotspots(bbox: string, days: number = 1): Promise<Hotspot[]> {
  const apiKey = Bun.env.NASA_MAP_KEY;
  if (!apiKey) throw new Error('NASA_MAP_KEY tidak ditemukan di .env');
  validateNasaRequest(bbox, days);

  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(apiKey)}/VIIRS_SNPP_NRT/${bbox}/${days}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal fetch NASA: ${res.status} ${res.statusText}`);

  const rows = parseCsv((await res.text()).replace(/^\uFEFF/, ''));
  if (rows.length === 0) return [];

  const headers = rows[0]!.map((header) => header.trim().toLowerCase());
  const requiredHeaders = ['latitude', 'longitude', 'confidence', 'acq_date', 'acq_time'];
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new Error(`Respons NASA tidak memiliki kolom: ${missingHeaders.join(', ')}`);
  }

  const data: Hotspot[] = [];
  for (const [index, values] of rows.slice(1).entries()) {
    const row = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? '']));
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    const rawConfidence = (row.confidence ?? '').trim().toLowerCase();
    const numericConfidence = rawConfidence === '' ? Number.NaN : Number(rawConfidence);
    const confidence = ['l', 'n', 'h'].includes(rawConfidence) ? rawConfidence : numericConfidence;
    const acquisitionTime = (row.acq_time ?? '').trim().padStart(4, '0');
    const date = (row.acq_date ?? '').trim();

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !/^\d{4}$/.test(acquisitionTime) ||
      Number(acquisitionTime.slice(0, 2)) > 23 ||
      Number(acquisitionTime.slice(2, 4)) > 59 ||
      Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
    ) {
      throw new Error(`Data waktu NASA tidak valid pada baris ${index + 2}`);
    }

    const detectedAt = `${date}T${acquisitionTime.slice(0, 2)}:${acquisitionTime.slice(2, 4)}:00Z`;
    const hotspot = HotspotSchema.parse({
      id: `nasa-${latitude}-${longitude}-${date}-${acquisitionTime}`,
      source: 'NASA_FIRMS',
      lat: latitude,
      lon: longitude,
      confidence,
      detected_at: detectedAt
    });
    data.push(hotspot);
  }

  return data;
}
