// What the user should know before choosing a conversion that changes more than file size.
// Keys are the fidelity categories from electron/domain/capabilities.cjs; categories that only
// trade quality for size (lossy, lossless, repack) carry no note, and neither does 'flatten'
// (JPG fills transparency with white), which would show on every image, opaque ones included.
const NOTES = {
  'single-frame': 'רק התמונה הראשונה תישמר',
  'vector-approx': 'ה-SVG יהיה שרטוט מקורב של התמונה, בצבעים מוגבלים',
  reconstruct: 'הפריסה נבנית מחדש; עיצוב מורכב עשוי להשתנות',
  'text-only': 'רק הטקסט יישמר, בלי עיצוב',
  'first-sheet': 'רק הגיליון הראשון יישמר, כערכים בלבד',
  rasterize: 'העמודים יהפכו לתמונות',
  resized: 'עד 256×256 פיקסלים',
  'audio-only': 'רק השמע יישמר',
  resampled: 'קצב התמונות והרוחב יוקטנו (עד 720 פיקסלים)',
};

export const fidelityNote = (category) => NOTES[category] || null;

// Direction-specific losses seen in the engine tests (electron/domain/capabilities.cjs KNOWN_LIMITS).
export const LIMIT_NOTES = {
  'rtl-paragraphs-lost': 'הטקסט בעברית יישמר, אבל כיוון הפסקאות (ימין לשמאל) לא יסומן ב-Word',
};
export const limitNotes = (ids = []) => ids.map((id) => LIMIT_NOTES[id]).filter(Boolean);

// Engine capability IDs -> the tool name a user would recognise.
const TOOL_OF = { ffmpeg: 'ffmpeg', ffprobe: 'ffmpeg', images: 'sharp', pdftoppm: 'Poppler', pdftotext: 'Poppler', pdfinfo: 'Poppler', soffice: 'LibreOffice', calibre: 'Calibre', sevenzip: '7-Zip' };
export const missingToolNames = (caps = []) => [...new Set(caps.map((c) => TOOL_OF[c.split(':')[0]] || c.split(':')[0]))];
