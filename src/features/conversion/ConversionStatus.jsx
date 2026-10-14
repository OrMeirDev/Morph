import React from 'react';
import { baseName, fmtSize } from '../../presentation/formatters.js';
import { friendlyError } from '../../presentation/errorMessages.js';
import DetectionNotice from './DetectionNotice.jsx';
import ConversionProgress from './ConversionProgress.jsx';

// The meta line under a file name: size, detection notice, and where the conversion stands.
export default function ConversionStatus({ item, unsupported }) {
  const busy = item.status === 'converting';
  return (
    <div className="file-meta">
      {unsupported && 'סוג הקובץ הזה לא נתמך להמרה'}
      {!unsupported && !busy && (
        <>
          <bdi dir="ltr">{fmtSize(item.size)}</bdi>
          <DetectionNotice item={item} />
          {item.status === 'done' && <> · נוצר: {baseName(item.output)}</>}
          {item.status === 'error' && <span className="err-text"> · {friendlyError(item.error)}</span>}
          {item.status === 'queued' && ' · ממתין בתור'}
        </>
      )}
      {busy && <ConversionProgress progress={item.progress} />}
    </div>
  );
}
