import React from 'react';
import GlassSelect from '../../design/GlassSelect.jsx';
import { fmtLabel } from '../../presentation/formatCatalog.js';

export default function TargetFormatSelect({ item, onChange }) {
  return (
    <GlassSelect
      className="target-select"
      value={item.target}
      disabled={item.status === 'converting' || item.status === 'queued'}
      onChange={(e) => onChange(e.target.value)}
      aria-label="פורמט יעד"
    >
      {item.targets.map((t) => <option key={t} value={t}>{fmtLabel(t)}</option>)}
    </GlassSelect>
  );
}
