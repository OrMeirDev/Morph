// Date and time fields whose pickers are part of the app instead of the Windows/Chromium ones: a
// glass calendar (Sunday first, Hebrew month names) and a glass hour/minute picker, both opening
// from the field like the glass menus, with the liquid glass drop on the chosen day / hour / minute.
// Same contract as <input type="date|time">: value 'YYYY-MM-DD' / 'HH:MM', and onChange gets an
// event-like { target: { value } }.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';

const GAP = 6;
const MARGIN = 10;
const pad = (n) => String(n).padStart(2, '0');
const parseDate = (s) => { const [y, m, d] = (s || '').split('-').map(Number); return y ? new Date(y, m - 1, d) : new Date(); };
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// A field that opens a glass popover under (or above) itself; closes like the glass menus do.
function useGlassPopover() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [pos, setPos] = useState(null);
  const trigger = useRef(null);
  const pop = useRef(null);
  const close = () => {
    if (!open || closing) return;
    setClosing(true);
    setTimeout(() => { setOpen(false); setClosing(false); setPos(null); }, 120);
  };
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const up = below < 300 && above > below;
    setPos({ up, ...(up ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }) });
  }, [open]);
  useLayoutEffect(() => {
    const p = pop.current;
    if (!pos || !p || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const rtl = getComputedStyle(trigger.current).direction === 'rtl';
    p.style.left = `${Math.min(Math.max(MARGIN, rtl ? r.right - p.offsetWidth : r.left), window.innerWidth - p.offsetWidth - MARGIN)}px`;
  }, [pos]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => { if (!pop.current?.contains(e.target) && !trigger.current?.contains(e.target)) close(); };
    const scrolled = (e) => { if (!pop.current?.contains(e.target)) close(); };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  });
  const render = (className, children) => open && pos && createPortal(
    <div ref={pop} className={`gmenu gpop ${className} ${pos.up ? 'up' : ''} ${closing ? 'closing' : ''}`} style={{ top: pos.top, bottom: pos.bottom }} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </div>,
    document.body,
  );
  return { open, closing, setOpen, close, trigger, render };
}

const MONTH = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' });
const SHOWN = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

export function GlassDate({ value, onChange, className = '' }) {
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

const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i));

export function GlassTime({ value, onChange, className = '' }) {
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
