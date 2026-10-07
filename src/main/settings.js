'use strict';
// Settings defaults, migration from older versions, and validation of
// patches that come from the renderer.

const MODES = ['mic', 'system', 'both']; // what to record: only me / only computer / both

const DEFAULTS = {
  fps: 30,
  codec: 'vp8',
  videoKbps: 2500,
  noiseSuppression: false,
  audioFile: true, // also save audio.webm next to the video
  audioMode: 'mic',
  micDeviceId: '', // '' = system default microphone
  micLabel: '',
  hideWhileRecording: false,
  silenceThresholdDb: -50,
  anchorX: null, // bottom-right corner of the icon / panel window
  anchorY: null,
};

// Older versions stored two booleans (mic, system).
function migrate(raw) {
  const s = { ...DEFAULTS, ...(raw || {}) };
  if (!MODES.includes(raw && raw.audioMode)) {
    const mic = raw && typeof raw.mic === 'boolean' ? raw.mic : true;
    const system = !!(raw && raw.system);
    s.audioMode = mic && system ? 'both' : system ? 'system' : 'mic';
  }
  delete s.mic;
  delete s.system;
  delete s.barX;
  delete s.barY;
  return s;
}

// Only these keys may be changed by the renderer.
function sanitizePatch(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  if (MODES.includes(patch.audioMode)) out.audioMode = patch.audioMode;
  for (const k of ['micDeviceId', 'micLabel']) {
    if (typeof patch[k] === 'string') out[k] = patch[k].slice(0, 300);
  }
  return out;
}

module.exports = { DEFAULTS, MODES, migrate, sanitizePatch };
