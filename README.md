# Recorder

A very light Windows screen recorder (Electron). One slim bar at the bottom of the screen.

- Pick a screen or window to share (like Google Meet).
- Microphone by default; optional system audio (other people in a call).
- Opus 128 kbps / 48 kHz stereo audio, VP8 video (WebM). No ffmpeg, no processing in JS.
- Warns if the microphone is silent for 30 seconds.
- Crash-safe: data is written to disk continuously, fsynced every 10 s, with a restorable
  checkpoint every 3 minutes. After a crash or power loss, the bar offers **Recover**.
- Recordings go to `Videos\Recorder\<date-time>\recording.webm`.

Shortcut: `Ctrl+Shift+R` start/stop. Tray menu: frame rate, quality, codec, noise suppression.

## Develop

```
npm install
npm start        # run
npm test         # unit tests
npm run dist     # Windows installer (NSIS) in dist/
```
