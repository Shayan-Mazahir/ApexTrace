import pytest
from fastapi.testclient import TestClient

from app import leaderboard
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("LIMITLAB_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("LIMITLAB_PREWARM", "0")
    return TestClient(app)


def post(client, **over):
    body = {"name": "Ada", "track": "monza", "score": 70, "best_lap_s": 90.0, "reaction_avg_s": 0.5,
            "warnings": 4, "heeded": 3, "barrier_hits": 0, **over}
    return client.post("/leaderboard", json=body)


def test_empty_board(client):
    r = client.get("/leaderboard?track=baku").json()
    assert r == {"track": "baku", "entries": [], "total": 0, "reaction_avg_s": None, "rank": None}


def test_ranks_by_score_then_lap_and_reports_your_rank(client):
    post(client, name="Slow", score=60)
    post(client, name="Quick", score=80, best_lap_s=95.0)
    r = post(client, name="Quicker", score=80, best_lap_s=88.0).json()
    assert [e["name"] for e in r["entries"]] == ["Quicker", "Quick", "Slow"]
    assert r["rank"] == 1 and r["total"] == 3
    assert r["reaction_avg_s"] == pytest.approx(0.5)


def test_tracks_are_separate_and_survive_a_restart(client):
    post(client, track="baku", name="B")
    post(client, track="monza", name="M")
    # a fresh process reads the same file
    assert [e.name for e in leaderboard.board("baku", leaderboard._load()).entries] == ["B"]
    assert client.get("/leaderboard?track=monza").json()["total"] == 1


def test_top_ten_only_but_total_counts_all(client):
    for i in range(12):
        post(client, name=f"D{i}", score=50 + i)
    r = client.get("/leaderboard?track=monza").json()
    assert len(r["entries"]) == 10 and r["total"] == 12
    assert r["entries"][0]["name"] == "D11"


@pytest.mark.parametrize("bad", [{"name": ""}, {"name": "   "}, {"name": "x" * 25}, {"score": 101},
                                 {"track": "spa"}, {"reaction_avg_s": -1}])
def test_rejects_bad_entries(client, bad):
    assert post(client, **bad).status_code == 422


def test_tidies_names_and_caps_heeded(client):
    r = post(client, name="  Max \n  V  ", warnings=2, heeded=5).json()
    assert r["entries"][0]["name"] == "Max V"
    assert r["entries"][0]["heeded"] == 2


def test_corrupt_file_starts_fresh(client, tmp_path):
    (tmp_path / "leaderboard.json").write_text("{not json")
    assert client.get("/leaderboard").json()["total"] == 0
    assert post(client).status_code == 200
