import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight, Trash2, FolderOpen, ExternalLink, History as HistoryIcon, RefreshCw, Check, X, Clock, Search,
} from 'lucide-react';
import GlassSelect from './glass-select.jsx';
import { GlassDate, GlassTime } from './glass-pickers.jsx';
import { fmtLabel } from './App.jsx';

const api = window.morph;

function PageHeader({ title, subtitle, children }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      <div className="header-actions">{children}</div>
    </header>
  );
}

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

// ---------------- History ----------------

export function HistoryPage() {
  const [items, setItems] = useState([]);
  const [missing, setMissing] = useState({});
  const [q, setQ] = useState('');

  const load = async () => {
    const list = await api.getHistory();
    setItems(list);
    const flags = {};
    await Promise.all(list.map(async (h, i) => { flags[i] = !(await api.fileExists(h.output)); }));
    setMissing(flags);
  };
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => items.map((h, i) => ({ ...h, i })).filter((h) => !q || h.name.toLowerCase().includes(q.toLowerCase())), [items, q]);

  const clear = async () => {
    if (!window.confirm('למחוק את כל ההיסטוריה? הקבצים עצמם לא יימחקו.')) return;
    await api.clearHistory();
    load();
  };

  return (
    <>
      <PageHeader title="היסטוריה" subtitle="כל ההמרות שעשית, מהחדשה לישנה.">
        {items.length > 0 && <button className="btn-ghost" onClick={clear}><Trash2 size={16} /> נקה היסטוריה</button>}
      </PageHeader>
      {items.length > 0 && (
        <label className="search"><Search size={17} /><input placeholder="חיפוש לפי שם" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      )}
      <section className="list">
        {items.length === 0 && <div className="empty"><HistoryIcon size={26} /><div>עוד לא המרת קבצים. המרות שיסתיימו יופיעו כאן.</div></div>}
        {shown.map((h) => (
          <div key={h.i} className="row">
            <span className="row-icon"><ArrowLeftRight size={18} /></span>
            <div className="row-info">
              <div className="row-name">{h.name}</div>
              <div className="row-meta">
                {fmtLabel(h.from)} ← {fmtLabel(h.to)} · {fmtDate(h.convertedAt)}
                {missing[h.i] && <span className="tag-muted"> · הקובץ הועבר או נמחק</span>}
              </div>
            </div>
            {!missing[h.i] && (
              <div className="row-actions">
                <button className="icon-btn" title="פתח" onClick={() => api.openFile(h.output)}><ExternalLink size={17} /></button>
                <button className="icon-btn" title="הצג בתיקייה" onClick={() => api.showFile(h.output)}><FolderOpen size={17} /></button>
              </div>
            )}
          </div>
        ))}
      </section>
    </>
  );
}

// ---------------- Settings ----------------

const TOOL_NAMES = {
  ffmpeg: ['ffmpeg', 'וידאו, אודיו ו-GIF'],
  images: ['sharp', 'תמונות'],
  poppler: ['Poppler', 'PDF לתמונות ולטקסט'],
  libreoffice: ['LibreOffice', 'Word, Excel, מצגות ו-PDF ל-Word'],
  calibre: ['Calibre', 'ספרים דיגיטליים'],
  sevenzip: ['7-Zip', 'ארכיונים'],
};

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

