import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import placeholder_eval
from app.evaluation_routes import router as evaluation_router
from app.scenarios import router as scenarios_router
from app.schemas import HealthStatus
from app.sessions import router as sessions_router
from app.sessions import sweep_loop


@asynccontextmanager
async def lifespan(_: FastAPI):
    sweeper = asyncio.create_task(sweep_loop())
    # Warm the (deterministic, cached) evaluation so the first click is instant.
    warmup = asyncio.create_task(asyncio.to_thread(placeholder_eval.evaluate_all))
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
