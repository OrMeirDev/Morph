import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtSize, baseName } from '../../src/presentation/formatters.js';
import { fmtLabel } from '../../src/presentation/formatCatalog.js';
import { friendlyError } from '../../src/presentation/errorMessages.js';

test('fmtSize uses binary multiples like Windows Explorer', () => {
  assert.equal(fmtSize(0), '0 B');
  assert.equal(fmtSize(2048), '2 KB');
  assert.equal(fmtSize(1.5 * 1024 ** 2), '1.5 MB');
  assert.equal(fmtSize(undefined), '');
});

test('baseName handles both separators', () => {
  assert.equal(baseName('C:\\a\\b.png'), 'b.png');
  assert.equal(baseName('/a/b.png'), 'b.png');
});

test('fmtLabel names office formats and upper-cases the rest', () => {
  assert.equal(fmtLabel('docx'), 'Word');
  assert.equal(fmtLabel('tar.gz'), 'TAR.GZ');
  assert.equal(fmtLabel('webp'), 'WEBP');
});

test('friendlyError maps engine messages to Hebrew', () => {
  assert.match(friendlyError('missing-tool:ffmpeg'), /כלי ההמרה חסר/);
  assert.match(friendlyError('moov atom not found'), /פגום/);
  assert.equal(friendlyError('weird'), 'ההמרה נכשלה');
});
