// Error types shared by the engine layers. `code` is what reaches the UI (see
// src/presentation/errorMessages.js); messages stay short and never include file contents.
class CancelledError extends Error {
  constructor() { super('cancelled'); this.code = 'cancelled'; }
}
class TimeoutError extends Error {
  constructor(what) { super(`timeout:${what}`); this.code = 'timeout'; }
}
class ToolError extends Error {
  constructor(message, code = 'tool-failed') { super(message); this.code = code; }
}
const isCancelled = (e) => e instanceof CancelledError || e?.code === 'cancelled';

module.exports = { CancelledError, TimeoutError, ToolError, isCancelled };
