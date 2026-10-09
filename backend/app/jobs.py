"""Tabel job (SQLite), antrean worker, dan pembersihan otomatis.

Antarmuka sengaja kecil (create/get/cancel/cleanup) supaya nanti bisa diganti
Redis + RQ/Celery tanpa mengubah API di main.py.
"""
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import config
from .validation import CONVERSIONS

_lock = threading.Lock()
_procs: dict[str, subprocess.Popen] = {}
_executor: ThreadPoolExecutor | None = None


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    global _executor
    config.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    with _db() as c:
        c.execute(
            """CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY, type TEXT NOT NULL, options TEXT NOT NULL DEFAULT '{}',
                input_key TEXT, output_key TEXT, download_name TEXT,
                status TEXT NOT NULL, error_message TEXT,
                created_at REAL NOT NULL, expires_at REAL NOT NULL)"""
        )
        # job yang tertinggal dari proses sebelumnya tidak akan pernah selesai
        c.execute("UPDATE jobs SET status='failed', error_message='Server dimulai ulang. Coba lagi.' WHERE status IN ('queued','processing')")
    _executor = ThreadPoolExecutor(max_workers=config.WORKERS, thread_name_prefix="worker")


def shutdown() -> None:
    if _executor:
        _executor.shutdown(wait=False, cancel_futures=True)


def create(job_type: str, input_path: Path, original_name: str, options: dict | None = None) -> str:
    """input_path sudah tervalidasi. Pindahkan ke storage dengan nama acak lalu antrekan."""
    job_id = str(uuid.uuid4())
    in_key = f"{uuid.uuid4().hex}.in"
    shutil.move(str(input_path), config.STORAGE_DIR / in_key)
    stem = Path(original_name).stem[:80] or "dokumen"
    stem = "".join(ch for ch in stem if ch not in '\\/:*?"<>|\r\n\t') or "dokumen"
    download_name = f"{stem}.{CONVERSIONS[job_type][1]}"
    now = time.time()
    import json

    with _lock, _db() as c:
        c.execute(
            "INSERT INTO jobs (job_id,type,options,input_key,download_name,status,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)",
            (job_id, job_type, json.dumps(options or {}), in_key, download_name, "queued", now, now + config.FILE_TTL_SEC),
        )
    _executor.submit(_run, job_id)
    return job_id


def get(job_id: str) -> sqlite3.Row | None:
    with _db() as c:
        return c.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()


def _set(job_id: str, **fields) -> None:
    cols = ", ".join(f"{k}=?" for k in fields)
    with _lock, _db() as c:
        c.execute(f"UPDATE jobs SET {cols} WHERE job_id=?", (*fields.values(), job_id))


def _limits() -> None:  # dijalankan di child sebelum exec
    import resource

    mem = config.JOB_MEMORY_MB * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
    resource.setrlimit(resource.RLIMIT_CPU, (config.JOB_TIMEOUT_SEC + 10,) * 2)
    os.setsid()


def _run(job_id: str) -> None:
    row = get(job_id)
    if row is None or row["status"] != "queued":
        return
    _set(job_id, status="processing")
    in_path = config.STORAGE_DIR / row["input_key"]
    out_key = f"{uuid.uuid4().hex}.out"
    out_path = config.STORAGE_DIR / out_key
    backend_dir = Path(__file__).resolve().parents[1]
    try:
        # LibreOffice butuh memori virtual besar: batas RLIMIT_AS hanya untuk non-soffice
        preexec = os.setsid if row["type"].endswith("_to_pdf") else _limits
        p = subprocess.Popen(
            [sys.executable, "-m", "app.converters", row["type"], str(in_path), str(out_path)],
            cwd=backend_dir, env={**os.environ, "PYTHONPATH": str(backend_dir), "HOME": str(config.DATA_DIR)},
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, preexec_fn=preexec,
        )
        with _lock:
            _procs[job_id] = p
        try:
            _, err = p.communicate(timeout=config.JOB_TIMEOUT_SEC)
        except subprocess.TimeoutExpired:
            _kill(p)
            _set(job_id, status="failed", error_message="Konversi terlalu lama dan dihentikan. Coba file yang lebih kecil.")
            return
        finally:
            with _lock:
                _procs.pop(job_id, None)
        cur = get(job_id)
        if cur is None or cur["status"] != "processing":  # dibatalkan
            out_path.unlink(missing_ok=True)
            return
        if p.returncode == 0 and out_path.exists():
            _set(job_id, status="done", output_key=out_key)
        else:
            msg = next((l[5:] for l in (err or "").splitlines() if l.startswith("USER:")), None)
            if msg is None:
                print(f"[job {job_id}] gagal: {(err or '').strip()[-200:]}", file=sys.stderr)  # tanpa isi file
                msg = "Terjadi kesalahan saat konversi. Coba lagi, atau coba file lain."
            _set(job_id, status="failed", error_message=msg)
    except Exception as e:
        print(f"[job {job_id}] error {type(e).__name__}", file=sys.stderr)
        _set(job_id, status="failed", error_message="Terjadi kesalahan di server. Coba lagi sebentar lagi.")
    finally:
        in_path.unlink(missing_ok=True)  # input tidak perlu disimpan setelah diproses


def _kill(p: subprocess.Popen) -> None:
    try:
        os.killpg(os.getpgid(p.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        p.kill()
    p.wait()


def cancel(job_id: str) -> bool:
    row = get(job_id)
    if row is None:
        return False
    _set(job_id, status="failed", error_message="Dibatalkan.")
    with _lock:
        p = _procs.get(job_id)
    if p:
        _kill(p)
    delete_files(job_id)
    return True


def delete_files(job_id: str) -> None:
    row = get(job_id)
    if row is None:
        return
    for key in (row["input_key"], row["output_key"]):
        if key:
            (config.STORAGE_DIR / key).unlink(missing_ok=True)


def cleanup_expired() -> int:
    now = time.time()
    with _db() as c:
        rows = c.execute("SELECT job_id FROM jobs WHERE expires_at < ?", (now,)).fetchall()
    for r in rows:
        delete_files(r["job_id"])
    with _lock, _db() as c:
        c.execute("DELETE FROM jobs WHERE expires_at < ?", (now,))
    # file yatim (tidak ada di tabel) yang lebih tua dari TTL
    known = set()
    with _db() as c:
        for r in c.execute("SELECT input_key, output_key FROM jobs"):
            known.update(k for k in (r["input_key"], r["output_key"]) if k)
    for f in config.STORAGE_DIR.iterdir():
        if f.name not in known and now - f.stat().st_mtime > config.FILE_TTL_SEC:
            f.unlink(missing_ok=True)
    return len(rows)


def cleanup_loop(stop: threading.Event) -> None:
    while not stop.wait(config.CLEANUP_INTERVAL_SEC):
        try:
            cleanup_expired()
        except Exception as e:
            print(f"[cleanup] error {type(e).__name__}", file=sys.stderr)
