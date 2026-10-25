# SigapAsap API (Express.js + SQLite)

Backend untuk frontend SigapAsap. Framework **Express.js**, database **SQLite** (`bun:sqlite`, file lokal —
tanpa server database terpisah). Dijalankan dengan [Bun](https://bun.sh).

## Menjalankan

```bash
cd backend
bun install
cp .env.example .env      # isi JWT_SECRET (wajib di production), NASA_MAP_KEY, AQICN_TOKEN
bun run seed              # opsional: buat akun uji "auditor" / "Auditor123!"
bun run start             # http://localhost:8787
```

Database dibuat otomatis di `SQLITE_PATH` (default `backend/data/sigapasap.db`); skema ada di `src/db/database.ts`.
Saat development, frontend (`bun run dev` di root) meneruskan `/api` ke `http://localhost:8787`.

Akun seed bisa diubah lewat `SEED_USERNAME`, `SEED_PASSWORD`, `SEED_NAME`.

## Pengujian

```bash
bun test
bun test --coverage
```

## Endpoint

Semua respons: `{ "success": boolean, "data": ..., "error": string }`. Endpoint bertanda 🔒 butuh header
`Authorization: Bearer <token>` (401 bila tidak valid).

| Method & path | Keterangan |
| --- | --- |
| `POST /api/v1/auth/register` | `{ name, username, password }` → `{ token, user }` (201; 409 bila username dipakai) |
| `POST /api/v1/auth/login` | `{ username, password }` → `{ token, user }` (401 bila salah) |
| `GET /api/v1/auth/me` 🔒 | profil user |
| `PUT /api/v1/auth/profile` 🔒 | `{ name }` |
| `PUT /api/v1/auth/password` 🔒 | `{ currentPassword, newPassword }` |
| `GET /api/v1/reports` | daftar laporan terbaru |
| `GET /api/v1/reports/mine` 🔒 | laporan milik user |
| `POST /api/v1/reports` | kirim laporan; bila ada Bearer token, laporan terhubung ke akun |
| `GET /api/v1/hotspots`, `/stats`, `/environment`, `/trajectory`, `/safe-window`, `/recommendations`, `/news` | data SigapAsap seperti sebelumnya |

Password disimpan sebagai hash scrypt + salt; token berupa JWT HS256 (berlaku 7 hari) yang ditandatangani `JWT_SECRET`.

## Deploy

Jalankan `bun run start` dengan env `PORT`, `JWT_SECRET`, `SQLITE_PATH` (arahkan ke disk persisten), `NASA_MAP_KEY`,
`AQICN_TOKEN`. Di frontend, set `VITE_API_URL` ke URL backend. Catatan: filesystem gratis di Render/Vercel bersifat
sementara — pakai persistent disk agar file SQLite tidak hilang.
