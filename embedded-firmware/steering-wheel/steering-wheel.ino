/*
  Streams steering (dual MPU averaged accel Y), throttle and brake
  (HW-504 joystick) as JSON matching the frontend's HardwareInputMessage
  contract exactly:

    { source, sequence, timestamp, steeringRaw, throttleRaw, brakeRaw, resetPressed }

  Pressing the joystick down (its SW pin) resets the car to the grid, the same
  as the "Reset to grid" button on the Drive screen.

  The 1.69" screen shows steering, throttle/brake, the link to the game, the
  live BRAKE warning and the send rate (see dashboard.h). The game-side half
  of that arrives back from bridge.py on the same USB serial as a line:

    #S <clients> <session> <active> <warning> <speed_kmh>

  Two SG90 servos rumble the wheel like a game controller's motors — kerbs,
  run-off, wheel slip, barrier hits and the BRAKE warning (see rumble.h):

    #R <effect> <strength_pct> <rate_hz>     #E <kind> <strength_pct>

  Wiring (Elegoo ESP32):
    MPU #1 (left):  VCC->3V3, GND->GND, SCL->D22, SDA->D21, AD0->GND   (0x68)
    MPU #2 (right): VCC->3V3, GND->GND, SCL->D22, SDA->D21, AD0->3V3  (0x69)
    HW-504:         GND->GND, VCC->3V3, VRx->D34, VRy->D35, SW->D25
    Screen:         GND->GND, VCC->3V3, SCL->D18, SDA->D23, RES->D4, DC->D2,
                    CS->D5, BLK->3V3
    Servos (x2):    signal->D12, V+->5V (not 3V3!), GND->GND  (power: rumble.h)

  Libraries (Library Manager): "Adafruit ST7735 and ST7789 Library" and
  "Adafruit GFX Library".
*/

#include <Wire.h>

#include "dashboard.h"
#include "rumble.h"

const int MPU_LEFT_ADDR  = 0x68;
const int MPU_RIGHT_ADDR = 0x69;
const int PWR_MGMT_1     = 0x6B;
const int ACCEL_XOUT_H   = 0x3B;

const int PIN_VRY = 35; // joystick forward/back -> throttle/brake
const int PIN_SW  = 25; // joystick pressed down  -> reset the car to the grid

// Where the joystick rests is measured at boot, not assumed to be mid-scale:
// the HW-504's pot and the ESP32's ADC (which is not ratiometric to the 3V3
// rail) put "hands off" well away from 2048 — on this wheel ~1880, which read
// as 8% brake held on permanently. So keep the stick untouched while the
// wheel powers up. A reading outside this band means someone was holding it;
// then the old mid-scale assumption is used instead.
const int JOY_ADC_MAX = 4095;
const int JOY_CENTER_DEFAULT = 2048;
const int JOY_CENTER_MIN = 1200, JOY_CENTER_MAX = 2900;
int joyCenter = JOY_CENTER_DEFAULT;

// One joystick reading: 8 ADC samples, highest and lowest dropped, rest
// averaged. The ESP32 ADC jitters by ~±2% here and occasionally spikes (one
// sample read 1366 at rest — a one-frame 33% brake stab); the trimmed mean
// removes the spikes and most of the jitter for ~0.3 ms.
int readJoystickY() {
  int lo = JOY_ADC_MAX, hi = 0;
  long sum = 0;
  for (int i = 0; i < 8; i++) {
    int v = analogRead(PIN_VRY);
    sum += v;
    lo = min(lo, v);
    hi = max(hi, v);
  }
  return (int)((sum - lo - hi) / 6);
}

// -1 (full back) .. 0 (rest) .. +1 (full forward). Each side is scaled by its
// own travel, since the centre is no longer the middle of the range.
float joystickAxis(int raw, int center) {
  float v = raw >= center ? (raw - center) / (float)(JOY_ADC_MAX - center)
                          : (raw - center) / (float)center;
  return constrain(v, -1.0f, 1.0f);
}

int calibrateJoystickCenter() {
  long sum = 0;
  const int N = 32;
  for (int i = 0; i < N; i++) {
    sum += readJoystickY();
    delay(5);
  }
  return (int)(sum / N);
}

uint32_t sequence = 0;

DashboardState dash;

// Send-rate measurement for the screen: packets counted over ~1 s windows.
uint32_t rateWindowStartMs = 0;
uint32_t rateWindowCount = 0;

// Status lines from bridge.py arrive on the same serial port we print to.
char bridgeLine[48];
size_t bridgeLineLen = 0;

