"""Random fault scenarios from the implemented primitives (bounded by the
catalogue). Used for dataset generation and as the RL baseline."""

from __future__ import annotations

import random

from app.placeholder_sim import TRACK_PRESETS
from app.stress.spec import CATALOG, DriverConfig, FaultSpec, StartConfig, StressScenario

RANDOM_FAULT_TYPES = [
    "grip_loss", "grip_estimate_lag", "brake_fade", "uplink_delay", "uplink_blackout", "uplink_loss",
    "speed_bias", "sensor_freeze", "downlink_delay", "brake_actuation_delay", "position_offset",
    "driver_reaction_delay", "warning_compute_delay",
]


def random_fault(rng: random.Random, fid: str, zone_id: str) -> FaultSpec:
    ftype = rng.choice(RANDOM_FAULT_TYPES)
    ft = CATALOG[ftype]
    params = {}
    for p in ft.params:
        if p.name in ("channel", "release_buffer"):
            params[p.name] = float(rng.randint(int(p.min), int(p.max)))
        else:
            params[p.name] = round(rng.uniform(p.min, p.max), 3)
    if rng.random() < 0.6:
        trigger = {"kind": "zone", "zone_id": zone_id, "pad_m": round(rng.uniform(0, 400), 1)}
    else:
        trigger = {"kind": "always"}
    return FaultSpec.model_validate({"id": fid, "type": ftype, "parameters": params, "trigger": trigger,
                                     "source": "random", "seed": rng.randint(0, 10**6)})


def random_scenario(rng: random.Random, track: str | None = None, segment: bool = True,
                    max_faults: int = 3, clean_prob: float = 0.2) -> StressScenario:
    track = track or rng.choice(["monza", "baku"])
    profile = TRACK_PRESETS[track]
    hazard = rng.choice(profile.hazard_zones)
    n = 0 if rng.random() < clean_prob else rng.randint(1, max_faults)
    faults = [random_fault(rng, f"r{i}", hazard.id) for i in range(n)]
    seed = rng.randint(1, 10**6)
    driver = DriverConfig(cruise_speed_ms=round(rng.uniform(76, 88), 1), reaction_s=round(rng.uniform(0.25, 0.45), 2))
    if segment:
        # start on a straight, early enough to settle (>= 2.5 s of history)
        # before the target corner
        total = profile.total_length
        start_d = (hazard.start_distance - 650) % total
        for _ in range(30):
            d = (hazard.start_distance - rng.uniform(450, 900)) % total
            if not any(h.start_distance - 80 <= d <= h.end_distance + 60 for h in profile.hazard_zones):
                start_d = d
                break
        start = StartConfig(distance_m=round(start_d, 1), speed_ms=round(rng.uniform(40, 70), 1),
                            lateral_offset_m=round(rng.uniform(-1.0, 1.0), 2))
        return StressScenario(id=f"rand_{seed}", name="random segment", track=track, seed=seed, faults=faults,
                              start=start, driver=driver, segment_length_m=1100.0, max_time_s=60.0, source="random")
    return StressScenario(id=f"rand_{seed}", name="random lap", track=track, seed=seed, faults=faults,
                          driver=driver, source="random", start=StartConfig(lateral_offset_m=round(rng.uniform(-1, 1), 2)))
