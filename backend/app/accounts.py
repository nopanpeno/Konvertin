"""Minimal account, session, conversion-history, and aggregate-usage storage."""
import hashlib
import hmac
import json
import secrets
import sqlite3
import time
from email.utils import parseaddr

from fastapi import Request

from . import config

COOKIE = "konvertin_session"
_ITERATIONS = 310_000
BROWSER_TOOL_TYPES = frozenset({
    "konversi-gambar", "heic-ke-jpg", "jpg-ke-png", "png-ke-jpg", "webp-ke-jpg",
    "jpg-ke-webp", "ubah-ukuran-gambar", "kompres-gambar", "konversi-audio",
    "wav-ke-mp3", "m4a-ke-mp3", "flac-ke-mp3", "gabung-pdf", "pisah-pdf", "gambar-ke-pdf", "upscale-gambar",
})


def _db():
    c = sqlite3.connect(config.DB_PATH, timeout=30)
    c.row_factory = sqlite3.Row
    return c


def _hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${salt.hex()}${digest.hex()}"


def _check_password(password: str, stored: str) -> bool:
    try:
        algo, rounds, salt, digest = stored.split("$")
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds)).hex()
        return algo == "pbkdf2_sha256" and hmac.compare_digest(actual, digest)
    except (ValueError, TypeError):
        return False


