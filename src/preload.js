'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The main process checks the sender of every message, so exposing one API to
// both the bar and the picker is safe: each window only gets answers for its own calls.
contextBridge.exposeInMainWorld('api', {
  settings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickSource: () => ipcRenderer.invoke('pick-source'),
  recStart: (meta) => ipcRenderer.invoke('rec:start', meta),
  recChunk: (buf) => ipcRenderer.send('rec:chunk', buf),
  recStop: () => ipcRenderer.invoke('rec:stop'),
  setState: (state) => ipcRenderer.send('rec:state', state),
  notify: (title, body) => ipcRenderer.send('notify', title, body),
  openFile: (file) => ipcRenderer.send('open-file', file),
  recoverCheck: () => ipcRenderer.invoke('recover:check'),
  recoverRun: () => ipcRenderer.invoke('recover:run'),
  quit: () => ipcRenderer.send('quit'),
  onToggle: (cb) => ipcRenderer.on('toggle-record', () => cb()),
  onSettings: (cb) => ipcRenderer.on('settings-changed', (_e, s) => cb(s)),
});

contextBridge.exposeInMainWorld('picker', {
  list: () => ipcRenderer.invoke('picker:list'),
  choose: (src) => ipcRenderer.send('picker:choose', src),
  cancel: () => ipcRenderer.send('picker:cancel'),
});
