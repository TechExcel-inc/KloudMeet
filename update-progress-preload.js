const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updateProgress', {
  onProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => {
      try {
        callback(payload);
      } catch {
        /* ignore */
      }
    };
    ipcRenderer.on('update-download-progress', handler);
    return () => {
      ipcRenderer.removeListener('update-download-progress', handler);
    };
  },
});
