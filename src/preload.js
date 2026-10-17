'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The main process checks the sender of every message, so exposing one API to
// both the bar and the picker is safe: each window only gets answers for its own calls.
contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  settings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickSource: () => ipcRenderer.invoke('pick-source'),
  clearSource: () => ipcRenderer.send('source:clear'),
  uiSize: (expanded, height) => ipcRenderer.send('ui:size', expanded, height),
  uiDrag: (phase) => ipcRenderer.send('ui:drag', phase),
  recStart: (meta) => ipcRenderer.invoke('rec:start', meta),
  recChunk: (buf) => ipcRenderer.send('rec:chunk', buf),
  recAudioChunk: (buf) => ipcRenderer.send('rec:audio-chunk', buf),
  recStop: () => ipcRenderer.invoke('rec:stop'),
  setState: (state) => ipcRenderer.send('rec:state', state),
  uiMini: (width, height) => ipcRenderer.send('ui:mini', width, height),
  openSoundSettings: () => ipcRenderer.send('open-sound-settings'),
  openFile: (file) => ipcRenderer.send('open-file', file),
  libList: () => ipcRenderer.invoke('lib:list'),
  libPlay: (id) => ipcRenderer.send('lib:play', id),
  libFolder: (id) => ipcRenderer.send('lib:folder', id),
  libProcess: (id) => ipcRenderer.invoke('lib:process', id),
  onLibProgress: (cb) => ipcRenderer.on('lib:progress', (_e, id, p) => cb(id, p)),
  quit: () => ipcRenderer.send('quit'),
  onToggle: (cb) => ipcRenderer.on('toggle-record', () => cb()),
  onSettings: (cb) => ipcRenderer.on('settings-changed', (_e, s) => cb(s)),
});

contextBridge.exposeInMainWorld('picker', {
  list: () => ipcRenderer.invoke('picker:list'),
  choose: (src, area) => ipcRenderer.send('picker:choose', src, area),
  cancel: () => ipcRenderer.send('picker:cancel'),
  openScreenSettings: () => ipcRenderer.send('picker:screen-settings'),
  relaunch: () => ipcRenderer.send('picker:relaunch'),
});

contextBridge.exposeInMainWorld('frameApi', {
  onState: (cb) => ipcRenderer.on('frame:state', (_e, state) => cb(state)),
});

contextBridge.exposeInMainWorld('region', {
  done: (rect) => ipcRenderer.send('region:done', rect),
  cancel: () => ipcRenderer.send('region:cancel'),
});
