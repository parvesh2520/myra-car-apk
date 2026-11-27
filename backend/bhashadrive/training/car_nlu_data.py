"""Generated English training data for the car's MiniLM: intents plus word-level value tags.

The car receives Sarvam's English translation, so everything here is English. Templates were written to cover the
many ways drivers phrase each request (direct, polite, indirect, short, chatty); values (temperatures, levels,
colours, genres, places, shortcut names) are filled in and tagged word by word, BIO style, so the model learns to
pick values out of any phrasing instead of relying on the app's regular expressions.

A template is held out for testing when its id hashes into the test bucket, so the test score measures phrasings
the model never saw, not just new values in seen sentences.

    python -m bhashadrive.training.car_nlu_data --out data/car_nlu   # writes train.jsonl / test.jsonl
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import unicodedata
from pathlib import Path

SLOTS = ["TEMP", "LEVEL", "COLOR", "GENRE", "PLACE", "NAME"]
TAGS = ["O"] + [f"{p}-{s}" for s in SLOTS for p in ("B", "I")]

NUM_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
             "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "twenty one",
             "twenty two", "twenty three", "twenty four", "twenty five", "twenty six", "twenty seven", "twenty eight",
             "twenty nine", "thirty"]


def number(n: int, rng: random.Random) -> str:
    return str(n) if rng.random() < .65 else NUM_WORDS[n]


COLORS = ["blue", "pink", "purple", "red", "green", "amber", "white", "cyan", "orange", "yellow", "violet", "teal",
          "turquoise"]
GENRES = ["calm", "energetic", "focus", "chill", "relaxing", "peaceful", "soothing", "upbeat", "high energy",
          "instrumental", "study", "concentration", "lo fi", "lofi", "laid back", "quiet roads", "night drive",
          "clear sky", "city glow"]
PLACES = [
    "phoenix mall", "the airport", "bandra", "juhu beach", "connaught place", "india gate", "mg road", "koramangala",
    "the nearest petrol pump", "home", "the office", "office", "starbucks", "apollo hospital", "marine drive",
    "gateway of india", "the railway station", "andheri station", "powai lake", "cyber city", "hauz khas",
    "the nearest hospital", "a charging station", "the nearest ev charger", "dlf mall", "select citywalk",
    "lodhi garden", "the metro station", "terminal 2", "infosys campus", "whitefield", "electronic city",
    "indiranagar", "hitech city", "charminar", "golconda fort", "banjara hills", "salt lake", "park street",
    "howrah bridge", "victoria memorial", "t nagar", "marina beach", "anna nagar", "the bus stand", "pune station",
    "koregaon park", "hinjewadi", "viman nagar", "sector 29", "golf course road", "noida sector 18", "my gym",
    "the school", "my parents house", "the nearest atm", "a good restaurant", "the closest cafe", "lulu mall",
    "forum mall", "orion mall", "inorbit mall", "worli sea face", "colaba", "lower parel", "bkc", "vashi",
    "thane", "lonavala", "the hotel", "taj hotel", "my friend's place", "the stadium", "wankhede stadium",
    "chinnaswamy stadium", "the zoo", "the museum", "city hospital", "max hospital", "fortis hospital",
    "the court", "the bank", "hdfc bank", "the pharmacy", "the nearest medical store", "decathlon", "ikea",
    "the parking lot", "the service center", "the hyundai service center", "mumbai", "pune", "delhi",
    "bangalore", "chennai", "hyderabad", "goa", "jaipur", "agra", "the taj mahal", "red fort", "lotus temple",
    "cubbon park", "ub city", "brigade road", "jayanagar", "hsr layout", "btm layout", "manyata tech park",
    "rajiv chowk", "saket", "dwarka", "gurgaon", "noida", "faridabad", "chandigarh", "sukhna lake",
]
NAMES = ["chill mode", "movie night", "party time", "i am very tired", "road trip", "focus mode", "date night",
         "morning drive", "evening drive", "sleepy mode", "beach vibes", "rainy day", "office commute", "gym mode",
         "night mode", "relax mode", "work mode", "family trip", "sunday drive", "highway mode", "cool down",
         "warm up", "late night", "i am stressed", "long drive", "romantic mode", "kids mode", "quiet time",
         "power mode", "happy hour", "monsoon mode", "winter mode", "summer mode", "lazy sunday", "go time"]

PRE = ["", "", "", "", "please ", "can you ", "could you ", "could you please ", "would you ", "will you ",
       "i want you to ", "i'd like you to ", "go ahead and ", "hey myra ", "myra ", "okay ", "ok myra ", "just ",
       "quickly ", "kindly ", "hey ", "listen ", "can you please ", "i need you to ", "myra please "]
POST = ["", "", "", "", " please", " now", " for me", " right now", " thanks", " quickly", " please myra",
        " a bit", " if you can", " thank you"]

# Each intent: templates. {TEMP}, {LEVEL}, {VOL}, {COLOR}, {GENRE}, {PLACE}, {NAME}, {ACTION} are filled in.
# A leading "!" means the template is already a whole sentence: no polite prefix/suffix is added.
T: dict[str, list[str]] = {
    "climate_temperature_up": [
        "make it warmer", "increase the temperature", "turn up the heat", "raise the temperature", "warm it up",
        "warm up the cabin", "bump up the temperature", "temperature up", "make the car warmer", "heat it up",
        "turn the temperature up", "a bit warmer", "warmer", "turn up the heater", "increase the heating",
        "make the cabin warmer", "raise the temp", "it's too cold make it warmer", "i'm cold warm it up",
        "increase the ac temperature", "push the temperature up", "go up a degree", "add a degree", "up the temp",
        "a little warmer", "make it less cold", "reduce the cooling", "less cold please", "crank up the heat",
        "can it be warmer in here", "turn the heat up a little", "make the air warmer", "warmer air",
        "increase the cabin temperature by a degree", "make it a lot warmer", "set it warmer",
    ],
    "climate_temperature_down": [
        "make it cooler", "decrease the temperature", "turn down the heat", "lower the temperature", "cool it down",
        "cool down the cabin", "bring the temperature down", "temperature down", "make the car cooler", "cool off",
        "turn the temperature down", "a bit cooler", "cooler", "turn down the heater", "more cooling",
        "make the cabin cooler", "lower the temp", "it's too hot make it cooler", "i'm hot cool it down",
        "reduce the temperature", "drop the temperature", "go down a degree", "a little cooler", "make it colder",
        "colder please", "make it less hot", "increase the cooling", "crank up the ac", "chill the cabin",
        "can it be cooler in here", "make the air colder", "colder air", "cool the car down a lot",
        "reduce the cabin temperature by two degrees", "make it a lot cooler", "set it cooler",
    ],
    "climate_temperature_set": [
        "set the temperature to {TEMP}", "set the temperature to {TEMP} degrees", "make it {TEMP} degrees",
        "{TEMP} degrees", "change the temperature to {TEMP}", "set the ac to {TEMP}", "set ac to {TEMP} degrees",
        "put the temperature at {TEMP}", "keep it at {TEMP} degrees", "i want {TEMP} degrees",
        "cool it to {TEMP}", "warm it to {TEMP}", "temperature {TEMP}", "temperature to {TEMP} degrees celsius",
        "set the cabin to {TEMP} degrees", "adjust the temperature to {TEMP}", "make the temperature {TEMP}",
        "bring the temperature to {TEMP}", "can we have {TEMP} degrees", "{TEMP} degrees celsius",
        "set climate to {TEMP}", "ac {TEMP}", "switch the ac to {TEMP} degrees", "turn the ac to {TEMP}",
        "set the thermostat to {TEMP}", "i'd like it at {TEMP} degrees", "put the ac on {TEMP}",
        "change ac temperature to {TEMP} degrees", "lower the temperature to {TEMP}", "raise the temperature to {TEMP}",
        "turn it down to {TEMP}", "bring it up to {TEMP} degrees", "crank the ac down to {TEMP}", "drop it to {TEMP}",
        "warm the car up to {TEMP} degrees", "cool the cabin down to {TEMP}",
    ],
    "climate_fan_speed_up": [
        "increase the fan speed", "turn up the fan", "fan up", "more air", "faster fan", "speed up the fan",
        "raise the fan", "make the fan stronger", "increase the blower", "more airflow", "blow harder",
        "turn the fan up a notch", "fan higher", "increase airflow", "boost the fan", "the fan is too weak",
        "put the fan higher", "more fan", "crank up the fan", "stronger airflow",
    ],
    "climate_fan_speed_down": [
        "decrease the fan speed", "turn down the fan", "fan down", "less air", "slower fan", "slow down the fan",
        "lower the fan", "make the fan weaker", "reduce the blower", "less airflow", "the fan is too strong",
        "turn the fan down a notch", "fan lower", "reduce airflow", "quieter fan", "put the fan lower", "less fan",
        "the fan is too loud", "softer airflow", "too much air",
    ],
    "climate_fan_speed_set": [
        "set the fan to {LEVEL}", "set fan speed to {LEVEL}", "fan speed {LEVEL}", "put the fan on level {LEVEL}",
        "fan level {LEVEL}", "change the fan to {LEVEL}", "set the blower to level {LEVEL}", "fan to {LEVEL}",
        "make the fan speed {LEVEL}", "i want fan speed {LEVEL}", "keep the fan at {LEVEL}", "fan on {LEVEL}",
        "switch the fan to speed {LEVEL}", "adjust the fan to level {LEVEL}", "knock the fan down to {LEVEL}",
        "turn the fan down to {LEVEL}", "bring the fan up to {LEVEL}", "turn the fan up to level {LEVEL}",
        "drop the fan to {LEVEL}", "raise the fan to {LEVEL}",
    ],
    "climate_on": [
        "turn on the ac", "switch on the ac", "ac on", "start the ac", "turn the air conditioning on",
        "switch on the climate control", "turn on the cooling", "start the air conditioner", "put the ac on",
        "i need the ac", "enable the ac", "activate the air conditioning", "turn the climate on", "ac chalu",
    ],
    "climate_off": [
        "turn off the ac", "switch off the ac", "ac off", "stop the ac", "turn the air conditioning off",
        "switch off the climate control", "shut off the ac", "kill the ac", "disable the ac", "no more ac",
        "deactivate the air conditioning", "turn the climate off", "shut down the air conditioner",
    ],
    "volume_up": [
        "turn up the volume", "volume up", "louder", "make it louder", "increase the volume", "raise the volume",
        "pump up the volume", "i can't hear it", "turn the music up", "boost the volume", "crank it up",
        "a little louder", "much louder", "turn it up", "increase the sound", "the music is too quiet",
        "make the music louder", "more volume", "up the volume", "sound up",
    ],
    "volume_down": [
        "turn down the volume", "volume down", "quieter", "make it quieter", "decrease the volume",
        "lower the volume", "reduce the volume", "it's too loud", "turn the music down", "softer",
        "a little quieter", "much quieter", "turn it down", "reduce the sound", "the music is too loud",
        "make the music softer", "less volume", "bring the volume down", "sound down", "keep it low",
    ],
    "volume_set": [
        "set the volume to {VOL}", "volume {VOL}", "volume to {VOL}", "put the volume at {VOL}",
        "change the volume to {VOL}", "make the volume {VOL}", "set volume level {VOL}", "keep the volume at {VOL}",
        "volume level {VOL}", "adjust the volume to {VOL}", "turn the volume down to {VOL}", "turn it up to {VOL}",
        "bring the volume up to {VOL}", "drop the volume to {VOL}",
    ],
    "volume_mute": [
        "mute", "mute the music", "mute the audio", "mute the sound", "silence", "silence the speakers",
        "shut the music up", "shut it up", "shut up the speakers", "make it silent", "zero sound", "quiet the speakers completely",
        "turn the sound off", "no sound", "mute everything", "kill the sound", "mute the volume", "go silent",
    ],
    "media_play": [
        "play music", "play some music", "play a song", "start the music", "resume the music", "resume",
        "play something", "put on some music", "play my music", "i want to listen to music", "music please",
        "start playing", "continue the music", "unpause", "play", "let's have some music", "turn on the music",
        "play some {GENRE} music", "play {GENRE} music", "put on some {GENRE} songs", "play {GENRE}",
        "play something {GENRE}", "i want to hear something {GENRE}", "play {GENRE} songs", "put on {GENRE}",
        "play me some {GENRE} tracks", "can we listen to {GENRE} music", "start some {GENRE} music",
        "i'm in the mood for {GENRE} music", "play a {GENRE} playlist", "some {GENRE} tunes",
    ],
    "media_pause": [
        "pause the music", "pause", "stop the music", "stop playing", "pause the song", "hold the music",
        "stop the song", "pause playback", "turn off the music", "music off", "stop the audio", "pause it",
        "hold on pause the music", "enough music", "silence the music for now",
    ],
    "media_next": [
        "next song", "skip this song", "next track", "skip", "play the next song", "change the song",
        "skip this track", "next one", "i don't like this song", "another song", "move to the next song",
        "skip ahead", "play something else", "go to the next track", "next",
    ],
    "media_previous": [
        "previous song", "go back a song", "previous track", "play the last song again", "back one song",
        "play the previous song", "go to the previous track", "last song", "replay the previous track",
        "go back", "the song before this", "play that last one again",
    ],
    "navigation_destination_request": [
        "take me to {PLACE}", "navigate to {PLACE}", "directions to {PLACE}", "how do i get to {PLACE}",
        "let's go to {PLACE}", "drive to {PLACE}", "find a route to {PLACE}", "i need to go to {PLACE}",
        "head to {PLACE}", "start navigation to {PLACE}", "route to {PLACE}", "show me the way to {PLACE}",
        "guide me to {PLACE}", "i want to go to {PLACE}", "get me to {PLACE}", "set the destination to {PLACE}",
        "navigate me to {PLACE}", "find {PLACE}", "how far is {PLACE}", "plot a route to {PLACE}",
        "can we go to {PLACE}", "take us to {PLACE}", "drop me at {PLACE}", "go to {PLACE}",
    ],
    "navigation_stop": [
        "stop navigation", "cancel the route", "end navigation", "stop the directions", "cancel navigation",
        "exit navigation", "clear the destination", "i don't need directions anymore", "stop guiding me",
        "turn off navigation", "end the route", "remove the destination", "stop the route guidance",
    ],
    "ambient_light_set": [
        "change the ambient light to {COLOR}", "make the ambient light {COLOR}", "set the ambient lighting to {COLOR}",
        "set mood lighting to {COLOR}", "i want {COLOR} ambient lighting", "turn the interior lights {COLOR}",
        "cabin lights {COLOR}", "make the lights {COLOR}", "change the light color to {COLOR}",
        "switch the ambient light to {COLOR}", "{COLOR} ambient light", "set the cabin light to {COLOR}",
        "make the interior {COLOR}", "change the mood light to {COLOR}", "turn the ambient lights {COLOR}",
        "can the lights be {COLOR}", "color the cabin {COLOR}", "make the ambient lighting {COLOR}",
    ],
    "seat_up": [
        "raise my seat", "seat up", "move the seat up", "lift the seat", "raise the driver seat",
        "make the seat higher", "put my seat higher", "increase the seat height", "seat higher", "my seat is too low",
    ],
    "seat_down": [
        "lower my seat", "seat down", "move the seat down", "drop the seat", "lower the driver seat",
        "make the seat lower", "put my seat lower", "decrease the seat height", "seat lower", "my seat is too high",
    ],
    "seat_height_set": [
        "set the seat height to {SEAT}", "seat height {SEAT}", "set my seat to level {SEAT}", "seat level {SEAT}",
        "put the seat at {SEAT}", "change the seat height to {SEAT}", "move the seat to level {SEAT}",
        "adjust my seat to {SEAT}", "seat to {SEAT}",
    ],
    "shortcut_define": [
        "!whenever i say {NAME} {ACTION}", "!whenever i say {NAME} then {ACTION}", "!when i say {NAME} {ACTION}",
        "!every time i say {NAME} {ACTION}", "!if i say {NAME} {ACTION}", "!create a shortcut called {NAME} that will {ACTION}",
        "!make a shortcut named {NAME} to {ACTION}", "!save a shortcut {NAME} that {ACTION}",
        "!remember that {NAME} means {ACTION}", "!from now on when i say {NAME} {ACTION}",
        "!add a shortcut called {NAME} which does {ACTION}", "!when i tell you {NAME} i want you to {ACTION}",
        "!teach yourself {NAME} as {ACTION}", "!new shortcut {NAME} {ACTION}", "!set up {NAME} to {ACTION}",
        "!make {NAME} a shortcut for {ACTION}", "!whenever i tell you {NAME} please {ACTION}",
        "!create shortcut {NAME} to {ACTION}", "!when i say the words {NAME} you should {ACTION}",
    ],
    "shortcut_delete": [
        "!delete the {NAME} shortcut", "!remove the {NAME} shortcut", "!delete shortcut {NAME}", "!forget {NAME}",
        "!get rid of the {NAME} shortcut", "!remove shortcut {NAME}", "!i don't need the {NAME} shortcut anymore",
        "!erase the shortcut called {NAME}", "!forget the {NAME} shortcut", "!please delete {NAME} shortcut",
        "!can you remove the shortcut {NAME}", "!delete the shortcut named {NAME}",
    ],
    "unsupported": [
        "open the window", "roll down the window", "call mom", "what's the weather", "lock the doors",
        "turn on the hazard lights", "open the sunroof", "how far is the moon", "send a message to rahul",
        "turn on the headlights", "start the wipers", "what is the tire pressure", "honk the horn",
        "turn on the seat massage", "check the engine", "what time is it", "tell me a joke", "who won the match",
        "book a cab", "order food", "open the boot", "fold the mirrors", "turn on cruise control",
        "switch to sport mode", "turn on the seat heater", "read my messages", "set an alarm", "what's my fuel level",
        "turn on the defroster", "close the windows", "unlock the car", "turn on the fog lights",
        "my phone is dying", "the meeting went well", "i had a long day at work", "how's the traffic",
        "take a photo", "play a video", "open youtube", "start the engine", "park the car", "reverse the car",
    ],
    "ambiguous": [
        "change it", "do the thing", "make it better", "adjust that", "set it", "turn it", "the other one",
        "fix this", "do something about it", "increase it", "lower it", "switch it", "the fan", "the ac",
        "volume", "temperature", "change something", "make it different", "that one", "more", "less",
        "the music", "the light", "the seat", "can you help with this", "hmm",
    ],
    "dialog_confirm": ["yes", "yeah", "yes please", "sure", "go ahead", "do it", "okay do that", "correct",
                       "that's right", "yep", "sounds good", "absolutely", "please do"],
    "dialog_cancel": ["no", "cancel", "never mind", "no thanks", "leave it", "forget it", "don't", "stop",
                      "nope", "not now", "cancel that", "leave it as it is"],
}

# Plain action phrases for the body of a shortcut definition (tagged O: the app classifies each one separately).
ACTIONS = ["set the ac to 20", "play some calm music", "turn down the volume", "play the next song",
           "make it cooler", "turn on the ac", "change the ambient light to pink", "lower my seat",
           "set the fan to 2", "play energetic music", "turn up the volume", "pause the music",
           "take me home", "set the temperature to 24", "make the lights blue", "raise the fan speed"]

NEGATABLE = ["climate_temperature_up", "climate_temperature_down", "climate_on", "climate_off", "volume_up",
             "volume_down", "media_play", "media_pause", "media_next", "climate_fan_speed_up",
             "climate_fan_speed_down", "seat_up", "seat_down", "volume_mute"]
NEG_PRE = ["don't ", "do not ", "please don't ", "never ", "no need to ", "you don't have to "]

PUNCT = re.compile(r"[!-/:-@\[-`{-~]")


def words(text: str) -> list[str]:
    """BERT basic tokenization (WordPiece.basicTokens in the app): lowercase, strip accents, split punctuation."""
    out = []
    for raw in text.split():
        w = "".join(c for c in unicodedata.normalize("NFD", raw.lower()) if unicodedata.category(c) != "Mn")
        cur = ""
        for ch in w:
            if PUNCT.match(ch) or unicodedata.category(ch).startswith("P"):
                if cur:
                    out.append(cur)
                    cur = ""
                out.append(ch)
            else:
                cur += ch
        if cur:
            out.append(cur)
    return out


def fill(template: str, rng: random.Random) -> list[tuple[str, str | None]]:
    """Template -> segments of (text, slot or None)."""
    values = {
        "TEMP": ("TEMP", lambda: number(rng.randint(16, 30), rng)),
        "LEVEL": ("LEVEL", lambda: number(rng.randint(0, 7), rng)),
        "VOL": ("LEVEL", lambda: number(rng.randint(0, 30), rng)),
        "SEAT": ("LEVEL", lambda: number(rng.randint(1, 5), rng)),
        "COLOR": ("COLOR", lambda: rng.choice(COLORS)),
        "GENRE": ("GENRE", lambda: rng.choice(GENRES)),
        "PLACE": ("PLACE", lambda: rng.choice(PLACES)),
        "NAME": ("NAME", lambda: rng.choice(NAMES)),
        "ACTION": (None, lambda: " and ".join(rng.sample(ACTIONS, rng.choice((1, 1, 2))))),
    }
    segments = []
    for part in re.split(r"(\{[A-Z]+\})", template):
        if not part:
            continue
        if part.startswith("{"):
            slot, make = values[part[1:-1]]
            segments.append((make(), slot))
        else:
            segments.append((part, None))
    return segments


def styled(segments: list[tuple[str, str | None]], rng: random.Random) -> tuple[str, list[str]]:
    """Sarvam-like English: sometimes capitalized, sometimes ending in '.' or '?'. Returns (text, word tags)."""
    text, tags = "", []
    for seg, slot in segments:
        ws = words(seg)
        text += seg
        tags += ["O"] * len(ws) if slot is None else [("B-" if i == 0 else "I-") + slot for i in range(len(ws))]
    text = re.sub(r"\s+", " ", text).strip()
    if rng.random() < .5:
        text = text[0].upper() + text[1:]
    end = rng.random()
    if end < .35:
        text += "."
        tags.append("O")
    elif end < .42:
        text += "?"
        tags.append("O")
    assert len(words(text)) == len(tags), (text, tags)
    return text, tags


def template_split(intent: str, template: str) -> str:
    h = int(hashlib.md5(f"{intent}|{template}".encode()).hexdigest(), 16) % 100
    return "test" if h < 15 else "train"


def generate(per_template: int = 24, seed: int = 11) -> dict[str, list[dict]]:
    rng = random.Random(seed)
    out: dict[str, list[dict]] = {"train": [], "test": []}
    seen: set[str] = set()
    for intent, templates in T.items():
        for template in templates:
            split = template_split(intent, template)
            whole = template.startswith("!")
            body = template.lstrip("!")
            for _ in range(per_template):
                segs = fill(body, rng)
                if not whole:
                    segs = [(rng.choice(PRE), None)] + segs + [(rng.choice(POST), None)]
                text, tags = styled(segs, rng)
                if text.lower() in seen:
                    continue
                seen.add(text.lower())
                out[split].append({"text": text, "intent": intent, "negated": 0, "tags": tags})
                if intent in NEGATABLE and not whole and rng.random() < .12:
                    neg, ntags = styled([(rng.choice(NEG_PRE), None)] + fill(body, rng), rng)
                    if neg.lower() not in seen:
                        seen.add(neg.lower())
                        out[split].append({"text": neg, "intent": intent, "negated": 1, "tags": ntags})
    for rows in out.values():
        rng.shuffle(rows)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)
    data = generate()
    for split, rows in data.items():
        (args.out / f"{split}.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
        print(split, len(rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
