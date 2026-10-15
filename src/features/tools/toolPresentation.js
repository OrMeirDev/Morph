// How each conversion engine is named and described on the settings page.
export const TOOL_NAMES = {
  ffmpeg: ['ffmpeg', 'וידאו, אודיו ו-GIF'],
  images: ['sharp', 'תמונות'],
  poppler: ['Poppler', 'PDF לתמונות ולטקסט'],
  libreoffice: ['LibreOffice', 'Word, Excel, מצגות ו-PDF ל-Word'],
  calibre: ['Calibre', 'ספרים דיגיטליים'],
  sevenzip: ['7-Zip', 'ארכיונים'],
};

export const missingToolCount = (tools) => (tools ? Object.keys(TOOL_NAMES).filter((k) => !tools[k]).length : 0);

const ENGINE_NAMES = { soffice: 'LibreOffice', calibre: 'Calibre', ffmpeg: 'ffmpeg', ffprobe: 'ffmpeg', sevenzip: '7-Zip', pdftoppm: 'Poppler', pdftotext: 'Poppler', pdfinfo: 'Poppler' };

// One line about how the conversion engines are isolated (main: infra/Confinement.cjs). Never
// silent: anything other than full isolation says what is missing.
export function confinementText(c) {
  if (!c) return null;
  if (c.mode === 'enforced') {
    const partial = [...new Set(Object.entries(c.tools || {}).filter(([, v]) => v !== 'appcontainer').map(([k]) => ENGINE_NAMES[k] || k))];
    const base = 'בידוד: מנועי ההמרה רצים בלי גישה לרשת ובלי גישה לקבצים מחוץ להמרה הנוכחית, ונעצרים כולם בעצירה או בסגירה';
    return { ok: true, text: partial.length ? `${base}; ${partial.join(', ')} מוגבלים רק בזמן ובזיכרון` : base };
  }
  if (c.mode === 'unavailable') return { ok: false, text: `בידוד לא זמין, ולכן מנועי ההמרה חסומים: ${c.reason}` };
  if (c.mode === 'disabled') return { ok: false, text: 'הבידוד כבוי (MORPH_CONFINEMENT=off): מנועי ההמרה רצים בלי הגבלה' };
  return { ok: false, text: 'בידוד מנועים זמין רק ב-Windows' };
}
