// Builds native/out/morph-confine.exe from morph-confine.c.
//
//   node native/confine/build.cjs            Windows: MSVC (found with vswhere), the shipped build
//   node native/confine/build.cjs --mingw    any host with x86_64-w64-mingw32-gcc: compile check only
//
// Reproducible: /Brepro (no timestamps), static C runtime (/MT: the engine runs in an AppContainer
// and must not depend on a separately installed VC++ runtime), fixed flags. The compiler version
// and the SHA-256 of the result are written next to it (morph-confine.json); the same compiler
// version gives the same bytes.
const { execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'morph-confine.c');
const OUT_DIR = path.join(__dirname, '..', 'out');
const OUT = path.join(OUT_DIR, 'morph-confine.exe');

const CL_FLAGS = ['/nologo', '/O2', '/W4', '/GS', '/guard:cf', '/MT', '/Brepro', '/DUNICODE', '/D_UNICODE'];
const LINK_FLAGS = ['/link', '/Brepro', '/DYNAMICBASE', '/NXCOMPAT', '/CETCOMPAT', '/guard:cf', '/SUBSYSTEM:CONSOLE', 'userenv.lib', 'advapi32.lib', 'user32.lib'];

function vcvars() {
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!fs.existsSync(vswhere)) throw new Error('Visual Studio (C++ build tools) not found: vswhere.exe is missing');
  const install = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' }).trim();
  const bat = path.join(install, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  if (!install || !fs.existsSync(bat)) throw new Error('MSVC x64 tools not found (install "Desktop development with C++")');
  // vcvars64.bat (VS 2026) runs vswhere.exe through PATH; outside CI it is not there, and the
  // "not recognized" line used to be recorded as the compiler version.
  const env = { ...process.env, PATH: `${path.dirname(vswhere)};${process.env.PATH || ''}` };
  return { bat, env };
}

function buildMsvc() {
  const { bat, env } = vcvars();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const obj = path.join(OUT_DIR, 'morph-confine.obj');
  const cmd = `call "${bat}" >nul && cl ${CL_FLAGS.join(' ')} /Fo"${obj}" /Fe"${OUT}" "${SRC}" ${LINK_FLAGS.join(' ')}`;
  const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${cmd}"`], { stdio: 'inherit', windowsVerbatimArguments: true, env });
  if (r.status !== 0) throw new Error(`cl failed (${r.status})`);
  fs.rmSync(obj, { force: true });
  const ver = spawnSync('cmd.exe', ['/d', '/s', '/c', `"call "${bat}" >nul && cl"`], { encoding: 'utf8', windowsVerbatimArguments: true, env });
  const compiler = (ver.stderr || '').split(/\r?\n/).find((l) => /Compiler Version/.test(l));
  if (!compiler) throw new Error(`could not read the compiler version from cl: ${(ver.stderr || '').trim().slice(0, 300)}`);
  return compiler.trim();
}

function buildMingw() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, 'morph-confine.mingw.exe');
  execFileSync('x86_64-w64-mingw32-gcc', ['-municode', '-O2', '-Wall', '-Wextra', '-Wno-unused-parameter', '-Werror', '-o', out, SRC, '-luserenv', '-ladvapi32', '-luser32', '-Wl,--no-insert-timestamp'], { stdio: 'inherit' });
  return out;
}

if (process.argv.includes('--mingw')) {
  console.log(`compile check ok: ${buildMingw()}`);
} else {
  if (process.platform !== 'win32') throw new Error('the shipped helper is built on Windows with MSVC; use --mingw for a compile check');
  const compiler = buildMsvc();
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(OUT)).digest('hex');
  const sourceSha256 = crypto.createHash('sha256').update(fs.readFileSync(SRC)).digest('hex');
  fs.writeFileSync(path.join(OUT_DIR, 'morph-confine.json'), JSON.stringify({ compiler, flags: [...CL_FLAGS, ...LINK_FLAGS], sourceSha256, sha256 }, null, 2));
  console.log(`built ${OUT}\n${compiler}\nsha256 ${sha256}`);
}
