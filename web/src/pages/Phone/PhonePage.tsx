import { useMemo, useState } from 'react';
import { BatteryMedium, Bluetooth, Cast, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Search, Signal, Smartphone, Star, X } from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { useT } from '../../hooks/useT';
import { CONTACTS, contactById } from '../../data/contacts';
import { formatDuration, initials, relativeTime } from '../../services/format';
import { Toggle } from '../../components/controls/Toggle';
import { Segmented } from '../../components/controls/Segmented';
import { DemoTag } from '../../components/controls/DemoTag';
import type { Contact, Projection } from '../../types';

type Tab = 'favourites' | 'recents' | 'contacts';

export function PhonePage() {
  const { phone, driveMode } = useAppState();
  const actions = useActions();
  const t = useT();
  const [tab, setTab] = useState<Tab>('favourites');
  const [query, setQuery] = useState('');
  const driving = driveMode === 'driving';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? CONTACTS.filter((c) => c.name.toLowerCase().includes(q) || c.number.replace(/\s/g, '').includes(q.replace(/\s/g, ''))) : CONTACTS;
  }, [query]);

  return (
    <div className="h-full p-5 grid grid-cols-[380px_minmax(0,1fr)] gap-4">
      <div className="flex flex-col gap-4 min-h-0">
        <section className="card p-5 flex flex-col gap-4" aria-label="Connected device">
          <header className="flex items-center justify-between">
            <h2 className="label">Connected device</h2>
            <DemoTag />
          </header>
          <div className="flex items-center gap-4">
            <span className={`grid place-items-center size-14 rounded-2xl ${phone.deviceConnected ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-ink-3'}`}>
              <Smartphone size={26} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold text-ink truncate">{phone.deviceName}</p>
              <p className={`text-sm ${phone.deviceConnected ? 'text-ok' : 'text-ink-2'}`}>
                {phone.deviceConnected ? `● ${t('connected')}` : `○ ${t('notConnected')}`}
              </p>
            </div>
          </div>
          {phone.deviceConnected && (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="card-inset px-3 py-2 flex items-center gap-2 text-ink-2"><BatteryMedium size={16} aria-hidden /> 78% (demo)</div>
              <div className="card-inset px-3 py-2 flex items-center gap-2 text-ink-2"><Signal size={16} aria-hidden /> 4G (demo)</div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-ink"><Bluetooth size={16} aria-hidden /> Bluetooth</span>
            <Toggle checked={phone.bluetooth} onChange={actions.phone.setBluetooth} label="Bluetooth" />
          </div>
          <button type="button" className={`btn ${phone.deviceConnected ? '' : 'btn-primary'}`} onClick={() => actions.phone.setConnected(!phone.deviceConnected)}>
            {phone.deviceConnected ? 'Disconnect' : 'Connect demo phone'}
          </button>
        </section>

        <section className="card p-5 flex flex-col gap-3" aria-label="Phone projection">
          <header className="flex items-center justify-between">
            <h2 className="label flex items-center gap-2"><Cast size={14} aria-hidden /> Phone projection</h2>
            <DemoTag>Demo state</DemoTag>
          </header>
          <Segmented<Projection>
            label="Projection mode"
            value={phone.projection}
            onChange={(p) => {
              actions.phone.setProjection(p);
              if (p !== 'none') actions.ui.toast(`${p === 'androidAuto' ? 'Android Auto' : 'Apple CarPlay'} shown as a demonstration state only`, 'info');
            }}
            options={[
              { value: 'none', label: 'Off' },
              { value: 'androidAuto', label: 'Android Auto', disabled: !phone.deviceConnected },
              { value: 'carPlay', label: 'CarPlay', disabled: !phone.deviceConnected },
            ]}
          />
          <p className="text-xs text-ink-3">Illustrates how projection would appear. MYRA does not implement Android Auto or CarPlay protocols.</p>
        </section>

        <button
          type="button"
          className="card p-4 flex items-center gap-3 text-left hover:border-ok/50 transition-colors disabled:opacity-50"
          onClick={() => actions.phone.simulateIncoming()}
          disabled={!phone.deviceConnected || phone.call.status !== 'idle'}
        >
          <span className="grid place-items-center size-11 rounded-xl bg-ok/15 text-ok"><PhoneIncoming size={20} aria-hidden /></span>
          <span className="flex-1">
            <span className="block font-semibold text-ink">Simulate incoming call</span>
            <span className="block text-xs text-ink-2">Prototype control — no real telephony</span>
          </span>
        </button>
      </div>

      <section className="card p-4 flex flex-col gap-3 min-h-0" aria-label="Calls and contacts">
        {!phone.deviceConnected ? (
          <div className="flex-1 grid place-items-center text-center">
            <div className="flex flex-col items-center gap-3">
              <Smartphone size={40} className="text-ink-3" aria-hidden />
              <p className="text-lg font-semibold text-ink">No phone connected</p>
              <p className="text-sm text-ink-2 max-w-sm">Connect the demo phone to see favourites, recent calls and contacts. MYRA never requests access to your real contacts.</p>
              <button type="button" className="btn btn-primary" onClick={() => actions.phone.setConnected(true)}>Connect demo phone</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div role="tablist" aria-label="Phone sections" className="flex gap-2">
                {([['favourites', t('favourites'), Star], ['recents', t('recents'), PhoneIncoming], ['contacts', t('contacts'), Phone]] as const).map(([id, label, Icon]) => (
                  <button key={id} role="tab" type="button" aria-selected={tab === id} className="chip" onClick={() => setTab(id)}>
                    <Icon size={14} aria-hidden /> {label}
                  </button>
                ))}
              </div>
              {tab === 'contacts' && !driving && (
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
                  <label htmlFor="contact-search" className="sr-only">Search contacts</label>
                  <input id="contact-search" className="input !h-11 !pl-10 !pr-10" placeholder="Search name or number" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
                  {query && (
                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink" onClick={() => setQuery('')} aria-label="Clear search"><X size={16} /></button>
                  )}
                </div>
              )}
              {tab === 'contacts' && driving && <p className="text-sm text-ink-3">Search is paused while driving — say “Amma ko call karo”.</p>}
            </div>

            <div role="tabpanel" className="scroll-y min-h-0 flex-1">
              {tab === 'favourites' && (
                <div className="grid grid-cols-4 gap-3">
                  {CONTACTS.filter((c) => c.favourite).map((c) => (
                    <button key={c.id} type="button" onClick={() => actions.phone.call(c.id)} className="tile p-5 flex flex-col items-center gap-3" aria-label={`Call ${c.name}`}>
                      <Avatar contact={c} size={72} />
                      <span className="text-center">
                        <span className="block font-semibold text-ink">{c.name}</span>
                        <span className="block text-xs text-ink-2">{c.label}</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-ok"><Phone size={13} aria-hidden /> Call</span>
                    </button>
                  ))}
                </div>
              )}
              {tab === 'recents' && (
                <ul className="flex flex-col gap-1.5" role="list">
                  {phone.recents.map((log) => {
                    const c = contactById(log.contactId);
                    if (!c) return null;
                    const Icon = log.direction === 'missed' ? PhoneMissed : log.direction === 'outgoing' ? PhoneOutgoing : PhoneIncoming;
                    return (
                      <li key={log.id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-surface-2">
                        <Avatar contact={c} size={44} />
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium truncate ${log.direction === 'missed' ? 'text-danger' : 'text-ink'}`}>{c.name}</p>
                          <p className="text-xs text-ink-2 flex items-center gap-1.5">
                            <Icon size={13} aria-hidden />
                            <span className="capitalize">{log.direction}</span> · {relativeTime(log.at)}
                            {log.durationSec > 0 && ` · ${formatDuration(log.durationSec)}`}
                          </p>
                        </div>
                        <button type="button" className="icon-btn !rounded-full !text-ok" onClick={() => actions.phone.call(c.id)} aria-label={`Call ${c.name}`}>
                          <Phone size={18} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {tab === 'contacts' && (
                <ul className="grid grid-cols-2 gap-1.5" role="list">
                  {filtered.length === 0 && <li className="p-4 text-sm text-ink-2">No contacts match “{query}”.</li>}
                  {filtered.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => actions.phone.call(c.id)} className="w-full flex items-center gap-3 rounded-xl p-2 hover:bg-surface-2 text-left" aria-label={`Call ${c.name}`}>
                        <Avatar contact={c} size={44} />
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium text-ink truncate">{c.name}</span>
                          <span className="block text-xs text-ink-2 tabular-nums">{c.label} · {c.number}</span>
                        </span>
                        <Phone size={17} className="text-ok mr-2" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-xs text-ink-3">Sample contacts and call history. Calls are simulated on-screen only.</p>
          </>
        )}
      </section>
    </div>
  );
}

function Avatar({ contact, size }: { contact: Contact; size: number }) {
  return (
    <span className="grid place-items-center rounded-full font-bold text-[#06101d] shrink-0" style={{ width: size, height: size, background: contact.colour, fontSize: size * 0.34 }} aria-hidden>
      {initials(contact.name)}
    </span>
  );
}
