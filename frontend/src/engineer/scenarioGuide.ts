// Plain-language "what will happen" for each saved scenario, so the engineer
// does not have to decode fault types. Keys are scenario ids.
export interface ScenarioGuide {
  story: string
  watch: string
}

export const SCENARIO_GUIDE: Record<string, ScenarioGuide> = {
  monza_wet_braking: {
    story: 'Rain hits the braking zone for the first chicane. The road gets slippery (60% grip) but the car\'s grip estimate only notices about 4 seconds later.',
    watch: 'The BRAKE warning fires as if the road were dry, so you need much more room to stop. Grip actual vs estimated (Link section) drifts apart.',
  },
  monza_fade_stale_speed: {
    story: 'The brakes fade a little (90%) a few seconds into the lap, and the telemetry the warning system sees is 350 ms old approaching Ascari.',
    watch: 'Two small problems that are fine alone but stack up: the warning is late and the car needs more braking distance.',
  },
  monza_high_speed_blackout: {
    story: 'The radio link to the warning system dies for about 390 m right before the first chicane, at top speed.',
    watch: 'No fresh data reaches the warning system, so the driver sees WARNING DATA STALE instead of BRAKE. Only the Local fallback upgrade can cover this.',
  },
  monza_slow_brake_response: {
    story: 'The brake system reacts 300 ms late to every pedal press, and the driver carries extra speed into corners.',
    watch: 'The car brakes later than the driver asked. Watch the minimum clearance shrink at the chicanes.',
  },
  baku_position_error: {
    story: 'The car\'s position sensor reads 30 m behind reality approaching the castle section.',
    watch: 'The warning system thinks the corner is further away than it is, so the BRAKE warning arrives 30 m too late.',
  },
  baku_stale_after_reconnect: {
    story: 'A short blackout before Turn 7. When the link returns, messages queued during the outage all arrive late.',
    watch: 'Old data must not override newer data. Look for the driver seeing STALE, then recovering cleanly.',
  },
  baku_late_warning_delivery: {
    story: 'The car\'s data is fine, but the BRAKE warning takes an extra 450 ms to get back to the driver.',
    watch: 'The warning is correct but late. The Communication upgrade shortens that delay.',
  },
  baku_sensor_freeze: {
    story: 'The speed sensor freezes on its last value while packets keep arriving, on the run to Turn 16.',
    watch: 'Packets look fresh but the speed is wrong. No upgrade fixes this one, because the local fallback reads the same frozen sensor.',
  },
  false_alarm_speed_overread: {
    story: 'The speed sensor reads 20% too high for the whole lap. Nothing else is wrong.',
    watch: 'The system panics: it warns to brake when the real speed is fine. This test counts those false alarms.',
  },
  shared_sensor_failure: {
    story: 'At Baku the speed sensor reads 20% low AND telemetry is 300 ms late.',
    watch: 'Shows a limit of the local fallback: it uses the same broken sensor, so it cannot fix the under-read.',
  },
  recovery_test: {
    story: 'A 4-second blackout and a 15-second grip loss both happen mid-lap, then both end.',
    watch: 'Not about crashing: checks that data freshness and the warning state return to normal afterwards.',
  },
  combined_moderate: {
    story: 'At Ascari: moderate grip loss (80%) plus 250 ms of telemetry delay, started 450 m before the braking zone.',
    watch: 'Each fault alone is survivable. Use the garage\'s controlled comparison to see what happens together.',
  },
}
