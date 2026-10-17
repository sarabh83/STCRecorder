'use strict';
const {
  app, BrowserWindow, ipcMain, session, desktopCapturer, screen, Tray, Menu,
  nativeImage, globalShortcut, shell, powerMonitor, systemPreferences,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { RecordingSession } = require('./storage');
const { listRecordings, recordingDir, playablePath, processRecording } = require('./library');

const { DEFAULTS, migrate, sanitizePatch } = require('./settings');

const APP_NAME = 'STC Recorder';
const IS_MAC = process.platform === 'darwin';
const SHORTCUT = IS_MAC ? 'Cmd+Shift+R' : 'Ctrl+Shift+R';
// Where the OS lets the user change the sound output and give the app screen access.
const SOUND_SETTINGS = IS_MAC ? 'x-apple.systempreferences:com.apple.preference.sound' : 'ms-settings:sound';
const SCREEN_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
const LEGACY_NAME = 'Starecorder';
app.setPath('userData', path.join(app.getPath('appData'), LEGACY_NAME));

const CHECKPOINT_MS = Number(process.env.RECORDER_CHECKPOINT_MS) || 3 * 60 * 1000; // a restorable version every 3 minutes
const SYNC_MS = 5 * 1000; // force data to disk every 5 s
const ICON = 44; // collapsed icon size (px)
const PANEL_W = 320;
const GAP = 8;
const PAD = 8; // transparent room around the icon / panel for the halo and shadows
const MARGIN = 16;
const DRAG_MS = 8; // how often the window is moved to the cursor while it is dragged

let settings = { ...DEFAULTS };
let win = null; // the one small window: corner icon + slide-out panel
let tray = null;
let picker = null;
let pendingSource = null; // {id, name} chosen in the picker
let rec = null;
let ckTimer = null;
let syncTimer = null;
let recState = 'idle';
let uiSize = { expanded: false, height: 0, mini: null }; // mini: {w, h} of the collapsed content (icon, timer, tooltip)
let drag = null; // timer that moves the window with the cursor while it is dragged
let region = null; // full-screen overlay for drawing the area to record
let frame = null; // click-through border around the selected area
let cropDisplay = null; // the display that area was drawn on
let pickerDisplays = new Map(); // screen source id -> display id, from the last picker list
let job = null; // the one recording being processed to MP4: { id, run }

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
// The app used to be called Starecorder. Its folders keep that name, so the recordings and
// settings made before the rename are still found.
const baseDir = () => path.join(app.getPath('videos'), LEGACY_NAME);
const asset = (name) => path.join(__dirname, '..', 'assets', name);

function loadSettings() {
  try {
    settings = migrate(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')));
  } catch {
    settings = migrate(null);
  }
}

function saveSettings(patch) {
  settings = { ...settings, ...patch };
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings));
  } catch { /* non-fatal */ }
  if (win && !win.isDestroyed()) win.webContents.send('settings-changed', settings);
  buildTrayMenu();
}

const fromWin = (e) => win && !win.isDestroyed() && e.sender === win.webContents;
const fromPicker = (e) => picker && !picker.isDestroyed() && e.sender === picker.webContents;
const fromRegion = (e) => region && !region.isDestroyed() && e.sender === region.webContents;

// ---------- windows ----------

// Bottom-right corner of the icon, kept inside a visible display.
function anchor() {
  const wa = screen.getPrimaryDisplay().workArea;
  const def = { x: wa.x + wa.width - MARGIN, y: wa.y + wa.height - MARGIN };
  if (settings.anchorX == null || settings.anchorY == null) return def;
  const pt = { x: settings.anchorX - 1, y: settings.anchorY - 1 };
  const d = screen.getDisplayNearestPoint(pt);
  const b = d.workArea;
  const inside = pt.x >= b.x && pt.x <= b.x + b.width && pt.y >= b.y && pt.y <= b.y + b.height;
  return inside ? { x: settings.anchorX, y: settings.anchorY } : def;
}

