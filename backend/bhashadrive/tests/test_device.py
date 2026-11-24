from fastapi import FastAPI
from fastapi.testclient import TestClient

from bhashadrive.device.api import device_router


def test_car_log_roundtrip_and_validation():
    app = FastAPI()
    app.include_router(device_router(keep=2), prefix="/api")
    c = TestClient(app)
    for t in ("ac 22 kar do", "gaana chalao", "volume badhao"):
        assert c.post("/api/device/log", json={"transcript": t, "commands": [{"type": "media.play"}],
                                               "model": "gemma-3-1b-it (on-device)", "latency_ms": 900}).json() == {"ok": True}
    log = c.get("/api/device/log").json()
    assert [e["transcript"] for e in log] == ["volume badhao", "gaana chalao"]  # newest first, bounded
    assert c.post("/api/device/log", json={"transcript": "x" * 501}).status_code == 422
