"""Writes the on-device Gemma spec for the car app (app/src/commands.json) from the backend's command allowlist.

Run after changing nlu/cockpit_commands.py:  python scripts/export_car_model_spec.py
"""
import json
from pathlib import Path

from bhashadrive.nlu import cockpit_commands
from bhashadrive.assistant.providers import capabilities
from bhashadrive.nlu.cockpit_commands import json_schema

# Commands the MYRA UI can perform (non-null entries of COMMAND_MAP in web/src/services/backendIntents.ts).
# A short list keeps the 1B model accurate; anything else is answered by MYRA's built-in parser.
CAR_COMMANDS = ["climate.setTemp", "climate.adjustTemp", "climate.power", "climate.fan", "climate.auto",
                "climate.recirc", "climate.defrost", "media.play", "media.pause", "media.skip", "media.volume",
                "mood", "nav.start", "nav.stop", "phone.call", "phone.end", "doors.lock", "screen", "query",
                "greet", "help", "thanks"]
assert set(CAR_COMMANDS) <= set(cockpit_commands.COMMANDS), "unknown command in CAR_COMMANDS"
for name in list(cockpit_commands.COMMANDS):  # in place: providers.capabilities() holds the same dict
    if name not in CAR_COMMANDS:
        del cockpit_commands.COMMANDS[name]

out = Path(__file__).resolve().parents[2] / "app" / "src" / "commands.json"
out.write_text(json.dumps({"capabilities": capabilities(), "schema": json_schema()}, indent=1), encoding="utf-8")
print(f"wrote {out}")
