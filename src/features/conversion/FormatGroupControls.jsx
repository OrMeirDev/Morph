import React from 'react';
import GlassSelect from '../../design/GlassSelect.jsx';
import { fmtLabel } from '../../presentation/formatCatalog.js';
import { KIND_STYLE, FALLBACK_STYLE } from './kindStyle.js';

export default function FormatGroupControls({ groups, onGroupTarget }) {
  if (groups.length <= 1) return null;
  return (
    <div className="group-bar">
      <span className="muted">המר את כל ה־</span>
      {groups.map((g) => {
        const Icon = (KIND_STYLE[g.kind] || FALLBACK_STYLE).icon;
        return (
          <label key={g.kind} className="group-chip">
            <Icon size={15} className={KIND_STYLE[g.kind]?.cls} />
            {KIND_STYLE[g.kind]?.group} ({g.count}) ל־
            <GlassSelect value={g.current || ''} onChange={(e) => onGroupTarget(g.kind, e.target.value)}>
              {!g.current && <option value="">שונים</option>}
              {g.targets.map((t) => <option key={t} value={t}>{fmtLabel(t)}</option>)}
            </GlassSelect>
          </label>
        );
      })}
    </div>
  );
}
