const test = require('node:test');
const assert = require('node:assert/strict');
const { SCHEMAS } = require('../../electron/ipc/schemas.cjs');
const { createRouter, trustedSenderCheck } = require('../../electron/ipc/router.cjs');

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

test('job commands accept only a file ID and a known-shaped target', () => {
  assert.deepEqual(SCHEMAS['jobs:enqueue']([{ fileId: ID, target: 'tar.gz' }]), [{ fileId: ID, target: 'tar.gz' }]);
  for (const bad of [
    [{ fileId: ID, target: 'mp4', input: 'C:\\x' }], // extra field: the renderer cannot pick the input path
    [{ fileId: 'C:\\file.mp4', target: 'mp4' }],
    [{ fileId: ID, target: '../x' }],
    [{ fileId: ID }],
    [],
  ]) assert.throws(() => SCHEMAS['jobs:enqueue'](bad), /bad-request/);
});

test('settings patches are typed per key', () => {
  assert.deepEqual(SCHEMAS['settings:set']([{ quality: 'medium' }]), [{ quality: 'medium' }]);
  assert.throws(() => SCHEMAS['settings:set']([{ quality: 'max' }]), /bad-request/);
  assert.throws(() => SCHEMAS['settings:set']([{ maxHeight: '1080' }]), /bad-request/);
  assert.throws(() => SCHEMAS['settings:set']([{}]), /bad-request/);
  assert.throws(() => SCHEMAS['settings:set']([{ __proto__x: 1 }]), /bad-request/);
});

test('intake is bounded', () => {
  assert.throws(() => SCHEMAS['files:detect']([Array(1001).fill('/a')]), /bad-request/);
  assert.throws(() => SCHEMAS['files:detect']([[42]]), /bad-request/);
  assert.throws(() => SCHEMAS['files:detect']([['a\0b']]), /bad-request/);
  assert.throws(() => SCHEMAS['history:clear'](['extra']), /bad-request/);
});

function fakeIpc() {
  const handlers = {};
  return { handlers, handle: (ch, fn) => { handlers[ch] = fn; } };
}

test('the router refuses other windows, sub-frames and other pages before the handler runs', async () => {
  const ipc = fakeIpc();
  const webContents = {};
  const win = { webContents, isDestroyed: () => false };
  let calls = 0;
  const router = createRouter({ ipcMain: ipc, isTrustedSender: trustedSenderCheck({ getWindow: () => win, appUrlPrefix: 'file:///app/dist/index.html' }) });
  router.handle('jobs:cancel', () => { calls++; return true; });
  const ok = { sender: webContents, senderFrame: { parent: null, url: 'file:///app/dist/index.html' } };
  assert.equal(await ipc.handlers['jobs:cancel'](ok, ID), true);
  await assert.rejects(ipc.handlers['jobs:cancel']({ ...ok, sender: {} }, ID), /forbidden/);
  await assert.rejects(ipc.handlers['jobs:cancel']({ ...ok, senderFrame: { parent: {}, url: ok.senderFrame.url } }, ID), /forbidden/);
  await assert.rejects(ipc.handlers['jobs:cancel']({ ...ok, senderFrame: { parent: null, url: 'https://evil.example/' } }, ID), /forbidden/);
  await assert.rejects(ipc.handlers['jobs:cancel'](ok, 'not-an-id'), /bad-request/);
  assert.equal(calls, 1);
});

test('every channel the preload exposes has a schema', () => {
  const preload = require('fs').readFileSync(require('path').join(__dirname, '../../electron/preload.cjs'), 'utf8');
  for (const [, ch] of preload.matchAll(/invoke\('([^']+)'/g)) assert.ok(SCHEMAS[ch], `missing schema for ${ch}`);
});
