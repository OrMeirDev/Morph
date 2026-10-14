import React, { useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import GlassSelect from '../../design/GlassSelect.jsx';
import GlassDate from '../../design/GlassDate.jsx';
import GlassTime from '../../design/GlassTime.jsx';
import { instantFor, nowIn, partsIn } from '../../domain/time/timeZoneConversion.js';
import { CITIES } from './cityCatalog.js';
import CityTimeRow from './CityTimeRow.jsx';

export default function WorldClock() {
  const [base, setBase] = useState('Asia/Jerusalem');
  const [date, setDate] = useState(() => nowIn('Asia/Jerusalem').date);
  const [time, setTime] = useState(() => nowIn('Asia/Jerusalem').time);
  const instant = useMemo(() => (date && time ? instantFor(date, time, base) : new Date()), [date, time, base]);
  const baseDay = partsIn(instant, base).d;

  return (
    <section className="card tool-card">
      <h2>שעון עולמי</h2>
      <div className="unit-row">
        <GlassSelect className="plain-select" value={base} onChange={(e) => setBase(e.target.value)}>
          {CITIES.map(([n, tz]) => <option key={tz} value={tz}>{n}</option>)}
        </GlassSelect>
        <GlassDate className="unit-input small" value={date} onChange={(e) => setDate(e.target.value)} />
        <GlassTime className="unit-input small" value={time} onChange={(e) => setTime(e.target.value)} />
        <button className="btn-ghost" onClick={() => { const n = nowIn(base); setDate(n.date); setTime(n.time); }}><Clock size={15} /> עכשיו</button>
      </div>
      <div className="clock-list">
        {CITIES.filter(([, tz]) => tz !== base).map(([name, tz]) => (
          <CityTimeRow key={tz} name={name} tz={tz} instant={instant} base={base} baseDay={baseDay} />
        ))}
      </div>
    </section>
  );
}
