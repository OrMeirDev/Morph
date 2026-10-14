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
