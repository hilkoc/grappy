const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// The renderer never gets a Node API. It only gets these calls, and it opens its own
// WebSocket to the bridge with the port they hand back.
contextBridge.exposeInMainWorld('grappy', {
  getBridgeInfo: () => ipcRenderer.invoke('grappy:get-bridge-info'),
  selectInterpreter: () => ipcRenderer.invoke('grappy:select-interpreter'),
  restartBridge: () => ipcRenderer.invoke('grappy:restart-bridge'),
  // The renderer owns the graph, so it hands over finished text and gets back a path.
  saveGraph: (contents, saveAs) => ipcRenderer.invoke('grappy:save-graph', contents, saveAs),
  openGraph: () => ipcRenderer.invoke('grappy:open-graph'),
  onBridgeChanged: (callback) => subscribe('grappy:bridge-changed', callback),
  onMenuCommand: (callback) => subscribe('grappy:menu', callback),
});
