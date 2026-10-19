import React from 'react';
import GlassSelect from '../../design/GlassSelect.jsx';

export default function QualityPreferences({ settings, onChange }) {
  return (
    <>
      <div className="setting">
        <div>
          <div className="setting-title">איכות</div>
          <div className="row-meta">לווידאו, אודיו ותמונות. "קטן" חוסך מקום על חשבון האיכות.</div>
        </div>
        <div className="segmented">
          {[['high', 'גבוהה'], ['medium', 'בינונית'], ['small', 'קובץ קטן']].map(([v, l]) => (
            <button key={v} className={settings.quality === v ? 'on' : ''} onClick={() => onChange({ quality: v })}>{l}</button>
          ))}
        </div>
      </div>
      <div className="setting">
        <div>
          <div className="setting-title">רזולוציית וידאו מקסימלית</div>
          <div className="row-meta">סרטון גדול יותר יוקטן. סרטון קטן יותר לא יוגדל.</div>
        </div>
        <GlassSelect className="plain-select" value={settings.maxHeight || ''} onChange={(e) => onChange({ maxHeight: e.target.value ? Number(e.target.value) : null })}>
          <option value="">מקורית</option>
          <option value="1080">1080p</option>
          <option value="720">720p</option>
          <option value="480">480p</option>
        </GlassSelect>
      </div>
    </>
  );
}
