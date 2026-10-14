// electron-builder configuration for the auto-update test builds only: Morph's normal build config
// with a generic update feed on this machine (never GitHub, never published), a given version, a
// separate output folder, and no compression (the payload is already compressed; saves CI time).
//   MORPH_UPDATE_FEED=http://127.0.0.1:8765/ MORPH_VERSION=1.0.5 MORPH_OUT=release-b \
//     npx electron-builder --config e2e/update-feed.builder.cjs --win nsis --x64 --publish never
const pkg = require('../package.json');

const { MORPH_UPDATE_FEED, MORPH_VERSION, MORPH_OUT } = process.env;
if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(MORPH_UPDATE_FEED || '')) throw new Error('MORPH_UPDATE_FEED must be a local http://127.0.0.1:<port>/ feed');
if (!/^\d+\.\d+\.\d+$/.test(MORPH_VERSION || '')) throw new Error('MORPH_VERSION must be a plain x.y.z (a pre-release tag would switch the updater channel)');
if (!MORPH_OUT) throw new Error('MORPH_OUT is required');

module.exports = {
  ...pkg.build,
  extraMetadata: { version: MORPH_VERSION },
  directories: { ...pkg.build.directories, output: MORPH_OUT },
  publish: [{ provider: 'generic', url: MORPH_UPDATE_FEED }],
  compression: 'store',
};
