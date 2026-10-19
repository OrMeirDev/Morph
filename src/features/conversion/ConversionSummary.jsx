import React from 'react';

export default function ConversionSummary({ counts }) {
  return (
    <span className="muted summary">
      {counts.done ? `${counts.done} הושלמו` : ''}{counts.failed ? ` · ${counts.failed} נכשלו` : ''}
    </span>
  );
}
