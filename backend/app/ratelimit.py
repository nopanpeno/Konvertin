import threading
import time
from collections import defaultdict, deque

from . import config

_hits: dict[str, deque] = defaultdict(deque)
_auth_hits: dict[str, deque] = defaultdict(deque)
_usage_hits: dict[str, deque] = defaultdict(deque)
_lock = threading.Lock()


def allow(ip: str) -> bool:
    now = time.time()
    with _lock:
        q = _hits[ip]
        while q and now - q[0] > config.RATE_LIMIT_WINDOW_SEC:
            q.popleft()
        if len(q) >= config.RATE_LIMIT_JOBS:
            return False
        q.append(now)
        return True


def reset() -> None:
    with _lock:
        _hits.clear()
        _auth_hits.clear()
        _usage_hits.clear()


def allow_auth(ip: str) -> bool:
    """Keep login and registration attempts separate from conversion quotas."""
    now = time.time()
    with _lock:
        q = _auth_hits[ip]
        while q and now - q[0] > 900:
            q.popleft()
        if len(q) >= 10:
            return False
        q.append(now)
        return True


def allow_usage(ip: str) -> bool:
    now = time.time()
    with _lock:
        q = _usage_hits[ip]
        while q and now - q[0] > 900:
            q.popleft()
        if len(q) >= 120:
            return False
        q.append(now)
        return True
