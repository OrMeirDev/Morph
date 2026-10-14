import React from 'react';
import { partsIn, zoneOffsetMs } from '../../domain/time/timeZoneConversion.js';
import { pad2 } from '../../presentation/formatters.js';

// One city's wall-clock time for the chosen instant, with its offset and day relative to the base city.
export default function CityTimeRow({ name, tz, instant, base, baseDay }) {
  const p = partsIn(instant, tz);
  const dayDiff = p.d - baseDay;
  const diffH = (zoneOffsetMs(instant, tz) - zoneOffsetMs(instant, base)) / 3600000;
  return (
    <div className="clock-row">
      <span>{name}</span>
      <span className="muted small-note">{diffH === 0 ? 'אותה שעה' : `${diffH > 0 ? '+' : ''}${diffH} שע׳`}</span>
      <b dir="ltr">{pad2(p.h)}:{pad2(p.mi)}</b>
      <span className="muted small-note">{dayDiff === 0 ? '' : dayDiff > 0 || dayDiff < -20 ? 'מחר' : 'אתמול'}</span>
    </div>
  );
}
