import gzip

import pytest

from app import result_cache


@pytest.fixture
def cache(tmp_path, monkeypatch):
    monkeypatch.setenv("LIMITLAB_CACHE_DIR", str(tmp_path))
    monkeypatch.delenv("LIMITLAB_CACHE", raising=False)
    monkeypatch.setattr(result_cache, "_fingerprint", "codeA")
    result_cache.clear_memory()
    yield tmp_path
    result_cache.clear_memory()


def counter():
    calls = []

    def compute():
        calls.append(1)
        return {"laps": (1, 2), "n": len(calls)}

    return compute, calls


def test_computes_once_then_serves_from_memory(cache):
    compute, calls = counter()
    first = result_cache.cached("ns", {"a": 1}, compute)
    second = result_cache.cached("ns", {"a": 1}, compute)
    assert len(calls) == 1
    assert first == second == {"laps": [1, 2], "n": 1}  # tuples normalised on the fresh path too


def test_survives_a_restart_via_disk(cache):
    compute, calls = counter()
    result_cache.cached("ns", {"a": 1}, compute)
    result_cache.clear_memory()  # what a new server process sees
    assert result_cache.cached("ns", {"a": 1}, compute) == {"laps": [1, 2], "n": 1}
    assert len(calls) == 1


def test_key_order_does_not_matter_but_values_do(cache):
    compute, calls = counter()
    result_cache.cached("ns", {"a": 1, "b": 2}, compute)
    result_cache.cached("ns", {"b": 2, "a": 1}, compute)
    assert len(calls) == 1
    result_cache.cached("ns", {"a": 1, "b": 3}, compute)
    result_cache.cached("other", {"a": 1, "b": 2}, compute)
    assert len(calls) == 3


def test_code_change_invalidates_and_prunes_the_old_cache(cache, monkeypatch):
    compute, calls = counter()
    result_cache.cached("ns", {"a": 1}, compute)
    assert (cache / "codeA").is_dir()
    result_cache.clear_memory()
    monkeypatch.setattr(result_cache, "_fingerprint", "codeB")
    assert result_cache.cached("ns", {"a": 1}, compute)["n"] == 2
    assert not (cache / "codeA").exists()
    assert (cache / "codeB").is_dir()


def test_corrupt_file_is_recomputed(cache):
    compute, calls = counter()
    result_cache.cached("ns", {"a": 1}, compute)
    (path,) = (cache / "codeA" / "ns").glob("*.json.gz")
    path.write_bytes(b"not gzip")
    result_cache.clear_memory()
    assert result_cache.cached("ns", {"a": 1}, compute)["n"] == 2
    with gzip.open(path, "rt") as f:  # and the good result replaced it
        assert '"n":2' in f.read()


def test_disabled(cache, monkeypatch):
    monkeypatch.setenv("LIMITLAB_CACHE", "0")
    compute, calls = counter()
    result_cache.cached("ns", {"a": 1}, compute)
    result_cache.cached("ns", {"a": 1}, compute)
    assert len(calls) == 2
    assert not any(cache.iterdir())


def test_unwritable_directory_still_returns_the_result(tmp_path, monkeypatch):
    blocker = tmp_path / "file"
    blocker.write_text("x")
    monkeypatch.setenv("LIMITLAB_CACHE_DIR", str(blocker / "sub"))  # parent is a file
    monkeypatch.setattr(result_cache, "_fingerprint", "codeA")
    result_cache.clear_memory()
    compute, calls = counter()
    assert result_cache.cached("ns", {"a": 1}, compute)["n"] == 1


def test_real_fingerprint_is_stable():
    result_cache._fingerprint = None
    first = result_cache.fingerprint()
    result_cache._fingerprint = None
    assert result_cache.fingerprint() == first and len(first) == 16
