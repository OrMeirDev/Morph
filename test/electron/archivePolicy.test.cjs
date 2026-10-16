const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSltListing, evaluateListing, unsafePathReason } = require('../../electron/domain/archivePolicy.cjs');
const limits = require('../../electron/domain/limits.cjs').archive;

const LISTING = `
7-Zip [64] 17.05 : Copyright (c) 1999-2021 Igor Pavlov

Listing archive: a.zip

--
Path = a.zip
Type = zip
Physical Size = 400

----------
Path = docs
Folder = +
Size = 0
Attributes = D drwxr-xr-x

Path = docs/readme.txt
Folder = -
Size = 120
Attributes = A -rw-r--r--
Encrypted = -

Path = link
Folder = -
Size = 4
Attributes = A -lrwxrwxrwx
`;

test('parses entries from a 7z -slt listing (header block skipped)', () => {
  const e = parseSltListing(LISTING);
  assert.deepEqual(e.map((x) => [x.path, x.size, x.isDir, x.isLink]), [['docs', 0, true, false], ['docs/readme.txt', 120, false, false], ['link', 4, false, true]]);
});

test('unsafe paths are rejected', () => {
  assert.equal(unsafePathReason('../evil.txt'), 'traversal');
  assert.equal(unsafePathReason('a/../../evil'), 'traversal');
  assert.equal(unsafePathReason('a\\..\\evil'), 'traversal');
  assert.equal(unsafePathReason('/etc/passwd'), 'absolute');
  assert.equal(unsafePathReason('C:\\Windows\\x'), 'drive');
  assert.equal(unsafePathReason('ok/name..txt'), null);
});

const entry = (path, size = 1, extra = {}) => ({ path, size, isDir: false, isLink: false, encrypted: false, ...extra });
const opts = { inputSize: 1000, limits };

test('links, encryption, depth, count, size and ratio budgets', () => {
  assert.throws(() => evaluateListing([entry('a', 1, { isLink: true })], opts), /archive-link/);
  assert.throws(() => evaluateListing([entry('a', 1, { encrypted: true })], opts), /archive-encrypted/);
  assert.throws(() => evaluateListing([entry(Array(40).fill('d').join('/'))], opts), /archive-too-deep/);
  assert.throws(() => evaluateListing([entry('big', limits.maxUnpackedBytes + 1)], { inputSize: limits.maxUnpackedBytes, limits }), /archive-too-large/);
  assert.throws(() => evaluateListing([entry('bomb', 2 * 1024 ** 3)], { inputSize: 1024 * 1024, limits }), /archive-ratio/);
  assert.throws(() => evaluateListing(Array.from({ length: limits.maxEntries + 1 }, (_, i) => entry(`f${i}`)), opts), /archive-too-many-files/);
  assert.deepEqual(evaluateListing([entry('a/b.txt', 10), { ...entry('a'), isDir: true }], opts), { totalBytes: 10, files: 1, entries: 2 });
});
