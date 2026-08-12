const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendDrawMessage: (data) => ipcRenderer.send('draw-message', data),
  onDrawMessage: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('draw-message', handler);
    return () => ipcRenderer.removeListener('draw-message', handler);
  },
  sendRemoteControlMessage: (data) => ipcRenderer.send('remote-control-message', data),
  getShareTargetBounds: () => ipcRenderer.invoke('get-share-target-bounds'),
  clearShareTarget: () => ipcRenderer.invoke('clear-share-target'),
});
