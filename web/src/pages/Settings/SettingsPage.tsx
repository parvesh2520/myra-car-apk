import { useState } from 'react';
import {
  Accessibility, AudioLines, Info, Languages, Mic, MonitorSmartphone, Plus, RotateCcw, Sun, Trash, UserRound, Waves, Wifi,
} from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { useAssistant } from '../../context/AssistantContext';
import { DrivingNotice } from '../../components/cards/DrivingNotice';
import { Toggle } from '../../components/controls/Toggle';
import { Slider } from '../../components/controls/Slider';
import { Segmented } from '../../components/controls/Segmented';
import { ProfilesSection } from './ProfilesSection';
import { OfflineVoiceSetting, VoiceEngineSettings } from './BackendSettings';
import { Group, Setting } from './SettingsLayout';
import { MotionSenseSection } from './MotionSenseSettings';
import { parseIntents } from '../../services/intentParser';
import { hasVoiceFor, speak, synthesisSupported, recognitionSupported } from '../../services/speech';
import type { ScreenFit, ThemePref, UiLanguage, VoiceLanguage } from '../../types';

type Section = 'display' | 'language' | 'profiles' | 'voice' | 'accessibility' | 'motionsense' | 'connectivity' | 'audio' | 'about';

const SECTIONS: { id: Section; label: string; icon: typeof Sun; drivingOk?: boolean }[] = [
  { id: 'display', label: 'Display', icon: Sun, drivingOk: true },
  { id: 'language', label: 'Language & units', icon: Languages },
  { id: 'profiles', label: 'Driver profiles', icon: UserRound },
  { id: 'voice', label: 'Myra voice', icon: Mic },
  { id: 'accessibility', label: 'Accessibility', icon: Accessibility, drivingOk: true },
  { id: 'motionsense', label: 'MotionSense', icon: Waves, drivingOk: true },
  { id: 'connectivity', label: 'Connectivity', icon: Wifi },
  { id: 'audio', label: 'Audio', icon: AudioLines },
  { id: 'about', label: 'About MYRA', icon: Info },
];

export function SettingsPage() {
  const { pageSection, driveMode } = useAppState();
  const [section, setSection] = useState<Section>(SECTIONS.find((s) => s.id === pageSection)?.id ?? 'display');
  const driving = driveMode === 'driving';
  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="h-full p-5 grid grid-cols-[250px_minmax(0,1fr)] gap-4">
      <nav className="card p-2 flex flex-col gap-0.5 self-start" aria-label="Settings categories">
        {SECTIONS.map(({ id, label, icon: Icon, drivingOk }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            aria-current={section === id ? 'page' : undefined}
            className={`flex items-center gap-3 h-[52px] px-4 rounded-xl text-left transition-colors ${
              section === id ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
            } ${driving && !drivingOk ? 'opacity-50' : ''}`}
          >
            <Icon size={18} aria-hidden />
            <span className="font-medium">{label}</span>
          </button>
        ))}
      </nav>
      <div key={section} className="anim-fade min-h-0 scroll-y pr-1">
        {driving && !current.drivingOk ? (
          <DrivingNotice />
        ) : (
          {
            display: <DisplaySection />,
            language: <LanguageSection />,
            profiles: <ProfilesSection />,
            voice: <VoiceSection />,
            accessibility: <AccessibilitySection />,
            motionsense: <MotionSenseSection />,
            connectivity: <ConnectivitySection />,
            audio: <AudioSection />,
            about: <AboutSection />,
          }[section]
        )}
      </div>
    </div>
  );
}

