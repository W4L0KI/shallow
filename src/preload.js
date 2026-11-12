const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const listener = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('api', {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  rescan: () => ipcRenderer.invoke('library:rescan'),
  updateGame: (id, patch) => ipcRenderer.invoke('game:update', id, patch),
  launch: (id) => ipcRenderer.invoke('game:launch', id),
  stop: (id) => ipcRenderer.invoke('game:stop', id),
  openFolder: (id) => ipcRenderer.invoke('game:openFolder', id),
  refetchArt: (id, opts) => ipcRenderer.invoke('game:refetchArt', id, opts),
  pickImage: (id, kind) => ipcRenderer.invoke('game:pickImage', id, kind),
  pickExe: (id) => ipcRenderer.invoke('game:pickExe', id),
  addManual: () => ipcRenderer.invoke('game:addManual'),
  steamSearch: (term) => ipcRenderer.invoke('steam:search', term),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  pickRoot: () => ipcRenderer.invoke('settings:pickRoot'),
  refetchAll: () => ipcRenderer.invoke('settings:refetchAll'),
  win: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  onLibraryChanged: on('library:changed'),
  onGameUpdated: on('game:updated'),
  onArtProgress: on('art:progress'),
  onSessionEnded: on('session:ended'),
  onToast: on('toast'),
  onWindowState: on('window:state'),
});
