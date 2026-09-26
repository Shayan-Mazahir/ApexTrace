#include "dashboard.h"

#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <SPI.h>

// ---- hardware ---------------------------------------------------------------

static const int8_t PIN_TFT_SCK  = 18;  // "SCL" on the module
static const int8_t PIN_TFT_MOSI = 23;  // "SDA" on the module
static const int8_t PIN_TFT_CS   = 5;
static const int8_t PIN_TFT_DC   = 2;
static const int8_t PIN_TFT_RST  = 4;

// 40 MHz is comfortable for short wires; if the picture is garbled or
// speckled with long jumpers, drop this to 20000000.
static const uint32_t TFT_SPI_HZ = 40000000;

// 0 = portrait with the pin header at the top; 2 flips it upside down.
static const uint8_t TFT_ROTATION = 0;

// ---- timing -----------------------------------------------------------------

static const uint32_t FRAME_MS = 50;             // 20 fps is plenty for a glance
static const uint32_t BRIDGE_TIMEOUT_MS = 1500;  // bridge.py sends status at 10 Hz

// Same full-lock reading HardwareAdapter.ts scales by, so the bar here fills
// exactly when the game's steering reaches ±1.
static const float STEERING_FULL_SCALE = 0.8f;

// ---- look -------------------------------------------------------------------

static constexpr uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

static constexpr uint16_t BG      = rgb(8, 9, 12);
static constexpr uint16_t PANEL   = rgb(28, 30, 38);
static constexpr uint16_t TRACK   = rgb(20, 22, 28);   // empty part of a bar
static constexpr uint16_t OUTLINE = rgb(70, 74, 88);
static constexpr uint16_t TEXT    = rgb(240, 240, 245);
static constexpr uint16_t DIM     = rgb(125, 130, 145);
static constexpr uint16_t BLACK   = rgb(0, 0, 0);
static constexpr uint16_t GREEN   = rgb(40, 205, 95);
static constexpr uint16_t AMBER   = rgb(245, 170, 20);
static constexpr uint16_t RED     = rgb(230, 35, 35);
static constexpr uint16_t BLUE    = rgb(60, 160, 255);

// Built-in font: 6x8 pixels per character at text size 1 (incl. spacing).
static constexpr int16_t CHAR_W = 6, CHAR_H = 8;

// 240x280 portrait. The 1.69" glass has rounded corners, so everything keeps
// clear of them.
static constexpr int16_t SCREEN_W = 240;
static constexpr int16_t CX = SCREEN_W / 2;

// status banner
static constexpr int16_t BANNER_X = 10, BANNER_Y = 8, BANNER_W = 220, BANNER_H = 34;

// steering: label + value row, then a centre-zero bar
static constexpr int16_t STEER_TEXT_Y = 52;
static constexpr int16_t STEER_BAR_Y = 78, STEER_BAR_H = 20, STEER_HALF = 100;

// throttle / brake rows
static constexpr int16_t PEDAL_BAR_X = 58, PEDAL_BAR_W = 114, PEDAL_BAR_H = 16;
static constexpr int16_t THR_Y = 112, BRK_Y = 140;  // top of each bar's fill
static constexpr int16_t PEDAL_PCT_X = 180;

// warning / speed panel
static constexpr int16_t PANEL_X = 10, PANEL_Y = 168, PANEL_W = 220, PANEL_H = 70;

// footer: send rate and packet number
static constexpr int16_t FOOTER_Y = 250;

static Adafruit_ST7789 tft(PIN_TFT_CS, PIN_TFT_DC, PIN_TFT_RST);

// ---- shared state (sensor loop -> drawing task) -------------------------------

static portMUX_TYPE stateLock = portMUX_INITIALIZER_UNLOCKED;
static DashboardState published;

void dashboardPublish(const DashboardState& state) {
  portENTER_CRITICAL(&stateLock);
  published = state;
  portEXIT_CRITICAL(&stateLock);
}

static DashboardState snapshot() {
  portENTER_CRITICAL(&stateLock);
  DashboardState copy = published;
  portEXIT_CRITICAL(&stateLock);
  return copy;
}

