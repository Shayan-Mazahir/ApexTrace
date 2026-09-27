#pragma once

#include <Arduino.h>

/*
  On-wheel dashboard for the 1.69" 240x280 ST7789V2 screen.

  The sensor loop publishes a DashboardState; a separate FreeRTOS task on the
  other core draws it. SPI drawing therefore never delays the 50 Hz input
  stream the game depends on.

  Wiring (4-wire SPI):
    GND->GND, VCC->3V3, SCL->D18, SDA->D23, RES->D4, DC->D2, CS->D5, BLK->3V3
*/

// Link to the game, as the screen reports it (top banner).
enum class GameLink : uint8_t {
  NoBridge,    // no status from bridge.py lately: it isn't running, or the port is closed
  NoGame,      // bridge up, but no browser has the Drive screen open
  NoSession,   // Drive screen open, no session started yet
  Connecting,  // session connecting or reconnecting to the backend
  NotActive,   // in a session, but the game is not steering with THIS wheel
  Live,        // in a session and the car is driven by this wheel
};

enum class WarningState : uint8_t { Clear = 0, Brake = 1, Stale = 2 };

struct DashboardState {
  // Measured on this ESP32.
  float steeringRaw = 0;    // averaged MPU accel Y, in g (about ±0.8 at full lock)
  float throttleRaw = 0;    // 0..1
  float brakeRaw = 0;       // 0..1
  uint32_t sequence = 0;    // number of the last packet sent to the bridge
  float sendRateHz = 0;     // packets actually sent per second

  // Reported back by bridge.py over the same USB serial ("#S ..." lines).
  uint32_t bridgeSeenMs = 0;  // millis() of the last status line; 0 = never
  uint8_t gameClients = 0;    // browser tabs connected to the bridge
  uint8_t session = 0;        // 0 none, 1 connecting, 2 connected
  bool active = false;        // the game is driving with this wheel
  WarningState warning = WarningState::Clear;
  int16_t speedKmh = -1;      // -1 unknown
};

// Starts the display and its drawing task. Call once from setup().
void dashboardBegin();

// Hands the latest state to the drawing task. Cheap; call every loop.
void dashboardPublish(const DashboardState& state);

// Derived banner state; exposed so the logic is one place.
GameLink gameLinkOf(const DashboardState& state, uint32_t nowMs);
