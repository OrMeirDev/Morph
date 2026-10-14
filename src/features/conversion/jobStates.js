// Coordinator job states (electron/domain/jobState.cjs) -> the row statuses the UI shows.
const ROW_STATUS = {
  queued: 'queued',
  preparing: 'converting',
  converting: 'converting',
  verifying: 'converting',
  publishing: 'converting',
  completed: 'done',
  failed: 'error',
  cancelled: 'cancelled',
  interrupted: 'error',
};

export const rowStatusOf = (state) => ROW_STATUS[state] || 'error';

// Applies one coordinator update to a row. Updates for an older attempt of the same file (a late
// event after a retry) are ignored.
export function applyJobUpdate(item, u) {
  if (item.jobId && u.jobId !== item.jobId && (u.attempt || 0) < (item.attempt || 0)) return item;
  const status = rowStatusOf(u.state);
  return {
    ...item,
    jobId: u.jobId,
    attempt: u.attempt,
    status,
    progress: status === 'converting' ? (u.state === 'preparing' ? null : u.progress) : status === 'done' ? 100 : null,
    output: u.output || (status === 'done' ? item.output : null),
    error: status === 'error' ? u.error : null,
  };
}

// A detection result -> a new row.
export function rowFromDetection(d) {
  if (d.ok) {
    return { id: d.id, path: d.path, kind: d.kind, label: d.label, ext: d.ext, size: d.size, targets: d.targets, target: d.defaultTarget,
      fidelity: d.fidelity || {}, renamed: d.renamed, confidence: d.confidence, status: 'ready', progress: null };
  }
  return { id: `x-${d.path}-${Math.random().toString(36).slice(2)}`, path: d.path, size: d.size, kind: d.kind, label: d.label, targets: [], status: 'unsupported', reason: d.error, missing: d.missing || [] };
}
