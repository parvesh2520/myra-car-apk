import { useState } from 'react';
import {
  Bluetooth, Heart, ListMusic, MicVocal, Pause, Play, Radio, Repeat, Shuffle, SkipBack, SkipForward, Usb, Volume1, Volume2, VolumeX, RotateCcwClock, Info,
} from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { VOLUME_MAX } from '../../context/actions';
import { useT } from '../../hooks/useT';
import { MUSIC_PLAYLISTS, playlistById, playlistOfTrack, RADIO_STATIONS, trackById } from '../../data/media';
import { formatDuration } from '../../services/format';
import { AlbumArt } from '../../components/cards/AlbumArt';
import { Slider } from '../../components/controls/Slider';
import { Segmented } from '../../components/controls/Segmented';
import { DrivingNotice } from '../../components/cards/DrivingNotice';
import type { AudioSource, Track } from '../../types';

type Tab = 'playlists' | 'queue' | 'favourites' | 'recent';

export function MediaPage() {
  const { media, driveMode, settings } = useAppState();
  const actions = useActions();
  const t = useT();
  const driving = driveMode === 'driving';
  const [tab, setTab] = useState<Tab>('playlists');

  const pl = playlistById(media.playlistId);
  const track = pl.tracks[media.trackIndex];
  const radio = media.source === 'radio';
  const station = RADIO_STATIONS.find((s) => s.id === media.radioStationId) ?? RADIO_STATIONS[0];
  const fav = !radio && media.favourites.includes(track.id);
  const tabs: [Tab, string][] = driving
    ? [['playlists', t('playlists')], ['favourites', t('favourites')]]
    : [['playlists', t('playlists')], ['queue', 'Up next'], ['favourites', t('favourites')], ['recent', t('recentlyPlayed')]];
  const activeTab = tabs.some(([id]) => id === tab) ? tab : 'playlists';

  const playTrack = (tr: Track) => {
    const owner = playlistOfTrack(tr.id);
    if (owner) actions.media.playPlaylist(owner.id, owner.tracks.findIndex((x) => x.id === tr.id));
  };

  return (
    <div className="h-full p-5 grid grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)] gap-4">
      {/* Now playing */}
      <section className="card p-6 flex flex-col min-h-0 overflow-hidden" aria-label={t('nowPlaying')}>
        <div
          className="pointer-events-none absolute inset-0 opacity-40 rounded-[20px]"
          style={{ background: `radial-gradient(600px 300px at 20% 0%, ${radio ? '#4d9eff' : track.art[0]}33, transparent 70%)` }}
          aria-hidden
        />
        <div className="relative flex items-center gap-6">
          <AlbumArt
            colours={radio ? ['#4d9eff', '#132a4a'] : track.art}
            size={196}
            kind={radio ? 'radio' : media.source === 'podcasts' ? 'podcast' : 'music'}
            label={radio ? station.name : track.title}
            spinning={media.playing}
          />
          <div className="min-w-0 flex-1">
            <p className="label">{radio ? 'FM Radio · Demo' : `${pl.name} · ${media.source === 'usb' ? 'USB' : media.source === 'podcasts' ? 'Podcast' : 'Bluetooth'}`}</p>
            <h1 className="mt-2 text-[2rem] font-semibold leading-tight text-ink tracking-tight line-clamp-2">{radio ? station.name : track.title}</h1>
            <p className="text-lg text-ink-2 mt-1 truncate">{radio ? `${station.frequency} MHz · ${station.genre}` : track.artist}</p>
            {!radio && <p className="text-sm text-ink-3 mt-1 truncate">{track.album}</p>}
            {!radio && (
              <button
                type="button"
                onClick={() => actions.media.toggleFavourite(track.id)}
                aria-pressed={fav}
                className={`chip mt-4 ${fav ? '!text-[#ff6b8b] !border-[#ff6b8b]/40 !bg-[#ff6b8b]/10' : ''}`}
              >
                <Heart size={15} fill={fav ? 'currentColor' : 'none'} aria-hidden /> {fav ? 'In favourites' : 'Add to favourites'}
              </button>
            )}
          </div>
        </div>

        <div className="relative mt-auto pt-6 flex flex-col gap-4">
          {!radio ? (
            <div>
              <Slider
                value={media.position}
                min={0}
                max={track.duration}
                onChange={actions.media.seek}
                label="Seek"
                valueText={`${formatDuration(media.position)} of ${formatDuration(track.duration)}`}
              />
              <div className="flex justify-between text-xs text-ink-3 tabular-nums -mt-1">
                <span>{formatDuration(media.position)}</span>
                <span>-{formatDuration(track.duration - media.position)}</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-ink-2">
              <span className={`size-2 rounded-full ${media.playing ? 'bg-ok animate-pulse' : 'bg-ink-3'}`} aria-hidden />
              {media.playing ? 'Live (simulated)' : 'Paused'}
            </div>
          )}

          <div className="flex items-center justify-center gap-4">
            <button type="button" className={`icon-btn !rounded-full ${media.shuffle ? '!text-accent !bg-accent-soft' : ''}`} onClick={actions.media.toggleShuffle} aria-pressed={media.shuffle} aria-label="Shuffle" disabled={radio}>
              <Shuffle size={20} />
            </button>
            <button type="button" className="icon-btn !rounded-full !size-14" onClick={actions.media.prev} aria-label="Previous" disabled={radio}>
              <SkipBack size={24} fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={actions.media.toggle}
              className="grid place-items-center size-20 rounded-full bg-accent text-on-accent shadow-[0_10px_30px_-8px_var(--color-accent)] transition-transform active:scale-95"
              aria-label={media.playing ? 'Pause' : 'Play'}
            >
              {media.playing ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="translate-x-0.5" />}
            </button>
            <button type="button" className="icon-btn !rounded-full !size-14" onClick={actions.media.next} aria-label="Next" disabled={radio}>
              <SkipForward size={24} fill="currentColor" />
            </button>
            <button type="button" className={`icon-btn !rounded-full ${media.repeat ? '!text-accent !bg-accent-soft' : ''}`} onClick={actions.media.toggleRepeat} aria-pressed={media.repeat} aria-label="Repeat track" disabled={radio}>
              <Repeat size={20} />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button type="button" onClick={actions.media.toggleMute} className="icon-btn !size-11" aria-pressed={media.muted} aria-label={media.muted ? 'Unmute' : 'Mute'}>
              {media.muted ? <VolumeX size={18} className="text-warn" /> : media.volume < 12 ? <Volume1 size={18} /> : <Volume2 size={18} />}
            </button>
            <Slider value={media.muted ? 0 : media.volume} min={0} max={VOLUME_MAX} onChange={actions.media.setVolume} label="Volume" valueText={`${media.volume} of ${VOLUME_MAX}`} />
            <span className="w-8 text-right text-sm font-semibold text-ink tabular-nums">{media.muted ? '–' : media.volume}</span>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-ink-3">
            <Info size={12} aria-hidden /> Simulated playback — track timing is emulated and no audio is streamed.
          </p>
        </div>
      </section>

      {/* Library */}
      <section className="card p-4 flex flex-col gap-3 min-h-0" aria-label="Library">
        <div className="flex items-center justify-between gap-3">
          <Segmented<AudioSource>
            label={t('sources')}
            value={media.source}
            onChange={actions.media.setSource}
            options={[
              { value: 'bluetooth', label: <><Bluetooth size={15} aria-hidden /> Bluetooth</> },
              { value: 'usb', label: <><Usb size={15} aria-hidden /> USB</> },
              { value: 'radio', label: <><Radio size={15} aria-hidden /> Radio</> },
              { value: 'podcasts', label: <><MicVocal size={15} aria-hidden /> Podcasts</>, disabled: driving },
            ]}
          />
          <span className="text-xs text-ink-3">Demo sources</span>
        </div>

        {media.source === 'radio' ? (
          <div className="grid grid-cols-2 gap-3 scroll-y min-h-0">
            {RADIO_STATIONS.map((s) => {
              const on = s.id === media.radioStationId;
              return (
                <button key={s.id} type="button" onClick={() => actions.media.playRadio(s.id)} className={`tile p-4 ${on ? 'is-active' : ''}`} aria-pressed={on}>
                  <p className="text-[1.75rem] font-light text-ink tabular-nums leading-none">{s.frequency}</p>
                  <p className="text-sm font-medium text-ink mt-2">{s.name}</p>
                  <p className="text-xs text-ink-2">{s.genre}</p>
                </button>
              );
            })}
          </div>
        ) : media.source === 'podcasts' ? (
          driving ? (
            <DrivingNotice compact />
          ) : (
            <div className="flex flex-col gap-2 scroll-y min-h-0">
              {playlistById('podcasts').tracks.map((ep, i) => (
                <TrackRow key={ep.id} track={ep} active={media.playlistId === 'podcasts' && media.trackIndex === i} playing={media.playing} onPlay={() => actions.media.playPlaylist('podcasts', i)} kind="podcast" />
              ))}
            </div>
          )
        ) : (
          <>
            <div role="tablist" aria-label="Library sections" className="flex gap-2">
              {tabs.map(([id, label]) => (
                <button key={id} role="tab" type="button" aria-selected={activeTab === id} className="chip" onClick={() => setTab(id)}>
                  {id === 'recent' && <RotateCcwClock size={14} aria-hidden />}
                  {id === 'favourites' && <Heart size={14} aria-hidden />}
                  {id === 'queue' && <ListMusic size={14} aria-hidden />}
                  {label}
                </button>
              ))}
            </div>
            <div role="tabpanel" className="scroll-y min-h-0 flex-1">
              {activeTab === 'playlists' && (
                <div className="grid grid-cols-3 gap-3">
                  {MUSIC_PLAYLISTS.map((p) => {
                    const on = p.id === media.playlistId;
                    return (
                      <button key={p.id} type="button" onClick={() => actions.media.playPlaylist(p.id)} className={`tile p-3 flex flex-col gap-3 ${on ? 'is-active' : ''}`} aria-pressed={on}>
                        <AlbumArt colours={p.art} size={88} label={p.name} />
                        <span>
                          <span className="block font-semibold text-ink">{settings.uiLanguage === 'hi' ? p.nameHi : p.name}</span>
                          <span className="block text-xs text-ink-2 line-clamp-1">{on && media.playing ? 'Playing now' : p.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {activeTab === 'queue' && (
                <div className="flex flex-col gap-1.5">
                  {pl.tracks.map((tr, i) => (
                    <TrackRow key={tr.id} track={tr} active={i === media.trackIndex} playing={media.playing} onPlay={() => actions.media.playPlaylist(pl.id, i)} />
                  ))}
                </div>
              )}
              {activeTab === 'favourites' && (
                <TrackList ids={media.favourites} empty="Tap the heart on any track to save it here." onPlay={playTrack} activeId={track.id} playing={media.playing} />
              )}
              {activeTab === 'recent' && <TrackList ids={media.recent} empty="Nothing played yet." onPlay={playTrack} activeId={track.id} playing={media.playing} />}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function TrackList({ ids, empty, onPlay, activeId, playing }: { ids: string[]; empty: string; onPlay: (t: Track) => void; activeId: string; playing: boolean }) {
  const tracks = ids.map(trackById).filter((t): t is Track => !!t);
  if (!tracks.length) return <p className="p-4 text-sm text-ink-2">{empty}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {tracks.map((tr) => (
        <TrackRow key={tr.id} track={tr} active={tr.id === activeId} playing={playing} onPlay={() => onPlay(tr)} />
      ))}
    </div>
  );
}

function TrackRow({ track, active, playing, onPlay, kind = 'music' }: { track: Track; active: boolean; playing: boolean; onPlay: () => void; kind?: 'music' | 'podcast' }) {
  return (
    <button type="button" onClick={onPlay} className={`tile flex items-center gap-3 p-2.5 pr-4 ${active ? 'is-active' : ''}`} aria-current={active ? 'true' : undefined}>
      <AlbumArt colours={track.art} size={48} kind={kind} label={track.title} />
      <span className="flex-1 min-w-0">
        <span className={`block font-medium truncate ${active ? 'text-accent' : 'text-ink'}`}>{track.title}</span>
        <span className="block text-xs text-ink-2 truncate">{track.artist}</span>
      </span>
      {active && playing ? (
        <span className="flex items-end gap-[3px] h-4 w-5" aria-label="Playing">
          {[0, 1, 2].map((i) => (
            <span key={i} className="w-1 bg-accent rounded-sm" style={{ animation: `eq 0.9s ${i * 0.15}s ease-in-out infinite` }} />
          ))}
        </span>
      ) : (
        <span className="text-xs text-ink-3 tabular-nums">{formatDuration(track.duration)}</span>
      )}
    </button>
  );
}
