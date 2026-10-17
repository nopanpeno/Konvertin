import json
import calendar
from decimal import Decimal, InvalidOperation
import shutil
import secrets
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import accounts, billing, config, google_auth, jobs, mail, ratelimit
from .errors import ConvertError
from .validation import COMPRESS_JOB, CONVERSIONS, KIND_LABEL, check_options, detect_kind, validate_upload

_stop = threading.Event()


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    accounts.init()
    jobs.init()
    t = threading.Thread(target=jobs.cleanup_loop, args=(_stop,), daemon=True)
    t.start()
    yield
    _stop.set()
    jobs.shutdown()


app = FastAPI(title="Konvertin API", version="0.1.0", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")

if config.CORS_ORIGINS:
    app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["*"])


@app.middleware("http")
async def block_dotenv_files(request: Request, call_next):
    if any(part == ".env" or part.startswith(".env.") for part in request.url.path.split("/")):
        return JSONResponse({"error": "Not found."}, status_code=404)
    return await call_next(request)


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


def _account_user(request: Request, admin: bool = False):
    user = accounts.current_user(request)
    if user is None:
        raise ConvertError("Silakan masuk untuk melanjutkan.", 401)
    if admin and user["role"] not in ("admin", "superadmin"):
        raise ConvertError("Akses admin diperlukan.", 403)
    return user


def _superadmin_user(request: Request):
    user = _account_user(request, admin=True)
    if user["role"] != "superadmin":
        raise ConvertError("Fitur ini hanya tersedia untuk admin pusat.", 403)
    return user


def _same_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin:
        from urllib.parse import urlsplit
        parsed = urlsplit(origin)
        if parsed.netloc.lower() != request.headers.get("host", "").lower():
            raise ConvertError("Permintaan lintas situs ditolak.", 403)


def _user_json(user):
    return {
        "id": user["user_id"], "email": user["email"], "display_name": user["display_name"],
        "phone": user["phone"], "email_verified": bool(user["email_verified"]), "role": user["role"],
    }


def _has_feature(tool_type: str) -> bool:
    return accounts.settings().get(f"feature:{tool_type}", "1") == "1"


def _quota(user) -> dict | None:
    if user is None:
        return None
    return accounts.account_summary(user["user_id"])["quota"]


def _file_limit(user) -> int:
    if user is None:
        return config.MAX_DOC_BYTES
    summary = accounts.account_summary(user["user_id"])
    return min(summary["quota"]["max_file_mb"] * 1024 * 1024, config.MAX_DOC_BYTES)


def _user_by_id(user_id: int):
    with accounts._db() as c:
        return c.execute("""SELECT user_id,email,display_name,phone,email_verified,role
            FROM users WHERE user_id=?""", (user_id,)).fetchone()


def _set_session(response, token: str):
    response.set_cookie(accounts.COOKIE, token, max_age=config.SESSION_TTL_SEC,
                        httponly=True, secure=config.SESSION_COOKIE_SECURE,
                        samesite="lax", path="/")


async def _body(request: Request):
    try:
        data = await request.json()
        if not isinstance(data, dict):
            raise ValueError
        return data
    except (ValueError, json.JSONDecodeError):
        raise ConvertError("Isi permintaan tidak valid.")


def _require_job_access(row, request: Request) -> None:
    user = accounts.current_user(request)
    if row["user_id"] is not None and (
        user is None or (user["user_id"] != row["user_id"] and user["role"] not in ("admin", "superadmin"))
    ):
        raise ConvertError("Akses job tidak diizinkan.", 403)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/auth/register", status_code=201)
async def register(request: Request):
    _same_origin(request)
    if not ratelimit.allow_auth(_client_ip(request)):
        raise ConvertError("Terlalu banyak percobaan masuk atau daftar. Coba lagi nanti.", 429)
    if not mail.configured():
        raise ConvertError("Pendaftaran memerlukan konfigurasi email SMTP dan URL publik pada server.", 503)
    data = await _body(request)
    user_id, error = accounts.create_user(
        str(data.get("email", "")), str(data.get("password", "")),
        str(data.get("display_name", "")), str(data.get("phone", "")),
    )
    if error:
        raise ConvertError(error, 409 if "terdaftar" in error else 400)
    identity = accounts.verification_identity(user_id)
    token = accounts.issue_email_verification(user_id)
    verification_url = (
        f"{config.PUBLIC_BASE_URL}/api/auth/verify-email?token={token}"
    )
    try:
        mail.send_verification(identity["email"], identity["display_name"], verification_url)
    except mail.EmailDeliveryError as exc:
        raise ConvertError(
            "Akun dibuat, tetapi email verifikasi gagal dikirim. Coba kirim ulang setelah admin memeriksa SMTP.",
            502,
        ) from exc
    return JSONResponse(
        {"message": "Pendaftaran berhasil. Buka email untuk memverifikasi akun sebelum masuk."},
        status_code=202,
    )


@app.get("/api/auth/verify-email")
def verify_email(token: str):
    if len(token) > 200 or not accounts.verify_email_token(token):
        raise ConvertError("Tautan verifikasi tidak valid atau sudah kedaluwarsa.", 400)
    return RedirectResponse(f"{config.PUBLIC_BASE_URL}/akun.html?verified=1", status_code=303)


@app.post("/api/auth/verification/resend")
async def resend_verification(request: Request):
    _same_origin(request)
    if not ratelimit.allow_auth(_client_ip(request)):
        raise ConvertError("Terlalu banyak permintaan. Coba lagi nanti.", 429)
    if not mail.configured():
        raise ConvertError("Pengiriman email belum dikonfigurasi pada server.", 503)
    data = await _body(request)
    identity = accounts.unverified_user_by_email(str(data.get("email", "")))
    if identity is None:
        return {"message": "Jika akun aktif dan belum terverifikasi, email verifikasi akan dikirim."}
    token = accounts.issue_email_verification(identity["user_id"])
    url = f"{config.PUBLIC_BASE_URL}/api/auth/verify-email?token={token}"
    try:
        mail.send_verification(identity["email"], identity["display_name"], url)
    except mail.EmailDeliveryError as exc:
        raise ConvertError("Email verifikasi gagal dikirim. Admin perlu memeriksa SMTP.", 502) from exc
    return {"message": "Email verifikasi dikirim ulang. Periksa inbox dan folder spam."}


