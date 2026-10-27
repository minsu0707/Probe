// Bridge between the dashboard page and the desktop shell. The page can only call these four
// functions; it gets no access to Node or to Electron itself. CommonJS because sandboxed
// preload scripts cannot be ES modules.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('probeDesktop', {
  getUpdate: () => ipcRenderer.invoke('update:get'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update:state', listener);
    return () => ipcRenderer.removeListener('update:state', listener);
  },
});
