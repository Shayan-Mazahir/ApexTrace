import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.live import router as live_router
from app.api.simulation import router as simulation_router
from app.evaluation_routes import router as evaluation_router
from app.scenarios import router as scenarios_router
from app.schemas import HealthStatus
from app.sessions import router as sessions_router
from app.sessions import sweep_loop
from app.stress import evaluation

# Lap-simulator AI routes need the optional ML stack (requirements-ml.txt).
# Without it the rest of the API still runs, like the TCN risk observer.
try:
    from app.api.ai import router as ai_router
except ImportError:  # torch / optuna not installed
    ai_router = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    sweeper = asyncio.create_task(sweep_loop())
    # Warm the (deterministic, cached) evaluation so the first click is instant.
    warmup = asyncio.create_task(asyncio.to_thread(evaluation.evaluate_all, "heldout"))
    yield
    sweeper.cancel()
    warmup.cancel()


app = FastAPI(title="LimitLab API", lifespan=lifespan)

# Local demo only: the page may be served from localhost or from the driver
# laptop's LAN address (engineer station on a second device).
LOCAL_ORIGIN_REGEX = (
    r"http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+"
    r"|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?"
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=LOCAL_ORIGIN_REGEX,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions_router)
app.include_router(scenarios_router)
app.include_router(evaluation_router)


@app.get("/health", response_model=HealthStatus)
def health() -> HealthStatus:
    return HealthStatus(status="ok", service="limitlab-backend")


# Lap simulator (deterministic scenario runs, replays, configuration comparison, AI search).
app.include_router(simulation_router)
app.include_router(live_router)
if ai_router is not None:
    app.include_router(ai_router)
