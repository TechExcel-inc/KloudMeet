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
  /** A control request is waiting (or null when answered): also shown in the floating bar. */
  setRemoteControlRequest: (request) => ipcRenderer.send('remote-control-request', request),
  onRemoteControlAnswer: (callback) => {
    const handler = (_event, allow) => callback(allow === true);
    ipcRenderer.on('remote-control-answer', handler);
    return () => ipcRenderer.removeListener('remote-control-answer', handler);
  },
  getShareTargetBounds: () => ipcRenderer.invoke('get-share-target-bounds'),
  clearShareTarget: () => ipcRenderer.invoke('clear-share-target'),
  /** Google sign-in opens the system browser and returns via kloudmeet://auth. */
  googleSignInInBrowser: true,
});
