import React from 'react';
import { api } from '../../services/morphApi.js';

export default function OutputPreferences({ settings, onChange }) {
  const chooseFolder = async () => {
    const dir = await api.chooseFolder();
    if (dir) onChange({ folder: dir, outputMode: 'folder' });
  };
  return (
    <div className="setting">
      <div>
        <div className="setting-title">איפה לשמור את הקבצים</div>
        <div className="row-meta" dir="auto">{settings.outputMode === 'folder' ? settings.folder : 'באותה תיקייה של הקובץ המקורי'}</div>
      </div>
      <div className="row-actions">
        <div className="segmented">
          <button className={settings.outputMode === 'beside' ? 'on' : ''} onClick={() => onChange({ outputMode: 'beside' })}>ליד המקור</button>
          <button className={settings.outputMode === 'folder' ? 'on' : ''} onClick={() => onChange({ outputMode: 'folder' })}>תיקייה קבועה</button>
        </div>
        {settings.outputMode === 'folder' && <button className="btn-ghost" onClick={chooseFolder}>שנה תיקייה</button>}
        {settings.outputMode === 'folder' && <button className="btn-ghost" onClick={() => api.openFolder(settings.folder)}>פתח</button>}
      </div>
    </div>
  );
}
