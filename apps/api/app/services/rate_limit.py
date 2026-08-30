import asyncio
import time
from collections import OrderedDict, deque
from collections.abc import Callable


class PeerRateLimiter:
    """Application-scoped, bounded sliding-window limiter for direct socket peers."""

    def __init__(
        self,
        *,
        max_requests: int,
        window_seconds: float,
        max_clients: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if max_requests < 1 or window_seconds <= 0 or max_clients < 1:
            raise ValueError("Rate-limit bounds must be positive")
        self._max_requests = max_requests
        self._window_seconds = window_seconds
        self._max_clients = max_clients
        self._clock = clock
        self._buckets: dict[str, deque[float]] = {}
        self._lock = asyncio.Lock()

    @property
    def client_count(self) -> int:
        return len(self._buckets)

    def _remove_expired(self, now: float) -> None:
        cutoff = now - self._window_seconds
        expired_clients: list[str] = []
        for peer, timestamps in self._buckets.items():
            while timestamps and timestamps[0] <= cutoff:
                timestamps.popleft()
            if not timestamps:
                expired_clients.append(peer)
        for peer in expired_clients:
            del self._buckets[peer]

    async def allow(self, peer: str) -> bool:
        async with self._lock:
            now = self._clock()
            self._remove_expired(now)
            timestamps = self._buckets.get(peer)
            if timestamps is None:
                if len(self._buckets) >= self._max_clients:
                    return False
                timestamps = deque()
                self._buckets[peer] = timestamps
            if len(timestamps) >= self._max_requests:
                return False
            timestamps.append(now)
            return True


class LoginFailureRateLimiter:
    """Bounded, application-local failure buckets keyed by peer and username."""

    def __init__(
        self,
        *,
        max_failures: int,
        window_seconds: float,
        max_clients: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if max_failures < 1 or window_seconds <= 0 or max_clients < 1:
            raise ValueError("Rate-limit bounds must be positive")
        self._max_failures = max_failures
        self._window_seconds = window_seconds
        self._max_clients = max_clients
        self._clock = clock
        self._buckets: OrderedDict[tuple[str, str], deque[float]] = OrderedDict()
        self._lock = asyncio.Lock()

    @property
    def client_count(self) -> int:
        return len(self._buckets)

    def _remove_expired(self, now: float) -> None:
        cutoff = now - self._window_seconds
        expired: list[tuple[str, str]] = []
        for key, timestamps in self._buckets.items():
            while timestamps and timestamps[0] <= cutoff:
                timestamps.popleft()
            if not timestamps:
                expired.append(key)
        for key in expired:
            del self._buckets[key]

    async def begin_attempt(self, key: tuple[str, str]) -> bool:
        """Reserve an attempt before expensive credential verification."""
        async with self._lock:
            now = self._clock()
            self._remove_expired(now)
            timestamps = self._buckets.get(key)
            if timestamps is None:
                while len(self._buckets) >= self._max_clients:
                    self._buckets.popitem(last=False)
                timestamps = deque()
                self._buckets[key] = timestamps
            else:
                self._buckets.move_to_end(key)
            if len(timestamps) >= self._max_failures:
                return False
            timestamps.append(now)
            return True

    async def clear(self, key: tuple[str, str]) -> None:
        async with self._lock:
            self._buckets.pop(key, None)
