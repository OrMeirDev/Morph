// Composition root: builds the modules, wires IPC and owns the window and app lifecycle. No
// conversion, detection or persistence logic lives here.
const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');

const limits = require('./domain/limits.cjs');
const { ToolRegistry } = require('./infra/ToolRegistry.cjs');
const { PersistentWorker, runInFreshWorker, probeImageWorker } = require('./infra/WorkerHost.cjs');
const { SettingsRepository, HistoryRepository, JobRepository } = require('./infra/repositories.cjs');
const { OfficeProfileManager } = require('./infra/OfficeProfileManager.cjs');
const { discardLeftovers } = require('./infra/OutputPublisher.cjs');
const { sweepWorkspaces } = require('./infra/JobWorkspace.cjs');
const { FileIntakeService } = require('./app/FileIntakeService.cjs');
const { ConversionCoordinator } = require('./app/ConversionCoordinator.cjs');
const { createRouter, trustedSenderCheck } = require('./ipc/router.cjs');
const adapters = require('./adapters/index.cjs');

const DEV_URL = 'http://localhost:5174';
const INDEX_HTML = path.join(__dirname, '..', 'dist', 'index.html');
const APP_URL_PREFIX = process.env.VITE_DEV ? `${DEV_URL}/` : pathToFileURL(INDEX_HTML).href;

let mainWindow = null;
const sendToWindow = (channel, data) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
};

// ---------- modules ----------

const userData = app.getPath('userData');
const settings = new SettingsRepository(userData, { defaultFolder: path.join(app.getPath('documents'), 'Morph') });
const history = new HistoryRepository(userData, { maxEntries: limits.history.maxEntries });
const journal = new JobRepository(userData);
const detectionWorker = new PersistentWorker();
const tools = new ToolRegistry({
  probeImages: () => probeImageWorker({ confinement: tools.confinement, fallback: () => detectionWorker.request({ type: 'probe' }, { timeoutMs: limits.deadlines.probe }) }),
});
const intake = new FileIntakeService({
  detect: (file) => detectionWorker.request({ type: 'detect', file }, { timeoutMs: limits.deadlines.detect }),
  tools,
  limits: limits.intake,
});
// Must stay short: see infra/OfficeProfileManager.cjs.
const officeProfiles = new OfficeProfileManager({ baseDir: path.join(userData, 'loprofile') });
const coordinator = new ConversionCoordinator({
  intake,
  tools,
  settings,
  history,
  journal,
  adapters,
  officeProfiles,
  runTool: (name, args, o) => tools.run(name, args, { tailBytes: limits.logTailBytes, maxCaptureBytes: limits.maxCapturedBytes, ...o }),
  runWorker: (msg, o) => runInFreshWorker(msg, { ...o, confine: { confinement: tools.confinement, workspace: o.workspace } }),
  emit: (update) => sendToWindow('job:update', update),
});

// A crash or forced quit can leave staging files, empty reservations and workspaces behind.
// Clean them up; interrupted jobs are not restarted.
async function recoverInterruptedJobs() {
  const interrupted = journal.takeInterrupted();
  for (const r of interrupted) await discardLeftovers(r.leftovers || []);
  await sweepWorkspaces();
  return interrupted.length;
}

// ---------- app updates (GitHub releases, silent install + relaunch) ----------

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('update-available', (info) => sendToWindow('update:status', { state: 'available', version: info.version }));
autoUpdater.on('update-not-available', () => sendToWindow('update:status', { state: 'none' }));
autoUpdater.on('download-progress', (p) => sendToWindow('update:status', { state: 'downloading', percent: Math.round(p.percent) }));
autoUpdater.on('update-downloaded', (info) => sendToWindow('update:status', { state: 'ready', version: info.version }));
autoUpdater.on('error', (e) => sendToWindow('update:status', { state: 'error', message: String(e?.message || e).slice(0, 200) }));

const withDeadline = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);

// ---------- IPC ----------

const router = createRouter({
  ipcMain,
  isTrustedSender: trustedSenderCheck({ getWindow: () => mainWindow, appUrlPrefix: APP_URL_PREFIX }),
  log: (m) => console.warn(m),
});

router.handle('files:detect', (paths) => intake.detectPaths(paths));
router.handle('files:pick', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});
// A row removed from the list frees its file ID, unless a job is still using it.
router.handle('files:release', (fileId) => { if (!coordinator.isBusy(fileId)) intake.release(fileId); });
router.handle('jobs:enqueue', ({ fileId, target }) => coordinator.enqueue({ fileId, target }));
router.handle('jobs:cancel', (fileId) => coordinator.cancel(fileId));
router.handle('jobs:snapshot', () => coordinator.snapshot());
router.handle('tools:status', async () => (await tools.probe()).status());

router.handle('settings:get', () => settings.get());
router.handle('settings:set', (patch) => settings.patch(patch));

router.handle('history:get', () => history.list().map((e) => ({ ...e, exists: fs.existsSync(e.output) })));
router.handle('history:clear', () => history.clear());

router.handle('folder:choose', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
router.handle('folder:open', () => {
  const { folder } = settings.get();
  fs.mkdirSync(folder, { recursive: true });
  return shell.openPath(folder);
});
// Only outputs Morph published (recorded in history) may be opened or revealed.
router.handle('output:open', (p) => (history.hasOutput(p) ? shell.openPath(p) : 'not-a-morph-output'));
router.handle('output:show', (p) => { if (history.hasOutput(p)) shell.showItemInFolder(p); });

router.handle('app:version', () => app.getVersion());
router.handle('update:check', () => (app.isPackaged ? autoUpdater.checkForUpdates().then(() => true).catch(() => false) : false));
router.handle('update:download', () => autoUpdater.downloadUpdate().catch(() => null));
// Stop conversions and wait for their cleanup before the installer replaces the app.
router.handle('update:install', async () => {
  await withDeadline(coordinator.cancelAll(), 20000);
  detectionWorker.stop();
  autoUpdater.quitAndInstall(true, true);
});

// ---------- window ----------

function createWindow() {
  // Open at a size that fits the screen; the layout never needs page scrolling down to the
  // minimum size (only the file list scrolls inside itself).
  const area = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(1320, area.width - 40),
    height: Math.min(900, area.height - 40),
    minWidth: Math.min(1000, area.width),
    minHeight: Math.min(660, area.height),
    center: true,
    title: 'Morph',
    backgroundColor: '#f4f8fe',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow = win;
  win.webContents.once('did-finish-load', () => {
    if (!app.isPackaged) return;
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000);
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
  });
  // Files dropped outside the drop zone must not navigate the window away from the app, and the
  // app never opens other windows or embeds web views.
  win.webContents.on('will-navigate', (ev) => ev.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', (ev) => ev.preventDefault());

  if (process.env.VITE_DEV) win.loadURL(DEV_URL);
  else win.loadFile(INDEX_HTML);
}

// One Morph at a time: opening it again brings the open window to the front instead.
const focusMain = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
};
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', focusMain);

app.whenReady().then(async () => {
  await recoverInterruptedJobs().catch(() => 0);
  tools.probe(); // in the background; intake waits for it
  createWindow();
});

let quitting = false;
app.on('window-all-closed', async () => {
  if (quitting) return;
  quitting = true;
  await withDeadline(coordinator.cancelAll(), 10000);
  detectionWorker.stop();
  app.quit();
});
