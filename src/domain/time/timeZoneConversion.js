// Pure time-zone arithmetic for the world clock (Intl only: no React, no Electron).

// Wall-clock parts of an instant in a time zone.
export function partsIn(date, timeZone) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}

// How far the zone's wall clock is ahead of UTC at `date`, in ms (minute precision).
export const zoneOffsetMs = (date, tz) => {
  const p = partsIn(date, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(date.getTime() / 60000) * 60000;
};

const DAY = 86400000;
const sameWall = (instant, tz, y, mo, d, h, mi) => {
  const p = partsIn(instant, tz);
  return p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi;
};

// The instant at which the wall clock in `tz` reads the given date and time, with an explicit DST
// policy instead of a silent adjustment:
//   status 'exact'     - the wall time happens once.
//   status 'ambiguous' - it happens twice (clocks went back); `instant` is the earlier one and
//                        `later` the second.
//   status 'gap'       - it never happens (clocks went forward); `instant` is the same moment the
//                        clock would show had it not jumped, i.e. the time moved forward by the
//                        skipped `shiftMinutes`. The UI must say so rather than show it as asked.
export function resolveWallTime(dateStr, timeStr, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const local = Date.UTC(y, mo - 1, d, h, mi);
  // Any transition near this wall time sits between the offsets a day before and a day after.
  const before = zoneOffsetMs(new Date(local - DAY), tz);
  const after = zoneOffsetMs(new Date(local + DAY), tz);
  const candidates = [...new Set([local - before, local - after])].sort((a, b) => a - b)
    .filter((t) => sameWall(new Date(t), tz, y, mo, d, h, mi));
  if (candidates.length === 2) return { status: 'ambiguous', instant: new Date(candidates[0]), later: new Date(candidates[1]) };
  if (candidates.length === 1) return { status: 'exact', instant: new Date(candidates[0]) };
  return { status: 'gap', instant: new Date(local - before), shiftMinutes: Math.round((after - before) / 60000) };
}

// Calendar-day difference between the zone's date and the base zone's date at one instant
// (+1 = "tomorrow" there, -1 = "yesterday"); correct across month and year ends.
export function dayOffset(instant, tz, baseTz) {
  const a = partsIn(instant, tz);
  const b = partsIn(instant, baseTz);
  return Math.round((Date.UTC(a.y, a.mo - 1, a.d) - Date.UTC(b.y, b.mo - 1, b.d)) / DAY);
}

const pad = (n) => String(n).padStart(2, '0');
export function nowIn(tz) {
  const p = partsIn(new Date(), tz);
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}
