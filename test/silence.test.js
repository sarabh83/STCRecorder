'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { SilenceDetector } = require('../src/renderer/silence');

const QUIET = -80;
const LOUD = -20;

test('no warning before 30 s of silence', () => {
  const d = new SilenceDetector({ thresholdDb: -50, timeoutMs: 30000 });
  assert.strictEqual(d.update(QUIET, 29999).warning, false);
});

test('warns and notifies once at 30 s, then again after another 30 s', () => {
  const d = new SilenceDetector({ thresholdDb: -50, timeoutMs: 30000 });
  const first = d.update(QUIET, 30000);
  assert.deepStrictEqual([first.warning, first.notify], [true, true]);
  const mid = d.update(QUIET, 45000);
  assert.deepStrictEqual([mid.warning, mid.notify], [true, false]);
  const second = d.update(QUIET, 60000);
  assert.deepStrictEqual([second.warning, second.notify], [true, true]);
});

test('sound clears the warning and restarts the 30 s window', () => {
  const d = new SilenceDetector({ thresholdDb: -50, timeoutMs: 30000 });
  d.update(QUIET, 31000);
  const back = d.update(LOUD, 32000);
  assert.deepStrictEqual([back.warning, back.cleared], [false, true]);
  assert.strictEqual(d.update(QUIET, 61999).warning, false);
  assert.strictEqual(d.update(QUIET, 62000).warning, true);
});

test('paused detector never warns and resume restarts the window', () => {
  const d = new SilenceDetector({ thresholdDb: -50, timeoutMs: 30000 });
  d.pause();
  assert.strictEqual(d.update(QUIET, 100000).warning, false);
  d.resume(100000);
  assert.strictEqual(d.update(QUIET, 129999).warning, false);
  assert.strictEqual(d.update(QUIET, 130000).warning, true);
});
