"""Car log: what the on-device model (Gemma 3 1B in the MYRA car app) understood, for each spoken command.

The car app posts one entry per command; each entry is printed to stdout (visible in the Render log) and kept in
memory for GET /api/device/log. Nothing is executed server-side.
"""
from __future__ import annotations

import json
import time
from collections import deque

from fastapi import APIRouter
from pydantic import BaseModel, Field


class CarLogIn(BaseModel):
    transcript: str = Field(max_length=500)
    commands: list[dict] = Field(default_factory=list, max_length=8)
    model: str = Field(default="unknown", max_length=80)
    asr_engine: str | None = Field(default=None, max_length=80)
    latency_ms: int | None = Field(default=None, ge=0, le=600_000)
    reply: str | None = Field(default=None, max_length=500)


def device_router(keep: int = 200) -> APIRouter:
    r = APIRouter(prefix="/device")
    entries: deque[dict] = deque(maxlen=keep)

    @r.post("/log")
    def log(body: CarLogIn):
        entry = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **body.model_dump()}
        entries.append(entry)
        print(f"[CAR] heard {body.transcript!r} -> {json.dumps(body.commands, ensure_ascii=False)} "
              f"({body.model}, {body.latency_ms} ms)", flush=True)
        return {"ok": True}

    @r.get("/log")
    def recent():
        return list(reversed(entries))

    return r
