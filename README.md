# Konvertin

Konverter file serbaguna (PRD v1.2). Status: Modul A, B, C, dan D sudah ada versi kerjanya.

| Modul | ID | Konversi | Jalan di | Status |
|-------|----|----------|----------|--------|
| A | A1-A4 | PDF ke DOCX, DOCX/PPTX/XLSX ke PDF, PDF/DOCX ke TXT | server | jadi |
| A | A5 | Peringatan layout dan PDF scan | UI + server | jadi |
| B | B1-B5 | JPG/PNG/WEBP, HEIC ke JPG, slider kualitas, resize, batch ZIP | browser | jadi, dites |
| C | C1, C3, C4 | Kompres gambar, ukuran sebelum/sesudah, target KB | browser | jadi, dites |
| C | C2 | Kompres PDF 3 level | server | jadi |
| C | C5 | Kompres DOCX/PPTX (gambar di dalamnya diperkecil, 3 level) | server | jadi, dites |
| D | D1-D4 | Konversi audio, bitrate, trim, batas 10 menit/50 MB | browser (ffmpeg.wasm) | jadi, belum dites otomatis |

## Struktur
- `frontend/`: situs statis (HTML/CSS/JS polos). Semua halaman HTML dihasilkan dari `scripts/tools.json` oleh `scripts/build.mjs`. `frontend/css/style.css` dan `frontend/js/app.js` ditulis tangan. `frontend/vendor/` berisi heic2any, jszip, ffmpeg.
- `backend/app/`: FastAPI. `validation.py` (magic bytes, anti zip-bomb), `converters.py` (proses terpisah, timeout 120 dtk; kompres DOCX/PPTX memakai Pillow), `jobs.py` (SQLite + thread pool, hapus otomatis 1 jam), `ratelimit.py`.
- `docker-compose.yml`: satu wadah API yang juga menyajikan `frontend/`.

## Ubah atau tambah tool
Edit `scripts/tools.json`, lalu build ulang dan commit hasilnya di `frontend/`:
```bash
npm run build         # tool server aktif, API satu origin (dipakai backend)
npm run build:static  # situs statis; tool server aktif jika API_BASE diisi
# env lain: API_BASE=https://api.contoh.id  ADS=1  SITE_URL=https://domain-asli
```

Build di atas mendukung Windows dan macOS/Linux. Untuk memakai URL backend lokal yang berbeda, jalankan `API_BASE=http://localhost:8000 npm run build:static` di macOS/Linux atau `$env:API_BASE='http://localhost:8000'; npm.cmd run build:static` di PowerShell.

## Aktifkan semua konversi di komputer lokal
Sembilan tool dokumen—kompres PDF/Word/PowerPoint, PDF ke Word/TXT, Word ke PDF/TXT, PPTX ke PDF, dan Excel ke PDF—memproses file di backend. Backend butuh Python, paket di `backend/requirements.txt`, serta LibreOffice (perintah `soffice`) untuk konversi Office ke PDF.

Cara yang paling konsisten jika Docker tersedia:
```bash
docker compose up --build
# Buka http://localhost:8000
```

Tanpa Docker, pasang Python dan LibreOffice, lalu jalankan dari PowerShell:
```bash
winget install --id TheDocumentFoundation.LibreOffice -e
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
# Buka http://localhost:8000
```
`npm run build` membuat halaman dengan API satu origin (`/`); FastAPI lokal menyajikan frontend sekaligus API. Backend mencari LibreOffice di PATH atau lokasi instalasi Windows standar. `pdftotext` opsional karena ekstraksi teks PDF punya fallback Python. `python -m pytest -q backend/tests` menjalankan tes backend, termasuk konversi PDF, Word, PowerPoint, dan Excel ke PDF.

Batas lokal default adalah 25 MB per dokumen, 200 halaman PDF, dan waktu proses yang dibatasi. Jika mesinmu mampu memproses file lebih besar, naikkan `KONVERTIN_MAX_DOC_MB`, `KONVERTIN_MAX_PDF_PAGES`, atau `KONVERTIN_JOB_TIMEOUT_SEC` di environment sebelum menyalakan backend. Memproses file tanpa batas tidak aman atau realistis: kebutuhan RAM/waktu bergantung pada isi file dan kapasitas komputer.

Workflow `.github/workflows/pages.yml` membangun situs statis dari `main`. Agar semua tool server aktif di GitHub Pages, atur variable `KONVERTIN_API_BASE` ke URL HTTPS backend publik di GitHub Actions. UI akun memerlukan API satu origin (`API_BASE=/`) dan tidak ditampilkan pada situs statis dengan backend lintas domain.

## Aktifkan tool server di GitHub Pages
GitHub Pages hanya menyajikan file statis; ia tidak bisa menjalankan API Python. Repo ini menyediakan [Render Blueprint](./render.yaml) untuk menjalankan backend terpisah, sementara frontend tetap dipublikasikan melalui GitHub Pages:

