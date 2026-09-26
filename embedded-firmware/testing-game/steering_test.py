"""
Dead simple car game: black screen, one car, steer it left/right using the
ESP32's live steering value (averaged accel Y from two MPUs) sent over serial.

Setup:
    pip install pygame pyserial

Before running: check which serial port your ESP32 is on and set SERIAL_PORT
below. On Linux it's usually /dev/ttyUSB0. Close the Arduino Serial Monitor
first — only one program can read the port at a time.
"""

import json
import sys

import pygame
import serial

SERIAL_PORT = "/dev/ttyUSB0"   # change if yours differs
BAUD_RATE = 115200

WIDTH, HEIGHT = 900, 600
BG_COLOR = (0, 0, 0)
CAR_COLOR = (220, 60, 60)

# Raw accel Y range we measured earlier (roughly -0.8 to 0.8 at full turn).
# Used to scale the raw sensor value into a steering strength of -1.0 to 1.0.
RAW_STEER_RANGE = 0.8


def open_serial():
    try:
        return serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=0.05)
    except serial.SerialException as e:
        print(f"Could not open {SERIAL_PORT}: {e}")
        print("Check the port name and make sure Arduino Serial Monitor is closed.")
        sys.exit(1)


def read_steering(ser, last_value):
    """
    Reads one line from the ESP32 if available and returns the steering
    value scaled to -1.0..1.0. Returns last_value unchanged if no new
    data arrived this frame (keeps the car steady between reads).
    """
    line = ser.readline().decode("utf-8", errors="ignore").strip()
    if not line:
        return last_value

    try:
        data = json.loads(line)
        raw = float(data.get("steering", 0.0))
        scaled = raw / RAW_STEER_RANGE
        return max(-1.0, min(1.0, scaled))
    except (json.JSONDecodeError, ValueError, TypeError):
        return last_value  # ignore a malformed/torn line, keep last good value


def main():
    ser = open_serial()

    pygame.init()
    screen = pygame.display.set_mode((WIDTH, HEIGHT))
    pygame.display.set_caption("Steering test")
    clock = pygame.time.Clock()
    font = pygame.font.SysFont(None, 28)

    car_x = WIDTH / 2
    car_y = HEIGHT - 100
    car_width, car_height = 40, 70
    move_speed = 400  # pixels per second at full steering

    steering = 0.0
    running = True

    while running:
        dt = clock.tick(60) / 1000.0

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            if event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
                running = False

        steering = read_steering(ser, steering)

        car_x += steering * move_speed * dt
        car_x = max(car_width / 2, min(WIDTH - car_width / 2, car_x))  # keep on screen

        screen.fill(BG_COLOR)

        car_rect = pygame.Rect(0, 0, car_width, car_height)
        car_rect.center = (car_x, car_y)
        pygame.draw.rect(screen, CAR_COLOR, car_rect, border_radius=6)

        hud = font.render(f"steering: {steering:+.2f}", True, (200, 200, 200))
        screen.blit(hud, (10, 10))

        pygame.display.flip()

    ser.close()
    pygame.quit()


if __name__ == "__main__":
    main()