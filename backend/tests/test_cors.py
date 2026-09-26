import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:5173",
        "http://localhost:4173",
        "http://127.0.0.1:5173",
        "http://192.168.1.42:5173",
        "http://10.0.0.7:5173",
        "http://172.20.3.4:5173",
    ],
)
def test_local_and_lan_origins_are_allowed(origin):
    response = client.get("/health", headers={"Origin": origin})
    assert response.headers.get("access-control-allow-origin") == origin


@pytest.mark.parametrize("origin", ["https://evil.example", "http://8.8.8.8:5173", "http://192.169.1.1:5173"])
def test_other_origins_are_not_allowed(origin):
    response = client.get("/health", headers={"Origin": origin})
    assert "access-control-allow-origin" not in response.headers
