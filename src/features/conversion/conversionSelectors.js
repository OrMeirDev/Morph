// Pure selectors over the conversion list (no React, no Electron).

// Row statuses that can be (re)started by "convert all".
export const STARTABLE = ['ready', 'cancelled', 'error'];
// Row statuses still waiting on, or inside, a conversion.
export const PENDING = ['ready', 'cancelled', 'error', 'queued', 'converting'];
export const ACTIVE = ['queued', 'converting'];

// "Convert all images to …": one control per kind present, offering only targets every file of that
// kind can reach. `current` is the shared target, or '' when the files differ.
export function formatGroups(items) {
  const map = new Map();
  for (const x of items) {
    if (x.status === 'unsupported') continue;
    const g = map.get(x.kind) || { kind: x.kind, count: 0, targets: null, current: null };
    g.count++;
    g.targets = g.targets ? g.targets.filter((t) => x.targets.includes(t)) : [...x.targets];
    g.current = g.current === null ? x.target : (g.current === x.target ? g.current : '');
    map.set(x.kind, g);
  }
  return [...map.values()].filter((g) => g.targets.length);
}

export function conversionCounts(items) {
  return {
    pending: items.filter((x) => PENDING.includes(x.status)).length,
    done: items.filter((x) => x.status === 'done').length,
    failed: items.filter((x) => x.status === 'error').length,
    total: items.reduce((s, x) => s + (x.size || 0), 0),
  };
}

// A new target choice resets a finished/failed row back to ready; other states keep theirs.
export const withTarget = (x, target) => ({ ...x, target, status: x.status === 'done' || x.status === 'error' ? 'ready' : x.status });

export function applyGroupTarget(items, kind, target) {
  return items.map((x) => (
    x.kind === kind && x.targets.includes(target) && !ACTIVE.includes(x.status) ? withTarget(x, target) : x));
}

export const hasClearable = (items) => items.some((x) => x.status === 'done' || x.status === 'unsupported');
export const withoutFinished = (items) => items.filter((x) => !['done', 'unsupported'].includes(x.status));

export function saveWhereText(settings) {
  return settings?.outputMode === 'folder'
    ? `נשמר בתיקייה ${settings.folder.split(/[\\/]/).slice(-2).join(' / ')}`
    : 'נשמר ליד הקובץ המקורי';
}
