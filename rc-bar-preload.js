const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rcBar', {
  onState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('rc-bar-state', handler);
    return () => ipcRenderer.removeListener('rc-bar-state', handler);
  },
  stop: () => ipcRenderer.send('rc-bar-stop'),
});