@app.post("/api/auth/login")
async def login(request: Request):
    _same_origin(request)
    if not ratelimit.allow_auth(_client_ip(request)):
        raise ConvertError("Terlalu banyak percobaan masuk atau daftar. Coba lagi nanti.", 429)
    data = await _body(request)
    email = str(data.get("email", "")).strip().lower()
    if email == config.ADMIN_EMAIL and not config.ADMIN_PASSWORD:
        raise ConvertError(
            "Login admin bawahan belum diaktifkan. Atur KONVERTIN_ADMIN_PASSWORD di environment server, lalu mulai ulang backend.",
            503,
        )
    row = accounts.authenticate(email, str(data.get("password", "")))
    if row is None:
        pending = accounts.authenticate_unverified(email, str(data.get("password", "")))
        if pending is not None:
            raise ConvertError("Verifikasi email terlebih dahulu sebelum masuk.", 403)
        raise ConvertError("Email atau password salah.", 401)
    if row["role"] == "admin":
        accounts.audit(row["user_id"], "admin.login", row["email"], "password")
    token = accounts.new_session(row["user_id"])
    response = JSONResponse({"user": _user_json(row)})
    _set_session(response, token)
    return response


@app.get("/api/auth/google")
def google_login():
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(48)
    nonce = secrets.token_urlsafe(32)
    try:
        url = google_auth.authorization_url(state, verifier, nonce)
    except ValueError as exc:
        raise ConvertError(str(exc), 503) from exc
    response = RedirectResponse(url, status_code=302)
    response.set_cookie("konvertin_google_state", state, max_age=600, httponly=True,
                        secure=config.SESSION_COOKIE_SECURE, samesite="lax", path="/api/auth/google")
    response.set_cookie("konvertin_google_verifier", verifier, max_age=600,
                        httponly=True, secure=config.SESSION_COOKIE_SECURE, samesite="lax",
                        path="/api/auth/google")
    response.set_cookie("konvertin_google_nonce", nonce, max_age=600,
                        httponly=True, secure=config.SESSION_COOKIE_SECURE, samesite="lax",
                        path="/api/auth/google")
    return response


@app.get("/api/auth/google/callback")
def google_callback(request: Request, code: str = "", state: str = "", error: str = ""):
    from hmac import compare_digest

    expected_state = request.cookies.get("konvertin_google_state", "")
    verifier = request.cookies.get("konvertin_google_verifier", "")
    nonce = request.cookies.get("konvertin_google_nonce", "")
    if error or not code or not state or not expected_state or not compare_digest(state, expected_state) or not verifier or not nonce:
        raise ConvertError("Login Google dibatalkan atau sesi OAuth tidak valid. Coba lagi.", 400)
    try:
        identity = google_auth.verify_authorization_code(code, verifier, nonce)
    except ValueError as exc:
        raise ConvertError(str(exc), 401) from exc
    user = accounts.google_account(identity["email"], identity["display_name"])
    if user is None:
        raise ConvertError("Akun Google diblokir atau batas admin bawahan sudah tercapai.", 403)
    if user["role"] in ("admin", "superadmin"):
        accounts.audit(user["user_id"], "admin.google.login", user["email"], "google_oidc")
    destination = "/admin.html" if user["role"] in ("admin", "superadmin") else "/profil.html"
    response = RedirectResponse(f"{config.PUBLIC_BASE_URL}{destination}", status_code=303)
    response.delete_cookie("konvertin_google_state", path="/api/auth/google")
    response.delete_cookie("konvertin_google_verifier", path="/api/auth/google")
    response.delete_cookie("konvertin_google_nonce", path="/api/auth/google")
    _set_session(response, accounts.new_session(user["user_id"]))
    response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/api/auth/logout")
def logout(request: Request):
    _same_origin(request)
    user = accounts.current_user(request)
    if user and user["role"] in ("admin", "superadmin"):
        accounts.audit(user["user_id"], "admin.logout", user["email"])
    accounts.delete_session(request.cookies.get(accounts.COOKIE))
    response = JSONResponse({"ok": True})
    response.delete_cookie(accounts.COOKIE, path="/", httponly=True, secure=config.SESSION_COOKIE_SECURE, samesite="lax")
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/auth/me")
def me(request: Request):
    user = accounts.current_user(request)
    return {"user": _user_json(user) if user else None}


@app.patch("/api/auth/profile")
async def profile(request: Request):
    _same_origin(request)
    user = _account_user(request)
    data = await _body(request)
    ok, error = accounts.update_account_profile(
        user["user_id"], str(data.get("display_name", "")),
        str(data["phone"]) if "phone" in data else None,
    )
    if not ok:
        raise ConvertError(error, 409 if "dipakai" in error else 400)
    row = _user_by_id(user["user_id"])
    return {"user": _user_json(row)}


@app.patch("/api/auth/password")
async def password(request: Request):
    _same_origin(request)
    user = _account_user(request)
    data = await _body(request)
    current = str(data.get("current_password", ""))
    new = str(data.get("new_password", ""))
    ok, error = accounts.change_password(user["user_id"], current, new, request.cookies.get(accounts.COOKIE))
    if not ok:
        raise ConvertError(error or "Password tidak dapat diperbarui.", 400)
    return {"ok": True, "message": "Password diperbarui. Sesi lain sudah dikeluarkan."}


@app.get("/api/notifications")
def get_notifications(request: Request):
    user = _account_user(request)
    return {"notifications": accounts.user_notifications(user["user_id"])}


@app.patch("/api/notifications/{notification_id}")
def mark_notification_read(notification_id: int, request: Request):
    _same_origin(request)
    user = _account_user(request)
    if not accounts.mark_notification_read(user["user_id"], notification_id):
        raise ConvertError("Notifikasi tidak ditemukan.", 404)
    return {"ok": True}


@app.get("/api/history")
def get_history(request: Request):
    user = _account_user(request)
    history_rows = []
    for row in accounts.history(user["user_id"]):
        item = dict(row)
        available = bool(item["job_id"] and item["status"] == "done" and item["output_key"]
                         and item["expires_at"] and item["expires_at"] > time.time()
                         and (config.STORAGE_DIR / item["output_key"]).is_file())
        item["download_url"] = f"/api/jobs/{item['job_id']}/download" if available else None
        item.pop("output_key", None)
        item.pop("expires_at", None)
        history_rows.append(item)
    return {"history": history_rows}


@app.delete("/api/history")
def clear_history(request: Request):
    _same_origin(request)
    user = _account_user(request)
    rows = accounts.history(user["user_id"], limit=10000)
    job_ids = [row["job_id"] for row in rows if row["job_id"]]
    for job_id in job_ids:
        jobs.cancel(job_id)
    with accounts._db() as c:
        c.execute("DELETE FROM conversion_history WHERE user_id=?", (user["user_id"],))
    return {"ok": True, "deleted": len(rows)}


