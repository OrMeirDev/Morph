import React from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { fmtSize } from '../../presentation/formatters.js';
import ConversionRow from './ConversionRow.jsx';

export default function ConversionQueue({ items, totalSize, canClear, onClear, actions }) {
  return (
    <>
      <div className="list-header">
        <h2>הקבצים שלך <span className="badge">{items.length}</span></h2>
        {items.length > 0 && (
          <span className="muted list-meta">
            <bdi dir="ltr">{fmtSize(totalSize)}</bdi>
            {canClear && <button className="link-btn" onClick={onClear}>נקה את מה שהסתיים</button>}
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
        {items.map((item) => <ConversionRow key={item.id} item={item} actions={actions} />)}
      </section>
    </>
  );
}
