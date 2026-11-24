# MYRA — Smart Infotainment System for the Hyundai Verna

*Intelligent Mobility. Naturally Connected.*

A standalone frontend prototype of the Verna's central infotainment display, extracted from the
Myra Smart Cockpit concept (Hyundai COE Mobility Innovation Ideathon). It is the software that runs
*inside* the screen — no cockpit, bezel or vehicle simulation.

## Run

```bash
npm install
npm run dev        # http://localhost:5173 (Vite picks the next free port if busy)
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build
```

Voice input needs a browser with the Web Speech API (Chrome or Edge). Everywhere else, type to Myra.

## What's in it

| Area | Highlights |
| --- | --- |
| Standby & wake | Original VERNA standby (clock, "Gaadi start karo"), Start button or voice wake, MYRA boot |
| Home | Time-based greeting, demo weather, phone status, navigation with mini map, media, climate, vehicle status, Myra suggestions based on current state |
| Navigation | Stylised Chennai map, local destination search, Home/Work, recent/saved, fuel & parking, ETA, route preference, avoid tolls, turn banner |
| Media | Bluetooth/USB/Radio/Podcasts, 5 playlists, queue, favourites, recently played, seek, shuffle/repeat, volume |
| Climate | Dual zone 16–30 °C, SYNC, AUTO, A/C, recirculation, airflow (face/feet/windshield), 7-step fan, front/rear defog, seat heat/vent |
| Phone | Bluetooth, demo device, Android Auto/CarPlay demo states, favourites, recents, contact search, incoming/active calls |
| Vehicle | Status & health, tyre pressure (TPMS warnings), driver assistance incl. Driver Monitor & Safe Exit, lighting/ambient/locks/convenience, maintenance |
| Apps | BharatConnect, fuel, parking, FASTag & tolls, weather, emergency (SOS preview), connected devices |
| Settings | Display (brightness, theme, auto day/night, screen fit), language & units, driver profiles, Myra voice + **Teach Voice** custom commands, accessibility, connectivity, audio, reset |

**Myra assistant** — mic in the dock (or press <kbd>Space</kbd>), listening/thinking/speaking states,
transcript, spoken replies, text fallback, confirmation flow ("Garmi lag rahi hai" → "AC 20° kar doon?" → "haan"),
multi-command utterances ("AC 21 pe kar do aur focus music chalao") and English / हिन्दी / Hinglish replies.
Intent understanding is local and rule-based (`src/services/intentParser.ts`) — no API keys.

**Parked / Driving** — prototype toggle in the status bar. Driving simplifies Home, limits Settings and Apps,
pauses text entry and safety-setting changes, and advances the demo route.

## Real vs simulated

**Works for real:** the whole UI and shared state, local intent parsing, browser speech recognition and synthesis
(where supported), driver profiles, Teach Voice, and settings saved to `localStorage`.

**Simulated:** vehicle data (fuel, tyres, ADAS, locks), map, routes, ETA and traffic, weather, media playback
(no audio), calls, phone projection, FASTag, emergency and all connected services. Simulated areas are tagged
**DEMO / SIMULATED** in the UI. MYRA does not talk to the vehicle ECU, CAN bus, cameras, GPS or any third-party service.

## Structure

```
src/
  components/  layout · navigation · assistant · cards · controls · map
  pages/       Home · Navigation · Media · Climate · Phone · Vehicle · Apps · Settings
  context/     AppStore (single shared state) · actions · AssistantContext
  hooks/       clock, route, simulation, speech recognition, suggestions, i18n
  services/    intent parser, assistant replies, routing, speech, storage, formatting, i18n
  data/        sample places, media, contacts, services, defaults
  types/       shared TypeScript types
  styles/      Tailwind v4 theme tokens and component classes
```
