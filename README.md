# Konvertin

Konverter file serbaguna (PRD v1.2). Status: Modul A, B, C, dan D sudah ada versi kerjanya.

| Modul | ID | Konversi | Jalan di | Status |
|-------|----|----------|----------|--------|
| A | A1-A4 | PDF ke DOCX, DOCX/PPTX/XLSX ke PDF, PDF/DOCX ke TXT | server | jadi |
| A | A5 | Peringatan layout dan PDF scan | UI + server | jadi |
| B | B1-B5 | JPG/PNG/WEBP, HEIC ke JPG, slider kualitas, resize, batch ZIP | browser | jadi, dites |
| C | C1, C3, C4 | Kompres gambar, ukuran sebelum/sesudah, target KB | browser | jadi, dites |
| C | C2 | Kompres PDF 3 level | server | jadi |
| C | C5 | Kompres DOCX/PPTX | - | belum |
| D | D1-D4 | Konversi audio, bitrate, trim, batas 10 menit/50 MB | browser (ffmpeg.wasm) | jadi, belum dites otomatis |

## Struktur
- `frontend/`: situs statis (HTML/CSS/JS polos). Semua halaman HTML dihasilkan dari `scripts/tools.json` oleh `scripts/build.mjs`. `frontend/css/style.css` dan `frontend/js/app.js` ditulis tangan. `frontend/vendor/` berisi heic2any, jszip, ffmpeg.
- `backend/app/`: FastAPI. `validation.py` (magic bytes, anti zip-bomb), `converters.py` (proses terpisah, timeout 120 dtk), `jobs.py` (SQLite + thread pool, hapus otomatis 1 jam), `ratelimit.py`.
- `docker-compose.yml`: satu wadah API yang juga menyajikan `frontend/`.

## Ubah atau tambah tool
Edit `scripts/tools.json`, lalu build ulang dan commit hasilnya di `frontend/`:
```bash
npm run build         # tool server aktif, API satu origin (dipakai backend)
npm run build:static  # tanpa backend: tool server berlabel "Segera"
# env lain: API_BASE=https://api.contoh.id  ADS=1  SITE_URL=https://domain-asli
```

## Halaman konversi PDF butuh backend
Halaman `pdf-ke-word`, `word-ke-pdf`, `pptx-ke-pdf`, `excel-ke-pdf`, `pdf-ke-txt`, `word-ke-txt`, dan `kompres-pdf` memproses file di server. Kalau dibuka tanpa backend (misalnya `npm run serve` saja atau hosting statis), tombol Konversi akan gagal dengan pesan "Server tidak bisa dihubungi" — itu bukan bug frontend, backend memang harus jalan.

Cara mengaktifkan:
```bash
# 1. Build frontend dengan API satu origin (API_BASE=/)
npm run build            # JANGAN pakai build:static untuk halaman ini

# 2. Jalankan backend FastAPI (menyajikan frontend + API di port yang sama)
cd backend
pip install -r requirements.txt   # butuh LibreOffice (soffice) & poppler-utils di PATH
python3 -m uvicorn app.main:app --port 8000
# buka http://localhost:8000/pdf-ke-word/

# atau sekali jalan lewat Docker:
docker compose up --build   # lalu buka http://localhost:8000
```
Catatan: kalau `API_BASE` dikosongkan saat build, tool server diberi label "Segera" dan upload dinonaktifkan oleh desain (lihat `scripts/build.mjs`).

## Jalankan lokal
```bash
cd backend
pip install -r requirements.txt      # butuh LibreOffice (soffice) dan poppler-utils (pdftotext) di PATH
python3 -m uvicorn app.main:app --port 8000   # buka http://localhost:8000
python3 -m pytest -q                 # 19 tes, pakai konversi asli
```
Docker: `docker compose up --build`. Hanya frontend (tool browser): `npm run build:static && npm run serve`.

## API
`POST /api/jobs` (file + type) -> 202 `{job_id}` · `GET /api/jobs/{id}` · `GET /api/jobs/{id}/download` · `DELETE /api/jobs/{id}` (batal) · `POST /api/detect` · `GET /api/conversions`

## Beda dari PRD (sengaja, untuk tahap awal)
- Antrean: thread pool + SQLite, bukan Redis/RQ; storage disk lokal, bukan S3/R2 + presigned URL. `jobs.py` sengaja kecil supaya mudah diganti.
- Upload langsung ke API, polling status (belum SSE).

## Sebelum rilis (TODO)
- Ganti `halo@konvertin.example` (kontak) dan isi `SITE_URL` di `scripts/build.mjs`/env, lalu build ulang.
- Keputusan font: `style.css` sekarang memuat Inter dari Google Fonts (satu request ke pihak ketiga). PRD menyebut self-host lebih privat.
- Tes otomatis untuk audio (D) dan HEIC (B2); keduanya belum teruji di sini (ffmpeg core diunduh dari jsDelivr).
- HTTPS lewat reverse proxy, uji beban, Sentry, wireframe/warna aksen final.
- Iklan hanya di Fase 4 (slot `ad-slot` sudah ada di template, aktif dengan `ADS=1`).
