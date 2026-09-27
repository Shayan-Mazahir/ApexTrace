"""Upgrade configurations.

Each upgrade changes the inputs the simulator runs with; results always come
from re-running the simulator, never from adjusting a failure count.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.schemas import ConfigurationName, Scenario

RELIABLE_TELEMETRY_MAX_DELAY_MS = 40.0
RELIABLE_TELEMETRY_MAX_LOSS = 0.02
SERVICED_BRAKE_EFFECTIVENESS = 1.0


@dataclass(frozen=True)
class SystemOptions:
    local_warning_fallback: bool = False


UPGRADE_DESCRIPTIONS: dict[ConfigurationName, str] = {
    ConfigurationName.BASELINE: "Prototype as-is.",
    ConfigurationName.BRAKE_SERVICE: f"Brakes serviced: brake_effectiveness restored to {SERVICED_BRAKE_EFFECTIVENESS}.",
    ConfigurationName.RELIABLE_TELEMETRY: (
        f"Better telemetry link: delay capped at {RELIABLE_TELEMETRY_MAX_DELAY_MS:.0f} ms, "
        f"packet loss capped at {RELIABLE_TELEMETRY_MAX_LOSS:.0%}."
    ),
    ConfigurationName.LOCAL_WARNING_FALLBACK: (
        "On-car warning fallback: when remote telemetry is stale the warning is computed from local sensors."
    ),
}


def apply_configuration(scenario: Scenario, configuration: ConfigurationName) -> tuple[Scenario, SystemOptions]:
    """Return the effective scenario and system options for a configuration."""
    if configuration is ConfigurationName.BASELINE:
        return scenario, SystemOptions()
    if configuration is ConfigurationName.BRAKE_SERVICE:
        return scenario.model_copy(update={"brake_effectiveness": SERVICED_BRAKE_EFFECTIVENESS}), SystemOptions()
    if configuration is ConfigurationName.RELIABLE_TELEMETRY:
        return scenario.model_copy(
            update={
                "telemetry_delay_ms": min(scenario.telemetry_delay_ms, RELIABLE_TELEMETRY_MAX_DELAY_MS),
                "packet_loss": min(scenario.packet_loss, RELIABLE_TELEMETRY_MAX_LOSS),
            }
        ), SystemOptions()
    if configuration is ConfigurationName.LOCAL_WARNING_FALLBACK:
        return scenario, SystemOptions(local_warning_fallback=True)
    raise ValueError(f"unknown configuration {configuration}")
