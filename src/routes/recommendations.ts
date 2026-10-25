import { Router, type Response } from 'express';
import { queryParam } from '../utils/http';
const send = (res: Response, body: unknown, status = 200) => {
  res.status(status).json(body);
};


export const recommendationsRoute = Router();

// IN-MEMORY CACHE
const cache = new Map<string, { data: any; expiry: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 jam (karena aturannya statis)

const getRecommendation = (aqi: number, profile: string) => {
  if (!aqi) return "Data kualitas udara belum tersedia.";

  if (aqi <= 50) {
    return {
      umum: "Udara bersih. Aman untuk beraktivitas di luar ruangan.",
      anak: "Aman untuk bermain di luar. Tetap jaga hidrasi.",
      asma: "Aman. Tetap bawa inhaler untuk jaga-jaga."
    }[profile] || "Udara aman.";
  } 
  
  if (aqi <= 100) {
    return {
      umum: "Kualitas udara sedang. Kurangi aktivitas berat di luar ruangan.",
      anak: "Batasi waktu bermain di luar. Gunakan masker jika keluar.",
      asma: "Waspada. Hindari paparan debu dan asap rokok."
    }[profile] || "Kualitas udara sedang.";
  } 
  
  if (aqi <= 200) {
    return {
      umum: "Tidak sehat. Gunakan masker N95 jika keluar ruangan.",
      anak: "Tidak disarankan upacara/olahraga di luar. Sekolah sebaiknya di dalam ruangan.",
      asma: "Bahaya! Hindari keluar ruangan. Siapkan obat pereda sesak."
    }[profile] || "Tidak sehat. Gunakan masker.";
  } 
  
  return {
    umum: "Sangat tidak sehat! Tetap di rumah, tutup jendela, nyalakan air purifier.",
    anak: "Bahaya! Liburkan kegiatan luar ruangan. Tetap di dalam rumah.",
    asma: "Darurat! Tetap di dalam ruangan. Segera konsultasi dokter jika sesak."
  }[profile] || "Sangat tidak sehat. Tetap di rumah.";
};

recommendationsRoute.get('/', (req, res) => {
  const aqi = Number(queryParam(req, 'aqi'));
  const profile = queryParam(req, 'profile') || 'umum';
  const cacheKey = `rec-${aqi}-${profile}`;

  // 1. Cek Cache
  const cached = cache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return send(res, cached.data);
  }

  // 2. Hitung (jika tidak ada di cache)
  const message = getRecommendation(aqi, profile);
  const responsePayload = {
    success: true,
    data: { aqi, profile, message }
  };

  // 3. Simpan ke Cache
  cache.set(cacheKey, { data: responsePayload, expiry: Date.now() + CACHE_TTL });

  return send(res, responsePayload);
});