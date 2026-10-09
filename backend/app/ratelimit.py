import threading
import time
from collections import defaultdict, deque

from . import config

_hits: dict[str, deque] = defaultdict(deque)
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
