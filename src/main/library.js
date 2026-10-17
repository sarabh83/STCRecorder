'use strict';
// The recordings on disk, and their final processing: one re-encode to a small MP4.
// Same recipe as the compress_video tool: x264 with CRF (bits only where the picture
// needs them) instead of a fixed bitrate, AAC sound, and the index moved to the front.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { FILE, JOURNAL } = require('./storage');

const MP4 = 'recording.mp4';
const PART = 'recording.part.mp4'; // written here first, so a half-made file is never mistaken for the result
const LOG = 'process.log';
const ID_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/; // folder names made by RecordingSession

// The ffmpeg shipped with the app (unpacked next to the asar when installed); else one on the PATH.
function ffmpegBin() {
  try {
    const bin = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(bin)) return bin;
  } catch { /* not bundled */ }
  return 'ffmpeg';
}

const sizeOf = (file) => {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
};

// Newest first. `skipDir` is the recording being written right now.
function listRecordings(baseDir, skipDir) {
  let names;
  try {
    names = fs.readdirSync(baseDir);
  } catch {
    return [];
  }
  const out = [];
  for (const id of names) {
    const dir = path.join(baseDir, id);
    if (!ID_RE.test(id) || dir === skipDir) continue;
    try {
      const journal = JSON.parse(fs.readFileSync(path.join(dir, JOURNAL), 'utf8'));
      const stat = fs.statSync(path.join(dir, FILE));
      if (!stat.size) continue;
      out.push({
        id,
        startedAt: journal.startedAt,
        // an interrupted recording has no end time; its last write is close enough
        durationMs: Math.max(0, (journal.endedAt || stat.mtimeMs) - journal.startedAt),
        size: stat.size,
        done: !!journal.done,
        fps: (journal.meta && journal.meta.fps) || 30,
        // set when the screen was switched mid-recording: the size of its first picture
        frameSize: (journal.meta && journal.meta.frameSize) || null,
        mp4Size: sizeOf(path.join(dir, MP4)),
      });
    } catch {
      /* not a recording folder */
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

// The folder of a recording, or null if the id is not one of ours.
function recordingDir(baseDir, id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  const dir = path.join(baseDir, id);
  return sizeOf(path.join(dir, FILE)) ? dir : null;
}

// What "play" opens: the processed MP4 when there is one, else the raw recording.
function playablePath(dir) {
  const mp4 = path.join(dir, MP4);
  return sizeOf(mp4) ? mp4 : path.join(dir, FILE);
}

// The size of a picture fitted into `size` ({width, height}): kept in proportion, black bars around.
const fitInto = ({ width: w, height: h }) => (
  `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`
);

// `frameSize`: only for a recording whose screen was switched, so its parts may differ in size.
function ffmpegArgs(src, dst, fps, frameSize) {
  return [
    '-y',
    // Screen recordings have variable frame timing that the mp4 muxer can choke on;
    // regenerate clean timestamps and write a constant frame rate.
    '-fflags', '+genpts',
    '-i', src,
    ...(frameSize ? ['-vf', fitInto(frameSize)] : []),
    '-c:v', 'libx264',
    '-crf', '20',
    '-preset', 'medium',
    '-pix_fmt', 'yuv420p', // plays everywhere
    '-fps_mode', 'cfr',
    '-r', String(fps), // the recording's own header has no usable frame rate
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    dst,
  ];
}

// Runs ffmpeg on one recording. Resolves with { mp4Size }, rejects with a short message.
// onProgress gets 0..1. The returned promise has .cancel().
function processRecording(dir, { durationMs, fps, frameSize }, onProgress) {
  const part = path.join(dir, PART);
  const args = ffmpegArgs(path.join(dir, FILE), part, fps, frameSize);
  const lines = [];
  let child = null;
  const promise = new Promise((resolve, reject) => {
    const fail = (message) => {
      fs.rmSync(part, { force: true });
      reject(new Error(message));
    };
    child = spawn(ffmpegBin(), args, { windowsHide: true });
    child.on('error', (err) => fail(err.code === 'ENOENT' ? 'ffmpeg is not installed' : String(err.message || err)));
    child.stdout.on('data', (buf) => {
      const m = /out_time_ms=(\d+)/.exec(String(buf)); // despite the name, microseconds
      if (m && durationMs > 0) onProgress(Math.min(0.99, Number(m[1]) / 1000 / durationMs));
    });
    child.stderr.on('data', (buf) => { lines.push(String(buf)); });
    child.on('close', (code) => {
      try {
        fs.writeFileSync(path.join(dir, LOG), `$ ffmpeg ${args.join(' ')}\n\n${lines.join('')}\nexit code: ${code}\n`);
      } catch { /* the log is only a convenience */ }
      if (code !== 0) return fail(code === null ? 'Processing was stopped' : `Processing failed (see ${LOG})`);
      try {
        fs.renameSync(part, path.join(dir, MP4));
      } catch (err) {
        return fail(String(err.message || err));
      }
      resolve({ mp4Size: sizeOf(path.join(dir, MP4)) });
    });
  });
  promise.cancel = () => { if (child) child.kill(); };
  return promise;
}

module.exports = { listRecordings, recordingDir, playablePath, ffmpegArgs, processRecording, MP4 };