GameLink gameLinkOf(const DashboardState& s, uint32_t nowMs) {
  if (s.bridgeSeenMs == 0 || nowMs - s.bridgeSeenMs > BRIDGE_TIMEOUT_MS) return GameLink::NoBridge;
  if (s.gameClients == 0) return GameLink::NoGame;
  if (s.session == 0) return GameLink::NoSession;
  if (s.session == 1) return GameLink::Connecting;
  return s.active ? GameLink::Live : GameLink::NotActive;
}

// ---- drawing helpers ----------------------------------------------------------

static int16_t textWidth(const char* text, uint8_t size) {
  // the last character's spacing column is not part of the visible text
  return (int16_t)strlen(text) * CHAR_W * size - size;
}

// Text drawn with a background colour repaints its own cells, so a value can
// be overwritten in place without clearing (no flicker) — as long as the new
// string is at least as wide as the old one, hence the fixed-width formats.
static void drawText(const char* text, int16_t x, int16_t y, uint8_t size, uint16_t fg, uint16_t bg) {
  tft.setTextSize(size);
  tft.setTextColor(fg, bg);
  tft.setCursor(x, y);
  tft.print(text);
}

static void drawCentered(const char* text, int16_t cx, int16_t y, uint8_t size, uint16_t fg, uint16_t bg) {
  drawText(text, cx - textWidth(text, size) / 2, y, size, fg, bg);
}

// Paints [x, x+w) of one bar row, filled up to `filled` pixels.
static void drawFill(int16_t x, int16_t y, int16_t w, int16_t h, int16_t filled, uint16_t color) {
  filled = constrain(filled, 0, w);
  if (filled > 0) tft.fillRect(x, y, filled, h, color);
  if (filled < w) tft.fillRect(x + filled, y, w - filled, h, TRACK);
}

// ---- widgets ------------------------------------------------------------------

struct LinkStyle {
  const char* text;
  uint16_t bg;
  uint16_t fg;
};

static LinkStyle styleOf(GameLink link) {
  switch (link) {
    case GameLink::NoBridge:   return {"NO BRIDGE", RED, TEXT};
    case GameLink::NoGame:     return {"NO GAME", AMBER, BLACK};
    case GameLink::NoSession:  return {"NO SESSION", AMBER, BLACK};
    case GameLink::Connecting: return {"CONNECTING", AMBER, BLACK};
    case GameLink::NotActive:  return {"WHEEL NOT IN USE", AMBER, BLACK};
    case GameLink::Live:       return {"LIVE", GREEN, BLACK};
  }
  return {"?", RED, TEXT};
}

static void drawBanner(GameLink link) {
  const LinkStyle style = styleOf(link);
  tft.fillRoundRect(BANNER_X, BANNER_Y, BANNER_W, BANNER_H, 8, style.bg);
  drawCentered(style.text, CX, BANNER_Y + (BANNER_H - CHAR_H * 2) / 2, 2, style.fg, style.bg);
}

// Centre-zero bar: fills left or right of the centre line. The centre column
// itself is never painted here, so the tick drawn once in the layout stays.
static void drawSteeringBar(int16_t px) {
  const int16_t leftFill = px < 0 ? -px : 0;
  const int16_t rightFill = px > 0 ? px : 0;
  // left half grows leftwards from the centre, so paint its empty part first
  tft.fillRect(CX - STEER_HALF, STEER_BAR_Y, STEER_HALF - leftFill, STEER_BAR_H, TRACK);
  if (leftFill > 0) tft.fillRect(CX - leftFill, STEER_BAR_Y, leftFill, STEER_BAR_H, BLUE);
  drawFill(CX + 1, STEER_BAR_Y, STEER_HALF, STEER_BAR_H, rightFill, BLUE);
}

static void drawSteeringValue(float g) {
  char text[12];
  snprintf(text, sizeof text, "%+5.2f g", constrain(g, -9.99f, 9.99f));
  drawText(text, 224 - textWidth("+0.00 g", 2), STEER_TEXT_Y, 2, TEXT, BG);
}

