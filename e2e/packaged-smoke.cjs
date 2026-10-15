// Smoke test of a packaged Morph (win-unpacked folder or an installed copy), driven over the Chrome
// DevTools Protocol: the production build has no test hooks, so the page's own API (window.morph)
// is called exactly as the UI calls it. Checks: production CSP and no test hook, all six engine
// families verified from resources\bin, one real conversion per engine (sharp in the utility
// process from app.asar.unpacked, ffmpeg, Poppler, LibreOffice, Calibre, 7-Zip) with Hebrew file
// names, outputs valid, history recorded by main, no CSP violations.
//
//   node e2e/packaged-smoke.cjs <Morph.exe> [--appdata <dir>] [--expect-version <v>]
//        [--expect-settings <json>] [--expect-history <n>] [--report <file>] [--extra-args "<flags>"]
//
// --appdata: run with this APPDATA (default: a fresh temporary one, so the real profile is untouched).
// Prints a JSON report; exit code 1 when a check fails.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const exe = args[0];
const opt = (name) => { const i = args.indexOf(name); return i > 0 ? args[i + 1] : null; };
const PORT = 9339;
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); };
const { findPage, connect: cdp, wait } = require('./cdp.cjs');

async function makeFixtures(dir) {
  const h = require('../test/electron/helpers.cjs');
  fs.mkdirSync(dir, { recursive: true });
  return [
    { path: await h.makePng(path.join(dir, 'תמונה.png')), target: 'webp', engine: 'sharp' },
    { path: h.makeWav(path.join(dir, 'צליל.wav')), target: 'mp3', engine: 'ffmpeg' },
    { path: await h.makePdf(path.join(dir, 'מסמך.pdf'), 1), target: 'png', engine: 'Poppler' },
    { path: h.makeRichOdt(path.join(dir, 'מכתב.odt')), target: 'pdf', engine: 'LibreOffice' },
    { path: h.makeRichEpub(path.join(dir, 'ספר.epub')), target: 'mobi', engine: 'Calibre' },
    { path: h.makeZip(path.join(dir, 'ארכיון.zip'), [{ name: 'קובץ.txt', data: 'שלום' }]), target: '7z', engine: '7-Zip' },
  ];
}

// The page-side flow: detect, enqueue every file, wait for every terminal job state.
const FLOW = (jobs) => `(async (jobs) => {
  const det = await window.morph.detect(jobs.map((j) => j.path));
  const done = {};
  const off = window.morph.onJobUpdate((u) => { if (['completed', 'failed', 'cancelled'].includes(u.state)) done[u.fileId] = u; });
  const ids = [];
  for (let i = 0; i < jobs.length; i++) {
    const d = det[i];
    if (!d.ok) { ids.push('x' + i); done['x' + i] = { state: 'not-detected', error: d.error + ' ' + (d.missing || []).join(',') }; continue; }
    ids.push(d.id);
    const r = await window.morph.enqueue(d.id, jobs[i].target);
    if (!r.ok) done[d.id] = { state: 'refused', error: r.error };
  }
  const t0 = Date.now();
  while (ids.some((id) => !done[id]) && Date.now() - t0 < 300000) await new Promise((r) => setTimeout(r, 200));
  off();
  return jobs.map((j, i) => ({ ...j, kind: det[i].kind, result: done[ids[i]] || { state: 'timeout' } }));
})(${JSON.stringify(jobs)})`;

