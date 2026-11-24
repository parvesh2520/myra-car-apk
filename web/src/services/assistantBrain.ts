import type { AppState, PageId, VoiceLanguage } from '../types';
import type { Actions } from '../context/actions';
import { activeProfile, FAN_MAX, TEMP_MAX, TEMP_MIN, VOLUME_MAX } from '../context/actions';
import type { Intent } from './intentParser';
import { playlistById, RADIO_STATIONS } from '../data/media';
import { placeById, PLACES } from '../data/places';
import { contactById } from '../data/contacts';
import { DEMO_WEATHER } from '../data/services';
import { FULL_TANK_RANGE_KM, TYRE_RANGE } from '../data/defaults';
import { computeRoute } from './routing';
import { clamp, dayPart, formatClock, formatMinutes } from './format';

/** One reply in each supported voice language. */
type Lines = { en: string; hinglish: string; hi: string };
const L = (en: string, hinglish: string, hi: string): Lines => ({ en, hinglish, hi });
const pickLang = (lines: Lines, lang: VoiceLanguage) => lines[lang];

export interface AssistantReply {
  text: string;
  lang: VoiceLanguage;
  page?: PageId;
  pending?: Intent | null;
  quickReplies?: string[];
  note?: string;
}

const PAGE_NAMES: Record<PageId, Lines> = {
  home: L('Home', 'Home', 'होम'),
  navigation: L('Navigation', 'Navigation', 'नेविगेशन'),
  media: L('Media', 'Media', 'मीडिया'),
  climate: L('Climate', 'Climate', 'क्लाइमेट'),
  phone: L('Phone', 'Phone', 'फ़ोन'),
  vehicle: L('Vehicle', 'Vehicle', 'वाहन'),
  apps: L('Apps', 'Apps', 'ऐप्स'),
  features: L('MYRA AI', 'MYRA AI', 'MYRA AI'),
  settings: L('Settings', 'Settings', 'सेटिंग्स'),
};

const RESTRICTED_WHILE_DRIVING: PageId[] = ['settings'];

function nearest(state: AppState, category: 'fuel' | 'parking') {
  const ref = placeById(state.nav.destinationId) ?? placeById(state.nav.originId) ?? PLACES[0];
  return PLACES.filter((p) => p.category === category)
    .map((p) => ({ p, d: Math.hypot(p.x - ref.x, p.y - ref.y) }))
    .sort((a, b) => a.d - b.d)[0].p;
}

function routeSummary(state: AppState, destId: string) {
  const origin = placeById(state.nav.originId) ?? PLACES[0];
  const dest = placeById(destId)!;
  const r = computeRoute(origin, dest, state.nav.routePref, state.nav.avoidTolls);
  return { minutes: formatMinutes(r.durationMin), km: `${r.distanceKm.toFixed(1)} km`, dest };
}

/**
 * Executes parsed intents against the shared app state and returns a natural,
 * localised reply. `state` is the snapshot before the actions run.
 */
