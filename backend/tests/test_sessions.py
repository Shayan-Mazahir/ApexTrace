import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.placeholder_sim import DemoVehicleState, TRACK_PRESETS
from app.sessions import Session, apply_client_message

client = TestClient(app)


def test_list_tracks_returns_both_presets():
    response = client.get("/tracks")
    assert response.status_code == 200
    body = response.json()
    ids = {t["id"] for t in body}
    assert ids == {"monza", "baku"}
    for summary in body:
        assert summary["sector_count"] == 3
        assert summary["hazard_zone_count"] > 0


def test_get_track_returns_full_profile():
    response = client.get("/tracks/baku")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "baku"
    assert len(body["centerline"]) > 10
    assert len(body["hazard_zones"]) > 0


def test_create_session_returns_track_profile_and_role():
    response = client.post("/sessions", json={"track": "monza"})
    assert response.status_code == 200
    body = response.json()
    assert body["track_profile"]["id"] == "monza"
    assert body["role"] == "driver"
    assert "session_id" in body


def test_create_session_defaults_to_monza():
    response = client.post("/sessions", json={})
    assert response.status_code == 200
    assert response.json()["track_profile"]["id"] == "monza"


def test_create_session_as_engineer_role():
    response = client.post("/sessions", json={"track": "baku", "role": "engineer"})
    assert response.json()["role"] == "engineer"


def test_join_unknown_session_returns_404():
    response = client.post("/sessions/doesnotexist/join", json={"role": "driver"})
    assert response.status_code == 404


def test_join_existing_session_as_engineer():
    created = client.post("/sessions", json={"track": "baku"}).json()
    response = client.post(f"/sessions/{created['session_id']}/join", json={"role": "engineer"})
    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "engineer"
    assert body["track_profile"]["id"] == "baku"


def test_driver_websocket_round_trip_carries_lap_fields():
    created = client.post("/sessions", json={"track": "monza"}).json()
    session_id = created["session_id"]
    with client.websocket_connect(f"/ws/driver/{session_id}") as ws:
        ws.send_json(
            {
                "type": "control_input",
                "seq": 1,
                "session_id": session_id,
                "track": "monza",
                "seed": 1,
                "t_client": 0,
                "steering": 0.0,
                "throttle": 1.0,
                "brake": 0.0,
            }
        )
        message = ws.receive_json()
        assert message["type"] == "vehicle_state"
        for field in (
            "lap_progress",
            "sector_index",
            "sector_name",
            "distance_along_lap",
            "next_hazard_zone",
            "next_hazard_distance",
            "signed_clearance",
            "packet_age_ms",
            "warning_reason",
            "track_exit",
            "lap_complete",
        ):
            assert field in message


def test_driver_websocket_packet_age_resets_after_control_input():
    created = client.post("/sessions", json={"track": "monza"}).json()
    session_id = created["session_id"]
    with client.websocket_connect(f"/ws/driver/{session_id}") as ws:
        ws.send_json(
            {
                "type": "control_input",
                "seq": 1,
                "session_id": session_id,
                "track": "monza",
                "seed": 1,
                "t_client": 0,
                "steering": 0.0,
                "throttle": 0.0,
                "brake": 0.0,
            }
        )
        message = ws.receive_json()
        assert message["packet_age_ms"] < 1000


def test_driver_websocket_unknown_session_rejects_connection():
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/driver/doesnotexist"):
            pass


def test_apply_client_message_control_input_clamps_range_and_stamps_age():
    session = Session(session_id="x", track_profile=TRACK_PRESETS["monza"])
    apply_client_message(
        session, {"type": "control_input", "steering": 5.0, "throttle": -2.0, "brake": 0.5}
    )
    assert session.control["steering"] == 1.0
    assert session.control["throttle"] == 0.0
    assert session.control["brake"] == 0.5
    assert session.last_control_received_at is not None


def test_apply_client_message_pause_resume_reset():
    session = Session(session_id="x", track_profile=TRACK_PRESETS["monza"])

    apply_client_message(session, {"type": "pause"})
    assert session.running is False

    apply_client_message(session, {"type": "resume"})
    assert session.running is True

    session.vehicle = DemoVehicleState(x=42.0)
    session.running = False
    apply_client_message(session, {"type": "reset"})
    assert session.vehicle.x == 0.0
    assert session.running is True
