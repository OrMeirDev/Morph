import { useRef, useState } from 'react';
import { api } from '../../services/morphApi.js';

// Adding files: from a drop anywhere on the convert page, or from the file picker.
export default function useFileIntake({ itemsRef, addDetected, active }) {
  const [dragging, setDragging] = useState(false);
  // Paths being detected right now. Reserved synchronously, so two quick drops of the same file
  // cannot both pass the "already in the list" check while the first detection is still running.
  const pending = useRef(new Set());

  const addPaths = async (paths) => {
    const known = new Set(itemsRef.current.map((x) => x.path));
    const fresh = [...new Set(paths)].filter((p) => p && !known.has(p) && !pending.current.has(p));
    if (!fresh.length) return;
    fresh.forEach((p) => pending.current.add(p));
    try {
      addDetected(await api.detect(fresh));
    } catch {
      addDetected(fresh.map((p) => ({ ok: false, path: p, error: 'unreadable' })));
    } finally {
      fresh.forEach((p) => pending.current.delete(p));
    }
  };

  // Same entry point as a drop, for automated UI checks (no file dialog needed). Development and
  // e2e builds only: production bundles never carry it.
  if (import.meta.env.DEV || import.meta.env.VITE_E2E_HOOKS) window.__morphAdd = addPaths;

  const dropHandlers = {
    onDragOver: (e) => { if (active) { e.preventDefault(); setDragging(true); } },
    onDragLeave: (e) => { if (e.currentTarget === e.target) setDragging(false); },
    onDrop: (e) => {
      e.preventDefault();
      if (!active) return;
      setDragging(false);
      addPaths([...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean));
    },
  };

  return { dragging, dropHandlers, addPaths, pick: async () => addPaths(await api.pickFiles()) };
}
