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
  assert.match(friendlyError('limit-memory:soffice'), /מגבלת הזיכרון/);
  assert.match(friendlyError('limit-processes:calibre'), /תהליכים/);
  assert.match(friendlyError('confinement-failed:ffmpeg:CreateAppContainerProfile failed'), /בבידוד/);
  assert.match(friendlyError('confinement-unavailable:ffmpeg:morph-confine.exe not found'), /בבידוד/);
});

test('the engine-isolation line is never silent about a missing protection', async () => {
  const { confinementText } = await import('../../src/features/tools/toolPresentation.js');
  assert.equal(confinementText(null), null);
  const all = confinementText({ mode: 'enforced', tools: { ffmpeg: 'appcontainer', soffice: 'appcontainer' } });
  assert.equal(all.ok, true);
  assert.doesNotMatch(all.text, /מוגבלים רק/);
  const partial = confinementText({ mode: 'enforced', tools: { ffmpeg: 'appcontainer', calibre: 'job' } });
  assert.match(partial.text, /Calibre מוגבלים רק בזמן ובזיכרון/);
  assert.equal(confinementText({ mode: 'unavailable', reason: 'morph-confine.exe not found' }).ok, false);
  assert.match(confinementText({ mode: 'unavailable', reason: 'morph-confine.exe not found' }).text, /חסומים: morph-confine\.exe not found/);
  assert.match(confinementText({ mode: 'disabled' }).text, /כבוי/);
});

test('every known per-direction limit in the registry has a Hebrew note for the row', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { KNOWN_LIMITS } = require('../../electron/domain/capabilities.cjs');
  const { LIMIT_NOTES, limitNotes } = await import('../../src/presentation/fidelityNotes.js');
  for (const ids of Object.values(KNOWN_LIMITS)) for (const id of ids) assert.ok(LIMIT_NOTES[id], `note for ${id}`);
  assert.match(limitNotes(['rtl-paragraphs-lost'])[0], /ימין לשמאל/);
  assert.deepEqual(limitNotes(['unknown']), []);
});
