/*
  Streams steering value continuously as JSON, for the Python game to read.
  Uses averaged accel Y from both MPUs (the axis we confirmed works).

  Wiring (Elegoo ESP32):
    MPU #1 (left):  VCC->3V3, GND->GND, SCL->D22, SDA->D21, AD0->GND   (0x68)
    MPU #2 (right): VCC->3V3, GND->GND, SCL->D22, SDA->D21, AD0->3V3  (0x69)
*/

#include <Wire.h>

const int MPU_LEFT_ADDR  = 0x68;
const int MPU_RIGHT_ADDR = 0x69;
const int PWR_MGMT_1     = 0x6B;
const int ACCEL_XOUT_H   = 0x3B;

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
  Wire.requestFrom((int)addr, 4, true); // just need accelX, accelY (4 bytes)

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
}

void loop() {
  float leftY  = accelG(readAccelY(MPU_LEFT_ADDR));
  float rightY = accelG(readAccelY(MPU_RIGHT_ADDR));
  float steering = (leftY + rightY) / 2.0;

  // Clamp to roughly the range we measured (-0.8 to 0.8) and send as JSON
  Serial.printf("{\"steering\": %.3f}\n", steering);

  delay(20); // ~50Hz
}