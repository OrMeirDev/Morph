import React from 'react';
import { PAGES } from '../app/routes.js';
import { missingToolCount } from '../features/tools/toolPresentation.js';
// The Morph name with its symbol on the right (vector, from the brand package).
import brandLockup from '../brand/logo-lockup.svg';

export default function Sidebar({ page, onNavigate, tools, appVersion }) {
  const missing = missingToolCount(tools);
  return (
    <aside className="sidebar">
      <div className="brand"><img className="brand-lockup" src={brandLockup} alt="Morph" draggable={false} /></div>
      <nav>
        {PAGES.map(({ id, icon: Icon, label }) => (
          <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => onNavigate(id)}>
            <span>{label}</span>
            <Icon size={20} />
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div><span className={`dot ${missing ? 'dot-off' : ''}`} /> {tools ? (missing ? `${missing} כלים חסרים` : 'כל הכלים מוכנים') : 'בודק כלים…'}</div>
        <div className="muted">גרסה {appVersion || '…'}</div>
      </div>
    </aside>
  );
}
