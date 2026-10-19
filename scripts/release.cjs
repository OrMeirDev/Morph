// The release command must never publish an unsigned Windows build. CI may still create an
// unsigned installer for tests, but a real release needs one complete signing route and the
// expected publisher name. Credentials are read from the environment and are never printed.
const { spawnSync } = require('child_process');

function signingRoute(env) {
  const publisher = String(env.MORPH_PUBLISHER || '').trim();
  const pfx = Boolean(env.WIN_CSC_LINK || env.WIN_CSC_KEY_PASSWORD);
  const azureValues = [
    env.AZURE_TENANT_ID,
    env.AZURE_CLIENT_ID,
    env.AZURE_CLIENT_SECRET,
    env.AZURE_SIGNING_ENDPOINT,
    env.AZURE_SIGNING_ACCOUNT,
    env.AZURE_SIGNING_PROFILE,
  ];
  const azure = azureValues.some(Boolean);

  if (!publisher) throw new Error('release-blocked: MORPH_PUBLISHER is required');
  if (pfx && azure) throw new Error('release-blocked: configure either PFX or Azure Trusted Signing, not both');
  if (pfx && !(env.WIN_CSC_LINK && env.WIN_CSC_KEY_PASSWORD)) {
    throw new Error('release-blocked: WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD are both required');
  }
  if (azure && azureValues.some((v) => !v)) {
    throw new Error('release-blocked: the Azure signing credentials, endpoint, account and profile are all required');
  }
  if (!pfx && !azure) throw new Error('release-blocked: no code-signing route is configured');

  return { publisher, kind: pfx ? 'pfx' : 'azure' };
}

function builderArgs(route, env = process.env) {
  const args = ['electron-builder', '--win', 'nsis', '--x64', '--publish', 'always'];
  if (route.kind === 'pfx') {
    args.push(`-c.win.signtoolOptions.publisherName=${route.publisher}`);
  } else {
    args.push(
      `-c.win.azureSignOptions.endpoint=${env.AZURE_SIGNING_ENDPOINT}`,
      `-c.win.azureSignOptions.codeSigningAccountName=${env.AZURE_SIGNING_ACCOUNT}`,
      `-c.win.azureSignOptions.certificateProfileName=${env.AZURE_SIGNING_PROFILE}`,
      `-c.win.azureSignOptions.publisherName=${route.publisher}`,
    );
  }
  return args;
}

if (require.main === module) {
  try {
    const route = signingRoute(process.env);
    console.log(`Release signing configured: ${route.kind}; publisher: ${route.publisher}`);
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const result = spawnSync(npx, builderArgs(route, process.env), { stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { signingRoute, builderArgs };
