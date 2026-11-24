import type { PageId, PlaylistId, VoiceLanguage } from '../types';
import { PLACES } from '../data/places';
import { findContact } from '../data/contacts';

/**
 * Local, rule-based natural-language understanding for English, Hindi (Devanagari)
 * and Hinglish. It works offline and needs no API keys. Rules match intent-bearing
 * keyword groups rather than exact phrases, so common variations are understood.
 */

export type ClimateToggleKey = 'auto' | 'sync' | 'recirculation' | 'frontDefog' | 'rearDefog';

export type Intent =
  | { type: 'climate.set'; value: number }
  | { type: 'climate.outOfRange'; value: number }
  | { type: 'climate.hot'; strong: boolean }
  | { type: 'climate.cold'; strong: boolean }
  | { type: 'climate.acOn' }
  | { type: 'climate.acOff' }
  | { type: 'climate.tempUp' }
  | { type: 'climate.tempDown' }
  | { type: 'climate.fanUp' }
  | { type: 'climate.fanDown' }
  | { type: 'climate.fanSet'; value: number }
  | { type: 'climate.toggle'; key: ClimateToggleKey; on: boolean | null }
  | { type: 'media.playlist'; playlist: PlaylistId }
  | { type: 'media.radio' }
  | { type: 'media.play' }
  | { type: 'media.pause' }
  | { type: 'media.next' }
  | { type: 'media.prev' }
  | { type: 'media.volUp' }
  | { type: 'media.volDown' }
  | { type: 'media.volSet'; value: number }
  | { type: 'media.mute' }
  | { type: 'media.unmute' }
  | { type: 'media.favourite' }
  | { type: 'nav.home' }
  | { type: 'nav.work' }
  | { type: 'nav.place'; placeId: string }
  | { type: 'nav.fuel' }
  | { type: 'nav.parking' }
  | { type: 'nav.cancel' }
  | { type: 'nav.eta' }
  | { type: 'open'; page: PageId }
  | { type: 'phone.call'; contactId: string }
  | { type: 'phone.callUnknown'; name: string }
  | { type: 'phone.answer' }
  | { type: 'phone.reject' }
  | { type: 'lang'; lang: VoiceLanguage }
  | { type: 'vehicle.fuel' }
  | { type: 'vehicle.tyres' }
  | { type: 'vehicle.status' }
  | { type: 'vehicle.lock'; on: boolean }
  | { type: 'info.time' }
  | { type: 'info.weather' }
  | { type: 'confirm' }
  | { type: 'deny' }
  | { type: 'greet' }
  | { type: 'help' }
  | { type: 'thanks' }
  | { type: 'system.start' }
  | { type: 'unknown'; text: string };

/* ---------- normalisation ---------- */

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

const NUMBER_WORDS: Record<string, number> = {
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  'twenty one': 21, 'twenty two': 22, 'twenty three': 23, 'twenty four': 24, 'twenty five': 25,
  'twenty six': 26, 'twenty seven': 27, 'twenty eight': 28, 'twenty nine': 29,
  solah: 16, satrah: 17, athara: 18, atharah: 18, attharah: 18, unnis: 19, unnees: 19,
  bees: 20, bis: 20, ikkis: 21, ikkees: 21, bais: 22, baees: 22, baais: 22, teis: 23, teyis: 23,
  chaubis: 24, chaubees: 24, chobis: 24, pachis: 25, pachees: 25, chhabbis: 26, chabbis: 26,
  sattais: 27, sattaees: 27, atthais: 28, athais: 28, untis: 29, untees: 29, tees: 30,
  सोलह: 16, सत्रह: 17, अठारह: 18, उन्नीस: 19, बीस: 20, इक्कीस: 21, बाईस: 22, तेईस: 23,
  चौबीस: 24, पच्चीस: 25, छब्बीस: 26, सत्ताईस: 27, अट्ठाईस: 28, उनतीस: 29, तीस: 30,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ek: 1, do: 2, teen: 3, char: 4, paanch: 5,
};

