"""Konvertin backend: API konversi dokumen dan kompres PDF.

Alur: POST /api/jobs (upload + opsi) -> worker jalankan tool di subprocess ->
GET /api/jobs/{id} (status) -> GET /api/jobs/{id}/download. File dihapus otomatis.

Catatan: antrean pakai ThreadPoolExecutor di dalam proses (cukup untuk satu VPS).
Kalau trafik naik, ganti run_job() dengan worker Celery/RQ + Redis, antarmuka job tetap sama.
"""
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import time
import uuid
import zipfile
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

# ---------- konfigurasi (env) ----------
STORAGE = Path(os.getenv("STORAGE_DIR", "/tmp/konvertin"))
DB_PATH = STORAGE / "jobs.sqlite3"
MAX_MB = int(os.getenv("MAX_UPLOAD_MB", "25"))
TTL_SECONDS = int(os.getenv("TTL_SECONDS", "3600"))          # file dihapus maks 1 jam setelah selesai
JOB_TIMEOUT = int(os.getenv("JOB_TIMEOUT", "120"))            # detik per job
MAX_PDF_PAGES = int(os.getenv("MAX_PDF_PAGES", "300"))
MAX_UNZIPPED_MB = int(os.getenv("MAX_UNZIPPED_MB", "500"))    # cegah zip bomb
RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_HOUR", "20"))
WORKERS = int(os.getenv("WORKERS", "2"))
TRUST_PROXY = os.getenv("TRUST_PROXY", "0") == "1"
CORS_ORIGINS = [o for o in os.getenv("CORS_ORIGINS", "http://localhost:8080").split(",") if o]

STORAGE.mkdir(parents=True, exist_ok=True)

# tipe job -> (jenis magic bytes yang diterima, ekstensi hasil, mime hasil)
JOBS = {
    "pdf_to_docx": ("pdf", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "docx_to_pdf": ("docx", "pdf", "application/pdf"),
    "pptx_to_pdf": ("pptx", "pdf", "application/pdf"),
    "xlsx_to_pdf": ("xlsx", "pdf", "application/pdf"),
    "pdf_to_txt": ("pdf", "txt", "text/plain; charset=utf-8"),
    "docx_to_txt": ("docx", "txt", "text/plain; charset=utf-8"),
    "compress_pdf": ("pdf", "pdf", "application/pdf"),
}
GS_LEVELS = {"light": "/printer", "medium": "/ebook", "max": "/screen"}


class UserError(Exception):
    """Pesan ini aman ditampilkan ke user."""


# ---------- database ----------
_db_lock = threading.Lock()


def db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _db_lock, db() as c:
        c.execute(
            """CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY, type TEXT NOT NULL, options TEXT NOT NULL,
                input_key TEXT, output_key TEXT, status TEXT NOT NULL,
                error_message TEXT, created_at REAL NOT NULL, expires_at REAL NOT NULL)"""
        )


def update(job_id, **fields):
    cols = ", ".join(f"{k}=?" for k in fields)
    with _db_lock, db() as c:
        c.execute(f"UPDATE jobs SET {cols} WHERE job_id=?", (*fields.values(), job_id))


def get_job(job_id):
    with _db_lock, db() as c:
        return c.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()


# ---------- validasi file ----------
def sniff(path: Path) -> str:
    with open(path, "rb") as f:
        head = f.read(8)
    if head.startswith(b"%PDF"):
        return "pdf"
    if head.startswith(b"PK"):
        return "zip"
    if head.startswith(bytes.fromhex("d0cf11e0")):
        return "ole"
    return ""


def office_kind(path: Path) -> str:
    """Bedakan docx/pptx/xlsx dari isi zip, bukan dari ekstensi."""
    try:
        with zipfile.ZipFile(path) as z:
            total = sum(i.file_size for i in z.infolist())
            if total > MAX_UNZIPPED_MB * 1024 * 1024:
                raise UserError("File terlalu besar setelah dibuka. File ditolak demi keamanan.")
            names = set(z.namelist())
    except zipfile.BadZipFile:
        raise UserError("File rusak dan tidak bisa dibuka.")
    if "word/document.xml" in names:
        return "docx"
    if "ppt/presentation.xml" in names:
        return "pptx"
    if "xl/workbook.xml" in names:
        return "xlsx"
    raise UserError("Isi file bukan dokumen Office yang dikenal.")


def validate_input(path: Path, expect: str):
    kind = sniff(path)
    if kind == "ole":
        raise UserError("File terproteksi password atau memakai format lama. Simpan ulang tanpa password sebagai DOCX/PPTX/XLSX.")
    if expect == "pdf":
        if kind != "pdf":
            raise UserError("File ini bukan PDF yang valid.")
        info = run(["pdfinfo", str(path)], timeout=20, err="PDF rusak dan tidak bisa dibaca.")
        if "Encrypted:       yes" in info:
            raise UserError("PDF dilindungi password. Buka proteksinya dulu, lalu coba lagi.")
        for line in info.splitlines():
            if line.startswith("Pages:") and int(line.split()[1]) > MAX_PDF_PAGES:
                raise UserError(f"PDF terlalu panjang. Batas {MAX_PDF_PAGES} halaman.")
    else:
        if kind != "zip":
            raise UserError(f"File ini bukan {expect.upper()} yang valid.")
        real = office_kind(path)
        if real != expect:
            raise UserError(f"Tool ini untuk {expect.upper()}, tapi isi file terbaca sebagai {real.upper()}.")


# ---------- konversi ----------
def run(cmd, timeout=JOB_TIMEOUT, err="Konversi gagal.", cwd=None):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd,
                           env={"PATH": os.environ.get("PATH", ""), "HOME": tempfile.gettempdir(), "LANG": "C.UTF-8"})
    except subprocess.TimeoutExpired:
        raise UserError("Proses terlalu lama dan dihentikan. Coba file yang lebih kecil.")
    except FileNotFoundError:
        raise UserError("Tool konversi belum terpasang di server.")
    if p.returncode != 0:
        raise UserError(err)
    return p.stdout


