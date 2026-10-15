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

const ENGINE_NAMES = { soffice: 'LibreOffice', calibre: 'Calibre', ffmpeg: 'ffmpeg', ffprobe: 'ffmpeg', sevenzip: '7-Zip', pdftoppm: 'Poppler', pdftotext: 'Poppler', pdfinfo: 'Poppler', imageworker: 'עיבוד התמונות' };
const names = (c, tier) => [...new Set(Object.entries(c.tools || {}).filter(([, v]) => v === tier).map(([k]) => ENGINE_NAMES[k] || k))].join(', ');

// One line about how the conversion engines are isolated (main: infra/Confinement.cjs), per tier
// and with its conditions. Never silent: anything short of the tier's protection is stated.
export function confinementText(c) {
  if (!c) return null;
  if (c.mode === 'enforced') {
    const parts = ['בידוד: כל מנוע רץ ב-Job של Windows ונעצר כולו בעצירה או בסגירה'];
    const ac = names(c, 'appcontainer');
    const low = names(c, 'low-integrity');
    if (ac) parts.push(`${ac}: בלי רשת, ורק עם הקבצים שהוקצו להמרה (לא בכונני FAT32/exFAT)`);
    if (low) parts.push(`${low}: לא יכולים לכתוב לקבצים שלך, אבל יכולים לקרוא אותם ולהשתמש ברשת`);
    parts.push('זיהוי סוג הקובץ אינו מוגבל על ידי Windows');
    return { ok: true, text: parts.join('; ') };
  }
  if (c.mode === 'unavailable') return { ok: false, text: `בידוד לא זמין, ולכן מנועי ההמרה חסומים: ${c.reason}` };
  if (c.mode === 'disabled') return { ok: false, text: 'הבידוד כבוי (MORPH_CONFINEMENT=off): מנועי ההמרה רצים בלי הגבלה' };
  return { ok: false, text: 'בידוד מנועים זמין רק ב-Windows' };
}
