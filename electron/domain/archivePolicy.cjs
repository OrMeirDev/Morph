// Archive preflight: parse a `7z l -slt` listing and decide whether extracting it is safe and
// within budget. Pure: the adapter supplies the listing text and sizes.

// Parses the technical listing (`7z l -slt -ba` or with the header) into entries.
function parseSltListing(text) {
  const entries = [];
  const body = String(text).split(/\r?\n----------\r?\n/).pop();
  for (const block of body.split(/\r?\n\s*\r?\n/)) {
    const fields = {};
    for (const line of block.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z][A-Za-z ]*?) = (.*)$/);
      if (m) fields[m[1]] = m[2];
    }
    if (fields.Path === undefined) continue;
    const attrs = fields.Attributes || '';
    entries.push({
      path: fields.Path,
      size: Number(fields.Size) || 0,
      isDir: fields.Folder === '+' || /^D/.test(attrs),
      // 7-Zip prints unix mode bits after the Windows ones ("A -lrwxrwxrwx"); also explicit fields.
      isLink: /(^|\s)-?l[rwx-]{9}/.test(attrs) || !!fields['Symbolic Link'] || !!fields['Hard Link'],
      encrypted: fields.Encrypted === '+',
    });
  }
  return entries;
}

class ArchivePolicyError extends Error {
  constructor(code, detail) {
    super(`${code}${detail ? `:${detail}` : ''}`);
    this.code = code;
  }
}

// Rejects anything that could land outside the extraction folder.
function unsafePathReason(p) {
  if (!p || /\0/.test(p)) return 'empty';
  const s = p.replace(/\\/g, '/');
  if (s.startsWith('/') || s.startsWith('//')) return 'absolute';
  if (/^[a-zA-Z]:/.test(s)) return 'drive';
  if (s.split('/').some((seg) => seg === '..')) return 'traversal';
  return null;
}

const depthOf = (p) => p.replace(/\\/g, '/').split('/').filter(Boolean).length;

// Throws ArchivePolicyError when the listing breaks a rule; returns totals otherwise.
function evaluateListing(entries, { inputSize, limits }) {
  let total = 0;
  let files = 0;
  for (const e of entries) {
    const reason = unsafePathReason(e.path);
    if (reason) throw new ArchivePolicyError('archive-unsafe-path', reason);
    if (e.isLink) throw new ArchivePolicyError('archive-link');
    if (e.encrypted) throw new ArchivePolicyError('archive-encrypted', 'password');
    if (depthOf(e.path) > limits.maxDepth) throw new ArchivePolicyError('archive-too-deep');
    if (!e.isDir) {
      files++;
      total += e.size;
    }
  }
  if (entries.length > limits.maxEntries) throw new ArchivePolicyError('archive-too-many-files');
  if (total > limits.maxUnpackedBytes) throw new ArchivePolicyError('archive-too-large');
  if (total > limits.ratioFloorBytes && inputSize > 0 && total / inputSize > limits.maxRatio) {
    throw new ArchivePolicyError('archive-ratio');
  }
  return { totalBytes: total, files, entries: entries.length };
}

module.exports = { parseSltListing, evaluateListing, unsafePathReason, ArchivePolicyError };
