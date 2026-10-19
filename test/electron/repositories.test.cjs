const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SettingsRepository, HistoryRepository, JobRepository } = require('../../electron/infra/repositories.cjs');
const { tmpDir } = require('./helpers.cjs');

const FOLDER = path.resolve('/docs/Morph');

test('settings: defaults, validated patches, and refused garbage', () => {
  const dir = tmpDir('set');
  const s = new SettingsRepository(dir, { defaultFolder: FOLDER });
  assert.deepEqual(s.get(), { outputMode: 'beside', folder: FOLDER, quality: 'high', maxHeight: null });
  assert.equal(s.patch({ quality: 'small', maxHeight: 720 }).quality, 'small');
  assert.throws(() => s.patch({ quality: 'ultra' }), /invalid-setting:quality/);
  assert.throws(() => s.patch({ folder: 'relative/path' }), /invalid-setting:folder/);
  assert.throws(() => s.patch({ evil: 1 }), /invalid-setting:evil/);
  assert.equal(new SettingsRepository(dir, { defaultFolder: FOLDER }).get().maxHeight, 720);
});

test('settings: a corrupt file is set aside and defaults are used', () => {
  const dir = tmpDir('set');
  fs.writeFileSync(path.join(dir, 'settings.json'), '{"quality": "sm');
  const s = new SettingsRepository(dir, { defaultFolder: FOLDER });
  assert.equal(s.get().quality, 'high');
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('settings.json.corrupt-')));
});

test('settings: version-0 values are kept one by one, invalid ones reset', () => {
  const dir = tmpDir('set');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ outputMode: 'folder', folder: FOLDER, quality: 'nope' }));
  const got = new SettingsRepository(dir, { defaultFolder: path.resolve('/x') }).get();
  assert.equal(got.outputMode, 'folder');
  assert.equal(got.quality, 'high');
});

test('history: migrates the v0 bare array, adds, caps and answers hasOutput', () => {
  const dir = tmpDir('his');
  fs.writeFileSync(path.join(dir, 'history.json'), JSON.stringify([{ name: 'a.png', from: 'png', to: 'jpg', output: '/o/a.jpg', convertedAt: '2026-01-01T00:00:00Z' }]));
  const h = new HistoryRepository(dir, { maxEntries: 2 });
  assert.equal(h.list().length, 1);
  h.add({ name: 'b', from: 'x', to: 'y', output: '/o/b.y' });
  h.add({ name: 'c', from: 'x', to: 'y', output: '/o/c.y' });
  assert.deepEqual(h.list().map((e) => e.name), ['c', 'b']);
  assert.equal(h.hasOutput('/o/b.y'), true);
  assert.equal(h.hasOutput('/etc/passwd'), false);
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8'));
  assert.equal(raw.version, 1);
});

test('writes are atomic: no temp files remain', () => {
  const dir = tmpDir('his');
  const h = new HistoryRepository(dir);
  for (let i = 0; i < 20; i++) h.add({ name: `n${i}`, from: 'a', to: 'b', output: `/o/${i}` });
  assert.deepEqual(fs.readdirSync(dir), ['history.json']);
});

test('job journal: records leftovers and hands back interrupted jobs once', () => {
  const dir = tmpDir('job');
  const j = new JobRepository(dir);
  j.put('a', { fileId: 'f', state: 'queued', leftovers: [] });
  j.addLeftover('a', '/o/.~morph-a.mp4');
  j.put('b', { state: 'queued' });
  j.remove('b');
  const back = new JobRepository(dir).takeInterrupted();
  assert.deepEqual(back.map((r) => [r.jobId, r.leftovers]), [['a', ['/o/.~morph-a.mp4']]]);
  assert.deepEqual(new JobRepository(dir).takeInterrupted(), []);
});
