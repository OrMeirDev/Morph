const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('morph', {
  // Electron 32+ no longer puts .path on dropped File objects; this is the supported way.
  pathForFile: (file) => webUtils.getPathForFile(file),
  detect: (paths) => ipcRenderer.invoke('files:detect', paths),
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  toolStatus: () => ipcRenderer.invoke('tools:status'),
  start: (job) => ipcRenderer.invoke('job:start', job),
  stop: (id) => ipcRenderer.invoke('job:stop', id),
  onProgress: on('job:progress'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  getHistory: () => ipcRenderer.invoke('history:get'),
  addHistory: (entry) => ipcRenderer.invoke('history:add', entry),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  openFolder: (dir) => ipcRenderer.invoke('folder:open', dir),
  showFile: (file) => ipcRenderer.invoke('file:show', file),
  openFile: (file) => ipcRenderer.invoke('file:open', file),
  fileExists: (file) => ipcRenderer.invoke('file:exists', file),
  appVersion: () => ipcRenderer.invoke('app:version'),
  checkAppUpdate: () => ipcRenderer.invoke('update:check'),
  downloadAppUpdate: () => ipcRenderer.invoke('update:download'),
  installAppUpdate: () => ipcRenderer.invoke('update:install'),
  onAppUpdate: on('update:status'),
});