@app.delete("/api/history/{history_id}")
def delete_history_item(history_id: int, request: Request):
    _same_origin(request)
    user = _account_user(request)
    with accounts._db() as c:
        row = c.execute("SELECT job_id FROM conversion_history WHERE history_id=? AND user_id=?",
                        (history_id, user["user_id"])).fetchone()
        if row is None:
            raise ConvertError("Riwayat tidak ditemukan.", 404)
        job_id = row["job_id"]
    if job_id:
        jobs.cancel(job_id)
    with accounts._db() as c:
        c.execute("DELETE FROM conversion_history WHERE history_id=? AND user_id=?",
                  (history_id, user["user_id"]))
    return {"ok": True}


@app.post("/api/history/browser", status_code=201)
async def record_browser_history(request: Request):
    _same_origin(request)
    if not ratelimit.allow_usage(_client_ip(request)):
        raise ConvertError("Terlalu banyak catatan penggunaan.", 429)
    data = await _body(request)
    tool_type = str(data.get("tool_type", ""))
    if tool_type not in accounts.BROWSER_TOOL_TYPES:
        raise ConvertError("Jenis tool tidak valid.")
    user = accounts.current_user(request)
    if not _has_feature(tool_type):
        raise ConvertError("Tool ini sedang dinonaktifkan sementara.", 503)
    quota = _quota(user)
    if quota and quota["remaining_today"] < 1:
        raise ConvertError("Kuota konversi harian akunmu sudah habis.", 429)
    accounts.record_browser_usage(user["user_id"] if user else None, tool_type)
    return {"ok": True}


@app.get("/api/usage/check")
def check_usage(request: Request, tool_type: str, count: int = 1):
    valid = set(accounts.BROWSER_TOOL_TYPES) | set(CONVERSIONS)
    if tool_type not in valid:
        raise ConvertError("Jenis tool tidak valid.")
    if count < 1 or count > 10:
        raise ConvertError("Jumlah konversi harus antara 1 dan 10.")
    if not _has_feature(tool_type):
        raise ConvertError("Tool ini sedang dinonaktifkan sementara.", 503)
    user = accounts.current_user(request)
    quota = _quota(user)
    if quota and quota["remaining_today"] < count:
        raise ConvertError("Kuota konversi harian akunmu sudah habis.", 429)
    return {"allowed": True, "quota": quota}


@app.get("/api/admin/usage")
def admin_usage(request: Request, days: int = 30):
    _account_user(request, admin=True)
    if days not in (7, 30, 90):
        raise ConvertError("Rentang waktu harus 7, 30, atau 90 hari.")
    return accounts.usage(days)


@app.get("/api/admin/dashboard")
def admin_dashboard(request: Request, days: int = 30):
    user = _account_user(request, admin=True)
    if days not in (7, 30, 90):
        raise ConvertError("Rentang waktu harus 7, 30, atau 90 hari.")
    disk = shutil.disk_usage(config.STORAGE_DIR)
    storage = sum(path.stat().st_size for path in config.STORAGE_DIR.iterdir() if path.is_file())
    data = accounts.admin_overview(days)
    data["system"] = {
        "storage_used_bytes": storage,
        "storage_available_bytes": disk.free,
        "storage_total_bytes": disk.total,
        "max_file_mb": config.MAX_DOC_BYTES // 1048576,
        "max_pdf_pages": config.MAX_PDF_PAGES,
        "worker_count": config.WORKERS,
        "queue": data["jobs"].get("queued", 0),
        "processing": data["jobs"].get("processing", 0),
    }
    if user["role"] != "superadmin":
        data.pop("revenue_last_30_days", None)
        data.pop("premium_customers", None)
        data.pop("staff_admins", None)
    accounts.audit(user["user_id"], "admin.dashboard.view", "dashboard", f"days={days}")
    return data


@app.get("/api/admin/users")
def admin_users(request: Request, search: str = "", limit: int = 50, offset: int = 0):
    _account_user(request, admin=True)
    return {"users": accounts.admin_user_list(search, limit, offset)}


@app.get("/api/admin/users/{user_id}")
def admin_user_detail(user_id: int, request: Request):
    _superadmin_user(request)
    detail = accounts.admin_user_detail(user_id)
    if detail is None or detail["user"]["role"] != "user":
        raise ConvertError("Akun user tidak ditemukan.", 404)
    return detail


@app.patch("/api/admin/users/{user_id}")
async def admin_update_user(user_id: int, request: Request):
    _same_origin(request)
    admin = _superadmin_user(request)
    data = await _body(request)
    allowed = {"status", "email_notifications"}
    if not data or any(key not in allowed for key in data):
        raise ConvertError("Perubahan akun tidak valid.")
    status = data.get("status")
    notifications = data.get("email_notifications")
    if status is not None and status not in ("active", "suspended"):
        raise ConvertError("Status akun harus active atau suspended.")
    if notifications is not None and not isinstance(notifications, bool):
        raise ConvertError("Preferensi email harus bernilai true atau false.")
    with accounts._db() as c:
        target = c.execute("SELECT role,email,status FROM users WHERE user_id=?", (user_id,)).fetchone()
        if target is None:
            raise ConvertError("Akun tidak ditemukan.", 404)
        if target["role"] in ("admin", "superadmin") or user_id == admin["user_id"]:
            raise ConvertError("Akun admin tidak dapat dibatasi melalui pengelolaan user.", 403)
        if status is not None:
            c.execute("UPDATE users SET status=? WHERE user_id=?", (status, user_id))
        if status == "suspended":
            c.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        if notifications is not None:
            row = c.execute("SELECT preferences FROM user_preferences WHERE user_id=?", (user_id,)).fetchone()
            preferences = json.loads(row["preferences"]) if row else {
                "email_notifications": True, "product_updates": True,
            }
            preferences["email_notifications"] = notifications
            c.execute("""INSERT INTO user_preferences(user_id,preferences,updated_at) VALUES(?,?,?)
                ON CONFLICT(user_id) DO UPDATE SET preferences=excluded.preferences,updated_at=excluded.updated_at""",
                      (user_id, json.dumps(preferences), time.time()))
    accounts.audit(admin["user_id"], "user.account.update", str(user_id), json.dumps(data))
    return {"user_id": user_id, "status": status, "email_notifications": notifications}


