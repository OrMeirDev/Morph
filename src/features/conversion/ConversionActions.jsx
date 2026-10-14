import React from 'react';
import { ArrowLeftRight, RotateCw, Square, X } from 'lucide-react';
import OutputActions from './OutputActions.jsx';

// Per-row commands. Emits intents only; the queue decides what happens.
export default function ConversionActions({ item, actions }) {
  const busy = item.status === 'converting';
  return (
    <>
      {item.status === 'done' && <OutputActions onOpen={() => actions.openOutput(item)} onShow={() => actions.showOutput(item)} />}
      {(item.status === 'ready' || item.status === 'cancelled') && (
        <button className="icon-btn accent" title="המר רק את זה" onClick={() => actions.convertOne(item.id)}><ArrowLeftRight size={17} /></button>
      )}
      {item.status === 'error' && (
        <button className="icon-btn danger" title="נסה שוב" onClick={() => actions.convertOne(item.id)}><RotateCw size={17} /></button>
      )}
      {busy && <button className="icon-btn" title="עצור" onClick={() => actions.stop(item.id)}><Square size={15} /></button>}
      {!busy && <button className="icon-btn ghost" title="הסר מהרשימה" onClick={() => actions.remove(item.id)}><X size={17} /></button>}
    </>
  );
}
