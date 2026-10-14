// The one owner of conversion jobs: queue, concurrency, cancellation, verification, publication
// and history. The renderer sends commands (enqueue, cancel) and observes job updates; it never
// runs, finishes or records a conversion itself.
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { capabilityFor } = require('../domain/capabilities.cjs');
const { transition, isActive } = require('../domain/jobState.cjs');
const { CancelledError, isCancelled } = require('../infra/errors.cjs');
const { createWorkspace } = require('../infra/JobWorkspace.cjs');
const { publish, stagingPath, discardLeftovers } = require('../infra/OutputPublisher.cjs');
const { verifyArtifact } = require('../infra/artifactValidator.cjs');

const baseOf = (input) => path.basename(input).replace(/\.(tar\.)?[^.]+$/i, '');

class ConversionCoordinator {
  /**
   * @param {object} d dependencies
   * @param {import('./FileIntakeService.cjs').FileIntakeService} d.intake
   * @param {{ has(cap: string): boolean, path(name: string): string|null }} d.tools
   * @param {{ get(): object }} d.settings
   * @param {{ add(entry: object): object }} d.history
   * @param {{ put: Function, addLeftover: Function, remove: Function, all: Function }} d.journal
   * @param {Record<string, { run(ctx: object): Promise<{ path: string, isDir: boolean }> }>} d.adapters
   * @param {(name: string, args: string[], o: object) => Promise<object>} d.runTool
   * @param {(msg: object, o: object) => Promise<object>} d.runWorker
   * @param {object} d.officeProfiles
   * @param {(update: object) => void} d.emit
   */
  constructor(d) {
    Object.assign(this, d);
    this.concurrency = d.concurrency || 1;
    this.workspaceRoot = d.workspaceRoot;
    this.queue = []; // jobs waiting, in order
    this.byFile = new Map(); // fileId -> latest job
    this.running = new Set();
    this.idleWaiters = [];
    this.attempts = new Map(); // fileId -> attempt count
    this.lastProgressEmit = new Map();
  }

  // ---------- commands ----------

  enqueue({ fileId, target }) {
    const file = this.intake.get(fileId);
    if (!file) return { ok: false, error: 'unknown-file' };
    const current = this.byFile.get(fileId);
    if (current && isActive(current.state)) return { ok: false, error: 'already-active' };
    const cap = capabilityFor(file.kind, file.ext, target);
    if (!cap) return { ok: false, error: 'target-not-allowed' };
    const missing = cap.requires.filter((r) => !this.tools.has(r));
    if (missing.length) return { ok: false, error: `missing-tool:${missing.join(',')}` };
    const s = this.settings.get(); // snapshot: later settings changes do not touch a queued job
    const attempt = (this.attempts.get(fileId) || 0) + 1;
    this.attempts.set(fileId, attempt);
    const job = {
      id: crypto.randomUUID(),
      fileId,
      attempt,
      state: 'queued',
      input: file.realPath,
      displayName: path.basename(file.path),
      kind: file.kind,
      ext: file.ext,
      target,
      adapter: cap.adapter,
      fidelity: cap.fidelity,
      quality: s.quality,
      maxHeight: s.maxHeight,
      outDir: s.outputMode === 'folder' ? s.folder : path.dirname(file.realPath),
      progress: null,
      cancelRequested: false,
    };
    this.byFile.set(fileId, job);
    this.queue.push(job);
    this.journal.put(job.id, { fileId, input: job.input, target, state: 'queued', leftovers: [] });
    this.publishUpdate(job);
    this.pump();
    return { ok: true, jobId: job.id };
  }

  cancel(fileId) {
    const job = this.byFile.get(fileId);
    if (!job || !isActive(job.state)) return false;
    job.cancelRequested = true;
    const i = this.queue.indexOf(job);
    if (i >= 0) {
      this.queue.splice(i, 1);
      this.finish(job, 'cancelled');
      return true;
    }
    job.abort?.abort();
    return true;
  }

  // Cancels everything and resolves once no job is running (update install, app quit).
  cancelAll() {
    for (const job of [...this.queue]) this.cancel(job.fileId);
    for (const job of this.running) { job.cancelRequested = true; job.abort?.abort(); }
    return this.whenIdle();
  }