@app.post("/api/admin/users/{user_id}/notifications", status_code=201)
async def admin_notify_user(user_id: int, request: Request):
    _same_origin(request)
    admin = _superadmin_user(request)
    data = await _body(request)
    title = str(data.get("title", "")).strip()
    message = str(data.get("message", "")).strip()
    kind = data.get("kind", "warning")
    if (
        not title or len(title) > 120 or "\n" in title or "\r" in title
        or not message or len(message) > 3000
        or kind not in ("info", "warning", "critical")
    ):
        raise ConvertError("Isi notifikasi atau jenis peringatan tidak valid.")
    with accounts._db() as c:
        target = c.execute("""SELECT user_id,email,display_name,role,email_verified
            FROM users WHERE user_id=?""", (user_id,)).fetchone()
    if target is None or target["role"] != "user":
        raise ConvertError("Akun user tidak ditemukan.", 404)
    with accounts._db() as c:
        preference = c.execute("SELECT preferences FROM user_preferences WHERE user_id=?", (user_id,)).fetchone()
    preferences = json.loads(preference["preferences"]) if preference else {"email_notifications": True}
    notification_id = accounts.add_notification(user_id, kind, title, message)
    email_status = "disabled"
    email_error = None
    if target["email_verified"] and bool(preferences.get("email_notifications", True)):
        if not mail.configured():
            email_status = "not_configured"
        else:
            try:
                mail.send_account_notice(target["email"], target["display_name"], title, message)
                email_status = "sent"
            except mail.EmailDeliveryError as exc:
                email_status = "failed"
                email_error = str(exc)
    accounts.audit(admin["user_id"], "user.notification.create", str(user_id),
                   json.dumps({"notification_id": notification_id, "kind": kind, "email_status": email_status}))
    return {
        "notification_id": notification_id, "email_status": email_status, "email_error": email_error,
        "message": "Notifikasi tersimpan untuk ditampilkan pada dashboard user.",
    }


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: int, request: Request):
    _same_origin(request)
    admin = _superadmin_user(request)
    with accounts._db() as c:
        target = c.execute("SELECT role,email FROM users WHERE user_id=?", (user_id,)).fetchone()
    if user_id == admin["user_id"]:
        raise ConvertError("Admin tidak dapat menghapus akunnya sendiri.", 403)
    if target is None or target["role"] != "user":
        raise ConvertError("Akun user tidak ditemukan.", 404)

    with jobs._db() as c:
        job_ids = [row["job_id"] for row in c.execute("SELECT job_id FROM jobs WHERE user_id=?", (user_id,))]
    for job_id in job_ids:
        jobs.cancel(job_id)

    with accounts._db() as c:
        c.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        c.execute("DELETE FROM email_verification_tokens WHERE user_id=?", (user_id,))
        c.execute("DELETE FROM conversion_history WHERE user_id=?", (user_id,))
        c.execute("UPDATE usage_events SET user_id=NULL WHERE user_id=?", (user_id,))
        c.execute("DELETE FROM user_notifications WHERE user_id=?", (user_id,))
        c.execute("DELETE FROM support_tickets WHERE user_id=?", (user_id,))
        c.execute("DELETE FROM user_preferences WHERE user_id=?", (user_id,))
        c.execute("DELETE FROM subscriptions WHERE user_id=?", (user_id,))
        c.execute("""UPDATE payments SET user_id=0,subscription_id=NULL,
            external_id='deleted-' || lower(hex(randomblob(16))),
            provider_id=NULL,invoice_url=NULL WHERE user_id=?""", (user_id,))
        c.execute("DELETE FROM jobs WHERE user_id=?", (user_id,))
        c.execute("DELETE FROM users WHERE user_id=?", (user_id,))
    accounts.audit(admin["user_id"], "user.account.delete", str(user_id),
                   "Identitas, riwayat, tiket, notifikasi, dan file dihapus; transaksi dianonimkan.")
    return {"ok": True, "user_id": user_id, "payments_anonymized": True}


@app.get("/api/admin/jobs")
def admin_job_list(request: Request, limit: int = 100):
    _account_user(request, admin=True)
    return {"jobs": accounts.admin_jobs(limit)}


@app.delete("/api/admin/jobs/{job_id}")
def admin_cancel_job(job_id: str, request: Request):
    _same_origin(request)
    admin = _superadmin_user(request)
    row = jobs.get(job_id)
    if row is None:
        raise ConvertError("Job tidak ditemukan.", 404)
    jobs.cancel(job_id)
    accounts.audit(admin["user_id"], "job.cancel", job_id, row["status"])
    return {"ok": True}


