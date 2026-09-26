"""The TCN's declared inputs: observed telemetry only (never true grip or
hidden fault settings)."""

from __future__ import annotations

CHANNELS = [
    "speed",  # reported (sensor, may be biased/frozen)
    "steering",
    "brake",
    "throttle",
    "yaw_rate",  # onboard IMU
    "lateral",  # observed lateral offset (position sensor)
    "distance_to_corner",  # from REPORTED position, along the route
    "grip_estimate",  # the estimator's output, not true grip
    "packet_age_ms",  # warning-service data age
    "warning",  # displayed: 0 clear, 1 brake, 2 stale
]
WINDOW = 50  # samples at 20 Hz = 2.5 s
HORIZON = 20  # labels look 1.0 s ahead
HZ = 20


def vector(obs: dict) -> list[float]:
    return [
        float(obs["speed"]),
        float(obs["steering"]),
        float(obs["brake"]),
        float(obs["throttle"]),
        float(obs["yaw_rate"]),
        float(obs["lateral"]),
        min(float(obs["distance_to_corner"]), 2000.0),
        float(obs["grip_estimate"]),
        min(float(obs["packet_age_ms"]), 5000.0),
        float(obs["warning"]),
    ]
