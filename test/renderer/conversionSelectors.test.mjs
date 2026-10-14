import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatGroups, conversionCounts, applyGroupTarget, withTarget, hasClearable, withoutFinished, saveWhereText,
} from '../../src/features/conversion/conversionSelectors.js';

const row = (id, kind, targets, target, status = 'ready', size = 10) => ({ id, kind, targets, target, status, size });

test('formatGroups intersects targets per kind and reports a shared or mixed current target', () => {
  const items = [
    row(1, 'image', ['png', 'webp', 'pdf'], 'png'),
    row(2, 'image', ['jpg', 'webp', 'pdf'], 'webp'),
    row(3, 'audio', ['mp3', 'wav'], 'mp3'),
    { id: 4, status: 'unsupported', targets: [] },
  ];
  const groups = formatGroups(items);
  assert.deepEqual(groups.map((g) => g.kind), ['image', 'audio']);
  assert.deepEqual(groups[0].targets, ['webp', 'pdf']);
  assert.equal(groups[0].current, '');
  assert.equal(groups[0].count, 2);
  assert.equal(groups[1].current, 'mp3');
});

test('formatGroups drops a kind whose files share no target', () => {
  assert.deepEqual(formatGroups([row(1, 'image', ['png'], 'png'), row(2, 'image', ['jpg'], 'jpg')]), []);
});

test('conversionCounts counts pending, done, failed and total size', () => {
  const c = conversionCounts([row(1, 'a', [], 'x', 'ready', 5), row(2, 'a', [], 'x', 'done', 7), row(3, 'a', [], 'x', 'error', 1), { status: 'unsupported', size: 2 }]);
  assert.deepEqual(c, { pending: 2, done: 1, failed: 1, total: 15 });
});

test('withTarget resets finished/failed rows to ready and keeps other states', () => {
  assert.equal(withTarget(row(1, 'a', [], 'x', 'done'), 'y').status, 'ready');
  assert.equal(withTarget(row(1, 'a', [], 'x', 'error'), 'y').status, 'ready');
  assert.equal(withTarget(row(1, 'a', [], 'x', 'cancelled'), 'y').status, 'cancelled');
});

test('applyGroupTarget skips active rows and rows that cannot reach the target', () => {
  const out = applyGroupTarget([
    row(1, 'image', ['png', 'webp'], 'png', 'ready'),
    row(2, 'image', ['png', 'webp'], 'png', 'converting'),
    row(3, 'image', ['png'], 'png', 'ready'),
    row(4, 'audio', ['webp'], 'mp3', 'ready'),
  ], 'image', 'webp');
  assert.deepEqual(out.map((x) => x.target), ['webp', 'png', 'png', 'mp3']);
});

test('clearing finished rows keeps pending ones', () => {
  const items = [row(1, 'a', [], 'x', 'done'), row(2, 'a', [], 'x', 'ready'), { id: 3, status: 'unsupported' }];
  assert.equal(hasClearable(items), true);
  assert.deepEqual(withoutFinished(items).map((x) => x.id), [2]);
});

test('saveWhereText names the last two folder levels', () => {
  assert.equal(saveWhereText({ outputMode: 'folder', folder: 'C:\\Users\\or\\Documents\\Morph' }), 'נשמר בתיקייה Documents / Morph');
  assert.equal(saveWhereText({ outputMode: 'beside' }), 'נשמר ליד הקובץ המקורי');
});
