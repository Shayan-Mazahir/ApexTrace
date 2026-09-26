import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.scenarios import router as scenarios_router
from app.schemas import HealthStatus
from app.sessions import router as sessions_router
from app.sessions import sweep_loop


@asynccontextmanager
async def lifespan(_: FastAPI):
    sweeper = asyncio.create_task(sweep_loop())
    yield
    sweeper.cancel()


app = FastAPI(title="LimitLab API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions_router)
app.include_router(scenarios_router)


@app.get("/health", response_model=HealthStatus)
def health() -> HealthStatus:
    return HealthStatus(status="ok", service="limitlab-backend")
