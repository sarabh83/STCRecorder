'use strict';
// Append-only recording writer with a checkpoint journal.
// Every chunk goes straight to disk; a checkpoint ({time, byte offset}) is
// recorded every few minutes so older "versions" can be cut from the same file
// without ever copying it.

const fs = require('fs');
const path = require('path');

const JOURNAL = 'journal.json';
const FILE = 'recording.webm';
const AUDIO_FILE = 'audio.webm';

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

class RecordingSession {
  constructor(baseDir, meta = {}) {
    this.dir = path.join(baseDir, stamp(new Date()));
    this.file = path.join(this.dir, FILE);
    this.journalFile = path.join(this.dir, JOURNAL);
    this.journal = { startedAt: Date.now(), done: false, checkpoints: [], meta };
    this.bytes = 0;
    this.error = null;
    this.chain = Promise.resolve();
    this.fh = null;
    this.audioFile = path.join(this.dir, AUDIO_FILE);
    this.audioFh = null;
    this.audioBytes = 0;
    this.audioChain = Promise.resolve();
  }

  async start() {
    await fs.promises.mkdir(this.dir, { recursive: true });
    this.fh = await fs.promises.open(this.file, 'w');
    if (this.journal.meta.audioFile) this.audioFh = await fs.promises.open(this.audioFile, 'w');
    writeJsonAtomic(this.journalFile, this.journal);
  }

  // Writes are serialised so chunk order is always preserved.
  append(buf) {
    this.chain = this.chain
      .then(async () => {
        await this.fh.write(buf, 0, buf.length, null);
        this.bytes += buf.length;
      })
      .catch((err) => {
        this.error = err;
      });
  }

  // Separate audio-only file (same sound as the video, kept as an independent backup).
  appendAudio(buf) {
    if (!this.audioFh) return;
    this.audioChain = this.audioChain
      .then(async () => {
        await this.audioFh.write(buf, 0, buf.length, null);
        this.audioBytes += buf.length;
      })
      .catch((err) => {
        this.error = err;
      });
  }

  // Waits for pending writes and forces them to the physical disk.
  async flush() {
    await this.chain;
    await this.audioChain;
    if (this.fh) await this.fh.sync();
    if (this.audioFh) await this.audioFh.sync();
  }

  // Synchronous best-effort flush for the moment Windows is shutting down.
  flushSync() {
    for (const h of [this.fh, this.audioFh]) {
      if (!h) continue;
      try {
        fs.fsyncSync(h.fd);
      } catch { /* nothing more we can do */ }
    }
  }

  async closeFiles() {
    if (this.fh) await this.fh.close();
    if (this.audioFh) await this.audioFh.close();
    this.fh = null;
    this.audioFh = null;
  }

  async checkpoint() {
    await this.flush();
    this.journal.checkpoints.push({ t: Date.now(), bytes: this.bytes, audioBytes: this.audioBytes });
    writeJsonAtomic(this.journalFile, this.journal);
    return this.journal.checkpoints[this.journal.checkpoints.length - 1];
  }

  // Closes the file without marking it done (used to simulate a crash in tests).
  async abandon() {
    await this.flush();
    await this.closeFiles();
  }

  async finish() {
    await this.flush();
    await this.closeFiles();
    this.journal.done = true;
    this.journal.endedAt = Date.now();
    this.journal.bytes = this.bytes;
    writeJsonAtomic(this.journalFile, this.journal);
    return this.file;
  }
}

// Newest recording that never got its "done" marker (crash, power loss, ...).
function findIncomplete(baseDir) {
  let names;
  try {
    names = fs.readdirSync(baseDir);
  } catch {
    return null;
  }
  const found = [];
  for (const name of names) {
    const dir = path.join(baseDir, name);
    try {
      const journal = JSON.parse(fs.readFileSync(path.join(dir, JOURNAL), 'utf8'));
      const file = path.join(dir, FILE);
      const size = fs.statSync(file).size;
      if (!journal.done && size > 0) found.push({ dir, file, size, journal });
    } catch {
      /* not a recording folder */
    }
  }
  found.sort((a, b) => b.journal.startedAt - a.journal.startedAt);
  return found[0] || null;
}

function markDone(dir) {
  const jf = path.join(dir, JOURNAL);
  const journal = JSON.parse(fs.readFileSync(jf, 'utf8'));
  journal.done = true;
  writeJsonAtomic(jf, journal);
}

// Copies the first `bytes` bytes of the recording into a new playable file.
function exportVersion(dir, bytes, outName, srcName = FILE) {
  const out = path.join(dir, outName);
  return new Promise((resolve, reject) => {
    if (bytes <= 0) return reject(new Error('empty version'));
    const rs = fs.createReadStream(path.join(dir, srcName), { start: 0, end: bytes - 1 });
    const ws = fs.createWriteStream(out);
    rs.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', () => resolve(out));
    rs.pipe(ws);
  });
}

module.exports = { RecordingSession, findIncomplete, markDone, exportVersion, FILE, AUDIO_FILE, JOURNAL };
