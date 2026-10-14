// Date and time fields whose pickers are part of the app instead of the Windows/Chromium ones: a
// glass calendar (Sunday first, Hebrew month names) and a glass hour/minute picker, both opening
// from the field like the glass menus, with the liquid glass drop on the chosen day / hour / minute.
// Same contract as <input type="date|time">: value 'YYYY-MM-DD' / 'HH:MM', and onChange gets an
// event-like { target: { value } }.
import React, { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useGlassPopover } from './useGlassPopover.jsx';

const pad = (n) => String(n).padStart(2, '0');
const parseDate = (s) => { const [y, m, d] = (s || '').split('-').map(Number); return y ? new Date(y, m - 1, d) : new Date(); };
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;


const MONTH = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' });
const SHOWN = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

export default function GlassDate({ value, onChange, className = '' }) {
  const p = useGlassPopover();
  const chosen = parseDate(value);
  const [month, setMonth] = useState(() => new Date(chosen.getFullYear(), chosen.getMonth(), 1));
  const [focus, setFocus] = useState(chosen);
  const today = isoDate(new Date());

  const show = () => { setMonth(new Date(chosen.getFullYear(), chosen.getMonth(), 1)); setFocus(chosen); p.setOpen(true); };
  const pick = (d) => { onChange?.({ target: { value: isoDate(d) } }); p.close(); };
  const moveFocus = (days) => {
    const d = new Date(focus.getFullYear(), focus.getMonth(), focus.getDate() + days);
    setFocus(d);
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  };
  const onKeyDown = (e) => {
    if (!p.open) { if (['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); } return; }
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    const keys = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 7, ArrowUp: -7 };
    if (keys[e.key]) { e.preventDefault(); moveFocus(keys[e.key]); }
    else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      const d = new Date(focus.getFullYear(), focus.getMonth() + (e.key === 'PageDown' ? 1 : -1), Math.min(focus.getDate(), 28));
      setFocus(d); setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(focus); }
    else if (e.key === 'Escape') { e.preventDefault(); p.close(); }
    else if (e.key === 'Tab') p.close();
  };

  // six weeks from the Sunday on or before the 1st
  const start = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const shiftMonth = (n) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <>
      <button type="button" ref={p.trigger} className={`gselect gfield ${className}`} aria-haspopup="dialog" aria-expanded={p.open && !p.closing}
        onClick={() => (p.open ? p.close() : show())} onKeyDown={onKeyDown}>
        <span className="gselect-value">{SHOWN.format(chosen)}</span>
        <CalendarDays size={15} className="gfield-icon" aria-hidden="true" />
      </button>
      {p.render('gcal', (
        <>
          <div className="gcal-head">
            <button type="button" className="gcal-nav" onClick={() => shiftMonth(-1)} aria-label="החודש הקודם"><ChevronRight size={17} /></button>
            <b>{MONTH.format(month)}</b>
            <button type="button" className="gcal-nav" onClick={() => shiftMonth(1)} aria-label="החודש הבא"><ChevronLeft size={17} /></button>
          </div>
          <div className="gcal-week">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
          <div className="gcal-grid">
            {days.map((d) => {
              const iso = isoDate(d);
              return (
                <button type="button" key={iso} onClick={() => pick(d)}
                  className={`gcal-day ${iso === value ? 'sel' : ''} ${iso === today ? 'today' : ''} ${d.getMonth() !== month.getMonth() ? 'out' : ''} ${iso === isoDate(focus) ? 'focus' : ''}`}>
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="gcal-foot"><button type="button" className="gcal-today" onClick={() => pick(new Date())}>היום</button></div>
        </>
      ))}
    </>
  );
}