async function main() {
  if (!exe || !fs.existsSync(exe)) throw new Error(`usage: node e2e/packaged-smoke.cjs <Morph.exe> ...  (not found: ${exe})`);
  const appdata = opt('--appdata') || fs.mkdtempSync(path.join(os.tmpdir(), 'morph-smoke-appdata-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-smoke-files-'));
  // Windows keeps userData under APPDATA; Linux (used to check this script) under XDG_CONFIG_HOME.
  const env = { ...process.env, APPDATA: appdata, XDG_CONFIG_HOME: appdata };
  const extra = (opt('--extra-args') || '').split(' ').filter(Boolean);
  const t0 = Date.now();
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`, ...extra], { env, stdio: 'ignore', detached: false });
  let page;
  try {
    page = await findPage(PORT);
    check('app window opened', page, page?.url);
    if (!page) return;
    const c = await cdp(page.webSocketDebuggerUrl);
    await c.send('Runtime.enable');
    await c.send('Log.enable');
    await c.evaluate(`window.__cspViolations = []; document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(e.violatedDirective + ' ' + e.blockedURI)); true`);
    for (let i = 0; i < 100 && !(await c.evaluate('!!document.querySelector(".nav-item")')); i++) await wait(100);

    check('production CSP present', await c.evaluate(`!!document.querySelector('meta[http-equiv="Content-Security-Policy"]')`));
    check('no test hook in the production build', await c.evaluate(`typeof window.__morphAdd === 'undefined'`));
    const version = await c.evaluate('window.morph.appVersion()');
    const wantVersion = opt('--expect-version');
    check('app version', !wantVersion || version === wantVersion, `${version}${wantVersion ? ` (expected ${wantVersion})` : ''}`);
    const tools = await c.evaluate('window.morph.toolStatus()');
    const probeMs = Date.now() - t0;
    for (const k of ['ffmpeg', 'images', 'poppler', 'libreoffice', 'calibre', 'sevenzip']) check(`engine verified: ${k}`, tools?.[k], tools?.details);
    console.log('tool status after', probeMs, 'ms from launch:', JSON.stringify(tools?.details));
    // D2: the installed app runs every engine confined (morph-confine.exe in resources\native).
    check('engines confined (AppContainer + Job Object)', tools?.confinement?.mode === 'enforced', tools?.confinement);

    const wantSettings = opt('--expect-settings');
    if (wantSettings) {
      const got = await c.evaluate('window.morph.getSettings()');
      const want = JSON.parse(wantSettings);
      check('settings kept across the upgrade', Object.entries(want).every(([k, v]) => JSON.stringify(got[k]) === JSON.stringify(v)), { got, want });
    }
    const historyBefore = await c.evaluate('window.morph.getHistory()');
    const wantHistory = opt('--expect-history');
    if (wantHistory) check('history kept across the upgrade', historyBefore.length === Number(wantHistory), historyBefore);

    const jobs = await makeFixtures(path.join(work, 'קבצים עם שמות בעברית'));
    const results = await c.evaluate(FLOW(jobs));
    const { verifyFile } = require('../electron/infra/artifactValidator.cjs');
    for (const r of results) {
      let valid = false;
      let why = r.result.error || '';
      if (r.result.state === 'completed') {
        try { await verifyFile(r.result.output, r.target); valid = true; } catch (e) { why = e.message; }
      }
      check(`${r.engine}: ${path.extname(r.path)} -> ${r.target}`, valid, `${r.result.state} ${why} ${r.result.output || ''}`.trim());
    }
    const history = await c.evaluate('window.morph.getHistory()');
    check('history recorded by main for each conversion', history.length === historyBefore.length + results.filter((r) => r.result.state === 'completed').length && history.slice(0, results.length).every((h) => h.exists), history.length);
    const csp = await c.evaluate('window.__cspViolations');
    const cspLog = c.events.filter((e) => e.method === 'Log.entryAdded' && /Content Security Policy/i.test(e.params?.entry?.text || '')).map((e) => e.params.entry.text);
    check('no CSP violations', csp.length === 0 && cspLog.length === 0, [...csp, ...cspLog]);
    c.close();
  } finally {
    try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { child.kill(); }
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch((e) => check('smoke run', false, e.stack)).finally(() => {
  const failed = checks.filter((c) => !c.ok);
  const report = { exe, passed: checks.length - failed.length, failed: failed.length, checks };
  const out = opt('--report');
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(failed.length ? 1 : 0);
});
