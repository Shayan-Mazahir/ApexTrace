"""
Serial -> WebSocket bridge for the ESP32 wheel.

The frontend's HardwareAdapter expects to connect over WebSocket (browsers
can't read a serial port directly), but the ESP32 only speaks serial. This
bridge sits in the middle: reads JSON lines from the ESP32 over serial and
re-broadcasts them verbatim to any connected WebSocket client.

Message shape forwarded unchanged (must match
frontend/src/input/adapters/HardwareAdapter.ts):
    { source, sequence, timestamp, steeringRaw, throttleRaw, brakeRaw }

Setup:
    pip install pyserial websockets

Run:
    python bridge.py                  # auto-detects the ESP32's serial port
    python bridge.py --list           # show candidate ports and exit
    python bridge.py --port /dev/ttyACM0
    python bridge.py --quiet          # no live readout

While it runs it prints a live one-line readout of the values it is
forwarding, so you can confirm the hardware works on its own:

    steer +0.412  throttle 0.00  brake 0.31   50.1 Hz  seq 1284  1 client

Turn the wheel and watch `steer` move (left negative, right positive); press
the joystick down and RESET appears. If those move correctly, the hardware
side is done — anything still broken after that is in the frontend, not here.

The frontend defaults to ws://<page host>:8765, so if you serve the page from
this same machine there is nothing to configure.
"""

import argparse
import asyncio
import glob
import json
import sys
import time

import serial
import websockets

# Imported by name on purpose: `websockets` lazy-loads its public API, so
# `websockets.exceptions` is not a usable attribute until something else has
# already pulled that submodule in.
from websockets.exceptions import ConnectionClosed

BAUD_RATE = 115200
WS_HOST = "0.0.0.0"  # bind on all interfaces so another device on the same
#                      WiFi (e.g. the engineer's laptop, or the driver
#                      station itself) can reach this bridge too
WS_PORT = 8765

REQUIRED_KEYS = {"source", "sequence", "timestamp", "steeringRaw", "throttleRaw", "brakeRaw"}

# USB-serial chips these boards ship with show up under one of these.
PORT_GLOBS = ("/dev/ttyUSB*", "/dev/ttyACM*", "/dev/cu.usbserial*", "/dev/cu.SLAB_USBtoUART*")

connected_clients = set()


def candidate_ports():
    return sorted(p for pattern in PORT_GLOBS for p in glob.glob(pattern))


def open_serial(port):
    if port is None:
        found = candidate_ports()
        if not found:
            print("No serial port found. Is the ESP32 plugged in?")
            print(f"Looked for: {', '.join(PORT_GLOBS)}")
            print("If it is connected, try 'python bridge.py --list' or pass --port explicitly.")
            sys.exit(1)
        port = found[0]
        if len(found) > 1:
            print(f"Multiple ports found ({', '.join(found)}); using {port}. Use --port to choose.")
    try:
        return serial.Serial(port, BAUD_RATE, timeout=0.05), port
    except serial.SerialException as e:
        print(f"Could not open {port}: {e}")
        print("Check the port name and make sure nothing else (e.g. Arduino Serial Monitor) has it open.")
        print("On Linux you also need to be in the 'dialout' group:")
        print("    sudo usermod -aG dialout $USER     (then log out and back in)")
        sys.exit(1)


class Readout:
    """One self-overwriting status line, so you can watch live values."""

    def __init__(self, enabled=True):
        self.enabled = enabled and sys.stdout.isatty()
        self.messages = 0
        self.window_started = time.monotonic()
        self.window_count = 0
        self.hz = 0.0
        self.last_drawn = 0.0

    def update(self, data):
        self.messages += 1
        self.window_count += 1
        now = time.monotonic()
        elapsed = now - self.window_started
        # Show a rate as soon as there is a quarter second to divide by, so the
        # first second does not read a misleading 0.0 Hz; roll the window at 1 s.
        if elapsed >= 0.25:
            self.hz = self.window_count / elapsed
            if elapsed >= 1.0:
                self.window_started, self.window_count = now, 0
        if not self.enabled or now - self.last_drawn < 0.1:
            return
        self.last_drawn = now
        clients = len(connected_clients)
        # resetPressed is optional: firmware predating the button omits it.
        reset = " RESET" if data.get("resetPressed") else "      "
        sys.stdout.write(
            f"\rsteer {data['steeringRaw']:+.3f}  throttle {data['throttleRaw']:.2f}  "
            f"brake {data['brakeRaw']:.2f}{reset}   {self.hz:5.1f} Hz  seq {data['sequence']}  "
            f"{clients} client{'' if clients == 1 else 's'}   "
        )
        sys.stdout.flush()

    def note(self, text):
        """Print a normal line without leaving the status line behind."""
        if self.enabled:
            sys.stdout.write("\r\033[K")
        print(text, flush=True)


