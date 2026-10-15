// A portable stand-in for native/confine/morph-confine.exe in lifecycle tests: starts the engine
// with this process's stdio, waits for it, then (like the real helper's finish()) writes the
// statistics file only while exiting. Behaviour knobs (environment):
//   FAKE_CONFINE_LINGER_MS   stay alive this long after the engine exited, before writing stats
//   FAKE_CONFINE_OUTCOME     outcome to report (default "exited"), e.g. "limit-memory"
//   FAKE_CONFINE_PIDS        file to append "helper <pid>" and "engine <pid>" lines to
//   node fake-confine.cjs --stats <file> [--cwd <dir>] -- <exe> [args...]
const { spawn } = require('child_process');
const fs = require('fs');

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 && i < sep ? argv[i + 1] : null; };
const [exe, ...args] = argv.slice(sep + 1);
const pids = process.env.FAKE_CONFINE_PIDS;
const child = spawn(exe, args, { stdio: 'inherit', cwd: opt('--cwd') || undefined });
if (pids) fs.appendFileSync(pids, `helper ${process.pid}\nengine ${child.pid}\n`);
child.on('exit', (code) => {
  setTimeout(() => {
    const stats = { outcome: process.env.FAKE_CONFINE_OUTCOME || 'exited', exitCode: code ?? 1, peakJobMemory: 123 * 1048576, totalProcesses: 1, fake: true };
    fs.writeFileSync(opt('--stats'), JSON.stringify(stats));
    process.exit(stats.outcome === 'exited' ? (code ?? 1) : 0x4d430002 & 0xff);
  }, Number(process.env.FAKE_CONFINE_LINGER_MS || 0));
});
