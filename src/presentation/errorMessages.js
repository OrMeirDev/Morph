// Turns an engine/coordinator error code or message into a short Hebrew sentence for the user.
export function friendlyError(msg = '') {
  const m = String(msg || '');
  if (m.startsWith('missing-tool')) return 'כלי ההמרה חסר. נסה להתקין את Morph מחדש.';
  if (m.startsWith('unsupported') || m.startsWith('target-not-allowed')) return 'ההמרה הזו לא נתמכת';
  if (m.startsWith('file-changed') || m.startsWith('unknown-file')) return 'הקובץ השתנה או הוסר מאז שנוסף. הוסף אותו שוב.';
  if (m.startsWith('archive-')) return 'הארכיון חורג מהמגבלות הבטוחות או מכיל נתיבים לא תקינים';
  if (m.startsWith('no-space')) return 'אין מספיק מקום פנוי בדיסק';
  if (m.startsWith('timeout')) return 'ההמרה לקחה יותר מדי זמן ונעצרה';
  if (m.startsWith('invalid-output')) return 'ההמרה הסתיימה אבל הקובץ שנוצר לא תקין, ולכן לא נשמר';
  if (/password|encrypted/i.test(m)) return 'הקובץ מוגן בסיסמה';
  if (/Invalid data|corrupt|damaged|moov atom/i.test(m)) return 'הקובץ פגום או לא קריא';
  return 'ההמרה נכשלה';
}
