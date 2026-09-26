import pytest

from app.schemas import WarningLevel
from app.sim.safety import Measurement, WarningSystem
from app.sim.track import get_track
from app.sim.vehicle import max_corner_speed

TRACK = get_track("monza")
CORNER = TRACK.corners[0]


def measure(speed, dist_to_corner):
    return Measurement(speed=speed, s=CORNER.s_entry - dist_to_corner, sent_at=0.0)


def test_safe_when_far_away():
    ws = WarningSystem(estimated_grip=1.0, warning_margin=0.1)
    assert ws.evaluate(measure(80.0, 440.0), TRACK).level is WarningLevel.SAFE


def test_safe_when_slow_enough():
    ws = WarningSystem(estimated_grip=1.0, warning_margin=0.1)
    out = ws.evaluate(measure(20.0, 10.0), TRACK)
    assert out.level is WarningLevel.SAFE
    assert out.advised_speed == pytest.approx(max_corner_speed(1.0, CORNER.curvature, 0.9))


def test_warning_triggered_close_and_fast():
    ws = WarningSystem(estimated_grip=1.0, warning_margin=0.1)
    assert ws.evaluate(measure(80.0, 100.0), TRACK).level is WarningLevel.BRAKE_NOW


def test_borderline_caution_band():
    ws = WarningSystem(estimated_grip=1.0, warning_margin=0.1)
    v = 80.0
    need = ws.required_distance(v, ws.advised_speed(CORNER.curvature))
    assert ws.evaluate(measure(v, need - 0.5), TRACK).level is WarningLevel.BRAKE_NOW
    assert ws.evaluate(measure(v, need + 5.0), TRACK).level is WarningLevel.CAUTION
    assert ws.evaluate(measure(v, need * 1.5 + 25.0), TRACK).level is WarningLevel.SAFE


def test_margin_moves_warning_earlier():
    tight = WarningSystem(estimated_grip=1.0, warning_margin=0.0)
    loose = WarningSystem(estimated_grip=1.0, warning_margin=0.5)
    v_adv = tight.advised_speed(CORNER.curvature)
    assert loose.required_distance(80.0, v_adv) == pytest.approx(1.5 * tight.required_distance(80.0, v_adv))


def test_grip_mismatch_makes_system_wrong():
    """Estimated 0.85 vs actual 0.60: the system advises a speed the car cannot actually hold."""
    ws = WarningSystem(estimated_grip=0.85, warning_margin=0.1)
    advised = ws.advised_speed(CORNER.curvature)
    actual_limit = max_corner_speed(0.60, CORNER.curvature)
    assert advised > actual_limit
    # At a speed between the two, the system says SAFE right at corner entry, but the car is over the limit.
    v = 0.5 * (advised + actual_limit)
    assert ws.evaluate(measure(v, 1.0), TRACK).level is WarningLevel.SAFE


def test_degraded_braking_is_invisible_to_system():
    """The system assumes nominal brakes, so its warning distance is too short for worn brakes."""
    ws = WarningSystem(estimated_grip=1.0, warning_margin=0.0)
    v_adv = ws.advised_speed(CORNER.curvature)
    from app.sim.vehicle import braking_distance
    from app.sim import constants as C

    needed_worn = braking_distance(80.0, v_adv, 1.0 * C.GRIP_ACCEL * 0.6)
    assert ws.required_distance(80.0, v_adv) < needed_worn


def test_past_last_corner_is_safe():
    ws = WarningSystem(estimated_grip=1.0, warning_margin=0.1)
    out = ws.evaluate(Measurement(speed=90.0, s=CORNER.s_exit + 10, sent_at=0.0), TRACK)
    assert out.level is WarningLevel.SAFE


def test_no_measurement_is_safe():
    assert WarningSystem(1.0, 0.1).evaluate(None, TRACK).level is WarningLevel.SAFE
