"""Persistent cache for deterministic results (the evaluation suite, replays).

Every stored result is a pure function of the request and of the code and
data that produced it: the Python under app/, config/, scenarios/ and the
TCN checkpoints. The cache directory is keyed by a fingerprint of all of
those, so editing the simulator, an upgrade price or a scenario starts a
fresh cache (and prunes the stale one) instead of serving old numbers.

Best effort throughout: an unreadable or unwritable cache just means the
result is computed again. LIMITLAB_CACHE_DIR moves it, LIMITLAB_CACHE=0
turns it off.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import shutil
import tempfile
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
# What a cached result can depend on. Globs are relative to ROOT.
INPUTS = ("backend/app/**/*.py", "config/**/*.json", "scenarios/**/*.json", "backend/models/tcn/*")
MEMORY_ITEMS = 24  # replays are ~1 MB each in memory

_lock = threading.Lock()
_fingerprint: str | None = None
_memory: OrderedDict[str, Any] = OrderedDict()


def enabled() -> bool:
    return os.environ.get("LIMITLAB_CACHE", "1") != "0"


def cache_root() -> Path:
    return Path(os.environ.get("LIMITLAB_CACHE_DIR") or BACKEND / ".cache" / "results")


def fingerprint() -> str:
    """Hash of every input file's path and contents (computed once per process)."""
    global _fingerprint
    if _fingerprint is None:
        h = hashlib.sha256()
        files = sorted({p for pattern in INPUTS for p in ROOT.glob(pattern) if p.is_file()})
        for path in files:
            h.update(path.relative_to(ROOT).as_posix().encode())
            h.update(hashlib.sha256(path.read_bytes()).digest())
        _fingerprint = h.hexdigest()[:16]
    return _fingerprint


def _key_hash(namespace: str, key: Any) -> str:
    raw = json.dumps([namespace, key], sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def _path(namespace: str, digest: str) -> Path:
    return cache_root() / fingerprint() / namespace / f"{digest}.json.gz"


def _prune_stale() -> None:
    """Drop cache directories written by other versions of the code."""
    root = cache_root()
    if not root.is_dir():
        return
    for child in root.iterdir():
        if child.is_dir() and child.name != fingerprint():
            shutil.rmtree(child, ignore_errors=True)


def _read(path: Path) -> Any | None:
    try:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError, EOFError):
        return None


def _write(path: Path, value: Any) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as raw, gzip.open(raw, "wt", encoding="utf-8", compresslevel=5) as f:
                json.dump(value, f, separators=(",", ":"))
            os.replace(tmp, path)  # atomic: a reader never sees half a file
        except BaseException:
            os.unlink(tmp)
            raise
    except OSError:
        pass


def cached(namespace: str, key: Any, compute: Callable[[], Any]) -> Any:
    """Return the stored result for (namespace, key), computing and storing it on a miss.

    Values must be JSON-serialisable. Callers get a shared object: don't mutate it.
    """
    if not enabled():
        return compute()
    digest = _key_hash(namespace, key)
    mem_key = f"{namespace}/{digest}"
    with _lock:
        if mem_key in _memory:
            _memory.move_to_end(mem_key)
            return _memory[mem_key]
    path = _path(namespace, digest)
    value = _read(path) if path.exists() else None
    if value is None:
        # normalise to plain JSON types, so a fresh result and a stored one are identical
        value = json.loads(json.dumps(compute(), default=str))
        _prune_stale()
        _write(path, value)
    with _lock:
        _memory[mem_key] = value
        while len(_memory) > MEMORY_ITEMS:
            _memory.popitem(last=False)
    return value


def contains(namespace: str, key: Any) -> bool:
    """Whether a result is already stored (in memory or on disk)."""
    digest = _key_hash(namespace, key)
    with _lock:
        if f"{namespace}/{digest}" in _memory:
            return True
    return enabled() and _path(namespace, digest).exists()


def clear_memory() -> None:
    with _lock:
        _memory.clear()