def soffice(src: Path, outdir: Path, fmt: str):
    profile = outdir / "lo-profile"
    run(["soffice", f"-env:UserInstallation=file://{profile}", "--headless", "--norestore",
         "--convert-to", fmt, "--outdir", str(outdir), str(src)],
        err="File tidak bisa dikonversi. File mungkin rusak atau memakai fitur yang belum didukung.")
    shutil.rmtree(profile, ignore_errors=True)


def convert(job_type: str, options: dict, src: Path, out: Path):
    work = out.parent
    if job_type in ("docx_to_pdf", "pptx_to_pdf", "xlsx_to_pdf"):
        soffice(src, work, "pdf")
        produced = work / (src.stem + ".pdf")
    elif job_type == "docx_to_txt":
        soffice(src, work, "txt:Text")
        produced = work / (src.stem + ".txt")
    elif job_type == "pdf_to_txt":
        produced = work / (src.stem + ".txt")
        run(["pdftotext", "-layout", "-enc", "UTF-8", str(src), str(produced)], err="Teks tidak bisa diambil dari PDF.")
        if not produced.read_text(encoding="utf-8", errors="ignore").strip():
            raise UserError("PDF ini tidak berisi teks. Kemungkinan hasil scan, dan OCR belum didukung.")
    elif job_type == "pdf_to_docx":
        txt = work / "probe.txt"
        run(["pdftotext", "-l", "3", str(src), str(txt)], err="PDF tidak bisa dibaca.")
        if not txt.read_text(encoding="utf-8", errors="ignore").strip():
            raise UserError("PDF ini tidak berisi teks. Kemungkinan hasil scan, dan OCR belum didukung.")
        produced = work / (src.stem + ".docx")
        code = "import sys;from pdf2docx import Converter;c=Converter(sys.argv[1]);c.convert(sys.argv[2]);c.close()"
        run(["python3", "-c", code, str(src), str(produced)], err="PDF tidak bisa diubah ke Word. File mungkin rusak atau terlalu rumit.")
    elif job_type == "compress_pdf":
        level = GS_LEVELS[options.get("level", "medium")]
        produced = work / "compressed.pdf"
        run(["gs", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5", f"-dPDFSETTINGS={level}", "-dNOPAUSE", "-dQUIET",
             "-dBATCH", "-dSAFER", f"-sOutputFile={produced}", str(src)], err="PDF tidak bisa dikompres. File mungkin rusak.")
    else:
        raise UserError("Jenis konversi tidak dikenal.")
    if not produced.exists() or produced.stat().st_size == 0:
        raise UserError("Konversi tidak menghasilkan file. File mungkin kosong atau rusak.")
    produced.replace(out)


