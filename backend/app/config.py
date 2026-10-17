"""Konfigurasi. Semua bisa diubah lewat environment variable (prefix KONVERTIN_)."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)


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
ADMIN_EMAIL = os.environ.get("KONVERTIN_ADMIN_EMAIL", "admin@konvertin.com").strip().lower()
ADMIN_PASSWORD = os.environ.get("KONVERTIN_ADMIN_PASSWORD", "")
ADMIN_NAME = os.environ.get("KONVERTIN_ADMIN_NAME", "Admin Konvertin").strip() or "Admin Konvertin"
MAX_STAFF_ADMINS = 7
SUPERADMIN_EMAILS = frozenset({"setara.sea@gmail.com", "kartikafajar13@gmail.com"})
GOOGLE_CLIENT_ID = os.environ.get("KONVERTIN_GOOGLE_CLIENT_ID", "").strip()
GOOGLE_CLIENT_SECRET = os.environ.get("KONVERTIN_GOOGLE_CLIENT_SECRET", "")
MIDTRANS_SERVER_KEY = os.environ.get("KONVERTIN_MIDTRANS_SERVER_KEY", "")
MIDTRANS_CLIENT_KEY = os.environ.get("KONVERTIN_MIDTRANS_CLIENT_KEY", "")
MIDTRANS_IS_PRODUCTION = os.environ.get("KONVERTIN_MIDTRANS_IS_PRODUCTION", "0") == "1"
XENDIT_WEBHOOK_TOKEN = os.environ.get("KONVERTIN_XENDIT_WEBHOOK_TOKEN", "")
GOOGLE_CALLBACK_PATH = "/api/auth/google/callback"


def normalize_public_base_url(value: str) -> str:
    value = value.rstrip("/")
    if value.endswith(GOOGLE_CALLBACK_PATH):
        value = value[:-len(GOOGLE_CALLBACK_PATH)]
    return value.rstrip("/")


PUBLIC_BASE_URL = normalize_public_base_url(os.environ.get("KONVERTIN_PUBLIC_BASE_URL", ""))
SMTP_HOST = os.environ.get("KONVERTIN_SMTP_HOST", "").strip()
SMTP_PORT = _int("SMTP_PORT", 587)
SMTP_USERNAME = os.environ.get("KONVERTIN_SMTP_USERNAME", "")
SMTP_PASSWORD = os.environ.get("KONVERTIN_SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = os.environ.get("KONVERTIN_SMTP_FROM_EMAIL", "").strip()
SMTP_FROM_NAME = os.environ.get("KONVERTIN_SMTP_FROM_NAME", "Konvertin").strip() or "Konvertin"
SMTP_USE_SSL = os.environ.get("KONVERTIN_SMTP_USE_SSL", "0") == "1"
SMTP_STARTTLS = os.environ.get("KONVERTIN_SMTP_STARTTLS", "1") != "0"

FRONTEND_DIR = Path(os.environ.get("KONVERTIN_FRONTEND_DIR", Path(__file__).resolve().parents[2] / "frontend"))
