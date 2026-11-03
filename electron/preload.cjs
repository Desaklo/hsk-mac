const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hsk', {
  loadDataset: () => ipcRenderer.invoke('dataset:load'),
  loadProgress: () => ipcRenderer.invoke('progress:load'),
  saveProgress: (data) => ipcRenderer.invoke('progress:save', data),
  exportProgress: (data) => ipcRenderer.invoke('progress:export', data),
  importProgress: () => ipcRenderer.invoke('progress:import'),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
})
