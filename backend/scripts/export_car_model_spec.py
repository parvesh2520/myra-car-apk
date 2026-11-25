"""Writes the command schema the car app validates its on-device model's answers against (app/src/commands.json),
from the backend's command allowlist (bhashadrive/nlu/cockpit_commands.py).

Run after changing cockpit_commands.py:  python scripts/export_car_model_spec.py
"""
import json
from pathlib import Path

from bhashadrive.nlu.cockpit_commands import json_schema

out = Path(__file__).resolve().parents[2] / "app" / "src" / "commands.json"
out.write_text(json.dumps({"schema": json_schema()}, indent=1), encoding="utf-8")
print(f"wrote {out}")
