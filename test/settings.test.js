'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { migrate, sanitizePatch } = require('../src/main/settings');

test('old mic/system booleans map to an audio mode', () => {
  assert.strictEqual(migrate({ mic: true, system: true }).audioMode, 'both');
  assert.strictEqual(migrate({ mic: false, system: true }).audioMode, 'system');
  assert.strictEqual(migrate({ mic: true, system: false }).audioMode, 'mic');
  assert.strictEqual(migrate({}).audioMode, 'mic');
  assert.strictEqual(migrate(null).audioMode, 'mic');
});

test('an existing valid audioMode is kept and old keys are dropped', () => {
  const s = migrate({ audioMode: 'system', mic: true, system: false, barX: 5 });
  assert.strictEqual(s.audioMode, 'system');
  for (const k of ['mic', 'system', 'barX', 'barY']) assert.ok(!(k in s));
});

test('renderer patches are restricted to known keys and values', () => {
  assert.deepStrictEqual(sanitizePatch({ audioMode: 'both', fps: 1, evil: true }), { audioMode: 'both' });
  assert.deepStrictEqual(sanitizePatch({ audioMode: 'nope' }), {});
  assert.deepStrictEqual(sanitizePatch({ micDeviceId: 'abc', micLabel: 'x'.repeat(500) }).micLabel.length, 300);
  assert.deepStrictEqual(sanitizePatch(null), {});
});