function DisplaySection() {
  const { settings } = useAppState();
  const actions = useActions();
  const set = actions.settings.patch;
  return (
    <>
      <Group title="Display">
        <Setting label="Brightness" hint="Dims the whole screen">
          <div className="w-64 flex items-center gap-3">
            <Slider value={settings.brightness} min={40} max={100} step={5} onChange={(v) => set({ brightness: v })} label="Brightness" valueText={`${settings.brightness}%`} />
            <span className="w-10 text-sm text-ink tabular-nums">{settings.brightness}%</span>
          </div>
        </Setting>
        <Setting label="Theme" hint={settings.autoDayNight ? 'Controlled by automatic day/night' : undefined}>
          <Segmented<ThemePref>
            label="Theme"
            value={settings.theme}
            onChange={(v) => set({ theme: v })}
            options={[{ value: 'dark', label: 'Dark', disabled: settings.autoDayNight }, { value: 'light', label: 'Light', disabled: settings.autoDayNight }]}
          />
        </Setting>
        <Setting label="Automatic day / night" hint="Light theme 07:00–18:00, dark otherwise (uses the clock, not a light sensor)">
          <Toggle checked={settings.autoDayNight} onChange={(v) => set({ autoDayNight: v })} label="Automatic day and night mode" />
        </Setting>
      </Group>
      <Group title="Screen preferences">
        <Setting label="Screen fit" hint="Reference matches the Verna’s ≈2.29:1 panel; Fill uses the whole browser window">
          <Segmented<ScreenFit>
            label="Screen fit"
            value={settings.screenFit}
            onChange={(v) => set({ screenFit: v })}
            options={[{ value: 'fill', label: 'Fill window' }, { value: 'reference', label: 'Verna 2.29:1' }]}
          />
        </Setting>
        <Setting label="24-hour clock">
          <Toggle checked={settings.clock24h} onChange={(v) => set({ clock24h: v })} label="24-hour clock" />
        </Setting>
        <Setting label="Standby screen" hint="Return to the VERNA standby display">
          <button type="button" className="btn" onClick={actions.ui.standby}>Show standby</button>
        </Setting>
      </Group>
    </>
  );
}

function LanguageSection() {
  const { settings } = useAppState();
  const actions = useActions();
  const set = actions.settings.patch;
  return (
    <>
      <Group title="Language" note="Hinglish is a voice-interaction mode: Myra understands and replies in Roman-script Hindi-English.">
        <Setting label="Display language">
          <Segmented<UiLanguage> label="Display language" value={settings.uiLanguage} onChange={(v) => set({ uiLanguage: v })} options={[{ value: 'en', label: 'English' }, { value: 'hi', label: 'हिन्दी' }]} />
        </Setting>
        <Setting label="Myra’s language" hint="Spoken and written replies">
          <VoiceLanguagePicker />
        </Setting>
      </Group>
      <Group title="Units & region">
        <Setting label="Temperature">
          <Segmented label="Temperature unit" value={settings.tempUnit} onChange={(v) => set({ tempUnit: v })} options={[{ value: 'C', label: '°C' }, { value: 'F', label: '°F' }]} />
        </Setting>
        <Setting label="Distance">
          <Segmented label="Distance unit" value={settings.distanceUnit} onChange={(v) => set({ distanceUnit: v })} options={[{ value: 'km', label: 'Kilometres' }, { value: 'mi', label: 'Miles' }]} />
        </Setting>
        <Setting label="Region" hint="Used for sample services and formats">
          <span className="text-sm text-ink">India · ₹ INR</span>
        </Setting>
      </Group>
    </>
  );
}

function VoiceLanguagePicker() {
  const { settings } = useAppState();
  const actions = useActions();
  return (
    <Segmented<VoiceLanguage>
      label="Assistant language"
      value={settings.voiceLanguage}
      onChange={(v) => actions.settings.patch({ voiceLanguage: v })}
      options={[{ value: 'en', label: 'English' }, { value: 'hi', label: 'हिन्दी' }, { value: 'hinglish', label: 'Hinglish' }]}
    />
  );
}

const COMMAND_IDEAS = ['AC 21 pe kar do', 'Ghar le chalo', 'Office le chalo', 'Focus music chalao', 'Romantic gaane chalao', 'Fan speed badhao', 'Gaane band karo', 'Show navigation', 'AC 22 pe kar do and play focus'];

