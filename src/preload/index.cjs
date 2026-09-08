const { contextBridge, ipcRenderer } = require('electron');

// The renderer never gets a Node API. It only gets these three calls, and it opens its own
// WebSocket to the bridge with the port they hand back.
contextBridge.exposeInMainWorld('grappy', {
  getBridgeInfo: () => ipcRenderer.invoke('grappy:get-bridge-info'),
  selectInterpreter: () => ipcRenderer.invoke('grappy:select-interpreter'),
  restartBridge: () => ipcRenderer.invoke('grappy:restart-bridge'),
  onBridgeChanged: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('grappy:bridge-changed', listener);
    return () => ipcRenderer.removeListener('grappy:bridge-changed', listener);
  },
});
