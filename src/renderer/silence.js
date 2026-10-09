'use strict';
// Detects "nobody is talking": level stays under a threshold for timeoutMs.
// Pure logic (time is passed in) so it can be unit-tested without a browser.

class SilenceDetector {
  constructor({ thresholdDb = -50, timeoutMs = 15000 } = {}) {
    this.thresholdDb = thresholdDb;
    this.timeoutMs = timeoutMs;
    this.reset(0);
  }

  reset(now) {
    this.lastSound = now;
    this.lastNotify = null;
    this.warning = false;
    this.paused = false;
  }

  pause() {
    this.paused = true;
    this.warning = false;
    this.lastNotify = null;
  }

  resume(now) {
    this.reset(now);
  }

  // Returns { warning, notify, cleared }.
  //  warning: show the warning now
  //  notify:  raise a notification (on first warning, then once per timeout)
  //  cleared: sound came back after a warning
  update(levelDb, now) {
    if (this.paused) return { warning: false, notify: false, cleared: false };

    if (levelDb > this.thresholdDb) {
      const cleared = this.warning;
      this.lastSound = now;
      this.lastNotify = null;
      this.warning = false;
      return { warning: false, notify: false, cleared };
    }

    if (now - this.lastSound < this.timeoutMs) {
      return { warning: false, notify: false, cleared: false };
    }

    this.warning = true;
    const notify = this.lastNotify === null || now - this.lastNotify >= this.timeoutMs;
    if (notify) this.lastNotify = now;
    return { warning: true, notify, cleared: false };
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { SilenceDetector };
else window.SilenceDetector = SilenceDetector;
