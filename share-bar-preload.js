const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shareBar', {
  onState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('share-bar-state', handler);
    return () => ipcRenderer.removeListener('share-bar-state', handler);
  },
  hover: (open) => ipcRenderer.send('share-bar-hover', open === true),
  action: (name) => ipcRenderer.send('share-bar-action', name),
});
