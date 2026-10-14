// Pure time-zone arithmetic for the world clock (Intl only: no React, no Electron).

// Wall-clock parts of an instant in a time zone.
export function partsIn(date, timeZone) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}
export const zoneOffsetMs = (date, tz) => {
  const p = partsIn(date, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(date.getTime() / 60000) * 60000;
};
// The instant when the wall clock in `tz` reads the given date and time.
export function instantFor(dateStr, timeStr, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - zoneOffsetMs(new Date(guess), tz);
  t = guess - zoneOffsetMs(new Date(t), tz); // second pass handles DST edges
  return new Date(t);
}

const pad = (n) => String(n).padStart(2, '0');
export function nowIn(tz) {
  const p = partsIn(new Date(), tz);
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}
