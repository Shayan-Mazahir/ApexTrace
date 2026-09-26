"""Simulated faults on the path from car sensors to the safety system.

Nothing here touches wall-clock time or a real network: delay is a buffer
indexed by simulator time, loss and noise come from seeded generators, so a
given scenario seed always produces the same fault sequence.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np

from app.sim import constants as C
from app.sim.safety import Measurement
from app.sim.track import Track

# Independent random streams per fault source, so enabling one fault (or an
# upgrade that bypasses one) never shifts the random draws of another.
STREAM_REMOTE_NOISE = 1
STREAM_PACKET_LOSS = 2
STREAM_LOCAL_NOISE = 3


def rng_for(seed: int, stream: int) -> np.random.Generator:
    return np.random.default_rng([seed, stream])


@dataclass(frozen=True)
class FaultConfig:
    telemetry_delay_s: float = 0.0
    sensor_noise: float = 0.0
    packet_loss: float = 0.0


class SensorNoise:
    """Bounded Gaussian noise (clipped at +-3 sigma) on speed and track position."""

    def __init__(self, level: float, rng: np.random.Generator):
        self.level = level
        self.rng = rng

    def _draw(self, std: float) -> float:
        if std <= 0:
            return 0.0
        z = float(np.clip(self.rng.standard_normal(), -C.NOISE_CLIP_SIGMA, C.NOISE_CLIP_SIGMA))
        return z * std

    def apply(self, speed: float, s: float) -> tuple[float, float]:
        if self.level <= 0:
            return speed, s
        return (
            max(0.0, speed + self._draw(self.level * C.SPEED_NOISE_STD)),
            s + self._draw(self.level * C.POSITION_NOISE_STD),
        )


class PacketLoss:
    """Two-state (Gilbert-Elliott) burst loss.

    ``rate`` is the long-run fraction of packets lost; losses come in bursts
    averaging ``PACKET_LOSS_MEAN_BURST_TICKS`` packets so that loss actually
    produces stale telemetry rather than isolated single-packet gaps.
    """

    def __init__(self, rate: float, rng: np.random.Generator):
        self.rate = rate
        self.rng = rng
        self.in_burst = False

    def dropped(self, rate: float | None = None) -> bool:
        r = self.rate if rate is None else rate
        u = float(self.rng.random())  # always draw, keeps the stream aligned
        if r <= 0:
            self.in_burst = False
            return False
        p_end = 1.0 / C.PACKET_LOSS_MEAN_BURST_TICKS
        p_start = min(1.0, r / max(1e-9, 1.0 - r) * p_end)
        if self.in_burst:
            self.in_burst = u >= p_end
        else:
            self.in_burst = u < p_start
        return self.in_burst


class TelemetryChannel:
    """Car -> remote safety system link with delay, noise and packet loss."""

    def __init__(self, config: FaultConfig, seed: int, track: Track):
        self.config = config
        self.track = track
        self.noise = SensorNoise(config.sensor_noise, rng_for(seed, STREAM_REMOTE_NOISE))
        self.loss = PacketLoss(config.packet_loss, rng_for(seed, STREAM_PACKET_LOSS))
        self._in_flight: deque[tuple[float, Measurement]] = deque()
        self._latest: Measurement | None = None
        self.packets_sent = 0
        self.packets_dropped = 0

    def send(self, t: float, speed: float, s: float) -> bool:
        """Sample sensors at time ``t`` and transmit. Returns True if the packet was lost."""
        m_speed, m_s = self.noise.apply(speed, s)
        rate = self.config.packet_loss
        if self.track.in_shadow_zone(s):
            rate = min(0.9, rate * C.SHADOW_ZONE_LOSS_MULTIPLIER)
        self.packets_sent += 1
        if self.loss.dropped(rate):
            self.packets_dropped += 1
            return True
        # Round to the tick grid so delays line up exactly with simulator steps.
        deliver_at = round(t + self.config.telemetry_delay_s, 6)
        self._in_flight.append((deliver_at, Measurement(speed=m_speed, s=m_s, sent_at=t)))
        return False

    def receive(self, t: float) -> Measurement | None:
        """Latest packet that has arrived by time ``t`` (may be stale)."""
        while self._in_flight and self._in_flight[0][0] <= t + 1e-9:
            self._latest = self._in_flight.popleft()[1]
        return self._latest


class LocalSensor:
    """On-car measurement used by the local warning fallback: noisy, but no delay or loss."""

    def __init__(self, sensor_noise: float, seed: int):
        self.noise = SensorNoise(sensor_noise, rng_for(seed, STREAM_LOCAL_NOISE))

    def measure(self, t: float, speed: float, s: float) -> Measurement:
        m_speed, m_s = self.noise.apply(speed, s)
        return Measurement(speed=m_speed, s=m_s, sent_at=t)
