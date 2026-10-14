import React, { useEffect, useMemo, useState } from 'react';
import { Trash2, History as HistoryIcon, Search } from 'lucide-react';
import PageHeader from '../../components/PageHeader.jsx';
import { api } from '../../services/morphApi.js';
import HistoryRow from './HistoryRow.jsx';

export default function HistoryPage() {
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
          <HistoryRow key={h.i} entry={h} missing={missing[h.i]} onOpen={() => api.openFile(h.output)} onShow={() => api.showFile(h.output)} />
        ))}
      </section>
    </>
  );
}
