/** Demo data for weather and connected services. None of it is live. */

export const DEMO_WEATHER = {
  city: 'Chennai',
  tempC: 31,
  feelsLikeC: 36,
  condition: 'Partly cloudy',
  conditionHi: 'आंशिक रूप से बादल',
  humidity: 72,
  windKmh: 14,
  aqi: 64,
  forecast: [
    { day: 'Today', hi: 33, lo: 27, icon: 'sun' as const },
    { day: 'Mon', hi: 32, lo: 27, icon: 'cloud' as const },
    { day: 'Tue', hi: 30, lo: 26, icon: 'rain' as const },
    { day: 'Wed', hi: 31, lo: 26, icon: 'cloud' as const },
    { day: 'Thu', hi: 33, lo: 27, icon: 'sun' as const },
  ],
};

export const FASTAG = {
  balance: 1245,
  vehicle: 'TN 09 ·· 4521 (demo)',
  recent: [
    { plaza: 'Perungudi Toll Plaza', amount: 40, when: 'Yesterday, 18:42' },
    { plaza: 'Sriperumbudur Toll Plaza', amount: 65, when: '28 Oct, 09:15' },
    { plaza: 'Paranur Toll Plaza', amount: 70, when: '24 Oct, 16:03' },
  ],
};

export const BHARAT_SERVICES = [
  { id: 'puc', name: 'PUC certificate', status: 'Valid till Mar 2027', ok: true },
  { id: 'insurance', name: 'Insurance', status: 'Renewal due in 46 days', ok: false },
  { id: 'challan', name: 'e-Challan check', status: 'No pending challans (demo)', ok: true },
  { id: 'rc', name: 'Digital RC', status: 'Linked (demo)', ok: true },
];

export const EMERGENCY = {
  hospital: { name: 'Government Hospital (demo)', distance: '2.4 km' },
  police: { name: 'Police station (demo)', distance: '1.1 km' },
  numbers: [
    { label: 'Emergency', number: '112' },
    { label: 'Ambulance', number: '108' },
    { label: 'Highway helpline', number: '1033' },
  ],
};

export const CONNECTED_DEVICES = [
  { id: 'phone', name: 'Kanishk’s Phone', kind: 'Phone', detail: 'Bluetooth · Media & calls' },
  { id: 'watch', name: 'Smartwatch', kind: 'Wearable', detail: 'Notifications (demo)' },
  { id: 'dashcam', name: 'Dash camera', kind: 'Accessory', detail: 'Wi-Fi · Not recording (demo)' },
];

export const MAINTENANCE = [
  { id: 'service', title: 'Periodic service', due: 'Due in 1,760 km or 38 days', level: 'info' as const },
  { id: 'wipers', title: 'Wiper blades', due: 'Inspect before monsoon', level: 'warning' as const },
  { id: 'battery', title: '12V battery health', due: 'Good — next check Jan 2027', level: 'ok' as const },
  { id: 'cabin', title: 'Cabin air filter', due: 'Replace at next service', level: 'info' as const },
];

export const AMBIENT_COLOURS = ['#4D9EFF', '#56C69B', '#E8B65E', '#FF7A8A', '#B9A7FF', '#F4F7FC'];
