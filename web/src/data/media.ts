import type { Playlist, PlaylistId, RadioStation, Track } from '../types';

/**
 * Sample catalogue with fictional tracks and artists. Playback is simulated in the
 * frontend — no audio is streamed or played.
 */
const t = (
  id: string,
  title: string,
  artist: string,
  album: string,
  duration: number,
  art: [string, string],
): Track => ({ id, title, artist, album, duration, art });

export const PLAYLISTS: Playlist[] = [
  {
    id: 'hiphop',
    name: 'Hip-Hop',
    nameHi: 'हिप-हॉप',
    description: 'Desi beats and heavy bass',
    art: ['#f0a23a', '#5b2a86'],
    tracks: [
      t('hh1', 'Gully Signal', 'MC Raahi', 'Concrete Verses', 204, ['#f0a23a', '#5b2a86']),
      t('hh2', 'Night Shift', 'Kavya K', 'Neon Bazaar', 188, ['#ff7a59', '#2b2d6e']),
      t('hh3', 'Seedha Baat', 'Dhruv & The Block', 'Seedha Baat', 221, ['#ffd166', '#3a0ca3']),
      t('hh4', 'Metro Flow', 'Arjun Vee', 'Line 2', 176, ['#ef476f', '#1b263b']),
    ],
  },
  {
    id: 'romantic',
    name: 'Romantic',
    nameHi: 'रोमांटिक',
    description: 'Soft melodies for the long drive',
    art: ['#ff6b8b', '#3d1a4f'],
    tracks: [
      t('ro1', 'Tum Saath Ho Na', 'Ananya Rao', 'Monsoon Letters', 236, ['#ff6b8b', '#3d1a4f']),
      t('ro2', 'Baarish Ke Baad', 'Ishaan Mehra', 'Monsoon Letters', 252, ['#f9a8d4', '#43305e']),
      t('ro3', 'Saahil', 'Meher & Kabir', 'Coastline', 214, ['#fca5a5', '#1e3a5f']),
      t('ro4', 'Dil Ki Raah', 'Ananya Rao', 'Coastline', 243, ['#fbcfe8', '#6b2147']),
    ],
  },
  {
    id: 'bollywood',
    name: 'Bollywood',
    nameHi: 'बॉलीवुड',
    description: 'Big choruses, bigger energy',
    art: ['#ffb703', '#d62828'],
    tracks: [
      t('bw1', 'Nachle Aaj', 'Riya Kapoor', 'Shaadi Season', 198, ['#ffb703', '#d62828']),
      t('bw2', 'Dilli Se Mumbai', 'Vikram S.', 'Highway Hits', 226, ['#fb8500', '#023047']),
      t('bw3', 'Chalo Chalein', 'Riya Kapoor', 'Highway Hits', 207, ['#ffd60a', '#9d0208']),
      t('bw4', 'Sitaare', 'Aman Joshi', 'Filmi Nights', 241, ['#f4a261', '#264653']),
    ],
  },
  {
    id: 'focus',
    name: 'Focus',
    nameHi: 'फोकस',
    description: 'Calm instrumentals for city traffic',
    art: ['#4d9eff', '#0b2545'],
    tracks: [
      t('fo1', 'Still Water', 'Lumen Field', 'Quiet Hours', 268, ['#4d9eff', '#0b2545']),
      t('fo2', 'Morning Ghats', 'Tara Veena', 'Ragas at Dawn', 302, ['#56c69b', '#0f2b3d']),
      t('fo3', 'Low Tide', 'Lumen Field', 'Quiet Hours', 245, ['#90e0ef', '#14213d']),
      t('fo4', 'Paper Lanterns', 'Nila', 'Drift', 233, ['#a5b4fc', '#1e1b4b']),
    ],
  },
  {
    id: 'english',
    name: 'English Hits',
    nameHi: 'इंग्लिश हिट्स',
    description: 'Global pop for the open road',
    art: ['#06d6a0', '#073b4c'],
    tracks: [
      t('en1', 'Golden Hour Drive', 'The Coastal Lights', 'Sunset Boulevard', 199, ['#06d6a0', '#073b4c']),
      t('en2', 'Satellites', 'Nova Reyes', 'Orbit', 213, ['#118ab2', '#1d1d3d']),
      t('en3', 'Paper Planes Home', 'June Avenue', 'Postcards', 187, ['#ffd166', '#264653']),
      t('en4', 'Run the Lights', 'Halcyon', 'City After Dark', 224, ['#ef476f', '#0b132b']),
    ],
  },
  {
    id: 'podcasts',
    name: 'Podcasts',
    nameHi: 'पॉडकास्ट',
    description: 'Talk shows for the commute',
    art: ['#e8b65e', '#1f2937'],
    tracks: [
      t('pc1', 'Ep. 42 — Cities that Move', 'Mobility Matters', 'Mobility Matters', 1840, ['#e8b65e', '#1f2937']),
      t('pc2', 'Ep. 18 — Chai & Startups', 'The Chai Table', 'The Chai Table', 2210, ['#f4a261', '#3b2f2f']),
      t('pc3', 'Ep. 7 — Monsoon Road Trips', 'Weekend Wheels', 'Weekend Wheels', 1520, ['#56c69b', '#14342b']),
    ],
  },
];

export const MUSIC_PLAYLISTS = PLAYLISTS.filter((p) => p.id !== 'podcasts');

export const RADIO_STATIONS: RadioStation[] = [
  { id: 'fm911', frequency: '91.1', name: 'FM 91.1', genre: 'Tamil & Hindi hits' },
  { id: 'fm935', frequency: '93.5', name: 'FM 93.5', genre: 'Talk & traffic' },
  { id: 'fm983', frequency: '98.3', name: 'FM 98.3', genre: 'Bollywood' },
  { id: 'fm1012', frequency: '101.2', name: 'FM 101.2', genre: 'Classical' },
  { id: 'fm1048', frequency: '104.8', name: 'FM 104.8', genre: 'English pop' },
];

export const playlistById = (id: PlaylistId): Playlist =>
  PLAYLISTS.find((p) => p.id === id) ?? PLAYLISTS[0];

export const ALL_TRACKS: Track[] = PLAYLISTS.flatMap((p) => p.tracks);

export const trackById = (id: string): Track | undefined => ALL_TRACKS.find((tr) => tr.id === id);

export const playlistOfTrack = (id: string): Playlist | undefined =>
  PLAYLISTS.find((p) => p.tracks.some((tr) => tr.id === id));
