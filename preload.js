const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendDrawMessage: (data) => ipcRenderer.send('draw-message', data),
  onDrawMessage: (callback) => ipcRenderer.on('draw-message', (_event, data) => callback(data)),
  sendRemoteControlMessage: (data) => ipcRenderer.send('remote-control-message', data),
});
