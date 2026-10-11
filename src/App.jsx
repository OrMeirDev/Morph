import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight, Ruler, History, Settings, Home, ChevronLeft, UploadCloud, Film, Music, Image as ImageIcon,
  FileText, FileSpreadsheet, Presentation, BookOpen, Archive, Shapes, Clapperboard, X, FolderOpen,
  Square, RotateCw, Check, AlertTriangle, Loader2, Sparkles, Download, RefreshCw, ExternalLink,
} from 'lucide-react';
import { HistoryPage, SettingsPage, UnitsPage } from './pages.jsx';

const api = window.morph;

const PAGES = [
  { id: 'convert', icon: ArrowLeftRight, label: 'המרה' },
  { id: 'units', icon: Ruler, label: 'יחידות וזמן' },
  { id: 'history', icon: History, label: 'היסטוריה' },
  { id: 'settings', icon: Settings, label: 'הגדרות' },
];

// Visual identity per detected kind.
const KIND_STYLE = {
  video: { icon: Film, cls: 't-vid', group: 'וידאו' },
  audio: { icon: Music, cls: 't-aud', group: 'אודיו' },
  image: { icon: ImageIcon, cls: 't-img', group: 'תמונות' },
  gif: { icon: Clapperboard, cls: 't-vid', group: 'GIF' },
  apng: { icon: Clapperboard, cls: 't-vid', group: 'APNG' },
  svg: { icon: Shapes, cls: 't-img', group: 'SVG' },
  pdf: { icon: FileText, cls: 't-doc', group: 'PDF' },
  doc: { icon: FileText, cls: 't-doc', group: 'מסמכים' },
  sheet: { icon: FileSpreadsheet, cls: 't-sheet', group: 'גיליונות' },
  slides: { icon: Presentation, cls: 't-doc', group: 'מצגות' },
  ebook: { icon: BookOpen, cls: 't-book', group: 'ספרים' },
  archive: { icon: Archive, cls: 't-zip', group: 'ארכיונים' },
};

