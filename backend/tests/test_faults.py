import numpy as np
import pytest

from app.sim.faults import FaultConfig, LocalSensor, PacketLoss, SensorNoise, TelemetryChannel, rng_for
from app.sim import constants as C
from app.sim.track import get_track

MONZA = get_track("monza")
BAKU = get_track("baku")


def drive_channel(cfg, seed=7, track=MONZA, ticks=300, s0=0.0):
    ch = TelemetryChannel(cfg, seed, track)
    out = []
    for i in range(ticks):
        t = round(i * C.DT, 6)
        ch.send(t, 50.0 + i * 0.01, s0 + i * 0.5)
        out.append((t, ch.receive(t)))
    return ch, out


def test_no_faults_is_transparent():
    _, out = drive_channel(FaultConfig())
    for t, m in out:
        assert m.sent_at == t
        assert m.speed == pytest.approx(50.0 + round(t / C.DT) * 0.01)


@pytest.mark.parametrize("delay_ms", [0, 50, 100, 150, 200, 300])
def test_telemetry_delay(delay_ms):
    _, out = drive_channel(FaultConfig(telemetry_delay_s=delay_ms / 1000))
    for t, m in out:
        if t < delay_ms / 1000 - 1e-9:
            assert m is None
        else:
            assert (t - m.sent_at) == pytest.approx(delay_ms / 1000, abs=1e-6)


def test_sensor_noise_is_bounded_and_seeded():
    noise = SensorNoise(1.0, rng_for(3, 1))
    draws = [noise.apply(50.0, 100.0) for _ in range(5000)]
    dv = np.array([d[0] - 50.0 for d in draws])
    ds = np.array([d[1] - 100.0 for d in draws])
    assert np.abs(dv).max() <= 3 * C.SPEED_NOISE_STD + 1e-9
    assert np.abs(ds).max() <= 3 * C.POSITION_NOISE_STD + 1e-9
    assert dv.std() == pytest.approx(C.SPEED_NOISE_STD, rel=0.1)
    again = SensorNoise(1.0, rng_for(3, 1))
    assert again.apply(50.0, 100.0) == draws[0]


def test_zero_noise_is_exact():
    assert SensorNoise(0.0, rng_for(1, 1)).apply(42.0, 7.0) == (42.0, 7.0)


def test_packet_loss_rate_and_bursts():
    pl = PacketLoss(0.2, rng_for(11, 2))
    drops = np.array([pl.dropped() for _ in range(200_000)])
    assert drops.mean() == pytest.approx(0.2, abs=0.02)
    # Bursty: mean run length of drops is near the configured burst length.
    runs, cur = [], 0
    for d in drops:
        if d:
            cur += 1
        elif cur:
            runs.append(cur)
            cur = 0
    assert np.mean(runs) == pytest.approx(C.PACKET_LOSS_MEAN_BURST_TICKS, rel=0.15)


def test_stale_telemetry_under_packet_loss():
    ch, out = drive_channel(FaultConfig(packet_loss=0.4), ticks=2000)
    ages = [t - m.sent_at for t, m in out if m is not None]
    assert ch.packets_dropped > 0
    assert max(ages) > C.STALE_TELEMETRY_S  # receiver keeps showing an old packet


def test_baku_shadow_zone_amplifies_loss():
    zone_start = BAKU.profile.telemetry_shadow_zones[0][0]
    inside, _ = drive_channel(FaultConfig(packet_loss=0.1), track=BAKU, ticks=200, s0=zone_start)
    outside, _ = drive_channel(FaultConfig(packet_loss=0.1), track=BAKU, ticks=200, s0=0.0)
    # 200 ticks * 0.5 m from s0 covers 100 m
    assert inside.packets_dropped > outside.packets_dropped


def test_channel_is_deterministic():
    cfg = FaultConfig(telemetry_delay_s=0.1, sensor_noise=0.5, packet_loss=0.2)
    _, a = drive_channel(cfg, seed=5)
    _, b = drive_channel(cfg, seed=5)
    _, c = drive_channel(cfg, seed=6)
    assert a == b
    assert a != c


def test_local_sensor_has_no_delay():
    m = LocalSensor(0.0, 1).measure(1.23, 40.0, 10.0)
    assert (m.sent_at, m.speed, m.s) == (1.23, 40.0, 10.0)
