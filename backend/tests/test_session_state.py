import json

from app.placeholder_sim import TRACK_PRESETS, DemoVehicleState
from app.scenarios import SCENARIOS
from app.schemas import FaultState
from app.session_state import TICK_DT, Session, handle_raw_message
from app.sessions import SESSIONS, cleanup_stale_sessions


def make_session(track="baku") -> Session:
    return Session(session_id="t", track_profile=TRACK_PRESETS[track])


def control(**overrides) -> str:
    body = {
        "type": "control_input",
        "seq": 1,
        "session_id": "t",
        "track": "baku",
        "seed": 1,
        "t_client": 0,
        "steering": 0.0,
        "throttle": 0.0,
        "brake": 0.0,
    }
    body.update(overrides)
    return json.dumps(body)


# --- validation / malformed input ---------------------------------------


def test_control_input_is_clamped_and_stamps_packet_time():
    session = make_session()
    replies = handle_raw_message(session, "driver", control(steering=5, throttle=-2, brake=0.5))
    assert replies == []
    assert session.control == {"steering": 1.0, "throttle": 0.0, "brake": 0.5}
    assert session.last_control_received_at is not None


def test_malformed_messages_return_errors_and_leave_state_untouched():
    session = make_session()
    before = (dict(session.control), session.running, session.manual_faults)
    bad = [
        "not json at all",
        "[]",
        "null",
        json.dumps({"type": "nope"}),
        json.dumps({"no_type": True}),
        control(steering="left"),
        control(steering=float("nan")),
        json.dumps({"type": "set_faults", "faults": {"grip_multiplier": 0.1}}),
        "x" * 20_000,
    ]
    for text in bad:
        replies = handle_raw_message(session, "engineer" if "faults" in text else "driver", text)
        assert len(replies) == 1 and replies[0]["type"] == "error", text[:40]
    assert (dict(session.control), session.running, session.manual_faults) == before


def test_role_permissions_are_enforced():
    session = make_session()
    faults = json.dumps({"type": "set_faults", "faults": {"grip_multiplier": 0.8}})
    assert handle_raw_message(session, "driver", faults)[0]["code"] == "forbidden"
    assert handle_raw_message(session, "engineer", control())[0]["code"] == "forbidden"
    assert session.manual_faults.grip_multiplier == 1.0


def test_pause_resume_reset():
    session = make_session()
    handle_raw_message(session, "driver", json.dumps({"type": "pause"}))
    assert session.running is False
    handle_raw_message(session, "engineer", json.dumps({"type": "resume"}))
    assert session.running is True

    old_run = session.run_id
    session.vehicle = DemoVehicleState(x=42.0)
    handle_raw_message(session, "driver", json.dumps({"type": "reset"}))
    assert session.vehicle.x == 0.0
    assert session.run_id != old_run
    assert session.outbox[-1]["type"] == "session_info"
    assert session.outbox[-1]["run_id"] == session.run_id


# --- faults + scenarios --------------------------------------------------


def test_set_faults_applies_within_bounds():
    session = make_session()
    msg = {"type": "set_faults", "faults": {"grip_multiplier": 0.7, "telemetry_delay_ms": 250}}
    assert handle_raw_message(session, "engineer", json.dumps(msg)) == []
    assert session.effective_faults().grip_multiplier == 0.7
    assert session.effective_faults().telemetry_delay_ms == 250


def test_scenario_faults_only_apply_inside_their_window_and_combine_worst_case():
    session = make_session("monza")
    scenario = SCENARIOS["monza_high_speed_braking"]
    session.launch_scenario(scenario)
    session.manual_faults = FaultState(grip_multiplier=0.7, telemetry_delay_ms=100)

    session.vehicle = DemoVehicleState(distance_along_lap=scenario.onset_distance - 1)
    assert session.effective_faults() == session.manual_faults

    session.vehicle = DemoVehicleState(distance_along_lap=scenario.onset_distance + 1)
    effective = session.effective_faults()
    assert effective.grip_multiplier == 0.7  # manual is worse than the scenario's 0.85
    assert effective.brake_wear == 0.75  # scenario supplies the wear
    assert effective.telemetry_delay_ms == 100

    session.vehicle = DemoVehicleState(distance_along_lap=scenario.end_distance + 1)
    assert session.effective_faults() == session.manual_faults


