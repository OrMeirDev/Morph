// A private scratch folder per job under <tmp>/morph-jobs/<jobId>, removed when the job ends.
// Engines write intermediate files here; final outputs are published by OutputPublisher.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const defaultRoot = () => path.join(os.tmpdir(), 'morph-jobs');
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

async function createWorkspace(jobId, { root = defaultRoot() } = {}) {
  if (!SAFE_ID.test(jobId)) throw new Error('bad-job-id');
  await fsp.mkdir(root, { recursive: true, mode: 0o700 });
  const dir = path.join(root, jobId);
  await fsp.mkdir(dir, { mode: 0o700 }); // fails if it exists: one workspace per job
  return {
    dir,
    file: (name) => path.join(dir, name),
    async freeBytes() {
      try { const s = await fsp.statfs(dir); return s.bavail * s.bsize; } catch { return Infinity; }
    },
    cleanup: () => fsp.rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {}),
  };
}

// Startup: remove workspaces left by a crash (none are in use before the first job starts).
async function sweepWorkspaces({ root = defaultRoot(), keep = new Set() } = {}) {
  let names = [];
  try { names = await fsp.readdir(root); } catch { return 0; }
  let removed = 0;
  for (const n of names) {
    if (keep.has(n)) continue;
    await fsp.rm(path.join(root, n), { recursive: true, force: true }).catch(() => {});
    removed++;
  }
  return removed;
}

module.exports = { createWorkspace, sweepWorkspaces, defaultRoot };
