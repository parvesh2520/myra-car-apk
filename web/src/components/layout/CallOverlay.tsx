import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { contactById } from '../../data/contacts';
import { useClock } from '../../hooks/useClock';
import { formatDuration, initials } from '../../services/format';
import { DemoTag } from '../controls/DemoTag';

/** Global incoming/active call UI. Calls are simulated; no telephony is used. */
export function CallOverlay() {
  const { phone } = useAppState();
  const actions = useActions();
  const now = useClock();
  const { call } = phone;
  const contact = contactById(call.contactId);
  if (call.status === 'idle' || !contact) return null;

  if (call.status === 'incoming') {
    return (
      <div className="absolute right-5 top-[72px] z-40 w-[380px] anim-rise" role="alertdialog" aria-label={`Incoming call from ${contact.name}`}>
        <div className="card p-5 !border-ok/40">
          <div className="flex items-center gap-4">
            <span className="relative grid place-items-center size-14 rounded-full text-lg font-bold text-[#06101d]" style={{ background: contact.colour }}>
              {initials(contact.name)}
              <span className="absolute inset-0 rounded-full border-2 border-ok" style={{ animation: 'ring 1.6s ease-out infinite' }} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="label">Incoming call</p>
                <DemoTag />
              </div>
              <p className="text-xl font-semibold text-ink truncate">{contact.name}</p>
              <p className="text-sm text-ink-2">{contact.label} · {contact.number}</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button type="button" className="btn btn-danger h-14" onClick={actions.phone.reject}>
              <PhoneOff size={20} aria-hidden /> Decline
            </button>
            <button type="button" className="btn btn-ok h-14" onClick={actions.phone.accept}>
              <Phone size={20} aria-hidden /> Accept
            </button>
          </div>
        </div>
      </div>
    );
  }

  const elapsed = call.startedAt ? (now.getTime() - call.startedAt) / 1000 : 0;
  return (
    <div className="absolute left-1/2 -translate-x-1/2 top-[66px] z-40 anim-rise" role="region" aria-label={`Call with ${contact.name}`}>
      <div className="card flex items-center gap-4 pl-3 pr-3 h-16 !rounded-full !border-ok/40">
        <span className="grid place-items-center size-11 rounded-full text-sm font-bold text-[#06101d]" style={{ background: contact.colour }}>
          {initials(contact.name)}
        </span>
        <div className="min-w-0 pr-2">
          <p className="text-[0.9375rem] font-semibold text-ink leading-tight">{contact.name}</p>
          <p className="text-xs text-ok tabular-nums">
            {call.direction === 'outgoing' && elapsed < 3 ? 'Calling…' : formatDuration(elapsed)} · Simulated
          </p>
        </div>
        <button
          type="button"
          onClick={actions.phone.toggleMute}
          className={`icon-btn !rounded-full ${call.muted ? '!bg-warn !text-[#1d1405]' : ''}`}
          aria-pressed={call.muted}
          aria-label={call.muted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {call.muted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>
        <button type="button" onClick={actions.phone.end} className="icon-btn !rounded-full !bg-danger !text-white !border-transparent" aria-label="End call">
          <PhoneOff size={20} />
        </button>
      </div>
    </div>
  );
}
