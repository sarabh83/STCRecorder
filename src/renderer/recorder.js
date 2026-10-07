'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  window.paintIcons();
  const el = {
    root: $('root'), panel: $('panel'), head: $('head'), fab: $('fab'), collapse: $('collapse'),
    src: $('src'), srcName: $('srcName'), mode: $('mode'), micRow: $('micRow'), mute: $('mute'), micSel: $('micSel'),
    meter: $('meter').firstElementChild, msg: $('msg'), recover: $('recover'), quit: $('quit'),
    time: $('time'), pause: $('pause'), rec: $('rec'),
  };

  const STRINGS = {
    chooseScreen: 'Choose screen or window',
    silenceMic: 'آیا داری صحبت می‌کنی؟ صدایی ضبط نمی‌شود',
    silenceSystem: 'هیچ صدایی از کامپیوتر ضبط نمی‌شود',
    silenceTitle: 'Starecorder',
    noMic: 'No microphone found',
    noSystem: 'No computer audio available for this source',
    micMissing: 'Chosen microphone not found, using default',
    badSource: 'Source unavailable, choose again',
    saved: 'Saved – click to open',
    failed: 'Could not start recording',
  };
  const TICK_MS = 100;
  const TIMESLICE_MS = 1000;

  let S = {};
  let source = null;
  let state = 'idle'; // idle | recording | paused
  let rt = null; // runtime objects of the current recording
  let lastFile = null;
  let micMsgTimer = null;
  let muted = false;
  let open = false;
  let warning = false;

  const useMic = () => S.audioMode !== 'system';
  const useSystem = () => S.audioMode !== 'mic';

  const fmt = (ms) => {
    const s = Math.floor(ms / 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  };

  function setMsg(text, { link = false, warn = false } = {}) {
    el.msg.hidden = !text;
    el.msg.textContent = text || '';
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
  }

  function setState(next) {
    state = next;
    const idle = next === 'idle';
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

  // Source, sound mode and device are decided when recording starts, so lock them meanwhile.
  function paintControls() {
    const idle = state === 'idle';
    el.src.disabled = !idle;
    el.mode.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.mode === S.audioMode);
      b.disabled = !idle;
    });
    el.micRow.classList.toggle('off', !useMic());
    el.micSel.disabled = !idle || !useMic();
    el.mute.disabled = !useMic();
    el.mute.querySelector('i').dataset.icon = muted ? 'mic-off' : 'mic';
    window.paintIcons(el.mute);
    el.mute.title = muted ? 'Unmute microphone' : 'Mute microphone';
  }

  async function choose() {
    const res = await window.api.pickSource();
    if (res) {
      source = res;
      el.srcName.textContent = res.name;
      el.src.title = res.name;
      setMsg('');
    }
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
      el.panel.setAttribute('aria-hidden', 'false');
      measure(); // grow the window first, then fade the panel in
      requestAnimationFrame(() => requestAnimationFrame(() => el.root.classList.add('open')));
      panelObserver.observe(el.panel);
    } else {
      panelObserver.disconnect();
      el.root.classList.remove('open');
      el.panel.setAttribute('aria-hidden', 'true');
      setTimeout(() => {
        if (open) return;
        el.root.classList.remove('shown');
        window.api.uiSize(false, 0);
      }, 180);
    }
  }

  // Click toggles the panel; dragging (more than 5 px) moves the icon / panel instead.
  function draggable(node, onClick) {
    let start = null;
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target.closest('button') && e.target.closest('button') !== node)) return;
      node.setPointerCapture(e.pointerId);
      start = { x: e.screenX, y: e.screenY, moved: false };
      window.api.uiDrag('start', 0, 0);
    });
    node.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.screenX - start.x;
      const dy = e.screenY - start.y;
      if (!start.moved && Math.hypot(dx, dy) > 5) start.moved = true;
      if (start.moved) window.api.uiDrag('move', dx, dy);
    });
    const end = () => {
      if (!start) return;
      const moved = start.moved;
      start = null;
      window.api.uiDrag('end', 0, 0);
      if (!moved && onClick) onClick();
    };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
  }

  // ---------- microphone selection ----------

  let devices = []; // [{id, label}]

  async function refreshDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      devices = all
        .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
    } catch {
      devices = [];
    }
    paintMicList();
  }

  function paintMicList() {
    const cur = S.micDeviceId || '';
    el.micSel.textContent = '';
    const add = (id, label) => {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = label;
      el.micSel.appendChild(o);
    };
    add('', 'System default');
    devices.forEach((d) => add(d.id, d.label));
    el.micSel.value = devices.some((d) => d.id === cur) ? cur : '';
  }

  // Opens the chosen microphone; falls back to the default if it is gone.
  async function openMic() {
    const base = {
      channelCount: 2,
      sampleRate: 48000,
      echoCancellation: S.audioMode === 'both', // only needed when speakers may leak into the mic
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

  // ---------- recording ----------

  async function start() {
    if (!source) {
      await choose();
      if (!source) return;
    }
    setMsg('');
    const made = []; // things to clean up if start fails halfway
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: S.fps, max: S.fps }, width: { max: 1920 }, height: { max: 1080 } },
        audio: useSystem(),
      });
      made.push(display);

      // Mic is opened unless only computer sound was asked for. Processing is off by
      // default so the voice is not coloured.
      let micStream = null;
      if (useMic()) {
        try {
          micStream = await openMic();
          made.push(micStream);
        } catch {
          setMsg(STRINGS.noMic);
        }
      }

      // Show which microphone is really in use, so there is no doubt (also stored in the journal).
      const micTrack = micStream && micStream.getAudioTracks()[0];
      const micName = micTrack ? micTrack.label : '';
      if (micName) {
        const fellBack = S.micDeviceId && micTrack.getSettings().deviceId !== S.micDeviceId;
        setMsg(`${fellBack ? 'Default mic' : 'Mic'}: ${micName}`);
        clearTimeout(micMsgTimer);
        micMsgTimer = setTimeout(() => { if (el.msg.textContent.includes(micName)) setMsg(''); }, 8000);
      }

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
      // The analyser watches what the user chose to record: the mic, or (computer only) the system sound.
      const makeAnalyser = (node) => {
        const a = ctx.createAnalyser();
        a.fftSize = 1024;
        node.connect(a);
        return a;
      };
      let analyser = null;
      let micGain = null;
      muted = false;
      if (micStream) {
        const micSrc = ctx.createMediaStreamSource(micStream);
        if (S.audioMode !== 'system') analyser = makeAnalyser(micSrc);
        micGain = ctx.createGain();
        micSrc.connect(micGain).connect(master);
      }
      const sysTracks = display.getAudioTracks();
      if (sysTracks.length) {
        const sysSrc = ctx.createMediaStreamSource(new MediaStream([sysTracks[0]]));
        const sysGain = ctx.createGain();
        sysGain.gain.value = 0.8; // voice of the person teaching stays slightly on top
        sysSrc.connect(sysGain).connect(master);
        if (S.audioMode === 'system') analyser = makeAnalyser(sysSrc);
      } else if (useSystem()) {
        setMsg(STRINGS.noSystem);
      }
      const hasAudio = !!micStream || sysTracks.length > 0;

      const stream = new MediaStream([
        ...display.getVideoTracks(),
        ...(hasAudio ? dest.stream.getAudioTracks() : []),
      ]);

      const wanted = S.codec === 'h264' ? 'video/webm;codecs=h264,opus' : 'video/webm;codecs=vp8,opus';
      const mimeType = MediaRecorder.isTypeSupported(wanted) ? wanted : 'video/webm;codecs=vp8,opus';
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: S.videoKbps * 1000,
        audioBitsPerSecond: 128000,
      });

      const info = await window.api.recStart({ mimeType, fps: S.fps, source: source.name, mic: micName });
      if (!info) throw new Error('main refused to start');

      // Same sound again as an audio-only file: an independent copy of the full conversation.
      let audioRecorder = null;
      let audioStopped = Promise.resolve();
      let audioChain = Promise.resolve();
      if (hasAudio && S.audioFile && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        audioRecorder = new MediaRecorder(new MediaStream(dest.stream.getAudioTracks()), {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: 128000,
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
        el.time.textContent = '00:00:00';
        el.meter.style.width = '0';
        setMsg(res && !res.error ? STRINGS.saved : STRINGS.failed, { link: !!lastFile });
        setOpen(true);
      };

      // The user closed the shared window / stopped sharing from the OS.
      display.getVideoTracks()[0].addEventListener('ended', () => stop());

      const detector = new window.SilenceDetector({ thresholdDb: S.silenceThresholdDb, timeoutMs: 30000 });
      const now = performance.now();
      detector.reset(now);
      if (!analyser) detector.pause();

      rt = {
        display, micStream, ctx, recorder, audioRecorder, analyser, micGain, detector,
        silenceText: S.audioMode === 'system' ? STRINGS.silenceSystem : STRINGS.silenceMic,
        buf: new Float32Array(1024),
        startedAt: now, pausedAt: 0, pausedTotal: 0, lastSecond: -1,
        timer: setInterval(tick, TICK_MS),
      };
      recorder.start(TIMESLICE_MS);
      if (audioRecorder) audioRecorder.start(TIMESLICE_MS);
      setState('recording');
      setOpen(false); // get out of the way; the icon shows the state
    } catch (err) {
      for (const s of made) s.getTracks().forEach((t) => t.stop());
      const gone = err && (err.name === 'NotFoundError' || err.name === 'NotReadableError' || err.name === 'AbortError');
      if (gone) {
        source = null;
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
      if (rt.analyser && !(muted && S.audioMode !== 'system')) rt.detector.resume(now);
      setState('recording');
    }
  }

  // Runs 10x/s: timer text, mic meter and the 30 s silence check.
  function tick() {
    if (!rt) return;
    const now = performance.now();
    if (state === 'recording') {
      const elapsed = Math.floor((now - rt.startedAt - rt.pausedTotal) / 1000);
      if (elapsed !== rt.lastSecond) {
        rt.lastSecond = elapsed;
        el.time.textContent = fmt(elapsed * 1000);
      }
    }
    if (!rt.analyser || state !== 'recording') return;

    rt.analyser.getFloatTimeDomainData(rt.buf);
    let sum = 0;
    for (let i = 0; i < rt.buf.length; i++) sum += rt.buf[i] * rt.buf[i];
    const db = 20 * Math.log10(Math.sqrt(sum / rt.buf.length) || 1e-5);
    el.meter.style.width = muted && S.audioMode !== 'system' ? '0' : `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;

    const r = rt.detector.update(db, now);
    if (r.warning) setMsg(rt.silenceText, { warn: true });
    else if (r.cleared) setMsg('');
    if (r.notify) window.api.notify(STRINGS.silenceTitle, rt.silenceText);
  }

  // ---------- wiring ----------

  draggable(el.fab, () => setOpen(!open));
  draggable(el.head);
  el.collapse.addEventListener('click', () => setOpen(false));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });

  el.src.addEventListener('click', choose);
  el.rec.addEventListener('click', () => (state === 'idle' ? start() : stop()));
  el.pause.addEventListener('click', togglePause);
  el.mode.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b || state !== 'idle') return;
    S.audioMode = b.dataset.mode;
    window.api.setSettings({ audioMode: S.audioMode });
    paintControls();
  });
  el.micSel.addEventListener('change', () => {
    const id = el.micSel.value;
    const label = id ? el.micSel.selectedOptions[0].textContent : '';
    S.micDeviceId = id;
    S.micLabel = label;
    window.api.setSettings({ micDeviceId: id, micLabel: label });
  });
  el.mute.addEventListener('click', () => {
    muted = !muted;
    if (rt && rt.micGain) {
      rt.micGain.gain.value = muted ? 0 : 1;
      if (S.audioMode !== 'system') {
        if (!muted && state === 'recording') rt.detector.resume(performance.now());
        else rt.detector.pause();
        if (muted) setMsg('');
      }
    }
    paintControls();
  });
  el.recover.addEventListener('click', async () => {
    if (await window.api.recoverRun()) el.recover.hidden = true;
  });
  el.quit.addEventListener('click', () => {
    if (state === 'idle' || !rt) return window.api.quit();
    // finish the file first so it gets its "done" marker
    const q = rt.recorder.onstop;
    rt.recorder.onstop = async () => { await q(); window.api.quit(); };
    stop();
  });
  window.api.onToggle(() => (state === 'idle' ? start() : stop()));
  window.api.onSettings((s) => {
    // While recording, keep the mode and microphone that the recording started with.
    S = state === 'idle' ? { ...S, ...s } : { ...S, ...s, audioMode: S.audioMode, micDeviceId: S.micDeviceId };
    paintControls();
    if (state === 'idle') paintMicList();
  });

  (async () => {
    S = await window.api.settings();
    paintControls();
    // A short-lived stream makes the browser reveal device names; keep the list fresh on plug/unplug.
    try {
      (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
    } catch { /* no mic or no permission */ }
    await refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    el.srcName.textContent = STRINGS.chooseScreen;
    el.recover.hidden = !(await window.api.recoverCheck());
    if (!el.recover.hidden) setOpen(true);
  })();
})();
