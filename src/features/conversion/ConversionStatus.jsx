import React from 'react';
import { baseName, fmtSize } from '../../presentation/formatters.js';
import { friendlyError } from '../../presentation/errorMessages.js';
import DetectionNotice from './DetectionNotice.jsx';
import ConversionProgress from './ConversionProgress.jsx';
import { fidelityNote, limitNotes, missingToolNames } from '../../presentation/fidelityNotes.js';

// The meta line under a file name: size, detection notice, and where the conversion stands.
export default function ConversionStatus({ item, unsupported }) {
  const busy = item.status === 'converting';
  return (
    <div className="file-meta">
      {unsupported && (item.reason === 'missing-tools'
        ? `כלי ההמרה לסוג הזה חסר (${missingToolNames(item.missing).join(', ')}). נסה להתקין את Morph מחדש.`
        : 'סוג הקובץ הזה לא נתמך להמרה')}
      {!unsupported && !busy && (
        <>
          <bdi dir="ltr">{fmtSize(item.size)}</bdi>
          <DetectionNotice item={item} />
          {item.status === 'done' && <> · נוצר: {baseName(item.output)}</>}
          {item.status === 'error' && <span className="err-text"> · {friendlyError(item.error)}</span>}
          {item.status === 'queued' && ' · ממתין בתור'}
          {['ready', 'queued', 'cancelled'].includes(item.status) && fidelityNote(item.fidelity?.[item.target]) && (
            <span className="muted"> · {fidelityNote(item.fidelity[item.target])}</span>
          )}
          {['ready', 'queued', 'cancelled'].includes(item.status) && limitNotes(item.limits?.[item.target]).map((n) => (
            <span key={n} className="warn-text"> · {n}</span>
          ))}
        </>
      )}
      {busy && <ConversionProgress progress={item.progress} />}
    </div>
  );
}
