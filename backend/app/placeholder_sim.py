"""
TEMPORARY stand-in for backend/sim/* (Person A's ownership: track geometry
and vehicle physics — project task list sections B and C). Exists only so
sessions, WebSockets, and frontend rendering can be wired up and tested
before the real simulator lands. Nothing here is meant to survive that:
once backend/sim/track.py and backend/sim/core.py exist, replace the
imports in sessions.py and delete this file.

Tracks are closed loops built from a sequence of straight/arc segments,
closed by a final straight back to the start point (exact position
closure; the seam can have a heading kink — fine for a low-poly demo).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace

from app import f1_car
from app.barriers import constrain_motion
from app.f1_car import CarSetup, CarState, DriverRequests
from app.schemas import HazardKind, HazardZone, Sector, TrackId, TrackProfile
from app.track_layouts import LAYOUTS, Layout

SAMPLE_STEP = 4.0  # meters between resampled centerline points

# Vehicle dynamics live in app/f1_car.py (2026-spec bicycle model with tyre
# slip, downforce, power unit and gearbox). The constants below are derived
# summaries used by corner detection and the warning system.
MAX_SPEED = f1_car.top_speed_estimate(drs_open=True)  # ~343 km/h in X-mode
# Representative full-braking deceleration of the new car (~3.3 g averaged
# over a typical stop; the real value is speed dependent, see
# f1_car.braking_decel). The baseline warning assumes this for healthy brakes.
BRAKE_DECEL = 32.0
# Off the track (runoff/grass): less grip and power, heavy drag above a crawl.
RUNOFF_MAX_SPEED = 22.0
RUNOFF_DECEL = 18.0
CAR_HALF_WIDTH = 0.95  # 2026 car: 1.9 m wide

# Corner detection from the smoothed centerline.
HAZARD_RADIUS_M = 260.0  # tighter than this counts as a corner
HAZARD_MERGE_GAP_M = 60.0  # corners closer than this form one complex
CURVATURE_WINDOW = 3  # samples each side used to estimate curvature


def _catmull_rom_closed(points: list[tuple[float, float]], per_segment: int = 40) -> list[tuple[float, float]]:
    """Centripetal Catmull-Rom through a closed loop of points (no cusps or
    overshoot at sharp corners, unlike the uniform variant)."""
    n = len(points)
    out: list[tuple[float, float]] = []

    def tj(ti: float, a: tuple[float, float], b: tuple[float, float]) -> float:
        return ti + max(math.hypot(b[0] - a[0], b[1] - a[1]), 1e-6) ** 0.5

    for i in range(n):
        p0, p1, p2, p3 = points[i - 1], points[i], points[(i + 1) % n], points[(i + 2) % n]
        t0 = 0.0
        t1 = tj(t0, p0, p1)
        t2 = tj(t1, p1, p2)
        t3 = tj(t2, p2, p3)
        for k in range(per_segment):
            t = t1 + (t2 - t1) * k / per_segment

            def lerp(a, b, ta, tb):
                wa = (tb - t) / (tb - ta)
                wb = (t - ta) / (tb - ta)
                return (wa * a[0] + wb * b[0], wa * a[1] + wb * b[1])

            a1 = lerp(p0, p1, t0, t1)
            a2 = lerp(p1, p2, t1, t2)
            a3 = lerp(p2, p3, t2, t3)
            b1 = lerp(a1, a2, t0, t2)
            b2 = lerp(a2, a3, t1, t3)
            out.append(lerp(b1, b2, t1, t2))
    return out


def _resample_closed(points: list[tuple[float, float]], step: float) -> list[tuple[float, float]]:
    """Evenly spaced points along a closed polyline (last point == first)."""
    loop = points + [points[0]]
    cumulative = [0.0]
    for a, b in zip(loop, loop[1:]):
        cumulative.append(cumulative[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    total = cumulative[-1]
    n = max(3, round(total / step))
    out: list[tuple[float, float]] = []
    seg = 0
    for k in range(n):
        target = total * k / n
        while cumulative[seg + 1] < target:
            seg += 1
        span = cumulative[seg + 1] - cumulative[seg] or 1.0
        f = (target - cumulative[seg]) / span
        a, b = loop[seg], loop[seg + 1]
        out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
    out.append(out[0])
    return out


def _signed_curvatures(line: list[tuple[float, float]], window: int) -> list[float]:
    """Signed curvature (1/m) per sample from the heading change across a
    window; positive = heading increasing."""
    pts = line[:-1]
    n = len(pts)
    heads = []
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        heads.append(math.atan2(b[1] - a[1], b[0] - a[0]))
    curv = []
    for i in range(n):
        h0 = heads[(i - window) % n]
        h1 = heads[(i + window - 1) % n]
        dh = (h1 - h0 + math.pi) % (2 * math.pi) - math.pi
        curv.append(dh / (SAMPLE_STEP * (2 * window - 1)))
    return curv


def _build_edges(
    centerline: list[tuple[float, float]], half_widths: list[float]
) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
    left_edge: list[tuple[float, float]] = []
    right_edge: list[tuple[float, float]] = []
    n = len(centerline) - 1  # last point repeats the first
    for i, (px, py) in enumerate(centerline):
        nxt = centerline[(i + 1) % n]
        prev = centerline[(i - 1) % n]
        dx, dy = nxt[0] - prev[0], nxt[1] - prev[1]
        length = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / length, dx / length
        hw = half_widths[i % n]
        left_edge.append((px + nx * hw, py + ny * hw))
        right_edge.append((px - nx * hw, py - ny * hw))
    return left_edge, right_edge


def _corner_kind(name_count: int, curvatures: list[float], min_radius: float, narrow: bool) -> HazardKind:
    if narrow:
        return "narrow"
    left = sum(c for c in curvatures if c > 0) * SAMPLE_STEP
    right = -sum(c for c in curvatures if c < 0) * SAMPLE_STEP
    if min(left, right) > math.radians(20):  # real turning both ways
        return "chicane"
    return "braking_zone" if min_radius < 60 else "sweeper"


def build_profile_from_layout(layout: Layout, seed: int = 1, sector_count: int = 3) -> TrackProfile:
    raw = [(w.x, w.y) for w in layout.waypoints]
    smooth = _catmull_rom_closed(raw)
    # scale map pixels so the lap is the real length, start/finish at origin
    perimeter = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(smooth, smooth[1:] + smooth[:1]))
    scale = layout.length_m / perimeter
    ox, oy = raw[0]
    scaled = [((x - ox) * scale, (y - oy) * scale) for x, y in smooth]
    centerline = _resample_closed(scaled, SAMPLE_STEP)
    n = len(centerline) - 1
    total_length = n * (layout.length_m / n)  # == layout.length_m by construction
    step = total_length / n

    def nearest_sample(x: float, y: float) -> int:
        sx, sy = (x - ox) * scale, (y - oy) * scale
        return min(range(n), key=lambda i: (centerline[i][0] - sx) ** 2 + (centerline[i][1] - sy) ** 2)

    marker_index = [(nearest_sample(w.x, w.y), w) for w in layout.waypoints]
    narrow_idx = [i for i, w in marker_index if w.narrow]
    narrow_lo, narrow_hi = (min(narrow_idx), max(narrow_idx)) if narrow_idx else (-1, -2)
    is_narrow = [narrow_lo - 3 <= i <= narrow_hi + 3 for i in range(n)]
    # taper in/out of the narrow section over ~40 m instead of a step
    taper = max(1, round(40.0 / (layout.length_m / n)))

    def half_width(i: int) -> float:
        if not narrow_idx:
            return layout.width_m / 2
        outside = max(narrow_lo - 3 - i, i - (narrow_hi + 3), 0)
        f = min(1.0, outside / taper)
        return (layout.narrow_width_m + (layout.width_m - layout.narrow_width_m) * f) / 2

    half_widths = [half_width(i) for i in range(n)]
    left_edge, right_edge = _build_edges(centerline, half_widths)

    curv = _signed_curvatures(centerline, CURVATURE_WINDOW)
    tight = [abs(c) > 1 / HAZARD_RADIUS_M for c in curv]

    # contiguous tight runs (the lap starts on a straight, so no wrap needed)
    runs: list[list[int]] = []
    for i in range(n):
        if tight[i]:
            if runs and runs[-1][1] >= i - 1 - round(HAZARD_MERGE_GAP_M / step):
                runs[-1][1] = i
            else:
                runs.append([i, i])

    hazard_zones: list[HazardZone] = []
    used_ids: set[str] = set()
    for lo, hi in runs:
        seg_curv = curv[lo : hi + 1]
        min_radius = 1 / max(abs(c) for c in seg_curv)
        corner_speed = f1_car.corner_speed_for_radius(min_radius, cap=MAX_SPEED)
        if corner_speed >= MAX_SPEED * 0.97:
            continue  # flat-out kink, not a braking corner
        names = [w.corner for i, w in marker_index if w.corner and lo - 6 <= i <= hi + 6]
        if not names:
            near = min(
                ((abs(i - (lo + hi) // 2), w.corner) for i, w in marker_index if w.corner),
                default=(0, "Corner"),
            )
            names = [near[1]]
        label = names[0] if len(names) == 1 else f"{names[0]} – {names[-1].split()[-1]}"
        narrow = any(is_narrow[i] for i in range(lo, hi + 1))
        base_id = "".join(ch if ch.isalnum() else "_" for ch in names[0].lower()).strip("_")
        hid, k = base_id, 2
        while hid in used_ids:
            hid, k = f"{base_id}_{k}", k + 1
        used_ids.add(hid)
        hazard_zones.append(
            HazardZone(
                id=hid,
                kind=_corner_kind(len(names), seg_curv, min_radius, narrow),
                label=label,
                start_distance=round(lo * step, 2),
                end_distance=round((hi + 1) * step, 2),
                position=centerline[lo],
                corner_speed=round(corner_speed, 2),
            )
        )

    sector_length = total_length / sector_count
    sectors = [
        Sector(
            index=i,
            name=f"Sector {i + 1}",
            start_distance=i * sector_length,
            end_distance=(i + 1) * sector_length,
            start_position=centerline[round(i * sector_length / step) % n],
        )
        for i in range(sector_count)
    ]

    return TrackProfile(
        id=layout.track_id,
        name=layout.name,
        seed=seed,
        track_width=layout.width_m,
        total_length=total_length,
        barrier_offset=layout.barrier_offset_m,
        start_finish=(0.0, 0.0),
        centerline=centerline,
        left_edge=left_edge,
        right_edge=right_edge,
        sectors=sectors,
        hazard_zones=hazard_zones,
    )


TRACK_PRESETS: dict[TrackId, TrackProfile] = {
    tid: build_profile_from_layout(layout) for tid, layout in LAYOUTS.items()  # type: ignore[misc]
}


def loop_size(centerline: list[tuple[float, float]]) -> int:
    """Number of distinct points (a closed line repeats its first point)."""
    closed = len(centerline) > 1 and centerline[0] == centerline[-1]
    return len(centerline) - 1 if closed else len(centerline)


def nearest_index(
    x: float,
    y: float,
    centerline: list[tuple[float, float]],
    hint: int | None = None,
    window: int = 30,
) -> int:
    """Nearest sampled centerline point. With a hint (last tick's index) only
    a window around it is searched — the car moves a few meters per tick — and
    ties prefer the hint. Falls back to a full scan if the car is far away."""
    n = loop_size(centerline)
    if hint is not None:
        best_i, best_key = hint % n, None
        for offset in range(-window, window + 1):
            i = (hint + offset) % n
            d = math.hypot(x - centerline[i][0], y - centerline[i][1])
            key = (d, abs(offset))
            if best_key is None or key < best_key:
                best_i, best_key = i, key
        if best_key is not None and best_key[0] < 40.0:
            return best_i
    return min(range(n), key=lambda i: math.hypot(x - centerline[i][0], y - centerline[i][1]))


def _distance_to_segment(px: float, py: float, a: tuple[float, float], b: tuple[float, float]) -> float:
    abx, aby = b[0] - a[0], b[1] - a[1]
    length_sq = abx * abx + aby * aby
    if length_sq == 0:
        return math.hypot(px - a[0], py - a[1])
    t = max(0.0, min(1.0, ((px - a[0]) * abx + (py - a[1]) * aby) / length_sq))
    return math.hypot(px - (a[0] + t * abx), py - (a[1] + t * aby))


def half_width_at(idx: int, profile: TrackProfile) -> float:
    """Local half width from the drawn edges. `track_width` is the nominal
    width only; Baku's castle section narrows to 7.6 m."""
    n = loop_size(profile.centerline)
    (cx, cy), (lx, ly) = profile.centerline[idx % n], profile.left_edge[idx % n]
    return math.hypot(lx - cx, ly - cy)


def _clearance_at_index(x: float, y: float, idx: int, profile: TrackProfile) -> float:
    """Local half width minus the distance to the centerline *polyline*
    (the two segments touching the nearest sample), not just the nearest
    sample point — sample spacing is as large as the clearances we report."""
    line = profile.centerline
    n = loop_size(line)
    here = line[idx % n]
    distance = min(
        _distance_to_segment(x, y, line[(idx - 1) % n], here),
        _distance_to_segment(x, y, here, line[(idx + 1) % n]),
    )
    return half_width_at(idx, profile) - distance


def signed_lateral(x: float, y: float, idx: int, profile: TrackProfile) -> float:
    """Signed offset from the centerline at sample idx (+ = left of travel)."""
    line = profile.centerline
    n = loop_size(line)
    (cx, cy), (lx, ly) = line[idx % n], profile.left_edge[idx % n]
    nx, ny = lx - cx, ly - cy
    norm = math.hypot(nx, ny) or 1.0
    return ((x - cx) * nx + (y - cy) * ny) / norm


def state_at_distance(profile: TrackProfile, distance: float, speed: float = 0.0,
                      lateral_offset: float = 0.0, heading_error: float = 0.0) -> "DemoVehicleState":
    """A car placed `distance` metres along the lap, pointing down the track."""
    line = profile.centerline
    n = loop_size(line)
    i = round((distance % profile.total_length) / (profile.total_length / n)) % n
    (x0, y0), (x1, y1) = line[i], line[(i + 1) % n]
    heading = math.atan2(y1 - y0, x1 - x0)
    return DemoVehicleState(
        x=x0 - math.sin(heading) * lateral_offset,
        y=y0 + math.cos(heading) * lateral_offset,
        heading=heading + heading_error,
        speed=speed,
        nearest_point_index=i,
        distance_along_lap=i * profile.total_length / n,
    )


def signed_clearance(x: float, y: float, profile: TrackProfile, hint: int | None = None) -> float:
    """Distance from (x, y) to the track edge, via the nearest sampled
    centerline point: positive means still within the corridor, negative
    means off track. Crude — not the real projection Person A's module will do."""
    return _clearance_at_index(x, y, nearest_index(x, y, profile.centerline, hint), profile)


def sector_at(distance_along_lap: float, profile: TrackProfile) -> Sector:
    d = distance_along_lap % profile.total_length
    for sector in profile.sectors:
        if sector.start_distance <= d < sector.end_distance:
            return sector
    return profile.sectors[-1]


def next_hazard_zone(distance_along_lap: float, profile: TrackProfile) -> HazardZone | None:
    if not profile.hazard_zones:
        return None
    d = distance_along_lap % profile.total_length

    def ahead(hz: HazardZone) -> float:
        return (hz.start_distance - d) % profile.total_length

    return min(profile.hazard_zones, key=ahead)


def distance_to_hazard(distance_along_lap: float, hazard: HazardZone, profile: TrackProfile) -> float:
    d = distance_along_lap % profile.total_length
    return (hazard.start_distance - d) % profile.total_length


NOMINAL_BRAKE_DECEL = BRAKE_DECEL  # the warning assumes healthy brakes
# Baseline warning padding. Calibrated once on the *unupgraded* baseline only:
# the most generous padding at which the baseline still fails some suite test
# (with padding 8 m it passed everything, so the suite couldn't discriminate).
# It is a model assumption, not a measured figure.
REACTION_ALLOWANCE_S = 0.35
WARNING_MARGIN_M = 7.0
NEEDS_BRAKING_FACTOR = 1.0
GRIP_ESTIMATE_LAG_S = 1.0  # the grip estimate trails the true grip by this much


def advised_corner_speed(hazard: HazardZone, grip_estimate: float) -> float:
    """Corner speed the warning advises: sqrt(mu * g * r) from the *estimated*
    grip, which trails reality (see GRIP_ESTIMATE_LAG_S)."""
    return hazard.corner_speed * math.sqrt(max(grip_estimate, 0.05))


def required_warning_distance(speed: float, hazard: HazardZone, grip_estimate: float = 1.0) -> float:
    """Baseline warning rule: estimated braking distance to the corner speed,
    plus a reaction allowance and a margin. Uses nominal (not actual) brake
    performance — it cannot see wear."""
    target = advised_corner_speed(hazard, grip_estimate)
    braking = max(0.0, speed * speed - target**2) / (2 * NOMINAL_BRAKE_DECEL)
    return braking + speed * REACTION_ALLOWANCE_S + WARNING_MARGIN_M


def warning_hazard(
    distance_along_lap: float, profile: TrackProfile, speed: float, grip_estimate: float = 1.0
) -> HazardZone | None:
    """The hazard the BRAKE warning is about: the next one ahead, if the
    reported speed needs shedding and it is inside the required distance."""
    hazard = next_hazard_zone(distance_along_lap, profile)
    if hazard is None:
        return None
    if speed <= advised_corner_speed(hazard, grip_estimate) * NEEDS_BRAKING_FACTOR:
        return None
    if distance_to_hazard(distance_along_lap, hazard, profile) < required_warning_distance(
        speed, hazard, grip_estimate
    ):
        return hazard
    return None


def warning_reason(
    distance_along_lap: float, profile: TrackProfile, speed: float, grip_estimate: float = 1.0
) -> str | None:
    hazard = warning_hazard(distance_along_lap, profile, speed, grip_estimate)
    if hazard is None:
        return None
    ahead = distance_to_hazard(distance_along_lap, hazard, profile)
    return f"Approaching {hazard.label} in {ahead:.0f}m"


@dataclass
class DemoVehicleState:
    x: float = 0.0
    y: float = 0.0
    heading: float = 0.0
    speed: float = 0.0
    seq: int = 0
    nearest_point_index: int = 0
    distance_along_lap: float = 0.0
    off_track: bool = False  # outside the track edges right now
    track_exit: bool = False  # has left the track at least once this run
    track_exits: int = 0
    laps_completed: int = 0
    lap_complete: bool = False  # at least one full lap done
    lap_time: float = 0.0
    last_lap_time: float | None = None
    best_lap_time: float | None = None
    lap_clean: bool = True  # current lap within track limits (see step)
    last_lap_valid: bool | None = None
    barrier_contacts: int = 0
    in_contact: bool = False
    # vehicle dynamics (app/f1_car.py)
    vy: float = 0.0
    yaw_rate: float = 0.0
    gear: int = 0
    rpm: float = 4_000.0
    battery: float = f1_car.CAR.battery_capacity
    drs_open: bool = False
    drs_available: bool = False
    tc_cut: float = 0.0
    wheelspin: bool = False
    front_lock: bool = False
    rear_lock: bool = False
    ax: float = 0.0
    ay: float = 0.0
    ers_deploy_kw: float = 0.0

    def car_state(self) -> CarState:
        return CarState(vx=self.speed, vy=self.vy, yaw_rate=self.yaw_rate, gear=self.gear, rpm=self.rpm,
                        battery=self.battery, drs_open=self.drs_open, ax=self.ax, ay=self.ay)


def start_heading(profile: TrackProfile) -> float:
    (x0, y0), (x1, y1) = profile.centerline[0], profile.centerline[1]
    return math.atan2(y1 - y0, x1 - x0)


def initial_state(profile: TrackProfile, lateral_offset: float = 0.0) -> DemoVehicleState:
    """Stationary on the start/finish line, pointing down the track;
    `lateral_offset` shifts left (+) / right (-) of the centerline."""
    heading = start_heading(profile)
    sx, sy = profile.start_finish
    return DemoVehicleState(
        x=sx - math.sin(heading) * lateral_offset,
        y=sy + math.cos(heading) * lateral_offset,
        heading=heading,
    )


def on_straight(distance_along_lap: float, profile: TrackProfile, clearance_m: float = 100.0) -> bool:
    """True away from every corner zone: X-mode (low-drag aero) may open here."""
    d = distance_along_lap % profile.total_length
    for h in profile.hazard_zones:
        if h.start_distance - clearance_m <= d <= h.end_distance:
            return False
        if (h.start_distance - d) % profile.total_length <= clearance_m:
            return False
    return True


def step(
    state: DemoVehicleState,
    steering: float,
    throttle: float,
    brake: float,
    dt: float,
    profile: TrackProfile,
    grip: float = 1.0,
    brake_wear: float = 1.0,
    setup: CarSetup = f1_car.DEFAULT_SETUP,
    requests: DriverRequests = f1_car.NO_REQUESTS,
) -> DemoVehicleState:
    """One tick. Leaving the track is recorded (off_track / track_exit /
    track_exits) but never freezes the car: runoff slows it and the driver can
    rejoin. Laps keep counting; the evaluation stops a run at the first exit.

    Laps are timed against track limits: a lap is invalid (and cannot set a
    best time) once the whole car is past an edge line or touches a barrier."""
    offroad = state.off_track
    car, heading, dx, dy = f1_car.step_car(
        state.car_state(), state.heading, steering, throttle, brake, dt,
        grip=grip * (0.5 if offroad else 1.0),
        brake_scale=brake_wear,
        power_scale=0.35 if offroad else 1.0,
        offroad_drag=RUNOFF_DECEL * f1_car.CAR.mass if offroad and state.speed > RUNOFF_MAX_SPEED else 0.0,
        setup=setup,
        requests=requests,
        drs_allowed=on_straight(state.distance_along_lap, profile) and state.speed > 30.0 and not offroad,
    )
    speed = car.vx
    x = state.x + dx
    y = state.y + dy

    line = profile.centerline
    n = loop_size(line)
    sample_step = profile.total_length / n
    idx = nearest_index(x, y, line, hint=state.nearest_point_index)

    # Sweep the complete car against the exact rendered wall polylines.
    # Stop at first contact rather than projecting its centre through a wall
    # and snapping the heading (which also swung the nose through barriers).
    x, y, heading, in_contact = constrain_motion(
        profile, state.x, state.y, state.heading, x, y, heading)
    barrier_contacts = state.barrier_contacts
    if in_contact:
        speed = 0.0
        car = replace(car, vx=0.0, vy=0.0, yaw_rate=0.0, ax=0.0, ay=0.0)
        if not state.in_contact:
            barrier_contacts += 1
        idx = nearest_index(x, y, line, hint=state.nearest_point_index)
    # The full body can reach a barrier before its centre leaves the road
    # (especially at Baku). Barriers sit outside the road edge, so contact
    # also records an exit; a crash must not become a clean stopped run.
    off_track = _clearance_at_index(x, y, idx, profile) < 0 or in_contact

    delta_idx = (idx - state.nearest_point_index) % n
    if delta_idx > n // 2:
        delta_idx -= n
    # No teleporting progress across the infield: count at most what the car
    # could physically have covered this tick.
    max_step = math.ceil(speed * dt / sample_step) + 2
    delta_idx = max(-max_step, min(max_step, delta_idx))
    distance_along_lap = state.distance_along_lap + delta_idx * sample_step

    newly_off = off_track and not state.off_track
    # Track limits: the lap only counts if some part of the car stays on the
    # track (F1 rule), so running a wheel or two wide does not void it.
    beyond_limits = _clearance_at_index(x, y, idx, profile) < -CAR_HALF_WIDTH or in_contact
    laps_completed = state.laps_completed
    lap_time = state.lap_time + dt
    last_lap, best_lap, lap_clean = state.last_lap_time, state.best_lap_time, state.lap_clean
    last_valid = state.last_lap_valid
    if beyond_limits:
        lap_clean = False
    if distance_along_lap >= (laps_completed + 1) * profile.total_length:
        laps_completed += 1
        last_lap, last_valid = lap_time, lap_clean
        if lap_clean and (best_lap is None or lap_time < best_lap):
            best_lap = lap_time
        lap_time = 0.0
        lap_clean = not beyond_limits

    return DemoVehicleState(
        x=x,
        y=y,
        heading=heading,
        speed=speed,
        seq=state.seq + 1,
        nearest_point_index=idx,
        distance_along_lap=distance_along_lap,
        off_track=off_track,
        track_exit=state.track_exit or off_track,
        track_exits=state.track_exits + (1 if newly_off else 0),
        laps_completed=laps_completed,
        lap_complete=laps_completed >= 1,
        lap_time=lap_time,
        last_lap_time=last_lap,
        best_lap_time=best_lap,
        lap_clean=lap_clean,
        last_lap_valid=last_valid,
        barrier_contacts=barrier_contacts,
        in_contact=in_contact,
        vy=car.vy,
        yaw_rate=car.yaw_rate,
        gear=car.gear,
        rpm=car.rpm,
        battery=car.battery,
        drs_open=car.drs_open,
        drs_available=car.drs_available,
        tc_cut=car.tc_cut,
        wheelspin=car.wheelspin,
        front_lock=car.front_lock,
        rear_lock=car.rear_lock,
        ax=car.ax,
        ay=car.ay,
        ers_deploy_kw=car.ers_deploy_kw,
    )
