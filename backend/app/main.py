from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.ai import router as ai_router
from app.api.live import router as live_router
from app.api.simulation import router as simulation_router
from app.schemas import HealthStatus

app = FastAPI(title="LimitLab API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthStatus)
def health() -> HealthStatus:
    return HealthStatus(status="ok", service="limitlab-backend")


app.include_router(simulation_router)
app.include_router(live_router)
app.include_router(ai_router)
