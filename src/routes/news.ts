import { Router, type Response } from 'express';
import Parser from 'rss-parser';
import { formatNewsExcerpt, getNewsImage } from './newsFormatting';

const send = (res: Response, body: unknown, status = 200) => {
  res.status(status).json(body);
};

export const newsRoute = Router();
const parser = new Parser({
  customFields: {
    item: [['media:content', 'mediaContent'], ['enclosure', 'enclosure']]
  }
});

const newsData = [
  { id: 1, slug: 'peringatan-dini-asap-sumut', title: 'Peringatan Dini: Lintasan Asap Transboundary Kembali Menuju Sumatera Utara', category: 'Peringatan Dini', date: new Date().toISOString(), author: 'Tim SigapAsap', image: 'https://images.unsplash.com/photo-1611273426858-450d8e3c9fce?auto=format&fit=crop&q=80&w=1200', excerpt: 'Analisis satelit NASA dan BMKG mendeteksi pergerakan asap dari Sumatera Selatan. Warga diminta waspada.', content: 'Berdasarkan data pemodelan arah angin...' },
  { id: 2, slug: 'panduan-kesehatan-anak', title: 'Panduan Kesehatan: Batas Aman Aktivitas Anak Saat ISPU Tidak Sehat', category: 'Kesehatan', date: new Date().toISOString(), author: 'Redaksi Medis', image: 'https://images.unsplash.com/photo-1584036561566-baf8f5f1b144?auto=format&fit=crop&q=80&w=800', excerpt: 'Para ahli menyarankan pembatasan aktivitas luar ruangan bagi kelompok rentan.', content: 'Kualitas udara yang buruk...' },
  { id: 3, slug: 'kolaborasi-nasa-bmkg', title: 'Kolaborasi Teknologi: NASA dan BMKG Integrasikan Data Titik Panas', category: 'Teknologi', date: new Date().toISOString(), author: 'Tim Riset', image: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&q=80&w=800', excerpt: 'Sistem peringatan dini kini memiliki akurasi yang lebih tinggi berkat penggabungan data satelit.', content: 'Integrasi API...' }
];

newsRoute.get('/external', async (req, res) => {
  try {
    // 1. Gunakan CNBC Indonesia (XML sangat stabil)
    const feedUrl = 'https://www.cnbcindonesia.com/news/rss';

    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/rss+xml, application/xml, text/xml'
      }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    let xmlData = await response.text();

    // 2. SANITASI XML: Perbaiki karakter '&' yang tidak di-escape (penyebab Unclosed root tag)
    xmlData = xmlData.replace(/&(?!(amp|lt|gt|quot|apos);)/g, '&amp;');

    const feed = await parser.parseString(xmlData);

    // 3. Filter berita (Karhutla, Cuaca, Lingkungan)
    const keywords = ['karhutla', 'asap', 'polusi', 'kebakaran', 'lingkungan', 'bmkg', 'cuaca', 'hutan', 'panas'];
    let filteredItems = feed.items.filter((item) => {
      const textToSearch = (item.title + ' ' + (item.contentSnippet || '')).toLowerCase();
      return keywords.some((keyword) => textToSearch.includes(keyword));
    });

    // 4. Jika tidak ada yang cocok, ambil 5 berita terbaru
    if (filteredItems.length === 0) {
      filteredItems = feed.items.slice(0, 5);
    }

    const formattedNews = filteredItems.map((item: any, index) => {
      const fallbackImage =
        'https://images.unsplash.com/photo-1611273426858-450d8e3c9fce?auto=format&fit=crop&q=80&w=800';

      // Ambil gambar dari tag <enclosure> atau <media:content>
      const imageUrl = getNewsImage(item, fallbackImage);
      const cleanExcerpt = formatNewsExcerpt(item.contentSnippet);

      return {
        id: `ext-${index}`,
        slug: item.link,
        title: item.title,
        category: 'Kabar Nasional',
        date: item.pubDate || new Date().toISOString(),
        author: 'CNBC Indonesia',
        image: imageUrl,
        excerpt: cleanExcerpt,
        isExternal: true,
        link: item.link
      };
    });

    return send(res, { success: true, data: formattedNews });
  } catch (error: any) {
    console.error('Gagal mengambil RSS Eksternal:', error.message);

    // 5. FALLBACK DARURAT: Jika internet mati / RSS error, kembalikan berita internal
    // agar aplikasi tidak pernah menampilkan layar kosong.
    return send(res, {
      success: true,
      data: newsData.map((n) => ({
        ...n,
        isExternal: false,
        category: 'Info Internal'
      }))
    });
  }
});

newsRoute.get('/', (req, res) => send(res, { success: true, data: newsData }));

newsRoute.get('/:slug', (req, res) => {
  const article = newsData.find((n) => n.slug === req.params.slug);
  if (!article) return send(res, { success: false, error: 'Berita tidak ditemukan' }, 404);
  return send(res, { success: true, data: article });
});
