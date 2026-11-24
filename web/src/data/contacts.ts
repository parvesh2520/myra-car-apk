import type { CallLog, Contact } from '../types';

/** Fictional sample contacts. MYRA never reads real contacts from a phone. */
export const CONTACTS: Contact[] = [
  { id: 'c-amma', name: 'Amma', label: 'Mobile', number: '+91 98400 11223', favourite: true, colour: '#ff8fa3' },
  { id: 'c-papa', name: 'Papa', label: 'Mobile', number: '+91 98400 44556', favourite: true, colour: '#4d9eff' },
  { id: 'c-rahul', name: 'Rahul Sharma', label: 'Work', number: '+91 99620 77889', favourite: true, colour: '#56c69b' },
  { id: 'c-priya', name: 'Priya Nair', label: 'Mobile', number: '+91 90030 12345', favourite: true, colour: '#e8b65e' },
  { id: 'c-arjun', name: 'Arjun Iyer', label: 'Mobile', number: '+91 94440 67890', favourite: false, colour: '#a78bfa' },
  { id: 'c-meera', name: 'Meera Krishnan', label: 'Home', number: '+91 044 2441 2233', favourite: false, colour: '#5eead4' },
  { id: 'c-office', name: 'Office Reception', label: 'Work', number: '+91 044 4000 1000', favourite: false, colour: '#93c5fd' },
  { id: 'c-service', name: 'Service Centre (demo)', label: 'Work', number: '+91 1800 000 000', favourite: false, colour: '#fbbf24' },
  { id: 'c-dev', name: 'Dev Malhotra', label: 'Mobile', number: '+91 97100 22334', favourite: false, colour: '#f472b6' },
  { id: 'c-sana', name: 'Sana Qureshi', label: 'Mobile', number: '+91 98840 55667', favourite: false, colour: '#fb923c' },
];

export const contactById = (id: string | null | undefined) => CONTACTS.find((c) => c.id === id);

const min = 60 * 1000;
export const seedCallLog = (now = Date.now()): CallLog[] => [
  { id: 'l1', contactId: 'c-amma', direction: 'incoming', at: now - 42 * min, durationSec: 312 },
  { id: 'l2', contactId: 'c-rahul', direction: 'outgoing', at: now - 3 * 60 * min, durationSec: 128 },
  { id: 'l3', contactId: 'c-office', direction: 'missed', at: now - 5 * 60 * min, durationSec: 0 },
  { id: 'l4', contactId: 'c-priya', direction: 'outgoing', at: now - 26 * 60 * min, durationSec: 545 },
  { id: 'l5', contactId: 'c-arjun', direction: 'incoming', at: now - 30 * 60 * min, durationSec: 63 },
];

export function findContact(query: string): Contact | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return (
    CONTACTS.find((c) => c.name.toLowerCase() === q) ??
    CONTACTS.find((c) => c.name.toLowerCase().split(' ').some((w) => w === q)) ??
    CONTACTS.find((c) => c.name.toLowerCase().includes(q))
  );
}
