'use strict';
const {
  app, BrowserWindow, ipcMain, session, desktopCapturer, screen, Tray, Menu,
  nativeImage, Notification, globalShortcut, dialog, shell, powerMonitor,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { RecordingSession, findIncomplete, markDone, exportVersion } = require('./storage');

const { DEFAULTS, migrate, sanitizePatch } = require('./settings');

const CHECKPOINT_MS = Number(process.env.RECORDER_CHECKPOINT_MS) || 3 * 60 * 1000; // a restorable version every 3 minutes
const SYNC_MS = 5 * 1000; // force data to disk every 5 s
const ICON = 44; // collapsed icon size (px)
const PANEL_W = 320;
const GAP = 8;
const MARGIN = 16;

let settings = { ...DEFAULTS };
let win = null; // the one small window: corner icon + slide-out panel
let tray = null;
let picker = null;
let pendingSource = null; // {id, name} chosen in the picker
let rec = null;
let ckTimer = null;
let syncTimer = null;
let recState = 'idle';
let uiSize = { expanded: false, height: 0 };
let drag = null;

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const baseDir = () => path.join(app.getPath('videos'), 'Starecorder');
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

// ---------- windows ----------

// Bottom-right corner of the window, kept inside a visible display.
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

// Collapsed: just the icon. Expanded: panel above the icon. Always grows up/left from the anchor.
function placeWindow() {
  if (!win || win.isDestroyed()) return;
  const a = anchor();
  const width = uiSize.expanded ? PANEL_W : ICON;
  const height = uiSize.expanded ? uiSize.height + GAP + ICON : ICON;
  const wa = screen.getDisplayNearestPoint({ x: a.x - 1, y: a.y - 1 }).workArea;
  const x = Math.max(wa.x, Math.min(a.x - width, wa.x + wa.width - width));
  const y = Math.max(wa.y, Math.min(a.y - height, wa.y + wa.height - height));
  win.setBounds({ x, y, width, height });
}

function createWindow() {
  win = new BrowserWindow({
    width: ICON,
    height: ICON,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: 'Starecorder',
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
      modal: true,
      frame: false,
      resizable: false,
      backgroundColor: '#1b1b1f',
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

// ---------- tray ----------

function trayIcon() {
  const name = recState === 'recording' ? 'tray-rec.png' : recState === 'paused' ? 'tray-pause.png' : 'tray.png';
  return nativeImage.createFromPath(asset(name));
}

function buildTrayMenu() {
  if (!tray) return;
  const radio = (label, key, value) => ({
    label, type: 'radio', checked: settings[key] === value, click: () => saveSettings({ [key]: value }),
  });
  tray.setImage(trayIcon());
  tray.setToolTip(recState === 'idle' ? 'Starecorder' : `Starecorder – ${recState}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: recState === 'idle' ? 'Start recording' : 'Stop recording', click: () => win && win.webContents.send('toggle-record') },
    { type: 'separator' },
    {
      label: 'Bootcamp preset (mic + system audio, 24 fps, 5 Mbps)',
      click: () => saveSettings({ audioMode: 'both', fps: 24, videoKbps: 5000, codec: 'vp8', audioFile: true }),
    },
    { label: 'Frame rate', submenu: [15, 24, 30].map((f) => radio(`${f} fps`, 'fps', f)) },
    {
      label: 'Video quality',
      submenu: [
        radio('Low (1.5 Mbps)', 'videoKbps', 1500),
        radio('Normal (2.5 Mbps)', 'videoKbps', 2500),
        radio('High (5 Mbps)', 'videoKbps', 5000),
      ],
    },
    {
      label: 'Video codec',
      submenu: [radio('VP8 (lightest CPU)', 'codec', 'vp8'), radio('H.264 (may use GPU)', 'codec', 'h264')],
    },
    {
      label: 'Also save separate audio file (audio.webm)', type: 'checkbox', checked: settings.audioFile,
      click: (item) => saveSettings({ audioFile: item.checked }),
    },
    {
      label: 'Hide icon while recording (use tray or Ctrl+Shift+R)', type: 'checkbox', checked: settings.hideWhileRecording,
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
  uiSize = { expanded: !!expanded, height: Math.max(100, Math.min(700, Math.round(Number(height) || 0))) };
  placeWindow();
});

// Dragging the icon or the panel header (renderer sends screen-pixel deltas).
ipcMain.on('ui:drag', (e, phase, dx, dy) => {
  if (!fromWin(e)) return;
  if (phase === 'start') drag = win.getBounds();
  else if (phase === 'move' && drag) win.setPosition(drag.x + Math.round(dx), drag.y + Math.round(dy));
  else if (phase === 'end' && drag) {
    const b = win.getBounds();
    drag = null;
    saveSettings({ anchorX: b.x + b.width, anchorY: b.y + b.height });
  }
});

ipcMain.handle('pick-source', async (e) => (fromWin(e) ? pickSource() : null));

ipcMain.handle('picker:list', async (e) => {
  if (!fromPicker(e)) return [];
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false,
  });
  return sources
    .filter((s) => s.name && s.name !== 'Starecorder')
    .map((s) => ({
      id: s.id,
      name: s.name,
      isScreen: s.id.startsWith('screen:'),
      thumb: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
    }));
});
ipcMain.on('picker:choose', (e, src) => {
  if (fromPicker(e) && src && typeof src.id === 'string') picker.__done({ id: src.id, name: String(src.name || '') });
});
ipcMain.on('picker:cancel', (e) => { if (fromPicker(e)) picker.__done(null); });

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
  if (settings.hideWhileRecording) {
    if (state === 'recording') win.hide();
    else if (state === 'idle') win.show();
  }
});
ipcMain.on('notify', (e, title, body) => {
  if (fromWin(e) && Notification.isSupported()) new Notification({ title: String(title), body: String(body) }).show();
});
ipcMain.on('open-file', (e, file) => {
  if (fromWin(e) && typeof file === 'string') shell.showItemInFolder(file);
});
ipcMain.on('quit', (e) => { if (fromWin(e)) app.quit(); });

// ---------- recovery ----------

const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)} min ${s % 60} s`;
};

ipcMain.handle('recover:check', (e) => {
  if (!fromWin(e) || rec) return null;
  const inc = findIncomplete(baseDir());
  return inc ? { size: inc.size, when: inc.journal.startedAt } : null;
});

ipcMain.handle('recover:run', async (e) => {
  if (!fromWin(e) || rec) return false;
  const inc = findIncomplete(baseDir());
  if (!inc) return false;
  const cps = inc.journal.checkpoints.slice(-3);
  const buttons = [
    'Keep full recording',
    ...cps.map((c) => `Also save version at ~${mmss(c.t - inc.journal.startedAt)}`),
    'Cancel',
  ];
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Starecorder',
    message: 'A recording was interrupted.',
    detail: `The full file (${(inc.size / 1048576).toFixed(1)} MB) is still on disk and playable. You can also save an older version cut at a 3-minute checkpoint.`,
    buttons,
    cancelId: buttons.length - 1,
    defaultId: 0,
    noLink: true,
  });
  if (response === buttons.length - 1) return false;
  if (response > 0) {
    const c = cps[response - 1];
    const tag = Math.round((c.t - inc.journal.startedAt) / 1000);
    await exportVersion(inc.dir, c.bytes, `version-${tag}s.webm`);
    if (c.audioBytes > 0) await exportVersion(inc.dir, c.audioBytes, `version-${tag}s-audio.webm`, 'audio.webm');
  }
  markDone(inc.dir);
  shell.showItemInFolder(inc.file);
  return true;
});

// ---------- app lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) win.show(); });

  app.whenReady().then(() => {
    loadSettings();

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
          if (request.audioRequested) response.audio = 'loopback'; // Windows system audio
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
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
