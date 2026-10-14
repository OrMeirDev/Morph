// End-to-end conversion flow in the real app window (throwaway profile and files): add files the
// way a drop does, convert all, stop a running job, try forged IPC from the page, check history and
// the production Content Security Policy. Needs a VITE_E2E_HOOKS build (npm run e2e:flow).
// Prints a JSON report and exits non-zero on any failed check.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const OUT_DIR = path.join(__dirname, 'output', path.basename(__filename, '.cjs'));
fs.mkdirSync(OUT_DIR, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'morph-e2e-profile-')));
app.on('window-all-closed', () => {});

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-e2e-files-'));
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); };

app.whenReady().then(() => run().catch((e) => {
  // Any unexpected error ends the run at once with what passed so far (no silent wait for the timeout).
  console.log('ERROR', e && e.stack, JSON.stringify(checks, null, 2));
  app.exit(1);
}));

async function run() {
  const sharp = require('sharp');
  await sharp({ create: { width: 64, height: 48, channels: 3, background: '#2a7' } }).png().toFile(path.join(work, 'photo.png'));
  await sharp({ create: { width: 3000, height: 3000, channels: 3, background: '#a27' } }).png().toFile(path.join(work, 'huge.png'));
  fs.writeFileSync(path.join(work, 'notes.xyz'), 'not a known format');

  require(path.join(__dirname, '..', 'electron', 'main.cjs'));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  setTimeout(() => { console.log('TIMEOUT', JSON.stringify(checks, null, 2)); app.exit(2); }, 120000);
  let win;
  while (!(win = BrowserWindow.getAllWindows()[0])) await wait(30);
  win.setContentSize(1347, 852);
  const js = (c) => win.webContents.executeJavaScript(c);
  // Screenshots are evidence for people, not checks: a capture failure (seen on GPU-less CI runners
  // as UnknownVizError) is noted and the flow goes on.
  const shotErrors = [];
  const shot = async (n) => {
    await wait(300);
    try { fs.writeFileSync(path.join(OUT_DIR, `${n}.png`), (await win.webContents.capturePage()).toPNG()); } catch (e) { shotErrors.push(`${n}: ${e.message}`); }
  };
  const waitFor = async (expr, ms = 30000) => { const t0 = Date.now(); while (!(await js(expr))) { if (Date.now() - t0 > ms) return false; await wait(100); } return true; };

  await waitFor(`document.querySelectorAll('.nav-item').length > 0`);
  check('CSP meta present', await js(`!!document.querySelector('meta[http-equiv="Content-Security-Policy"]')`));
  check('removed APIs are gone', await js(`!('start' in window.morph) && !('fileExists' in window.morph) && !('addHistory' in window.morph)`));
  check('test hook present in the e2e build', await js(`typeof window.__morphAdd === 'function'`));

  // Forged commands from the page are refused by main before any work.
  const forged = await js(`Promise.allSettled([
    window.morph.enqueue('C:/Windows/system32/x', 'mp4'),
    window.morph.enqueue('0f8fad5b-d9cb-469f-a165-70867728950e', 'mp4'),
    window.morph.setSettings({ quality: 'ultra' }),
    window.morph.openOutput('/etc/hosts'),
  ]).then((r) => r.map((x) => x.status === 'fulfilled' ? JSON.stringify(x.value) : String(x.reason && x.reason.message)))`);
  check('forged path as file ID refused', /bad-request/.test(forged[0]), forged[0]);
  check('unknown file ID refused', /unknown-file/.test(forged[1]), forged[1]);
  check('invalid setting refused', /bad-request/.test(forged[2]), forged[2]);
  check('opening a non-Morph path refused', /not-a-morph-output/.test(forged[3]), forged[3]);

  // Add the same files twice at once: each appears once.
  const files = ['photo.png', 'notes.xyz'].map((f) => path.join(work, f));
  await js(`Promise.all([window.__morphAdd(${JSON.stringify(files)}), window.__morphAdd(${JSON.stringify(files)})])`);
  await waitFor(`document.querySelectorAll('.file-row').length >= 2`);
  await wait(300);
  check('concurrent adds deduplicated', (await js(`document.querySelectorAll('.file-row').length`)) === 2);
  check('unknown file shown as unsupported', (await js(`document.querySelectorAll('.file-row.unsupported').length`)) === 1);
  await shot('1-added');

  await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('המר הכול')).click()`);
  const done = await waitFor(`document.querySelectorAll('.pill-success').length === 1`);
  check('convert all completed', done);
  check('output written next to the original', fs.existsSync(path.join(work, 'photo.jpg')), fs.readdirSync(work).join(', '));
  await shot('2-done');

  // Stop during a long conversion (tracing a large image to SVG).
  await js(`window.__morphAdd(${JSON.stringify([path.join(work, 'huge.png')])})`);
  await waitFor(`document.querySelectorAll('.file-row').length === 3`);
  const rowIdx = await js(`[...document.querySelectorAll('.file-row')].findIndex((r) => r.textContent.includes('huge.png'))`);
  // choose SVG through the glass menu
  await js(`document.querySelectorAll('.file-row')[${rowIdx}].querySelector('.gselect').click()`);
  await wait(300);
  await js(`[...document.querySelectorAll('.gm-item')].find((x) => x.textContent.trim() === 'SVG').click()`);
  await wait(200);
  await js(`document.querySelectorAll('.file-row')[${rowIdx}].querySelector('.icon-btn.accent').click()`);
  await waitFor(`!!document.querySelectorAll('.file-row')[${rowIdx}].querySelector('.row-progress')`, 10000);
  await wait(200);
  await shot('3-converting');
  await js(`document.querySelectorAll('.file-row')[${rowIdx}].querySelector('button[title="עצור"]').click()`);
  const stopped = await waitFor(`!document.querySelectorAll('.file-row')[${rowIdx}].querySelector('.row-progress') && !!document.querySelectorAll('.file-row')[${rowIdx}].querySelector('.icon-btn.accent')`, 15000);
  check('stop ends the job and offers convert again', stopped);
  await wait(500);
  check('no SVG written after stop', !fs.existsSync(path.join(work, 'huge.svg')), fs.readdirSync(work).join(', '));
  check('no staging leftovers', !fs.readdirSync(work).some((n) => n.startsWith('.~morph-')));
  await shot('4-stopped');

  // History lists the completed conversion (recorded by main, not the page).
  await js(`document.querySelectorAll('.nav-item')[2].click()`);
  await waitFor(`document.querySelectorAll('.row').length > 0`, 5000);
  check('history shows the conversion', (await js(`document.querySelectorAll('.row').length`)) === 1);
  await shot('5-history');
  await js(`document.querySelectorAll('.nav-item')[3].click()`);
  await wait(500);
  await shot('6-settings');

  const failed = checks.filter((c) => !c.ok);
  console.log(JSON.stringify({ passed: checks.length - failed.length, failed: failed.length, checks, screenshotErrors: shotErrors }, null, 2));
  fs.rmSync(work, { recursive: true, force: true });
  app.exit(failed.length ? 1 : 0);
}
