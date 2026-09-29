/*
  Display bring-up test for the 1.69" 240x280 ST7789V2 (4-wire SPI).
  Cycles black/red/green/blue and prints "Hello!" .

  Ideally I would recommend doing this before anything, since if you 
  wire everything up and the screen ends up not workin, that's going to a pain in the arse to figure out why

  (Highly depends on your model) 
  Wiring: GND->GND, VCC->3V3, SCL->D18, SDA->D23, RES->D4, DC->D2, CS->D5, BLK->3V3
*/

#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <SPI.h>

#define TFT_CS   5
#define TFT_DC   2
#define TFT_RST  4

Adafruit_ST7789 tft = Adafruit_ST7789(TFT_CS, TFT_DC, TFT_RST);

void setup() {
  tft.init(240, 280);
  tft.setRotation(0); // try 0,1,2,3 if orientation looks wrong

  tft.fillScreen(ST77XX_BLACK);
  delay(500);

  tft.fillScreen(ST77XX_RED);
  delay(500);
  tft.fillScreen(ST77XX_GREEN);
  delay(500);
  tft.fillScreen(ST77XX_BLUE);
  delay(500);

  tft.fillScreen(ST77XX_BLACK);
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(2);
  tft.setCursor(10, 10);
  tft.println("Hello!");
}

void loop() {
}
