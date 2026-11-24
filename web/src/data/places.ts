import type { Place } from '../types';

/**
 * Sample Chennai locations placed on a stylised local map (1000 × 600 units).
 * Coordinates, distances and timings are illustrative — not GPS or live traffic.
 */
export const PLACES: Place[] = [
  { id: 'guindy', name: 'Guindy', area: 'Current location (demo)', category: 'business', x: 520, y: 330, aliases: ['current location', 'guindy'] },
  { id: 'home-besant', name: 'Besant Nagar', area: '3rd Avenue, Besant Nagar', category: 'home', x: 812, y: 392, aliases: ['besant nagar', 'elliots'] },
  { id: 'home-anna', name: 'Anna Nagar', area: '2nd Avenue, Anna Nagar', category: 'home', x: 470, y: 90, aliases: ['anna nagar'] },
  { id: 'work-tidel', name: 'Tidel Park', area: 'Rajiv Gandhi Salai, Taramani', category: 'work', x: 708, y: 452, aliases: ['tidel', 'tidel park', 'taramani'] },
  { id: 'work-guindy-ie', name: 'Guindy Industrial Estate', area: 'SIDCO, Guindy', category: 'work', x: 470, y: 372, aliases: ['industrial estate'] },
  { id: 'iitm', name: 'IIT Madras', area: 'Sardar Patel Road, Adyar', category: 'education', x: 622, y: 392, aliases: ['iit', 'iit madras', 'iitm', 'aai ai tee', 'आईआईटी'] },
  { id: 'airport', name: 'Chennai Airport', area: 'MAA · Meenambakkam', category: 'transport', x: 372, y: 506, aliases: ['airport', 'chennai airport', 'maa', 'एयरपोर्ट', 'airport le chalo'] },
  { id: 'marina', name: 'Marina Beach', area: 'Kamarajar Salai', category: 'leisure', x: 842, y: 168, aliases: ['marina', 'marina beach', 'beach', 'मरीना'] },
  { id: 'central', name: 'Chennai Central', area: 'Puratchi Thalaivar Dr. M.G.R. Station', category: 'transport', x: 760, y: 52, aliases: ['central', 'chennai central', 'railway station', 'station'] },
  { id: 'tnagar', name: 'T. Nagar', area: 'Pondy Bazaar', category: 'shopping', x: 590, y: 232, aliases: ['t nagar', 'tnagar', 'pondy bazaar'] },
  { id: 'phoenix', name: 'Phoenix MarketCity', area: 'Velachery Main Road', category: 'shopping', x: 610, y: 484, aliases: ['phoenix', 'phoenix mall', 'velachery mall', 'mall'] },
  { id: 'express-avenue', name: 'Express Avenue', area: 'Royapettah', category: 'shopping', x: 744, y: 150, aliases: ['express avenue', 'ea mall'] },
  { id: 'kapaleeshwarar', name: 'Kapaleeshwarar Temple', area: 'Mylapore', category: 'culture', x: 784, y: 252, aliases: ['kapaleeshwarar', 'mylapore', 'temple', 'mandir'] },
  { id: 'sholinganallur', name: 'Sholinganallur', area: 'OMR IT Corridor', category: 'business', x: 812, y: 584, aliases: ['sholinganallur', 'omr'] },
  { id: 'hyundai-plant', name: 'Hyundai Motor India', area: 'Irungattukottai, Sriperumbudur', category: 'business', x: 46, y: 300, aliases: ['hyundai', 'hyundai plant', 'sriperumbudur', 'factory'] },
  // Fuel stations (demo)
  { id: 'fuel-iocl', name: 'IndianOil — Guindy', area: 'GST Road · Open 24h', category: 'fuel', x: 488, y: 300, aliases: ['indian oil', 'iocl'], detail: 'Petrol · Diesel · Air' },
  { id: 'fuel-hp', name: 'HP — Velachery Road', area: 'Velachery Main Rd', category: 'fuel', x: 566, y: 438, aliases: ['hp petrol', 'hp pump'], detail: 'Petrol · Diesel · CNG' },
  { id: 'fuel-bpcl', name: 'Bharat Petroleum — Adyar', area: 'LB Road, Adyar', category: 'fuel', x: 742, y: 352, aliases: ['bharat petroleum', 'bpcl'], detail: 'Petrol · Diesel · Café' },
  { id: 'fuel-shell', name: 'Shell — OMR', area: 'Perungudi', category: 'fuel', x: 760, y: 520, aliases: ['shell'], detail: 'Petrol · EV fast charger' },
  // Parking (demo)
  { id: 'park-phoenix', name: 'Phoenix MarketCity P2', area: 'Velachery · Multi-level', category: 'parking', x: 624, y: 500, aliases: ['phoenix parking'], detail: '≈120 slots (demo)' },
  { id: 'park-ea', name: 'Express Avenue Parking', area: 'Royapettah · Basement', category: 'parking', x: 726, y: 166, aliases: ['ea parking'], detail: '≈80 slots (demo)' },
  { id: 'park-tnagar', name: 'T. Nagar Multi-level Parking', area: 'Thyagaraya Road', category: 'parking', x: 574, y: 248, aliases: ['tnagar parking'], detail: '≈45 slots (demo)' },
  { id: 'park-marina', name: 'Marina Beach Parking', area: 'Kamarajar Salai', category: 'parking', x: 826, y: 188, aliases: ['beach parking'], detail: '≈60 slots (demo)' },
];

export const placeById = (id: string | null | undefined): Place | undefined =>
  PLACES.find((p) => p.id === id);

export const searchablePlaces = PLACES.filter((p) => p.id !== 'guindy');

export function searchPlaces(query: string): Place[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return searchablePlaces
    .map((p) => {
      const hay = [p.name, p.area, ...p.aliases].map((s) => s.toLowerCase());
      const score = hay.some((h) => h.startsWith(q)) ? 2 : hay.some((h) => h.includes(q)) ? 1 : 0;
      return { p, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.p)
    .slice(0, 6);
}

/** Labelled roads drawn on the stylised map. */
export const MAP_ROADS: { id: string; name: string; d: string; major: boolean }[] = [
  { id: 'gst', name: 'GST Road', d: 'M300 600 L372 506 L470 372 L520 330 L590 232 L640 160 L700 60', major: true },
  { id: 'anna', name: 'Anna Salai', d: 'M520 330 L590 232 L660 180 L744 150 L790 90', major: true },
  { id: 'omr', name: 'Rajiv Gandhi Salai (OMR)', d: 'M708 452 L760 520 L812 584 L840 620', major: true },
  { id: 'sp', name: 'Sardar Patel Road', d: 'M520 330 L622 392 L708 420 L812 392', major: true },
  { id: 'velachery', name: 'Velachery Main Road', d: 'M520 330 L566 438 L610 484 L640 560', major: true },
  { id: 'ecr', name: 'East Coast Road', d: 'M812 392 L846 480 L880 600', major: false },
  { id: 'beach', name: 'Kamarajar Salai', d: 'M812 392 L800 300 L826 188 L842 120 L860 40', major: false },
  { id: 'inner-ring', name: 'Inner Ring Road', d: 'M470 90 L430 200 L470 372 L566 438 L708 452', major: false },
  { id: 'poonamallee', name: 'Poonamallee High Road', d: 'M46 300 L200 250 L330 190 L470 90 L620 70 L760 52', major: true },
  { id: 'lb', name: 'LB Road', d: 'M708 420 L742 352 L784 252 L744 150', major: false },
  { id: 'arcot', name: 'Arcot Road', d: 'M200 330 L360 260 L590 232', major: false },
];
