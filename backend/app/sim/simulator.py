"""Simulation loop: vehicle + telemetry faults + safety system + driver, over one flying lap.

One ``Simulator`` instance is one lap of one scenario under one configuration.
The car crosses the start line (s = 0) at ``entry_speed``; the run ends when
the lap is completed, shortly after the car leaves the track, or at a time
limit. ``step()`` advances a single tick and can take external control input
(e.g. a human on a wheel) instead of the scripted driver; ``run()`` drives it
to the end with the scripted driver and returns a ``SimulationResult``.

Per tick, in order:
1. locate the car on the track (ground truth)
2. sample sensors and push a packet through the faulty telemetry channel
3. the safety system evaluates the newest packet it has (or the local sensor,
   if the local fallback upgrade is on and remote data is stale)
4. the driver perceives the warning (after its reaction delay) and acts
5. the vehicle model integrates one step
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.schemas import (
    ConfigurationName,
    CornerMetrics,
    Scenario,
    SimulationMetrics,
    SimulationResult,
    VehicleState,
    WarningLevel,
    WarningSource,
)
from app.sim import constants as C
from app.sim.driver import DriverParams, ScriptedDriver
from app.sim.faults import FaultConfig, LocalSensor, TelemetryChannel
from app.sim.safety import WarningOutput, WarningSystem
from app.sim.track import Corner, Track, get_track
from app.sim.upgrades import apply_configuration
from app.sim.vehicle import (
    ControlInput,
    VehicleKinematics,
    VehicleParams,
    braking_distance,
    max_corner_speed,
)
from app.sim.vehicle import step as vehicle_step

# Order of fields in a recorded frame; matches VehicleState.
FRAME_FIELDS = tuple(VehicleState.model_fields)


@dataclass
class _CornerTrack:
    approach_max_speed: float = 0.0
    entry_time: float | None = None
    entry_speed: float | None = None
    warning_time: float | None = None
    warning_dist: float | None = None
    warning_speed: float | None = None


@dataclass
class _Tracking:
    left_track: bool = False
    failure_time: float | None = None
    failure_corner: str | None = None
    failure_s: float | None = None
    warning_time: float | None = None
    lap_time: float | None = None
    min_boundary: float = float("inf")
    max_lateral: float = 0.0
    max_grip_usage: float = 0.0
    stale_ticks: int = 0
    ticks: int = 0
    corners: dict[str, _CornerTrack] = field(default_factory=dict)


class Simulator:
    def __init__(
        self,
        scenario: Scenario,
        configuration: ConfigurationName = ConfigurationName.BASELINE,
        record: bool = True,
        driver_params: DriverParams | None = None,
    ):
        self.base_scenario = scenario
        self.configuration = configuration
        self.scenario, self.options = apply_configuration(scenario, configuration)
        sc = self.scenario
        self.track: Track = get_track(sc.track)
        self.vehicle_params = VehicleParams(grip=sc.actual_grip, brake_effectiveness=sc.brake_effectiveness)
        self.channel = TelemetryChannel(
            FaultConfig(sc.telemetry_delay_ms / 1000.0, sc.sensor_noise, sc.packet_loss), sc.seed, self.track
        )
        self.local_sensor = LocalSensor(sc.sensor_noise, sc.seed)
        self.warning_system = WarningSystem(estimated_grip=sc.estimated_grip, warning_margin=sc.warning_margin)
        params = driver_params or DriverParams()
        self.driver = ScriptedDriver(
            sc.entry_speed,
            DriverParams(
                reaction_delay=sc.driver_reaction_delay,
                steering_bandwidth=params.steering_bandwidth,
                steering_damping=params.steering_damping,
                max_brake=params.max_brake,
                speed_gain=params.speed_gain,
                corner_grip_budget=params.corner_grip_budget,
            ),
            feel=self.vehicle_params,
        )
        self.kin = VehicleKinematics(x=0.0, y=0.0, heading=0.0, speed=sc.entry_speed)
        self.t = 0.0
        self._tick = 0
        self._hint = 0
        self._prev_s = 0.0
        self.lap_progress = 0.0
        self._current_corner: str | None = None
        self._last_corner: str | None = None
        self.record = record
        self.frames: list[tuple] = []
        self.track_state = _Tracking(corners={c.name: _CornerTrack() for c in self.track.corners})
        self.done = False
        self.last_warning: WarningOutput | None = None

    # ------------------------------------------------------------------ #

    def _warning(self, loc_s: float) -> tuple[WarningOutput, WarningSource, float | None, float | None, bool]:
        dropped = self.channel.send(self.t, self.kin.speed, loc_s)
        remote = self.channel.receive(self.t)
        age = None if remote is None else self.t - remote.sent_at
        stale = remote is None or age > C.STALE_TELEMETRY_S
        if self.options.local_warning_fallback and (remote is None or age > C.LOCAL_FALLBACK_STALE_S):
            local = self.local_sensor.measure(self.t, self.kin.speed, loc_s)
            out = self.warning_system.evaluate(local, self.track)
            return out, WarningSource.LOCAL, local.speed, 0.0, dropped
        if stale:
            self.track_state.stale_ticks += 1
        out = self.warning_system.evaluate(remote, self.track)
        return (
            out,
            WarningSource.REMOTE,
            None if remote is None else remote.speed,
            None if age is None else age * 1000.0,
            dropped,
        )

    def _advance_progress(self, s: float) -> None:
        d = (s - self._prev_s) % self.track.length
        if d > self.track.length / 2:  # moved backwards
            d -= self.track.length
        self.lap_progress += d
        self._prev_s = s

    def _track_corners(self, s: float, speed: float, warning: WarningOutput) -> None:
        tr = self.track_state
        corner = self.track.get_current_corner(s)
        name = corner.name if corner else None
        if name != self._current_corner:
            if self._current_corner is not None:
                self._last_corner = self._current_corner
            if name is not None and tr.corners[name].entry_time is None:
                tr.corners[name].entry_time, tr.corners[name].entry_speed = self.t, speed
            self._current_corner = name
        zone = self.track.in_braking_zone(s)
        if zone is not None and tr.corners[zone.corner].entry_time is None:
            ct = tr.corners[zone.corner]
            ct.approach_max_speed = max(ct.approach_max_speed, speed)
        if warning.level is WarningLevel.BRAKE_NOW and warning.corner is not None:
            ct = tr.corners[warning.corner]
            if ct.warning_time is None:
                ct.warning_time = self.t
                ct.warning_dist = self.track.corner_by_name(warning.corner).s_entry - s
                if ct.warning_dist < -self.track.length / 2:
                    ct.warning_dist += self.track.length
                ct.warning_speed = speed

    def step(self, control: ControlInput | None = None) -> VehicleState | None:
        """Advance one tick. ``control=None`` uses the scripted driver.

        Returns the state at the start of the tick (with the controls applied
        during it) as a ``VehicleState`` when recording, else ``None``.
        """
        if self.done:
            raise RuntimeError("simulation already finished")
        sc, tr, kin = self.scenario, self.track_state, self.kin
        loc = self.track.locate(kin.x, kin.y, hint=self._hint)
        self._hint = loc.index
        if self._tick > 0:
            self._advance_progress(loc.s)

        warning, source, measured_speed, age_ms, dropped = self._warning(loc.s)
        self.last_warning = warning
        self.driver.observe(self.t, warning)
        u = (control or self.driver.control(kin, loc, self.track)).clipped()

        # Bookkeeping on ground truth.
        on_track = loc.boundary_distance >= 0.0
        tr.min_boundary = min(tr.min_boundary, loc.boundary_distance)
        tr.max_lateral = max(tr.max_lateral, abs(loc.lateral_offset))
        tr.max_grip_usage = max(tr.max_grip_usage, kin.grip_usage)
        if warning.level is WarningLevel.BRAKE_NOW and tr.warning_time is None:
            tr.warning_time = self.t
        self._track_corners(loc.s, kin.speed, warning)
        next_corner = self.track.next_corner(loc.s).name
        if not on_track and not tr.left_track:
            tr.left_track, tr.failure_time, tr.failure_s = True, self.t, loc.s
            tr.failure_corner = self._current_corner or self._last_corner or next_corner
        tr.ticks += 1

        state = None
        if self.record:
            frame = (
                round(self.t, 6),
                kin.x,
                kin.y,
                loc.s,
                self.lap_progress,
                loc.lateral_offset,
                kin.speed,
                kin.heading,
                u.steering,
                u.throttle,
                u.brake,
                kin.acceleration,
                kin.lateral_acceleration,
                kin.grip_usage,
                sc.actual_grip,
                sc.estimated_grip,
                loc.boundary_distance,
                on_track,
                next_corner,
                warning.level,
                source,
                warning.corner,
                warning.advised_speed,
                measured_speed,
                age_ms,
                dropped,
            )
            self.frames.append(frame)
            state = VehicleState.model_construct(**dict(zip(FRAME_FIELDS, frame)))

        self.kin = vehicle_step(kin, u, self.vehicle_params, C.DT)
        self._tick += 1
        self.t = round(self._tick * C.DT, 6)

        lap_done = self.lap_progress >= self.track.length - 0.5 and not tr.left_track
        if lap_done and tr.lap_time is None:
            tr.lap_time = self.t
        post_failure = tr.left_track and self.t - tr.failure_time >= C.POST_FAILURE_TIME
        if lap_done or post_failure or self.t >= C.MAX_SIM_TIME:
            self.done = True
        return state

    def run(self, include_telemetry: bool = False) -> SimulationResult:
        while not self.done:
            self.step()
        return self.result(include_telemetry)

    # ------------------------------------------------------------------ #

    def telemetry(self, limit: int | None = None) -> list[VehicleState]:
        frames = self.frames if limit is None else self.frames[:limit]
        return [VehicleState.model_construct(**dict(zip(FRAME_FIELDS, f))) for f in frames]

    def _corner_metrics(self, corner: Corner, ct: _CornerTrack) -> CornerMetrics:
        sc = self.scenario
        safe = max_corner_speed(sc.actual_grip, corner.curvature)
        # Braking was needed if the car approached faster than the true limit.
        # Then: could full braking with the car's *actual* brakes, grip and the
        # driver's actual reaction reach the safe speed from where the first
        # BRAKE_NOW for this corner appeared?
        needed = max(ct.approach_max_speed, ct.entry_speed) > safe
        if not needed:
            too_late = False
        elif ct.warning_time is None:
            too_late = True
        else:
            v = ct.warning_speed
            decel = sc.actual_grip * C.GRIP_ACCEL * sc.brake_effectiveness
            d_req = v * sc.driver_reaction_delay + braking_distance(v, safe, decel)
            too_late = ct.warning_dist < d_req
        return CornerMetrics(
            name=corner.name,
            entry_speed=ct.entry_speed,
            approach_max_speed=max(ct.approach_max_speed, ct.entry_speed),
            safe_speed=safe,
            advised_speed=self.warning_system.advised_speed(corner.curvature),
            overspeed_at_entry=ct.entry_speed - safe,
            warning_timestamp=ct.warning_time,
            warning_lead_time=None if ct.warning_time is None else ct.entry_time - ct.warning_time,
            warning_too_late=too_late,
        )

    def metrics(self) -> SimulationMetrics:
        tr = self.track_state
        corners = [
            self._corner_metrics(c, tr.corners[c.name])
            for c in self.track.corners
            if tr.corners[c.name].entry_time is not None
        ]
        late = sum(c.warning_too_late for c in corners)
        return SimulationMetrics(
            lap_completed=tr.lap_time is not None,
            lap_time=tr.lap_time,
            lap_distance=self.lap_progress,
            corners=corners,
            max_overspeed_at_entry=max((c.overspeed_at_entry for c in corners), default=None),
            corners_with_late_warning=late,
            warning_too_late=late > 0,
            max_lateral_error=tr.max_lateral,
            max_grip_usage=tr.max_grip_usage,
            stale_telemetry_fraction=tr.stale_ticks / max(1, tr.ticks),
            packets_dropped=self.channel.packets_dropped,
            sim_time=self.t,
            ticks=tr.ticks,
        )

    def result(self, include_telemetry: bool = False) -> SimulationResult:
        tr = self.track_state
        return SimulationResult(
            scenario_id=self.scenario.scenario_id,
            configuration=self.configuration,
            scenario=self.scenario,
            success=not tr.left_track,
            failed=tr.left_track,
            left_track=tr.left_track,
            failure_reason="left_track" if tr.left_track else None,
            failure_corner=tr.failure_corner,
            failure_s=tr.failure_s,
            warning_triggered=tr.warning_time is not None,
            warning_timestamp=tr.warning_time,
            failure_timestamp=tr.failure_time,
            minimum_boundary_distance=tr.min_boundary,
            metrics=self.metrics(),
            telemetry=self.telemetry() if include_telemetry and self.record else None,
        )