static void drawPedal(int16_t y, int16_t px, int pct, uint16_t color) {
  drawFill(PEDAL_BAR_X, y, PEDAL_BAR_W, PEDAL_BAR_H, px, color);
  char text[8];
  snprintf(text, sizeof text, "%3d%%", pct);
  drawText(text, PEDAL_PCT_X, y, 2, TEXT, BG);
}

enum class PanelMode : uint8_t { NoSession, Speed, Brake, Stale };

static PanelMode panelOf(GameLink link, WarningState warning) {
  const bool inSession = link == GameLink::Live || link == GameLink::NotActive;
  if (!inSession) return PanelMode::NoSession;
  if (warning == WarningState::Brake) return PanelMode::Brake;
  if (warning == WarningState::Stale) return PanelMode::Stale;
  return PanelMode::Speed;
}

// Big number + "km/h", bottom-aligned; "---" when unknown or no session.
static void drawSpeed(int16_t kmh, uint16_t fg) {
  char number[8];
  if (kmh < 0) snprintf(number, sizeof number, "---");
  else snprintf(number, sizeof number, "%3d", constrain((int)kmh, 0, 999));
  const int16_t numberW = 3 * CHAR_W * 5;  // always 3 characters wide
  const int16_t gap = 8;
  const int16_t totalW = numberW + gap + textWidth("km/h", 2);
  const int16_t x = CX - totalW / 2;
  const int16_t y = PANEL_Y + (PANEL_H - CHAR_H * 5) / 2;
  drawText(number, x, y, 5, fg, PANEL);
  drawText("km/h", x + numberW + gap, y + CHAR_H * 5 - CHAR_H * 2, 2, DIM, PANEL);
}

static void drawPanel(PanelMode mode, int16_t speedKmh) {
  const int16_t textY5 = PANEL_Y + (PANEL_H - CHAR_H * 5) / 2;
  switch (mode) {
    case PanelMode::Brake:
      tft.fillRoundRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 10, RED);
      drawCentered("BRAKE", CX, textY5, 5, TEXT, RED);
      break;
    case PanelMode::Stale:
      tft.fillRoundRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 10, AMBER);
      drawCentered("STALE", CX, textY5, 5, BLACK, AMBER);
      break;
    case PanelMode::Speed:
    case PanelMode::NoSession:
      tft.fillRoundRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 10, PANEL);
      drawSpeed(mode == PanelMode::Speed ? speedKmh : -1, mode == PanelMode::Speed ? TEXT : DIM);
      break;
  }
}

// Two fixed-position, fixed-width fields, so a shorter value never leaves old
// digits behind: the rate on the left, the packet number right-aligned in a
// field wide enough for any uint32_t ("#4294967295").
static void drawFooter(int hz, uint32_t sequence) {
  char rate[12];
  snprintf(rate, sizeof rate, "%3d Hz", constrain(hz, 0, 999));
  drawText(rate, 16, FOOTER_Y, 2, DIM, BG);

  char number[12];
  snprintf(number, sizeof number, "#%lu", (unsigned long)sequence);
  char field[12];
  snprintf(field, sizeof field, "%11s", number);  // pad on the left: right-aligned
  drawText(field, 224 - textWidth(field, 2), FOOTER_Y, 2, DIM, BG);
}

static void drawLayout() {
  tft.fillScreen(BG);
  drawText("STEER", 16, STEER_TEXT_Y, 2, DIM, BG);
  // steering bar frame + the centre tick (never repainted afterwards)
  tft.drawRect(CX - STEER_HALF - 2, STEER_BAR_Y - 2, STEER_HALF * 2 + 5, STEER_BAR_H + 4, OUTLINE);
  tft.drawFastVLine(CX, STEER_BAR_Y - 2, STEER_BAR_H + 4, TEXT);
  // pedal bars
  drawText("THR", 16, THR_Y, 2, DIM, BG);
  drawText("BRK", 16, BRK_Y, 2, DIM, BG);
  tft.drawRect(PEDAL_BAR_X - 2, THR_Y - 2, PEDAL_BAR_W + 4, PEDAL_BAR_H + 4, OUTLINE);
  tft.drawRect(PEDAL_BAR_X - 2, BRK_Y - 2, PEDAL_BAR_W + 4, PEDAL_BAR_H + 4, OUTLINE);
}

