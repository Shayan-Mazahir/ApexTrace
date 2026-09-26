from app.placeholder_sim import TRACK_PRESETS
from app.scenarios import SCENARIOS, SCENARIO_DIR, load_scenarios


def test_scenario_files_load_and_validate():
    assert len(list(SCENARIO_DIR.glob("*.json"))) == len(SCENARIOS) >= 3
    assert load_scenarios() == SCENARIOS


def test_required_presets_exist():
    assert SCENARIOS["monza_high_speed_braking"].track == "monza"
    assert SCENARIOS["baku_stale_telemetry"].faults.telemetry_delay_ms > 0


def test_scenario_windows_fit_the_lap_and_cover_a_hazard():
    for scenario in SCENARIOS.values():
        profile = TRACK_PRESETS[scenario.track]
        assert scenario.onset_distance < scenario.end_distance <= profile.total_length
        assert any(
            scenario.onset_distance <= hz.start_distance < scenario.end_distance
            for hz in profile.hazard_zones
        ), scenario.id
