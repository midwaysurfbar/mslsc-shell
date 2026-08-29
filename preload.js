const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mslsc', {
  selectSystem: (id) => ipcRenderer.send('select-system', id),
  retrySystem: (id) => ipcRenderer.send('retry-system', id),
  // A link clicked inside the embedded Hub page that isn't one of the
  // rail's known short ids - opened the same way as any other system,
  // just keyed by its own URL instead of a pre-registered id.
  openUrl: (url, label) => ipcRenderer.send('open-url', url, label),
  // Hands the <webview>'s own webContents id to main so it can hook a
  // real, cancellable will-navigate on it - see main.js.
  registerHubWebContents: (id) => ipcRenderer.send('register-hub-webcontents', id),
  onLoadingState: (callback) => {
    ipcRenderer.on('loading-state', (_event, state) => callback(state))
  },
  onRestoreRailHighlight: (callback) => {
    ipcRenderer.on('restore-rail-highlight', (_event, id) => callback(id))
  },
})
