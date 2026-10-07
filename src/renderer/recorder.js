'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const el = {
    bar: $('bar'), src: $('src'), srcName: $('srcName'), mic: $('mic'), micPick: $('micPick'), sys: $('sys'),
    meter: $('meter').firstElementChild, msg: $('msg'), recover: $('recover'),
    time: $('time'), pause: $('pause'), rec: $('rec'), close: $('close'),
  };

  const STRINGS = {
    chooseScreen: 'Choose screen',
    silence: 'آیا داری صحبت می‌کنی؟ صدایی ضبط نمی‌شود',
    silenceTitle: 'Recorder',
    noMic: 'No microphone found',
    micMissing: 'Chosen microphone not found, using default',
    badSource: 'Source unavailable, choose again',
    saved: 'Saved – click to open',
    failed: 'Could not start recording',
  };
  const TICK_MS = 100;

  let S = {};
  let source = null;
  let state = 'idle'; // idle | recording | paused
  let rt = null; // runtime objects of the current recording
  let lastFile = null;
  let micMsgTimer = null;

  const fmt = (ms) => {
    const s = Math.floor(ms / 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  };

  function setMsg(text, { link = false, warn = false } = {}) {
    el.msg.hidden = !text;
    el.msg.textContent = text || '';
    el.msg.classList.toggle('link', link);
    el.msg.onclick = link ? () => lastFile && window.api.openFile(lastFile) : null;
    el.bar.classList.toggle('warn', warn);
  }

  function setState(next) {
    state = next;
    el.bar.classList.toggle('recording', next === 'recording');
    el.bar.classList.toggle('paused', next === 'paused');
    el.rec.textContent = next === 'idle' ? '● Rec' : '■ Stop';
    el.pause.disabled = next === 'idle';
    el.pause.textContent = next === 'paused' ? '▶' : '⏸';
    el.src.disabled = next !== 'idle';
    el.sys.disabled = next !== 'idle'; // system audio is decided when capture starts
    el.micPick.disabled = next !== 'idle';
    window.api.setState(next);
  }

  function paintToggles() {
    el.mic.classList.toggle('on', !!S.mic);
    el.sys.classList.toggle('on', !!S.system);
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

  // ---------- microphone selection ----------

  let devices = []; // [{id, label}]

  async function refreshDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      devices = all
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
    } catch {
      devices = [];
    }
  }

  function paintMic() {
    el.mic.title = `Microphone: ${S.micLabel || 'System default'}`;
  }

  // Opens the chosen microphone; falls back to the default if it is gone.
  async function openMic() {
    const base = {
      channelCount: 2,
      sampleRate: 48000,
      echoCancellation: !!S.system,
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

  async function chooseMic() {
    await refreshDevices();
    const res = await window.api.micMenu(devices, S.micDeviceId || '');
    if (!res) return;
    S.micDeviceId = res.id;
    S.micLabel = res.label;
    window.api.setSettings({ micDeviceId: res.id, micLabel: res.label });
    paintMic();
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
        audio: !!S.system,
      });
      made.push(display);

      // Mic is always opened so it can be un-muted mid-recording. Processing is
      // off by default so the voice is not coloured; echo cancellation is only
      // on when system audio is also captured (otherwise speakers feed back in).
      let micStream = null;
      try {
        micStream = await openMic();
        made.push(micStream);
      } catch {
        setMsg(STRINGS.noMic, { warn: false });
      }

      // Show which microphone is really in use, so there is no doubt (also stored in the journal).
      const micTrack = micStream && micStream.getAudioTracks()[0];
      const micName = micTrack ? micTrack.label : '';
      if (micName) {
        const fellBack = S.micDeviceId && micTrack.getSettings().deviceId !== S.micDeviceId;
        setMsg(`${fellBack ? 'Default mic' : 'Mic'}: ${micName}`, { warn: false });
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
      let analyser = null;
      let micGain = null;
      if (micStream) {
        const micSrc = ctx.createMediaStreamSource(micStream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        micGain = ctx.createGain();
        micGain.gain.value = S.mic ? 1 : 0;
        micSrc.connect(analyser);
        micSrc.connect(micGain).connect(master);
      }
      const sysTracks = display.getAudioTracks();
      if (sysTracks.length) {
        const sysGain = ctx.createGain();
        sysGain.gain.value = 0.8; // voice of the person teaching stays slightly on top
        ctx.createMediaStreamSource(new MediaStream([sysTracks[0]])).connect(sysGain).connect(master);
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
      };

      // The user closed the shared window / stopped sharing from the OS.
      display.getVideoTracks()[0].addEventListener('ended', () => stop());

      const detector = new window.SilenceDetector({ thresholdDb: S.silenceThresholdDb, timeoutMs: 30000 });
      const now = performance.now();
      detector.reset(now);
      if (!analyser || !S.mic) detector.pause();

      rt = {
        display, micStream, ctx, recorder, audioRecorder, analyser, micGain, detector,
        buf: new Float32Array(1024),
        startedAt: now, pausedAt: 0, pausedTotal: 0, lastSecond: -1,
        timer: setInterval(tick, TICK_MS),
      };
      recorder.start(2000);
      if (audioRecorder) audioRecorder.start(2000);
      setState('recording');
    } catch (err) {
      for (const s of made) s.getTracks().forEach((t) => t.stop());
      const gone = err && (err.name === 'NotFoundError' || err.name === 'NotReadableError' || err.name === 'AbortError');
      if (gone) {
        source = null;
        el.srcName.textContent = STRINGS.chooseScreen;
      }
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
      if (rt.analyser && S.mic) rt.detector.resume(now);
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
    el.meter.style.width = S.mic ? `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%` : '0';

    const r = rt.detector.update(db, now);
    if (r.warning) setMsg(STRINGS.silence, { warn: true });
    else if (r.cleared) setMsg('');
    if (r.notify) window.api.notify(STRINGS.silenceTitle, STRINGS.silence);
  }

  // ---------- wiring ----------

  el.src.addEventListener('click', choose);
  el.rec.addEventListener('click', () => (state === 'idle' ? start() : stop()));
  el.pause.addEventListener('click', togglePause);
  el.mic.addEventListener('click', () => {
    S.mic = !S.mic;
    window.api.setSettings({ mic: S.mic });
    paintToggles();
    if (rt && rt.micGain) {
      rt.micGain.gain.value = S.mic ? 1 : 0;
      if (S.mic && state === 'recording') rt.detector.resume(performance.now());
      else rt.detector.pause();
      if (!S.mic) setMsg('');
    }
  });
  el.micPick.addEventListener('click', chooseMic);
  el.sys.addEventListener('click', () => {
    S.system = !S.system;
    window.api.setSettings({ system: S.system });
    paintToggles();
  });
  el.recover.addEventListener('click', async () => {
    if (await window.api.recoverRun()) el.recover.hidden = true;
  });
  el.close.addEventListener('click', () => {
    if (state === 'idle') return window.api.quit();
    // finish the file first so it gets its "done" marker
    const q = rt.recorder.onstop;
    rt.recorder.onstop = async () => { await q(); window.api.quit(); };
    stop();
  });
  window.api.onToggle(() => (state === 'idle' ? start() : stop()));
  window.api.onSettings((s) => {
    S = state === 'idle' ? { ...S, ...s } : { ...S, ...s, mic: S.mic, system: S.system };
    paintToggles();
  });

  (async () => {
    S = await window.api.settings();
    paintToggles();
    paintMic();
    // A short-lived stream makes the browser reveal device names; keep the list fresh on plug/unplug.
    try {
      (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
    } catch { /* no mic or no permission */ }
    refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    el.srcName.textContent = STRINGS.chooseScreen;
    el.recover.hidden = !(await window.api.recoverCheck());
  })();
})();
