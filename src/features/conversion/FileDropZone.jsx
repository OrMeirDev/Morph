import React from 'react';
import { ArrowUp, FolderOpen, UploadCloud } from 'lucide-react';

const KINDS_TEXT = ['וידאו', 'אודיו', 'תמונות', 'PDF', 'Word', 'Excel', 'מצגות', 'ספרים דיגיטליים', 'ארכיונים'];

// Nothing added yet: the big drop area with a "choose" button; afterwards a slim bar. Clicking
// either opens the file picker; drops are caught by the whole convert page (see useFileIntake).
export default function FileDropZone({ compact, dragging, onPick }) {
  if (compact) {
    return (
      <button className={`drop-zone compact ${dragging ? 'dragging' : ''}`} onClick={onPick}>
        <UploadCloud size={22} />
        <div>
          <div className="drop-title">{dragging ? 'שחרר כדי להוסיף' : <>גרור לכאן קבצים מכל סוג, או <u>בחר מהמחשב</u></>}</div>
          <div className="drop-sub">וידאו, אודיו, תמונות, PDF, Word, Excel, מצגות, ספרים דיגיטליים, ארכיונים</div>
        </div>
      </button>
    );
  }
  return (
    <button className={`drop-zone hero ${dragging ? 'dragging' : ''}`} onClick={onPick}>
      <div className="drop-inner">
        <span className="drop-art" aria-hidden="true"><i /><i /><i><ArrowUp size={28} strokeWidth={2.6} /></i></span>
        <div className="drop-title">{dragging ? 'שחרר כדי להוסיף' : 'גרור לכאן קבצים מכל סוג'}</div>
        <div className="drop-or">או</div>
        <span className="btn-primary drop-pick"><FolderOpen size={19} /> בחר מהמחשב</span>
        <div className="drop-kinds">{KINDS_TEXT.map((k) => <span key={k}>{k}</span>)}</div>
      </div>
    </button>
  );
}
