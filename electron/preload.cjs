// Gives the page a narrow bridge to the journal file on disk. Nothing else
// from Node is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('journalFile', {
  load: () => ipcRenderer.invoke('journal:load'),
  save: (data) => ipcRenderer.invoke('journal:save', data),
  reveal: () => ipcRenderer.invoke('journal:reveal'),
  location: () => ipcRenderer.invoke('journal:location'),
});
