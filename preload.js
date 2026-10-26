const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendDrawMessage: (data) => ipcRenderer.send('draw-message', data),
  onDrawMessage: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('draw-message', handler);
    return () => ipcRenderer.removeListener('draw-message', handler);
  },
  sendRemoteControlMessage: (data) => ipcRenderer.send('remote-control-message', data),
  /** Remote-control input beyond the mouse that this app executes. */
  remoteControlCaps: ['wheel', 'keys'],
  setRemoteControlSession: (session) => ipcRenderer.send('remote-control-session', session),
  onRemoteControlStopped: (callback) => {
    const handler = (_event, reason) => callback(reason);
    ipcRenderer.on('remote-control-stopped', handler);
    return () => ipcRenderer.removeListener('remote-control-stopped', handler);
  },
  getShareTargetBounds: () => ipcRenderer.invoke('get-share-target-bounds'),
  clearShareTarget: () => ipcRenderer.invoke('clear-share-target'),
  /** Google sign-in opens the system browser and returns via kloudmeet://auth. */
  googleSignInInBrowser: true,
});
