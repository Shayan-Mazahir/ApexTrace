"""Driver leaderboard: each finished session's safety report, kept on disk.

The Drive screen measures a real person's reactions to the BRAKE warning
(time from the warning appearing to the brake going on), their incidents and
their best lap, and scores them. Posting that here lets a room full of people
compare — and, more usefully, collects how fast real drivers actually react,
against the 0.25-0.40 s the stress suite's scripted driver assumes.

Stored as one small JSON file (backend/.data/, git-ignored; LIMITLAB_DATA_DIR
moves it), written atomically, so it survives restarts with no database.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field, field_validator

from app.schemas import TrackId

router = APIRouter()

MAX_ENTRIES = 500  # per file; the lowest scores are dropped past this
TOP_N = 10
_lock = threading.Lock()


def data_file() -> Path:
    root = Path(os.environ.get("LIMITLAB_DATA_DIR") or Path(__file__).resolve().parents[1] / ".data")
    return root / "leaderboard.json"


class LeaderboardSubmission(BaseModel):
    name: str = Field(min_length=1, max_length=24)
    track: TrackId
    score: int = Field(ge=0, le=100)
    best_lap_s: float | None = Field(default=None, gt=0, lt=3600)
    reaction_avg_s: float | None = Field(default=None, ge=0, le=10)
    warnings: int = Field(default=0, ge=0, le=10_000)
    heeded: int = Field(default=0, ge=0, le=10_000)
    barrier_hits: int = Field(default=0, ge=0, le=10_000)

    @field_validator("name")
    @classmethod
    def tidy_name(cls, v: str) -> str:
        v = " ".join(v.split())  # no newlines or runs of spaces on a shared screen
        if not v:
            raise ValueError("name is empty")
        return v


class LeaderboardEntry(LeaderboardSubmission):
    id: int
    created: float  # unix seconds


class LeaderboardResponse(BaseModel):
    track: TrackId
    entries: list[LeaderboardEntry]
    total: int  # all entries for the track, not just the top ones
    reaction_avg_s: float | None  # mean over every entry that measured one
    rank: int | None = None  # 1-based rank of the entry just submitted


def _load() -> list[dict[str, Any]]:
    try:
        data = json.loads(data_file().read_text())
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _save(entries: list[dict[str, Any]]) -> None:
    path = data_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(entries, f)
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise


def _order(e: dict[str, Any]) -> tuple:
    # best score first; ties to the faster lap, then whoever got there first
    lap = e.get("best_lap_s")
    return (-e["score"], lap if lap is not None else float("inf"), e["created"])


def board(track: str, entries: list[dict[str, Any]], rank_of: int | None = None) -> LeaderboardResponse:
    mine = sorted((e for e in entries if e["track"] == track), key=_order)
    reactions = [e["reaction_avg_s"] for e in mine if e.get("reaction_avg_s") is not None]
    rank = next((i + 1 for i, e in enumerate(mine) if e["id"] == rank_of), None) if rank_of is not None else None
    return LeaderboardResponse(
        track=track,
        entries=[LeaderboardEntry(**e) for e in mine[:TOP_N]],
        total=len(mine),
        reaction_avg_s=round(sum(reactions) / len(reactions), 3) if reactions else None,
        rank=rank,
    )


@router.get("/leaderboard", response_model=LeaderboardResponse)
def get_leaderboard(track: TrackId = "monza") -> LeaderboardResponse:
    with _lock:
        return board(track, _load())


@router.post("/leaderboard", response_model=LeaderboardResponse)
def submit(entry: LeaderboardSubmission) -> LeaderboardResponse:
    with _lock:
        entries = _load()
        new = {**entry.model_dump(), "heeded": min(entry.heeded, entry.warnings),
               "id": max((e["id"] for e in entries), default=0) + 1, "created": time.time()}
        entries.append(new)
        if len(entries) > MAX_ENTRIES:
            entries = sorted(entries, key=_order)[:MAX_ENTRIES]
        _save(entries)
        return board(entry.track, entries, rank_of=new["id"])
