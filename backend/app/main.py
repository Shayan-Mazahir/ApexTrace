from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
