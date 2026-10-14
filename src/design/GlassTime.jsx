// Date and time fields whose pickers are part of the app instead of the Windows/Chromium ones: a
// glass calendar (Sunday first, Hebrew month names) and a glass hour/minute picker, both opening
// from the field like the glass menus, with the liquid glass drop on the chosen day / hour / minute.
// Same contract as <input type="date|time">: value 'YYYY-MM-DD' / 'HH:MM', and onChange gets an
// event-like { target: { value } }.
import React, { useLayoutEffect, useRef } from 'react';
import { Clock } from 'lucide-react';
import { useGlassPopover } from './useGlassPopover.jsx';

const pad = (n) => String(n).padStart(2, '0');

const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i));

export default function GlassTime({ value, onChange, className = '' }) {
  const p = useGlassPopover();
  const [h, m] = (value || '00:00').split(':');
  const cols = useRef(null);
  const centered = useRef(false);
  const set = (hh, mm, done) => { onChange?.({ target: { value: `${hh}:${mm}` } }); if (done) p.close(); };

  // the chosen hour and minute are centered in their columns when the picker opens
  useLayoutEffect(() => {
    if (!p.open) { centered.current = false; return; }
    if (centered.current || !cols.current) return;
    centered.current = true;
    for (const c of cols.current.querySelectorAll('.gtime-col')) {
      const on = c.querySelector('.on');
      if (on) c.scrollTop = on.offsetTop - c.clientHeight / 2 + on.offsetHeight / 2;
    }
  });

  const onKeyDown = (e) => {
    if (!p.open) { if (['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); p.setOpen(true); } return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const total = (+h * 60 + +m + (e.key === 'ArrowDown' ? 1 : -1) + 1440) % 1440;
      set(pad(Math.floor(total / 60)), pad(total % 60), false);
    } else if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); p.close(); }
    else if (e.key === 'Tab') p.close();
  };

  return (
    <>
      <button type="button" ref={p.trigger} className={`gselect gfield ${className}`} aria-haspopup="dialog" aria-expanded={p.open && !p.closing}
        onClick={() => (p.open ? p.close() : p.setOpen(true))} onKeyDown={onKeyDown}>
        <span className="gselect-value" dir="ltr">{h}:{m}</span>
        <Clock size={15} className="gfield-icon" aria-hidden="true" />
      </button>
      {p.render('gtime', (
        <div className="gtime-cols" ref={cols} dir="ltr">
          <div className="gtime-col">{HOURS.map((x) => <button type="button" key={x} className={`gtime-cell ${x === h ? 'on' : ''}`} onClick={() => set(x, m, false)}>{x}</button>)}</div>
          <span className="gtime-sep">:</span>
          <div className="gtime-col">{MINUTES.map((x) => <button type="button" key={x} className={`gtime-cell ${x === m ? 'on' : ''}`} onClick={() => set(h, x, true)}>{x}</button>)}</div>
        </div>
      ))}
    </>
  );
}
