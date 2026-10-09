# Konvertin

Konverter file serbaguna (PRD v1.2). **Tahap ini: Modul A, dokumen ke dokumen.**

| ID | Konversi | Status |
|----|----------|--------|
| A1 | PDF → DOCX (pdf2docx) | jadi |
| A2 | DOCX → PDF (LibreOffice) | jadi |
| A3 | PPTX → PDF, XLSX → PDF | jadi |
| A4 | PDF → TXT, DOCX → TXT | jadi |
| A5 | Peringatan layout + PDF scan belum didukung | jadi (UI + penolakan di server) |

Modul B (gambar), C (kompres), D (audio) belum dibuat; di beranda diberi label "Segera".

## Jalankan lokal
```bash
cd backend
pip install -r requirements.txt        # butuh LibreOffice (soffice) dan poppler-utils (pdftotext) di PATH
python3 -m uvicorn app.main:app --port 8000
# buka http://localhost:8000  (FastAPI juga menyajikan folder frontend/)
python3 -m pytest -q                    # 19 tes, pakai konversi asli
```
Docker: `docker compose up --build`.

## Struktur
- `backend/app/validation.py`: magic bytes, tolak password/OLE lama, anti zip-bomb, batas halaman/ukuran
- `backend/app/converters.py`: konverter, jalan sebagai proses terpisah (timeout 120 dtk, batas memori, bisa dibatalkan)
- `backend/app/jobs.py`: tabel job (SQLite), antrean worker, hapus otomatis (TTL 1 jam)
- `frontend/`: HTML/CSS/JS polos. Halaman di-generate dari satu template: `python3 tools/build_pages.py`

## API
`POST /api/jobs` (file + type) → 202 `{job_id}` · `GET /api/jobs/{id}` · `GET /api/jobs/{id}/download` · `DELETE /api/jobs/{id}` (batal) · `POST /api/detect` · `GET /api/conversions`

## Beda dari PRD (sengaja, untuk tahap awal)
- Antrean: thread pool + SQLite, bukan Redis/RQ; storage: disk lokal, bukan S3/R2 + presigned URL. `jobs.py` sengaja kecil supaya mudah diganti saat skala naik.
- Upload langsung ke API (satu langkah), bukan presigned URL.
- Polling status, belum SSE.

## Sebelum rilis (TODO)
- Isi `SITE_URL`, `CONTACT_EMAIL`, `API_BASE` di `tools/build_pages.py` lalu build ulang.
- Wireframe/warna aksen final (sekarang oranye `--accent` di `style.css`), keputusan font (sekarang font sistem, nol request).
- Pasang HTTPS lewat reverse proxy; uji beban; Sentry.
- Pasang iklan hanya di Fase 4 (slot sudah dikomentari di template tool).