export function SettingsPage({ settings, onChange, tools, app }) {
  const chooseFolder = async () => {
    const dir = await api.chooseFolder();
    if (dir) onChange({ folder: dir, outputMode: 'folder' });
  };
  return (
    <>
      <PageHeader title="הגדרות" subtitle="ברירות המחדל לכל המרה. נשמרות אוטומטית." />
      <section className="card settings">
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
        <div className="setting">
          <div>
            <div className="setting-title">כלי ההמרה</div>
            <div className="tool-grid">
              {Object.entries(TOOL_NAMES).map(([key, [name, what]]) => (
                <span key={key} className={`tool-chip ${tools?.[key] ? 'ok' : 'bad'}`}>
                  {tools?.[key] ? <Check size={13} /> : <X size={13} />} <bdi dir="ltr">{name}</bdi> · {what}
                </span>
              ))}
            </div>
          </div>
        </div>
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

// ---------------- Units & time ----------------

const UNITS = {
  length: { label: 'אורך', units: { mm: ['מילימטר', 0.001], cm: ['סנטימטר', 0.01], m: ['מטר', 1], km: ['קילומטר', 1000], in: ['אינץ׳', 0.0254], ft: ['רגל', 0.3048], yd: ['יארד', 0.9144], mi: ['מייל', 1609.344] } },
  weight: { label: 'משקל', units: { mg: ['מיליגרם', 1e-6], g: ['גרם', 0.001], kg: ['קילוגרם', 1], t: ['טון', 1000], oz: ['אונקיה', 0.028349523125], lb: ['ליברה (פאונד)', 0.45359237] } },
  temperature: { label: 'טמפרטורה', units: { c: ['צלזיוס', null], f: ['פרנהייט', null], k: ['קלווין', null] } },
  volume: { label: 'נפח', units: { ml: ['מיליליטר', 0.001], l: ['ליטר', 1], m3: ['מטר מעוקב', 1000], tsp: ['כפית', 0.00492892], tbsp: ['כף', 0.0147868], cup: ['כוס (אמריקאית)', 0.236588], floz: ['אונקיית נוזל', 0.0295735], gal: ['גלון', 3.78541] } },
  area: { label: 'שטח', units: { cm2: ['סמ״ר', 1e-4], m2: ['מ״ר', 1], dunam: ['דונם', 1000], ha: ['הקטר', 1e4], km2: ['קמ״ר', 1e6], ft2: ['רגל רבועה', 0.09290304], acre: ['אקר', 4046.8564224] } },
  speed: { label: 'מהירות', units: { kmh: ['קמ״ש', 1 / 3.6], ms: ['מטר לשנייה', 1], mph: ['מייל לשעה', 0.44704], kn: ['קשר', 0.514444] } },
  data: { label: 'גודל קובץ', units: { b: ['בייט', 1], kb: ['KB', 1024], mb: ['MB', 1024 ** 2], gb: ['GB', 1024 ** 3], tb: ['TB', 1024 ** 4] } },
  time: { label: 'זמן', units: { ms: ['מילישנייה', 0.001], s: ['שנייה', 1], min: ['דקה', 60], h: ['שעה', 3600], d: ['יום', 86400], w: ['שבוע', 604800], mo: ['חודש', 2629746], y: ['שנה', 31556952] } },
};

function toCelsius(v, u) { return u === 'c' ? v : u === 'f' ? (v - 32) * 5 / 9 : v - 273.15; }
function fromCelsius(c, u) { return u === 'c' ? c : u === 'f' ? c * 9 / 5 + 32 : c + 273.15; }

function convertUnit(cat, value, from, to) {
  if (cat === 'temperature') return fromCelsius(toCelsius(value, from), to);
  const u = UNITS[cat].units;
  return (value * u[from][1]) / u[to][1];
}

function fmtNum(n) {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-6)) return n.toExponential(4);
  return n.toLocaleString('he-IL', { maximumFractionDigits: abs >= 100 ? 2 : 6 });
}

function UnitConverter() {
  const [cat, setCat] = useState('length');
  const unitKeys = Object.keys(UNITS[cat].units);
  const [from, setFrom] = useState('km');
  const [to, setTo] = useState('mi');
  const [value, setValue] = useState('1');

  const pickCat = (c) => {
    const keys = Object.keys(UNITS[c].units);
    setCat(c);
    setFrom(keys[Math.min(1, keys.length - 1)]);
    setTo(keys[Math.min(2, keys.length - 1)] || keys[0]);
  };
  const num = parseFloat(String(value).replace(/,/g, ''));
  const result = Number.isFinite(num) ? convertUnit(cat, num, from, to) : NaN;

  return (
    <section className="card tool-card">
      <h2>המרת יחידות</h2>
      <div className="cat-tabs">
        {Object.entries(UNITS).map(([k, c]) => (
          <button key={k} className={`cat-tab ${cat === k ? 'on' : ''}`} onClick={() => pickCat(k)}>{c.label}</button>
        ))}
      </div>
      <div className="unit-row">
        <input className="unit-input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} dir="ltr" />
        <GlassSelect className="plain-select" value={from} onChange={(e) => setFrom(e.target.value)}>
          {unitKeys.map((k) => <option key={k} value={k}>{UNITS[cat].units[k][0]}</option>)}
        </GlassSelect>
        <button className="icon-btn" title="החלף כיוון" onClick={() => { setFrom(to); setTo(from); }}><ArrowLeftRight size={17} /></button>
        <GlassSelect className="plain-select" value={to} onChange={(e) => setTo(e.target.value)}>
          {unitKeys.map((k) => <option key={k} value={k}>{UNITS[cat].units[k][0]}</option>)}
        </GlassSelect>
      </div>
      <div className="unit-result">
        <span dir="ltr">{fmtNum(result)}</span> <span className="muted">{UNITS[cat].units[to][0]}</span>
      </div>
      <div className="unit-all">
        {unitKeys.filter((k) => k !== from).map((k) => (
          <div key={k} className="unit-all-row"><span className="muted">{UNITS[cat].units[k][0]}</span><span dir="ltr">{Number.isFinite(num) ? fmtNum(convertUnit(cat, num, from, k)) : '—'}</span></div>
        ))}
      </div>
    </section>
  );
}

