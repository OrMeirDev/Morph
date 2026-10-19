// The glass popover shared by the date and time fields: opens under (or above) its field and
// closes like the glass menus do. Extracted unchanged from the former glass-pickers.jsx.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const GAP = 6;
const MARGIN = 10;

// A field that opens a glass popover under (or above) itself; closes like the glass menus do.
export function useGlassPopover() {
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
