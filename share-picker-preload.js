const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sharePicker', {
  onSources: (callback) => {
    ipcRenderer.on('share-picker-sources', (_event, data) => callback(data));
  },
  done: (choice) => ipcRenderer.send('share-picker-done', choice),
});
