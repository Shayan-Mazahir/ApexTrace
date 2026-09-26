"""Replay construction and (de)serialisation.

A replay bundles track geometry, downsampled ground-truth frames, key events
and the run summary. It can always be regenerated exactly from its
(scenario, configuration) pair, which is what the API does; files are an
optional cache for demos and offline inspection.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.schemas import (
    BrakingZoneInfo,
    ConfigurationName,
    CornerInfo,
    Replay,
    ReplayEvent,
    Scenario,
    TrackGeometry,
    WarningLevel,
)
from app.sim import constants as C
from app.sim.simulator import Simulator
from app.sim.track import Track, get_track

GEOMETRY_STEP = 2.0  # metres between exported geometry points


def track_geometry(track: Track, step: float = GEOMETRY_STEP) -> TrackGeometry:
    stride = max(1, int(round(step / (track.s[1] - track.s[0]))))
    idx = list(range(0, len(track.s), stride))
    if idx[-1] != len(track.s) - 1:
        idx.append(len(track.s) - 1)
    left, right = track.boundaries

    def pts(a):
        return [(round(float(a[i, 0]), 3), round(float(a[i, 1]), 3)) for i in idx]

    return TrackGeometry(
        name=track.name,
        display_name=track.profile.display_name,
        purpose=track.profile.purpose,
        width=track.width,
        min_width=float(track.widths.min()),
        length=track.length,
        closed=True,
        centerline=pts(track.xy),
        left_boundary=pts(left),
        right_boundary=pts(right),
        corners=[
            CornerInfo(name=c.name, s_entry=c.s_entry, s_exit=c.s_exit, curvature=c.curvature,
                       radius=c.radius, direction=c.direction, width=c.width)
            for c in track.corners
        ],
        braking_zones=[BrakingZoneInfo(corner=z.corner, s_start=z.s_start, s_end=z.s_end) for z in track.braking_zones],
        telemetry_shadow_zones=[(round(a, 3), round(b, 3)) for a, b in track.shadow_zones],
    )


def get_track_geometry(name: str) -> TrackGeometry:
    return track_geometry(get_track(name))


def build_replay(
    scenario: Scenario,
    configuration: ConfigurationName = ConfigurationName.BASELINE,
    sample_hz: float = 20.0,
) -> Replay:
    sim = Simulator(scenario, configuration, record=True)
    result = sim.run(include_telemetry=False)
    frames = sim.telemetry()

    events: list[ReplayEvent] = []
    prev = (WarningLevel.SAFE, None)
    for f in frames:
        if (f.warning, f.warning_corner) != prev and f.warning is not WarningLevel.SAFE:
            kind = "caution_shown" if f.warning is WarningLevel.CAUTION else "brake_now_shown"
            events.append(ReplayEvent(timestamp=f.timestamp, kind=kind,
                                      detail=f"{f.warning_corner} (source={f.warning_source.value})"))
        prev = (f.warning, f.warning_corner)
    for c in result.metrics.corners:
        events.append(ReplayEvent(timestamp=sim.track_state.corners[c.name].entry_time, kind="corner_entry",
                                  detail=f"{c.name} speed={c.entry_speed:.1f} m/s"))
    if result.failure_timestamp is not None:
        events.append(ReplayEvent(timestamp=result.failure_timestamp, kind="left_track", detail=result.failure_corner))
    if result.metrics.lap_completed:
        events.append(ReplayEvent(timestamp=result.metrics.lap_time, kind="lap_completed",
                                  detail=f"lap time {result.metrics.lap_time:.2f} s"))
    events.append(ReplayEvent(timestamp=frames[-1].timestamp, kind="finished"))
    events.sort(key=lambda e: e.timestamp)

    stride = max(1, int(round((1.0 / sample_hz) / C.DT)))
    sampled = frames[::stride]
    if sampled[-1] is not frames[-1]:
        sampled.append(frames[-1])

    return Replay(
        replay_id=f"{scenario.scenario_id}:{configuration.value}:{scenario.seed}",
        scenario=sim.scenario,
        configuration=configuration,
        sample_hz=1.0 / (stride * C.DT),
        track=track_geometry(sim.track),
        frames=sampled,
        events=events,
        result=result,
    )


def save_replay(replay: Replay, path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(replay.model_dump_json())
    return path


def load_replay(path: str | Path) -> Replay:
    return Replay.model_validate(json.loads(Path(path).read_text()))
