"""Minimal account, session, conversion-history, and aggregate-usage storage."""
import hashlib
import hmac
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
    "wav-ke-mp3", "m4a-ke-mp3", "flac-ke-mp3", "gabung-pdf", "pisah-pdf", "gambar-ke-pdf",
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
    if bool(config.ADMIN_EMAIL) != bool(config.ADMIN_PASSWORD):
        raise RuntimeError("Set both KONVERTIN_ADMIN_EMAIL and KONVERTIN_ADMIN_PASSWORD to bootstrap an admin.")
    if config.ADMIN_EMAIL and (not valid_email(config.ADMIN_EMAIL) or not 10 <= len(config.ADMIN_PASSWORD) <= 256):
        raise RuntimeError("Admin bootstrap needs a valid email and a 10–256 character password.")
    with _db() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS users (
              user_id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE,
              display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
              role TEXT NOT NULL DEFAULT 'user', created_at REAL NOT NULL
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
        """)
        now = time.time()
        c.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        c.execute("DELETE FROM conversion_history WHERE created_at < ?", (now - config.HISTORY_TTL_SEC,))
        c.execute("DELETE FROM usage_events WHERE created_at < ?", (now - config.HISTORY_TTL_SEC,))
        # Admin creation is explicit and has no built-in/default password.
        if config.ADMIN_EMAIL and config.ADMIN_PASSWORD:
            row = c.execute("SELECT user_id FROM users WHERE email=?", (config.ADMIN_EMAIL,)).fetchone()
            if row is None:
                c.execute("INSERT INTO users(email,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?)",
                          (config.ADMIN_EMAIL, "Admin", _hash_password(config.ADMIN_PASSWORD), "admin", time.time()))
            else:
                c.execute("UPDATE users SET role='admin' WHERE email=?", (config.ADMIN_EMAIL,))


def valid_email(email: str) -> bool:
    parsed = parseaddr(email.strip())[1]
    return parsed == email.strip() and "@" in parsed and len(parsed) <= 254 and "." in parsed.rsplit("@", 1)[-1]


def create_user(email: str, password: str, display_name: str):
    email = email.strip().lower()
    if not valid_email(email):
        return None, "Format email tidak valid."
    if len(password) < 10 or len(password) > 256:
        return None, "Password harus 10-256 karakter."
    name = display_name.strip()
    if not name or len(name) > 80:
        return None, "Nama harus 1-80 karakter."
    try:
        with _db() as c:
            cur = c.execute("INSERT INTO users(email,display_name,password_hash,created_at) VALUES(?,?,?,?)",
                            (email, name, _hash_password(password), time.time()))
            return int(cur.lastrowid), None
    except sqlite3.IntegrityError:
        return None, "Email sudah terdaftar."


def authenticate(email: str, password: str):
    with _db() as c:
        row = c.execute("SELECT * FROM users WHERE email=?", (email.strip().lower(),)).fetchone()
    # Do a hash even for unknown email to reduce timing-based account discovery.
    if row is None:
        _check_password(password, "pbkdf2_sha256$310000$00000000000000000000000000000000$" + "00" * 32)
        return None
    return row if _check_password(password, row["password_hash"]) else None


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
        row = c.execute("SELECT u.user_id,u.email,u.display_name,u.role FROM sessions s JOIN users u USING(user_id) WHERE s.token_hash=? AND s.expires_at>?",
                        (token_hash, time.time())).fetchone()
    return row


def delete_session(token: str | None) -> None:
    if token:
        with _db() as c:
            c.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))


def update_profile(user_id: int, display_name: str):
    name = display_name.strip()
    if not name or len(name) > 80:
        return False, "Nama harus 1-80 karakter."
    with _db() as c:
        c.execute("UPDATE users SET display_name=? WHERE user_id=?", (name, user_id))
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
        return c.execute("SELECT tool_type,source,status,created_at FROM conversion_history WHERE user_id=? AND created_at>=? ORDER BY created_at DESC LIMIT ?",
                         (user_id, time.time() - config.HISTORY_TTL_SEC, limit)).fetchall()


def usage(days: int = 30):
    since = time.time() - days * 86400
    with _db() as c:
        daily = c.execute("SELECT date(created_at,'unixepoch') day, count(*) count FROM usage_events WHERE created_at>=? GROUP BY day ORDER BY day", (since,)).fetchall()
        types = c.execute("SELECT tool_type, count(*) count FROM usage_events WHERE created_at>=? GROUP BY tool_type ORDER BY count DESC LIMIT 12", (since,)).fetchall()
        total = c.execute("SELECT count(*) FROM usage_events WHERE created_at>=?", (since,)).fetchone()[0]
    return {"days": days, "total": total, "daily": [dict(r) for r in daily], "types": [dict(r) for r in types]}


def cleanup_expired_history() -> None:
    cutoff = time.time() - config.HISTORY_TTL_SEC
    with _db() as c:
        c.execute("DELETE FROM conversion_history WHERE created_at < ?", (cutoff,))
        c.execute("DELETE FROM usage_events WHERE created_at < ?", (cutoff,))
