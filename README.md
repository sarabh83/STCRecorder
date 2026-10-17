<p align="center">
  <img src="docs/banner.png" alt="STC Recorder" width="100%">
</p>

# STC Recorder

A very light, open-source screen recorder for Windows and macOS. It lives as one small round icon in the corner of your
screen. Click it, a panel slides out, press **Record**. If the app, the computer or the power dies in the middle of a
recording, you keep everything up to the last few seconds.

Built with Electron. Free, no account, no cloud, no watermark, no telemetry.

<p align="center">
  <img src="docs/ui.png" alt="STC Recorder: the record panel and the recordings library" width="80%">
</p>

## Download

**[Download the latest release](https://github.com/sarabh83/recorder/releases/latest)** and pick the file for your
computer (under **Assets** at the bottom of the release):

| Your computer | File to download |
|---|---|
| Windows 10 or 11 | `STC-Recorder-Setup-<version>.exe` |
| Mac with an Apple chip (M1, M2, M3, M4…) | `STC-Recorder-<version>-mac-arm64.dmg` |
| Mac with an Intel processor | `STC-Recorder-<version>-mac-x64.dmg` |

Not sure which Mac you have? Click the Apple logo in the top-left corner > **About This Mac**. If it says **Chip: Apple M…**, take
`arm64`. If it says **Processor: … Intel**, take `x64`.

### Install on Windows

Run `STC-Recorder-Setup-<version>.exe`. It installs per user, no admin rights needed.

### Install on Mac

Needs macOS 13 Ventura or newer. Recording the computer sound needs macOS 14.2 Sonoma or newer.

STC Recorder is free and is not registered with Apple (that costs a yearly fee), so macOS refuses to open it until
you tell it once that you trust it. That is step 3 below. It takes one command and you only do it once per install.

**1. Copy the app to Applications**

Double-click the `.dmg` you downloaded. In the window that opens, drag **STC Recorder** onto the **Applications**
folder. Then eject the disk: right-click **STC Recorder** on the desktop (or in the Finder sidebar) > **Eject**.

**2. Open Terminal**

Press `Cmd + Space`, type `Terminal`, press `Return`.

**3. Let macOS open the app**

Copy this line, paste it into Terminal (`Cmd + V`) and press `Return`:

```
xattr -cr "/Applications/STC Recorder.app"
```

Nothing is printed when it works. You can close Terminal.

> If you skip this step, macOS says *"STC Recorder is damaged and can't be opened"* or *"Apple could not verify
> STC Recorder is free of malware"*. The app is not damaged: run the command above, then open it again.

**4. Open STC Recorder**

Open it from **Applications** or with `Cmd + Space` > `STC Recorder`. There is no Dock icon: the app is the small
round icon in the bottom-right corner of the screen, plus an icon in the menu bar at the top.

**5. Give it permission**

macOS asks for each permission once. Answer like this:

| macOS asks about | When | What to do |
|---|---|---|
| **Microphone** | when the app starts | **Allow** |
| **Screen Recording** | the first time you click *Choose screen or window* | **Open System Settings**, turn **STC Recorder** on, then choose **Quit & Reopen** |
| **System Audio Recording** | the first recording with computer sound on | **Allow** |

If the screen list is empty and shows a yellow note instead, Screen Recording is still off (or the app has not been
restarted since you turned it on). Click **Open settings** in the note, turn **STC Recorder** on, then click
**Restart app**.

You can check or change all of these later in **System Settings > Privacy & Security** (sections *Microphone* and
*Screen & System Audio Recording*).

#### Updating on Mac

Drag the new version onto Applications and choose **Replace**, then run the command from step 3 again. macOS may
treat the new version as a new app and ask for the permissions again. If the screen list stays empty after an
update, open **System Settings > Privacy & Security > Screen & System Audio Recording**, select **STC Recorder**,
remove it with the **–** button, then open the app and allow it again.

#### Uninstalling on Mac

Quit the app and drag **STC Recorder** from Applications to the Trash. Your recordings stay in
`Movies/Starecorder` in your home folder. Settings are in `~/Library/Application Support/Starecorder`.

## Features

### Light and out of the way
- A single 44 px corner icon instead of a window. The panel slides out on click and gets out of the way when
  recording starts. Drag the icon anywhere; it remembers its place.
- While recording, the icon turns green with a live level halo, and the time so far appears beside it.
- Uses the lightest codec by default (VP8) at 24 to 30 fps. H.264 is available if you prefer GPU encoding.
- Optional **Hide icon while recording**, and a global shortcut `Ctrl+Shift+R` (`Cmd+Shift+R` on Mac) to start/stop.

### It never records itself
The icon, the panel, the source picker and the area border are excluded from capture using the system's content
protection, so they never show up in your video.

### Crash-safe recordings
- Video is written to disk continuously, in 1-second chunks, and forced to the physical disk every 5 seconds.
- Extra flushes on system suspend, lock screen and shutdown.
- A journal with checkpoints is kept next to every recording.
- A recording that was cut off by a crash or a power loss is not lost. It appears in the **Recordings** tab, marked
  *interrupted*, and plays normally.

### Smaller files
- **Final processing** re-encodes any recording to a compact `recording.mp4` (x264, CRF 20, AAC, fast-start) using
  the bundled ffmpeg. Bits are spent only where the picture needs them, so screen recordings usually shrink a lot
  with no visible loss. The original is kept.
- The picture is never scaled up, only capped at the chosen height, and text stays sharp (the encoder drops frames
  before it drops resolution).

### Warns you when something is wrong
- If the sound you are watching is silent for 15 seconds, the icon turns yellow and a small tooltip tells you which
  one (*Microphone muted* or *No computer sound*). Press **Don't show again** if the silence is on purpose and the reminder is
  turned off for the rest of that recording.
- Tells you which microphone is really in use, and says so when the chosen one is gone and the default is used
  instead.
- Warns when the chosen window or screen disappears, or when no computer audio is available for a source.
- The check is level based, not speech detection.

### Pick what you record
- Any **screen or window**, with live thumbnails.
- **Select an area**: drag a rectangle over part of a screen. A dashed green border marks it, and turns solid while
  recording.
- **Switch in the middle of a recording**: click the screen name in the panel and pick another screen, window or
  area. The recording goes on in the same file. Final processing fits every part into the size of the first one,
  with black bars where the shapes differ.

### Choose your quality
| Video | Presets |
|---|---|
| Resolution and bitrate | 720p, 1080p, 1080p High, 1440p, 4K |
| Frame rate | 15, 24, 30 fps |
| Codec | VP8 (lightest on CPU), H.264 |

Audio: 64, 128, 192 or 256 kbps.

### Sound done right
- **Microphone** and **computer sound** each have their own row, mute switch and level meter.
- Both are always captured, so either one can be muted or unmuted, and the microphone can be switched, **in the
  middle of a recording**.
- A limiter on the mix prevents clipping when a guest or a video is loud.
- Optional separate `audio.webm` with the same sound, as an independent backup.
- Optional microphone noise suppression. Echo cancellation is applied automatically only when computer sound is on.

### Recordings library
Every recording on disk in one tab: play, open its folder, run final processing (with progress), see size and
duration. Pause and resume while recording.

## Where files go

Windows: `Videos\Starecorder\`. Mac: `Movies/Starecorder/` in your home folder. One folder per recording:

```
<date-time>/
    recording.webm     the full video (VP8/H.264 + Opus)
    audio.webm         same sound, audio only (optional)
    recording.mp4      after "final processing"
    journal.json       checkpoints, used to recover interrupted recordings
```

(The folder keeps the app's old name, Starecorder, so recordings made before the rename are still found.)

## Tips for good audio
- **Bluetooth headsets (AirPods):** Windows and macOS drop them to phone quality when they are used as a
  microphone. Use a wired/USB or the laptop mic for recording and keep the headset for listening.
- **Computer sound** is whatever the system's default *output* device is. The panel shows its name; click it to open
  the sound settings.
- **On Mac**, `.webm` recordings do not play in QuickTime. Use the final-processing (bolt) button in the Recordings
  tab to make an MP4, or open them in VLC or IINA.

## Tray / menu bar menu
Start/stop, a *Bootcamp* preset (mic + system audio, 24 fps, 5 Mbps), frame rate, codec, separate audio file, hide
icon while recording, noise suppression, open the recordings folder, quit.

## Develop

Requires Node.js 22, on Windows or macOS 13+.

```
npm install
npm start        # run (from a VS Code terminal, clear ELECTRON_RUN_AS_NODE first)
npm test         # unit tests
npm run dist     # Windows installer (NSIS) in dist/
npm run dist:mac # macOS .dmg and .zip in dist/ (run on a Mac)
python3 scripts/make-icons.py   # regenerate the icons from design/logo.svg (needs Pillow)
```

Project layout:

```
src/main/        main process: window, tray, recording storage (crash-safe writer), library + ffmpeg, settings
src/renderer/    the icon / panel UI, picker, area selection, recorder, silence detector
test/            unit tests (node --test)
design/logo.svg  logo master
```

GitHub Actions builds the Windows installer and the macOS app (Apple Silicon and Intel) on every push; download them
from the run's **Artifacts**.

The Mac app is ad-hoc signed and not notarized (no Apple Developer account), which is why the install steps above
need the `xattr` command. Computer sound on macOS uses Apple's CoreAudio tap, which needs the
`NSAudioCaptureUsageDescription` key set in `package.json`.

## Contributing

Issues and pull requests are welcome. Please run `npm test` before opening a PR.

## License

[MIT](LICENSE) © 2026 Taha Hosseinpour
