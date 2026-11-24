"""Writes the on-device Gemma spec for the car app (app/src/commands.json) from the backend's command allowlist.

Run after changing nlu/cockpit_commands.py:  python scripts/export_car_model_spec.py
"""
import json
from pathlib import Path

from bhashadrive.assistant.providers import capabilities
from bhashadrive.nlu.cockpit_commands import json_schema

out = Path(__file__).resolve().parents[2] / "app" / "src" / "commands.json"
out.write_text(json.dumps({"capabilities": capabilities(), "schema": json_schema()}, indent=1), encoding="utf-8")
print(f"wrote {out}")
