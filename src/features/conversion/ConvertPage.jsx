import React, { useMemo } from 'react';
import FileDropZone from './FileDropZone.jsx';
import FormatGroupControls from './FormatGroupControls.jsx';
import ConversionQueue from './ConversionQueue.jsx';
import BatchActions from './BatchActions.jsx';
import { conversionCounts, formatGroups, hasClearable, saveWhereText } from './conversionSelectors.js';

// Composes the convert screen from the queue state; holds no conversion logic itself.
export default function ConvertPage({ queue, intake, settings }) {
  const { items } = queue;
  const groups = useMemo(() => formatGroups(items), [items]);
  const counts = useMemo(() => conversionCounts(items), [items]);
  return (
    <>
      <header className="page-header">
        <div>
          <h1>המרת קבצים</h1>
          <p className="subtitle">גוררים כל קובץ. Morph מזהה מה זה ומציע רק את מה שאפשר.</p>
        </div>
      </header>

      <FileDropZone compact={items.length > 0} dragging={intake.dragging} onPick={intake.pick} />
      <FormatGroupControls groups={groups} onGroupTarget={queue.setGroupTarget} />
      <ConversionQueue items={items} totalSize={counts.total} canClear={hasClearable(items)} onClear={queue.clearDone} actions={queue.actions} />
      <BatchActions saveWhere={saveWhereText(settings)} counts={counts} running={queue.running} onConvertAll={queue.convertAll} />
    </>
  );
}
