const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updateReady', {
  installNow: () => ipcRenderer.send('update-ready-response', true),
  installLater: () => ipcRenderer.send('update-ready-response', false),
});
