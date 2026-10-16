import React, { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import GlassSelect from '../../design/GlassSelect.jsx';
import { UNITS } from '../../domain/units/unitCatalog.js';
import { convertUnit } from '../../domain/units/convertUnit.js';
import { fmtNum } from '../../presentation/formatters.js';

export default function UnitConverter() {
  const [cat, setCat] = useState('length');
  const unitKeys = Object.keys(UNITS[cat].units);
  const [from, setFrom] = useState('km');
  const [to, setTo] = useState('mi');
  const [value, setValue] = useState('1');

  const pickCat = (c) => {
    const keys = Object.keys(UNITS[c].units);
    setCat(c);
    setFrom(keys[Math.min(1, keys.length - 1)]);
    setTo(keys[Math.min(2, keys.length - 1)] || keys[0]);
  };
  const num = parseFloat(String(value).replace(/,/g, ''));
  const result = Number.isFinite(num) ? convertUnit(cat, num, from, to) : NaN;

  return (
    <section className="card tool-card">
      <h2>המרת יחידות</h2>
      <div className="cat-tabs">
        {Object.entries(UNITS).map(([k, c]) => (
          <button key={k} className={`cat-tab ${cat === k ? 'on' : ''}`} onClick={() => pickCat(k)}>{c.label}</button>
        ))}
      </div>
      <div className="unit-row">
        <input className="unit-input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} dir="ltr" />
        <GlassSelect className="plain-select" value={from} onChange={(e) => setFrom(e.target.value)}>
          {unitKeys.map((k) => <option key={k} value={k}>{UNITS[cat].units[k][0]}</option>)}
        </GlassSelect>
        <button className="icon-btn" title="החלף כיוון" onClick={() => { setFrom(to); setTo(from); }}><ArrowLeftRight size={17} /></button>
        <GlassSelect className="plain-select" value={to} onChange={(e) => setTo(e.target.value)}>
          {unitKeys.map((k) => <option key={k} value={k}>{UNITS[cat].units[k][0]}</option>)}
        </GlassSelect>
      </div>
      <div className="unit-result">
        <span dir="ltr">{fmtNum(result)}</span> <span className="muted">{UNITS[cat].units[to][0]}</span>
      </div>
      <div className="unit-all">
        {unitKeys.filter((k) => k !== from).map((k) => (
          <div key={k} className="unit-all-row"><span className="muted">{UNITS[cat].units[k][0]}</span><span dir="ltr">{Number.isFinite(num) ? fmtNum(convertUnit(cat, num, from, k)) : '—'}</span></div>
        ))}
      </div>
    </section>
  );
}
