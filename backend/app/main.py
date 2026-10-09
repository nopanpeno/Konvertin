import json
import tempfile
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, jobs, ratelimit
from .errors import ConvertError
from .validation import CONVERSIONS, KIND_LABEL, detect_kind, validate_upload

_stop = threading.Event()


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    jobs.init()
    t = threading.Thread(target=jobs.cleanup_loop, args=(_stop,), daemon=True)
    t.start()
    yield
    _stop.set()
    jobs.shutdown()


app = FastAPI(title="Konvertin API", version="0.1.0", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")

if config.CORS_ORIGINS:
    app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["GET", "POST", "DELETE"], allow_headers=["*"])


@app.exception_handler(ConvertError)
async def convert_error_handler(request: Request, exc: ConvertError):
    return JSONResponse({"error": exc.message}, status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    return JSONResponse({"error": "Permintaan tidak lengkap. Pilih file dan jenis konversi."}, status_code=422)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return fwd or (request.client.host if request.client else "unknown")


def _public(row) -> dict:
    d = {"job_id": row["job_id"], "type": row["type"], "status": row["status"]}
    if row["status"] == "failed":
        d["error"] = row["error_message"]
    if row["status"] == "done":
        d["download_url"] = f"/api/jobs/{row['job_id']}/download"
        d["download_name"] = row["download_name"]
        d["expires_at"] = row["expires_at"]
    return d


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/conversions")
def conversions():
    """Daftar konversi dokumen yang valid, dikelompokkan per tipe input."""
    out: dict[str, list] = {}
    for jt, (src, dst, _) in CONVERSIONS.items():
        out.setdefault(src, []).append({"type": jt, "output": dst})
    return {"conversions": out, "max_mb": config.MAX_DOC_BYTES // 1024 // 1024, "max_pages": config.MAX_PDF_PAGES}


@app.post("/api/detect")
async def detect(file: UploadFile = File(...)):
    """Deteksi tipe file dari isinya dan tawarkan format tujuan yang valid."""
    tmp = await _save_upload(file)
    try:
        kind = detect_kind(tmp)
    finally:
        tmp.unlink(missing_ok=True)
    if kind is None:
        raise ConvertError("Format file tidak didukung. Saat ini yang bisa: PDF, DOCX, PPTX, XLSX.")
    return {"kind": kind, "label": KIND_LABEL[kind], "options": [{"type": jt, "output": v[1]} for jt, v in CONVERSIONS.items() if v[0] == kind]}


async def _save_upload(file: UploadFile) -> Path:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    fd = tempfile.NamedTemporaryFile(dir=config.DATA_DIR, prefix="up_", delete=False)
    size = 0
    limit = config.MAX_DOC_BYTES
    try:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                raise ConvertError(f"File lebih besar dari {limit // 1024 // 1024} MB (batas dokumen tier gratis).", 413)
            fd.write(chunk)
    except BaseException:
        fd.close()
        Path(fd.name).unlink(missing_ok=True)
        raise
    fd.close()
    return Path(fd.name)


@app.post("/api/jobs", status_code=202)
async def create_job(request: Request, file: UploadFile = File(...), type: str = Form(...), options: str = Form("{}")):
    if type not in CONVERSIONS:
        raise ConvertError("Jenis konversi tidak dikenal.")
    if not ratelimit.allow(_client_ip(request)):
        raise ConvertError("Terlalu banyak konversi dari koneksi ini. Tunggu beberapa saat lalu coba lagi.", 429)
    try:
        opts = json.loads(options)
        if not isinstance(opts, dict):
            raise ValueError
    except ValueError:
        raise ConvertError("Opsi konversi tidak valid.")
    tmp = await _save_upload(file)
    try:
        validate_upload(tmp, type)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    job_id = jobs.create(type, tmp, file.filename or "dokumen", opts)
    return {"job_id": job_id, "status": "queued", "status_url": f"/api/jobs/{job_id}"}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    row = jobs.get(job_id)
    if row is None:
        raise ConvertError("Job tidak ditemukan atau sudah dihapus (file dihapus otomatis setelah 1 jam).", 404)
    return _public(row)


@app.get("/api/jobs/{job_id}/download")
def job_download(job_id: str):
    row = jobs.get(job_id)
    if row is None or row["status"] != "done" or not row["output_key"]:
        raise ConvertError("Hasil tidak tersedia. Mungkin sudah dihapus otomatis atau belum selesai.", 404)
    path = config.STORAGE_DIR / row["output_key"]
    if not path.exists():
        raise ConvertError("Hasil sudah dihapus. Konversi ulang filenya.", 404)
    mime = CONVERSIONS[row["type"]][2]
    return FileResponse(path, media_type=mime, filename=row["download_name"], headers={"Cache-Control": "no-store"})


@app.delete("/api/jobs/{job_id}")
def job_cancel(job_id: str):
    if not jobs.cancel(job_id):
        raise ConvertError("Job tidak ditemukan.", 404)
    return {"ok": True}


# Frontend statis (untuk dev / satu server). Di produksi bisa di Cloudflare Pages.
if config.FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")
