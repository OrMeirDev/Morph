// Shared display formatting. Pure functions: no React, no Electron, no app state.

// File sizes as Windows Explorer shows them: binary multiples (1 KB = 1024 bytes).
export function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export const baseName = (p) => String(p || '').split(/[\\/]/).pop();

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export function fmtNum(n) {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-6)) return n.toExponential(4);
  return n.toLocaleString('he-IL', { maximumFractionDigits: abs >= 100 ? 2 : 6 });
}

export const pad2 = (n) => String(n).padStart(2, '0');
