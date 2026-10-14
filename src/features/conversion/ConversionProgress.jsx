import React from 'react';

export default function ConversionProgress({ progress }) {
  return (
    <div className="row-progress">
      <span>{progress == null ? 'ממיר…' : `${Math.round(progress)}%`}</span>
      <div className={`progress ${progress == null ? 'indeterminate' : ''}`}><div style={{ width: `${progress ?? 30}%` }} /></div>
    </div>
  );
}
