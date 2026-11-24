import { useState } from 'react';
import { Check, Minus, Plus, Trash } from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { TEMP_MAX, TEMP_MIN } from '../../context/actions';
import { MUSIC_PLAYLISTS } from '../../data/media';
import { PLACES } from '../../data/places';
import { formatTemp, initials } from '../../services/format';
import { Segmented } from '../../components/controls/Segmented';
import { Group, Setting } from './SettingsLayout';
import { VoiceIdSetting } from './BackendSettings';
import type { PlaylistId, ThemePref, VoiceLanguage } from '../../types';

const DESTINATIONS = PLACES.filter((p) => !['fuel', 'parking'].includes(p.category) && p.id !== 'guindy');

export function ProfilesSection() {
  const state = useAppState();
  const actions = useActions();
  const [editingId, setEditingId] = useState(state.activeProfileId);
  const [newName, setNewName] = useState('');
  const profile = state.profiles.find((p) => p.id === editingId) ?? state.profiles[0];
  const update = (patch: Parameters<typeof actions.profiles.update>[1]) => actions.profiles.update(profile.id, patch);
  const isActive = profile.id === state.activeProfileId;

  return (
    <>
      <section className="card p-5 mb-4" aria-label="Profiles">
        <div className="flex items-center justify-between mb-3">
          <h2 className="label">Driver profiles</h2>
          <p className="text-xs text-ink-3">Selected manually, or by Voice ID when enrolled</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {state.profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setEditingId(p.id)}
              aria-pressed={p.id === profile.id}
              className={`tile flex items-center gap-3 p-3 pr-5 ${p.id === profile.id ? 'is-active' : ''}`}
            >
              <span className="grid place-items-center size-11 rounded-full font-bold text-[#06101d]" style={{ background: p.colour }}>
                {initials(p.name)}
              </span>
              <span>
                <span className="block font-semibold text-ink">{p.name}</span>
                <span className="block text-xs text-ink-2">{p.id === state.activeProfileId ? 'Active driver' : 'Tap to edit'}</span>
              </span>
            </button>
          ))}
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              actions.profiles.add(newName);
              setNewName('');
            }}
          >
            <label htmlFor="new-profile" className="sr-only">New profile name</label>
            <input id="new-profile" className="input !w-44" placeholder="New driver name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={20} autoComplete="off" />
            <button type="submit" className="icon-btn" disabled={!newName.trim()} aria-label="Add profile">
              <Plus size={20} />
            </button>
          </form>
        </div>
      </section>

      <Group title={`${profile.name}’s preferences`} note="Changes are saved on this device and applied when this profile is selected.">
        <Setting label="Name">
          <input
            className="input !w-60"
            value={profile.name}
            maxLength={20}
            onChange={(e) => update({ name: e.target.value })}
            onBlur={(e) => !e.target.value.trim() && update({ name: 'Driver' })}
            aria-label="Profile name"
          />
        </Setting>
        <Setting label="Preferred temperature">
          <button type="button" className="icon-btn !rounded-full" onClick={() => update({ preferredTemp: Math.max(TEMP_MIN, profile.preferredTemp - 0.5) })} aria-label="Lower preferred temperature">
            <Minus size={18} />
          </button>
          <span className="w-16 text-center text-xl font-semibold text-ink tabular-nums">{formatTemp(profile.preferredTemp, state.settings.tempUnit)}</span>
          <button type="button" className="icon-btn !rounded-full" onClick={() => update({ preferredTemp: Math.min(TEMP_MAX, profile.preferredTemp + 0.5) })} aria-label="Raise preferred temperature">
            <Plus size={18} />
          </button>
        </Setting>
        <Setting label="Preferred language">
          <Segmented<VoiceLanguage>
            label="Preferred language"
            value={profile.language}
            onChange={(v) => update({ language: v })}
            options={[{ value: 'en', label: 'English' }, { value: 'hi', label: 'हिन्दी' }, { value: 'hinglish', label: 'Hinglish' }]}
          />
        </Setting>
        <Setting label="Favourite music">
          <div className="flex flex-wrap gap-2 justify-end max-w-[480px]" role="radiogroup" aria-label="Favourite music">
            {MUSIC_PLAYLISTS.map((pl) => (
              <button key={pl.id} type="button" role="radio" aria-checked={profile.favouriteGenre === pl.id} className={`chip ${profile.favouriteGenre === pl.id ? 'is-active' : ''}`} onClick={() => update({ favouriteGenre: pl.id as PlaylistId })}>
                {pl.name}
              </button>
            ))}
          </div>
        </Setting>
        <Setting label="Home destination">
          <PlaceSelect value={profile.homeId} onChange={(v) => update({ homeId: v })} label="Home destination" />
        </Setting>
        <Setting label="Work destination">
          <PlaceSelect value={profile.workId} onChange={(v) => update({ workId: v })} label="Work destination" />
        </Setting>
        <Setting label="Display preference">
          <Segmented<ThemePref> label="Display preference" value={profile.theme} onChange={(v) => update({ theme: v })} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
        </Setting>
        <VoiceIdSetting profileId={profile.id} name={profile.name} />
        <Setting label={isActive ? 'This is the active driver' : 'Use this profile'}>
          {!isActive && (
            <button type="button" className="icon-btn" onClick={() => actions.profiles.remove(profile.id)} aria-label={`Delete ${profile.name}`}>
              <Trash size={18} />
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => actions.profiles.switchTo(profile.id)}>
            <Check size={18} aria-hidden /> {isActive ? 'Re-apply preferences' : `Switch to ${profile.name}`}
          </button>
        </Setting>
      </Group>
    </>
  );
}

function PlaceSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <select className="input !w-72 cursor-pointer" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">Not set</option>
      {DESTINATIONS.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} — {p.area}
        </option>
      ))}
    </select>
  );
}
