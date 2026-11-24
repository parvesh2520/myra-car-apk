import { useEffect, useState } from 'react';
import { Mic, Trash } from 'lucide-react';
import { useActions } from '../../context/AppStore';
import { useAssistant } from '../../context/AssistantContext';
import { api, ApiError, micErrorMessage, recordAudio, recordingSupported } from '../../services/api';
import { Segmented } from '../../components/controls/Segmented';
import { Toggle } from '../../components/controls/Toggle';
import { Setting } from './SettingsLayout';

/** Which BhashaDrive engines answer Myra, and the development Free/Premium switch (server-gated). */
export function VoiceEngineSettings() {
  const { backend, refreshBackend } = useAssistant();
  const toast = useActions().ui.toast;
  const ent = backend.entitlement;

  const setTier = async (tier: 'free' | 'premium') => {
    try {
      await api.setDevTier(tier);
    } catch (e) {
      toast(e instanceof ApiError && e.message ? e.message : 'The server refused the tier switch', 'warning');
    }
    await refreshBackend();
  };

  return (
    <>
      <Setting
        label="Voice engine"
        hint={!backend.online
          ? 'BhashaDrive backend not reachable — using browser speech and local understanding'
          : backend.premium
            ? `Premium cloud: ${ent?.asr_model} speech · ${ent?.llm_model}`
            : `On-device: ${backend.asrEngine ?? 'no speech model loaded'} · NLU ${backend.nlu ?? '—'}`}
      >
        <span className={`chip ${backend.online ? 'is-active' : ''}`}>{backend.online ? (backend.premium ? 'Premium' : 'Free') : 'Offline'}</span>
        <button type="button" className="btn" onClick={() => void refreshBackend()}>Check</button>
      </Setting>
      {backend.online && ent?.dev_tier_switch && (
        <Setting
          label="Voice tier (development)"
          hint={ent.tier === 'premium' && ent.problems.length ? `Premium is not configured on the server: ${ent.problems.join(', ')}` : 'Switches the local server between on-device and cloud voice'}
        >
          <Segmented<'free' | 'premium'>
            label="Voice tier"
            value={ent.tier}
            onChange={(v) => void setTier(v)}
            options={[{ value: 'free', label: 'Free' }, { value: 'premium', label: 'Premium' }]}
          />
        </Setting>
      )}
    </>
  );
}

/** Simulated tunnel/no-signal mode: the backend's hybrid recogniser uses only its on-device model. */
export function OfflineVoiceSetting() {
  const { backend } = useAssistant();
  const [offline, setOffline] = useState<boolean | null>(null);
  const toast = useActions().ui.toast;

  useEffect(() => {
    if (backend.online) api.connectivity().then((c) => setOffline(!!c.is_offline)).catch(() => setOffline(null));
  }, [backend.online]);

  if (!backend.online || offline === null) return null;
  return (
    <Setting label="Offline voice mode" hint="Speech recognition stays on the vehicle — no cloud speech services">
      <Toggle
        checked={offline}
        onChange={(v) =>
          api.setOffline(v)
            .then((c) => setOffline(!!c.is_offline))
            .catch(() => toast('Couldn’t change the voice mode on the server', 'warning'))}
        label="Offline voice mode"
      />
    </Setting>
  );
}

/** Driver recognition by voice (CAM++ speaker embeddings on the backend; only the embedding is kept). */
export function VoiceIdSetting({ profileId, name }: { profileId: string; name: string }) {
  const { backend } = useAssistant();
  const toast = useActions().ui.toast;
  const [ready, setReady] = useState(false);
  const [samples, setSamples] = useState(0);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!backend.online) return;
    api.speakers().then((s) => {
      setReady(s.ready);
      setSamples(s.enrolled[profileId] ?? 0);
    }).catch(() => setReady(false));
  }, [backend.online, profileId]);

  if (!backend.online || !recordingSupported()) return null;

  const enroll = async () => {
    let audio: Blob;
    setRecording(true);
    try {
      audio = await (await recordAudio(6000, 1200)).done;
    } catch (e) {
      setRecording(false);
      return toast(micErrorMessage(e), 'warning');
    }
    setRecording(false);
    try {
      const r = await api.enroll(profileId, audio);
      setSamples(r.samples);
      toast(`Voice sample ${r.samples} saved for ${name}`, 'success');
    } catch (e) {
      toast(e instanceof ApiError && e.message ? e.message : 'Couldn’t save the voice sample', 'warning');
    }
  };

  const forget = async () => {
    await api.forget(profileId).catch(() => undefined);
    setSamples(0);
  };

  return (
    <Setting
      label="Voice ID"
      hint={!ready ? 'Speaker model not installed on the server' : samples ? `${samples} sample${samples > 1 ? 's' : ''} — Myra switches to ${name} when it recognises this voice` : 'Say one sentence per sample; 3 samples recommended'}
    >
      {samples > 0 && (
        <button type="button" className="icon-btn !size-10" onClick={() => void forget()} aria-label={`Forget ${name}’s voice`}>
          <Trash size={16} />
        </button>
      )}
      <button type="button" className="btn" disabled={!ready || recording} onClick={() => void enroll()}>
        <Mic size={16} aria-hidden /> {recording ? 'Listening…' : 'Add sample'}
      </button>
    </Setting>
  );
}
