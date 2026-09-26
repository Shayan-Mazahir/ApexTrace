"""Simplified 2026-regulation F1 car dynamics.

A planar "bicycle" model (one front and one rear axle) with:

* tyres: lateral force from slip angle through a Pacejka-style curve
  (peak near 7 degrees, falling away when sliding), longitudinal force from
  drive/brakes, and a friction circle so braking or wheelspin eats cornering
  grip;
* aero: downforce and drag grow with v^2, so grip is speed dependent (about
  2 g in slow corners, 4-5 g in fast ones), with 2026 active aero:
  Z-mode (cornering) and X-mode (low drag, "DRS");
* load transfer: braking loads the front, acceleration the rear;
* power unit: 400 kW combustion engine with an rpm curve and an 8-speed
  gearbox, plus a 350 kW MGU-K that fades from 290 to 355 km/h (337 km/h in
  overtake mode) and runs on a 4 MJ battery that recharges under braking;
* driver aids: traction control levels, ABS, automatic or manual gearbox,
  automatic/manual/off active aero, battery deployment mode;
* a reverse gear (selectable when nearly stopped, capped at ~22 km/h).

Numbers follow public 2026 figures (mass, wheelbase, power split, MGU-K
rampdown) and typical published aero/tyre values; they are a plausible
approximation for a simulator, not team data.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from typing import Literal

G = 9.81
RHO = 1.225

TractionControl = Literal["off", "medium", "full"]
Gearbox = Literal["automatic", "manual"]
DrsMode = Literal["off", "auto", "manual"]
ErsMode = Literal["harvest", "balanced", "overtake"]


@dataclass(frozen=True)
class CarParams:
    mass: float = 800.0  # 768 kg minimum (car + driver) plus fuel
    yaw_inertia: float = 1050.0
    wheelbase: float = 3.40
    cg_to_front: float = 1.82  # CG 1.82 m behind the front axle: ~46.5 % static weight on the front
    cg_height: float = 0.30
    frontal_area: float = 1.5
    # Z-mode (wings closed, cornering) and X-mode (wings open, straights)
    cl_z: float = 2.5
    cd_z: float = 0.75
    cl_x: float = 1.5
    cd_x: float = 0.52
    aero_balance_front: float = 0.44
    # tyres
    mu_lat: float = 1.60
    mu_long: float = 1.85  # slicks give more longitudinal than lateral grip
    tyre_b: float = 15.4  # with tyre_c this puts peak lateral force near 7 degrees of slip
    tyre_c: float = 1.45
    sliding_mu_ratio: float = 0.80  # grip of a locked or spinning tyre
    rolling_resistance: float = 0.015
    # brakes (brake-by-wire, no ABS)
    brake_force_max: float = 33_000.0  # ~4.2 g of brake-system force
    brake_bias_front: float = 0.56
    # power unit
    ice_power: float = 400_000.0
    mguk_power: float = 350_000.0
    driveline_efficiency: float = 0.92
    mguk_full_until: float = 290 / 3.6
    mguk_full_until_overtake: float = 337 / 3.6
    mguk_zero_at: float = 355 / 3.6
    battery_capacity: float = 4.0e6  # J usable
    regen_power: float = 350_000.0
    coast_harvest_power: float = 120_000.0
    harvest_mode_power: float = 100_000.0  # recharge taken from the ICE at full throttle in Harvest mode
    max_tractive_force: float = 20_000.0  # torque limit at very low speed
    # gearbox: road speed in each gear at the shift rpm
    gear_speeds_kmh: tuple[float, ...] = (95, 135, 170, 205, 240, 275, 310, 350)
    shift_rpm: float = 12_000.0
    rev_limit: float = 12_500.0
    idle_rpm: float = 4_000.0
    downshift_rpm: float = 7_000.0
    # steering
    max_road_wheel_angle: float = 0.38  # rad (~22 deg) at low speed
    # reverse
    reverse_force: float = 6_000.0  # N at full throttle
    reverse_max_speed: float = 22 / 3.6
    reverse_engage_speed: float = 1.5  # m/s: gear change to/from R only below this
    steer_slip_allowance: float = 0.12  # rad beyond the steady-state angle at full lock

    @property
    def cg_to_rear(self) -> float:
        return self.wheelbase - self.cg_to_front

    @property
    def gears(self) -> int:
        return len(self.gear_speeds_kmh)


CAR = CarParams()


@dataclass(frozen=True)
class CarSetup:
    """Driver-selectable assists and modes."""

    traction_control: TractionControl = "full"
    abs: bool = True  # real F1 cars have none; off means overbraking locks the wheels
    gearbox: Gearbox = "automatic"
    drs_mode: DrsMode = "auto"
    ers_mode: ErsMode = "balanced"


DEFAULT_SETUP = CarSetup()


@dataclass(frozen=True)
class DriverRequests:
    """Discrete requests since the last tick (manual gearbox / active aero)."""

    shift_up: int = 0
    shift_down: int = 0
    drs_toggle: int = 0
    reverse_toggle: int = 0  # engage/leave reverse (only when nearly stopped)


NO_REQUESTS = DriverRequests()


@dataclass(frozen=True)
class CarState:
    vx: float = 0.0  # forward speed, body frame (m/s)
    vy: float = 0.0  # lateral speed, body frame, + = left
    yaw_rate: float = 0.0  # rad/s, + = left
    gear: int = 0  # 0 = not yet selected (picked from speed on the first step); -1 = reverse
    rpm: float = 4_000.0
    battery: float = 4.0e6  # J
    drs_open: bool = False
    ax: float = 0.0  # body-frame accelerations of the last substep (m/s^2)
    ay: float = 0.0
    tc_cut: float = 0.0  # fraction of requested drive removed by traction control
    wheelspin: bool = False
    front_lock: bool = False
    rear_lock: bool = False
    ers_deploy_kw: float = 0.0  # + deploying, - harvesting
    drs_available: bool = False


# ------------------------------------------------------------------ helpers


def aero_coefficients(drs_open: bool, p: CarParams = CAR) -> tuple[float, float]:
    """(ClA, CdA) in m^2 for the current active-aero mode."""
    cl, cd = (p.cl_x, p.cd_x) if drs_open else (p.cl_z, p.cd_z)
    return cl * p.frontal_area, cd * p.frontal_area


def max_lateral_accel(speed: float, grip: float = 1.0, drs_open: bool = False, p: CarParams = CAR) -> float:
    """Steady cornering limit in m/s^2 at this speed (weight + downforce times mu)."""
    cla, _ = aero_coefficients(drs_open, p)
    downforce = 0.5 * RHO * cla * speed * speed
    return grip * p.mu_lat * (p.mass * G + downforce) / p.mass


def corner_speed_for_radius(radius: float, grip: float = 1.0, p: CarParams = CAR, cap: float = 100.0) -> float:
    """Highest steady speed on a constant radius: v^2 / R = mu (g + k v^2)."""
    cla, _ = aero_coefficients(False, p)
    k = 0.5 * RHO * cla / p.mass
    mu = grip * p.mu_lat
    denom = 1.0 - mu * k * radius
    if denom <= 0:
        return cap  # aero grip grows faster than the need: flat out
    return min(cap, math.sqrt(mu * G * radius / denom))


def braking_decel(speed: float, grip: float = 1.0, brake_scale: float = 1.0, p: CarParams = CAR) -> float:
    """Straight-line deceleration at full brake (with ABS): the tyre or brake
    system limit, times brake effectiveness, plus drag."""
    cla, cda = aero_coefficients(False, p)
    q = 0.5 * RHO * speed * speed
    tyre = 0.97 * grip * p.mu_long * (p.mass * G + q * cla)
    return (min(tyre, p.brake_force_max) * brake_scale + q * cda) / p.mass


def braking_distance(v_from: float, v_to: float, grip: float = 1.0, brake_scale: float = 1.0, p: CarParams = CAR) -> float:
    """Distance to slow from v_from to v_to with full braking (integrated, speed-dependent decel)."""
    if v_from <= v_to:
        return 0.0
    dist, v = 0.0, v_from
    dv = 0.5
    while v > v_to:
        step = min(dv, v - v_to)
        a = braking_decel(v - step / 2, grip, brake_scale, p)
        dist += (v - step / 2) * step / a
        v -= step
    return dist


def top_speed_estimate(p: CarParams = CAR, drs_open: bool = False) -> float:
    """Speed where full-power drive equals drag (balanced ERS, full battery)."""
    lo, hi = 10.0, 120.0
    for _ in range(60):
        v = (lo + hi) / 2
        power = (p.ice_power + p.mguk_power * _mguk_taper(v, "balanced", p)) * p.driveline_efficiency
        _, cda = aero_coefficients(drs_open, p)
        drag = 0.5 * RHO * cda * v * v + p.rolling_resistance * p.mass * G
        if power / v > drag:
            lo = v
        else:
            hi = v
    return lo


def max_steer_angle(speed: float, p: CarParams = CAR, drs_open: bool = False) -> float:
    """Speed-sensitive steering range: full lock at low speed; at speed, full
    input asks for a little more than the grip limit (like a sim's speed
    sensitivity), so a keyboard or pad can drive on the limit without
    instantly spinning."""
    if speed < 8.0:
        return p.max_road_wheel_angle
    a_lat = max_lateral_accel(speed, 1.0, drs_open, p)
    steady = math.atan(p.wheelbase * a_lat / (speed * speed))
    return min(p.max_road_wheel_angle, steady + p.steer_slip_allowance)


def steering_for_curvature(speed: float, curvature: float, p: CarParams = CAR) -> float:
    """Normalised steering input [-1, 1] for a path curvature (used by scripted drivers)."""
    delta = math.atan(p.wheelbase * curvature)
    # the rear tyres need a slip angle too, which reads as understeer: add a
    # little angle in proportion to lateral acceleration
    delta += 0.04 * (speed * speed * curvature) / max(max_lateral_accel(speed, 1.0, False, p), 1.0)
    return max(-1.0, min(1.0, delta / max_steer_angle(speed, p)))


def _mguk_taper(speed: float, mode: ErsMode, p: CarParams) -> float:
    if mode == "harvest":
        return 0.0
    full = p.mguk_full_until_overtake if mode == "overtake" else p.mguk_full_until
    if speed <= full:
        return 1.0
    if speed >= p.mguk_zero_at:
        return 0.0
    return (p.mguk_zero_at - speed) / (p.mguk_zero_at - full)


def gear_for_speed(speed: float, p: CarParams = CAR) -> int:
    """Lowest gear that keeps the engine under the shift rpm."""
    for g, top in enumerate(p.gear_speeds_kmh, start=1):
        if speed * 3.6 <= top * 0.98:
            return g
    return p.gears


def engine_rpm(speed: float, gear: int, p: CarParams = CAR) -> float:
    top = p.gear_speeds_kmh[gear - 1] / 3.6
    return max(p.idle_rpm, speed / top * p.shift_rpm)


def _ice_power_fraction(rpm: float, p: CarParams) -> float:
    """Simplified power curve: builds from idle, flat near the top, cut at the limiter."""
    if rpm >= p.rev_limit:
        return 0.0
    if rpm <= 6_000:
        return 0.35 + 0.25 * (rpm - p.idle_rpm) / (6_000 - p.idle_rpm)
    if rpm <= 10_500:
        return 0.60 + 0.40 * (rpm - 6_000) / 4_500
    return 1.0


def _tyre_lateral(slip: float, peak_force: float, p: CarParams) -> float:
    """Pacejka-style lateral force (opposes slip)."""
    return -peak_force * math.sin(p.tyre_c * math.atan(p.tyre_b * slip))


# ------------------------------------------------------------------ gearbox & aero control


REVERSE = -1


def _update_gear(state: CarState, setup: CarSetup, requests: DriverRequests, throttle: float, brake: float,
                 p: CarParams) -> int:
    speed = max(state.vx, 0.0)
    gear = state.gear or gear_for_speed(speed, p)
    slow = abs(state.vx) < p.reverse_engage_speed
    if requests.reverse_toggle % 2 == 1 and slow:
        return 1 if gear == REVERSE else REVERSE
    if gear == REVERSE:
        # manual: shifting up from R selects 1st once stopped
        return 1 if setup.gearbox == "manual" and requests.shift_up > 0 and slow else REVERSE
    if setup.gearbox == "manual":
        if gear == 1 and requests.shift_down > 0 and requests.shift_up == 0 and slow:
            return REVERSE
        gear = min(p.gears, gear + requests.shift_up)
        for _ in range(requests.shift_down):
            # over-rev protection: refuse a downshift that would pass the limiter
            if gear > 1 and engine_rpm(speed, gear - 1, p) <= p.rev_limit:
                gear -= 1
        return gear
    rpm = engine_rpm(speed, gear, p)
    if rpm >= p.shift_rpm and gear < p.gears and throttle > 0.05:
        gear += 1
    down_at = 8_500.0 if brake > 0.1 else p.downshift_rpm
    while gear > 1 and engine_rpm(speed, gear, p) < down_at and engine_rpm(speed, gear - 1, p) < p.shift_rpm * 0.97:
        gear -= 1
    return gear


def _update_drs(state: CarState, setup: CarSetup, requests: DriverRequests, allowed: bool, throttle: float,
                brake: float, steering: float) -> tuple[bool, bool]:
    """(open, available). X-mode may only be open on a straight; braking always closes it."""
    available = allowed and setup.drs_mode != "off"
    if not available or brake > 0.05:
        return False, available
    if setup.drs_mode == "auto":
        return throttle > 0.9 and abs(steering) < 0.15, available
    opened = state.drs_open
    if requests.drs_toggle % 2 == 1:
        opened = not opened
    return opened, available


# ------------------------------------------------------------------ integration


def _step_reverse(s: CarState, heading: float, steering: float, throttle: float, brake: float, dt: float,
                  grip: float, brake_scale: float, p: CarParams) -> tuple[CarState, float, float, float]:
    """Reversing is always slow, so a kinematic model is enough: throttle drives
    backwards up to reverse_max_speed, the brake stops the car."""
    vx = s.vx
    drive = throttle * p.reverse_force * (1.0 if -vx < p.reverse_max_speed else 0.0)
    stop = brake * min(p.brake_force_max * brake_scale, grip * p.mu_long * p.mass * G) + 300.0
    force = -drive + (stop if vx < 0 else -stop if vx > 0 else 0.0)
    ax = force / p.mass
    vx_new = vx + ax * dt
    if (vx < 0 <= vx_new and drive == 0) or (vx > 0 >= vx_new):
        vx_new = 0.0  # brakes/rolling resistance stop the car, they don't reverse its direction
    vx_new = max(-p.reverse_max_speed, vx_new)
    delta = steering * p.max_road_wheel_angle
    r = vx_new * math.tan(delta) / p.wheelbase
    mid = heading + r * dt / 2
    dx = vx_new * math.cos(mid) * dt
    dy = vx_new * math.sin(mid) * dt
    return (replace(s, vx=vx_new, vy=0.0, yaw_rate=r, rpm=p.idle_rpm + 4_000 * throttle, ax=ax, ay=vx_new * r,
                    tc_cut=0.0, wheelspin=False, front_lock=False, rear_lock=False, ers_deploy_kw=0.0),
            heading + r * dt, dx, dy)


SUBSTEP = 0.004  # s; tyre forces are stiff, so integrate finer than the 20 Hz session tick


def step_car(
    state: CarState,
    heading: float,
    steering: float,
    throttle: float,
    brake: float,
    dt: float,
    *,
    grip: float = 1.0,
    brake_scale: float = 1.0,
    power_scale: float = 1.0,
    setup: CarSetup = DEFAULT_SETUP,
    requests: DriverRequests = NO_REQUESTS,
    drs_allowed: bool = False,
    offroad_drag: float = 0.0,
    p: CarParams = CAR,
) -> tuple[CarState, float, float, float]:
    """Advance the car by dt. Returns (new state, new heading, dx, dy) in world frame.

    `grip` scales tyre friction (weather, faults, runoff), `brake_scale`
    the brake system (wear/fade), `power_scale` the drive (off-road),
    `offroad_drag` adds a resistance force in N (gravel/grass).
    """
    steering = max(-1.0, min(1.0, steering))
    throttle = max(0.0, min(1.0, throttle))
    brake = max(0.0, min(1.0, brake))

    gear = _update_gear(state, setup, requests, throttle, brake, p)
    if gear == REVERSE:
        return _step_reverse(replace(state, gear=gear, drs_open=False, drs_available=False),
                             heading, steering, throttle, brake, dt, grip, brake_scale, p)
    drs_open, drs_available = _update_drs(state, setup, requests, drs_allowed, throttle, brake, steering)
    s = replace(state, gear=gear, drs_open=drs_open, drs_available=drs_available)

    n = max(1, math.ceil(dt / SUBSTEP))
    h = dt / n
    dx = dy = 0.0
    a, b, L, m = p.cg_to_front, p.cg_to_rear, p.wheelbase, p.mass
    cla, cda = aero_coefficients(drs_open, p)
    for _ in range(n):
        vx, vy, r = s.vx, s.vy, s.yaw_rate
        speed = math.hypot(vx, vy)
        q = 0.5 * RHO * speed * speed
        downforce = q * cla
        drag = q * cda + p.rolling_resistance * m * G + offroad_drag * (1 if speed > 0.1 else 0)

        # axle loads: static + aero + longitudinal load transfer
        transfer = m * s.ax * p.cg_height / L
        fz_f = max(0.0, m * G * b / L + downforce * p.aero_balance_front - transfer)
        fz_r = max(0.0, m * G * a / L + downforce * (1 - p.aero_balance_front) + transfer)
        cap_f_lat, cap_r_lat = grip * p.mu_lat * fz_f, grip * p.mu_lat * fz_r
        cap_f_long, cap_r_long = grip * p.mu_long * fz_f, grip * p.mu_long * fz_r

        # --- power unit ------------------------------------------------------
        rpm = engine_rpm(max(vx, 0.0), gear, p)
        ice = p.ice_power * _ice_power_fraction(rpm, p) * throttle
        taper = _mguk_taper(max(vx, 0.0), setup.ers_mode, p)
        mguk = p.mguk_power * taper * throttle if s.battery > 0 and rpm < p.rev_limit else 0.0
        battery = s.battery
        harvest = 0.0
        if setup.ers_mode == "harvest" and throttle > 0.8:
            harvest = min(p.harvest_mode_power, ice)
            ice -= harvest
        drive_power = (ice + mguk) * p.driveline_efficiency * power_scale
        drive_request = min(p.max_tractive_force, drive_power / max(vx, 1.5)) if vx >= 0 else 0.0

        # --- brakes -------------------------------------------------------------
        # brake_scale models worn/faded brakes: they deliver only that share of
        # the stopping force, even at full pedal (so wear matters at any speed).
        brake_total = brake * p.brake_force_max
        brake_f, brake_r = brake_total * p.brake_bias_front, brake_total * (1 - p.brake_bias_front)

        # longitudinal capacity left after cornering load (friction circle)
        fy_f_prev = abs(s.ay) * m * b / L
        fy_r_prev = abs(s.ay) * m * a / L
        room_f = math.sqrt(max(0.0, cap_f_long**2 - min(fy_f_prev, cap_f_lat) ** 2 * (cap_f_long / max(cap_f_lat, 1e-6)) ** 2))
        room_r = math.sqrt(max(0.0, cap_r_long**2 - min(fy_r_prev, cap_r_lat) ** 2 * (cap_r_long / max(cap_r_lat, 1e-6)) ** 2))
        room_f = max(room_f, 0.3 * cap_f_long)
        room_r = max(room_r, 0.3 * cap_r_long)

        if setup.abs:  # hold each axle just under its locking point
            brake_f, brake_r = min(brake_f, 0.97 * room_f), min(brake_r, 0.97 * room_r)
        brake_f, brake_r = brake_f * brake_scale, brake_r * brake_scale
        front_lock = brake_f > room_f and vx > 2.0
        fx_f = -(p.sliding_mu_ratio * cap_f_long if front_lock else brake_f)

        # rear axle: drive minus braking, with traction control / wheelspin / lockup
        tc_cut = 0.0
        wheelspin = rear_lock = False
        rear_brake = min(brake_r, room_r) if brake_r <= room_r else p.sliding_mu_ratio * cap_r_long
        rear_lock = brake_r > room_r and vx > 2.0
        drive = drive_request if brake < 0.05 else 0.0
        if setup.traction_control == "full":
            allowed = 0.90 * room_r
        elif setup.traction_control == "medium":
            allowed = 0.98 * room_r  # lets the rear work harder; a big lateral load can still break it loose
        else:
            allowed = math.inf
        if drive > allowed:
            tc_cut = 1.0 - allowed / drive
            drive = allowed
        if drive > room_r:
            wheelspin = True
            drive = p.sliding_mu_ratio * cap_r_long
        fx_r = drive - rear_brake

        # engine braking + coast harvesting when off the throttle
        if throttle < 0.05 and brake < 0.05 and vx > 5.0:
            coast = min(p.coast_harvest_power / vx, 0.3 * m * G)
            fx_r -= coast
            harvest += p.coast_harvest_power
        regen = min(p.regen_power, brake_r * max(vx, 0.0)) if brake > 0.05 else 0.0
        harvest += regen
        battery = min(p.battery_capacity, max(0.0, battery - mguk * h + harvest * h))

        # --- lateral tyre forces -------------------------------------------
        delta = steering * max_steer_angle(max(vx, 0.0), p, drs_open)
        vx_slip = max(vx, 1.0)
        slip_f = math.atan2(vy + a * r, vx_slip) - delta
        slip_r = math.atan2(vy - b * r, vx_slip)
        lat_f = math.sqrt(max(0.0, cap_f_lat**2 - (fx_f * cap_f_lat / max(cap_f_long, 1e-6)) ** 2))
        lat_r = math.sqrt(max(0.0, cap_r_lat**2 - (fx_r * cap_r_lat / max(cap_r_long, 1e-6)) ** 2))
        if front_lock:
            lat_f *= 0.3
        if rear_lock:
            lat_r *= 0.3
        if wheelspin:
            lat_r *= 0.35
        fy_f = _tyre_lateral(slip_f, lat_f, p)
        fy_r = _tyre_lateral(slip_r, lat_r, p)

        # --- equations of motion (body frame) ------------------------------
        cos_d, sin_d = math.cos(delta), math.sin(delta)
        fx = fx_f * cos_d - fy_f * sin_d + fx_r - drag * (1 if vx > 0 else 0)
        fy = fx_f * sin_d + fy_f * cos_d + fy_r
        ax = fx / m
        ay = fy / m
        yaw_acc = (a * (fy_f * cos_d + fx_f * sin_d) - b * fy_r) / p.yaw_inertia

        vx_new = vx + (ax + vy * r) * h
        vy_new = vy + (ay - vx * r) * h
        r_new = r + yaw_acc * h
        if vx_new < 0.0:  # brakes and drag don't drive the car backwards
            vx_new, vy_new, r_new = 0.0, 0.0, 0.0

        # low speed: tyre slip models break down, blend to kinematic steering
        w = min(1.0, max(0.0, (vx_new - 3.0) / 4.0))
        if w < 1.0:
            r_kin = vx_new * math.tan(delta) / L
            r_new = w * r_new + (1 - w) * r_kin
            vy_new = w * vy_new + (1 - w) * r_kin * b

        mid_heading = heading + r_new * h / 2
        dx += (vx_new * math.cos(mid_heading) - vy_new * math.sin(mid_heading)) * h
        dy += (vx_new * math.sin(mid_heading) + vy_new * math.cos(mid_heading)) * h
        heading += r_new * h

        s = replace(
            s, vx=vx_new, vy=vy_new, yaw_rate=r_new, rpm=min(engine_rpm(max(vx_new, 0.0), gear, p), p.rev_limit),
            battery=battery, ax=ax, ay=(fy / m), tc_cut=tc_cut, wheelspin=wheelspin, front_lock=front_lock,
            rear_lock=rear_lock, ers_deploy_kw=(mguk - harvest) / 1000.0,
        )
    return s, heading, dx, dy
