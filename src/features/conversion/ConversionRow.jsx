import React from 'react';
import FileIdentity, { FileKindIcon } from './FileIdentity.jsx';
import ConversionStatus from './ConversionStatus.jsx';
import TargetFormatSelect from './TargetFormatSelect.jsx';
import ConversionActions from './ConversionActions.jsx';

export default function ConversionRow({ item, actions }) {
  const unsupported = item.status === 'unsupported';
  return (
    <div className={`file-row ${unsupported ? 'unsupported' : ''}`}>
      <FileKindIcon kind={item.kind} unsupported={unsupported} />
      <div className="file-info">
        <FileIdentity item={item} unsupported={unsupported} />
        <ConversionStatus item={item} unsupported={unsupported} />
      </div>

      <div className="row-actions">
        {!unsupported && <TargetFormatSelect item={item} onChange={(t) => actions.setTarget(item.id, t)} />}
        <ConversionActions item={item} actions={actions} />
      </div>
    </div>
  );
}
