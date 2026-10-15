import React from 'react';
import { Check, X } from 'lucide-react';
import { TOOL_NAMES, confinementText } from './toolPresentation.js';

export default function ToolHealthPanel({ tools }) {
  const isolation = confinementText(tools?.confinement);
  return (
    <div className="setting">
      <div>
        <div className="setting-title">כלי ההמרה</div>
        <div className="tool-grid">
          {Object.entries(TOOL_NAMES).map(([key, [name, what]]) => (
            <span key={key} className={`tool-chip ${tools?.[key] ? 'ok' : 'bad'}`}>
              {tools?.[key] ? <Check size={13} /> : <X size={13} />} <bdi dir="ltr">{name}</bdi> · {what}
            </span>
          ))}
        </div>
        {isolation && <div className={isolation.ok ? 'muted' : 'warn-text'}>{isolation.text}</div>}
      </div>
    </div>
  );
}
