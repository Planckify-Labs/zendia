// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Procedural Web Audio soundscape for Zendia's onboarding.
// Zero external audio files, zero CSP issues, instant response.
//
// Each of the logo's six Voronoi mode cells maps to a note in a warm C-major
// pentatonic scale, synthesized with soft sine/triangle oscillators and subtle
// jelly pitch-bends matching the mascot's spring physics.

const MODE_FREQ = {
  n: 523.25, // C5 — NORMAL (pink)
  i: 587.33, // D5 — INSERT (green)
  v: 659.25, // E5 — VISUAL (purple)
  e: 783.99, // G5 — EXPLORER (blue)
  t: 880.0, // A5 — TOOLBAR (yellow)
  l: 1046.5, // C6 — LIBRARY (teal)
};

// Ascending pentatonic ladder for pinning Essential apps.
const PIN_SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98];

class OnboardingAudio {
  #ctx = null;
  #master = null;
  #muted = false;
  #unlocked = false;

  get muted() {
    return this.#muted;
  }

  setMuted(muted) {
    this.#muted = Boolean(muted);
    if (this.#master && this.#ctx) {
      try {
        const now = this.#ctx.currentTime;
        this.#master.gain.cancelScheduledValues(now);
        this.#master.gain.setTargetAtTime(this.#muted ? 0 : 0.24, now, 0.02);
      } catch {}
    }
  }

