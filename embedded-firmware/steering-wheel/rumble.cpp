#include "rumble.h"

// See rumble.h for wiring and power.
static const int PIN_RUMBLE_SERVO = 12;

// Standard hobby-servo signal: a 50 Hz pulse train, pulse width = angle.
static const uint32_t PWM_HZ = 50;
static const uint8_t PWM_BITS = 14;
static const uint32_t PERIOD_US = 1000000 / PWM_HZ;
static const float CENTER_US = 1450.0f;             // SG90: ~500 us = 0 deg .. ~2400 us = 180 deg
static const float US_PER_DEG = 1900.0f / 180.0f;
static const float MAX_DEG = 35.0f;                 // never throw further than this from centre

static const uint32_t TICK_MS = 5;
static const uint32_t HOLD_TIMEOUT_MS = 500;        // no "#R" for this long: stop
static const uint32_t RELAX_AFTER_MS = 300;         // then back at centre this long: pulses off

// A one-shot jolt as keyframes: angle (scaled by strength) held for ms.
struct Step {
  int8_t deg;
  uint16_t ms;
};
// A hard knock that rings down, like a controller's crash rumble.
static const Step IMPACT[] = {{35, 70}, {-35, 70}, {28, 60}, {-28, 60}, {16, 55}, {-16, 55}, {8, 45}, {0, 60}};
// Tap-tap: the BRAKE warning, distinct from anything the car itself does.
static const Step WARNING[] = {{22, 60}, {0, 90}, {22, 60}, {0, 60}};

// Written by the serial loop (core 1), read by the servo task (core 0).
static portMUX_TYPE lock = portMUX_INITIALIZER_UNLOCKED;
static RumbleEffect heldEffect = RumbleEffect::None;
static uint8_t heldStrength = 0, heldRate = 0;
static uint32_t heldAtMs = 0;
static const Step* shot = nullptr;
static size_t shotLen = 0;
static uint8_t shotStrength = 0;
static uint32_t shotStartMs = 0;

void rumbleSet(RumbleEffect effect, uint8_t strengthPct, uint8_t rateHz) {
  portENTER_CRITICAL(&lock);
  heldEffect = effect;
  heldStrength = strengthPct > 100 ? 100 : strengthPct;
  heldRate = rateHz;
  heldAtMs = millis();
  portEXIT_CRITICAL(&lock);
}

void rumbleTrigger(RumbleEvent event, uint8_t strengthPct) {
  portENTER_CRITICAL(&lock);
  if (event == RumbleEvent::Impact) {
    shot = IMPACT;
    shotLen = sizeof IMPACT / sizeof IMPACT[0];
  } else {
    shot = WARNING;
    shotLen = sizeof WARNING / sizeof WARNING[0];
  }
  shotStrength = strengthPct > 100 ? 100 : strengthPct;
  shotStartMs = millis();
  portEXIT_CRITICAL(&lock);
}

static void writeDegrees(float deg) {
  float us = CENTER_US + constrain(deg, -MAX_DEG, MAX_DEG) * US_PER_DEG;
  ledcWrite(PIN_RUMBLE_SERVO, (uint32_t)(us * ((1 << PWM_BITS) - 1) / PERIOD_US));
}

// No pulses at all: the servo stops holding position, so it is silent and
// draws almost nothing between rumbles (and can't jitter on a noisy signal).
static void relax() { ledcWrite(PIN_RUMBLE_SERVO, 0); }

static void rumbleTask(void*) {
  float phase = 0;       // cycles through the current square wave
  bool up = false;       // which half of the wave
  float jitter = 1;      // rough surfaces: each bump a different size
  bool pulsing = false;  // sending pulses at all
  uint32_t stillSinceMs = 0;
  float lastDeg = NAN;
  TickType_t wake = xTaskGetTickCount();

  for (;;) {
    vTaskDelayUntil(&wake, pdMS_TO_TICKS(TICK_MS));
    const uint32_t now = millis();

    portENTER_CRITICAL(&lock);
    RumbleEffect effect = heldEffect;
    const uint8_t strength = heldStrength, rate = heldRate;
    const uint32_t heldAt = heldAtMs;
    const Step* steps = shot;
    const size_t len = shotLen;
    const uint8_t jolt = shotStrength;
    const uint32_t started = shotStartMs;
    portEXIT_CRITICAL(&lock);
    if (now - heldAt > HOLD_TIMEOUT_MS) effect = RumbleEffect::None;

    bool moving = false;
    float deg = 0;

    // A jolt takes over the servos until it has played out.
    if (steps != nullptr) {
      uint32_t at = now - started, t = 0;
      for (size_t i = 0; i < len; i++) {
        t += steps[i].ms;
        if (at < t) {
          deg = steps[i].deg * (jolt / 100.0f);
          moving = true;
          break;
        }
      }
      if (!moving) {
        portENTER_CRITICAL(&lock);
        if (shot == steps && shotStartMs == started) shot = nullptr;  // unless a new one arrived
        portEXIT_CRITICAL(&lock);
      }
    }

    // Held rumble: a square wave, since an SG90 can't follow anything finer at
    // these rates. Each half-wave needs ~25 ms of travel, hence the rate caps.
    if (!moving && effect != RumbleEffect::None) {
      const float s = strength / 100.0f;
      float amp, hz;
      switch (effect) {
        case RumbleEffect::Kerb:  amp = 6 + 14 * s; hz = constrain((float)rate, 4.0f, 18.0f); break;
        case RumbleEffect::Rough: amp = 4 + 9 * s;  hz = constrain((float)rate, 4.0f, 14.0f); break;
        default:                  amp = 3 + 5 * s;  hz = 20; break;  // Slip: a light fizz
      }
      phase += hz * TICK_MS / 1000.0f;
      while (phase >= 0.5f) {
        phase -= 0.5f;
        up = !up;
        jitter = effect == RumbleEffect::Rough ? 0.45f + (esp_random() % 1000) / 1800.0f : 1.0f;
      }
      deg = (up ? amp : -amp) * jitter;
      moving = true;
    }

    if (moving) {
      pulsing = true;
      stillSinceMs = now;
      if (deg != lastDeg) writeDegrees(deg);
      lastDeg = deg;
    } else if (pulsing) {
      if (lastDeg != 0) writeDegrees(0);  // back to centre first...
      lastDeg = 0;
      if (now - stillSinceMs > RELAX_AFTER_MS) {  // ...then let go
        relax();
        pulsing = false;
        lastDeg = NAN;
        phase = 0;
      }
    }
  }
}

void rumbleBegin() {
  ledcAttach(PIN_RUMBLE_SERVO, PWM_HZ, PWM_BITS);
  relax();
  // Core 0 next to the screen's task, at a higher priority so a long redraw
  // never makes the servos stutter; the input loop keeps core 1 to itself.
  xTaskCreatePinnedToCore(rumbleTask, "rumble", 2048, nullptr, 2, nullptr, 0);
}
