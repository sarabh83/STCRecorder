'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  window.paintIcons();
  const el = {
    root: $('root'), panel: $('panel'), head: $('head'), title: $('title'), collapse: $('collapse'),
    tabs: $('tabs'), viewRecord: $('viewRecord'), viewLibrary: $('viewLibrary'),
    dock: $('dock'), fab: $('fab'), clock: $('clock'), tip: $('tip'), tipText: $('tipText'), tipOk: $('tipOk'),
    src: $('src'), srcName: $('srcName'),
    micRow: $('micRow'), micMute: $('micMute'), micMeter: $('micMeter'),
    sysRow: $('sysRow'), sysMute: $('sysMute'), sysMeter: $('sysMeter'), sysDev: $('sysDev'), sysName: $('sysName'),
    msg: $('msg'), quit: $('quit'),
    time: $('time'), pause: $('pause'), rec: $('rec'),
  };

  const MAC = window.api.platform === 'darwin';
  const STRINGS = {
    chooseScreen: 'Choose screen or window',
    silenceMic: 'Microphone muted',
    silenceSystem: 'No computer sound',
    defaultOutput: MAC ? 'System default output' : 'Windows default output',
    noMic: 'No microphone found',
    noSystem: 'No computer audio available for this source',
    micMissing: 'Chosen microphone not found, using default',
    badSource: 'Source unavailable, choose again',
    switchFailed: 'Could not switch, still recording the previous source',
    saved: 'Saved – click to open',
    failed: 'Could not start recording',
  };
  const TICK_MS = 100;
  const TIMESLICE_MS = 1000;
  const SILENCE_MS = 15000; // this long without sound = something is wrong
  const CLOSE_MS = 240; // panel closing animation (panel.css)
  const QUIT_CONFIRM_MS = 3000; // how long "Quit?" waits for the second click
  const GAP = 8; // between the tooltip and the icon row (panel.css)
  const SYS_GAIN = 0.8; // voice of the person teaching stays slightly on top

  let S = {};
  let source = null;
  let state = 'idle'; // idle | recording | paused
  let rt = null; // runtime objects of the current recording
  let lastFile = null;
  let noteTimer = null;
  let open = false;
  let warning = false;
  let warnText = ''; // the silence warning on show, without its OK button
  let mini = { w: 0, h: 0 }; // size of the collapsed content last sent to the main process
  let quitTimer = null;
  let starting = false; // between the click on Record and the recording running (seconds on macOS)

  const fmt = (ms) => {
    const s = Math.floor(ms / 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  };

  function setTime(ms) {
    const text = fmt(ms);
    el.time.textContent = text;
    el.clock.textContent = text.replace(/^0/, ''); // 2:29:39 beside the icon
  }

  function setMsg(text, { link = false, warn = false } = {}) {
    if (warn && warning && text === warnText) return; // the same warning is already up
    warnText = warn ? text : '';
    el.msg.hidden = !text;
    el.msg.textContent = text || '';
    if (warn) {
      const ok = document.createElement('button');
      ok.className = 'ok';
      ok.textContent = el.tipOk.textContent;
      ok.title = el.tipOk.title;
      ok.addEventListener('click', dismissWarning);
      el.msg.appendChild(ok);
    }
    el.msg.classList.toggle('link', link);
    el.msg.classList.toggle('warn', warn);
    el.msg.onclick = link ? () => lastFile && window.api.openFile(lastFile) : null;
    warning = warn;
    paintRoot();
  }

  function paintRoot() {
    el.root.classList.toggle('recording', state === 'recording');
    el.root.classList.toggle('paused', state === 'paused');
    el.root.classList.toggle('warn', warning && state === 'recording');
    paintMini();
  }

  // "Don't show again" on a silence warning: the silence is on purpose, so stop reminding about that
  // sound for the rest of this recording.
  function dismissWarning() {
    if (rt && rt.watch) rt.ack[rt.watch] = true;
    setMsg('');
  }

  // Collapsed view: the icon, the time so far beside it while recording, and (with the
  // panel closed) a small tooltip above the yellow icon that spells out the problem.
  function paintMini() {
    const collapsed = !el.root.classList.contains('shown');
    const tip = warning && state === 'recording' && collapsed ? warnText : '';
    if (el.tipText.textContent !== tip) el.tipText.textContent = tip;
    el.tip.hidden = !tip;
    el.clock.hidden = state === 'idle';
    const w = Math.max(el.dock.offsetWidth, tip ? el.tip.offsetWidth : 0);
    const h = el.dock.offsetHeight + (tip ? el.tip.offsetHeight + GAP : 0);
    if (w === mini.w && h === mini.h) return;
    mini = { w, h };
    window.api.uiMini(w, h);
  }

  // Two tabs while idle: the recorder itself, and the list of recordings on disk.
  function showTab(name) {
    el.tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    el.viewRecord.hidden = name !== 'record';
    el.viewLibrary.hidden = name !== 'library';
    if (name === 'library') window.library.refresh();
  }

  function paintTitle() {
    el.title.textContent = state === 'idle' ? 'STC Recorder' : `${state === 'paused' ? 'Paused' : 'Recording'}${rt && rt.size ? ` · ${rt.size}` : ''}`;
  }

  function setState(next) {
    state = next;
    const idle = next === 'idle';
    if (!idle) showTab('record'); // while recording the panel is only the live controls
    paintTitle();
    el.rec.querySelector('span').textContent = idle ? 'Record' : 'Stop';
    el.rec.querySelector('i').dataset.icon = idle ? 'record' : 'stop';
    window.paintIcons(el.rec);
    el.pause.disabled = idle;
    el.pause.querySelector('i').dataset.icon = next === 'paused' ? 'play' : 'pause';
    window.paintIcons(el.pause);
    paintControls();
    paintRoot();
    window.api.setState(next);
  }

  // The screen, the microphone and the two mute switches can all be changed at any time.
  function paintControls() {
    el.src.title = state === 'idle' ? el.srcName.textContent : `Switch to another screen or window (now: ${el.srcName.textContent})`;
    const paintMute = (row, btn, muted, icon, name) => {
      row.classList.toggle('muted', muted);
      btn.querySelector('i').dataset.icon = muted ? `${icon}-off` : icon;
      window.paintIcons(btn);
      btn.title = `${muted ? 'Unmute' : 'Mute'} ${name}`;
      btn.setAttribute('aria-pressed', String(muted));
    };
    paintMute(el.micRow, el.micMute, !!S.micMuted, 'mic', 'microphone');
    paintMute(el.sysRow, el.sysMute, !!S.systemMuted, 'speaker', 'computer sound');
  }

  function paintSource() {
    el.srcName.textContent = !source ? STRINGS.chooseScreen : source.crop ? `${source.name} · selected area` : source.name;
    paintControls();
  }

  // While recording, the new choice replaces the old one in the same file.
  async function choose() {
    if (starting) return; // the capture being started would not follow the new choice
    const res = await window.api.pickSource();
    if (!res) return;
    const prev = source;
    source = res; // {id, name, crop?}: crop is the part of the screen to record, in fractions
    paintSource();
    setMsg('');
    if (rt && !(await switchSource())) {
      source = prev;
      paintSource();
    }
  }

  // ---------- quality ----------

  const VIDEO_PRESETS = [
    { label: '720p', maxHeight: 720, videoKbps: 5000 },
    { label: '1080p', maxHeight: 1080, videoKbps: 8000 },
    { label: '1080p High', maxHeight: 1080, videoKbps: 16000 },
    { label: '1440p', maxHeight: 1440, videoKbps: 16000 },
    { label: '4K', maxHeight: 2160, videoKbps: 24000 },
  ];
  const AUDIO_KBPS = [64, 128, 192, 256];
  const videoKey = (p) => `${p.maxHeight}:${p.videoKbps}`;

  const videoSel = window.createSelect($('videoSel'), (key) => {
    const [maxHeight, videoKbps] = key.split(':').map(Number);
    Object.assign(S, { maxHeight, videoKbps });
    window.api.setSettings({ maxHeight, videoKbps });
  });
  const audioSel = window.createSelect($('audioSel'), (kbps) => {
    S.audioKbps = Number(kbps);
    window.api.setSettings({ audioKbps: S.audioKbps });
  });

  function paintQuality() {
    const options = VIDEO_PRESETS.map((p) => ({ value: videoKey(p), label: p.label }));
    const cur = videoKey(S);
    // a combination set elsewhere (tray preset, older settings) is shown as it is
    if (!options.some((o) => o.value === cur)) options.unshift({ value: cur, label: `${S.maxHeight}p · ${S.videoKbps / 1000} Mbps` });
    videoSel.setOptions(options, cur);
    audioSel.setOptions(AUDIO_KBPS.map((k) => ({ value: String(k), label: `${k} kbps` })), String(S.audioKbps));
  }

  function disarmQuit() {
    clearTimeout(quitTimer);
    el.quit.classList.remove('confirm');
  }

  // ---------- panel open / close ----------

  function measure() {
    window.api.uiSize(true, el.panel.offsetHeight);
  }

  const panelObserver = new ResizeObserver(() => { if (open) measure(); });

  function setOpen(next) {
    if (next === open) return;
    open = next;
    if (open) {
      el.root.classList.add('shown');
      paintMini();
      refreshDevices(); // also picks up a changed default output
      if (!el.viewLibrary.hidden) window.library.refresh();
      el.panel.setAttribute('aria-hidden', 'false');
      measure(); // grow the window first, then fade the panel in
      requestAnimationFrame(() => requestAnimationFrame(() => el.root.classList.add('open')));
      panelObserver.observe(el.panel);
    } else {
      panelObserver.disconnect();
      for (const s of [mic, videoSel, audioSel]) s.close();
      disarmQuit();
      el.root.classList.remove('open');
      el.panel.setAttribute('aria-hidden', 'true');
      setTimeout(() => {
        if (open) return;
        el.root.classList.remove('shown');
        window.api.uiSize(false, 0);
        paintMini();
      }, CLOSE_MS);
    }
  }

  // Click toggles the panel; dragging (more than 5 px) moves the icon / panel instead.
  // Once it is a drag, the main process makes the window follow the cursor by itself.
  function draggable(node, onClick) {
    let start = null;
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target.closest('button') && e.target.closest('button') !== node)) return;
      node.setPointerCapture(e.pointerId);
      start = { x: e.screenX, y: e.screenY, moved: false };
    });
    node.addEventListener('pointermove', (e) => {
      if (!start || start.moved || Math.hypot(e.screenX - start.x, e.screenY - start.y) <= 5) return;
      start.moved = true;
      el.root.classList.add('dragging');
      window.api.uiDrag('start');
    });
    const end = () => {
      if (!start) return;
      const moved = start.moved;
      start = null;
      el.root.classList.remove('dragging');
      if (moved) window.api.uiDrag('end');
      else if (onClick) onClick();
    };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
    node.addEventListener('lostpointercapture', end); // never leave the window glued to the cursor
  }

  // ---------- sound devices ----------

  let devices = []; // microphones: [{id, label}]

  const mic = window.createSelect($('micSel'), (id, label) => {
    S.micDeviceId = id;
    S.micLabel = id ? label : '';
    window.api.setSettings({ micDeviceId: S.micDeviceId, micLabel: S.micLabel });
    switchMic();
  }, () => refreshDevices()); // a device may have been plugged in since the list was last built

  async function refreshDevices() {
    let all = [];
    try {
      all = await navigator.mediaDevices.enumerateDevices();
    } catch { /* keep the lists empty */ }
    devices = all
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
    paintMicList();
    // Computer sound always comes from the system default output; show which one that is.
    const out = all.find((d) => d.kind === 'audiooutput' && d.deviceId === 'default');
    el.sysName.textContent = (out && out.label.replace(/^Default\s*-\s*/i, '')) || STRINGS.defaultOutput;
  }

  function paintMicList() {
    const cur = S.micDeviceId || '';
    mic.setOptions(
      [{ value: '', label: 'System default' }, ...devices.map((d) => ({ value: d.id, label: d.label }))],
      devices.some((d) => d.id === cur) ? cur : '',
    );
  }

  // Opens the chosen microphone; falls back to the default if it is gone.
  async function openMic() {
    const base = {
      channelCount: 2,
      sampleRate: 48000,
      echoCancellation: !S.systemMuted, // only needed when speakers may leak into the mic
      noiseSuppression: !!S.noiseSuppression,
      autoGainControl: false,
    };
    if (S.micDeviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: S.micDeviceId } } });
      } catch {
        setMsg(STRINGS.micMissing);
      }
    }
    return navigator.mediaDevices.getUserMedia({ audio: base });
  }

  // One sound into the mix: source -> analyser (its meter, before the mute) and source -> gain (the mute) -> master.
  function wire(ctx, stream, gain) {
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    src.connect(gain);
    return { src, analyser };
  }

  // A message that goes away by itself after a few seconds.
  function note(text) {
    setMsg(text);
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { if (el.msg.textContent === text) setMsg(''); }, 8000);
  }

  // Show which microphone is really in use, so there is no doubt.
  function showMic(track) {
    const name = track.label;
    if (!name) return;
    const fellBack = S.micDeviceId && track.getSettings().deviceId !== S.micDeviceId;
    note(`${fellBack ? 'Default mic' : 'Mic'}: ${name}`);
  }

  // ---------- screen ----------

  // The chosen screen or window, with the computer sound. Only upper limits: the screen is
  // recorded at its own resolution, never scaled up.
  function capture() {
    return navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: S.fps, max: S.fps }, width: { max: S.maxHeight * 3 }, height: { max: S.maxHeight } },
      audio: true,
    });
  }

  // "1920×1080": what goes into the file from this capture (only the area, when one was drawn).
  function sizeOf(screenTrack) {
    const vs = screenTrack.getSettings();
    const px = vs.width && vs.height && (source.crop ? window.cropPx(vs.width, vs.height, source.crop) : vs);
    return px ? `${px.width}×${px.height}` : '';
  }

  // The user closed the shared window / stopped sharing from the OS.
  function watchEnd(screenTrack) {
    screenTrack.addEventListener('ended', () => { if (rt && rt.screenTrack === screenTrack) stop(); });
  }

  // Another screen, window or area was chosen while recording: capture it and feed it into the
  // same video track, so the file simply goes on with the new picture. False if that failed.
  async function switchSource() {
    const session = rt;
    let display;
    try {
      display = await capture();
    } catch {
      setMsg(STRINGS.switchFailed);
      return false;
    }
    if (rt !== session) { // the recording ended meanwhile
      display.getTracks().forEach((t) => t.stop());
      return true;
    }
    const screenTrack = display.getVideoTracks()[0];
    rt.pipe.use(screenTrack, source.crop);
    watchEnd(screenTrack);
    // The computer sound comes with the capture: wire the new one in, then let the old capture go.
    const sysTracks = display.getAudioTracks();
    const sys = sysTracks.length ? wire(rt.ctx, new MediaStream([sysTracks[0]]), rt.sysGain) : null;
    if (rt.sysSrc) rt.sysSrc.disconnect();
    const old = rt.display;
    Object.assign(rt, {
      display, screenTrack, size: sizeOf(screenTrack), sysSrc: sys && sys.src, sysAnalyser: sys && sys.analyser,
    });
    old.getTracks().forEach((t) => t.stop());
    rt.watch = null; // restart the silence check on the new sound
    rt.ack.system = false;
    applyMutes();
    paintTitle();
    if (sys) note(`Now recording: ${el.srcName.textContent}`);
    else setMsg(STRINGS.noSystem);
    window.api.recSource({ name: source.name, frameSize: rt.pipe.size() });
    return true;
  }

  // Another microphone was chosen while recording: wire the new one in, then let the old one go.
  async function switchMic() {
    const session = rt;
    if (!session) return;
    let stream;
    try {
      stream = await openMic();
    } catch {
      setMsg(STRINGS.noMic);
      return;
    }
    if (rt !== session) { // the recording ended meanwhile
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const next = wire(rt.ctx, stream, rt.micGain);
    if (rt.micSrc) rt.micSrc.disconnect();
    if (rt.micStream) rt.micStream.getTracks().forEach((t) => t.stop());
    rt.micStream = stream;
    rt.micSrc = next.src;
    rt.micAnalyser = next.analyser;
    rt.watch = null; // restart the silence check on the new microphone
    rt.ack.mic = false;
    applyMutes();
    showMic(stream.getAudioTracks()[0]);
  }

  // ---------- muting ----------

  // Silence is judged on the microphone, or on the computer sound when the microphone is muted.
  function rewatch() {
    if (!rt) return;
    const next = rt.micAnalyser && !S.micMuted ? 'mic' : rt.sysAnalyser && !S.systemMuted ? 'system' : null;
    if (next === rt.watch) return;
    rt.watch = next;
    if (warning) setMsg('');
    if (next && state === 'recording') rt.detector.resume(performance.now());
    else rt.detector.pause();
  }

  // Both sounds stay connected for the whole recording, so muting is just their gain.
  function applyMutes() {
    if (!rt) return;
    rt.micGain.gain.value = S.micMuted ? 0 : 1;
    rt.sysGain.gain.value = S.systemMuted ? 0 : SYS_GAIN;
    rewatch();
  }

  function toggleMute(key) {
    S[key] = !S[key];
    window.api.setSettings({ [key]: S[key] });
    applyMutes();
    paintControls();
  }

  // ---------- recording ----------

  async function start() {
    if (starting) return;
    if (!source) {
      await choose();
      if (!source) return;
    }
    starting = true;
    try {
      await begin();
    } finally {
      starting = false;
    }
  }

  // Captures the chosen source and starts recording it.
  async function begin() {
    setMsg('');
    const made = []; // things to clean up if start fails halfway
    try {
      const display = await capture();
      made.push(display);
      const screenTrack = display.getVideoTracks()[0];
      // What goes into the file: the whole capture, or only the area drawn in the picker.
      const pipe = window.videoPipe();
      pipe.use(screenTrack, source.crop);
      const videoTrack = pipe.track;
      made.push(new MediaStream([videoTrack]));
      videoTrack.contentHint = 'detail'; // text must stay sharp: drop frames before dropping resolution
      const size = sizeOf(screenTrack);

      // Processing is off by default so the voice is not coloured.
      let micStream = null;
      try {
        micStream = await openMic();
        made.push(micStream);
      } catch {
        setMsg(STRINGS.noMic);
      }

      // The name of the first microphone is also stored in the journal.
      const micTrack = micStream && micStream.getAudioTracks()[0];
      const micName = micTrack ? micTrack.label : '';
      if (micTrack) showMic(micTrack);

      const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
      const dest = ctx.createMediaStreamDestination();
      dest.channelCount = 2;
      // Master bus: a limiter stops a loud guest / video from clipping the mix.
      const master = ctx.createGain();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      master.connect(limiter).connect(dest);
      // The mic gain always exists and the mix always has an audio track, so a microphone
      // can still be plugged in and chosen after the recording has started.
      const micGain = ctx.createGain();
      const sysGain = ctx.createGain();
      micGain.connect(master);
      sysGain.connect(master);
      const micNodes = micStream ? wire(ctx, micStream, micGain) : null;
      const sysTracks = display.getAudioTracks();
      const sysNodes = sysTracks.length ? wire(ctx, new MediaStream([sysTracks[0]]), sysGain) : null;
      if (!sysNodes) setMsg(STRINGS.noSystem);

      const stream = new MediaStream([videoTrack, ...dest.stream.getAudioTracks()]);

      const wanted = S.codec === 'h264' ? 'video/webm;codecs=h264,opus' : 'video/webm;codecs=vp8,opus';
      const mimeType = MediaRecorder.isTypeSupported(wanted) ? wanted : 'video/webm;codecs=vp8,opus';
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: S.videoKbps * 1000,
        audioBitsPerSecond: S.audioKbps * 1000,
      });

      const info = await window.api.recStart({ mimeType, fps: S.fps, size, videoKbps: S.videoKbps, source: source.name, mic: micName });
      if (!info) throw new Error('main refused to start');

      // Same sound again as an audio-only file: an independent copy of the full conversation.
      let audioRecorder = null;
      let audioStopped = Promise.resolve();
      let audioChain = Promise.resolve();
      if (S.audioFile &&MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        audioRecorder = new MediaRecorder(new MediaStream(dest.stream.getAudioTracks()), {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: S.audioKbps * 1000,
        });
        audioStopped = new Promise((resolve) => { audioRecorder.onstop = resolve; });
        audioRecorder.ondataavailable = (e) => {
          if (!e.data || !e.data.size) return;
          audioChain = audioChain.then(() => e.data.arrayBuffer()).then((b) => window.api.recAudioChunk(b));
        };
      }

      let chain = Promise.resolve(); // keeps chunks in order
      recorder.ondataavailable = (e) => {
        if (!e.data || !e.data.size) return;
        chain = chain.then(() => e.data.arrayBuffer()).then((b) => window.api.recChunk(b));
      };
      recorder.onstop = async () => {
        await chain;
        await audioStopped;
        await audioChain;
        const res = await window.api.recStop();
        lastFile = res && res.file;
        cleanup();
        setState('idle');
        setTime(0);
        el.micMeter.style.width = '0';
        el.sysMeter.style.width = '0';
        el.fab.style.setProperty('--level', '0');
        setMsg(res && !res.error ? STRINGS.saved : STRINGS.failed, { link: !!lastFile });
        setOpen(true);
      };

      watchEnd(screenTrack);

      const detector = new window.SilenceDetector({ thresholdDb: S.silenceThresholdDb, timeoutMs: SILENCE_MS });
      const now = performance.now();
      detector.reset(now);
      detector.pause(); // rewatch() starts it on the sound that is not muted

      rt = {
        display, screenTrack, pipe, videoTrack, micStream, ctx, recorder, audioRecorder, detector, size,
        micGain, sysGain,
        micSrc: micNodes && micNodes.src, micAnalyser: micNodes && micNodes.analyser,
        sysSrc: sysNodes && sysNodes.src, sysAnalyser: sysNodes && sysNodes.analyser,
        watch: null, // 'mic' | 'system' | null: the sound the silence check listens to
        ack: { mic: false, system: false }, // silence warnings the user answered with "Don't show again"
        buf: new Float32Array(1024),
        startedAt: now, pausedAt: 0, pausedTotal: 0, lastSecond: -1,
        timer: setInterval(tick, TICK_MS),
      };
      recorder.start(TIMESLICE_MS);
      if (audioRecorder) audioRecorder.start(TIMESLICE_MS);
      setState('recording');
      applyMutes();
      setOpen(false); // get out of the way; the icon shows the state
    } catch (err) {
      for (const s of made) s.getTracks().forEach((t) => t.stop());
      const gone = err && (err.name === 'NotFoundError' || err.name === 'NotReadableError' || err.name === 'AbortError');
      if (gone) {
        source = null;
        window.api.clearSource();
        el.srcName.textContent = STRINGS.chooseScreen;
      }
      setOpen(true);
      setMsg(gone ? STRINGS.badSource : STRINGS.failed);
    }
  }

  function cleanup() {
    if (!rt) return;
    clearInterval(rt.timer);
    rt.display.getTracks().forEach((t) => t.stop());
    rt.pipe.stop();
    rt.videoTrack.stop();
    if (rt.micStream) rt.micStream.getTracks().forEach((t) => t.stop());
    rt.ctx.close().catch(() => {});
    rt = null;
  }

  function stop() {
    if (!rt || state === 'idle') return;
    if (rt.audioRecorder && rt.audioRecorder.state !== 'inactive') rt.audioRecorder.stop();
    if (rt.recorder.state !== 'inactive') rt.recorder.stop();
  }

  function togglePause() {
    if (!rt) return;
    const now = performance.now();
    if (state === 'recording') {
      rt.recorder.pause();
      if (rt.audioRecorder) rt.audioRecorder.pause();
      rt.pausedAt = now;
      rt.detector.pause();
      setMsg('');
      setState('paused');
    } else if (state === 'paused') {
      rt.recorder.resume();
      if (rt.audioRecorder) rt.audioRecorder.resume();
      rt.pausedTotal += now - rt.pausedAt;
      if (rt.watch) rt.detector.resume(now);
      setState('recording');
    }
  }

  // Level of one sound in dB (RMS of the last 1024 samples).
  function levelDb(analyser) {
    analyser.getFloatTimeDomainData(rt.buf);
    let sum = 0;
    for (let i = 0; i < rt.buf.length; i++) sum += rt.buf[i] * rt.buf[i];
    return 20 * Math.log10(Math.sqrt(sum / rt.buf.length) || 1e-5);
  }

  // Runs 10x/s: timer text, the two meters, the icon's halo and the silence check.
  function tick() {
    if (!rt) return;
    const now = performance.now();
    if (state !== 'recording') return;
    const elapsed = Math.floor((now - rt.startedAt - rt.pausedTotal) / 1000);
    if (elapsed !== rt.lastSecond) {
      rt.lastSecond = elapsed;
      setTime(elapsed * 1000);
      paintMini(); // the timer gets wider when the hours gain a digit
    }

    const micDb = rt.micAnalyser ? levelDb(rt.micAnalyser) : -100;
    const sysDb = rt.sysAnalyser ? levelDb(rt.sysAnalyser) : -100;
    const meter = (db, muted) => (muted ? 0 : Math.max(0, Math.min(1, (db + 60) / 60)));
    const micLevel = meter(micDb, S.micMuted);
    const sysLevel = meter(sysDb, S.systemMuted);
    el.micMeter.style.width = `${micLevel * 100}%`;
    el.sysMeter.style.width = `${sysLevel * 100}%`;
    el.fab.style.setProperty('--level', Math.max(micLevel, sysLevel).toFixed(2));

    if (!rt.watch || rt.ack[rt.watch]) return;
    const text = rt.watch === 'mic' ? STRINGS.silenceMic : STRINGS.silenceSystem;
    const r = rt.detector.update(rt.watch === 'mic' ? micDb : sysDb, now);
    if (r.warning) setMsg(text, { warn: true });
    else if (r.cleared) setMsg('');
  }

  // ---------- wiring ----------

  draggable(el.fab, () => setOpen(!open));
  draggable(el.clock, () => setOpen(!open));
  draggable(el.head);
  el.collapse.addEventListener('click', () => setOpen(false));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });

  el.tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) showTab(b.dataset.tab);
  });
  el.tipOk.addEventListener('click', dismissWarning);
  el.src.addEventListener('click', choose);
  el.rec.addEventListener('click', () => (state === 'idle' ? start() : stop()));
  el.pause.addEventListener('click', togglePause);
  el.micMute.addEventListener('click', () => toggleMute('micMuted'));
  el.sysMute.addEventListener('click', () => toggleMute('systemMuted'));
  el.sysDev.addEventListener('click', () => window.api.openSoundSettings());
  // Quit is only offered while idle, and the first click only arms it.
  el.quit.addEventListener('click', () => {
    if (state !== 'idle') return;
    if (el.quit.classList.contains('confirm')) return window.api.quit();
    el.quit.classList.add('confirm');
    clearTimeout(quitTimer);
    quitTimer = setTimeout(disarmQuit, QUIT_CONFIRM_MS);
  });
  window.api.onToggle(() => (state === 'idle' ? start() : stop()));
  window.api.onSettings((s) => {
    S = { ...S, ...s };
    applyMutes();
    paintControls();
    paintMicList();
    paintQuality();
  });

  if (MAC) el.sysDev.title = 'Recorded from the macOS default output. Click to change it in Sound settings.';

  (async () => {
    S = await window.api.settings();
    paintControls();
    paintQuality();
    paintMini();
    // A short-lived stream makes the browser reveal device names; keep the list fresh on plug/unplug.
    try {
      (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
    } catch { /* no mic or no permission */ }
    await refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    el.srcName.textContent = STRINGS.chooseScreen;
  })();
})();
