// electron-builder afterPack hook: copies the third-party engines (bin/) into resources\bin.
// They are copied here, not through extraResources, so that they never enter electron-builder's
// signing pipeline: every .exe copied by extraResources goes through the same signExts check as
// Morph.exe and the installer (a suffix match), so no signExts setting can sign Morph's own
// executables while leaving the engines alone. afterPack runs before signing and before the
// installer is built, so the engines are still packaged; they keep their vendors' signatures.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  const from = path.join(context.packager.info.projectDir, 'bin');
  const to = path.join(context.appOutDir, 'resources', 'bin');
  if (!fs.existsSync(from)) throw new Error(`after-pack: ${from} is missing (run npm run fetch-bin)`);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true, preserveTimestamps: true });
  console.log(`  • engines copied outside the signing pipeline  to=${path.relative(process.cwd(), to)}`);
};
