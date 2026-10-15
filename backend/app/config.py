"""Konfigurasi. Semua bisa diubah lewat environment variable (prefix KONVERTIN_)."""
import os
from pathlib import Path


def _int(name: str, default: int) -> int:
    return int(os.environ.get(f"KONVERTIN_{name}", default))


DATA_DIR = Path(os.environ.get("KONVERTIN_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
STORAGE_DIR = DATA_DIR / "storage"
DB_PATH = DATA_DIR / "jobs.sqlite3"

# Batas tier gratis (PRD bagian 6)
MAX_DOC_BYTES = _int("MAX_DOC_MB", 25) * 1024 * 1024
MAX_PDF_PAGES = _int("MAX_PDF_PAGES", 200)
MAX_UNZIPPED_BYTES = _int("MAX_UNZIPPED_MB", 300) * 1024 * 1024  # anti zip bomb
MAX_ZIP_RATIO = 200

# Job
JOB_TIMEOUT_SEC = _int("JOB_TIMEOUT_SEC", 120)
JOB_MEMORY_MB = _int("JOB_MEMORY_MB", 2048)
WORKERS = _int("WORKERS", 2)
FILE_TTL_SEC = _int("FILE_TTL_SEC", 3600)  # hapus maks 1 jam
CLEANUP_INTERVAL_SEC = _int("CLEANUP_INTERVAL_SEC", 60)

# Rate limit per IP (PRD bagian 11)
RATE_LIMIT_JOBS = _int("RATE_LIMIT_JOBS", 20)
RATE_LIMIT_WINDOW_SEC = _int("RATE_LIMIT_WINDOW_SEC", 3600)

# CORS: frontend statis di domain lain (mis. Cloudflare Pages), pisahkan dengan koma
CORS_ORIGINS = [o for o in os.environ.get("KONVERTIN_CORS_ORIGINS", "").split(",") if o]
SESSION_COOKIE_SECURE = os.environ.get("KONVERTIN_SESSION_COOKIE_SECURE", "1") != "0"
SESSION_TTL_SEC = _int("SESSION_TTL_SEC", 14 * 24 * 3600)
HISTORY_TTL_SEC = _int("HISTORY_TTL_SEC", 365 * 24 * 3600)
ADMIN_EMAIL = os.environ.get("KONVERTIN_ADMIN_EMAIL", "").strip().lower()
ADMIN_PASSWORD = os.environ.get("KONVERTIN_ADMIN_PASSWORD", "")

FRONTEND_DIR = Path(os.environ.get("KONVERTIN_FRONTEND_DIR", Path(__file__).resolve().parents[2] / "frontend"))
