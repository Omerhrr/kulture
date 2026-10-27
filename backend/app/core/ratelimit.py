"""Small in-memory sliding-window limiter (single backend process).

Used for sign-up and login: per-IP limits are generous because many players
share one IP on mobile networks; the tight limit is failed logins per
username, which is what stops password guessing.
"""

from __future__ import annotations

import time
from collections import deque


class SlidingWindow:
    def __init__(self, limit: int, window_s: float, max_keys: int = 50_000) -> None:
        self.limit = limit
        self.window = window_s
        self.max_keys = max_keys
        self._hits: dict[str, deque[float]] = {}

    def _trim(self, key: str, now: float) -> deque[float]:
        q = self._hits.get(key)
        if q is None:
            if len(self._hits) >= self.max_keys:  # bound memory under abuse
                self._hits.clear()
            q = self._hits[key] = deque()
        while q and now - q[0] > self.window:
            q.popleft()
        return q

    def blocked(self, key: str) -> float:
        """Seconds until `key` may try again (0 = allowed). Doesn't count."""
        now = time.monotonic()
        q = self._trim(key, now)
        if len(q) >= self.limit:
            return max(1.0, self.window - (now - q[0]))
        return 0.0

    def hit(self, key: str) -> None:
        now = time.monotonic()
        self._trim(key, now).append(now)

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)
