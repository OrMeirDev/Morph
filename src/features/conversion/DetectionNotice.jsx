import React from 'react';
import { fmtLabel } from '../../presentation/formatCatalog.js';

// Shown when the content says a different format than the file name (e.g. a ".jpg" that is WEBP).
export default function DetectionNotice({ item }) {
  if (!item.renamed) return null;
  return <span className="warn-text"> · הסיומת היא .{item.renamed} אבל הקובץ הוא בעצם {fmtLabel(item.ext)}</span>;
}
