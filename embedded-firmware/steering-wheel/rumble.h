#pragma once

#include <Arduino.h>

/*
  Force feedback: two SG90 micro servos in the wheel, shaken like the rumble
  motors in a game controller. Both share one signal pin, so they move as one.

    Servo 1 & 2:  signal (orange) -> D12
                  V+ (red)        -> 5 V   (NOT 3V3 — see below)
                  GND (brown)     -> GND   (common with the ESP32)

  Power: each SG90 can pull ~0.5-0.7 A when it reverses, and rumble reverses
  it 10-20 times a second. From the ESP32's 3V3 pin that browns the board out
  (resets, and the screen goes dark). Feed the servos from 5 V — a separate
  5 V supply is best; the ESP32's VIN/5V pin works for short demos off a good
  USB port — with a 470-1000 uF capacitor across the servos' V+ and GND, and
  the grounds joined.

  D12 is a boot strapping pin (it selects the flash voltage). A servo's
  signal input doesn't normally pull it high, but if the board ever fails to
  boot with the servos connected ("flash read err"), move the signal wire to
  D13, D14, D26, D27 or D33 and change PIN_RUMBLE_SERVO in rumble.cpp.

  The game sends (via bridge.py, on the same USB serial as the screen data):
    #R <effect> <strength_pct> <rate_hz>   held rumble: 0 none, 1 kerb, 2 rough, 3 slip
    #E <kind> <strength_pct>               one-shot:    1 barrier impact, 2 BRAKE warning
  A held rumble stops by itself 0.5 s after the last #R, so a closed game or
  a stopped bridge can never leave the servos buzzing.
*/

enum class RumbleEffect : uint8_t { None = 0, Kerb = 1, Rough = 2, Slip = 3 };
enum class RumbleEvent : uint8_t { Impact = 1, Warning = 2 };

// Starts the servo output and its timing task. Call once from setup().
void rumbleBegin();

// From "#R": the rumble to hold (until replaced, or 0.5 s without a repeat).
void rumbleSet(RumbleEffect effect, uint8_t strengthPct, uint8_t rateHz);

// From "#E": play a one-shot jolt now (held rumble resumes after it).
void rumbleTrigger(RumbleEvent event, uint8_t strengthPct);