def init() -> None:
    if config.ADMIN_PASSWORD and not config.ADMIN_EMAIL:
        raise RuntimeError("Set KONVERTIN_ADMIN_EMAIL when bootstrapping an admin.")
    if config.ADMIN_EMAIL and config.ADMIN_EMAIL != "admin@konvertin.com":
        raise RuntimeError("KONVERTIN_ADMIN_EMAIL must be admin@konvertin.com.")
    if config.ADMIN_EMAIL and not valid_email(config.ADMIN_EMAIL):
        raise RuntimeError("Admin bootstrap needs a valid email.")
    if config.ADMIN_PASSWORD and not 10 <= len(config.ADMIN_PASSWORD) <= 256:
        raise RuntimeError("Admin bootstrap needs a valid email and a 10–256 character password.")
    with _db() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS users (
              user_id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE,
              display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
              role TEXT NOT NULL DEFAULT 'user', created_at REAL NOT NULL,
              status TEXT NOT NULL DEFAULT 'active',
              phone TEXT NOT NULL DEFAULT '', email_verified INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS sessions (
              token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
              expires_at REAL NOT NULL, created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS conversion_history (
              history_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
              job_id TEXT UNIQUE,
              tool_type TEXT NOT NULL, source TEXT NOT NULL,
              status TEXT NOT NULL, created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS history_user_time ON conversion_history(user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS history_time ON conversion_history(created_at);
            CREATE TABLE IF NOT EXISTS usage_events (
              event_id INTEGER PRIMARY KEY, user_id INTEGER,
              tool_type TEXT NOT NULL, source TEXT NOT NULL,
              status TEXT NOT NULL, created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS usage_time ON usage_events(created_at);
            CREATE TABLE IF NOT EXISTS subscriptions (
              subscription_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
              plan_id TEXT NOT NULL, status TEXT NOT NULL,
              started_at REAL, ends_at REAL, created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS subscriptions_user_status ON subscriptions(user_id,status);
            CREATE TABLE IF NOT EXISTS payments (
              payment_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
              subscription_id INTEGER, external_id TEXT NOT NULL UNIQUE,
              provider_id TEXT, amount INTEGER NOT NULL, currency TEXT NOT NULL,
              status TEXT NOT NULL, invoice_url TEXT, provider TEXT NOT NULL DEFAULT 'xendit',
              created_at REAL NOT NULL,
              paid_at REAL
            );
            CREATE INDEX IF NOT EXISTS payments_user_time ON payments(user_id,created_at DESC);
            CREATE TABLE IF NOT EXISTS support_tickets (
              ticket_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
              category TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'open', admin_response TEXT NOT NULL DEFAULT '',
              created_at REAL NOT NULL,
              updated_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS announcements (
              announcement_id INTEGER PRIMARY KEY, title TEXT NOT NULL,
              message TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'info',
              published INTEGER NOT NULL DEFAULT 1, starts_at REAL,
              ends_at REAL, created_at REAL NOT NULL, updated_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit_logs (
              log_id INTEGER PRIMARY KEY, admin_user_id INTEGER NOT NULL,
              action TEXT NOT NULL, target TEXT NOT NULL, details TEXT NOT NULL,
              created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS audit_time ON audit_logs(created_at DESC);
            CREATE TABLE IF NOT EXISTS site_settings (
              setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS plans (
              plan_id TEXT PRIMARY KEY, name TEXT NOT NULL, interval TEXT NOT NULL,
              price INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
              features TEXT NOT NULL DEFAULT '[]', updated_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_preferences (
              user_id INTEGER PRIMARY KEY, preferences TEXT NOT NULL DEFAULT '{}',
              updated_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS email_verification_tokens (
              token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
              expires_at REAL NOT NULL, created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_notifications (
              notification_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
              kind TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL,
              created_at REAL NOT NULL, read_at REAL
            );
            CREATE INDEX IF NOT EXISTS notifications_user_time
              ON user_notifications(user_id,created_at DESC);
        """)
        user_columns = {r["name"] for r in c.execute("PRAGMA table_info(users)")}
        if "status" not in user_columns:
            c.execute("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
        if "phone" not in user_columns:
            c.execute("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''")
        if "email_verified" not in user_columns:
            c.execute("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1")
        payment_columns = {r["name"] for r in c.execute("PRAGMA table_info(payments)")}
        if "provider" not in payment_columns:
            c.execute("ALTER TABLE payments ADD COLUMN provider TEXT NOT NULL DEFAULT 'xendit'")
        owners = sorted(config.SUPERADMIN_EMAILS)
        c.execute(
            f"UPDATE users SET role='user' WHERE role='superadmin' AND lower(email) NOT IN ({','.join('?' for _ in owners)})",
            owners,
        )
        c.execute("UPDATE users SET role='user' WHERE role='admin' AND email!='admin@konvertin.com'")
        ticket_columns = {r["name"] for r in c.execute("PRAGMA table_info(support_tickets)")}
        if "admin_response" not in ticket_columns:
            c.execute("ALTER TABLE support_tickets ADD COLUMN admin_response TEXT NOT NULL DEFAULT ''")
        now = time.time()
        c.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        c.execute("DELETE FROM conversion_history WHERE created_at < ?", (now - config.HISTORY_TTL_SEC,))
        c.execute("DELETE FROM usage_events WHERE created_at < ?", (now - config.HISTORY_TTL_SEC,))
        # The subordinate admin is created only when its secret is explicitly configured.
        if config.ADMIN_EMAIL and config.ADMIN_PASSWORD:
            row = c.execute("SELECT user_id,password_hash FROM users WHERE email=?", (config.ADMIN_EMAIL,)).fetchone()
            if row is None:
                c.execute("""INSERT INTO users(email,display_name,password_hash,role,created_at,email_verified)
                    VALUES(?,?,?,?,?,1)""",
                          (config.ADMIN_EMAIL, config.ADMIN_NAME, _hash_password(config.ADMIN_PASSWORD), "admin", time.time()))
            else:
                if not _check_password(config.ADMIN_PASSWORD, row["password_hash"]):
                    c.execute("DELETE FROM sessions WHERE user_id=?", (row["user_id"],))
                c.execute("UPDATE users SET role='admin',display_name=?,email_verified=1,password_hash=? WHERE email=?",
                          (config.ADMIN_NAME, _hash_password(config.ADMIN_PASSWORD), config.ADMIN_EMAIL))
        elif config.ADMIN_EMAIL:
            c.execute("UPDATE users SET role='user' WHERE email=? AND role='admin'", (config.ADMIN_EMAIL,))
            c.execute("DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM users WHERE email=?)",
                      (config.ADMIN_EMAIL,))
        staff_count = c.execute("SELECT count(*) FROM users WHERE role='admin'").fetchone()[0]
        if staff_count > config.MAX_STAFF_ADMINS:
            raise RuntimeError(f"At most {config.MAX_STAFF_ADMINS} subordinate admin accounts are allowed.")
        defaults = (
            ("free", "Free", "month", 0, 1, ["20 konversi per hari", f"Maks. {config.MAX_DOC_BYTES // 1048576} MB per file", "File sementara 1 jam"]),
            ("premium_monthly", "Premium Bulanan", "month", 0, 1, ["Kuota 500 konversi per hari", "File hingga 100 MB", "Prioritas dukungan"]),
            ("premium_yearly", "Premium Tahunan", "year", 0, 1, ["Kuota 500 konversi per hari", "File hingga 100 MB", "Prioritas dukungan"]),
        )
        for plan_id, name, interval, price, active, features in defaults:
            c.execute(
                "INSERT OR IGNORE INTO plans(plan_id,name,interval,price,active,features,updated_at) VALUES(?,?,?,?,?,?,?)",
                (plan_id, name, interval, price, active, json.dumps(features), now),
            )
        for key, value in (
            ("free_daily_quota", "20"),
            ("premium_daily_quota", "500"),
            ("free_max_file_mb", str(config.MAX_DOC_BYTES // 1048576)),
            ("premium_max_file_mb", "100"),
            ("max_pdf_pages", str(config.MAX_PDF_PAGES)),
        ):
            c.execute("INSERT OR IGNORE INTO site_settings(setting_key,setting_value) VALUES(?,?)", (key, value))
        for tool in sorted(BROWSER_TOOL_TYPES):
            c.execute("INSERT OR IGNORE INTO site_settings(setting_key,setting_value) VALUES(?,?)",
                      (f"feature:{tool}", "1"))
        from .validation import CONVERSIONS
        for tool in CONVERSIONS:
            c.execute("INSERT OR IGNORE INTO site_settings(setting_key,setting_value) VALUES(?,?)",
                      (f"feature:{tool}", "1"))


def valid_email(email: str) -> bool:
    parsed = parseaddr(email.strip())[1]
    return parsed == email.strip() and "@" in parsed and len(parsed) <= 254 and "." in parsed.rsplit("@", 1)[-1]


def create_user(email: str, password: str, display_name: str, phone: str = ""):
    email = email.strip().lower()
    if not valid_email(email):
        return None, "Format email tidak valid."
    if len(password) < 10 or len(password) > 256:
        return None, "Password harus 10-256 karakter."
    name = display_name.strip()
    if not name or len(name) > 80:
        return None, "Nama harus 1-80 karakter."
    phone = phone.strip()
    if len(phone) > 30 or (phone and (
        sum(character.isdigit() for character in phone) < 7
        or any(not (character.isdigit() or character in "+().- ") for character in phone)
    )):
        return None, "Nomor telepon/WhatsApp tidak valid."
    try:
        with _db() as c:
            cur = c.execute("""INSERT INTO users(email,display_name,password_hash,phone,email_verified,created_at)
                VALUES(?,?,?,?,0,?)""", (email, name, _hash_password(password), phone, time.time()))
            return int(cur.lastrowid), None
    except sqlite3.IntegrityError:
        return None, "Email sudah terdaftar."


def authenticate(email: str, password: str):
    with _db() as c:
        row = c.execute("SELECT * FROM users WHERE email=?", (email.strip().lower(),)).fetchone()
    # Do a hash even for unknown email to reduce timing-based account discovery.
    if row is None or row["role"] == "superadmin":
        _check_password(password, "pbkdf2_sha256$310000$00000000000000000000000000000000$" + "00" * 32)
        return None
    return row if row["role"] != "superadmin" and row["status"] == "active" and row["email_verified"] and _check_password(password, row["password_hash"]) else None


def google_account(email: str, display_name: str):
    email = email.strip().lower()
    if not valid_email(email):
        return None
    name = display_name.strip()[:80] or email
    role = (
        "superadmin" if email in config.SUPERADMIN_EMAILS
        else "admin" if email == config.ADMIN_EMAIL and config.ADMIN_PASSWORD
        else "user"
    )
    with _db() as c:
        row = c.execute("SELECT user_id,role,status FROM users WHERE email=?", (email,)).fetchone()
        if row is None:
            if role == "admin" and c.execute(
                "SELECT count(*) FROM users WHERE role='admin'"
            ).fetchone()[0] >= config.MAX_STAFF_ADMINS:
                return None
            cursor = c.execute("""INSERT INTO users(email,display_name,password_hash,role,created_at,status,email_verified)
                VALUES(?,?,?,?,?,'active',1)""",
                               (email, name, _hash_password(secrets.token_urlsafe(48)), role, time.time()))
            user_id = int(cursor.lastrowid)
        else:
            if role != "superadmin" and row["status"] != "active":
                return None
            if role == "admin" and row["role"] != "admin" and c.execute(
                "SELECT count(*) FROM users WHERE role='admin'"
            ).fetchone()[0] >= config.MAX_STAFF_ADMINS:
                return None
            user_id = int(row["user_id"])
            if row["role"] != role:
                c.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
            c.execute("""UPDATE users SET display_name=?,role=?,status='active',email_verified=1
                WHERE user_id=?""", (name, role, user_id))
        return c.execute("SELECT user_id,email,display_name,phone,email_verified,role,status FROM users WHERE user_id=?",
                         (user_id,)).fetchone()


def authenticate_unverified(email: str, password: str):
    with _db() as c:
        row = c.execute("SELECT * FROM users WHERE email=?", (email.strip().lower(),)).fetchone()
    if row is None:
        _check_password(password, "pbkdf2_sha256$310000$00000000000000000000000000000000$" + "00" * 32)
        return None
    return row if row["status"] == "active" and not row["email_verified"] and _check_password(password, row["password_hash"]) else None


def issue_email_verification(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = time.time()
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with _db() as c:
        c.execute("DELETE FROM email_verification_tokens WHERE user_id=?", (user_id,))
        c.execute("INSERT INTO email_verification_tokens(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
                  (token_hash, user_id, now + 24 * 3600, now))
    return token


def verify_email_token(token: str) -> bool:
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    now = time.time()
    with _db() as c:
        row = c.execute("SELECT user_id FROM email_verification_tokens WHERE token_hash=? AND expires_at>?",
                        (token_hash, now)).fetchone()
        if row is None:
            return False
        c.execute("UPDATE users SET email_verified=1 WHERE user_id=?", (row["user_id"],))
        c.execute("DELETE FROM email_verification_tokens WHERE user_id=?", (row["user_id"],))
    return True


def unverified_user_by_email(email: str):
    with _db() as c:
        return c.execute("SELECT user_id,email,display_name FROM users WHERE email=? AND status='active' AND email_verified=0",
                         (email.strip().lower(),)).fetchone()


def verification_identity(user_id: int):
    with _db() as c:
        return c.execute("SELECT email,display_name FROM users WHERE user_id=? AND status='active' AND email_verified=0",
                         (user_id,)).fetchone()


def add_notification(user_id: int, kind: str, title: str, message: str) -> int:
    now = time.time()
    with _db() as c:
        cursor = c.execute("""INSERT INTO user_notifications(user_id,kind,title,message,created_at)
            VALUES(?,?,?,?,?)""", (user_id, kind, title, message, now))
        return int(cursor.lastrowid)


def user_notifications(user_id: int, limit: int = 50) -> list[dict]:
    with _db() as c:
        return [dict(row) for row in c.execute("""SELECT notification_id,kind,title,message,created_at,read_at
            FROM user_notifications WHERE user_id=? ORDER BY created_at DESC LIMIT ?""",
                                               (user_id, min(max(limit, 1), 100)))]


def mark_notification_read(user_id: int, notification_id: int) -> bool:
    with _db() as c:
        cursor = c.execute("""UPDATE user_notifications SET read_at=coalesce(read_at,?)
            WHERE notification_id=? AND user_id=?""", (time.time(), notification_id, user_id))
        return cursor.rowcount > 0


def new_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = time.time()
    with _db() as c:
        c.execute("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
                  (hashlib.sha256(token.encode()).hexdigest(), user_id, now + config.SESSION_TTL_SEC, now))
    return token


def current_user(request: Request):
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with _db() as c:
        row = c.execute("""SELECT u.user_id,u.email,u.display_name,u.phone,u.email_verified,u.role,u.status
            FROM sessions s JOIN users u USING(user_id) WHERE s.token_hash=? AND s.expires_at>?""",
                        (token_hash, time.time())).fetchone()
    return row if row and row["status"] == "active" else None


def delete_session(token: str | None) -> None:
    if token:
        with _db() as c:
            c.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))


def update_profile(user_id: int, display_name: str):
    return update_account_profile(user_id, display_name)


def update_account_profile(user_id: int, display_name: str, phone: str | None = None):
    name = display_name.strip()
    if not name or len(name) > 80:
        return False, "Nama harus 1-80 karakter."
    if phone is None:
        with _db() as c:
            c.execute("UPDATE users SET display_name=? WHERE user_id=?", (name, user_id))
        return True, None
    phone = phone.strip()
    if len(phone) > 30 or (phone and (
        sum(character.isdigit() for character in phone) < 7
        or any(not (character.isdigit() or character in "+().- ") for character in phone)
    )):
        return False, "Nomor telepon/WhatsApp tidak valid."
    with _db() as c:
        c.execute("UPDATE users SET display_name=?,phone=? WHERE user_id=?", (name, phone, user_id))
    return True, None


def change_password(user_id: int, current: str, new: str, session_token: str | None) -> tuple[bool, str | None]:
    if len(new) < 10 or len(new) > 256:
        return False, "Password baru harus 10–256 karakter."
    with _db() as c:
        row = c.execute("SELECT password_hash FROM users WHERE user_id=?", (user_id,)).fetchone()
        if row is None or not _check_password(current, row["password_hash"]):
            return False, "Password saat ini salah."
        c.execute("UPDATE users SET password_hash=? WHERE user_id=?", (_hash_password(new), user_id))
        token_hash = hashlib.sha256(session_token.encode()).hexdigest() if session_token else ""
        c.execute("DELETE FROM sessions WHERE user_id=? AND token_hash!=?", (user_id, token_hash))
    return True, None


def record_history(user_id: int, tool_type: str, source: str, status: str = "done") -> None:
    with _db() as c:
        c.execute("INSERT INTO conversion_history(user_id,tool_type,source,status,created_at) VALUES(?,?,?,?,?)",
                  (user_id, tool_type[:80], source, status, time.time()))


def record_browser_usage(user_id: int | None, tool_type: str) -> None:
    now = time.time()
    with _db() as c:
        c.execute("INSERT INTO usage_events(user_id,tool_type,source,status,created_at) VALUES(?,?,?,?,?)",
                  (user_id, tool_type[:80], "browser", "done", now))
        if user_id is not None:
            c.execute("INSERT INTO conversion_history(user_id,tool_type,source,status,created_at) VALUES(?,?,?,?,?)",
                      (user_id, tool_type[:80], "browser", "done", now))


def history(user_id: int, limit: int = 100):
    with _db() as c:
        return c.execute("""SELECT h.history_id,h.job_id,h.tool_type,h.source,h.status,h.created_at,
            j.expires_at,j.output_key
            FROM conversion_history h LEFT JOIN jobs j ON j.job_id=h.job_id
            WHERE h.user_id=? AND h.created_at>=? ORDER BY h.created_at DESC LIMIT ?""",
                         (user_id, time.time() - config.HISTORY_TTL_SEC, limit)).fetchall()


def settings() -> dict[str, str]:
    with _db() as c:
        return {r["setting_key"]: r["setting_value"] for r in c.execute("SELECT setting_key,setting_value FROM site_settings")}


def setting_int(key: str, default: int) -> int:
    value = settings().get(key)
    try:
        return max(1, int(value)) if value is not None else default
    except ValueError:
        return default


def plans(active_only: bool = False) -> list[dict]:
    query = "SELECT * FROM plans" + (" WHERE active=1" if active_only else "") + " ORDER BY price,plan_id"
    with _db() as c:
        rows = c.execute(query).fetchall()
    return [{**dict(row), "features": json.loads(row["features"])} for row in rows]


def active_subscription(user_id: int):
    expire_subscriptions(user_id)
    with _db() as c:
        return c.execute("""SELECT * FROM subscriptions WHERE user_id=? AND status='active'
            AND (ends_at IS NULL OR ends_at>?) ORDER BY ends_at DESC LIMIT 1""",
                         (user_id, time.time())).fetchone()


def expire_subscriptions(user_id: int | None = None) -> int:
    now = time.time()
    with _db() as c:
        query = """SELECT DISTINCT user_id FROM subscriptions WHERE status='active'
            AND ends_at IS NOT NULL AND ends_at<=?"""
        values: tuple = (now,)
        if user_id is not None:
            query += " AND user_id=?"
            values += (user_id,)
        expired_users = [row["user_id"] for row in c.execute(query, values)]
        if not expired_users:
            return 0
        if user_id is None:
            c.execute("""UPDATE subscriptions SET status='expired' WHERE status='active'
                AND ends_at IS NOT NULL AND ends_at<=?""", (now,))
        else:
            c.execute("""UPDATE subscriptions SET status='expired' WHERE user_id=? AND status='active'
                AND ends_at IS NOT NULL AND ends_at<=?""", (user_id, now))
        c.executemany("""INSERT INTO user_notifications(user_id,kind,title,message,created_at)
            VALUES(?,'info','Langganan Premium berakhir',
            'Masa aktif Premium telah berakhir. Akun kembali menggunakan paket Free. Kamu dapat berlangganan kembali kapan saja.',?)""",
                      [(expired_user_id, now) for expired_user_id in expired_users])
        return len(expired_users)


def account_summary(user_id: int) -> dict:
    settings_map = settings()
    subscription = active_subscription(user_id)
    premium = subscription is not None
    quota = int(settings_map.get("premium_daily_quota" if premium else "free_daily_quota", 500 if premium else 20))
    max_mb = int(settings_map.get("premium_max_file_mb" if premium else "free_max_file_mb", config.MAX_DOC_BYTES // 1048576))
    day_start = time.time() - (time.time() % 86400)
    with _db() as c:
        used = c.execute("SELECT count(*) FROM usage_events WHERE user_id=? AND created_at>=?",
                         (user_id, day_start)).fetchone()[0]
        payment_rows = c.execute("SELECT * FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
                                 (user_id,)).fetchall()
    plan = next((p for p in plans() if p["plan_id"] == (subscription["plan_id"] if subscription else "free")), None)
    return {
        "plan": plan,
        "subscription": dict(subscription) if subscription else None,
        "quota": {"daily_limit": quota, "used_today": used, "remaining_today": max(0, quota - used), "max_file_mb": max_mb},
        "payments": [dict(r) for r in payment_rows],
        "payment_enabled": bool(config.MIDTRANS_SERVER_KEY and config.MIDTRANS_CLIENT_KEY),
    }


def create_ticket(user_id: int, category: str, subject: str, message: str) -> int:
    now = time.time()
    with _db() as c:
        cur = c.execute("""INSERT INTO support_tickets(user_id,category,subject,message,created_at,updated_at)
            VALUES(?,?,?,?,?,?)""", (user_id, category, subject, message, now, now))
        return int(cur.lastrowid)


def audit(admin_id: int, action: str, target: str, details: str = "") -> None:
    with _db() as c:
        c.execute("INSERT INTO audit_logs(admin_user_id,action,target,details,created_at) VALUES(?,?,?,?,?)",
                  (admin_id, action[:80], target[:160], details[:1000], time.time()))


def admin_overview(days: int = 30) -> dict:
    since = time.time() - days * 86400
    month_start = time.time() - 30 * 86400
    with _db() as c:
        users = c.execute("SELECT count(*) total,sum(status='active') active FROM users WHERE role='user'").fetchone()
        new_users = c.execute("SELECT count(*) FROM users WHERE role='user' AND created_at>=?", (since,)).fetchone()[0]
        conversions = c.execute("""SELECT count(*) total,sum(status='failed') failed
            FROM usage_events WHERE created_at>=?""", (since,)).fetchone()
        jobs = c.execute("SELECT status,count(*) count FROM jobs GROUP BY status").fetchall()
        revenue = c.execute("SELECT coalesce(sum(amount),0) FROM payments WHERE status='paid' AND paid_at>=?",
                            (month_start,)).fetchone()[0]
        premium = c.execute("""SELECT count(DISTINCT user_id) FROM subscriptions
            WHERE status='active' AND (ends_at IS NULL OR ends_at>?)""", (time.time(),)).fetchone()[0]
        staff_admins = c.execute("SELECT count(*) FROM users WHERE role='admin' AND status='active'").fetchone()[0]
        pending_tickets = c.execute("SELECT count(*) FROM support_tickets WHERE status='open'").fetchone()[0]
    return {
        "users": {"total": users["total"] or 0, "active": users["active"] or 0, "new_in_period": new_users},
        "conversions": {"total_in_period": conversions["total"] or 0, "failed_in_period": conversions["failed"] or 0},
        "jobs": {row["status"]: row["count"] for row in jobs},
        "premium_customers": premium,
        "staff_admins": {"active": staff_admins, "maximum": config.MAX_STAFF_ADMINS},
        "revenue_last_30_days": revenue,
        "open_tickets": pending_tickets,
        "usage": usage(days),
    }


def admin_user_list(search: str = "", limit: int = 100, offset: int = 0) -> list[dict]:
    query = """SELECT u.user_id,u.email,u.display_name,u.phone,u.email_verified,u.role,u.status,u.created_at,
        (SELECT count(*) FROM conversion_history h WHERE h.user_id=u.user_id) conversions,
        (SELECT s.status FROM subscriptions s WHERE s.user_id=u.user_id
            ORDER BY s.created_at DESC LIMIT 1) subscription_status
        FROM users u WHERE u.role='user'"""
    values: list = []
    if search:
        query += " AND (u.email LIKE ? OR u.display_name LIKE ? OR u.phone LIKE ?)"
        values.extend((f"%{search[:120]}%", f"%{search[:120]}%", f"%{search[:120]}%"))
    query += " ORDER BY u.created_at DESC LIMIT ? OFFSET ?"
    values.extend((min(max(limit, 1), 100), max(offset, 0)))
    with _db() as c:
        rows = [dict(row) for row in c.execute(query, values)]
        for row in rows:
            preferences = c.execute("SELECT preferences FROM user_preferences WHERE user_id=?",
                                    (row["user_id"],)).fetchone()
            stored = json.loads(preferences["preferences"]) if preferences else {}
            row["email_notifications"] = bool(stored.get("email_notifications", True))
        return rows


def admin_user_detail(user_id: int) -> dict | None:
    with _db() as c:
        user = c.execute("""SELECT user_id,email,display_name,phone,email_verified,role,status,created_at
            FROM users WHERE user_id=?""", (user_id,)).fetchone()
        if user is None:
            return None
        preference_row = c.execute("SELECT preferences FROM user_preferences WHERE user_id=?",
                                   (user_id,)).fetchone()
        preferences = json.loads(preference_row["preferences"]) if preference_row else {
            "email_notifications": True, "product_updates": True,
        }
    history_rows = history(user_id, limit=100)
    return {
        "user": dict(user),
        "account": account_summary(user_id),
        "preferences": preferences,
        "history": [{key: row[key] for key in (
            "history_id", "job_id", "tool_type", "source", "status", "created_at"
        )} for row in history_rows],
        "tickets": user_tickets(user_id),
        "notifications": user_notifications(user_id),
    }


def admin_jobs(limit: int = 100) -> list[dict]:
    with _db() as c:
        return [dict(r) for r in c.execute("""SELECT j.job_id,j.type,j.status,j.error_message,
            j.created_at,j.expires_at,j.download_name,u.email
            FROM jobs j LEFT JOIN users u ON u.user_id=j.user_id
            ORDER BY j.created_at DESC LIMIT ?""", (min(max(limit, 1), 100),))]


def admin_payments(limit: int = 100) -> list[dict]:
    with _db() as c:
        return [dict(r) for r in c.execute("""SELECT p.*,u.email,u.display_name
            FROM payments p JOIN users u ON u.user_id=p.user_id
            ORDER BY p.created_at DESC LIMIT ?""", (min(max(limit, 1), 100),))]


def admin_tickets(limit: int = 100) -> list[dict]:
    with _db() as c:
        return [dict(r) for r in c.execute("""SELECT t.*,u.email,u.display_name
            FROM support_tickets t JOIN users u ON u.user_id=t.user_id
            ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
            t.updated_at DESC LIMIT ?""", (min(max(limit, 1), 100),))]


def user_tickets(user_id: int) -> list[dict]:
    with _db() as c:
        return [dict(r) for r in c.execute("""SELECT ticket_id,category,subject,message,status,
            admin_response,created_at,updated_at FROM support_tickets
            WHERE user_id=? ORDER BY created_at DESC LIMIT 50""", (user_id,))]


def announcements(admin: bool = False) -> list[dict]:
    now = time.time()
    query = "SELECT * FROM announcements"
    args: tuple = ()
    if not admin:
        query += " WHERE published=1 AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?)"
        args = (now, now)
    query += " ORDER BY created_at DESC LIMIT 100"
    with _db() as c:
        return [dict(r) for r in c.execute(query, args)]


def audit_logs(limit: int = 100) -> list[dict]:
    with _db() as c:
        return [dict(r) for r in c.execute("""SELECT a.log_id,a.action,a.target,a.details,a.created_at,u.email
            FROM audit_logs a JOIN users u ON u.user_id=a.admin_user_id
            ORDER BY a.created_at DESC LIMIT ?""", (min(max(limit, 1), 200),))]


def usage(days: int = 30):
    since = time.time() - days * 86400
    with _db() as c:
        daily = c.execute("SELECT date(created_at,'unixepoch') day, count(*) count FROM usage_events WHERE created_at>=? GROUP BY day ORDER BY day", (since,)).fetchall()
        types = c.execute("SELECT tool_type, count(*) count FROM usage_events WHERE created_at>=? GROUP BY tool_type ORDER BY count DESC LIMIT 12", (since,)).fetchall()
        totals = c.execute("""SELECT count(*) total,sum(status!='failed') successful,
            sum(status='failed') failed FROM usage_events WHERE created_at>=?""", (since,)).fetchone()
        sources = c.execute("""SELECT source,count(*) count FROM usage_events
            WHERE created_at>=? GROUP BY source ORDER BY count DESC""", (since,)).fetchall()
    total = totals["total"] or 0
    successful = totals["successful"] or 0
    return {
        "days": days, "total": total, "successful": successful, "failed": totals["failed"] or 0,
        "success_rate": round(successful * 100 / total, 1) if total else 0,
        "sources": [dict(r) for r in sources],
        "daily": [dict(r) for r in daily], "types": [dict(r) for r in types],
    }


def cleanup_expired_history() -> None:
    cutoff = time.time() - config.HISTORY_TTL_SEC
    with _db() as c:
        c.execute("DELETE FROM conversion_history WHERE created_at < ?", (cutoff,))
        c.execute("DELETE FROM usage_events WHERE created_at < ?", (cutoff,))