# Replaced in main() once the flags are parsed; the connection handler needs to
# print through it from the moment the server starts accepting clients.
readout = Readout(enabled=False)


async def broadcast(message: str):
    if not connected_clients:
        return
    stale = set()
    for ws in connected_clients:
        try:
            await ws.send(message)
        except ConnectionClosed:
            stale.add(ws)
    connected_clients.difference_update(stale)


async def serial_reader_loop(ser):
    """
    Continuously reads lines from the ESP32 and broadcasts valid JSON
    messages matching the expected shape. Malformed or torn lines are
    dropped silently rather than crashing the bridge.
    """
    loop = asyncio.get_event_loop()
    waiting_logged = False

    while True:
        line = await loop.run_in_executor(
            None, lambda: ser.readline().decode("utf-8", errors="ignore").strip()
        )
        if not line:
            if readout.messages == 0 and not waiting_logged:
                waiting_logged = True
                readout.note("Port open, but no data yet — is the right sketch flashed?")
            await asyncio.sleep(0.005)
            continue

        try:
            data = json.loads(line)
            if not REQUIRED_KEYS.issubset(data.keys()):
                if readout.messages == 0:
                    missing = ", ".join(sorted(REQUIRED_KEYS - set(data.keys())))
                    readout.note(f"Ignoring line missing required keys ({missing}): {line[:80]}")
                continue  # malformed/incomplete line, skip it
        except json.JSONDecodeError:
            continue  # torn line from serial buffer boundary, skip it

        if readout.messages == 0:
            readout.note("Receiving valid samples from the ESP32.")
        readout.update(data)
        await broadcast(line)


async def handle_client(websocket):
    connected_clients.add(websocket)
    readout.note(f"Client connected ({len(connected_clients)} total)")
    try:
        async for _ in websocket:
            pass  # this bridge is send-only to the frontend, ignore any client messages
    except ConnectionClosed:
        # A browser tab that reloads or hot-reloads usually drops the socket
        # without a closing handshake. That is an ordinary disconnect here, not
        # an error: unhandled, it makes websockets log the whole traceback.
        pass
    finally:
        connected_clients.discard(websocket)
        readout.note(f"Client disconnected ({len(connected_clients)} total)")


async def main(args):
    global readout

    ser, port = open_serial(args.port)
    print(f"Reading ESP32 on {port} @ {BAUD_RATE} baud")

    readout = Readout(enabled=not args.quiet)
    await websockets.serve(handle_client, WS_HOST, WS_PORT)
    print(f"WebSocket bridge running on ws://{WS_HOST}:{WS_PORT}")
    print("The frontend looks here by default; no configuration needed on the same machine.")
    print("Turn the wheel — the line below should move. Ctrl+C to stop.\n")

    await serial_reader_loop(ser)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Serial -> WebSocket bridge for the ESP32 wheel.")
    parser.add_argument("--port", help="serial port (default: first auto-detected)")
    parser.add_argument("--list", action="store_true", help="list candidate serial ports and exit")
    parser.add_argument("--quiet", action="store_true", help="do not print the live value readout")
    parsed = parser.parse_args()

    if parsed.list:
        found = candidate_ports()
        print("\n".join(found) if found else "No candidate serial ports found.")
        sys.exit(0)

    try:
        asyncio.run(main(parsed))
    except KeyboardInterrupt:
        print("\nShutting down.")
