// Confinement policy and plumbing, on any host. What these cannot show (that Windows actually
// denies, kills and limits) is proven with real restricted processes in test/windows/confinement.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Confinement, outcomeError } = require('../../electron/infra/Confinement.cjs');
const { runProcess } = require('../../electron/infra/ProcessRunner.cjs');
const policy = require('../../electron/domain/confinementPolicy.cjs');
const { TOOLS } = require('../../electron/infra/ToolRegistry.cjs');
const { tmpDir } = require('./helpers.cjs');

const argAfter = (args, flag) => args.filter((_, i) => args[i - 1] === flag);

test('every tool has a confinement policy with a known isolation', () => {
  assert.deepEqual(Object.keys(policy.tools).sort(), Object.keys(TOOLS).sort());
  for (const [name, t] of Object.entries(policy.tools)) {
    assert.ok(['appcontainer', 'job'].includes(t.isolation), name);
    if (t.isolation !== 'appcontainer') assert.ok(t.reason, `${name}: a tool outside the AppContainer needs the measured reason`);
  }
});

test('not Windows: unconfined and reported as unsupported (not silent)', () => {
  const c = new Confinement({ platform: 'linux' });
  assert.equal(c.status().mode, 'unsupported');
  assert.ok(c.status().reason);
  const p = c.prepare('ffmpeg', '/usr/bin/ffmpeg', ['-version'], {});
  assert.equal(p.confined, false);
  assert.equal(p.exe, '/usr/bin/ffmpeg');
});

test('Windows without the helper: engines are refused with the reason, never run unconfined', () => {
  const c = new Confinement({ platform: 'win32', helper: path.join(tmpDir('conf'), 'missing.exe'), disabled: false });
  assert.equal(c.status().mode, 'unavailable');
  assert.throws(() => c.prepare('ffmpeg', 'C:\\x\\ffmpeg.exe', [], { workspace: 'C:\\ws' }), (e) => e.code === 'confinement-unavailable' && /not found/.test(e.message));
});

test('MORPH_CONFINEMENT=off is reported as disabled', () => {
  const c = new Confinement({ platform: 'win32', disabled: true });
  assert.equal(c.status().mode, 'disabled');
  assert.match(c.status().reason, /MORPH_CONFINEMENT=off/);
  assert.equal(c.prepare('ffmpeg', 'ffmpeg.exe', [], {}).confined, false);
});

test('enforced: AppContainer, read only the engine folder, write only the workspace (+ given folders), parent watch', () => {
  const root = tmpDir('conf-roots');
  const bin = path.join(root, 'bin');
  const ws = path.join(root, 'ws', 'job1');
  fs.mkdirSync(ws, { recursive: true });
  const helper = process.execPath; // any existing file stands in for the helper here
  const c = new Confinement({ platform: 'win32', helper, disabled: false, ownedRoots: [bin] });
  assert.equal(c.status().mode, 'enforced');
  const soffice = path.join(bin, 'libreoffice', 'program', 'soffice.com');
  const profile = path.join(root, 'profile');
  const p = c.prepare('soffice', soffice, ['--headless', 'in.odt'], { workspace: ws, write: [profile] });
  assert.equal(p.exe, helper);
  assert.equal(p.confined, true);
  const sep = p.args.indexOf('--');
  const opts = p.args.slice(0, sep);
  assert.deepEqual(p.args.slice(sep + 1), [soffice, '--headless', 'in.odt'], 'the engine call is passed through unchanged');
  assert.deepEqual(argAfter(opts, '--appcontainer'), ['Morph.Engines']);
  assert.deepEqual(argAfter(opts, '--read'), [path.join(bin, 'libreoffice')], 'only the engine\'s own folder');
  assert.deepEqual(argAfter(opts, '--write'), [ws, profile]);
  assert.deepEqual(argAfter(opts, '--parent'), [String(process.pid)]);
  assert.deepEqual(argAfter(opts, '--cwd'), [ws]);
  for (const k of ['TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'CALIBRE_CONFIG_DIRECTORY', 'CALIBRE_TEMP_DIR']) assert.ok(p.env[k].startsWith(ws), `${k} inside the workspace`);
});

test('enforced: an engine outside Morph\'s folders gets no read grant (system folders are never modified)', () => {
  const root = tmpDir('conf-roots2');
  const ws = path.join(root, 'ws');
  fs.mkdirSync(ws);
  const c = new Confinement({ platform: 'win32', helper: process.execPath, disabled: false, ownedRoots: [path.join(root, 'bin')] });
  const p = c.prepare('sevenzip', 'C:\\Program Files\\7-Zip\\7z.exe', ['l'], { workspace: ws });
  assert.deepEqual(argAfter(p.args.slice(0, p.args.indexOf('--')), '--read'), []);
});

test('enforced without a workspace is an error, not an unconfined run', () => {
  const c = new Confinement({ platform: 'win32', helper: process.execPath, disabled: false });
  assert.throws(() => c.prepare('ffmpeg', 'ffmpeg.exe', [], {}), (e) => e.code === 'confinement-unavailable');
});

test('helper outcomes become errors the UI understands', () => {
  assert.equal(outcomeError({ outcome: 'exited' }, 'x'), null);
  assert.equal(outcomeError(null, 'x'), null);
  assert.equal(outcomeError({ outcome: 'limit-memory' }, 'soffice').code, 'limit-memory');
  assert.equal(outcomeError({ outcome: 'limit-processes' }, 'soffice').code, 'limit-processes');
  const e = outcomeError({ outcome: 'setup-failed', error: 'CreateAppContainerProfile failed (Windows error 5)' }, 'ffmpeg');
  assert.equal(e.code, 'confinement-failed');
  assert.match(e.message, /CreateAppContainerProfile/);
});

test('ProcessRunner: a limit reported by the helper fails the call even when the exit code is 0', async () => {
  const launch = { exe: process.execPath, args: ['-e', 'process.exit(0)'], cwd: undefined, env: undefined, readStats: () => ({ outcome: 'limit-memory', peakJobMemory: 1 }) };
  await assert.rejects(runProcess('ignored', [], { timeoutMs: 10000, name: 'soffice', launch }), (e) => e.code === 'limit-memory' && e.confinement.peakJobMemory === 1);
});

test('ProcessRunner: a successful confined call returns the helper\'s accounting', async () => {
  const launch = { exe: process.execPath, args: ['-e', 'console.log("hi")'], cwd: undefined, env: undefined, readStats: () => ({ outcome: 'exited', peakJobMemory: 42 }) };
  const r = await runProcess('ignored', [], { timeoutMs: 10000, name: 'x', launch });
  assert.equal(r.confinement.peakJobMemory, 42);
  assert.match(r.stdout, /hi/);
});