  whenIdle() {
    if (!this.running.size && !this.queue.length) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  isBusy(fileId) {
    const job = this.byFile.get(fileId);
    return !!job && isActive(job.state);
  }

  snapshot() { return [...this.byFile.values()].map((j) => this.dto(j)); }

  // ---------- internals ----------

  dto(j) {
    return { fileId: j.fileId, jobId: j.id, attempt: j.attempt, state: j.state, progress: j.progress, output: j.output || null, error: j.error || null, warnings: j.warnings || [] };
  }

  publishUpdate(job) { this.emit(this.dto(job)); }

  setState(job, state, patch = {}) {
    const next = transition(job, state, patch);
    Object.assign(job, next);
    this.publishUpdate(job);
  }

  finish(job, state, patch = {}) {
    this.setState(job, state, patch);
    this.journal.remove(job.id);
  }

  pump() {
    while (this.running.size < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      this.running.add(job);
      this.execute(job).finally(() => {
        this.running.delete(job);
        if (!this.running.size && !this.queue.length) this.idleWaiters.splice(0).forEach((r) => r());
        this.pump();
      });
    }
  }

  progress(job, pct) {
    job.progress = pct;
    const now = Date.now();
    if (now - (this.lastProgressEmit.get(job.id) || 0) < 100) return;
    this.lastProgressEmit.set(job.id, now);
    this.publishUpdate(job);
  }

  async execute(job) {
    const abort = new AbortController();
    job.abort = abort;
    if (job.cancelRequested) abort.abort();
    const throwIfCancelled = () => { if (abort.signal.aborted) throw new CancelledError(); };
    let workspace = null;
    let published;
    try {
      this.setState(job, 'preparing');
      this.intake.revalidate(job.fileId);
      throwIfCancelled();
      workspace = await createWorkspace(job.id, this.workspaceRoot ? { root: this.workspaceRoot } : undefined);
      this.journal.put(job.id, { state: 'preparing', workspace: workspace.dir });
      this.setState(job, 'converting');
      const ctx = {
        job,
        workspace,
        signal: abort.signal,
        throwIfCancelled,
        progress: (p) => this.progress(job, p),
        toolPath: (name) => this.tools.path(name),
        stagingFile: (ext) => {
          const p = stagingPath(job.outDir, job.id, ext);
          this.journal.addLeftover(job.id, p);
          return p;
        },
        run: (name, args, o = {}) => this.runTool(name, args, { ...o, signal: abort.signal }),
        worker: (msg, o = {}) => this.runWorker(msg, { ...o, signal: abort.signal, onProgress: (p) => this.progress(job, p) }),
        officeProfiles: this.officeProfiles,
      };
      await fsp.mkdir(job.outDir, { recursive: true });
      throwIfCancelled(); // Stop may have landed during the awaits above: never start the engine then
      const artifact = await this.adapters[job.adapter].run(ctx);
      throwIfCancelled();
      this.setState(job, 'verifying', { progress: 99 });
      await verifyArtifact(artifact, job.target);
      throwIfCancelled();
      this.setState(job, 'publishing');
      published = await publish({
        source: artifact.path,
        isDir: artifact.isDir,
        outDir: job.outDir,
        base: baseOf(job.input) + (artifact.folderSuffix || ''),
        ext: job.target,
        jobId: job.id,
        isCancelled: () => abort.signal.aborted,
        onReserve: (p) => this.journal.addLeftover(job.id, p),
      });
      // Past this point the output exists: a late Stop no longer applies.
      const warnings = [];
      try {
        this.history.add({ jobId: job.id, name: job.displayName, from: job.ext, to: job.target, output: published });
      } catch {
        warnings.push('history-not-saved');
      }
      this.setState(job, 'completed', { output: published, progress: 100, warnings });
    } catch (e) {
      // Error messages start with a short code ("timeout:ffmpeg", "invalid-output:empty",
      // "archive-link", "file-changed") or carry the engine's last stderr line.
      if (abort.signal.aborted || isCancelled(e)) this.setState(job, 'cancelled', { progress: null });
      else this.setState(job, 'failed', { progress: null, error: String(e?.message || e).slice(0, 300) });
    } finally {
      if (workspace) await workspace.cleanup();
      // Whatever this job staged but did not publish goes away; the published output never has a
      // staging name. Only then is the job dropped from the crash journal.
      await discardLeftovers([stagingPath(job.outDir, job.id, job.target), stagingPath(job.outDir, job.id, 'pages')]);
      this.journal.remove(job.id);
      this.lastProgressEmit.delete(job.id);
    }
  }
}

module.exports = { ConversionCoordinator, baseOf };
