import React from 'react';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import ConversionSummary from './ConversionSummary.jsx';

export default function BatchActions({ saveWhere, counts, running, onConvertAll }) {
  return (
    <footer className="action-bar">
      <span className="muted save-where">{saveWhere} · אפשר לשנות בהגדרות</span>
      <div className="action-main">
        <ConversionSummary counts={counts} />
        <button className="btn-primary big" onClick={onConvertAll} disabled={!counts.pending || running}>
          {running ? <Loader2 size={18} className="spin" /> : <ArrowLeftRight size={18} />}
          {running ? 'ממיר…' : `המר הכול${counts.pending ? ` (${counts.pending})` : ''}`}
        </button>
      </div>
    </footer>
  );
}
