'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { DEFAULTS, migrate, sanitizePatch } = require('../src/main/settings');

const mutes = (raw) => {
  const s = migrate(raw);
  return [s.micMuted, s.systemMuted];
};

test('old audio modes and mic/system booleans map to the two mute switches', () => {
  assert.deepStrictEqual(mutes({ audioMode: 'both' }), [false, false]);
  assert.deepStrictEqual(mutes({ audioMode: 'system' }), [true, false]);
  assert.deepStrictEqual(mutes({ audioMode: 'mic' }), [false, true]);
  assert.deepStrictEqual(mutes({ mic: true, system: true }), [false, false]);
  assert.deepStrictEqual(mutes({ mic: false, system: true }), [true, false]);
  assert.deepStrictEqual(mutes({}), [false, true]);
  assert.deepStrictEqual(mutes(null), [DEFAULTS.micMuted, DEFAULTS.systemMuted]);
});

test('existing mute switches are kept and old keys are dropped', () => {
  const s = migrate({ micMuted: true, systemMuted: false, audioMode: 'mic', mic: true, system: false, barX: 5 });
  assert.deepStrictEqual([s.micMuted, s.systemMuted], [true, false]);
  for (const k of ['audioMode', 'mic', 'system', 'barX', 'barY']) assert.ok(!(k in s));
});

test('bitrates too low for 1080p are raised, good ones are kept', () => {
  assert.strictEqual(migrate({ videoKbps: 2500 }).videoKbps, DEFAULTS.videoKbps);
  assert.strictEqual(migrate({ videoKbps: 16000 }).videoKbps, 16000);
});

test('renderer patches are restricted to known keys and values', () => {
  assert.deepStrictEqual(sanitizePatch({ micMuted: true, fps: 1, evil: true }), { micMuted: true });
  assert.deepStrictEqual(sanitizePatch({ systemMuted: 'yes' }), {});
  assert.deepStrictEqual(sanitizePatch({ maxHeight: 1440, videoKbps: 16000, audioKbps: 192 }), { maxHeight: 1440, videoKbps: 16000, audioKbps: 192 });
  assert.deepStrictEqual(sanitizePatch({ maxHeight: 999, videoKbps: 10, audioKbps: 1 }), {});
  assert.deepStrictEqual(sanitizePatch({ micDeviceId: 'abc', micLabel: 'x'.repeat(500) }).micLabel.length, 300);
  assert.deepStrictEqual(sanitizePatch(null), {});
});
