'use strict';
// The video of a recording. Frames go from the capture to the encoder through one track that
// lives as long as the recording: switching to another screen or window mid-recording only
// changes where the frames come from (MediaRecorder stops if its track changes). Recording only
// a part of the screen cuts every frame down to the chosen rectangle on the way. No canvas and
// no copy of the pixels: a cut frame is the same picture with a smaller visible rectangle.

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

// Frame timestamps (µs) that keep rising across captures. Each capture counts from its own
// start, so after `next()` the new one continues one frame (`gap`) after the last frame written.
function retimer(gap = 33333) {
  let last = -1;
  let shift = 0;
  let fresh = false;
  return {
    next() { fresh = last >= 0; },
    map(ts) {
      if (fresh) {
        shift = last + gap - ts;
        fresh = false;
      }
      last = Math.max(ts + shift, last + 1);
      return last;
    },
  };
}

// { track, use(captureTrack, crop?), size(), stop() }. `size()` is the first frame's size.
function videoPipe() {
  const generator = new MediaStreamTrackGenerator({ kind: 'video' });
  const writer = generator.writable.getWriter();
  const times = retimer();
  let current = null; // reader of the capture in use; frames of any other are dropped
  let size = null;

  async function pump(reader, crop) {
    for (;;) {
      let res;
      try {
        res = await reader.read();
      } catch {
        return; // the capture stopped
      }
      if (res.done) return;
      const frame = res.value;
      if (reader !== current) {
        frame.close();
        return;
      }
      const r = crop && cropPx(frame.codedWidth, frame.codedHeight, crop);
      const out = new VideoFrame(frame, {
        timestamp: times.map(frame.timestamp),
        ...(r && { visibleRect: r, displayWidth: r.width, displayHeight: r.height }),
      });
      frame.close();
      if (!size) size = { width: out.displayWidth, height: out.displayHeight };
      try {
        await writer.write(out);
      } catch {
        out.close();
        return; // the recording ended
      }
    }
  }

  return {
    track: generator,
    size: () => size,
    use(track, crop) {
      const old = current;
      current = new MediaStreamTrackProcessor({ track }).readable.getReader();
      if (old) {
        times.next();
        old.cancel().catch(() => {});
      }
      pump(current, crop);
    },
    stop() {
      if (current) current.cancel().catch(() => {});
      current = null;
      writer.close().catch(() => {});
    },
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { cropPx, retimer };
else Object.assign(window, { cropPx, videoPipe });
