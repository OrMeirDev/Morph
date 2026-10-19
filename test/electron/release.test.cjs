const test = require('node:test');
const assert = require('node:assert/strict');
const { signingRoute, builderArgs } = require('../../scripts/release.cjs');

test('a release is blocked without a publisher and one complete signing route', () => {
  assert.throws(() => signingRoute({}), /MORPH_PUBLISHER/);
  assert.throws(() => signingRoute({ MORPH_PUBLISHER: 'Morph', WIN_CSC_LINK: 'x' }), /both required/);
  assert.throws(() => signingRoute({ MORPH_PUBLISHER: 'Morph' }), /no code-signing route/);
  assert.throws(() => signingRoute({
    MORPH_PUBLISHER: 'Morph',
    WIN_CSC_LINK: 'x',
    WIN_CSC_KEY_PASSWORD: 'x',
    AZURE_TENANT_ID: 'x',
  }), /not both/);
});

test('PFX releases pin the updater publisher', () => {
  const route = signingRoute({ MORPH_PUBLISHER: 'Morph Ltd', WIN_CSC_LINK: 'x', WIN_CSC_KEY_PASSWORD: 'x' });
  assert.deepEqual(route, { publisher: 'Morph Ltd', kind: 'pfx' });
  assert.ok(builderArgs(route).includes('-c.win.signtoolOptions.publisherName=Morph Ltd'));
});

test('Azure releases require every input and pin the updater publisher', () => {
  const env = {
    MORPH_PUBLISHER: 'Morph Ltd',
    AZURE_TENANT_ID: 'tenant',
    AZURE_CLIENT_ID: 'client',
    AZURE_CLIENT_SECRET: 'secret',
    AZURE_SIGNING_ENDPOINT: 'https://signing.example',
    AZURE_SIGNING_ACCOUNT: 'account',
    AZURE_SIGNING_PROFILE: 'profile',
  };
  assert.equal(signingRoute(env).kind, 'azure');
  assert.throws(() => signingRoute({ ...env, AZURE_SIGNING_PROFILE: '' }), /all required/);

  assert.ok(builderArgs(signingRoute(env), env).includes('-c.win.azureSignOptions.publisherName=Morph Ltd'));
});
