// Unit categories for the calculator: key -> [Hebrew label, size in the category's base unit].
// Temperature has no single factor (see convertUnit.js). Pure data: no React, no Electron.
export const UNITS = {
  length: { label: 'אורך', units: { mm: ['מילימטר', 0.001], cm: ['סנטימטר', 0.01], m: ['מטר', 1], km: ['קילומטר', 1000], in: ['אינץ׳', 0.0254], ft: ['רגל', 0.3048], yd: ['יארד', 0.9144], mi: ['מייל', 1609.344] } },
  weight: { label: 'משקל', units: { mg: ['מיליגרם', 1e-6], g: ['גרם', 0.001], kg: ['קילוגרם', 1], t: ['טון', 1000], oz: ['אונקיה', 0.028349523125], lb: ['ליברה (פאונד)', 0.45359237] } },
  temperature: { label: 'טמפרטורה', units: { c: ['צלזיוס', null], f: ['פרנהייט', null], k: ['קלווין', null] } },
  volume: { label: 'נפח', units: { ml: ['מיליליטר', 0.001], l: ['ליטר', 1], m3: ['מטר מעוקב', 1000], tsp: ['כפית', 0.00492892], tbsp: ['כף', 0.0147868], cup: ['כוס (אמריקאית)', 0.236588], floz: ['אונקיית נוזל', 0.0295735], gal: ['גלון', 3.78541] } },
  area: { label: 'שטח', units: { cm2: ['סמ״ר', 1e-4], m2: ['מ״ר', 1], dunam: ['דונם', 1000], ha: ['הקטר', 1e4], km2: ['קמ״ר', 1e6], ft2: ['רגל רבועה', 0.09290304], acre: ['אקר', 4046.8564224] } },
  speed: { label: 'מהירות', units: { kmh: ['קמ״ש', 1 / 3.6], ms: ['מטר לשנייה', 1], mph: ['מייל לשעה', 0.44704], kn: ['קשר', 0.514444] } },
  // Decimal (SI) and binary multiples are different units: 1 KB = 1000 bytes, 1 KiB = 1024 bytes.
  // Windows Explorer shows binary sizes but labels them "KB"; the labels say which is which.
  data: { label: 'גודל קובץ', units: { b: ['בייט', 1], kb: ['KB (1000)', 1e3], mb: ['MB (1000²)', 1e6], gb: ['GB (1000³)', 1e9], tb: ['TB (1000⁴)', 1e12], kib: ['KiB (1024)', 1024], mib: ['MiB (1024²)', 1024 ** 2], gib: ['GiB (1024³)', 1024 ** 3], tib: ['TiB (1024⁴)', 1024 ** 4] } },
  // Months and years vary in length; these are Gregorian averages (365.2425 days per year).
  time: { label: 'זמן', units: { ms: ['מילישנייה', 0.001], s: ['שנייה', 1], min: ['דקה', 60], h: ['שעה', 3600], d: ['יום', 86400], w: ['שבוע', 604800], mo: ['חודש (ממוצע)', 2629746], y: ['שנה (ממוצעת)', 31556952] } },
};
