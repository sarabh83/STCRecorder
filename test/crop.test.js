'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cropPx, retimer } = require('../src/renderer/crop');

test('a selected area becomes even pixels inside the frame', () => {
  assert.deepStrictEqual(cropPx(1920, 1080, { x: 0.25, y: 0.5, w: 0.5, h: 0.25 }), { x: 480, y: 540, width: 960, height: 270 });
  assert.deepStrictEqual(cropPx(1920, 1080, { x: 0, y: 0, w: 1, h: 1 }), { x: 0, y: 0, width: 1920, height: 1080 });
  // odd results are rounded down to even numbers
  assert.deepStrictEqual(cropPx(1001, 701, { x: 0.1, y: 0.1, w: 0.333, h: 0.333 }), { x: 100, y: 70, width: 332, height: 232 });
});

test('an area that reaches past the edge is clipped, never empty', () => {
  const r = cropPx(1920, 1080, { x: 0.9, y: 0.9, w: 0.5, h: 0.5 });
  assert.ok(r.x + r.width <= 1920 && r.y + r.height <= 1080);
  assert.ok(r.width >= 2 && r.height >= 2);
  const edge = cropPx(1920, 1080, { x: 1, y: 1, w: 0, h: 0 });
  assert.deepStrictEqual(edge, { x: 1918, y: 1078, width: 2, height: 2 });
});

test('frame times keep rising when the screen is switched mid-recording', () => {
  const t = retimer(100);
  assert.deepStrictEqual([0, 33, 66].map((ts) => t.map(ts)), [0, 33, 66]); // the first capture is untouched
  t.next(); // a new capture counts from its own start again
  assert.deepStrictEqual([5, 38].map((ts) => t.map(ts)), [166, 199]);
  t.next();
  assert.deepStrictEqual([1000000].map((ts) => t.map(ts)), [299]);
  assert.strictEqual(t.map(299), 300); // never the same time twice
});
