const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

// The renderer's whole API. Every call is validated again in main (electron/ipc/schemas.cjs).
contextBridge.exposeInMainWorld('morph', {
  // Electron 32+ no longer puts .path on dropped File objects; this is the supported way.
  pathForFile: (file) => webUtils.getPathForFile(file),
  detect: (paths) => ipcRenderer.invoke('files:detect', paths),
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  releaseFile: (fileId) => ipcRenderer.invoke('files:release', fileId),
  toolStatus: () => ipcRenderer.invoke('tools:status'),
  enqueue: (fileId, target) => ipcRenderer.invoke('jobs:enqueue', { fileId, target }),
  cancel: (fileId) => ipcRenderer.invoke('jobs:cancel', fileId),
  jobsSnapshot: () => ipcRenderer.invoke('jobs:snapshot'),
  onJobUpdate: on('job:update'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  getHistory: () => ipcRenderer.invoke('history:get'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  openFolder: () => ipcRenderer.invoke('folder:open'),
  showOutput: (file) => ipcRenderer.invoke('output:show', file),
  openOutput: (file) => ipcRenderer.invoke('output:open', file),
  appVersion: () => ipcRenderer.invoke('app:version'),
  checkAppUpdate: () => ipcRenderer.invoke('update:check'),
  downloadAppUpdate: () => ipcRenderer.invoke('update:download'),
  installAppUpdate: () => ipcRenderer.invoke('update:install'),
  onAppUpdate: on('update:status'),
});
