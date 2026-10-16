import React from 'react';
import { ArrowLeftRight, ExternalLink, FolderOpen } from 'lucide-react';
import { fmtLabel } from '../../presentation/formatCatalog.js';
import { fmtDate } from '../../presentation/formatters.js';

export default function HistoryRow({ entry, missing, onOpen, onShow }) {
  return (
    <div className="row">
      <span className="row-icon"><ArrowLeftRight size={18} /></span>
      <div className="row-info">
        <div className="row-name">{entry.name}</div>
        <div className="row-meta">
          {fmtLabel(entry.from)} ← {fmtLabel(entry.to)} · {fmtDate(entry.convertedAt)}
          {missing && <span className="tag-muted"> · הקובץ הועבר או נמחק</span>}
        </div>
      </div>
      {!missing && (
        <div className="row-actions">
          <button className="icon-btn" title="פתח" onClick={onOpen}><ExternalLink size={17} /></button>
          <button className="icon-btn" title="הצג בתיקייה" onClick={onShow}><FolderOpen size={17} /></button>
        </div>
      )}
    </div>
  );
}