function VoiceSection() {
  const { settings } = useAppState();
  const actions = useActions();
  const assistant = useAssistant();
  const set = actions.settings.patch;
  const [phrase, setPhrase] = useState('');
  const [command, setCommand] = useState(COMMAND_IDEAS[0]);
  const [error, setError] = useState<string | null>(null);

  const teach = () => {
    const p = phrase.trim();
    if (p.length < 3) return setError('Use a phrase of at least 3 characters.');
    if (parseIntents(command).every((i) => i.type === 'unknown')) return setError('Myra doesn’t understand that command yet — try one of the suggestions.');
    if (settings.customCommands.some((c) => c.phrase === p.toLowerCase())) return setError('That phrase is already taught.');
    actions.settings.addCustomCommand(p, command);
    actions.ui.toast(`Myra learned “${p}”`, 'success');
    setPhrase('');
    setError(null);
  };

  const testVoice = () => {
    const lang = settings.voiceLanguage;
    const line = lang === 'hi' ? 'नमस्ते! मैं मायरा हूँ।' : lang === 'hinglish' ? 'Namaste! Main Myra hoon, aapki car companion.' : 'Hello! I’m Myra, your car companion.';
    const ok = speak(line, lang === 'hi' ? 'hi-IN' : 'en-IN', settings.voiceRate);
    if (!ok) actions.ui.toast('Speech output isn’t available in this browser', 'warning');
    else if (lang === 'hi' && !hasVoiceFor('hi-IN')) actions.ui.toast('No Hindi voice installed — the browser may use a fallback voice', 'warning');
  };

  return (
    <>
      <Group
        title="Myra voice assistant"
        note={`Voice input: ${recognitionSupported() ? 'supported in this browser' : 'not supported here — typing is available'}. Spoken replies: ${synthesisSupported() ? 'supported' : 'not supported'}. Server engines (BhashaDrive) are used when the backend is reachable; otherwise speech is processed by your browser and commands are interpreted locally.`}
      >
        <VoiceEngineSettings />
        <Setting label="Speech language" hint="Recognition uses en-IN for English/Hinglish and hi-IN for Hindi">
          <VoiceLanguagePicker />
        </Setting>
        <Setting label="Spoken responses" hint="Voice feedback after each request">
          <Toggle checked={settings.speakResponses} onChange={(v) => set({ speakResponses: v })} label="Spoken responses" />
        </Setting>
        <Setting label="Response speed">
          <div className="w-56 flex items-center gap-3">
            <Slider value={settings.voiceRate} min={0.8} max={1.3} step={0.05} onChange={(v) => set({ voiceRate: v })} label="Voice speed" valueText={`${settings.voiceRate.toFixed(2)}×`} />
            <span className="w-12 text-sm text-ink tabular-nums">{settings.voiceRate.toFixed(2)}×</span>
          </div>
          <button type="button" className="btn" onClick={testVoice}>Test</button>
        </Setting>
        <Setting label="Confirm climate suggestions" hint="“Garmi lag rahi hai” asks before changing the AC">
          <Toggle checked={settings.confirmClimate} onChange={(v) => set({ confirmClimate: v })} label="Confirm climate suggestions" />
        </Setting>
        <Setting label="Show example commands" hint="Suggestion chips when the assistant opens">
          <Toggle checked={settings.showVoiceChips} onChange={(v) => set({ showVoiceChips: v })} label="Show example commands" />
        </Setting>
      </Group>

      <Group title="Teach Voice · custom commands" note="Taught phrases are stored on this device and matched locally before Myra’s built-in understanding.">
        {settings.customCommands.map((c) => (
          <Setting key={c.id} label={`“${c.phrase}”`} hint={`Runs: ${c.command}`}>
            <button type="button" className="btn !min-h-10" onClick={() => assistant.submit(c.phrase)}>Try</button>
            <button type="button" className="icon-btn !size-10" onClick={() => actions.settings.removeCustomCommand(c.id)} aria-label={`Forget “${c.phrase}”`}>
              <Trash size={16} />
            </button>
          </Setting>
        ))}
        <form
          className="py-4 grid grid-cols-[1fr_1fr_auto] gap-3 items-start"
          onSubmit={(e) => {
            e.preventDefault();
            teach();
          }}
        >
          <div>
            <label htmlFor="teach-phrase" className="text-xs text-ink-2 mb-1 block">When I say…</label>
            <input id="teach-phrase" className="input" placeholder="e.g. office mode" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label htmlFor="teach-command" className="text-xs text-ink-2 mb-1 block">Myra should…</label>
            <input id="teach-command" className="input" list="command-ideas" value={command} onChange={(e) => setCommand(e.target.value)} autoComplete="off" />
            <datalist id="command-ideas">
              {COMMAND_IDEAS.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <button type="submit" className="btn btn-primary mt-5">
            <Plus size={18} aria-hidden /> Teach
          </button>
          {error && <p className="col-span-3 text-sm text-warn" role="alert">{error}</p>}
        </form>
      </Group>
    </>
  );
}

function AccessibilitySection() {
  const { settings } = useAppState();
  const set = useActions().settings.patch;
  return (
    <Group title="Accessibility" note="MYRA also follows your system’s reduced-motion preference automatically.">
      <Setting label="Large text" hint="Increases text size across MYRA">
        <Toggle checked={settings.largeText} onChange={(v) => set({ largeText: v })} label="Large text" />
      </Setting>
      <Setting label="High contrast" hint="Stronger borders and secondary text">
        <Toggle checked={settings.highContrast} onChange={(v) => set({ highContrast: v })} label="High contrast" />
      </Setting>
      <Setting label="Reduce motion" hint="Minimises animation and transitions">
        <Toggle checked={settings.reduceMotion} onChange={(v) => set({ reduceMotion: v })} label="Reduce motion" />
      </Setting>
      <Setting label="Voice feedback" hint="Myra reads responses aloud">
        <Toggle checked={settings.speakResponses} onChange={(v) => set({ speakResponses: v })} label="Voice feedback" />
      </Setting>
    </Group>
  );
}

function ConnectivitySection() {
  const { settings, phone } = useAppState();
  const actions = useActions();
  return (
    <Group title="Connectivity" note="Connectivity states are simulated for this prototype.">
      <Setting label="Bluetooth" hint={phone.deviceConnected ? `Connected to ${phone.deviceName}` : 'No device connected'}>
        <Toggle checked={phone.bluetooth} onChange={actions.phone.setBluetooth} label="Bluetooth" />
      </Setting>
      <Setting label="Auto-connect last phone">
        <Toggle checked={settings.autoConnectPhone} onChange={(v) => actions.settings.patch({ autoConnectPhone: v })} label="Auto-connect last phone" />
      </Setting>
      <Setting label="Wi-Fi" hint="Used for connected services (demo)">
        <Toggle checked={settings.wifi} onChange={(v) => actions.settings.patch({ wifi: v })} label="Wi-Fi" />
      </Setting>
      <OfflineVoiceSetting />
      <Setting label="Phone projection" hint="Android Auto / Apple CarPlay demonstration states">
        <button type="button" className="btn" onClick={() => actions.ui.go('phone')}>
          <MonitorSmartphone size={16} aria-hidden /> Open Phone
        </button>
      </Setting>
    </Group>
  );
}

function AudioSection() {
  const { settings } = useAppState();
  const set = useActions().settings.patch;
  const eq: [keyof typeof settings & ('bass' | 'mid' | 'treble' | 'balance' | 'fader'), string, string?][] = [
    ['bass', 'Bass'],
    ['mid', 'Mid'],
    ['treble', 'Treble'],
    ['balance', 'Balance', 'Left ↔ Right'],
    ['fader', 'Fader', 'Rear ↔ Front'],
  ];
  return (
    <Group title="Audio" note="Sound settings are simulated — MYRA does not output audio in this prototype.">
      {eq.map(([key, label, hint]) => (
        <Setting key={key} label={label} hint={hint}>
          <div className="w-72 flex items-center gap-3">
            <Slider value={settings[key]} min={-5} max={5} onChange={(v) => set({ [key]: v })} label={label} />
            <span className="w-8 text-sm text-ink tabular-nums text-right">{settings[key] > 0 ? `+${settings[key]}` : settings[key]}</span>
          </div>
        </Setting>
      ))}
      <Setting label="Speed-dependent volume">
        <Toggle checked={settings.speedVolume} onChange={(v) => set({ speedVolume: v })} label="Speed-dependent volume" />
      </Setting>
      <Setting label="Touch sounds">
        <Toggle checked={settings.touchBeep} onChange={(v) => set({ touchBeep: v })} label="Touch sounds" />
      </Setting>
    </Group>
  );
}

function AboutSection() {
  const actions = useActions();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <section className="card p-6 mb-4">
        <p className="text-2xl font-semibold tracking-[0.3em] text-ink">MYRA</p>
        <p className="text-ink-2 mt-1">Intelligent Mobility. Naturally Connected.</p>
        <p className="text-sm text-ink-3 mt-3">Smart infotainment prototype for the Hyundai Verna · v1.0 · Hyundai COE Mobility Innovation Ideathon concept</p>
      </section>
      <Group title="What is real and what is simulated">
        <Setting label="Real in this prototype" hint="Interface, shared state, local voice understanding, browser speech recognition & synthesis (where supported), saved preferences">
          <span className="tag tag-ok">Functional</span>
        </Setting>
        <Setting label="Simulated" hint="Vehicle data, maps & routes, weather, media playback, calls, phone projection, FASTag, emergency, connected services">
          <span className="tag tag-demo">Demo</span>
        </Setting>
      </Group>
      <Group title="Reset">
        <Setting label="Restore defaults" hint="Clears saved profiles, preferences and taught commands on this device">
          {confirm ? (
            <>
              <button type="button" className="btn" onClick={() => setConfirm(false)}>Cancel</button>
              <button type="button" className="btn btn-danger" onClick={() => { actions.settings.resetAll(); setConfirm(false); }}>
                <RotateCcw size={16} aria-hidden /> Confirm reset
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => setConfirm(true)}>
              <RotateCcw size={16} aria-hidden /> Reset…
            </button>
          )}
        </Setting>
      </Group>
    </>
  );
}
