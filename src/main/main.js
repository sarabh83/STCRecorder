'use strict';
const {
  app, BrowserWindow, ipcMain, session, desktopCapturer, screen, Tray, Menu,
  nativeImage, Notification, globalShortcut, dialog, shell, powerMonitor,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { RecordingSession, findIncomplete, markDone, exportVersion } = require('./storage');

const CHECKPOINT_MS = Number(process.env.RECORDER_CHECKPOINT_MS) || 3 * 60 * 1000; // a restorable version every 3 minutes
const SYNC_MS = 10 * 1000; // force data to disk every 10 s

const DEFAULTS = {
  fps: 30,
  codec: 'vp8',
  videoKbps: 2500,
  noiseSuppression: false,
  mic: true,
  system: false,
  silenceThresholdDb: -50,
  barX: null,
  barY: null,
};

let settings = { ...DEFAULTS };
let bar = null;
let tray = null;
let picker = null;
let pendingSource = null; // {id, name} chosen in the picker
let rec = null;
let ckTimer = null;
let syncTimer = null;
let recState = 'idle';

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const baseDir = () => path.join(app.getPath('videos'), 'Recorder');

function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    settings = { ...DEFAULTS };
  }
}

function saveSettings(patch) {
  settings = { ...settings, ...patch };
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings));
  } catch { /* non-fatal */ }
  if (bar && !bar.isDestroyed()) bar.webContents.send('settings-changed', settings);
  buildTrayMenu();
}

const fromBar = (e) => bar && !bar.isDestroyed() && e.sender === bar.webContents;
const fromPicker = (e) => picker && !picker.isDestroyed() && e.sender === picker.webContents;

// ---------- windows ----------

function createBar() {
  const wa = screen.getPrimaryDisplay().workArea;
  const w = 760;
  const h = 52;
  bar = new BrowserWindow({
    width: w,
    height: h,
    x: settings.barX ?? Math.round(wa.x + (wa.width - w) / 2),
    y: settings.barY ?? wa.y + wa.height - h - 12,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#1b1b1f',
    title: 'Recorder',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Timers must keep their cadence while a heavy app is in front.
      backgroundThrottling: false,
    },
  });
  bar.setAlwaysOnTop(true, 'screen-saver');
  bar.setContentProtection(true); // keeps the bar out of the recording
  bar.setMenuBarVisibility(false);
  bar.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  bar.once('ready-to-show', () => bar.show());
  bar.on('moved', () => {
    const [x, y] = bar.getPosition();
    saveSettings({ barX: x, barY: y });
  });
  bar.on('closed', () => { bar = null; });
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
      parent: bar,
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

function trayIcon(color) {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = (x - c) ** 2 + (y - c) ** 2 <= 6.5 ** 2;
      const i = (y * size + x) * 4; // BGRA
      buf[i] = color[2];
      buf[i + 1] = color[1];
      buf[i + 2] = color[0];
      buf[i + 3] = inside ? 255 : 0;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function buildTrayMenu() {
  if (!tray) return;
  const radio = (label, key, value) => ({
    label, type: 'radio', checked: settings[key] === value, click: () => saveSettings({ [key]: value }),
  });
  tray.setImage(trayIcon(recState === 'recording' ? [230, 50, 50] : recState === 'paused' ? [240, 170, 30] : [150, 150, 160]));
  tray.setToolTip(recState === 'idle' ? 'Recorder' : `Recorder – ${recState}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: recState === 'idle' ? 'Start recording' : 'Stop recording', click: () => bar && bar.webContents.send('toggle-record') },
    { type: 'separator' },
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

ipcMain.handle('settings:get', (e) => (fromBar(e) ? settings : null));
ipcMain.handle('settings:set', (e, patch) => {
  if (!fromBar(e) || !patch) return;
  const allowed = {};
  for (const k of ['mic', 'system']) if (typeof patch[k] === 'boolean') allowed[k] = patch[k];
  saveSettings(allowed);
});

ipcMain.handle('pick-source', async (e) => (fromBar(e) ? pickSource() : null));

ipcMain.handle('picker:list', async (e) => {
  if (!fromPicker(e)) return [];
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false,
  });
  return sources
    .filter((s) => s.name && s.name !== 'Recorder')
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
  if (!fromBar(e) || rec) return null;
  rec = new RecordingSession(baseDir(), meta || {});
  await rec.start();
  ckTimer = setInterval(() => rec && rec.checkpoint().catch(() => {}), CHECKPOINT_MS);
  syncTimer = setInterval(() => rec && rec.flush().catch(() => {}), SYNC_MS);
  return { dir: rec.dir };
});
ipcMain.on('rec:chunk', (e, buf) => {
  if (fromBar(e) && rec && buf) rec.append(Buffer.from(buf));
});
ipcMain.handle('rec:stop', async (e) => {
  if (!fromBar(e) || !rec) return null;
  stopTimers();
  const r = rec;
  rec = null;
  const file = await r.finish();
  return { file, error: r.error ? String(r.error.message || r.error) : null };
});
ipcMain.on('rec:state', (e, state) => {
  if (!fromBar(e)) return;
  recState = state;
  buildTrayMenu();
});
ipcMain.on('notify', (e, title, body) => {
  if (fromBar(e) && Notification.isSupported()) new Notification({ title: String(title), body: String(body) }).show();
});
ipcMain.on('open-file', (e, file) => {
  if (fromBar(e) && typeof file === 'string') shell.showItemInFolder(file);
});
ipcMain.on('quit', (e) => { if (fromBar(e)) app.quit(); });

// ---------- recovery ----------

const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)} min ${s % 60} s`;
};

ipcMain.handle('recover:check', (e) => {
  if (!fromBar(e) || rec) return null;
  const inc = findIncomplete(baseDir());
  return inc ? { size: inc.size, when: inc.journal.startedAt } : null;
});

ipcMain.handle('recover:run', async (e) => {
  if (!fromBar(e) || rec) return false;
  const inc = findIncomplete(baseDir());
  if (!inc) return false;
  const cps = inc.journal.checkpoints.slice(-3);
  const buttons = [
    'Keep full recording',
    ...cps.map((c) => `Also save version at ~${mmss(c.t - inc.journal.startedAt)}`),
    'Cancel',
  ];
  const { response } = await dialog.showMessageBox(bar, {
    type: 'question',
    title: 'Recorder',
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
    await exportVersion(inc.dir, c.bytes, `version-${Math.round((c.t - inc.journal.startedAt) / 1000)}s.webm`);
  }
  markDone(inc.dir);
  shell.showItemInFolder(inc.file);
  return true;
});

// ---------- app lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (bar) bar.show(); });

  app.whenReady().then(() => {
    loadSettings();

    // Only the bar may use the mic / screen; everything else is denied.
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      cb(bar && wc === bar.webContents && (permission === 'media' || permission === 'display-capture'));
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

    createBar();
    tray = new Tray(trayIcon([150, 150, 160]));
    buildTrayMenu();
    globalShortcut.register('CommandOrControl+Shift+R', () => bar && bar.webContents.send('toggle-record'));

    // Make sure the last seconds are on disk before sleep / shutdown.
    for (const ev of ['suspend', 'shutdown', 'lock-screen']) {
      powerMonitor.on(ev, () => { if (rec) rec.flush().catch(() => {}); });
    }
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
