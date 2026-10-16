import React from 'react';
import { RefreshCw } from 'lucide-react';
import PageHeader from '../../components/PageHeader.jsx';
import ToolHealthPanel from '../tools/ToolHealthPanel.jsx';
import OutputPreferences from './OutputPreferences.jsx';
import QualityPreferences from './QualityPreferences.jsx';

function appUpdateMessage(status) {
  switch (status?.state) {
    case 'checking': return 'בודק אם יש גרסה חדשה…';
    case 'none': return 'Morph מעודכן לגרסה האחרונה';
    case 'available': return `גרסה ${status.version} זמינה. אפשר לעדכן מהפס למעלה.`;
    case 'downloading': return `מוריד את העדכון… ${status.percent || 0}%`;
    case 'ready': return `גרסה ${status.version} מוכנה. הפעל מחדש כדי להתקין.`;
    case 'error': return 'הבדיקה נכשלה. בדוק את החיבור לאינטרנט.';
    case 'dev': return 'בדיקת עדכונים פועלת רק בגרסה המותקנת.';
    default: return 'Morph בודק עדכונים בכל הפעלה וכל 4 שעות.';
  }
}

export default function SettingsPage({ settings, onChange, tools, app }) {
  return (
    <>
      <PageHeader title="הגדרות" subtitle="ברירות המחדל לכל המרה. נשמרות אוטומטית." />
      <section className="card settings">
        <OutputPreferences settings={settings} onChange={onChange} />
        <QualityPreferences settings={settings} onChange={onChange} />
        <ToolHealthPanel tools={tools} />
        <div className="setting">
          <div>
            <div className="setting-title">עדכוני תוכנה</div>
            <div className="row-meta">גרסה {app.version || '…'}</div>
            <div className={`row-meta ${app.status?.state === 'error' ? 'tag-muted' : ''}`}>{appUpdateMessage(app.status)}</div>
          </div>
          <button className="btn-ghost" onClick={app.check} disabled={['checking', 'downloading'].includes(app.status?.state)}>
            <RefreshCw size={16} className={app.status?.state === 'checking' ? 'spin' : ''} /> בדוק עדכונים
          </button>
        </div>
      </section>
    </>
  );
}
