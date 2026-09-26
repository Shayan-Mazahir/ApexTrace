import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.placeholder_sim import TRACK_PRESETS
from app.scenarios import SCENARIOS

client = TestClient(app)


def recv_until(ws, message_type: str, limit: int = 200, where=None) -> dict:
    for _ in range(limit):
        message = ws.receive_json()
        if message["type"] == message_type and (where is None or where(message)):
            return message
    raise AssertionError(f"no {message_type!r} within {limit} messages")


def control(session_id: str, track: str = "monza", **overrides) -> dict:
    body = {
        "type": "control_input",
        "seq": 1,
        "session_id": session_id,
        "track": track,
        "seed": 1,
        "t_client": 0,
        "steering": 0.0,
        "throttle": 1.0,
        "brake": 0.0,
    }
    body.update(overrides)
    return body


def new_session(track: str = "monza", **body) -> dict:
    return client.post("/sessions", json={"track": track, **body}).json()


# --- REST ---------------------------------------------------------------


def test_list_tracks_returns_both_presets():
    body = client.get("/tracks").json()
    assert {t["id"] for t in body} == {"monza", "baku"}


def test_get_track_returns_full_profile():
    body = client.get("/tracks/baku").json()
    assert body["id"] == "baku" and len(body["hazard_zones"]) > 0


def test_create_session_returns_role_run_id_and_seed():
    body = new_session("monza")
    assert body["role"] == "driver"
    assert body["track_profile"]["id"] == "monza"
    assert len(body["run_id"]) == 8
    assert body["seed"] == TRACK_PRESETS["monza"].seed


def test_create_session_honours_requested_seed_and_engineer_role():
    body = new_session("baku", role="engineer", seed=777)
    assert body["role"] == "engineer" and body["seed"] == 777


def test_join_unknown_session_returns_404():
    assert client.post("/sessions/nope/join", json={"role": "engineer"}).status_code == 404


def test_join_existing_session_shares_run_id_and_seed():
    created = new_session("baku", seed=5)
    joined = client.post(f"/sessions/{created['session_id']}/join", json={"role": "engineer"}).json()
    assert joined["run_id"] == created["run_id"] and joined["seed"] == 5
    assert joined["track_profile"]["id"] == "baku"


def test_scenarios_endpoints():
    listed = client.get("/scenarios").json()
    assert {s["id"] for s in listed} == set(SCENARIOS)
    assert client.get("/scenarios/baku_sensor_freeze").json()["track"] == "baku"
    catalog = client.get("/faults/catalog").json()
    assert any(c["status"] == "requires_model_extension" for c in catalog)
    assert client.get("/scenarios/nope").status_code == 404


# --- WebSockets ---------------------------------------------------------


def test_unknown_session_rejects_both_socket_kinds():
    for path in ("/ws/driver/nope", "/ws/engineer/nope"):
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(path):
                pass


def test_driver_receives_full_lap_telemetry_and_heartbeat():
    sid = new_session("monza")["session_id"]
    with client.websocket_connect(f"/ws/driver/{sid}") as ws:
        assert ws.receive_json()["type"] == "session_info"
        assert ws.receive_json()["type"] == "fault_state"
        ws.send_json(control(sid))
        state = recv_until(ws, "vehicle_state")
        for field in (
            "lap_progress",
            "sector_name",
            "next_hazard_distance",
            "signed_clearance",
            "packet_age_ms",
            "injected_delay_ms",
            "warning_reason",
            "track_exit",
            "lap_complete",
        ):
            assert field in state
        assert recv_until(ws, "heartbeat")["type"] == "heartbeat"


def test_engineer_faults_reach_both_clients():
    sid = new_session("monza")["session_id"]
    with client.websocket_connect(f"/ws/driver/{sid}") as driver, client.websocket_connect(
        f"/ws/engineer/{sid}"
    ) as engineer:
        engineer.send_json(
            {"type": "add_fault", "fault": {"id": "d", "type": "uplink_delay", "parameters": {"delay_ms": 200}}}
        )
        wanted = lambda m: m["effective"]["uplink_delay_ms"] == 200
        state = recv_until(engineer, "fault_state", where=wanted)
        assert state["faults"][0]["state"] == "active" and state["faults"][0]["source"] == "manual"
        assert recv_until(driver, "fault_state", where=wanted)
        assert recv_until(driver, "vehicle_state", where=lambda m: m["injected_delay_ms"] == 200)


def test_presence_is_broadcast_when_engineer_connects_and_leaves():
    sid = new_session("monza")["session_id"]
    with client.websocket_connect(f"/ws/driver/{sid}") as driver:
        with client.websocket_connect(f"/ws/engineer/{sid}"):
            recv_until(driver, "session_info", where=lambda m: m["engineer_connected"])
        recv_until(
            driver,
            "session_info",
            where=lambda m: not m["engineer_connected"] and m["engineer_ever_connected"],
        )


def test_malformed_and_forbidden_messages_do_not_kill_the_session():
    sid = new_session("monza")["session_id"]
    with client.websocket_connect(f"/ws/driver/{sid}") as ws:
        ws.send_text("{{{ not json")
        assert recv_until(ws, "error")["code"] == "invalid_json"
        ws.send_json({"type": "add_fault", "fault": {"id": "g", "type": "grip_loss"}})
        assert recv_until(ws, "error")["code"] == "forbidden"
        ws.send_json(control(sid, steering="wat"))
        assert recv_until(ws, "error")["code"] == "invalid_message"
        # still alive, still ticking
        ws.send_json(control(sid))
        assert recv_until(ws, "vehicle_state")


def test_engineer_launches_scenario_and_run_id_changes():
    created = new_session("monza")
    sid = created["session_id"]
    with client.websocket_connect(f"/ws/engineer/{sid}") as engineer:
        engineer.send_json({"type": "arm_scenario", "scenario_id": "monza_wet_braking", "overrides": {"seed": 42}})
        info = recv_until(engineer, "session_info", where=lambda m: m["scenario_id"] is not None)
        assert info["run_id"] != created["run_id"]
        assert info["seed"] == 42 and info["scenario_id"] == "monza_wet_braking"

        engineer.send_json({"type": "arm_scenario", "scenario_id": "baku_sensor_freeze"})
        assert recv_until(engineer, "error")["code"] == "scenario_track_mismatch"


def test_reconnecting_driver_resumes_the_same_session():
    created = new_session("monza")
    sid = created["session_id"]
    with client.websocket_connect(f"/ws/driver/{sid}") as ws:
        ws.send_json(control(sid))
        first = recv_until(ws, "vehicle_state", where=lambda m: m["speed"] > 0)

    with client.websocket_connect(f"/ws/driver/{sid}") as ws:
        info = ws.receive_json()
        assert info["type"] == "session_info" and info["run_id"] == created["run_id"]
        resumed = recv_until(ws, "vehicle_state")
        assert resumed["seq"] >= first["seq"]
        assert resumed["distance_along_lap"] >= first["distance_along_lap"]
