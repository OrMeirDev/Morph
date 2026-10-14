import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { baseName } from '../../presentation/formatters.js';
import { KIND_STYLE, FALLBACK_STYLE } from './kindStyle.js';

// The kind icon at the start of a row.
export function FileKindIcon({ kind, unsupported }) {
  const style = KIND_STYLE[kind] || FALLBACK_STYLE;
  const Icon = style.icon;
  return <span className={`kind-icon ${unsupported ? 't-bad' : style.cls}`}>{unsupported ? <AlertTriangle size={18} /> : <Icon size={18} />}</span>;
}

// File name with its detected-kind badge.
export default function FileIdentity({ item, unsupported }) {
  const style = KIND_STYLE[item.kind] || FALLBACK_STYLE;
  return (
    <div className="file-name">
      <span className="name-text" title={item.path}>{baseName(item.path)}</span>
      {!unsupported && <span className={`kind-tag ${style.cls}`}>{item.label}</span>}
    </div>
  );
}