// Collapsed: the icon, plus the timer beside it and the tooltip above it when they are shown.
// Expanded: panel above the icon. Always grows up/left from the anchor.
function placeWindow() {
  if (!win || win.isDestroyed() || drag) return; // while dragged, the cursor decides where it is
  const a = anchor();
  const mini = uiSize.mini || { w: ICON, h: ICON };
  const width = (uiSize.expanded ? PANEL_W : Math.max(ICON, mini.w)) + 2 * PAD;
  const height = (uiSize.expanded ? uiSize.height + GAP + ICON : Math.max(ICON, mini.h)) + 2 * PAD;
  const wa = screen.getDisplayNearestPoint({ x: a.x - 1, y: a.y - 1 }).workArea;
  const x = Math.max(wa.x, Math.min(a.x + PAD - width, wa.x + wa.width - width));
  const y = Math.max(wa.y, Math.min(a.y + PAD - height, wa.y + wa.height - height));
  win.setBounds({ x, y, width, height });
}

// macOS: stay on every desktop (Space) and above full-screen apps, like the icon does on Windows.
function onAllSpaces(w) {
  if (IS_MAC) w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
}

function createWindow() {
  win = new BrowserWindow({
    width: ICON + 2 * PAD,
    height: ICON + 2 * PAD,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: APP_NAME,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Timers must keep their cadence while a heavy app is in front.
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  onAllSpaces(win);
  win.setContentProtection(true); // keeps the icon / panel out of the recording
  win.setMenuBarVisibility(false);
  placeWindow();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // Windows is shutting down: get the last seconds onto the disk right now.
  win.on('session-end', () => { if (rec) rec.flushSync(); });
  win.on('closed', () => { win = null; });
}

function pickSource() {
  return new Promise((resolve) => {
    if (picker && !picker.isDestroyed()) {
      picker.focus();
      return resolve(null);
    }
    const wa = screen.getPrimaryDisplay().workArea;
    const w = 780;
    const h = 540;
    picker = new BrowserWindow({
      width: w,
      height: h,
      x: Math.round(wa.x + (wa.width - w) / 2),
      y: Math.round(wa.y + (wa.height - h) / 2),
      parent: win,
      modal: !IS_MAC, // on macOS a modal child is a sheet hanging off the tiny icon window
      frame: false,
      resizable: false,
      backgroundColor: '#ffffff',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    picker.setContentProtection(true);
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      if (value) pendingSource = value;
      resolve(value);
      if (picker && !picker.isDestroyed()) picker.close();
    };
    picker.__done = done;
    picker.on('closed', () => { done(null); picker = null; });
    picker.loadFile(path.join(__dirname, '..', 'renderer', 'picker.html'));
  });
}

// Covers one display with a see-through window on which the user drags a rectangle.
// Resolves with the rectangle as fractions of the display ({x, y, w, h}, 0..1) or null.
function pickRegion(display) {
  return new Promise((resolve) => {
    region = new BrowserWindow({
      ...display.bounds,
      enableLargerThanScreen: true, // macOS: also cover the menu bar, so the fractions match the capture
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    region.setAlwaysOnTop(true, 'screen-saver');
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      if (region && !region.isDestroyed()) region.close();
    };
    region.__done = done;
    region.on('closed', () => { done(null); region = null; });
    region.loadFile(path.join(__dirname, '..', 'renderer', 'region.html'));
    region.once('ready-to-show', () => {
      region.show();
      region.focus();
    });
  });
}

// Border around the selected area, shown from the moment it is drawn until another source is
// chosen. Clicks go straight through it, and it is kept out of the recording.
function showFrame(display, crop) {
  if (frame && !frame.isDestroyed()) frame.destroy();
  frame = null;
  if (!crop) return;
  frame = new BrowserWindow({
    ...display.bounds,
    enableLargerThanScreen: true,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  frame.setAlwaysOnTop(true, 'screen-saver');
  onAllSpaces(frame);
  frame.setIgnoreMouseEvents(true);
  frame.setContentProtection(true);
  frame.loadFile(path.join(__dirname, '..', 'renderer', 'frame.html'), { hash: [crop.x, crop.y, crop.w, crop.h].join(',') });
  frame.webContents.once('did-finish-load', () => {
    if (!frame || frame.isDestroyed()) return;
    frame.webContents.send('frame:state', recState);
    frame.showInactive();
  });
  frame.on('closed', () => { frame = null; });
}

// ---------- tray ----------

function trayIcon() {
  const name = recState === 'recording' ? 'tray-rec.png' : recState === 'paused' ? 'tray-pause.png' : 'tray.png';
  // The macOS menu bar wants a 16 pt icon: the 32 px file is used as its @2x version.
  if (IS_MAC) return nativeImage.createFromBuffer(fs.readFileSync(asset(name)), { scaleFactor: 2 });
  return nativeImage.createFromPath(asset(name));
}

function buildTrayMenu() {
  if (!tray) return;
  const radio = (label, key, value) => ({
    label, type: 'radio', checked: settings[key] === value, click: () => saveSettings({ [key]: value }),
  });
  tray.setImage(trayIcon());
  tray.setToolTip(recState === 'idle' ? APP_NAME : `${APP_NAME} – ${recState}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: recState === 'idle' ? 'Start recording' : 'Stop recording', click: () => win && win.webContents.send('toggle-record') },
    { type: 'separator' },
    {
      label: 'Bootcamp preset (mic + system audio, 24 fps, 5 Mbps)',
      click: () => saveSettings({ micMuted: false, systemMuted: false, fps: 24, videoKbps: 5000, codec: 'vp8', audioFile: true }),
    },
    { label: 'Frame rate', submenu: [15, 24, 30].map((f) => radio(`${f} fps`, 'fps', f)) },
    {
      label: 'Video codec',
      submenu: [radio('VP8 (lightest CPU)', 'codec', 'vp8'), radio('H.264 (may use GPU)', 'codec', 'h264')],
    },
    {
      label: 'Also save separate audio file (audio.webm)', type: 'checkbox', checked: settings.audioFile,
      click: (item) => saveSettings({ audioFile: item.checked }),
    },
    {
      label: `Hide icon while recording (use ${IS_MAC ? 'menu bar icon' : 'tray'} or ${SHORTCUT})`, type: 'checkbox', checked: settings.hideWhileRecording,
      click: (item) => saveSettings({ hideWhileRecording: item.checked }),
    },
    {
      label: 'Mic noise suppression', type: 'checkbox', checked: settings.noiseSuppression,
      click: (item) => saveSettings({ noiseSuppression: item.checked }),
    },
    { type: 'separator' },
    { label: 'Open recordings folder', click: () => { fs.mkdirSync(baseDir(), { recursive: true }); shell.openPath(baseDir()); } },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

// ---------- recording IPC ----------

function stopTimers() {
  clearInterval(ckTimer);
  clearInterval(syncTimer);
  ckTimer = syncTimer = null;
}

ipcMain.handle('settings:get', (e) => (fromWin(e) ? settings : null));
ipcMain.handle('settings:set', (e, patch) => {
  if (!fromWin(e)) return;
  saveSettings(sanitizePatch(patch));
});

// Panel opened/closed or changed height: resize the window around the fixed corner anchor.
ipcMain.on('ui:size', (e, expanded, height) => {
  if (!fromWin(e)) return;
  uiSize = { ...uiSize, expanded: !!expanded, height: Math.max(100, Math.min(700, Math.round(Number(height) || 0))) };
  placeWindow();
});

// The collapsed content changed size (timer beside the icon, tooltip above it): make room for it.
ipcMain.on('ui:mini', (e, width, height) => {
  if (!fromWin(e)) return;
  const w = Math.max(ICON, Math.min(400, Math.round(Number(width) || 0)));
  const h = Math.max(ICON, Math.min(150, Math.round(Number(height) || 0)));
  uiSize = { ...uiSize, mini: { w, h } };
  placeWindow();
});

// Dragging the icon or the panel header. The window follows the real cursor from here, not
// mouse events relayed by the renderer: those arrive late and in bursts, which made the icon
// slide behind the pointer. The size is set on every step so display scaling cannot change it.
ipcMain.on('ui:drag', (e, phase) => {
  if (!fromWin(e)) return;
  if (phase === 'start' && !drag) {
    const from = win.getBounds();
    const grab = screen.getCursorScreenPoint();
    drag = setInterval(() => {
      if (!win || win.isDestroyed()) return;
      const at = screen.getCursorScreenPoint();
      win.setBounds({ x: from.x + at.x - grab.x, y: from.y + at.y - grab.y, width: from.width, height: from.height });
    }, DRAG_MS);
  } else if (phase === 'end' && drag) {
    clearInterval(drag);
    drag = null;
    const b = win.getBounds();
    saveSettings({ anchorX: b.x + b.width - PAD, anchorY: b.y + b.height - PAD });
  }
});

ipcMain.handle('pick-source', async (e) => {
  if (!fromWin(e)) return null;
  const res = await pickSource();
  if (res) showFrame(cropDisplay, res.crop); // a new choice replaces (or removes) the border
  return res;
});

// { sources, blocked }: `blocked` = macOS does not let the app see the screen yet. Without that
// permission (or until the app is restarted after it was given), getSources() throws.
ipcMain.handle('picker:list', async (e) => {
  if (!fromPicker(e)) return { sources: [], blocked: false };
  let sources = [];
  let failed = false;
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    });
  } catch {
    failed = true;
  }
  pickerDisplays = new Map(sources.map((s) => [s.id, s.display_id]));
  return {
    blocked: IS_MAC && (failed || systemPreferences.getMediaAccessStatus('screen') !== 'granted'),
    sources: sources
      .filter((s) => s.name && s.name !== APP_NAME)
      .map((s) => ({
        id: s.id,
        name: s.name,
        isScreen: s.id.startsWith('screen:'),
        thumb: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
      })),
  };
});
// `area`: the user wants to draw the part of that screen to record, instead of all of it.
ipcMain.on('picker:choose', async (e, src, area) => {
  if (!fromPicker(e) || !src || typeof src.id !== 'string') return;
  const chosen = { id: src.id, name: String(src.name || '') };
  if (!area || !src.id.startsWith('screen:')) return picker.__done(chosen);
  const displays = screen.getAllDisplays();
  const display = displays.find((d) => String(d.id) === pickerDisplays.get(src.id)) || screen.getPrimaryDisplay();
  picker.hide();
  const crop = await pickRegion(display);
  if (!picker || picker.isDestroyed()) return;
  if (!crop) return picker.show(); // cancelled: back to the list
  cropDisplay = display;
  picker.__done({ ...chosen, crop });
});
ipcMain.on('source:clear', (e) => {
  if (!fromWin(e)) return;
  pendingSource = null;
  showFrame(null, null);
});
ipcMain.on('picker:cancel', (e) => { if (fromPicker(e)) picker.__done(null); });
ipcMain.on('picker:screen-settings', (e) => { if (fromPicker(e) && IS_MAC) shell.openExternal(SCREEN_SETTINGS); });
// macOS applies a new Screen Recording permission only to a fresh start of the app.
ipcMain.on('picker:relaunch', (e) => {
  if (!fromPicker(e) || !IS_MAC || rec) return;
  app.relaunch();
  app.quit();
});

ipcMain.on('region:done', (e, r) => {
  if (!fromRegion(e)) return;
  const n = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  const x = n(r && r.x);
  const y = n(r && r.y);
  const w = Math.min(n(r && r.w), 1 - x);
  const h = Math.min(n(r && r.h), 1 - y);
  region.__done(w > 0.02 && h > 0.02 ? { x, y, w, h } : null);
});
ipcMain.on('region:cancel', (e) => { if (fromRegion(e)) region.__done(null); });

ipcMain.handle('rec:start', async (e, meta) => {
  if (!fromWin(e) || rec) return null;
  rec = new RecordingSession(baseDir(), { ...(meta || {}), audioFile: !!settings.audioFile });
  await rec.start();
  ckTimer = setInterval(() => rec && rec.checkpoint().catch(() => {}), CHECKPOINT_MS);
  syncTimer = setInterval(() => rec && rec.flush().catch(() => {}), SYNC_MS);
  return { dir: rec.dir };
});
ipcMain.on('rec:chunk', (e, buf) => {
  if (fromWin(e) && rec && buf) rec.append(Buffer.from(buf));
});
ipcMain.on('rec:audio-chunk', (e, buf) => {
  if (fromWin(e) && rec && buf) rec.appendAudio(Buffer.from(buf));
});
ipcMain.handle('rec:stop', async (e) => {
  if (!fromWin(e) || !rec) return null;
  stopTimers();
  const r = rec;
  rec = null;
  const file = await r.finish();
  return { file, error: r.error ? String(r.error.message || r.error) : null };
});
ipcMain.on('rec:state', (e, state) => {
  if (!fromWin(e)) return;
  recState = state;
  buildTrayMenu();
  if (frame && !frame.isDestroyed()) frame.webContents.send('frame:state', state);
  if (settings.hideWhileRecording) {
    if (state === 'recording') win.hide();
    else if (state === 'idle') win.show();
  }
});
ipcMain.on('open-file', (e, file) => {
  if (fromWin(e) && typeof file === 'string') shell.showItemInFolder(file);
});
// Computer sound is always taken from the system default output, so that is where it is changed.
ipcMain.on('open-sound-settings', (e) => { if (fromWin(e)) shell.openExternal(SOUND_SETTINGS); });
ipcMain.on('quit', (e) => { if (fromWin(e)) app.quit(); });

// ---------- recordings list ----------

ipcMain.handle('lib:list', (e) => {
  if (!fromWin(e)) return [];
  return listRecordings(baseDir(), rec && rec.dir).map((r) => ({ ...r, processing: !!job && job.id === r.id }));
});
ipcMain.on('lib:play', (e, id) => {
  const dir = fromWin(e) && recordingDir(baseDir(), id);
  if (dir) shell.openPath(playablePath(dir));
});
ipcMain.on('lib:folder', (e, id) => {
  const dir = fromWin(e) && recordingDir(baseDir(), id);
  if (dir) shell.showItemInFolder(playablePath(dir));
});
// Final processing: re-encode to a small MP4 next to the recording. One at a time.
ipcMain.handle('lib:process', async (e, id) => {
  const dir = fromWin(e) && recordingDir(baseDir(), id);
  if (!dir) return { error: 'Recording not found' };
  if (job) return { error: 'Another recording is being processed' };
  const item = listRecordings(baseDir()).find((r) => r.id === id);
  const run = processRecording(dir, item, (p) => {
    if (win && !win.isDestroyed()) win.webContents.send('lib:progress', id, p);
  });
  job = { id, run };
  try {
    return await run;
  } catch (err) {
    return { error: String(err.message || err) };
  } finally {
    job = null;
  }
});

// ---------- app lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) win.show(); });
  app.on('activate', () => { if (win) win.show(); }); // macOS: opened again from Finder / Launchpad

  app.whenReady().then(() => {
    loadSettings();
    if (IS_MAC) {
      app.dock.hide(); // like skipTaskbar on Windows: the icon and the menu bar item are the app
      if (systemPreferences.getMediaAccessStatus('microphone') === 'not-determined') {
        systemPreferences.askForMediaAccess('microphone').catch(() => {});
      }
    }

    // Only the main window may use the mic / screen; everything else is denied.
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      cb(!!win && wc === win.webContents && (permission === 'media' || permission === 'display-capture'));
    });

    // The renderer's getDisplayMedia() resolves to the source chosen in our picker.
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      let response = {}; // empty = deny
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
        const src = pendingSource && sources.find((s) => s.id === pendingSource.id);
        if (src) {
          response = { video: src };
          // System sound: Windows loopback; on macOS 14.2+ a CoreAudio tap (needs NSAudioCaptureUsageDescription).
          if (request.audioRequested) response.audio = 'loopback';
        }
      } catch { /* deny */ }
      try { callback(response); } catch { /* denied */ }
    }, { useSystemPicker: false });

    createWindow();
    tray = new Tray(trayIcon());
    tray.on('click', () => { if (win) win.show(); });
    buildTrayMenu();
    globalShortcut.register('CommandOrControl+Shift+R', () => win && win.webContents.send('toggle-record'));

    // Make sure the last seconds are on disk before sleep / shutdown.
    for (const ev of ['suspend', 'shutdown', 'lock-screen']) {
      powerMonitor.on(ev, () => { if (rec) rec.flush().catch(() => {}); });
    }
  });

  app.on('before-quit', () => { if (rec) rec.flushSync(); });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (job) job.run.cancel(); // do not leave ffmpeg running without us
  });
  app.on('window-all-closed', () => app.quit());
}
