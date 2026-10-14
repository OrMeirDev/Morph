// Puts a verified artifact at its final name without ever overwriting anything: not the
// original, not an earlier output, not another job's output.
//
// Files: the artifact is staged next to the destination (same disk, hidden-ish ".~morph-<job>"
// name), the final name is reserved with an exclusive create, and the staged file is renamed
// over that reservation in one step. A crash can leave only a ".~morph-" staging file or an empty
// reservation; both are recorded in the job journal and removed on the next start.
// Folders (PDF pages): staged the same way and renamed into a name that did not exist.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { CancelledError } = require('./errors.cjs');

const reserved = new Set(); // in-process reservations (normalised paths)
const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

const stagingName = (jobId, ext) => `.~morph-${jobId}${ext ? `.${ext}` : ''}`;
const stagingPath = (outDir, jobId, ext) => path.join(outDir, stagingName(jobId, ext));
const isStagingName = (name) => name.startsWith('.~morph-');

function* candidates(outDir, base, ext) {
  const suffix = ext ? `.${ext}` : '';
  yield path.join(outDir, `${base}${suffix}`);
  for (let i = 1; i < 10000; i++) yield path.join(outDir, `${base} (${i})${suffix}`);
}

// Windows briefly locks fresh files (antivirus, indexer): retry the rename a few times.
async function renameWithRetry(from, to) {
  for (let i = 0; ; i++) {
    try { return await fsp.rename(from, to); } catch (e) {
      if (i >= 5 || !['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 100 * (i + 1)));
    }
  }
}

async function exists(p) {
  try { await fsp.lstat(p); return true; } catch { return false; }
}

// Same-disk staging copy when the engine wrote somewhere else (the job workspace).
async function stageInto(source, staged, isDir) {
  if (path.resolve(source) === path.resolve(staged)) return;
  if (isDir) await fsp.cp(source, staged, { recursive: true, errorOnExist: true, force: false });
  else await fsp.copyFile(source, staged, fs.constants.COPYFILE_EXCL);
}

/**
 * @param {object} o
 * @param {string} o.source artifact path (in the workspace or already staged in outDir)
 * @param {boolean} [o.isDir]
 * @param {string} o.outDir destination folder
 * @param {string} o.base file name without extension
 * @param {string} [o.ext] target extension ('tar.gz' allowed); omitted for folders
 * @param {string} o.jobId
 * @param {() => boolean} o.isCancelled checked after staging, right before the final rename
 * @param {(p: string) => void} [o.onReserve] journals paths that a crash could leave behind
 * @returns {Promise<string>} the published path
 */
async function publish({ source, isDir = false, outDir, base, ext, jobId, isCancelled, onReserve = () => {} }) {
  await fsp.mkdir(outDir, { recursive: true });
  const staged = stagingPath(outDir, jobId, isDir ? 'pages' : ext);
  onReserve(staged);
  try {
    await stageInto(source, staged, isDir);
    if (isCancelled()) throw new CancelledError();
    for (const candidate of candidates(outDir, base, isDir ? '' : ext)) {
      const key = norm(candidate);
      if (reserved.has(key) || (await exists(candidate))) continue;
      reserved.add(key);
      try {
        if (isDir) {
          try {
            await renameWithRetry(staged, candidate);
          } catch (e) {
            if (['EEXIST', 'ENOTEMPTY'].includes(e.code)) continue; // someone else took the name
            throw e;
          }
          return candidate;
        }
        let fd;
        try {
          fd = await fsp.open(candidate, 'wx'); // exclusive: never replaces an existing file
        } catch (e) {
          if (e.code === 'EEXIST') continue;
          throw e;
        }
        await fd.close();
        onReserve(candidate);
        try {
          await renameWithRetry(staged, candidate); // replaces only our own empty reservation
        } catch (e) {
          await fsp.rm(candidate, { force: true }).catch(() => {});
          throw e;
        }
        return candidate;
      } finally {
        reserved.delete(key);
      }
    }
    throw new Error('no-free-name');
  } catch (e) {
    await fsp.rm(staged, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

// Recovery: removes what an interrupted publish left (staging files, empty reservations).
async function discardLeftovers(paths) {
  for (const p of paths) {
    try {
      const st = await fsp.lstat(p);
      if (isStagingName(path.basename(p))) await fsp.rm(p, { recursive: true, force: true });
      else if (st.isFile() && st.size === 0) await fsp.rm(p, { force: true }); // our empty reservation
    } catch { /* already gone */ }
  }
}

module.exports = { publish, stagingPath, discardLeftovers, isStagingName };
