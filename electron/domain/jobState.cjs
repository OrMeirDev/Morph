// Conversion job lifecycle. Every state change goes through transition(), owned by the
// ConversionCoordinator alone.
//
//   queued -> preparing -> converting -> verifying -> publishing -> completed
//   any non-terminal state -> failed | cancelled
//   any non-terminal state found after a crash/restart -> interrupted
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'unsupported']);
const NEXT = {
  queued: ['preparing'],
  preparing: ['converting'],
  converting: ['verifying'],
  verifying: ['publishing'],
  publishing: ['completed'],
};

function canTransition(from, to) {
  if (TERMINAL.has(from)) return false;
  if (to === 'failed' || to === 'cancelled' || to === 'interrupted') return true;
  return (NEXT[from] || []).includes(to);
}

function transition(job, to, patch = {}) {
  if (!canTransition(job.state, to)) throw new Error(`illegal-transition:${job.state}->${to}`);
  return { ...job, ...patch, state: to, updatedAt: Date.now() };
}

const isTerminal = (state) => TERMINAL.has(state);
const isActive = (state) => !TERMINAL.has(state);

module.exports = { transition, canTransition, isTerminal, isActive, TERMINAL };
