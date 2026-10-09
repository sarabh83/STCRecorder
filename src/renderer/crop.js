'use strict';
// Recording only a part of the screen: every captured frame is cut down to the chosen
// rectangle before it reaches the encoder. No canvas and no copy of the pixels: the new
// frame is the same picture with a smaller visible rectangle.

// The rectangle in whole, even pixels (video encoders need even sizes) inside a width x height frame.
// `crop` is in fractions of the frame: {x, y, w, h}, each 0..1.
function cropPx(width, height, crop) {
  const even = (v) => Math.floor(v / 2) * 2;
  const x = Math.min(even(crop.x * width), even(width) - 2);
  const y = Math.min(even(crop.y * height), even(height) - 2);
  return {
    x,
    y,
    width: Math.max(2, Math.min(even(crop.w * width), even(width - x))),
    height: Math.max(2, Math.min(even(crop.h * height), even(height - y))),
  };
}

// Returns a new video track showing only `crop` of `track`. It ends when `track` ends.
function cropTrack(track, crop) {
  const processor = new MediaStreamTrackProcessor({ track });
  const generator = new MediaStreamTrackGenerator({ kind: 'video' });
  const cutter = new TransformStream({
    transform(frame, controller) {
      const r = cropPx(frame.codedWidth, frame.codedHeight, crop);
      const cut = new VideoFrame(frame, { visibleRect: r, displayWidth: r.width, displayHeight: r.height });
      frame.close();
      controller.enqueue(cut);
    },
  });
  processor.readable.pipeThrough(cutter).pipeTo(generator.writable).catch(() => { /* the capture stopped */ });
  return generator;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { cropPx };
else Object.assign(window, { cropPx, cropTrack });