def run_job(job_id: str):
    job = get_job(job_id)
    if not job:
        return
    update(job_id, status="processing")
    jdir = STORAGE / job_id
    try:
        expect, _, _ = JOBS[job["type"]]
        src = jdir / job["input_key"]
        validate_input(src, expect)
        out = jdir / job["output_key"]
        convert(job["type"], json.loads(job["options"]), src, out)
        src.unlink(missing_ok=True)  # input tidak perlu disimpan lagi
        update(job_id, status="done", expires_at=time.time() + TTL_SECONDS)
    except UserError as e:
        update(job_id, status="failed", error_message=str(e), expires_at=time.time() + 300)
    except Exception:  # jangan bocorkan detail internal; isi file tidak dicatat
        update(job_id, status="failed", error_message="Terjadi kesalahan di server. Coba lagi.", expires_at=time.time() + 300)


# ---------- pembersihan ----------
def cleanup_loop():
    while True:
        try:
            now = time.time()
            with _db_lock, db() as c:
                rows = c.execute("SELECT job_id FROM jobs WHERE expires_at < ?", (now,)).fetchall()
                for r in rows:
                    shutil.rmtree(STORAGE / r["job_id"], ignore_errors=True)
                    c.execute("DELETE FROM jobs WHERE job_id=?", (r["job_id"],))
        except Exception:
            pass
        time.sleep(60)


# ---------- rate limit ----------
_hits = defaultdict(deque)
_hits_lock = threading.Lock()


def client_ip(req: Request) -> str:
    if TRUST_PROXY:
        fwd = req.headers.get("cf-connecting-ip") or req.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if fwd:
            return fwd
    return req.client.host if req.client else "unknown"


def check_rate(ip: str):
    now = time.time()
    with _hits_lock:
        q = _hits[ip]
        while q and q[0] < now - 3600:
            q.popleft()
        if len(q) >= RATE_LIMIT:
            raise HTTPException(429, "Terlalu banyak proses dari alamat kamu. Coba lagi dalam beberapa menit.")
        q.append(now)


# ---------- app ----------
app = FastAPI(title="Konvertin API")
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["GET", "POST", "DELETE"], allow_headers=["*"])
pool = ThreadPoolExecutor(max_workers=WORKERS)


@app.on_event("startup")
def startup():
    init_db()
    threading.Thread(target=cleanup_loop, daemon=True).start()


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/jobs")
async def create_job(request: Request, type: str = Form(...), options: str = Form("{}"), file: UploadFile = File(...)):
    if type not in JOBS:
        raise HTTPException(400, "Jenis konversi tidak dikenal.")
    try:
        opts = json.loads(options)
        assert isinstance(opts, dict)
    except Exception:
        raise HTTPException(400, "Opsi tidak valid.")
    if type == "compress_pdf" and opts.get("level", "medium") not in GS_LEVELS:
        raise HTTPException(400, "Level kompres tidak valid.")
    check_rate(client_ip(request))

    job_id = uuid.uuid4().hex
    _, out_ext, _ = JOBS[type]
    jdir = STORAGE / job_id
    jdir.mkdir(parents=True)
    in_key, out_key = "in.bin", f"out.{out_ext}"
    size = 0
    with open(jdir / in_key, "wb") as f:  # nama asli tidak disimpan
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_MB * 1024 * 1024:
                f.close()
                shutil.rmtree(jdir, ignore_errors=True)
                raise HTTPException(413, f"File terlalu besar. Batas {MAX_MB} MB.")
            f.write(chunk)
    # ekstensi asli dipakai LibreOffice untuk mengenali format: salin dengan ekstensi sesuai tipe
    expect = JOBS[type][0]
    (jdir / in_key).rename(jdir / f"in.{expect}")
    in_key = f"in.{expect}"

    now = time.time()
    with _db_lock, db() as c:
        c.execute("INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)",
                  (job_id, type, json.dumps(opts), in_key, out_key, "queued", None, now, now + TTL_SECONDS))
    pool.submit(run_job, job_id)
    return {"job_id": job_id, "status": "queued"}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job tidak ditemukan atau sudah dihapus.")
    return {"job_id": job_id, "status": job["status"], "error_message": job["error_message"]}


@app.get("/api/jobs/{job_id}/download")
def download(job_id: str):
    job = get_job(job_id)
    if not job or job["status"] != "done":
        raise HTTPException(404, "Hasil belum ada atau sudah dihapus.")
    path = STORAGE / job_id / job["output_key"]
    if not path.exists():
        raise HTTPException(404, "Hasil sudah dihapus.")
    return FileResponse(path, media_type=JOBS[job["type"]][2], filename=job["output_key"])


@app.delete("/api/jobs/{job_id}")
def cancel(job_id: str):
    with _db_lock, db() as c:
        c.execute("DELETE FROM jobs WHERE job_id=?", (job_id,))
    shutil.rmtree(STORAGE / job_id, ignore_errors=True)
    return {"ok": True}