def test_launch_scenario_resets_run_and_sets_seed():
    session = make_session("monza")
    session.vehicle = DemoVehicleState(x=99.0)
    old_run = session.run_id
    msg = json.dumps({"type": "launch_scenario", "scenario_id": "monza_high_speed_braking"})
    assert handle_raw_message(session, "engineer", msg) == []
    assert session.vehicle.x == 0.0
    assert session.run_id != old_run
    assert session.seed == SCENARIOS["monza_high_speed_braking"].seed
    assert session.scenario is not None


def test_launch_scenario_rejects_unknown_and_wrong_track():
    session = make_session("monza")
    unknown = json.dumps({"type": "launch_scenario", "scenario_id": "nope"})
    assert handle_raw_message(session, "engineer", unknown)[0]["code"] == "unknown_scenario"
    wrong = json.dumps({"type": "launch_scenario", "scenario_id": "baku_stale_telemetry"})
    assert handle_raw_message(session, "engineer", wrong)[0]["code"] == "scenario_track_mismatch"
    assert session.scenario is None


# --- tick: fault_state / warning events / injected delay -----------------


def test_fault_state_is_only_emitted_on_change():
    session = make_session()
    first = session.tick(now=session.start_time + TICK_DT)
    assert [m["type"] for m in first].count("fault_state") == 1
    second = session.tick(now=session.start_time + 2 * TICK_DT)
    assert [m["type"] for m in second].count("fault_state") == 0

    session.manual_faults = FaultState(grip_multiplier=0.8)
    third = session.tick(now=session.start_time + 3 * TICK_DT)
    assert [m["type"] for m in third].count("fault_state") == 1


def approach_session(delay_ms: float) -> Session:
    session = make_session("baku")  # turn1 hazard starts at 250m
    session.manual_faults = FaultState(telemetry_delay_ms=delay_ms)
    session.vehicle = DemoVehicleState(
        x=190.0, y=0.0, speed=30.0, nearest_point_index=47, distance_along_lap=188.0
    )
    session.control["throttle"] = 0.3
    return session


def first_warning_tick(session: Session) -> tuple[int, dict]:
    for i in range(1, 200):
        for message in session.tick(now=session.start_time + i * TICK_DT):
            if message["type"] == "warning_event" and message["active"]:
                return i, message
    raise AssertionError("no warning raised")


def test_warning_event_has_reason_zone_and_sequence():
    tick, event = first_warning_tick(approach_session(0))
    assert event["seq"] == 1
    assert event["hazard_id"] == "turn1"
    assert "Turn 1" in event["reason"]


def test_injected_delay_makes_the_warning_arrive_late():
    on_time, _ = first_warning_tick(approach_session(0))
    late, event = first_warning_tick(approach_session(400))
    assert late - on_time >= 6  # ~400 ms at 20 Hz, minus edge effects
    assert event["seq"] == 1


def test_delayed_distance_uses_the_sample_from_delay_ago():
    session = make_session()
    session.history.extend([(0.0, 100.0), (0.1, 110.0), (0.2, 120.0)])
    session.vehicle = DemoVehicleState(distance_along_lap=120.0)
    assert session._delayed_distance(now=0.2, delay_ms=0) == 120.0
    assert session._delayed_distance(now=0.2, delay_ms=150) == 100.0
    assert session._delayed_distance(now=0.2, delay_ms=50) == 110.0


def test_vehicle_state_reports_injected_delay_separately_from_packet_age():
    session = make_session()
    session.manual_faults = FaultState(telemetry_delay_ms=300)
    messages = session.tick(now=session.start_time + TICK_DT)
    state = next(m for m in messages if m["type"] == "vehicle_state")
    assert state["injected_delay_ms"] == 300
    assert state["packet_age_ms"] == 0.0  # no control received yet: measured, not injected


# --- stale session cleanup ----------------------------------------------


def test_cleanup_removes_only_idle_disconnected_sessions():
    SESSIONS.clear()
    idle = Session(session_id="idle", track_profile=TRACK_PRESETS["monza"])
    busy = Session(session_id="busy", track_profile=TRACK_PRESETS["monza"])
    busy.clients[object()] = "driver"
    fresh = Session(session_id="fresh", track_profile=TRACK_PRESETS["monza"])
    idle.last_active = 0.0
    busy.last_active = 0.0
    fresh.last_active = 1000.0
    SESSIONS.update({"idle": idle, "busy": busy, "fresh": fresh})

    removed = cleanup_stale_sessions(now=1100.0, ttl=300.0)

    assert removed == ["idle"]
    assert set(SESSIONS) == {"busy", "fresh"}
    SESSIONS.clear()
