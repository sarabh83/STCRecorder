'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RecordingSession, findIncomplete, markDone, exportVersion } = require('../src/main/storage');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rec-test-'));

test('chunks are appended in order and finish() marks the recording done', async () => {
  const base = tmp();
  const s = new RecordingSession(base);
  await s.start();
  s.append(Buffer.from('aaa'));
  s.append(Buffer.from('bbb'));
  await s.finish();
  assert.strictEqual(fs.readFileSync(s.file, 'utf8'), 'aaabbb');
  assert.strictEqual(findIncomplete(base), null);
});

test('an interrupted recording is found and keeps its checkpoints', async () => {
  const base = tmp();
  const s = new RecordingSession(base);
  await s.start();
  s.append(Buffer.from('12345'));
  await s.checkpoint();
  s.append(Buffer.from('6789'));
  await s.abandon(); // simulate a crash: no finish()
  const inc = findIncomplete(base);
  assert.ok(inc);
  assert.strictEqual(inc.size, 9);
  assert.deepStrictEqual(inc.journal.checkpoints.map((c) => c.bytes), [5]);
});

test('exportVersion cuts the file at a checkpoint without touching the original', async () => {
  const base = tmp();
  const s = new RecordingSession(base);
  await s.start();
  s.append(Buffer.from('12345'));
  const cp = await s.checkpoint();
  s.append(Buffer.from('6789'));
  await s.abandon();
  const out = await exportVersion(s.dir, cp.bytes, 'v1.webm');
  assert.strictEqual(fs.readFileSync(out, 'utf8'), '12345');
  assert.strictEqual(fs.readFileSync(s.file, 'utf8'), '123456789');
  markDone(s.dir);
  assert.strictEqual(findIncomplete(base), null);
});

test('separate audio file is written and finished alongside the video', async () => {
  const base = tmp();
  const s = new RecordingSession(base, { audioFile: true });
  await s.start();
  s.append(Buffer.from('video'));
  s.appendAudio(Buffer.from('aud'));
  const cp = await s.checkpoint();
  s.appendAudio(Buffer.from('io'));
  await s.finish();
  assert.strictEqual(fs.readFileSync(s.file, 'utf8'), 'video');
  assert.strictEqual(fs.readFileSync(s.audioFile, 'utf8'), 'audio');
  assert.strictEqual(cp.audioBytes, 3);
});

test('no audio file is created unless requested', async () => {
  const base = tmp();
  const s = new RecordingSession(base);
  await s.start();
  s.appendAudio(Buffer.from('x'));
  await s.finish();
  assert.strictEqual(fs.existsSync(s.audioFile), false);
});

test('flushSync does not throw while open or after close', async () => {
  const base = tmp();
  const s = new RecordingSession(base, { audioFile: true });
  await s.start();
  s.append(Buffer.from('x'));
  await s.flush();
  s.flushSync();
  await s.finish();
  s.flushSync();
});
