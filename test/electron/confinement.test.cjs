// Confinement policy and plumbing, on any host. What these cannot show (that Windows actually
// denies, kills and limits) is proven with real restricted processes in test/windows/confinement.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Confinement, outcomeError, withOverrides } = require('../../electron/infra/Confinement.cjs');
const { runProcess } = require('../../electron/infra/ProcessRunner.cjs');
const policy = require('../../electron/domain/confinementPolicy.cjs');
const { TOOLS } = require('../../electron/infra/ToolRegistry.cjs');
const { tmpDir } = require('./helpers.cjs');

const argAfter = (args, flag) => args.filter((_, i) => args[i - 1] === flag);

test('every tool has a confinement policy with a known isolation', () => {
  assert.deepEqual(Object.keys(policy.tools).sort(), [...Object.keys(TOOLS), 'imageworker'].sort());
  for (const [name, t] of Object.entries(policy.tools)) {
    assert.ok(['appcontainer', 'low-integrity'].includes(t.isolation), name);
    const lim = policy.limits[name];
    assert.ok(lim && lim.jobMemoryMb >= 1024 && lim.maxProcesses >= 8, `${name}: memory and process limits set`);
    if (t.isolation !== 'appcontainer') assert.ok(t.reason, `${name}: a tool outside the AppContainer needs the measured reason`);
    if (t.isolation === 'low-integrity') assert.equal(t.console, 'inherit', `${name}: Low-integrity engines share the helper's console (measured)`);
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
  const ffmpeg = path.join(bin, 'ffmpeg', 'ffmpeg.exe');
  const extra = path.join(root, 'extra');
  const p = c.prepare('ffmpeg', ffmpeg, ['-i', 'in.mp4', 'out.webm'], { workspace: ws, write: [extra] });
  assert.equal(p.exe, helper);
  assert.equal(p.confined, true);
  const sep = p.args.indexOf('--');
  const opts = p.args.slice(0, sep);
  assert.deepEqual(p.args.slice(sep + 1), [ffmpeg, '-i', 'in.mp4', 'out.webm'], 'the engine call is passed through unchanged');
  const [name] = argAfter(opts, '--appcontainer');
  assert.match(name, /^Morph\.Job\.[0-9a-f]{24}$/, 'a per-job AppContainer identity');
  assert.deepEqual(argAfter(opts, '--capability'), ['morph.engines.read'], 'reads through the shared capability');
  assert.deepEqual(argAfter(opts, '--read'), [path.join(bin, 'ffmpeg')], 'only the engine\'s own folder');
  assert.deepEqual(argAfter(opts, '--write'), [ws, extra]);
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

test('enforced, low-integrity engines: Low token, Low labels on the workspace and given folders, no read grants', () => {
  const root = tmpDir('conf-low');
  const bin = path.join(root, 'bin');
  const ws = path.join(root, 'ws');
  fs.mkdirSync(ws);
  const c = new Confinement({ platform: 'win32', helper: process.execPath, disabled: false, ownedRoots: [bin] });
  const p = c.prepare('soffice', path.join(bin, 'libreoffice', 'program', 'soffice.com'), ['--version'], { workspace: ws, write: [path.join(root, 'profile')] });
  const opts = p.args.slice(0, p.args.indexOf('--'));
  assert.ok(opts.includes('--low-integrity'));
  assert.ok(!opts.includes('--appcontainer'));
  assert.deepEqual(argAfter(opts, '--console'), ['inherit'], 'shares the helper console (a new one cannot start for this token)');
  assert.deepEqual(argAfter(opts, '--read'), []);
  assert.deepEqual(argAfter(opts, '--write'), [ws, path.join(root, 'profile')]);
  assert.deepEqual(argAfter(opts, '--job-memory'), [String(policy.limits.soffice.jobMemoryMb)]);
  assert.deepEqual(argAfter(opts, '--max-processes'), [String(policy.limits.soffice.maxProcesses)]);
  assert.match(c.status().notes.join(' '), /Low integrity/);
});

test('low-integrity with restrictReads: job SID, --restrict-reads, read grant only on the engine\'s own folder', () => {
  const root = tmpDir('conf-rr');
  const bin = path.join(root, 'bin');
  const ws = path.join(root, 'ws');
  fs.mkdirSync(ws);
  const tools = { ...policy.tools, soffice: { ...policy.tools.soffice, restrictReads: true } };
  const c = new Confinement({ platform: 'win32', helper: process.execPath, disabled: false, ownedRoots: [bin], tools });
  const p = c.prepare('soffice', path.join(bin, 'libreoffice', 'program', 'soffice.com'), ['--version'], { workspace: ws, read: ['C:\\Windows'] });
  const opts = p.args.slice(0, p.args.indexOf('--'));
  assert.ok(opts.includes('--low-integrity') && opts.includes('--restrict-reads'));
  assert.match(argAfter(opts, '--restrict-writes')[0], /^Morph\.Writes\.[0-9a-f]{24}$/);
  assert.deepEqual(argAfter(opts, '--read'), [path.join(bin, 'libreoffice')], 'never a system folder');
});

test('MORPH_CONFINE_LIMITS overrides only known tools with positive integers', () => {
  const base = { soffice: { jobMemoryMb: 100, maxProcesses: 5 } };
  assert.deepEqual(withOverrides(base, '{"soffice":{"jobMemoryMb":4096},"nope":{"jobMemoryMb":1}}').soffice, { jobMemoryMb: 4096, maxProcesses: 5 });
  assert.equal(withOverrides(base, '{"soffice":{"jobMemoryMb":-1}}').soffice.jobMemoryMb, 100);
  assert.equal(withOverrides(base, 'not json'), base);
  assert.equal(withOverrides(base, undefined), base);
});

test('per-job identity: two workspaces never share an AppContainer, the same workspace always maps to the same one', () => {
  const root = tmpDir('conf-ids');
  const c = new Confinement({ platform: 'win32', helper: process.execPath, disabled: false, ownedRoots: [path.join(root, 'bin')] });
  const nameFor = (ws) => { fs.mkdirSync(ws, { recursive: true }); const a = c.prepare('ffmpeg', 'ffmpeg.exe', [], { workspace: ws }).args; return a[a.indexOf('--appcontainer') + 1]; };
  const a = nameFor(path.join(root, 'ws', 'job-a'));
  const b = nameFor(path.join(root, 'ws', 'job-b'));
  assert.notEqual(a, b);
  assert.equal(nameFor(path.join(root, 'ws', 'job-a')), a);
  assert.ok(a.length <= 64, 'AppContainer names are at most 64 characters');
});

test('extra read folders are granted only inside Morph\'s folders', () => {
  const root = tmpDir('conf-read');
  const owned = path.join(root, 'app');
  const ws = path.join(root, 'ws');
  fs.mkdirSync(ws);
  const c = new Confinement({ platform: 'win32', helper: process.execPath, disabled: false, ownedRoots: [owned], tools: { ...policy.tools, worker: { isolation: 'appcontainer' } } });
  const p = c.prepare('worker', path.join(owned, 'runtime', 'node.exe'), ['w.cjs'], { workspace: ws, read: [path.join(owned, 'code'), 'C:\\Windows\\System32', path.join(root, 'elsewhere')] });
  const reads = argAfter(p.args.slice(0, p.args.indexOf('--')), '--read');
  assert.deepEqual(reads.sort(), [path.join(owned, 'code'), path.join(owned, 'runtime')].sort());
});

test('AppContainer calls register a per-job profile that is removed again (helper on exit, else cleanup)', async () => {
  const root = tmpDir('conf-eph');
  const ws = path.join(root, 'ws');
  fs.mkdirSync(ws);
  const c = new Confinement({ platform: 'win32', helper: process.execPath, disabled: false, ownedRoots: [path.join(root, 'bin')] });
  const deleted = [];
  c.deleteProfile = async (n) => { deleted.push(n); };
  const p = c.prepare('ffmpeg', 'ffmpeg.exe', [], { workspace: ws });
  const opts = p.args.slice(0, p.args.indexOf('--'));
  assert.ok(opts.includes('--ephemeral'));
  const name = argAfter(opts, '--appcontainer')[0];
  await p.cleanup({ profileDeleted: true });
  assert.deepEqual(deleted, [], 'the helper deleted it: nothing to do');
  await p.cleanup(null); // killed helper: no statistics
  assert.deepEqual(deleted, [name]);
  const low = c.prepare('soffice', 'soffice.com', [], { workspace: ws });
  await low.cleanup(null);
  assert.deepEqual(deleted, [name], 'no profile for the Low-integrity tier');
});
