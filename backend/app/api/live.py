"""Live simulation over WebSocket.

Protocol:
  client -> LiveStart
  server -> LiveTrackMessage, then LiveStateMessage at ``rate_hz`` (paced to
            real time x ``speedup``), then LiveResultMessage and close.
  client -> LiveControl at any time in manual mode; the latest one is held.

The simulator owns every value in the stream; the frontend only renders it.
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.schemas import (
    LiveControl,
    LiveErrorMessage,
    LiveResultMessage,
    LiveStart,
    LiveStateMessage,
    LiveTrackMessage,
)
from app.sim import constants as C
from app.sim.replay import track_geometry
from app.sim.simulator import Simulator
from app.sim.vehicle import ControlInput

router = APIRouter()


@router.websocket("/ws/simulation")
async def live_simulation(ws: WebSocket) -> None:
    await ws.accept()
    try:
        start = LiveStart.model_validate_json(await ws.receive_text())
    except (ValidationError, ValueError) as e:
        await ws.send_text(LiveErrorMessage(detail=str(e)).model_dump_json())
        await ws.close(code=1003)
        return

    sim = Simulator(start.scenario, start.configuration, record=True)
    await ws.send_text(LiveTrackMessage(track=track_geometry(sim.track)).model_dump_json())

    control: list[ControlInput] = [ControlInput()]
    manual = start.mode == "manual"

    async def read_controls() -> None:
        while True:
            msg = json.loads(await ws.receive_text())
            if msg.get("type") == "control":
                c = LiveControl.model_validate(msg)
                control[0] = ControlInput(c.steering, c.throttle, c.brake)

    reader = asyncio.create_task(read_controls())
    ticks_per_msg = max(1, int(round(1.0 / (start.rate_hz * C.DT))))
    wall_per_msg = ticks_per_msg * C.DT / start.speedup
    loop = asyncio.get_running_loop()
    next_send = loop.time()
    try:
        while not sim.done:
            state = None
            for _ in range(ticks_per_msg):
                if sim.done:
                    break
                state = sim.step(control[0] if manual else None)
            if state is not None:
                await ws.send_text(LiveStateMessage(state=state).model_dump_json())
            next_send += wall_per_msg
            await asyncio.sleep(max(0.0, next_send - loop.time()))
            if reader.done() and reader.exception() is not None:
                raise reader.exception()
        await ws.send_text(LiveResultMessage(result=sim.result()).model_dump_json())
        await ws.close()
    except WebSocketDisconnect:
        pass
    finally:
        reader.cancel()