1. Buat layanan dari repo ini di Render dengan **New + → Blueprint**. Blueprint memakai paket gratis, Docker, dan mengatur CORS untuk `https://nopanpeno.github.io`.
2. Setelah layanan `konvertin-api` selesai dibuat, salin URL HTTPS-nya, misalnya `https://konvertin-api.onrender.com`.
3. Di GitHub, buka **Settings → Secrets and variables → Actions → Variables**, lalu buat variable `KONVERTIN_API_BASE` dengan URL backend itu (tanpa garis miring di akhir).
4. Jalankan ulang workflow **Pages** di tab **Actions**. Workflow membangun halaman dengan URL API tersebut dan memublikasikannya ke GitHub Pages.
5. Buka `https://nopanpeno.github.io/Konvertin/` dan coba tool dokumen. Status kesehatan backend dapat dicek di `<URL-backend>/api/health`.

Kalau memakai domain GitHub Pages kustom, ubah `KONVERTIN_CORS_ORIGINS` di Render agar cocok persis dengan origin domain situs, lalu deploy ulang. Jika variable URL API belum diatur, workflow sengaja menampilkan tool server sebagai **Segera**, bukan berpura-pura konversi aktif.

**Batas layanan publik:** hosting gratis Render dapat tidur saat tidak digunakan, memulai ulang layanan, dan memakai penyimpanan sementara; konversi yang sedang berjalan atau file hasil dapat hilang saat layanan dimulai ulang. Batas default backend adalah 25 MB per dokumen, 200 halaman PDF, 20 job per alamat IP per jam, dan penghapusan file paling lama satu jam. Ini dapat diubah lewat variabel konfigurasi `KONVERTIN_*`, tetapi jangan menghapus batas ukuran, waktu, antrean, atau laju pada layanan publik—pemakaian “tanpa batas” memungkinkan penyalahgunaan dan membuat layanan tidak stabil. Untuk pemakaian kelompok yang lebih andal, gunakan hosting berbayar dengan disk persisten dan batasi akses sesuai kebutuhan.

## Kompres DOCX/PPTX: apa yang berubah
Hanya gambar JPG dan PNG di `word/media/` dan `ppt/media/` yang diperkecil (format dan nama file tetap, jadi relasi dokumen tidak putus; EXIF dan transparansi PNG dijaga). Sisi terpanjang dibatasi 2400 / 1600 / 1024 px untuk level ringan / sedang / maksimal, dengan kualitas JPEG 80 / 60 / 40. Teks, tabel, video, audio, dan file lain di dalam paket tidak disentuh, jadi dokumen tanpa gambar atau PPTX yang besar karena video hampir tidak berkurang. Kalau hasil tidak lebih kecil, file asli yang dikembalikan. XLSX belum didukung.

## API
`POST /api/jobs` (file + type) -> 202 `{job_id}` · `GET /api/jobs/{id}` · `GET /api/jobs/{id}/download` · `DELETE /api/jobs/{id}` (batal) · `POST /api/detect` · `GET /api/conversions`

## Akun, riwayat, dan statistik admin

- Pendaftaran/login memakai email dan password (hash PBKDF2); sesi ada di cookie HttpOnly, SameSite=Lax. HTTPS wajib di produksi.
- Halaman akun: `/akun.html`, profil `/profil.html`, riwayat `/riwayat.html`, dan penggunaan admin `/admin.html`.
- Riwayat pengguna hanya menyimpan jenis tool, sumber proses, status, dan waktu. File serta nama file tidak disimpan di riwayat. Baris riwayat dan agregat penggunaan dihapus setelah 365 hari; file hasil tetap mengikuti TTL satu jam.
- Statistik admin menampilkan jumlah penggunaan per hari dan jenis tool secara agregat. Admin tidak mendapat akses ke riwayat pengguna atau file.
- Salin `.env.example` menjadi `.env`, lalu isi `KONVERTIN_ADMIN_EMAIL` dan `KONVERTIN_ADMIN_PASSWORD` dengan email admin dan password acak minimal 10 karakter sebelum `docker compose up --build`. Jika email itu sudah terdaftar, startup akan memberinya role admin. `.env` sudah diabaikan Git.
- Untuk HTTP lokal saja, set `KONVERTIN_SESSION_COOKIE_SECURE=0`. Di VPS, biarkan `1` dan pasang HTTPS pada reverse proxy.

Endpoint akun: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `PATCH /api/auth/profile`, `GET /api/history`, dan `GET /api/admin/usage?days=7|30|90`.

## Beda dari PRD (sengaja, untuk tahap awal)
- Antrean: thread pool + SQLite, bukan Redis/RQ; storage disk lokal, bukan S3/R2 + presigned URL. `jobs.py` sengaja kecil supaya mudah diganti.
- Upload langsung ke API, polling status (belum SSE).

## Sebelum rilis (TODO)
- Ganti `halo@konvertin.example` (kontak) dan isi `SITE_URL` di `scripts/build.mjs`/env, lalu build ulang.
- Tes otomatis untuk audio (D) dan HEIC (B2); keduanya belum teruji otomatis (butuh tes browser, mis. Playwright). Mesin ffmpeg dimuat dari `frontend/vendor/ffmpeg-core/` kecuali `FFMPEG_CORE_BASE` diisi.
- HTTPS lewat reverse proxy, uji beban, Sentry, wireframe/warna aksen final.
- Iklan hanya di Fase 4 (slot `ad-slot` sudah ada di template, aktif dengan `ADS=1`).
