const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { detect } = require('./detect.cjs');
const { convert, toolStatus, setProfileDir } = require('./convert.cjs');

// ---------- settings & history ----------

const dataFile = (name) => path.join(app.getPath('userData'), name);
const readJson = (name, fallback) => {
  try { return JSON.parse(fs.readFileSync(dataFile(name), 'utf8')); } catch { return fallback; }
};
const writeJson = (name, value) => {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(dataFile(name), JSON.stringify(value, null, 2));
};
const defaults = () => ({
  outputMode: 'beside', // 'beside' = next to the original file, 'folder' = always into `folder`
  folder: path.join(app.getPath('documents'), 'Morph'),
  quality: 'high',
  maxHeight: null,
});
const readSettings = () => ({ ...defaults(), ...readJson('settings.json', {}) });

// ---------- app updates (same flow as Grab: GitHub releases, silent install + relaunch) ----------

let mainWindow = null;
const sendUpdate = (status) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', status);
};
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('update-available', (info) => sendUpdate({ state: 'available', version: info.version }));
autoUpdater.on('update-not-available', () => sendUpdate({ state: 'none' }));
autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
autoUpdater.on('update-downloaded', (info) => sendUpdate({ state: 'ready', version: info.version }));
autoUpdater.on('error', (e) => sendUpdate({ state: 'error', message: String(e?.message || e).slice(0, 200) }));

const jobs = new Map(); // id -> { cancel }

ipcMain.handle('update:check', () => (app.isPackaged ? autoUpdater.checkForUpdates().then(() => true).catch(() => false) : false));
ipcMain.handle('update:download', () => autoUpdater.downloadUpdate().catch(() => null));
ipcMain.handle('update:install', () => {
  for (const job of jobs.values()) job.cancel();
  autoUpdater.quitAndInstall(true, true);
});
ipcMain.handle('app:version', () => app.getVersion());

// ---------- files & conversions ----------

ipcMain.handle('files:detect', async (_e, paths) => Promise.all(paths.map(async (p) => ({ path: p, ...(await detect(p)) }))));
ipcMain.handle('files:pick', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('tools:status', () => toolStatus());

ipcMain.handle('job:start', async (e, job) => {
  const s = readSettings();
  const handle = convert(
    { ...job, outDir: s.outputMode === 'folder' ? s.folder : null, quality: s.quality, maxHeight: s.maxHeight },
    (percent) => { if (!e.sender.isDestroyed()) e.sender.send('job:progress', { id: job.id, percent }); },
  );
  jobs.set(job.id, handle);
  const result = await handle.done;
  jobs.delete(job.id);
  return result;
});
ipcMain.handle('job:stop', (_e, id) => jobs.get(id)?.cancel());

ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_e, patch) => {
  const next = { ...readSettings(), ...patch };
  writeJson('settings.json', next);
  return next;
});

ipcMain.handle('history:get', () => readJson('history.json', []));
ipcMain.handle('history:add', (_e, entry) => {
  writeJson('history.json', [{ ...entry, convertedAt: new Date().toISOString() }, ...readJson('history.json', [])].slice(0, 1000));
});
ipcMain.handle('history:clear', () => writeJson('history.json', []));

ipcMain.handle('folder:choose', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('folder:open', (_e, dir) => { fs.mkdirSync(dir, { recursive: true }); return shell.openPath(dir); });
ipcMain.handle('file:show', (_e, file) => shell.showItemInFolder(file));
ipcMain.handle('file:open', (_e, file) => shell.openPath(file));
ipcMain.handle('file:exists', (_e, file) => !!file && fs.existsSync(file));

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
    backgroundColor: '#f6f7fb',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow = win;
  win.webContents.once('did-finish-load', () => {
    if (!app.isPackaged) return;
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000);
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
  });
  // Files dropped outside the drop zone must not navigate the window away from the app.
  win.webContents.on('will-navigate', (ev) => ev.preventDefault());

  if (process.env.VITE_DEV) win.loadURL('http://localhost:5174');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  setProfileDir(path.join(app.getPath('userData'), 'loprofile')); // must stay short: see convert.cjs
  createWindow();
});
app.on('window-all-closed', () => {
  for (const job of jobs.values()) job.cancel();
  app.quit();
});