// ---- drawing task -------------------------------------------------------------

// What is currently on the glass, so a widget is redrawn only when it changes.
// Only read after the first full draw (`valid`), but initialised anyway.
struct Shown {
  bool valid = false;
  GameLink link = GameLink::NoBridge;
  int16_t steerPx = 0, steerCenti = 0;
  int16_t thrPx = 0, brkPx = 0;
  int thrPct = 0, brkPct = 0;
  PanelMode panel = PanelMode::NoSession;
  int16_t speedKmh = -1;
  int hz = 0;
  uint32_t sequence = 0;
};

static void drawFrame(const DashboardState& s, Shown& shown) {
  const uint32_t now = millis();
  const GameLink link = gameLinkOf(s, now);
  const bool all = !shown.valid;

  if (all || link != shown.link) drawBanner(link);

  const float steer = constrain(s.steeringRaw / STEERING_FULL_SCALE, -1.0f, 1.0f);
  const int16_t steerPx = (int16_t)lroundf(steer * STEER_HALF);
  if (all || steerPx != shown.steerPx) drawSteeringBar(steerPx);
  const int16_t steerCenti = (int16_t)lroundf(constrain(s.steeringRaw, -9.99f, 9.99f) * 100);
  if (all || steerCenti != shown.steerCenti) drawSteeringValue(s.steeringRaw);

  const float thr = constrain(s.throttleRaw, 0.0f, 1.0f);
  const float brk = constrain(s.brakeRaw, 0.0f, 1.0f);
  const int16_t thrPx = (int16_t)lroundf(thr * PEDAL_BAR_W);
  const int16_t brkPx = (int16_t)lroundf(brk * PEDAL_BAR_W);
  const int thrPct = (int)lroundf(thr * 100);
  const int brkPct = (int)lroundf(brk * 100);
  if (all || thrPx != shown.thrPx || thrPct != shown.thrPct) drawPedal(THR_Y, thrPx, thrPct, GREEN);
  if (all || brkPx != shown.brkPx || brkPct != shown.brkPct) drawPedal(BRK_Y, brkPx, brkPct, RED);

  const PanelMode panel = panelOf(link, s.warning);
  if (all || panel != shown.panel) {
    drawPanel(panel, s.speedKmh);
  } else if (panel == PanelMode::Speed && s.speedKmh != shown.speedKmh) {
    drawSpeed(s.speedKmh, TEXT);  // same panel: repaint the digits only
  }

  const int hz = (int)lroundf(s.sendRateHz);
  if (all || hz != shown.hz || s.sequence != shown.sequence) drawFooter(hz, s.sequence);

  shown = {true, link, steerPx, steerCenti, thrPx, brkPx, thrPct, brkPct, panel, s.speedKmh, hz, s.sequence};
}

static void dashboardTask(void*) {
  // Pin the bus explicitly; the library's own SPI.begin() is then a no-op.
  SPI.begin(PIN_TFT_SCK, -1, PIN_TFT_MOSI, -1);
  tft.init(240, 280);  // the 1.69" panel: the library applies its 20-row offset
  tft.setSPISpeed(TFT_SPI_HZ);
  tft.setRotation(TFT_ROTATION);
  drawLayout();

  Shown shown;
  TickType_t wake = xTaskGetTickCount();
  for (;;) {
    drawFrame(snapshot(), shown);
    vTaskDelayUntil(&wake, pdMS_TO_TICKS(FRAME_MS));
  }
}

void dashboardBegin() {
  // Core 0: the Arduino loop (sensors + serial) runs on core 1, and nothing
  // else needs core 0 here (no Wi-Fi/Bluetooth), so drawing never competes
  // with the 50 Hz input stream.
  xTaskCreatePinnedToCore(dashboardTask, "dashboard", 6144, nullptr, 1, nullptr, 0);
}
