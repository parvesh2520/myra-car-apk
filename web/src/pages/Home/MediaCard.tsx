import { Heart, Minus, Pause, Play, Plus, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { useT } from '../../hooks/useT';
import { playlistById, RADIO_STATIONS } from '../../data/media';
import { formatDuration } from '../../services/format';
import { AlbumArt } from '../../components/cards/AlbumArt';

const SOURCE_LABEL = { bluetooth: 'Bluetooth', usb: 'USB', radio: 'FM Radio', podcasts: 'Podcasts' } as const;

export function MediaCard({ large = false }: { large?: boolean }) {
  const { media } = useAppState();
  const actions = useActions();
  const t = useT();
  const pl = playlistById(media.playlistId);
  const track = pl.tracks[media.trackIndex];
  const radio = media.source === 'radio';
  const station = RADIO_STATIONS.find((s) => s.id === media.radioStationId) ?? RADIO_STATIONS[0];
  const title = radio ? station.name : track.title;
  const subtitle = radio ? station.genre : track.artist;
  const pct = radio ? 0 : (media.position / track.duration) * 100;
  const fav = !radio && media.favourites.includes(track.id);

  return (
    <section className="card p-4 flex flex-col gap-3 min-h-0" aria-label={t('media')}>
      <header className="flex items-center justify-between">
        <button type="button" className="label hover:text-ink-2" onClick={() => actions.ui.go('media')}>
          {t('nowPlaying')} · {SOURCE_LABEL[media.source]}
        </button>
        {!radio && (
          <button
            type="button"
            onClick={() => actions.media.toggleFavourite(track.id)}
            aria-pressed={fav}
            aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}
            className={`grid place-items-center size-9 rounded-full ${fav ? 'text-[#ff6b8b]' : 'text-ink-3 hover:text-ink'}`}
          >
            <Heart size={18} fill={fav ? 'currentColor' : 'none'} />
          </button>
        )}
      </header>

      <button type="button" onClick={() => actions.ui.go('media')} className="flex items-center gap-4 text-left min-w-0" aria-label="Open media">
        <AlbumArt
          colours={radio ? ['#4d9eff', '#132a4a'] : track.art}
          size={large ? 104 : 84}
          kind={radio ? 'radio' : media.source === 'podcasts' ? 'podcast' : 'music'}
          label={title}
          spinning={media.playing}
        />
        <div className="min-w-0">
          <p className={`${large ? 'text-2xl' : 'text-lg'} font-semibold text-ink truncate`}>{title}</p>
          <p className="text-sm text-ink-2 truncate">{subtitle}</p>
          <p className="text-xs text-ink-3 mt-1 truncate">{radio ? `${station.frequency} MHz · Demo` : `${pl.name} · Simulated playback`}</p>
        </div>
      </button>

      {!radio && (
        <div className="flex items-center gap-2 text-[0.6875rem] text-ink-3 tabular-nums">
          <span>{formatDuration(media.position)}</span>
          <div className="flex-1 h-1 rounded-full bg-surface-3 overflow-hidden" role="progressbar" aria-label="Track progress" aria-valuemin={0} aria-valuemax={track.duration} aria-valuenow={media.position}>
            <div className="h-full bg-accent rounded-full transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
          </div>
          <span>{formatDuration(track.duration)}</span>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button type="button" className="icon-btn" onClick={actions.media.prev} disabled={radio} aria-label="Previous track">
            <SkipBack size={20} fill="currentColor" />
          </button>
          <button
            type="button"
            onClick={actions.media.toggle}
            className={`grid place-items-center rounded-full bg-accent text-on-accent transition-transform active:scale-95 ${large ? 'size-16' : 'size-14'}`}
            aria-label={media.playing ? 'Pause' : 'Play'}
          >
            {media.playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="translate-x-px" />}
          </button>
          <button type="button" className="icon-btn" onClick={actions.media.next} disabled={radio} aria-label="Next track">
            <SkipForward size={20} fill="currentColor" />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className="icon-btn !size-11" onClick={() => actions.media.adjustVolume(-2)} aria-label="Volume down">
            <Minus size={18} />
          </button>
          <button
            type="button"
            onClick={actions.media.toggleMute}
            className="flex items-center gap-1 w-14 justify-center text-sm font-semibold text-ink tabular-nums"
            aria-label={media.muted ? 'Unmute' : `Volume ${media.volume}. Mute`}
          >
            {media.muted ? <VolumeX size={16} className="text-warn" /> : <Volume2 size={16} className="text-ink-3" />}
            {media.muted ? '–' : media.volume}
          </button>
          <button type="button" className="icon-btn !size-11" onClick={() => actions.media.adjustVolume(2)} aria-label="Volume up">
            <Plus size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}