const FORMAT_LABEL = { docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', odt: 'ODT', ods: 'ODS', odp: 'ODP', 'tar.gz': 'TAR.GZ', txt: 'טקסט' };
export const fmtLabel = (t) => FORMAT_LABEL[t] || t.toUpperCase();

export function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const baseName = (p) => p.split(/[\\/]/).pop();

function friendlyError(msg = '') {
  if (msg.startsWith('missing-tool')) return 'כלי ההמרה חסר. נסה להתקין את Morph מחדש.';
  if (msg.startsWith('unsupported')) return 'ההמרה הזו לא נתמכת';
  if (/password|encrypted/i.test(msg)) return 'הקובץ מוגן בסיסמה';
  if (/Invalid data|corrupt|damaged|moov atom/i.test(msg)) return 'הקובץ פגום או לא קריא';
  return 'ההמרה נכשלה';
}

function UpdateBanner({ status, onDownload, onInstall }) {
  if (!status || !['available', 'downloading', 'ready'].includes(status.state)) return null;
  return (
    <div className="update-banner">
      <Sparkles size={20} />
      <div className="update-text">
        {status.state === 'available' && <>גרסה חדשה של Morph זמינה: <b>{status.version}</b></>}
        {status.state === 'downloading' && (
          <>מוריד את העדכון… {status.percent || 0}%
            <div className="progress update-progress"><div style={{ width: `${status.percent || 0}%` }} /></div></>
        )}
        {status.state === 'ready' && <>העדכון לגרסה <b>{status.version}</b> מוכן. הפעל מחדש כדי להתקין.</>}
      </div>
      {status.state === 'available' && <button className="btn-primary small" onClick={onDownload}><Download size={16} /> עדכן עכשיו</button>}
      {status.state === 'ready' && <button className="btn-primary small" onClick={onInstall}><RefreshCw size={16} /> הפעל מחדש</button>}
    </div>
  );
}

function Sidebar({ page, onNavigate, tools, appVersion }) {
  const missing = tools ? Object.entries(tools).filter(([, ok]) => !ok).length : 0;
  return (
    <aside className="sidebar">
      <div className="brand">
        <span>Morph</span>
        <ArrowLeftRight size={28} strokeWidth={2.4} className="brand-icon" />
      </div>
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

function FileRow({ item, actions }) {
  const style = KIND_STYLE[item.kind] || { icon: FileText, cls: 't-doc' };
  const Icon = style.icon;
  const busy = item.status === 'converting';
  const unsupported = item.status === 'unsupported';
  return (
    <div className={`file-row ${unsupported ? 'unsupported' : ''}`}>
      <span className={`kind-icon ${unsupported ? 't-bad' : style.cls}`}>{unsupported ? <AlertTriangle size={18} /> : <Icon size={18} />}</span>
      <div className="file-info">
        <div className="file-name">
          <span className="name-text" title={item.path}>{baseName(item.path)}</span>
          {!unsupported && <span className={`kind-tag ${style.cls}`}>{item.label}</span>}
        </div>
        <div className="file-meta">
          {unsupported && 'סוג הקובץ הזה לא נתמך להמרה'}
          {!unsupported && item.status !== 'converting' && (
            <>
              <bdi dir="ltr">{fmtSize(item.size)}</bdi>
              {item.renamed && <span className="warn-text"> · הסיומת היא .{item.renamed} אבל הקובץ הוא בעצם {fmtLabel(item.ext)}</span>}
              {item.status === 'done' && <> · נוצר: {baseName(item.output)}</>}
              {item.status === 'error' && <span className="err-text"> · {friendlyError(item.error)}</span>}
              {item.status === 'queued' && ' · ממתין בתור'}
            </>
          )}
          {busy && (
            <div className="row-progress">
              <span>{item.progress == null ? 'ממיר…' : `${Math.round(item.progress)}%`}</span>
              <div className={`progress ${item.progress == null ? 'indeterminate' : ''}`}><div style={{ width: `${item.progress ?? 30}%` }} /></div>
            </div>
          )}
        </div>
      </div>

      <div className="row-actions">
        {!unsupported && (
          <select
            className="target-select"
            value={item.target}
            disabled={busy || item.status === 'queued'}
            onChange={(e) => actions.setTarget(item.id, e.target.value)}
            aria-label="פורמט יעד"
          >
            {item.targets.map((t) => <option key={t} value={t}>{fmtLabel(t)}</option>)}
          </select>
        )}
        {item.status === 'done' && (
          <>
            <span className="pill pill-success"><Check size={14} /> הושלם</span>
            <button className="icon-btn" title="פתח" onClick={() => api.openFile(item.output)}><ExternalLink size={17} /></button>
            <button className="icon-btn" title="הצג בתיקייה" onClick={() => api.showFile(item.output)}><FolderOpen size={17} /></button>
          </>
        )}
        {(item.status === 'ready' || item.status === 'cancelled') && (
          <button className="icon-btn accent" title="המר רק את זה" onClick={() => actions.convertOne(item.id)}><ArrowLeftRight size={17} /></button>
        )}
        {item.status === 'error' && (
          <button className="icon-btn danger" title="נסה שוב" onClick={() => actions.convertOne(item.id)}><RotateCw size={17} /></button>
        )}
        {busy && <button className="icon-btn" title="עצור" onClick={() => actions.stop(item.id)}><Square size={15} /></button>}
        {!busy && <button className="icon-btn ghost" title="הסר מהרשימה" onClick={() => actions.remove(item.id)}><X size={17} /></button>}
      </div>
    </div>
  );
}

let nextId = 1;

export default function App() {
  const [page, setPage] = useState('convert');
  const [items, setItems] = useState([]);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [settings, setSettings] = useState(null);
  const [tools, setTools] = useState(null);
  const [appVersion, setAppVersion] = useState('');
  const [appUpdate, setAppUpdate] = useState(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const update = useCallback((id, patch) => {
    setItems((list) => list.map((x) => (x.id === id ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x)));
  }, []);

  useEffect(() => {
    if (!api) return;
    api.getSettings().then(setSettings);
    api.toolStatus().then(setTools);
    api.appVersion().then(setAppVersion);
    const offUpdate = api.onAppUpdate(setAppUpdate);
    const offProgress = api.onProgress(({ id, percent }) => update(id, { progress: percent }));
    return () => { offUpdate(); offProgress(); };
  }, [update]);

  const saveSettings = (patch) => {
    setSettings((s) => ({ ...s, ...patch }));
    api.setSettings(patch);
  };

  const addPaths = async (paths) => {
    const known = new Set(itemsRef.current.map((x) => x.path));
    const fresh = [...new Set(paths)].filter((p) => p && !known.has(p));
    if (!fresh.length) return;
    const detected = await api.detect(fresh);
    setItems((list) => [
      ...list,
      ...detected.map((d) => (d.ok
        ? { id: nextId++, path: d.path, kind: d.kind, label: d.label, ext: d.ext, size: d.size, targets: d.targets, target: d.defaultTarget, renamed: d.renamed, status: 'ready', progress: null }
        : { id: nextId++, path: d.path, size: d.size, targets: [], status: 'unsupported' })),
    ]);
  };

  // Same entry point as a drop, for automated UI checks (no file dialog needed).
  window.__morphAdd = addPaths;

  // Drop anywhere on the convert page.
  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
    addPaths(paths);
  };

  // Runner: one conversion at a time, in list order.
  useEffect(() => {
    if (!running || !api) return;
    if (items.some((x) => x.status === 'converting')) return;
    const next = items.find((x) => x.status === 'queued');
    if (!next) { setRunning(false); return; }
    update(next.id, { status: 'converting', progress: null, error: null });
    api.start({ id: next.id, input: next.path, kind: next.kind, ext: next.ext, target: next.target }).then((r) => {
      if (r.ok) {
        update(next.id, { status: 'done', output: r.output, progress: 100 });
        api.addHistory({ name: baseName(next.path), from: next.ext, to: next.target, output: r.output });
      } else if (r.cancelled) {
        update(next.id, { status: 'cancelled', progress: null });
      } else {
        update(next.id, { status: 'error', error: r.error, progress: null });
      }
    });
  }, [items, running, update]);

  const actions = {
    setTarget: (id, target) => update(id, (x) => ({ target, status: x.status === 'done' || x.status === 'error' ? 'ready' : x.status })),
    convertOne: (id) => { update(id, { status: 'queued', error: null }); setRunning(true); },
    stop: (id) => api.stop(id),
    remove: (id) => setItems((list) => list.filter((x) => x.id !== id)),
  };

  const convertAll = () => {
    setItems((list) => list.map((x) => (['ready', 'cancelled', 'error'].includes(x.status) ? { ...x, status: 'queued', error: null } : x)));
    setRunning(true);
  };
  const clearDone = () => setItems((list) => list.filter((x) => !['done', 'unsupported'].includes(x.status)));

  // "Convert all images to …": one control per kind present, offering only that kind's targets.
  const groups = useMemo(() => {
    const map = new Map();
    for (const x of items) {
      if (x.status === 'unsupported') continue;
      const g = map.get(x.kind) || { kind: x.kind, count: 0, targets: null, current: null };
      g.count++;
      g.targets = g.targets ? g.targets.filter((t) => x.targets.includes(t)) : [...x.targets];
      g.current = g.current === null ? x.target : (g.current === x.target ? g.current : '');
      map.set(x.kind, g);
    }
    return [...map.values()].filter((g) => g.targets.length);
  }, [items]);
  const setGroupTarget = (kind, target) => setItems((list) => list.map((x) => (
    x.kind === kind && x.targets.includes(target) && !['converting', 'queued'].includes(x.status)
      ? { ...x, target, status: x.status === 'done' || x.status === 'error' ? 'ready' : x.status }
      : x)));

  const counts = useMemo(() => ({
    pending: items.filter((x) => ['ready', 'cancelled', 'error', 'queued', 'converting'].includes(x.status)).length,
    done: items.filter((x) => x.status === 'done').length,
    failed: items.filter((x) => x.status === 'error').length,
    total: items.reduce((s, x) => s + (x.size || 0), 0),
  }), [items]);

  const saveWhere = settings?.outputMode === 'folder'
    ? `נשמר בתיקייה ${settings.folder.split(/[\\/]/).slice(-2).join(' / ')}`
    : 'נשמר ליד הקובץ המקורי';

  return (
    <div className="app">
      <Sidebar page={page} onNavigate={setPage} tools={tools} appVersion={appVersion} />
      <main
        className="main"
        onDragOver={(e) => { if (page === 'convert') { e.preventDefault(); setDragging(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
        onDrop={(e) => (page === 'convert' ? onDrop(e) : e.preventDefault())}
      >
        <div className="breadcrumbs"><Home size={16} /> <ChevronLeft size={14} /> <span>{PAGES.find((p) => p.id === page).label}</span></div>
        <UpdateBanner
          status={appUpdate}
          onDownload={() => { setAppUpdate((s) => ({ ...s, state: 'downloading', percent: 0 })); api.downloadAppUpdate(); }}
          onInstall={() => api.installAppUpdate()}
        />

        {page === 'units' && <UnitsPage />}
        {page === 'history' && <HistoryPage />}
        {page === 'settings' && settings && (
          <SettingsPage
            settings={settings} onChange={saveSettings} tools={tools}
            app={{ version: appVersion, status: appUpdate, check: async () => {
              setAppUpdate({ state: 'checking' });
              if (!(await api.checkAppUpdate())) setAppUpdate({ state: 'dev' });
            } }}
          />
        )}

        {page === 'convert' && (<>
          <header className="page-header">
            <div>
              <h1>המרת קבצים</h1>
              <p className="subtitle">גוררים כל קובץ. Morph מזהה מה זה ומציע רק את מה שאפשר.</p>
            </div>
          </header>

          <button className={`drop-zone ${dragging ? 'dragging' : ''} ${items.length ? 'compact' : ''}`} onClick={async () => addPaths(await api.pickFiles())}>
            <UploadCloud size={items.length ? 22 : 34} />
            <div>
              <div className="drop-title">{dragging ? 'שחרר כדי להוסיף' : <>גרור לכאן קבצים מכל סוג, או <u>בחר מהמחשב</u></>}</div>
              <div className="drop-sub">וידאו, אודיו, תמונות, PDF, Word, Excel, מצגות, ספרים דיגיטליים, ארכיונים</div>
            </div>
          </button>

          {groups.length > 1 && (
            <div className="group-bar">
              <span className="muted">המר את כל ה־</span>
              {groups.map((g) => {
                const Icon = KIND_STYLE[g.kind]?.icon || FileText;
                return (
                  <label key={g.kind} className="group-chip">
                    <Icon size={15} className={KIND_STYLE[g.kind]?.cls} />
                    {KIND_STYLE[g.kind]?.group} ({g.count}) ל־
                    <select value={g.current || ''} onChange={(e) => setGroupTarget(g.kind, e.target.value)}>
                      {!g.current && <option value="">שונים</option>}
                      {g.targets.map((t) => <option key={t} value={t}>{fmtLabel(t)}</option>)}
                    </select>
                  </label>
                );
              })}
            </div>
          )}

          <div className="list-header">
            <h2>הקבצים שלך <span className="badge">{items.length}</span></h2>
            {items.length > 0 && (
              <span className="muted list-meta">
                <bdi dir="ltr">{fmtSize(counts.total)}</bdi>
                {(counts.done > 0 || items.some((x) => x.status === 'unsupported')) && (
                  <button className="link-btn" onClick={clearDone}>נקה את מה שהסתיים</button>
                )}
              </span>
            )}
          </div>

          <section className="file-list">
            {items.length === 0 && (
              <div className="empty">
                <ArrowLeftRight size={26} />
                <div>עוד אין קבצים. גרור קבצים לכאן, ולכל אחד יופיעו רק הפורמטים שאפשר להמיר אליו.</div>
              </div>
            )}
            {items.map((item) => <FileRow key={item.id} item={item} actions={actions} />)}
          </section>

          <footer className="action-bar">
            <span className="muted save-where">{saveWhere} · אפשר לשנות בהגדרות</span>
            <div className="action-main">
              <span className="muted summary">
                {counts.done ? `${counts.done} הושלמו` : ''}{counts.failed ? ` · ${counts.failed} נכשלו` : ''}
              </span>
              <button className="btn-primary big" onClick={convertAll} disabled={!counts.pending || running}>
                {running ? <Loader2 size={18} className="spin" /> : <ArrowLeftRight size={18} />}
                {running ? 'ממיר…' : `המר הכול${counts.pending ? ` (${counts.pending})` : ''}`}
              </button>
            </div>
          </footer>
        </>)}
      </main>
    </div>
  );
}
