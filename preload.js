const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mslsc', {
  selectSystem: (id) => ipcRenderer.send('select-system', id),
  retrySystem: (id) => ipcRenderer.send('retry-system', id),
  onLoadingState: (callback) => {
    ipcRenderer.on('loading-state', (_event, state) => callback(state))
  },
  onRestoreRailHighlight: (callback) => {
    ipcRenderer.on('restore-rail-highlight', (_event, id) => callback(id))
  },
})