@app.get("/api/admin/operations")
def admin_operations(request: Request):
    _account_user(request, admin=True)
    features = []
    for tool_type, (source, target, _mime) in CONVERSIONS.items():
        features.append({"type": tool_type, "source": source, "target": target, "enabled": _has_feature(tool_type)})
    for tool_type in sorted(accounts.BROWSER_TOOL_TYPES):
        features.append({"type": tool_type, "source": "browser", "target": "browser", "enabled": _has_feature(tool_type)})
    return {
        "settings": accounts.settings(),
        "plans": accounts.plans(),
        "features": features,
        "limits": {"server_max_file_mb": config.MAX_DOC_BYTES // 1048576, "max_pdf_pages": config.MAX_PDF_PAGES},
    }


@app.patch("/api/admin/settings")
async def admin_update_settings(request: Request):
    _same_origin(request)
    admin = _superadmin_user(request)
    data = await _body(request)
    allowed = {"free_daily_quota", "premium_daily_quota", "free_max_file_mb", "premium_max_file_mb"}
    if not data or any(key not in allowed for key in data):
        raise ConvertError("Pengaturan layanan tidak valid.")
    parsed = {}
    for key, value in data.items():
        if isinstance(value, bool):
            raise ConvertError("Nilai batas harus berupa angka bulat.")
        try:
            number = int(value)
        except (TypeError, ValueError):
            raise ConvertError("Nilai batas harus berupa angka bulat.")
        upper = config.MAX_DOC_BYTES // 1048576 if key.endswith("max_file_mb") else 100000
        if number < 1 or number > upper:
            raise ConvertError(f"Nilai {key} harus di antara 1 dan {upper}.")
        parsed[key] = str(number)
    with accounts._db() as c:
        c.executemany("""INSERT INTO site_settings(setting_key,setting_value) VALUES(?,?)
            ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value""", parsed.items())
    accounts.audit(admin["user_id"], "settings.update", "usage-limits", json.dumps(parsed))
    return {"settings": accounts.settings()}


@app.patch("/api/admin/features/{tool_type}")
async def admin_update_feature(tool_type: str, request: Request):
    _same_origin(request)
    admin = _superadmin_user(request)
    valid = set(CONVERSIONS) | set(accounts.BROWSER_TOOL_TYPES)
    if tool_type not in valid:
        raise ConvertError("Tool tidak ditemukan.", 404)
    data = await _body(request)
    if not isinstance(data.get("enabled"), bool):
        raise ConvertError("Status fitur harus berupa true atau false.")
    value = "1" if data["enabled"] else "0"
    with accounts._db() as c:
        c.execute("""INSERT INTO site_settings(setting_key,setting_value) VALUES(?,?)
            ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value""",
                  (f"feature:{tool_type}", value))
    accounts.audit(admin["user_id"], "feature.status.update", tool_type, value)
    return {"type": tool_type, "enabled": data["enabled"]}


@app.patch("/api/admin/plans/{plan_id}")
async def admin_update_plan(plan_id: str, request: Request):
    _same_origin(request)
    admin = _superadmin_user(request)
    data = await _body(request)
    allowed = {"name", "price", "active", "features"}
    if not data or any(key not in allowed for key in data):
        raise ConvertError("Data paket tidak valid.")
    with accounts._db() as c:
        plan = c.execute("SELECT * FROM plans WHERE plan_id=?", (plan_id,)).fetchone()
        if plan is None:
            raise ConvertError("Paket tidak ditemukan.", 404)
        name = str(data.get("name", plan["name"])).strip()
        price = data.get("price", plan["price"])
        active = data.get("active", bool(plan["active"]))
        features = data.get("features", json.loads(plan["features"]))
        if not name or len(name) > 80 or isinstance(price, bool) or not isinstance(price, int) or price < 0 or price > 1000000000:
            raise ConvertError("Nama paket atau harga tidak valid.")
        if not isinstance(active, bool) or not isinstance(features, list) or len(features) > 20 or any(not isinstance(x, str) or len(x) > 120 for x in features):
            raise ConvertError("Status atau daftar fasilitas paket tidak valid.")
        c.execute("UPDATE plans SET name=?,price=?,active=?,features=?,updated_at=? WHERE plan_id=?",
                  (name, price, int(active), json.dumps(features), time.time(), plan_id))
    accounts.audit(admin["user_id"], "plan.update", plan_id, json.dumps({"name": name, "price": price, "active": active}))
    return {"plans": accounts.plans()}


@app.get("/api/admin/payments")
def admin_payment_list(request: Request, limit: int = 100):
    _superadmin_user(request)
    return {"payments": accounts.admin_payments(limit)}


@app.patch("/api/admin/subscriptions/{user_id}")
async def admin_update_subscription(user_id: int, request: Request):
    _same_origin(request)
    admin = _superadmin_user(request)
    data = await _body(request)
    status = data.get("status")
    if status not in ("active", "cancelled", "suspended"):
        raise ConvertError("Status langganan tidak valid.")
    now = time.time()
    with accounts._db() as c:
        target = c.execute("SELECT role FROM users WHERE user_id=?", (user_id,)).fetchone()
        if target is None or target["role"] != "user":
            raise ConvertError("Akun user tidak ditemukan.", 404)
        current = c.execute("""SELECT * FROM subscriptions WHERE user_id=? AND status='active'
            ORDER BY created_at DESC LIMIT 1""", (user_id,)).fetchone()
        if status == "active":
            plan_id = data.get("plan_id", "premium_monthly")
            plan = c.execute("SELECT interval FROM plans WHERE plan_id=? AND active=1 AND price>0",
                             (plan_id,)).fetchone()
            if plan is None:
                raise ConvertError("Paket Premium aktif tidak valid.")
            if current:
                c.execute("UPDATE subscriptions SET status='cancelled' WHERE subscription_id=?",
                          (current["subscription_id"],))
            months = 12 if plan["interval"] == "year" else 1
            dt = datetime.fromtimestamp(now, timezone.utc)
            month_idx = dt.month - 1 + months
            end_year, end_month = dt.year + month_idx // 12, month_idx % 12 + 1
            end_day = min(dt.day, calendar.monthrange(end_year, end_month)[1])
            end = dt.replace(year=end_year, month=end_month, day=end_day).timestamp()
            c.execute("""INSERT INTO subscriptions(user_id,plan_id,status,started_at,ends_at,created_at)
                VALUES(?,?,'active',?,?,?)""", (user_id, plan_id, now, end, now))
        elif current:
            c.execute("UPDATE subscriptions SET status=? WHERE subscription_id=?",
                      (status, current["subscription_id"]))
    accounts.audit(admin["user_id"], "subscription.status.update", str(user_id), status)
    return {"ok": True, "status": status}


@app.get("/api/admin/support")
def admin_support_list(request: Request, limit: int = 100):
    _account_user(request, admin=True)
    return {"tickets": accounts.admin_tickets(limit)}


@app.patch("/api/admin/support/{ticket_id}")
async def admin_update_support(ticket_id: int, request: Request):
    _same_origin(request)
    admin = _account_user(request, admin=True)
    data = await _body(request)
    status = data.get("status")
    response = str(data.get("admin_response", "")).strip()
    if status not in ("open", "in_progress", "resolved") or len(response) > 5000:
        raise ConvertError("Status atau balasan laporan tidak valid.")
    with accounts._db() as c:
        cur = c.execute("""UPDATE support_tickets SET status=?,admin_response=?,updated_at=?
            WHERE ticket_id=?""", (status, response, time.time(), ticket_id))
        if not cur.rowcount:
            raise ConvertError("Laporan tidak ditemukan.", 404)
        ticket_user = c.execute("""SELECT u.user_id,u.email,u.display_name,u.email_verified,
            p.preferences FROM support_tickets t JOIN users u ON u.user_id=t.user_id
            LEFT JOIN user_preferences p ON p.user_id=u.user_id WHERE t.ticket_id=?""",
                                (ticket_id,)).fetchone()
    email_status = "disabled"
    email_error = None
    if response and ticket_user:
        accounts.add_notification(
            ticket_user["user_id"], "info", "Balasan dari tim Konvertin", response
        )
        preferences = json.loads(ticket_user["preferences"]) if ticket_user["preferences"] else {
            "email_notifications": True,
        }
        if ticket_user["email_verified"] and preferences.get("email_notifications", True):
            if mail.configured():
                try:
                    mail.send_account_notice(
                        ticket_user["email"], ticket_user["display_name"],
                        "Balasan dari tim Konvertin", response,
                    )
                    email_status = "sent"
                except mail.EmailDeliveryError as exc:
                    email_status = "failed"
                    email_error = str(exc)
            else:
                email_status = "not_configured"
    accounts.audit(admin["user_id"], "support.ticket.update", str(ticket_id), status)
    return {"ticket_id": ticket_id, "status": status, "email_status": email_status, "email_error": email_error}


@app.get("/api/admin/announcements")
def admin_announcement_list(request: Request):
    _account_user(request, admin=True)
    return {"announcements": accounts.announcements(admin=True)}


@app.post("/api/admin/announcements", status_code=201)
async def admin_create_announcement(request: Request):
    _same_origin(request)
    admin = _superadmin_user(request)
    data = await _body(request)
    title, message = str(data.get("title", "")).strip(), str(data.get("message", "")).strip()
    kind = data.get("kind", "info")
    published = data.get("published", True)
    if not title or len(title) > 120 or not message or len(message) > 3000 or kind not in ("info", "maintenance", "warning") or not isinstance(published, bool):
        raise ConvertError("Informasi pengumuman tidak valid.")
    starts_at, ends_at = data.get("starts_at"), data.get("ends_at")
    if starts_at is not None and (isinstance(starts_at, bool) or not isinstance(starts_at, (int, float))):
        raise ConvertError("Waktu mulai tidak valid.")
    if ends_at is not None and (isinstance(ends_at, bool) or not isinstance(ends_at, (int, float))):
        raise ConvertError("Waktu selesai tidak valid.")
    if starts_at is not None and ends_at is not None and ends_at <= starts_at:
        raise ConvertError("Waktu selesai harus setelah waktu mulai.")
    now = time.time()
    with accounts._db() as c:
        cur = c.execute("""INSERT INTO announcements(title,message,kind,published,starts_at,ends_at,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?)""", (title, message, kind, int(published), starts_at, ends_at, now, now))
        announcement_id = int(cur.lastrowid)
    accounts.audit(admin["user_id"], "announcement.create", str(announcement_id), title)
    return {"announcement_id": announcement_id}


@app.patch("/api/admin/announcements/{announcement_id}")
async def admin_update_announcement(announcement_id: int, request: Request):
    _same_origin(request)
    admin = _superadmin_user(request)
    data = await _body(request)
    allowed = {"title", "message", "kind", "published", "starts_at", "ends_at"}
    if not data or any(key not in allowed for key in data):
        raise ConvertError("Data pengumuman tidak valid.")
    with accounts._db() as c:
        row = c.execute("SELECT * FROM announcements WHERE announcement_id=?", (announcement_id,)).fetchone()
        if row is None:
            raise ConvertError("Pengumuman tidak ditemukan.", 404)
        title = str(data.get("title", row["title"])).strip()
        message = str(data.get("message", row["message"])).strip()
        kind = data.get("kind", row["kind"])
        published = data.get("published", bool(row["published"]))
        starts_at, ends_at = data.get("starts_at", row["starts_at"]), data.get("ends_at", row["ends_at"])
        if not title or len(title) > 120 or not message or len(message) > 3000 or kind not in ("info", "maintenance", "warning") or not isinstance(published, bool):
            raise ConvertError("Informasi pengumuman tidak valid.")
        if starts_at is not None and (isinstance(starts_at, bool) or not isinstance(starts_at, (int, float))):
            raise ConvertError("Waktu mulai tidak valid.")
        if ends_at is not None and (isinstance(ends_at, bool) or not isinstance(ends_at, (int, float))):
            raise ConvertError("Waktu selesai tidak valid.")
        if starts_at is not None and ends_at is not None and ends_at <= starts_at:
            raise ConvertError("Waktu selesai harus setelah waktu mulai.")
        c.execute("""UPDATE announcements SET title=?,message=?,kind=?,published=?,starts_at=?,ends_at=?,updated_at=?
            WHERE announcement_id=?""", (title, message, kind, int(published), starts_at, ends_at, time.time(), announcement_id))
    accounts.audit(admin["user_id"], "announcement.update", str(announcement_id), title)
    return {"ok": True}


@app.delete("/api/admin/announcements/{announcement_id}")
def admin_delete_announcement(announcement_id: int, request: Request):
    _same_origin(request)
    admin = _superadmin_user(request)
    with accounts._db() as c:
        cur = c.execute("DELETE FROM announcements WHERE announcement_id=?", (announcement_id,))
        if not cur.rowcount:
            raise ConvertError("Pengumuman tidak ditemukan.", 404)
    accounts.audit(admin["user_id"], "announcement.delete", str(announcement_id))
    return {"ok": True}


@app.get("/api/admin/audit")
def admin_audit_log(request: Request, limit: int = 100):
    _superadmin_user(request)
    return {"logs": accounts.audit_logs(limit)}


@app.get("/api/account")
def account_dashboard(request: Request):
    user = _account_user(request)
    with accounts._db() as c:
        row = c.execute("SELECT preferences FROM user_preferences WHERE user_id=?", (user["user_id"],)).fetchone()
    preferences = json.loads(row["preferences"]) if row else {"email_notifications": True, "product_updates": True}
    return {
        "user": _user_json(user), "account": accounts.account_summary(user["user_id"]),
        "preferences": preferences, "announcements": accounts.announcements(),
        "notifications": accounts.user_notifications(user["user_id"]),
    }


@app.patch("/api/account/preferences")
async def update_preferences(request: Request):
    _same_origin(request)
    user = _account_user(request)
    data = await _body(request)
    allowed = {"email_notifications", "product_updates"}
    if not data or any(key not in allowed or not isinstance(value, bool) for key, value in data.items()):
        raise ConvertError("Preferensi notifikasi tidak valid.")
    with accounts._db() as c:
        row = c.execute("SELECT preferences FROM user_preferences WHERE user_id=?", (user["user_id"],)).fetchone()
        prefs = json.loads(row["preferences"]) if row else {"email_notifications": True, "product_updates": True}
        prefs.update(data)
        c.execute("""INSERT INTO user_preferences(user_id,preferences,updated_at) VALUES(?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET preferences=excluded.preferences,updated_at=excluded.updated_at""",
                  (user["user_id"], json.dumps(prefs), time.time()))
    return {"preferences": prefs}


@app.get("/api/billing/plans")
def billing_plans():
    return {"plans": accounts.plans(active_only=True), "payment_enabled": bool(
        config.MIDTRANS_SERVER_KEY and config.MIDTRANS_CLIENT_KEY),
        "payment_provider": "midtrans", "midtrans_client_key": config.MIDTRANS_CLIENT_KEY}


@app.post("/api/billing/checkout", status_code=201)
async def billing_checkout(request: Request):
    _same_origin(request)
    user = _account_user(request)
    if not (config.MIDTRANS_SERVER_KEY and config.MIDTRANS_CLIENT_KEY):
        raise ConvertError("Pembayaran belum aktif. Admin perlu mengatur kredensial Midtrans.", 503)
    if not ratelimit.allow_auth(_client_ip(request)):
        raise ConvertError("Terlalu banyak permintaan pembayaran. Coba lagi nanti.", 429)
    data = await _body(request)
    plan = next((p for p in accounts.plans(active_only=True) if p["plan_id"] == data.get("plan_id")), None)
    if plan is None or plan["price"] <= 0 or plan["interval"] not in ("month", "year"):
        raise ConvertError("Paket langganan tidak valid.")
    external_id = "KVT-" + str(user["user_id"]) + "-" + uuid.uuid4().hex
    now = time.time()
    with accounts._db() as c:
        active = c.execute("""SELECT ends_at FROM subscriptions WHERE user_id=? AND status='active'
            AND (ends_at IS NULL OR ends_at>?) ORDER BY ends_at DESC LIMIT 1""",
                           (user["user_id"], now)).fetchone()
        sub = c.execute("""INSERT INTO subscriptions(user_id,plan_id,status,ends_at,created_at)
            VALUES(?,?,'pending',?,?)""",
                        (user["user_id"], plan["plan_id"], active["ends_at"] if active else None, now))
        subscription_id = int(sub.lastrowid)
        c.execute("""INSERT INTO payments(user_id,subscription_id,external_id,amount,currency,status,provider,created_at)
            VALUES(?,?,?,?,'IDR','pending','midtrans',?)""",
                  (user["user_id"], subscription_id, external_id, plan["price"], now))
    try:
        invoice = billing.create_snap_transaction(
            external_id, user["email"], user["display_name"], plan["name"], plan["price"],
        )
    except ValueError as exc:
        with accounts._db() as c:
            c.execute("UPDATE payments SET status='failed' WHERE external_id=?", (external_id,))
            c.execute("UPDATE subscriptions SET status='failed' WHERE subscription_id=?", (subscription_id,))
        raise ConvertError(str(exc), 502)
    with accounts._db() as c:
        c.execute("UPDATE payments SET provider_id=?,invoice_url=? WHERE external_id=?",
                  (str(invoice["id"]), invoice["invoice_url"], external_id))
    return {"external_id": external_id, "invoice_url": invoice["invoice_url"], "status": "pending"}


@app.post("/api/billing/midtrans/webhook")
async def midtrans_webhook(request: Request):
    import hashlib
    from hmac import compare_digest

    if not config.MIDTRANS_SERVER_KEY:
        raise ConvertError("Webhook Midtrans belum dikonfigurasi.", 503)
    data = await _body(request)
    order_id = str(data.get("order_id", ""))
    status_code = str(data.get("status_code", ""))
    gross_amount = str(data.get("gross_amount", ""))
    provided = str(data.get("signature_key", ""))
    expected = hashlib.sha512(
        f"{order_id}{status_code}{gross_amount}{config.MIDTRANS_SERVER_KEY}".encode()
    ).hexdigest()
    if not order_id or not compare_digest(provided, expected):
        raise ConvertError("Signature notifikasi Midtrans tidak valid.", 401)
    try:
        decimal_amount = Decimal(gross_amount)
        if not decimal_amount.is_finite() or decimal_amount != decimal_amount.to_integral_value():
            raise InvalidOperation
        amount = int(decimal_amount)
    except (InvalidOperation, ValueError):
        raise ConvertError("Nominal notifikasi Midtrans tidak valid.")
    transaction_status = str(data.get("transaction_status", "")).lower()
    fraud_status = str(data.get("fraud_status", "")).lower()
    if transaction_status == "settlement" or (transaction_status == "capture" and fraud_status == "accept"):
        state = "paid"
    elif transaction_status == "capture" and fraud_status != "deny":
        state = "pending"
    elif transaction_status == "pending":
        state = "pending"
    elif transaction_status == "deny":
        state = "failed"
    elif transaction_status in ("expire", "cancel"):
        state = "expired" if transaction_status == "expire" else "cancelled"
    elif transaction_status == "deny":
        state = "failed"
    else:
        raise ConvertError("Status notifikasi Midtrans tidak dikenal.")
    now = time.time()
    with accounts._db() as c:
        payment = c.execute("SELECT * FROM payments WHERE external_id=?", (order_id,)).fetchone()
        if payment is None or payment["provider"] != "midtrans":
            raise ConvertError("Transaksi Midtrans tidak ditemukan.", 404)
        if payment["amount"] != amount:
            raise ConvertError("Nominal notifikasi tidak cocok dengan transaksi.", 400)
        if state == "paid" and payment["status"] != "paid":
            c.execute("UPDATE payments SET status='paid',paid_at=?,provider_id=? WHERE external_id=?",
                      (now, str(data.get("transaction_id") or "") or None, order_id))
            sub = c.execute("SELECT * FROM subscriptions WHERE subscription_id=?",
                            (payment["subscription_id"],)).fetchone()
            if sub is not None:
                plan = c.execute("SELECT interval FROM plans WHERE plan_id=?", (sub["plan_id"],)).fetchone()
                start = max(now, sub["ends_at"] or now)
                start_date = datetime.fromtimestamp(start, timezone.utc)
                months = 12 if plan and plan["interval"] == "year" else 1
                month_index = start_date.month - 1 + months
                year = start_date.year + month_index // 12
                month = month_index % 12 + 1
                end_day = min(start_date.day, calendar.monthrange(year, month)[1])
                end_date = start_date.replace(year=year, month=month, day=end_day)
                c.execute("""UPDATE subscriptions SET status='expired' WHERE user_id=? AND status='active'
                    AND subscription_id!=?""", (sub["user_id"], sub["subscription_id"]))
                c.execute("UPDATE subscriptions SET status='active',started_at=?,ends_at=? WHERE subscription_id=?",
                          (start, end_date.timestamp(), sub["subscription_id"]))
                c.execute("""INSERT INTO user_notifications(user_id,kind,title,message,created_at)
                    VALUES(?,'info','Pembayaran berhasil',
                    'Pembayaran Premium diterima. Langganan aktif sampai ' || ? || '.',?)""",
                          (sub["user_id"], end_date.strftime("%d-%m-%Y"), now))
        elif state != "pending" and payment["status"] == "pending":
            c.execute("UPDATE payments SET status=? WHERE external_id=?", (state, order_id))
            c.execute("UPDATE subscriptions SET status=? WHERE subscription_id=? AND status='pending'",
                      (state, payment["subscription_id"]))
    return {"ok": True}


@app.post("/api/billing/xendit/webhook")
async def xendit_webhook(request: Request):
    from hmac import compare_digest

    if not config.XENDIT_WEBHOOK_TOKEN:
        raise ConvertError("Webhook pembayaran belum dikonfigurasi.", 503)
    if not compare_digest(request.headers.get("x-callback-token", ""), config.XENDIT_WEBHOOK_TOKEN):
        raise ConvertError("Token webhook tidak valid.", 401)
    data = await _body(request)
    external_id = str(data.get("external_id", ""))
    state = str(data.get("status", "")).upper()
    if not external_id or state not in ("PAID", "SETTLED", "EXPIRED", "PENDING"):
        raise ConvertError("Notifikasi pembayaran tidak valid.")
    now = time.time()
    with accounts._db() as c:
        payment = c.execute("SELECT * FROM payments WHERE external_id=?", (external_id,)).fetchone()
        if payment is None or payment["provider"] != "xendit":
            raise ConvertError("Pembayaran tidak ditemukan.", 404)
        if state in ("PAID", "SETTLED") and payment["status"] != "paid":
            c.execute("UPDATE payments SET status='paid',paid_at=? WHERE external_id=?", (now, external_id))
            sub = c.execute("SELECT * FROM subscriptions WHERE subscription_id=?",
                            (payment["subscription_id"],)).fetchone()
            if sub is not None:
                plan = c.execute("SELECT interval FROM plans WHERE plan_id=?", (sub["plan_id"],)).fetchone()
                start = max(now, sub["ends_at"] or now)
                start_date = datetime.fromtimestamp(start, timezone.utc)
                months = 12 if plan and plan["interval"] == "year" else 1
                month_index = start_date.month - 1 + months
                year = start_date.year + month_index // 12
                month = month_index % 12 + 1
                end_day = min(start_date.day, calendar.monthrange(year, month)[1])
                end_date = start_date.replace(year=year, month=month, day=end_day)
                c.execute("""UPDATE subscriptions SET status='expired' WHERE user_id=? AND status='active'
                    AND subscription_id!=?""", (sub["user_id"], sub["subscription_id"]))
                c.execute("UPDATE subscriptions SET status='active',started_at=?,ends_at=? WHERE subscription_id=?",
                          (start, end_date.timestamp(), sub["subscription_id"]))
        elif state == "EXPIRED" and payment["status"] != "paid":
            c.execute("UPDATE payments SET status='expired' WHERE external_id=?", (external_id,))
            c.execute("UPDATE subscriptions SET status='expired' WHERE subscription_id=?",
                      (payment["subscription_id"],))
        elif state == "PENDING" and payment["status"] == "pending":
            c.execute("UPDATE payments SET provider_id=coalesce(?,provider_id) WHERE external_id=?",
                      (str(data.get("id") or "") or None, external_id))
    return {"ok": True}


@app.get("/api/support")
def get_support(request: Request):
    user = _account_user(request)
    return {"tickets": accounts.user_tickets(user["user_id"])}


@app.post("/api/support", status_code=201)
async def create_support(request: Request):
    _same_origin(request)
    user = _account_user(request)
    data = await _body(request)
    category = str(data.get("category", ""))
    subject = str(data.get("subject", "")).strip()
    message = str(data.get("message", "")).strip()
    if category not in ("feedback", "bug", "billing", "help") or not subject or len(subject) > 120 or not message or len(message) > 5000:
        raise ConvertError("Kategori, judul, atau isi laporan tidak valid.")
    ticket_id = accounts.create_ticket(user["user_id"], category, subject, message)
    return {"ticket_id": ticket_id, "status": "open"}


@app.get("/api/announcements")
def get_announcements():
    return {"announcements": accounts.announcements()}


@app.get("/api/conversions")
def conversions():
    """Daftar konversi dokumen yang valid, dikelompokkan per tipe input."""
    out: dict[str, list] = {}
    for jt, (src, dst, _) in CONVERSIONS.items():
        if jt in COMPRESS_JOB.values():
            continue  # bukan konversi antarformat; tampil sebagai tool kompres
        out.setdefault(src, []).append({"type": jt, "output": dst})
    return {"conversions": out, "max_mb": config.MAX_DOC_BYTES // 1024 // 1024, "max_pages": config.MAX_PDF_PAGES}


@app.post("/api/detect")
async def detect(file: UploadFile = File(...)):
    """Deteksi tipe file dari isinya dan tawarkan format tujuan yang valid."""
    tmp = await _save_upload(file)
    try:
        kind = detect_kind(tmp, file.filename)
    finally:
        tmp.unlink(missing_ok=True)
    if kind is None:
        raise ConvertError("Format file tidak didukung. Saat ini yang bisa: PDF, DOCX, PPTX, XLSX, CSV, TXT.")
    options = [{"type": jt, "output": v[1]} for jt, v in CONVERSIONS.items() if v[0] == kind and jt not in COMPRESS_JOB.values()]
    if kind in COMPRESS_JOB:
        options.append({"type": COMPRESS_JOB[kind], "output": kind})
    return {"kind": kind, "label": KIND_LABEL[kind], "options": options}


async def _save_upload(file: UploadFile, limit: int | None = None) -> Path:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    fd = tempfile.NamedTemporaryFile(dir=config.DATA_DIR, prefix="up_", delete=False)
    size = 0
    limit = config.MAX_DOC_BYTES if limit is None else min(limit, config.MAX_DOC_BYTES)
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
    if not _has_feature(type):
        raise ConvertError("Tool ini sedang dinonaktifkan sementara.", 503)
    if not ratelimit.allow(_client_ip(request)):
        raise ConvertError("Terlalu banyak konversi dari koneksi ini. Tunggu beberapa saat lalu coba lagi.", 429)
    user = accounts.current_user(request)
    quota = _quota(user)
    if quota and quota["remaining_today"] < 1:
        raise ConvertError("Kuota konversi harian akunmu sudah habis.", 429)
    try:
        opts = json.loads(options)
        if not isinstance(opts, dict):
            raise ValueError
    except ValueError:
        raise ConvertError("Opsi konversi tidak valid.")
    opts = check_options(type, opts)
    tmp = await _save_upload(file, _file_limit(user))
    try:
        validate_upload(tmp, type, file.filename)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    job_id = jobs.create(type, tmp, file.filename or "dokumen", opts, user["user_id"] if user else None)
    return {"job_id": job_id, "status": "queued", "status_url": f"/api/jobs/{job_id}"}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str, request: Request):
    row = jobs.get(job_id)
    if row is None:
        raise ConvertError("Job tidak ditemukan atau sudah dihapus (file dihapus otomatis setelah 1 jam).", 404)
    _require_job_access(row, request)
    return _public(row)


@app.get("/api/jobs/{job_id}/download")
def job_download(job_id: str, request: Request):
    row = jobs.get(job_id)
    if row is None or row["status"] != "done" or not row["output_key"]:
        raise ConvertError("Hasil tidak tersedia. Mungkin sudah dihapus otomatis atau belum selesai.", 404)
    _require_job_access(row, request)
    path = config.STORAGE_DIR / row["output_key"]
    if not path.exists():
        raise ConvertError("Hasil sudah dihapus. Konversi ulang filenya.", 404)
    mime = CONVERSIONS[row["type"]][2]
    return FileResponse(path, media_type=mime, filename=row["download_name"], headers={"Cache-Control": "no-store"})


@app.delete("/api/jobs/{job_id}")
def job_cancel(job_id: str, request: Request):
    _same_origin(request)
    row = jobs.get(job_id)
    if row:
        _require_job_access(row, request)
    if not jobs.cancel(job_id):
        raise ConvertError("Job tidak ditemukan.", 404)
    return {"ok": True}


# Frontend statis (untuk dev / satu server). Di produksi bisa di Cloudflare Pages.
if config.FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")
