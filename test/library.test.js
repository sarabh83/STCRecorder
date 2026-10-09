'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listRecordings, recordingDir, playablePath, ffmpegArgs, MP4 } = require('../src/main/library');

function makeBase() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'starecorder-lib-'));
  const add = (id, journal, bytes = 10) => {
    const dir = path.join(base, id);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'journal.json'), JSON.stringify(journal));
    fs.writeFileSync(path.join(dir, 'recording.webm'), Buffer.alloc(bytes));
    return dir;
  };
  return { base, add };
}

test('recordings are listed newest first with length, size and MP4 state', () => {
  const { base, add } = makeBase();
  add('2026-01-01_10-00-00', { startedAt: 1000, endedAt: 61000, done: true, meta: { fps: 24 } });
  const newer = add('2026-01-02_10-00-00', { startedAt: 5000, done: false, meta: {} });
  fs.writeFileSync(path.join(newer, MP4), Buffer.alloc(4));
  add('2026-01-03_10-00-00', { startedAt: 9000, done: true }, 0); // empty file: not a recording
  fs.mkdirSync(path.join(base, 'something else'));

  const list = listRecordings(base);
  assert.deepStrictEqual(list.map((r) => r.id), ['2026-01-02_10-00-00', '2026-01-01_10-00-00']);
  assert.deepStrictEqual([list[0].done, list[0].mp4Size, list[0].fps], [false, 4, 30]);
  assert.deepStrictEqual([list[1].done, list[1].mp4Size, list[1].fps, list[1].durationMs], [true, 0, 24, 60000]);
  assert.strictEqual(listRecordings(base, newer).length, 1); // the one being written is skipped
  assert.deepStrictEqual(listRecordings(path.join(base, 'missing')), []);
});

test('only real recording folders are accepted, and play prefers the MP4', () => {
  const { base, add } = makeBase();
  const dir = add('2026-01-01_10-00-00', { startedAt: 1, done: true });
  assert.strictEqual(recordingDir(base, '2026-01-01_10-00-00'), dir);
  for (const bad of ['..', '2026-01-01_10-00-00/..', '2026-01-09_10-00-00', 5, null]) {
    assert.strictEqual(recordingDir(base, bad), null);
  }
  assert.strictEqual(path.basename(playablePath(dir)), 'recording.webm');
  fs.writeFileSync(path.join(dir, MP4), Buffer.alloc(4));
  assert.strictEqual(path.basename(playablePath(dir)), MP4);
});

test('processing uses the CRF recipe and a constant frame rate', () => {
  const args = ffmpegArgs('in.webm', 'out.mp4', 24);
  const opt = (name) => args[args.indexOf(name) + 1];
  assert.deepStrictEqual(
    [opt('-c:v'), opt('-crf'), opt('-preset'), opt('-pix_fmt'), opt('-fps_mode'), opt('-r'), opt('-c:a'), opt('-movflags')],
    ['libx264', '20', 'medium', 'yuv420p', 'cfr', '24', 'aac', '+faststart'],
  );
  assert.strictEqual(opt('-i'), 'in.webm');
  assert.strictEqual(args[args.length - 1], 'out.mp4');
});
