# Starecorder

A very light Windows screen recorder (Electron). It lives as one small microphone icon in the
bottom-right corner of the screen; click it and a panel slides out.

- **Screen:** pick a screen or window to share (like Google Meet).
- **Sound:** record *Me* (microphone only), *Computer* (system sound only) or *Both*.
- **Microphone:** choose any input device (laptop mic, USB mic, AirPods...). The list updates on plug/unplug.
- Opus 128 kbps / 48 kHz stereo audio, VP8 video (WebM). No ffmpeg, no processing in JS.
- Each recording is a full video (`recording.webm`, picture + sound) plus a separate `audio.webm` with the
  same sound. A limiter on the mix prevents clipping.
- Warns if the recorded input is silent for 30 seconds (the microphone, or the computer sound in *Computer* mode).
  It is level based, not speech detection: a noisy room keeps the level up and no warning appears.
- Crash-safe: data is written to disk continuously, forced to disk every 5 s, with a restorable checkpoint every
  3 minutes. After a crash or power loss the panel opens with **Recover last recording**.
- Recordings go to `Videos\Starecorder\<date-time>\`.

The icon and panel are excluded from screen capture (Windows content protection). If you still see them in a
recording, tick **Hide icon while recording** in the tray menu and control recording with the tray or `Ctrl+Shift+R`.

Shortcut: `Ctrl+Shift+R` start/stop. Tray menu: Bootcamp preset, frame rate, quality, codec, noise suppression.
Drag the icon (or the panel header) to move it to another corner.

## Choosing audio devices

- **Bluetooth headsets (AirPods):** on Windows they drop to phone quality when used as a microphone. For the best
  audio use a USB/wired or the laptop mic, and keep AirPods for listening only. The panel shows which mic is used.
- **Computer sound** records whatever Windows' default *output* device is. To record another output device, set it
  as the default in Windows sound settings.

## Develop

```
npm install
npm start        # run
npm test         # unit tests
npm run dist     # Windows installer (NSIS) in dist/  (build it on Windows or in CI)
python3 scripts/make-icons.py   # regenerate the icons (needs Pillow)
```
