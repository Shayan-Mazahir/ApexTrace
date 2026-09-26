"""Simplified physics and system constants.

These are deliberately round numbers for a hackathon prototype, not measured
F1 values. Units are SI (m, s, m/s, m/s^2) unless a name says otherwise.
"""

# Simulation clock. 100 Hz gives 10 ms resolution for telemetry delay faults.
DT = 0.01
MAX_SIM_TIME = 240.0  # one lap; generous so a slow lap never times out
# Keep simulating this long after leaving the track so replays show the excursion.
POST_FAILURE_TIME = 0.5

# Tyre/aero: total acceleration available = grip * GRIP_ACCEL.
# ~2.45 g at grip 1.0, standing in for a downforce-assisted friction limit.
GRIP_ACCEL = 24.0

# Powertrain: drive accel = throttle * min(MAX_TRACTION_ACCEL, POWER_COEFF / v).
MAX_TRACTION_ACCEL = 12.0
POWER_COEFF = 700.0
# Aero drag deceleration = DRAG_COEFF * v^2 (top speed ~92 m/s).
DRAG_COEFF = 0.0009

# Steering: steering in [-1, 1] maps to commanded path curvature (1/m).
MAX_STEER_CURVATURE = 0.1
MIN_SPEED_FOR_CURVATURE = 1.0

# Safety warning system assumptions (what the *prototype system* believes).
WARNING_LATERAL_FACTOR = 0.9      # advised corner speed uses 90% of estimated grip
WARNING_BRAKE_FACTOR = 0.85       # assumes 85% of estimated grip is usable for braking
WARNING_ASSUMED_BRAKE_EFFECTIVENESS = 1.0  # the system does not know about brake wear
WARNING_ASSUMED_REACTION = 0.5    # seconds of driver reaction it budgets for
CAUTION_DISTANCE_FACTOR = 1.5
CAUTION_DISTANCE_EXTRA = 20.0
SAFE_SPEED_TOLERANCE = 0.5
WARNING_LOOKAHEAD = 1000.0      # metres of track the system checks ahead

# Telemetry faults.
SPEED_NOISE_STD = 2.5             # m/s at sensor_noise = 1.0
POSITION_NOISE_STD = 4.0          # m along track at sensor_noise = 1.0
NOISE_CLIP_SIGMA = 3.0
PACKET_LOSS_MEAN_BURST_TICKS = 20  # losses arrive in bursts (Gilbert-Elliott model)
SHADOW_ZONE_LOSS_MULTIPLIER = 3.0
# Local warning fallback takes over when remote telemetry is older than this.
LOCAL_FALLBACK_STALE_S = 0.12
# Telemetry older than this counts as stale in metrics.
STALE_TELEMETRY_S = 0.12
