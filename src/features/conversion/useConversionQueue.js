import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../services/morphApi.js';
import { ACTIVE, STARTABLE, applyGroupTarget, withTarget, withoutFinished } from './conversionSelectors.js';
import { applyJobUpdate, rowFromDetection } from './jobStates.js';

// The conversion list as the user sees it. Jobs themselves are owned by the coordinator in the
// main process: this hook sends commands (enqueue, cancel) and mirrors the job updates it reports.
export default function useConversionQueue() {
  const [items, setItems] = useState([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const update = useCallback((id, patch) => {
    setItems((list) => list.map((x) => (x.id === id ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x)));
  }, []);

  useEffect(() => {
    if (!api) return undefined;
    return api.onJobUpdate((u) => setItems((list) => list.map((x) => (x.id === u.fileId ? applyJobUpdate(x, u) : x))));
  }, []);

  const addDetected = useCallback((detected) => {
    setItems((list) => [...list, ...detected.map(rowFromDetection)]);
  }, []);

  // Every command ends in a definite row state, even when the IPC call itself fails.
  const start = useCallback(async (id) => {
    const item = itemsRef.current.find((x) => x.id === id);
    if (!item || !STARTABLE.includes(item.status)) return;
    update(id, { status: 'queued', error: null });
    try {
      const r = await api.enqueue(id, item.target);
      if (!r?.ok) update(id, { status: 'error', error: r?.error || 'enqueue-failed', progress: null });
    } catch (e) {
      update(id, { status: 'error', error: String(e?.message || e), progress: null });
    }
  }, [update]);

  const actions = {
    setTarget: (id, target) => update(id, (x) => withTarget(x, target)),
    convertOne: (id) => start(id),
    stop: (id) => api.cancel(id).catch(() => {}),
    remove: (id) => {
      setItems((list) => list.filter((x) => x.id !== id));
      if (!String(id).startsWith('x-')) api.releaseFile(id).catch(() => {});
    },
    openOutput: (item) => api.openOutput(item.output),
    showOutput: (item) => api.showOutput(item.output),
  };

  // In list order; the coordinator runs them one at a time in the order they arrive.
  const convertAll = async () => {
    for (const x of itemsRef.current.filter((i) => STARTABLE.includes(i.status))) await start(x.id);
  };
  const clearDone = () => {
    for (const x of itemsRef.current) if (x.status === 'done') api.releaseFile(x.id).catch(() => {});
    setItems(withoutFinished);
  };
  const setGroupTarget = (kind, target) => setItems((list) => applyGroupTarget(list, kind, target));
  const running = items.some((x) => ACTIVE.includes(x.status));

  return { items, itemsRef, running, actions, convertAll, clearDone, setGroupTarget, addDetected };
}