export function respond(intents: Intent[], state: AppState, actions: Actions, pending: Intent | null): AssistantReply {
  const replies: string[] = [];
  let lang = state.settings.voiceLanguage;
  let page: PageId | undefined;
  let nextPending: Intent | null = null;
  let quickReplies: string[] | undefined;
  let note: string | undefined;
  const driving = state.driveMode === 'driving';
  const c = state.climate;
  const m = state.media;
  const profile = activeProfile(state);
  const say = (l: Lines) => replies.push(pickLang(l, lang));

  const run = (intent: Intent) => {
    switch (intent.type) {
      /* ---------- climate ---------- */
      case 'climate.set': {
        actions.climate.setTemp(intent.value);
        if (!c.ac) actions.climate.setAc(true);
        say(L(
          `Done — I’ve set the AC to ${intent.value}°.`,
          `Ho gaya! AC ${intent.value}° pe set kar diya.`,
          `हो गया! एसी ${intent.value}° पर सेट कर दिया है।`,
        ));
        break;
      }
      case 'climate.outOfRange':
        say(L(
          `I can set the temperature between ${TEMP_MIN}° and ${TEMP_MAX}°. ${intent.value}° is outside that range.`,
          `Temperature ${TEMP_MIN}° se ${TEMP_MAX}° ke beech hi set ho sakta hai.`,
          `तापमान ${TEMP_MIN}° से ${TEMP_MAX}° के बीच ही सेट हो सकता है।`,
        ));
        break;
      case 'climate.hot': {
        const target = c.driver.temp > 21 ? 20 : clamp(c.driver.temp - (intent.strong ? 3 : 2), TEMP_MIN, TEMP_MAX);
        if (c.ac && c.driver.temp <= target) {
          const fan = Math.min(FAN_MAX, c.fan + 2);
          nextPending = { type: 'climate.fanSet', value: fan };
          quickReplies = ['Haan, kar do', 'Nahi, rehne do'];
          say(L(
            `The AC is already at ${c.driver.temp}°. Shall I turn the fan up to ${fan}?`,
            `AC already ${c.driver.temp}° pe hai. Fan speed ${fan} kar doon?`,
            `एसी पहले से ${c.driver.temp}° पर है। क्या पंखा ${fan} पर कर दूँ?`,
          ));
          break;
        }
        if (state.settings.confirmClimate) {
          nextPending = { type: 'climate.set', value: target };
          quickReplies = [`Haan, ${target}° kar do`, 'Nahi, rehne do'];
          say(L(
            intent.strong
              ? `Oh, it really is warm today. Would you like me to set the AC to ${target} degrees?`
              : `Sure! Would you like me to set the AC to ${target} degrees?`,
            intent.strong
              ? `Haan, aaj sach mein bahut garmi hai. AC ${target}° pe kar doon?`
              : `Bilkul! AC ${target}° pe kar doon?`,
            `ज़रूर! क्या मैं एसी ${target} डिग्री पर कर दूँ?`,
          ));
        } else {
          actions.climate.setTemp(target);
          actions.climate.setAc(true);
          say(L(`I’ve cooled the cabin to ${target}°.`, `Cabin ko ${target}° pe thanda kar diya.`, `केबिन को ${target}° पर ठंडा कर दिया।`));
        }
        break;
      }
      case 'climate.cold': {
        const target = clamp(Math.max(c.driver.temp + (intent.strong ? 3 : 2), 24), TEMP_MIN, TEMP_MAX);
        if (state.settings.confirmClimate) {
          nextPending = { type: 'climate.set', value: target };
          quickReplies = [`Haan, ${target}° kar do`, 'Nahi'];
          say(L(
            `Let’s warm things up. Shall I set the temperature to ${target}°?`,
            `Thand lag rahi hai? Temperature ${target}° kar doon?`,
            `ठंड लग रही है? क्या तापमान ${target}° कर दूँ?`,
          ));
        } else {
          actions.climate.setTemp(target);
          say(L(`Warming the cabin to ${target}°.`, `Temperature ${target}° kar diya.`, `तापमान ${target}° कर दिया।`));
        }
        break;
      }
      case 'climate.acOn':
        actions.climate.setAc(true);
        say(L(`AC is on at ${c.driver.temp}°.`, `AC chalu kar diya, ${c.driver.temp}° pe.`, `एसी चालू कर दिया, ${c.driver.temp}° पर।`));
        break;
      case 'climate.acOff':
        actions.climate.setAc(false);
        say(L(
          'AC is off. Just say the word if it gets warm.',
          'AC band kar diya. Garmi lage toh bata dena.',
          'एसी बंद कर दिया। गर्मी लगे तो बता दीजिए।',
        ));
        break;
      case 'climate.tempUp':
      case 'climate.tempDown': {
        const up = intent.type === 'climate.tempUp';
        const t = clamp(c.driver.temp + (up ? 1 : -1), TEMP_MIN, TEMP_MAX);
        if (t === c.driver.temp) {
          say(L(`It’s already at the ${up ? 'maximum' : 'minimum'} of ${t}°.`, `Temperature already ${t}° pe hai, isse ${up ? 'zyada' : 'kam'} nahi ho sakta.`, `तापमान पहले से ${t}° पर है।`));
          break;
        }
        actions.climate.adjustTemp(up ? 1 : -1);
        say(L(`Temperature ${up ? 'raised' : 'lowered'} to ${t}°.`, `Temperature ${t}° kar diya.`, `तापमान ${t}° कर दिया।`));
        break;
      }
      case 'climate.fanUp':
      case 'climate.fanDown': {
        const up = intent.type === 'climate.fanUp';
        const f = clamp(c.fan + (up ? 1 : -1), 0, FAN_MAX);
        if (f === c.fan) {
          say(L(`The fan is already at ${up ? 'maximum' : 'its lowest'}.`, `Fan already ${up ? 'full speed' : 'sabse kam'} pe hai.`, `पंखा पहले से ${up ? 'सबसे तेज़' : 'सबसे धीमा'} है।`));
          break;
        }
        actions.climate.adjustFan(up ? 1 : -1);
        say(L(`Fan speed ${up ? 'increased' : 'reduced'} to ${f}.`, `Fan speed ${f} kar di.`, `पंखे की गति ${f} कर दी।`));
        break;
      }
      case 'climate.fanSet': {
        const f = clamp(Math.round(intent.value), 0, FAN_MAX);
        actions.climate.setFan(f);
        say(f === 0
          ? L('Fan is off.', 'Fan band kar diya.', 'पंखा बंद कर दिया।')
          : L(`Fan set to ${f}.`, `Fan ${f} pe set kar diya.`, `पंखा ${f} पर सेट कर दिया।`));
        break;
      }
      case 'climate.toggle': {
        const labels = { auto: 'AUTO climate', sync: 'SYNC', recirculation: 'Air recirculation', frontDefog: 'Front defogger', rearDefog: 'Rear defogger' };
        const current = c[intent.key];
        const on = intent.on ?? !current;
        if (on !== current) actions.climate.toggle(intent.key);
        const label = labels[intent.key];
        say(L(`${label} ${on ? 'on' : 'off'}.`, `${label} ${on ? 'on' : 'off'} kar diya.`, `${label} ${on ? 'चालू' : 'बंद'} कर दिया।`));
        break;
      }

      /* ---------- media ---------- */
      case 'media.playlist': {
        const pl = playlistById(intent.playlist);
        const tr = pl.tracks[0];
        actions.media.playPlaylist(pl.id);
        page = 'media';
        say(intent.playlist === 'podcasts'
          ? L(`Playing “${tr.title}” from ${tr.artist}.`, `Podcast chala rahi hoon — “${tr.title}”.`, `पॉडकास्ट चला रही हूँ — “${tr.title}”।`)
          : L(
              `Playing your ${pl.name} playlist, starting with “${tr.title}” by ${tr.artist}.`,
              `${pl.name} gaane chala rahi hoon — pehla gaana “${tr.title}”, ${tr.artist}.`,
              `${pl.nameHi} प्लेलिस्ट चला रही हूँ — “${tr.title}”, ${tr.artist}।`,
            ));
        break;
      }
      case 'media.radio': {
        const st = RADIO_STATIONS.find((r) => r.id === m.radioStationId) ?? RADIO_STATIONS[0];
        actions.media.playRadio(st.id);
        page = 'media';
        say(L(`Tuning to ${st.name}.`, `${st.name} laga rahi hoon.`, `${st.name} लगा रही हूँ।`));
        break;
      }
      case 'media.play': {
        const tr = playlistById(m.playlistId).tracks[m.trackIndex];
        actions.media.play();
        say(m.source === 'radio'
          ? L('Radio is back on.', 'Radio chalu kar diya.', 'रेडियो चालू कर दिया।')
          : L(`Playing “${tr.title}”.`, `“${tr.title}” chala rahi hoon.`, `“${tr.title}” चला रही हूँ।`));
        break;
      }
      case 'media.pause':
        actions.media.pause();
        say(L('Music paused.', 'Gaane band kar diye.', 'गाने रोक दिए।'));
        break;
      case 'media.next':
      case 'media.prev': {
        const pl = playlistById(m.playlistId);
        const i = (m.trackIndex + (intent.type === 'media.next' ? 1 : -1) + pl.tracks.length) % pl.tracks.length;
        if (intent.type === 'media.next') actions.media.next();
        else {
          actions.media.seek(0);
          actions.media.prev();
        }
        if (!m.playing) actions.media.play();
        say(L(`Now playing “${pl.tracks[i].title}”.`, `Ab chal raha hai “${pl.tracks[i].title}”.`, `अब चल रहा है “${pl.tracks[i].title}”।`));
        break;
      }
      case 'media.volUp':
      case 'media.volDown': {
        const up = intent.type === 'media.volUp';
        const v = clamp(m.volume + (up ? 3 : -3), 0, VOLUME_MAX);
        actions.media.adjustVolume(up ? 3 : -3);
        say(L(`Volume ${up ? 'up' : 'down'} to ${v}.`, `Volume ${v} kar diya.`, `आवाज़ ${v} कर दी।`));
        break;
      }
      case 'media.volSet': {
        const v = clamp(Math.round(intent.value), 0, VOLUME_MAX);
        actions.media.setVolume(v);
        say(L(`Volume set to ${v}.`, `Volume ${v} pe set kar diya.`, `आवाज़ ${v} पर सेट कर दी।`));
        break;
      }
      case 'media.mute':
        if (!m.muted) actions.media.toggleMute();
        say(L('Audio muted.', 'Mute kar diya.', 'आवाज़ बंद कर दी।'));
        break;
      case 'media.unmute':
        if (m.muted) actions.media.toggleMute();
        say(L('Audio unmuted.', 'Awaaz wapas chalu.', 'आवाज़ वापस चालू।'));
        break;
      case 'media.favourite': {
        const tr = playlistById(m.playlistId).tracks[m.trackIndex];
        if (!m.favourites.includes(tr.id)) actions.media.toggleFavourite(tr.id);
        say(L(`Added “${tr.title}” to your favourites.`, `“${tr.title}” favourites mein add kar diya.`, `“${tr.title}” पसंदीदा में जोड़ दिया।`));
        break;
      }

      /* ---------- navigation ---------- */
      case 'nav.home':
      case 'nav.work': {
        const isHome = intent.type === 'nav.home';
        const id = isHome ? profile.homeId : profile.workId;
        if (!id) {
          page = 'settings';
          say(L(
            `You haven’t saved a ${isHome ? 'Home' : 'Work'} address yet. You can add one under Settings → Driver profile.`,
            `Abhi tak ${isHome ? 'Home' : 'Work'} address save nahi hai. Settings → Driver profile mein add kar sakte hain.`,
            `अभी ${isHome ? 'घर' : 'ऑफ़िस'} का पता सेव नहीं है। सेटिंग्स → ड्राइवर प्रोफ़ाइल में जोड़ सकते हैं।`,
          ));
          break;
        }
        const r = routeSummary(state, id);
        actions.nav.setDestination(id);
        page = 'navigation';
        say(isHome
          ? L(
              `Taking you home to ${r.dest.name}. It’s about ${r.minutes} away.`,
              `Chaliye, ghar chalte hain! ${r.dest.name} tak lagbhag ${r.minutes} lagenge.`,
              `चलिए घर चलते हैं! ${r.dest.name} तक लगभग ${r.minutes} लगेंगे।`,
            )
          : L(
              `Heading to work at ${r.dest.name} — about ${r.minutes}.`,
              `Office ke liye route set hai — ${r.dest.name}, lagbhag ${r.minutes}.`,
              `ऑफ़िस का रूट तैयार है — ${r.dest.name}, लगभग ${r.minutes}।`,
            ));
        note = 'Route and timing are simulated demo data.';
        break;
      }
      case 'nav.place': {
        const r = routeSummary(state, intent.placeId);
        actions.nav.setDestination(intent.placeId);
        page = 'navigation';
        say(L(
          `Starting route to ${r.dest.name}: ${r.km}, about ${r.minutes}.`,
          `${r.dest.name} ka route set kar diya — ${r.km}, lagbhag ${r.minutes}.`,
          `${r.dest.name} का रूट सेट कर दिया — ${r.km}, लगभग ${r.minutes}।`,
        ));
        note = 'Route and timing are simulated demo data.';
        break;
      }
      case 'nav.fuel':
      case 'nav.parking': {
        const p = nearest(state, intent.type === 'nav.fuel' ? 'fuel' : 'parking');
        const r = routeSummary(state, p.id);
        actions.nav.setDestination(p.id);
        page = 'navigation';
        say(L(
          `The nearest ${intent.type === 'nav.fuel' ? 'fuel station' : 'parking'} is ${p.name}, ${r.km} away. Route started.`,
          `Sabse paas ${intent.type === 'nav.fuel' ? 'petrol pump' : 'parking'} hai ${p.name}, ${r.km} door. Route set kar diya.`,
          `सबसे पास ${intent.type === 'nav.fuel' ? 'पेट्रोल पंप' : 'पार्किंग'} ${p.name} है, ${r.km} दूर। रूट सेट कर दिया।`,
        ));
        note = 'Nearby places are sample data, not live listings.';
        break;
      }
      case 'nav.cancel':
        actions.nav.cancel();
        say(L('Route ended.', 'Navigation band kar di.', 'नेविगेशन बंद कर दिया।'));
        break;
      case 'nav.eta': {
        const dest = placeById(state.nav.destinationId);
        if (!dest) {
          say(L('There’s no active route right now. Where would you like to go?', 'Abhi koi route active nahi hai. Kahan chalna hai?', 'अभी कोई रूट सक्रिय नहीं है। कहाँ चलना है?'));
          break;
        }
        const r = computeRoute(placeById(state.nav.originId) ?? PLACES[0], dest, state.nav.routePref, state.nav.avoidTolls);
        const mins = r.durationMin * (1 - state.nav.progress);
        const eta = formatClock(new Date(Date.now() + mins * 60000), state.settings.clock24h);
        say(L(
          `We’ll reach ${dest.name} in about ${formatMinutes(mins)}, around ${eta}.`,
          `${dest.name} lagbhag ${formatMinutes(mins)} mein pahunch jayenge, ${eta} tak.`,
          `${dest.name} लगभग ${formatMinutes(mins)} में पहुँच जाएँगे, ${eta} तक।`,
        ));
        break;
      }

      /* ---------- pages ---------- */
      case 'open': {
        if (driving && RESTRICTED_WHILE_DRIVING.includes(intent.page)) {
          say(L(
            'Settings are limited while driving. I can still change the temperature, music or route for you.',
            'Driving ke time settings limited hain. Main temperature, music ya route badal sakti hoon.',
            'ड्राइविंग के दौरान सेटिंग्स सीमित हैं। मैं तापमान, संगीत या रूट बदल सकती हूँ।',
          ));
          break;
        }
        page = intent.page;
        const n = PAGE_NAMES[intent.page];
        say(L(`Opening ${n.en}.`, `${n.hinglish} khol rahi hoon.`, `${n.hi} खोल रही हूँ।`));
        break;
      }

      /* ---------- phone ---------- */
      case 'phone.call': {
        const contact = contactById(intent.contactId)!;
        if (!state.phone.deviceConnected) {
          page = 'phone';
          say(L('No phone is connected. Connect one from the Phone screen.', 'Koi phone connected nahi hai. Phone screen se connect kijiye.', 'कोई फ़ोन कनेक्ट नहीं है। फ़ोन स्क्रीन से कनेक्ट करें।'));
          break;
        }
        actions.phone.call(contact.id);
        say(L(`Calling ${contact.name}.`, `${contact.name} ko call laga rahi hoon.`, `${contact.name} को कॉल कर रही हूँ।`));
        note = 'Calls are simulated — no real call is placed.';
        break;
      }
      case 'phone.callUnknown':
        page = 'phone';
        say(L(
          `I couldn’t find “${intent.name || 'that contact'}” in your contacts.`,
          `“${intent.name || 'yeh naam'}” contacts mein nahi mila.`,
          `“${intent.name || 'यह नाम'}” संपर्कों में नहीं मिला।`,
        ));
        break;
      case 'phone.answer':
        if (state.phone.call.status === 'incoming') {
          actions.phone.accept();
          say(L('Call connected.', 'Call utha liya.', 'कॉल कनेक्ट हो गई।'));
        } else say(L('There’s no incoming call.', 'Koi incoming call nahi hai.', 'कोई इनकमिंग कॉल नहीं है।'));
        break;
      case 'phone.reject':
        if (state.phone.call.status !== 'idle') {
          if (state.phone.call.status === 'incoming') actions.phone.reject();
          else actions.phone.end();
          say(L('Call declined.', 'Call kaat diya.', 'कॉल काट दी।'));
        } else say(L('There’s no active call.', 'Koi call nahi chal raha.', 'कोई कॉल नहीं चल रही।'));
        break;

      /* ---------- language ---------- */
      case 'lang': {
        lang = intent.lang;
        actions.settings.patch({ voiceLanguage: intent.lang });
        say(L(
          'Sure — I’ll speak English from now on.',
          'Theek hai! Ab main Hinglish mein baat karungi.',
          'ठीक है! अब मैं हिंदी में बात करूँगी।',
        ));
        break;
      }

      /* ---------- vehicle & info ---------- */
      case 'vehicle.fuel': {
        const range = Math.round((state.vehicle.fuelPct / 100) * FULL_TANK_RANGE_KM);
        const pct = Math.round(state.vehicle.fuelPct);
        say(L(
          `Fuel is at ${pct}%, good for about ${range} km.`,
          `Fuel ${pct}% hai — lagbhag ${range} km aur chal jayegi.`,
          `ईंधन ${pct}% है — लगभग ${range} किमी और चल जाएगी।`,
        ));
        note = 'Vehicle data is simulated.';
        break;
      }
      case 'vehicle.tyres': {
        const low = Object.entries(state.vehicle.tyres).filter(([, v]) => v < TYRE_RANGE.min);
        const names: Record<string, string> = { fl: 'front-left', fr: 'front-right', rl: 'rear-left', rr: 'rear-right' };
        page = 'vehicle';
        say(low.length
          ? L(
              `The ${low.map(([k, v]) => `${names[k]} tyre is at ${v} psi`).join(' and ')} — a little low. Recommended is ${TYRE_RANGE.recommended} psi.`,
              `${low.map(([k, v]) => `${names[k]} tyre mein ${v} psi`).join(', ')} hai — thoda kam. ${TYRE_RANGE.recommended} psi hona chahiye.`,
              `${low.map(([k, v]) => `${names[k]} टायर ${v} psi`).join(', ')} — थोड़ा कम है। ${TYRE_RANGE.recommended} psi होना चाहिए।`,
            )
          : L('All four tyres are within the normal range.', 'Chaaron tyres theek hain.', 'चारों टायर ठीक हैं।'));
        note = 'Tyre pressures are simulated.';
        break;
      }
      case 'vehicle.status': {
        const range = Math.round((state.vehicle.fuelPct / 100) * FULL_TANK_RANGE_KM);
        say(L(
          `All systems look normal. Fuel ${Math.round(state.vehicle.fuelPct)}%, range ${range} km.`,
          `Sab theek hai! Fuel ${Math.round(state.vehicle.fuelPct)}%, range ${range} km.`,
          `सब ठीक है! ईंधन ${Math.round(state.vehicle.fuelPct)}%, रेंज ${range} किमी।`,
        ));
        note = 'Vehicle data is simulated.';
        break;
      }
      case 'vehicle.lock':
        actions.vehicle.patch({ locked: intent.on });
        say(intent.on
          ? L('Doors locked.', 'Darwaze lock kar diye.', 'दरवाज़े लॉक कर दिए।')
          : L('Doors unlocked.', 'Darwaze unlock kar diye.', 'दरवाज़े अनलॉक कर दिए।'));
        note = 'Lock control is simulated.';
        break;
      case 'info.time': {
        const t = formatClock(new Date(), state.settings.clock24h);
        say(L(`It’s ${t}.`, `Abhi ${t} baje hain.`, `अभी ${t} बजे हैं।`));
        break;
      }
      case 'info.weather':
        say(L(
          `In ${DEMO_WEATHER.city} it’s ${DEMO_WEATHER.tempC}° and ${DEMO_WEATHER.condition.toLowerCase()}, feels like ${DEMO_WEATHER.feelsLikeC}°.`,
          `${DEMO_WEATHER.city} mein ${DEMO_WEATHER.tempC}° hai, halke baadal hain. Feels like ${DEMO_WEATHER.feelsLikeC}°.`,
          `${DEMO_WEATHER.city} में ${DEMO_WEATHER.tempC}° है, ${DEMO_WEATHER.conditionHi}।`,
        ));
        note = 'Weather is demo data, not a live forecast.';
        break;

      /* ---------- conversation ---------- */
      case 'confirm':
        if (pending) {
          run(pending);
        } else say(L('Okay!', 'Theek hai!', 'ठीक है!'));
        break;
      case 'deny':
        say(pending
          ? L('No problem, I’ll leave it as it is.', 'Koi baat nahi, jaisa hai waisa rehne deti hoon.', 'कोई बात नहीं, जैसा है वैसा रहने देती हूँ।')
          : L('Alright.', 'Theek hai.', 'ठीक है।'));
        break;
      case 'greet': {
        const part = dayPart(new Date());
        const g = { morning: L('Good morning', 'Good morning', 'सुप्रभात'), afternoon: L('Good afternoon', 'Namaste', 'नमस्ते'), evening: L('Good evening', 'Good evening', 'शुभ संध्या'), night: L('Hello', 'Hello', 'नमस्ते') }[part];
        say(L(
          `${g.en}, ${profile.name}! How can I help?`,
          `${g.hinglish} ${profile.name}! Bataiye, kya karun?`,
          `${g.hi} ${profile.name}! बताइए, क्या करूँ?`,
        ));
        break;
      }
      case 'help':
        say(L(
          'You can talk to me naturally — try “AC 20 pe kar do”, “Romantic gaane chalao”, “Ghar le chalo” or “Fuel kitna hai?”.',
          'Aap mujhse normally baat kar sakte hain — jaise “AC 20 pe kar do”, “Romantic gaane chalao” ya “Ghar le chalo”.',
          'आप मुझसे सामान्य रूप से बात कर सकते हैं — जैसे “एसी 20 पर कर दो” या “घर ले चलो”।',
        ));
        break;
      case 'thanks':
        say(L('Anytime!', 'Koi baat nahi!', 'कोई बात नहीं!'));
        break;
      case 'system.start':
        say(L('I’m already up and running.', 'Main already ready hoon!', 'मैं पहले से तैयार हूँ!'));
        break;
      case 'unknown':
        quickReplies = ['AC 20 pe kar do', 'Ghar le chalo', 'Romantic gaane chalao'];
        say(L(
          'Sorry, I didn’t quite get that. You could try “AC 20 pe kar do” or “Ghar le chalo”.',
          'Sorry, samajh nahi aaya. “AC 20 pe kar do” ya “Ghar le chalo” jaisa kuch try kijiye.',
          'माफ़ कीजिए, समझ नहीं आया। “एसी 20 पर कर दो” जैसा कुछ बोलकर देखिए।',
        ));
        break;
    }
  };

  intents.forEach(run);

  return { text: replies.join(' '), lang, page, pending: nextPending, quickReplies, note };
}