  /**
   * Unlock the AudioContext on the first user gesture (pointer or key).
   */
  unlock() {
    if (this.#unlocked) {
      if (this.#ctx?.state === "suspended") {
        this.#ctx.resume().catch(() => {});
      }
      return;
    }
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) {
      return;
    }
    try {
      const ctx = new Ctx();
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 3400;
      filter.Q.value = 0.7;

      const master = ctx.createGain();
      master.gain.value = this.#muted ? 0 : 0.24;

      filter.connect(master);
      master.connect(ctx.destination);

      this.#ctx = ctx;
      this.#master = master;
      this.#filter = filter;
      this.#unlocked = true;
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
    } catch {
      // Headless or restricted audio device: stay silently disabled.
    }
  }

  #filter = null;

  #ready() {
    if (this.#muted) {
      return false;
    }
    if (!this.#ctx) {
      return false;
    }
    if (this.#ctx.state === "suspended") {
      this.#ctx.resume().catch(() => {});
    }
    return this.#ctx.state === "running";
  }

  /**
   * Core velvety note voice with optional jelly pitch glide.
   */
  #tone({
    freq,
    startFreq = freq,
    endFreq = freq,
    delay = 0,
    attack = 0.008,
    duration = 0.24,
    gain = 0.35,
    type = "sine",
    harmonic = 0.14,
  }) {
    if (!this.#ready()) {
      return;
    }
    try {
      const ctx = this.#ctx;
      const now = ctx.currentTime + delay;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(gain, now + attack);
      env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      env.connect(this.#filter);

      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(startFreq, now);
      if (startFreq !== freq) {
        osc.frequency.exponentialRampToValueAtTime(freq * 1.025, now + Math.min(0.055, duration * 0.35));
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + Math.min(0.12, duration * 0.65));
      } else if (endFreq !== freq) {
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
      }
      osc.connect(env);
      osc.start(now);
      osc.stop(now + duration + 0.02);

      // Subtle upper harmonic shimmer for warmth.
      if (harmonic > 0) {
        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(0.0001, now);
        subGain.gain.linearRampToValueAtTime(gain * harmonic, now + attack);
        subGain.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.72);
        subGain.connect(this.#filter);

        const over = ctx.createOscillator();
        over.type = "triangle";
        over.frequency.setValueAtTime(freq * 2, now);
        over.connect(subGain);
        over.start(now);
        over.stop(now + duration * 0.75 + 0.02);
      }
    } catch {}
  }

  /**
   * Tactile soft keycap transient (filtered short burst).
   */
  #tick({ delay = 0, freq = 1400, gain = 0.08, duration = 0.028 } = {}) {
    if (!this.#ready()) {
      return;
    }
    try {
      const ctx = this.#ctx;
      const now = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.42, now + duration);

      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(gain, now + 0.003);
      env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(env);
      env.connect(this.#filter);
      osc.start(now);
      osc.stop(now + duration + 0.01);
    } catch {}
  }

  /** Mascot cell poke / mode morph: soft jelly plop in that mode's pitch. */
  playMode(mode = "n") {
    this.unlock();
    const f = MODE_FREQ[mode] ?? MODE_FREQ.n;
    this.#tone({
      freq: f,
      startFreq: f * 0.84,
      endFreq: f,
      duration: 0.24,
      gain: 0.34,
      harmonic: 0.16,
    });
  }

  /** Start button ("Set up Zendia"): warm 4-note unfolding chord bloom. */
  playStart() {
    this.unlock();
    const chord = [523.25, 659.25, 783.99, 1046.5];
    chord.forEach((f, i) => {
      this.#tone({
        freq: f,
        startFreq: f * 0.96,
        delay: i * 0.055,
        duration: 0.48,
        gain: 0.24 - i * 0.02,
        harmonic: 0.18,
      });
    });
  }

  /** Chapter transition forward or backward. */
  playStep(mode = "n", direction = 1) {
    this.unlock();
    const target = MODE_FREQ[mode] ?? MODE_FREQ.n;
    if (direction >= 0) {
      this.#tone({ freq: target * 0.75, duration: 0.14, gain: 0.18, harmonic: 0.08 });
      this.#tone({
        freq: target,
        startFreq: target * 0.9,
        delay: 0.055,
        duration: 0.26,
        gain: 0.3,
        harmonic: 0.16,
      });
    } else {
      this.#tone({ freq: target * 1.12, duration: 0.13, gain: 0.18, harmonic: 0.06 });
      this.#tone({
        freq: target,
        startFreq: target * 1.05,
        delay: 0.05,
        duration: 0.22,
        gain: 0.24,
        harmonic: 0.1,
      });
    }
  }

  /** Option card selection (rising crisp pop for YES/select, gentler lower tone for NO). */
  playSelect(positive = true) {
    this.unlock();
    this.#tick({ freq: positive ? 1600 : 1050, gain: 0.09 });
    const f = positive ? 659.25 : 440.0;
    this.#tone({
      freq: f,
      startFreq: positive ? f * 0.88 : f * 1.08,
      duration: 0.16,
      gain: 0.24,
      harmonic: 0.12,
    });
  }

  /** Essential app tile pinned or unpinned: playful climbing pentatonic pluck. */
  playAppPin(pinned, count = 1) {
    this.unlock();
    const index = Math.max(0, Math.min(PIN_SCALE.length - 1, count - 1));
    const f = PIN_SCALE[index];
    if (pinned) {
      this.#tick({ freq: 1700, gain: 0.08 });
      this.#tone({
        freq: f,
        startFreq: f * 0.86,
        duration: 0.22,
        gain: 0.28,
        harmonic: 0.2,
      });
    } else {
      this.#tone({
        freq: f * 0.75,
        startFreq: f * 0.85,
        endFreq: f * 0.7,
        duration: 0.15,
        gain: 0.18,
        harmonic: 0.06,
      });
    }
  }

  /** Ultra-subtle keycap tap synced to the live Vim 2D preview beats. */
  playPreviewKey(mode = "n") {
    if (!this.#ready()) {
      return;
    }
    const f = (MODE_FREQ[mode] ?? 523.25) * 1.5;
    this.#tick({ freq: f, gain: 0.045, duration: 0.022 });
  }

  /** Ultra-subtle crystalline shield deflection ping. */
  playDeflect() {
    if (!this.#ready()) {
      return;
    }
    this.#tone({
      freq: 1174.66,
      startFreq: 987.77,
      duration: 0.11,
      gain: 0.075,
      harmonic: 0.1,
    });
  }

  /** Finale ("Start browsing"): warm resolved Lydian chord shimmer. */
  playFinish() {
    this.unlock();
    const chord = [523.25, 659.25, 783.99, 987.77, 1174.66];
    chord.forEach((f, i) => {
      this.#tone({
        freq: f,
        startFreq: f * 0.98,
        delay: i * 0.048,
        duration: 0.68,
        gain: 0.22 - i * 0.018,
        harmonic: 0.22,
      });
    });
  }
}

export const sound = new OnboardingAudio();