export function normalise(input: string): string {
  let s = input.toLowerCase();
  s = s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
  s = s.replace(/a\.c\.?/g, 'ac').replace(/[“”"'’!?¿,.;:।]/g, ' ');
  s = s.replace(/°\s*c?/g, ' degree ');
  s = s.replace(/\s+/g, ' ').trim();
  // Wake words
  s = s.replace(/^(hey |hi |ok |okay |hello )?(myra|maira|mira|mayra|मायरा|मीरा)\b\s*/, '');
  // Compound English numbers first ("twenty two"), then single words.
  for (const [word, n] of Object.entries(NUMBER_WORDS).sort((a, b) => b[0].length - a[0].length)) {
    if (word.length < 3 && !/^\d/.test(word)) continue; // skip "do"/"ek" here; ambiguous in Hinglish
    s = s.replace(new RegExp(`(^|\\s)${word}(?=\\s|$)`, 'g'), `$1${n}`);
  }
  return s.trim();
}

const words = (...alts: string[]) => new RegExp(`(^|\\s)(${alts.join('|')})(?=\\s|$)`);
const has = (s: string, re: RegExp) => re.test(s);

/* ---------- lexicon ---------- */
const AC = words('ac', 'a c', 'aircon', 'air conditioner', 'aircondition', 'climate', 'temperature', 'temp', 'tapman', 'cooling', 'एसी', 'तापमान', 'esi');
const DEGREE = words('degree', 'degrees', 'digri', 'डिग्री');
const SET_TO = words('pe', 'par', 'per', 'to', 'at', 'पर', 'पे', 'set');
const OFF = words('band', 'bandh', 'bnd', 'off', 'stop', 'बंद', 'close', 'switch off', 'turn off', 'disable', 'hatao');
const ON = words('on', 'chalu', 'chaalu', 'start', 'चालू', 'switch on', 'turn on', 'enable', 'laga do', 'lagao');
const UP = words('badhao', 'badha', 'badhaa', 'badha do', 'badhaao', 'increase', 'up', 'tez', 'tej', 'zyada', 'jyada', 'high', 'higher', 'more', 'raise', 'boost', 'बढ़ाओ', 'बढ़ा', 'तेज़', 'तेज', 'ज़्यादा', 'louder', 'loud');
const DOWN = words('kam', 'ghatao', 'ghata', 'decrease', 'down', 'lower', 'reduce', 'dheema', 'dheemi', 'dheere', 'slow', 'less', 'कम', 'धीमा', 'घटाओ', 'quieter', 'softer', 'low');
const FAN = words('fan', 'pankha', 'blower', 'hawa', 'फैन', 'पंखा', 'हवा', 'fan speed');
const HOT = words('garmi', 'garam', 'garmii', 'hot', 'warm', 'sweating', 'pasina', 'paseena', 'गर्मी', 'गरम', 'humid', 'ubal');
const COLD = words('thand', 'thandi', 'thanda', 'cold', 'chilly', 'freezing', 'sardi', 'ठंड', 'ठंडी', 'सर्दी', 'kaanp');
const VERY = words('bahut', 'bohot', 'bahot', 'very', 'too', 'so', 'really', 'kaafi', 'बहुत', 'ekdum');
const MUSIC = words('gaana', 'gaane', 'gana', 'gane', 'gaano', 'song', 'songs', 'music', 'sangeet', 'track', 'playlist', 'गाना', 'गाने', 'संगीत', 'mix', 'tracks');
const PLAY = words('chalao', 'chala do', 'chalaao', 'play', 'bajao', 'baja do', 'lagao', 'laga do', 'sunao', 'suna do', 'resume', 'start', 'चलाओ', 'बजाओ', 'सुनाओ', 'put on');
const PAUSE = words('band', 'bandh', 'stop', 'pause', 'ruko', 'roko', 'rok do', 'बंद', 'रोको', 'chup', 'mat bajao');
const NEXT = words('next', 'agla', 'agle', 'aglaa', 'skip', 'अगला', 'dusra', 'doosra', 'change');
const PREV = words('previous', 'pichla', 'pichhla', 'pichle', 'पिछला', 'last song', 'go back');
const VOLUME = words('volume', 'awaaz', 'awaz', 'aawaz', 'avaaz', 'sound', 'आवाज़', 'आवाज', 'वॉल्यूम');
const MUTE = words('mute', 'chup', 'silent', 'म्यूट');
const UNMUTE = words('unmute');
const GO = words('le chalo', 'chalo', 'le jao', 'le chal', 'navigate', 'take me', 'go to', 'drive to', 'jaana hai', 'jana hai', 'chalna hai', 'जाना है', 'ले चलो', 'चलो', 'directions', 'route', 'rasta', 'raasta', 'head to', 'pahuncha do', 'chaliye');
const HOME_W = words('ghar', 'home', 'घर', 'makaan', 'gharr');
const WORK_W = words('office', 'work', 'daftar', 'ऑफिस', 'दफ़्तर', 'workplace', 'kaam pe', 'kaam par');
const FUEL_W = words('petrol', 'diesel', 'fuel', 'pump', 'petrol pump', 'cng', 'पेट्रोल', 'gas station', 'fuel station', 'tel');
const NEAR = words('nearest', 'nearby', 'near', 'paas', 'nazdeek', 'najdik', 'closest', 'find', 'dhundo', 'kahan', 'where', 'chalo', 'le chalo', 'station', 'pump', 'dikhao', 'पास', 'नज़दीक');
const AMOUNT = words('kitna', 'kitni', 'how much', 'level', 'left', 'bacha', 'bachi', 'remaining', 'status', 'kitne');
const PARKING_W = words('parking', 'park karna', 'park', 'पार्किंग');
const CANCEL = words('cancel', 'band', 'stop', 'end', 'khatam', 'बंद', 'रद्द', 'exit');
const NAV_W = words('navigation', 'route', 'rasta', 'raasta', 'direction', 'directions', 'नेविगेशन');
const ETA_W = words('kitni der', 'how long', 'eta', 'kab pahunchenge', 'kab tak', 'when will we reach', 'how far', 'kitna door', 'kitni door', 'time to reach', 'arrival');
const OPEN = words('open', 'show', 'kholo', 'khol do', 'dikhao', 'dikha do', 'go to', 'switch to', 'खोलो', 'दिखाओ', 'display', 'launch');
const CALL = words('call', 'phone karo', 'phone lagao', 'call karo', 'call lagao', 'call kar do', 'dial', 'ring', 'कॉल', 'फ़ोन लगाओ', 'baat karao');
const ANSWER = words('answer', 'uthao', 'utha lo', 'accept', 'receive', 'pick up', 'उठाओ');
const REJECT = words('reject', 'decline', 'kaat do', 'kaato', 'cut', 'ignore', 'mat uthao');
const LOCK = words('lock', 'lock karo', 'लॉक');
const UNLOCK = words('unlock', 'khol do darwaza', 'अनलॉक');
const TYRE = words('tyre', 'tyres', 'tire', 'tires', 'tyre pressure', 'टायर');
const STATUS = words('car status', 'vehicle status', 'gaadi kaisi', 'car health', 'vehicle health', 'health', 'sab theek', 'diagnostics', 'service');
const TIME = words('time kya', 'kitne baje', 'what time', 'samay', 'time', 'टाइम', 'समय');
const WEATHER = words('weather', 'mausam', 'मौसम', 'barish', 'baarish', 'rain', 'forecast', 'bahar ka temperature', 'outside temperature');
const LANG_VERB = words('mein', 'me', 'में', 'baat', 'bolo', 'speak', 'talk', 'language', 'switch', 'reply', 'respond');
const AC_DEVICE = words('ac', 'a c', 'aircon', 'air conditioner', 'cooling', 'एसी', 'esi');
const TEMP_WORD = words('temperature', 'temp', 'tapman', 'तापमान');
const START = words('gaadi start', 'gadi start', 'gaadi chalu', 'start karo', 'start the car', 'engine start', 'गाड़ी स्टार्ट', 'start myra', 'wake up', 'jaago');
const CONFIRM = /^(yes|yeah|yep|yup|haan|han|ha|haa|haanji|ji|ji haan|ok|okay|sure|kar do|karo|please|theek hai|thik hai|thik h|bilkul|zaroor|haan kar do|haan please|go ahead|do it|हाँ|हां|जी|ठीक है|ज़रूर)( (kar do|karo|please|ji|set kar do|thanks))?$/;
const DENY = /^(no|nope|nah|nahi|nahin|na|mat karo|rehne do|cancel|not now|no thanks|नहीं|ना|रहने दो)( (thanks|ji|abhi nahi))?$/;
const GREET = /^(hi|hello|hey|namaste|namaskar|नमस्ते|good morning|good afternoon|good evening|kaise ho|how are you)?$/;
const HELP = words('help', 'what can you do', 'kya kar sakti', 'kya kya kar', 'madad', 'मदद', 'commands');
const THANKS = words('thank', 'thanks', 'thank you', 'shukriya', 'dhanyavaad', 'dhanyawad', 'धन्यवाद', 'शुक्रिया');

const GENRES: [PlaylistId, RegExp][] = [
  ['romantic', words('romantic', 'romance', 'pyaar', 'pyar', 'love', 'रोमांटिक', 'प्यार', 'ishq')],
  ['hiphop', words('hip hop', 'hiphop', 'hip-hop', 'rap', 'हिप हॉप', 'desi hip hop')],
  ['bollywood', words('bollywood', 'filmi', 'hindi', 'बॉलीवुड', 'film')],
  ['focus', words('focus', 'calm', 'relax', 'relaxing', 'instrumental', 'lofi', 'lo fi', 'shaant', 'peaceful', 'फोकस', 'soothing')],
  ['english', words('english', 'pop', 'international', 'इंग्लिश', 'angrezi', 'english hits')],
  ['podcasts', words('podcast', 'podcasts', 'पॉडकास्ट')],
];

const PAGES: [PageId, RegExp][] = [
  ['navigation', words('map', 'maps', 'navigation', 'naksha', 'नक्शा', 'नेविगेशन')],
  ['media', words('media', 'music', 'player', 'music player', 'मीडिया')],
  ['climate', words('climate', 'ac settings', 'ac controls', 'temperature settings', 'क्लाइमेट')],
  ['phone', words('phone', 'calls', 'dialer', 'contacts', 'फ़ोन', 'फोन')],
  ['vehicle', words('vehicle', 'car info', 'car status', 'gaadi', 'वाहन', 'driver assistance', 'adas')],
  ['features', words('myra ai', 'drowsiness', 'drowsiness meter', 'alertness', 'safe exit', 'safe exit assist')],
  ['apps', words('apps', 'app', 'services', 'bharatconnect', 'bharat connect', 'fastag', 'ऐप्स')],
  ['settings', words('settings', 'setting', 'सेटिंग्स', 'preferences')],
  ['home', words('home screen', 'homescreen', 'main screen', 'dashboard', 'home page')],
];

const numbersIn = (s: string) => (s.match(/\d+(\.\d+)?/g) ?? []).map(Number);

/* ---------- clause parser ---------- */

function parseClause(s: string): Intent {
  if (!s) return { type: 'greet' };
  if (has(s, START)) return { type: 'system.start' };

  // Language preference
  if (has(s, words('hindi', 'हिंदी', 'हिन्दी')) && has(s, LANG_VERB) && !has(s, MUSIC))
    return { type: 'lang', lang: 'hi' };
  if (/hinglish/.test(s)) return { type: 'lang', lang: 'hinglish' };
  if (has(s, words('english', 'angrezi', 'इंग्लिश')) && has(s, LANG_VERB) && !has(s, MUSIC))
    return { type: 'lang', lang: 'en' };

  const shortUtterance = s.split(' ').length <= 4;
  if (shortUtterance && CONFIRM.test(s)) return { type: 'confirm' };
  if (shortUtterance && DENY.test(s)) return { type: 'deny' };

  if (has(s, ANSWER) && !has(s, MUSIC)) return { type: 'phone.answer' };
  if (has(s, REJECT) && /(call|phone|कॉल)/.test(s)) return { type: 'phone.reject' };

  const nums = numbersIn(s);

  // Volume
  if (has(s, VOLUME) || (has(s, MUTE) && !has(s, FAN))) {
    if (has(s, UNMUTE)) return { type: 'media.unmute' };
    if (has(s, MUTE) || (has(s, OFF) && !has(s, UP))) return { type: 'media.mute' };
    if (nums.length && has(s, VOLUME)) return { type: 'media.volSet', value: nums[0] };
    if (has(s, DOWN)) return { type: 'media.volDown' };
    return { type: 'media.volUp' };
  }
  if (has(s, UNMUTE)) return { type: 'media.unmute' };

  // Fan
  if (has(s, FAN) && !has(s, words('hawa tyre', 'tyre'))) {
    if (has(s, OFF)) return { type: 'climate.fanSet', value: 0 };
    if (nums.length) return { type: 'climate.fanSet', value: nums[0] };
    if (has(s, DOWN)) return { type: 'climate.fanDown' };
    if (has(s, UP) || has(s, ON)) return { type: 'climate.fanUp' };
  }

  // Defog / circulation / auto / sync (checked before generic AC on/off)
  if (/(defog|demist|defrost|sheesha|sheeshe|windshield|windscreen|शीशा)/.test(s)) {
    const rear = /(rear|back|piche|peeche|pichla|पीछे)/.test(s);
    return { type: 'climate.toggle', key: rear ? 'rearDefog' : 'frontDefog', on: has(s, OFF) ? false : has(s, ON) ? true : null };
  }
  if (/(recirc|recirculation|circulation|andar ki hawa|fresh air|bahar ki hawa)/.test(s)) {
    const fresh = /(fresh air|bahar ki hawa)/.test(s);
    const on = fresh ? false : has(s, OFF) ? false : has(s, ON) ? true : null;
    return { type: 'climate.toggle', key: 'recirculation', on };
  }
  if (/(auto mode|auto climate|climate auto|ac auto|automatic)/.test(s) || (has(s, words('auto')) && has(s, AC)))
    return { type: 'climate.toggle', key: 'auto', on: has(s, OFF) ? false : true };
  if (/(sync|dual zone)/.test(s)) return { type: 'climate.toggle', key: 'sync', on: has(s, OFF) ? false : true };

  // Temperature with a number: "AC 20 pe kar do", "set temperature to 22", "22 degree"
  const tempContext = has(s, AC) || has(s, DEGREE);
  const tempNum = nums.find((n) => n >= 10 && n <= 40);
  if (tempContext && tempNum !== undefined && (has(s, SET_TO) || has(s, DEGREE) || has(s, AC))) {
    return tempNum >= 16 && tempNum <= 30
      ? { type: 'climate.set', value: tempNum }
      : { type: 'climate.outOfRange', value: tempNum };
  }

  // AC on/off
  if (has(s, AC) && has(s, OFF)) return { type: 'climate.acOff' };
  if (has(s, AC) && has(s, ON)) return { type: 'climate.acOn' };

  // Relative temperature
  if (/(thanda|cool|cooler|thandak|ठंडा)\s*(karo|kar do|kardo|down|it down|please|करो)?/.test(s) && !has(s, HOT) && /(karo|kar do|kardo|cool down|cooler|cool it|करो)/.test(s))
    return { type: 'climate.tempDown' };
  if (/(garam|warmer|warm up|heat up|heater|गरम)\s*(karo|kar do|kardo|it up|please|करो)?/.test(s) && /(karo|kar do|kardo|warmer|warm up|heat up|heater|करो)/.test(s))
    return { type: 'climate.tempUp' };
  // 'AC tez karo' means more cooling (lower temperature); 'temperature badhao' means warmer.
  const coolingTalk = has(s, AC_DEVICE) && !has(s, TEMP_WORD);
  if (has(s, AC) && has(s, UP)) return { type: coolingTalk ? 'climate.tempDown' : 'climate.tempUp' };
  if (has(s, AC) && has(s, DOWN)) return { type: coolingTalk ? 'climate.tempUp' : 'climate.tempDown' };

  // Comfort feelings
  if (has(s, HOT) && !has(s, MUSIC)) return { type: 'climate.hot', strong: has(s, VERY) };
  if (has(s, COLD) && !has(s, MUSIC)) return { type: 'climate.cold', strong: has(s, VERY) };

  // Media
  const genre = GENRES.find(([, re]) => has(s, re));
  if (/(radio|fm|रेडियो)/.test(s) && !has(s, OFF)) return { type: 'media.radio' };
  if (has(s, MUSIC) && has(s, PAUSE)) return { type: 'media.pause' };
  if (genre && (has(s, MUSIC) || has(s, PLAY) || genre[0] === 'podcasts')) return { type: 'media.playlist', playlist: genre[0] };
  if (/^(pause|stop|ruko|bas)( music| it| karo| kar do)?$/.test(s)) return { type: 'media.pause' };
  if (has(s, NEXT) && (has(s, MUSIC) || shortUtterance)) return { type: 'media.next' };
  if (has(s, PREV) && (has(s, MUSIC) || shortUtterance)) return { type: 'media.prev' };
  if (/(favourite|favorite|pasand|like this)/.test(s) && /(add|mark|save|kar do|karo|this|yeh)/.test(s)) return { type: 'media.favourite' };
  if ((has(s, MUSIC) && (has(s, PLAY) || has(s, ON))) || /^(play|resume|continue)( music| playing)?$/.test(s) || /^(gaana|gaane|music|song) ?(chalao|bajao|sunao|lagao)?$/.test(s))
    return { type: 'media.play' };

  // Navigation
  if (has(s, NAV_W) && has(s, CANCEL)) return { type: 'nav.cancel' };
  if (has(s, ETA_W)) return { type: 'nav.eta' };
  if (has(s, FUEL_W) && has(s, AMOUNT)) return { type: 'vehicle.fuel' };
  if (/(range|kitna chalegi|kitni chalegi|how far can)/.test(s)) return { type: 'vehicle.fuel' };
  if (has(s, FUEL_W) && (has(s, NEAR) || has(s, GO))) return { type: 'nav.fuel' };
  if (has(s, PARKING_W) && !has(s, words('parking assist', 'parking sensor'))) return { type: 'nav.parking' };

  const page = PAGES.find(([, re]) => has(s, re));
  if (has(s, OPEN) && page) return { type: 'open', page: page[0] };

  if (has(s, HOME_W) && (has(s, GO) || /^(ghar|home|घर)$/.test(s) || /(go home|ghar jaana|ghar jana)/.test(s))) return { type: 'nav.home' };
  if (has(s, WORK_W) && (has(s, GO) || /^(office|work)$/.test(s))) return { type: 'nav.work' };

  const place = findPlaceIn(s);
  if (place && (has(s, GO) || has(s, OPEN) || s.split(' ').length <= 3)) return { type: 'nav.place', placeId: place };

  // Phone
  if (has(s, CALL)) {
    const name = s
      .replace(CALL, ' ')
      .replace(/\b(ko|please|karo|kar do|lagao|abhi|to|ki|se|myra|phone|ka|number)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const contact = findContact(name);
    return contact ? { type: 'phone.call', contactId: contact.id } : { type: 'phone.callUnknown', name };
  }

  if (page && (has(s, OPEN) || s.split(' ').length <= 2)) return { type: 'open', page: page[0] };

  // Vehicle & info
  if (has(s, TYRE)) return { type: 'vehicle.tyres' };
  if (has(s, UNLOCK)) return { type: 'vehicle.lock', on: false };
  if (has(s, LOCK)) return { type: 'vehicle.lock', on: true };
  if (has(s, STATUS)) return { type: 'vehicle.status' };
  if (has(s, WEATHER)) return { type: 'info.weather' };
  if (has(s, TIME)) return { type: 'info.time' };
  if (has(s, THANKS)) return { type: 'thanks' };
  if (has(s, HELP)) return { type: 'help' };
  if (GREET.test(s)) return { type: 'greet' };

  // Bare genre / play words as a last resort
  if (genre) return { type: 'media.playlist', playlist: genre[0] };
  if (has(s, MUSIC)) return { type: 'media.play' };

  return { type: 'unknown', text: s };
}

function findPlaceIn(s: string): string | null {
  let best: { id: string; len: number } | null = null;
  for (const p of PLACES) {
    if (p.category === 'home' || p.category === 'work' || p.id === 'guindy') continue;
    for (const alias of [p.name.toLowerCase(), ...p.aliases]) {
      if (alias.length < 3) continue;
      if (new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`).test(s) && (!best || alias.length > best.len)) {
        best = { id: p.id, len: alias.length };
      }
    }
  }
  return best?.id ?? null;
}

const SPLIT = /\s(?:and then|and also|and|aur phir|aur|phir|then|also|और|फिर)\s/;

/** Parses an utterance into one or more intents ("AC 20 pe kar do aur romantic gaane chalao"). */
export function parseIntents(input: string): Intent[] {
  const s = normalise(input);
  const whole = parseClause(s);
  const parts = s.split(SPLIT).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const intents = parts.map(parseClause).filter((i) => i.type !== 'unknown' && i.type !== 'greet');
    if (intents.length > 1) return intents;
  }
  return [whole];
}

/** Replaces a taught phrase ("Teach Voice") with the command it stands for. */
export function expandCustomCommands(input: string, commands: { phrase: string; command: string }[]): string {
  const s = normalise(input);
  const match = commands
    .filter((c) => c.phrase && s.includes(normalise(c.phrase)))
    .sort((a, b) => b.phrase.length - a.phrase.length)[0];
  return match ? match.command : input;
}