const CITIES = [
  ['ירושלים', 'Asia/Jerusalem'], ['ניו יורק', 'America/New_York'], ['לוס אנג׳לס', 'America/Los_Angeles'], ['טורונטו', 'America/Toronto'],
  ['סאו פאולו', 'America/Sao_Paulo'], ['לונדון', 'Europe/London'], ['פריז', 'Europe/Paris'], ['ברלין', 'Europe/Berlin'],
  ['מוסקבה', 'Europe/Moscow'], ['דובאי', 'Asia/Dubai'], ['מומבאי', 'Asia/Kolkata'], ['בנגקוק', 'Asia/Bangkok'],
  ['סינגפור', 'Asia/Singapore'], ['טוקיו', 'Asia/Tokyo'], ['סידני', 'Australia/Sydney'], ['יוהנסבורג', 'Africa/Johannesburg'],
];

// Wall-clock parts of an instant in a time zone.
function partsIn(date, timeZone) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}
const zoneOffsetMs = (date, tz) => {
  const p = partsIn(date, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(date.getTime() / 60000) * 60000;
};
// The instant when the wall clock in `tz` reads the given date and time.
function instantFor(dateStr, timeStr, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - zoneOffsetMs(new Date(guess), tz);
  t = guess - zoneOffsetMs(new Date(t), tz); // second pass handles DST edges
  return new Date(t);
}

const pad = (n) => String(n).padStart(2, '0');
function nowIn(tz) {
  const p = partsIn(new Date(), tz);
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

function WorldClock() {
  const [base, setBase] = useState('Asia/Jerusalem');
  const [date, setDate] = useState(() => nowIn('Asia/Jerusalem').date);
  const [time, setTime] = useState(() => nowIn('Asia/Jerusalem').time);
  const instant = useMemo(() => (date && time ? instantFor(date, time, base) : new Date()), [date, time, base]);
  const baseDay = partsIn(instant, base).d;

  return (
    <section className="card tool-card">
      <h2>שעון עולמי</h2>
      <div className="unit-row">
        <GlassSelect className="plain-select" value={base} onChange={(e) => setBase(e.target.value)}>
          {CITIES.map(([n, tz]) => <option key={tz} value={tz}>{n}</option>)}
        </GlassSelect>
        <GlassDate className="unit-input small" value={date} onChange={(e) => setDate(e.target.value)} />
        <GlassTime className="unit-input small" value={time} onChange={(e) => setTime(e.target.value)} />
        <button className="btn-ghost" onClick={() => { const n = nowIn(base); setDate(n.date); setTime(n.time); }}><Clock size={15} /> עכשיו</button>
      </div>
      <div className="clock-list">
        {CITIES.filter(([, tz]) => tz !== base).map(([name, tz]) => {
          const p = partsIn(instant, tz);
          const dayDiff = p.d - baseDay;
          const diffH = (zoneOffsetMs(instant, tz) - zoneOffsetMs(instant, base)) / 3600000;
          return (
            <div key={tz} className="clock-row">
              <span>{name}</span>
              <span className="muted small-note">{diffH === 0 ? 'אותה שעה' : `${diffH > 0 ? '+' : ''}${diffH} שע׳`}</span>
              <b dir="ltr">{pad(p.h)}:{pad(p.mi)}</b>
              <span className="muted small-note">{dayDiff === 0 ? '' : dayDiff > 0 || dayDiff < -20 ? 'מחר' : 'אתמול'}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function UnitsPage() {
  return (
    <>
      <PageHeader title="יחידות וזמן" subtitle="מחשבון המרות. מקלידים מספר ורואים את התוצאה מיד." />
      <div className="tools-grid">
        <UnitConverter />
        <WorldClock />
      </div>
    </>
  );
}
