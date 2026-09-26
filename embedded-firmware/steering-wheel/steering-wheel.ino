/*
  Streams steering (dual MPU averaged accel Y), throttle and brake
  (HW-504 joystick) as JSON matching the frontend's HardwareInputMessage
  contract exactly:

    { source, sequence, timestamp, steeringRaw, throttleRaw, brakeRaw, resetPressed }

  Pressing the joystick down (its SW pin) resets the car to the grid, the same
  as the "Reset to grid" button on the Drive screen.

  Wiring (Elegoo ESP32):
    MPU #1 (left):  VCC->3V3, GND->GND, SCL->D22, SDA->D21, AD0->GND   (0x68)
    MPU #2 (right): VCC->3V3, GND->GND, SCL->D22, SDA->D21, AD0->3V3  (0x69)
    HW-504:         GND->GND, VCC->3V3, VRx->D34, VRy->D35, SW->D25
*/

#include <Wire.h>

const int MPU_LEFT_ADDR  = 0x68;
const int MPU_RIGHT_ADDR = 0x69;
const int PWR_MGMT_1     = 0x6B;
const int ACCEL_XOUT_H   = 0x3B;

const int PIN_VRY = 35; // joystick forward/back -> throttle/brake
const int PIN_SW  = 25; // joystick pressed down  -> reset the car to the grid
const int JOY_CENTER = 2048;

uint32_t sequence = 0;

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
}

void loop() {
  float leftY  = accelG(readAccelY(MPU_LEFT_ADDR));
  float rightY = accelG(readAccelY(MPU_RIGHT_ADDR));
  float steeringRaw = (leftY + rightY) / 2.0;

  // Joystick forward = throttle, joystick back = brake, split from one axis.
  int rawY = analogRead(PIN_VRY);
  float joyNorm = (rawY - JOY_CENTER) / (float)JOY_CENTER; // -1..1
  float throttleRaw = joyNorm > 0 ? joyNorm : 0.0;
  float brakeRaw     = joyNorm < 0 ? -joyNorm : 0.0;

  bool resetPressed = digitalRead(PIN_SW) == LOW; // pulled up, so LOW = pressed

  sequence++;

  Serial.printf(
    "{\"source\": \"esp32\", \"sequence\": %u, \"timestamp\": %lu, "
    "\"steeringRaw\": %.3f, \"throttleRaw\": %.3f, \"brakeRaw\": %.3f, "
    "\"resetPressed\": %s}\n",
    sequence, millis(), steeringRaw, throttleRaw, brakeRaw,
    resetPressed ? "true" : "false"
  );

  delay(20); // ~50Hz
}