import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../services/morphApi.js';
import { baseName } from '../../presentation/formatters.js';
import { STARTABLE, applyGroupTarget, withTarget, withoutFinished } from './conversionSelectors.js';

let nextId = 1;

// The conversion list and its commands.
export default function useConversionQueue() {
  const [items, setItems] = useState([]);
  const [running, setRunning] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const update = useCallback((id, patch) => {
    setItems((list) => list.map((x) => (x.id === id ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x)));
  }, []);

  useEffect(() => {
    if (!api) return undefined;
    return api.onProgress(({ id, percent }) => update(id, { progress: percent }));
  }, [update]);

  const addDetected = useCallback((detected) => {
    setItems((list) => [
      ...list,
      ...detected.map((d) => (d.ok
        ? { id: nextId++, path: d.path, kind: d.kind, label: d.label, ext: d.ext, size: d.size, targets: d.targets, target: d.defaultTarget, renamed: d.renamed, status: 'ready', progress: null }
        : { id: nextId++, path: d.path, size: d.size, targets: [], status: 'unsupported' })),
    ]);
  }, []);

  // Runner: one conversion at a time, in list order.
  useEffect(() => {
    if (!running || !api) return;
    if (items.some((x) => x.status === 'converting')) return;
    const next = items.find((x) => x.status === 'queued');
    if (!next) { setRunning(false); return; }
    update(next.id, { status: 'converting', progress: null, error: null });
    api.start({ id: next.id, input: next.path, kind: next.kind, ext: next.ext, target: next.target }).then((r) => {
      if (r.ok) {
        update(next.id, { status: 'done', output: r.output, progress: 100 });
        api.addHistory({ name: baseName(next.path), from: next.ext, to: next.target, output: r.output });
      } else if (r.cancelled) {
        update(next.id, { status: 'cancelled', progress: null });
      } else {
        update(next.id, { status: 'error', error: r.error, progress: null });
      }
    });
  }, [items, running, update]);

  const actions = {
    setTarget: (id, target) => update(id, (x) => withTarget(x, target)),
    convertOne: (id) => { update(id, { status: 'queued', error: null }); setRunning(true); },
    stop: (id) => api.stop(id),
    remove: (id) => setItems((list) => list.filter((x) => x.id !== id)),
    openOutput: (item) => api.openFile(item.output),
    showOutput: (item) => api.showFile(item.output),
  };

  const convertAll = () => {
    setItems((list) => list.map((x) => (STARTABLE.includes(x.status) ? { ...x, status: 'queued', error: null } : x)));
    setRunning(true);
  };
  const clearDone = () => setItems(withoutFinished);
  const setGroupTarget = (kind, target) => setItems((list) => applyGroupTarget(list, kind, target));

  return { items, itemsRef, running, actions, convertAll, clearDone, setGroupTarget, addDetected };
}
