'use strict';
// Settings defaults, migration from older versions, and validation of
// patches that come from the renderer.

const MODES = ['mic', 'system', 'both']; // older versions: only me / only computer / both
const MIN_KBPS = 5000; // below this a 1080p screen looks blurry
const HEIGHTS = [720, 1080, 1440, 2160];
const AUDIO_KBPS = [64, 128, 192, 256];

const DEFAULTS = {
  fps: 30,
  codec: 'vp8',
  videoKbps: 8000,
  maxHeight: 1080, // the picture is never scaled up, only capped at this height
  audioKbps: 128,
  noiseSuppression: false,
  audioFile: true, // also save audio.webm next to the video
  micMuted: false, // both sounds are always captured; these only silence them
  systemMuted: false,
  micDeviceId: '', // '' = system default microphone
  micLabel: '',
  hideWhileRecording: false,
  silenceThresholdDb: -50,
  anchorX: null, // bottom-right corner of the icon / panel window
  anchorY: null,
};

// Older versions stored an audio mode, and before that two booleans (mic, system).
function migrate(raw) {
  const s = { ...DEFAULTS, ...(raw || {}) };
  if (raw && typeof raw.micMuted !== 'boolean') {
    if (MODES.includes(raw.audioMode)) {
      s.micMuted = raw.audioMode === 'system';
      s.systemMuted = raw.audioMode === 'mic';
    } else {
      s.micMuted = raw.mic === false;
      s.systemMuted = !raw.system;
    }
  }
  if (!(s.videoKbps >= MIN_KBPS)) s.videoKbps = DEFAULTS.videoKbps;
  for (const k of ['audioMode', 'mic', 'system', 'barX', 'barY']) delete s[k];
  return s;
}

// Only these keys may be changed by the renderer.
function sanitizePatch(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  for (const k of ['micMuted', 'systemMuted']) {
    if (typeof patch[k] === 'boolean') out[k] = patch[k];
  }
  for (const k of ['micDeviceId', 'micLabel']) {
    if (typeof patch[k] === 'string') out[k] = patch[k].slice(0, 300);
  }
  // quality chosen in the panel
  if (HEIGHTS.includes(patch.maxHeight)) out.maxHeight = patch.maxHeight;
  if (Number.isInteger(patch.videoKbps) && patch.videoKbps >= MIN_KBPS && patch.videoKbps <= 50000) out.videoKbps = patch.videoKbps;
  if (AUDIO_KBPS.includes(patch.audioKbps)) out.audioKbps = patch.audioKbps;
  return out;
}

module.exports = { DEFAULTS, migrate, sanitizePatch };