void handleBridgeLine(const char* line) {
  int effect, strength, rate;
  if (sscanf(line, "#R %d %d %d", &effect, &strength, &rate) == 3) {
    rumbleSet((RumbleEffect)constrain(effect, 0, 3), (uint8_t)constrain(strength, 0, 100),
              (uint8_t)constrain(rate, 0, 50));
    return;
  }
  if (sscanf(line, "#E %d %d", &effect, &strength) == 2) {
    if (effect == 1 || effect == 2) rumbleTrigger((RumbleEvent)effect, (uint8_t)constrain(strength, 0, 100));
    return;
  }
  int clients, session, active, warning, speedKmh;
  if (sscanf(line, "#S %d %d %d %d %d", &clients, &session, &active, &warning, &speedKmh) != 5) {
    return;  // not a status line (or a torn one): ignore
  }
  dash.bridgeSeenMs = millis();
  if (dash.bridgeSeenMs == 0) dash.bridgeSeenMs = 1;  // 0 means "never seen"
  dash.gameClients = (uint8_t)constrain(clients, 0, 255);
  dash.session = (uint8_t)constrain(session, 0, 2);
  dash.active = active != 0;
  dash.warning = (WarningState)constrain(warning, 0, 2);
  dash.speedKmh = (int16_t)constrain(speedKmh, -1, 999);
}

// Non-blocking: takes whatever has arrived and returns straight away.
void pollBridge() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n') {
      bridgeLine[bridgeLineLen] = '\0';
      handleBridgeLine(bridgeLine);
      bridgeLineLen = 0;
    } else if (c != '\r') {
      if (bridgeLineLen < sizeof bridgeLine - 1) {
        bridgeLine[bridgeLineLen++] = c;
      } else {
        bridgeLineLen = 0;  // overlong garbage: drop it; the next newline resyncs
      }
    }
  }
}

void countSent(uint32_t nowMs) {
  rateWindowCount++;
  uint32_t elapsed = nowMs - rateWindowStartMs;
  if (elapsed >= 1000) {
    dash.sendRateHz = rateWindowCount * 1000.0f / elapsed;
    rateWindowStartMs = nowMs;
    rateWindowCount = 0;
  }
}

void mpuWrite(uint8_t addr, uint8_t reg, uint8_t value) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

void mpuWake(uint8_t addr) {
  mpuWrite(addr, PWR_MGMT_1, 0x00);
}

int16_t readAccelY(uint8_t addr) {
  Wire.beginTransmission(addr);
  Wire.write(ACCEL_XOUT_H);
  Wire.endTransmission(false);
  Wire.requestFrom((int)addr, 4, true);

  Wire.read(); Wire.read();       // skip accelX
  int16_t y = (Wire.read() << 8) | Wire.read();
  return y;
}

float accelG(int16_t raw) { return raw / 16384.0; }

void setup() {
  Serial.begin(115200);
  delay(500);

  Wire.begin(21, 22);
  mpuWake(MPU_LEFT_ADDR);
  mpuWake(MPU_RIGHT_ADDR);

  // The HW-504's switch closes to GND, so it needs the internal pull-up:
  // released reads HIGH, pressed reads LOW.
  pinMode(PIN_SW, INPUT_PULLUP);

  dashboardBegin();
  rumbleBegin();

  // Measure the joystick's rest point with the screen already running: its
  // backlight and SPI load shift the 3V3 rail, and the ADC reading with it.
  delay(400);
  int measured = calibrateJoystickCenter();
  bool plausible = measured >= JOY_CENTER_MIN && measured <= JOY_CENTER_MAX;
  joyCenter = plausible ? measured : JOY_CENTER_DEFAULT;
  // Not JSON, so bridge.py ignores it; visible in the Serial Monitor.
  Serial.printf("# joystick centre %d (%s)\n", joyCenter,
                plausible ? "measured at boot" : "default: stick was held during boot?");

  rateWindowStartMs = millis();
}

void loop() {
  pollBridge();

  float leftY  = accelG(readAccelY(MPU_LEFT_ADDR));
  float rightY = accelG(readAccelY(MPU_RIGHT_ADDR));
  float steeringRaw = (leftY + rightY) / 2.0;

  // Joystick forward = throttle, joystick back = brake, split from one axis.
  float joyNorm = joystickAxis(readJoystickY(), joyCenter); // -1..1
  float throttleRaw = joyNorm > 0 ? joyNorm : 0.0;
  float brakeRaw     = joyNorm < 0 ? -joyNorm : 0.0;

  bool resetPressed = digitalRead(PIN_SW) == LOW; // pulled up, so LOW = pressed

  sequence++;

  Serial.printf(
    "{\"source\": \"esp32\", \"sequence\": %lu, \"timestamp\": %lu, "
    "\"steeringRaw\": %.3f, \"throttleRaw\": %.3f, \"brakeRaw\": %.3f, "
    "\"resetPressed\": %s}\n",
    (unsigned long)sequence, (unsigned long)millis(), steeringRaw, throttleRaw, brakeRaw,
    resetPressed ? "true" : "false"
  );

  countSent(millis());
  dash.steeringRaw = steeringRaw;
  dash.throttleRaw = throttleRaw;
  dash.brakeRaw = brakeRaw;
  dash.sequence = sequence;
  dashboardPublish(dash);

  delay(20); // ~50Hz
}