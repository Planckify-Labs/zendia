// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// How the agent panel's conversation scrolls, ported from Zeron's transcript
// (zeronsh/zeron, MIT, Copyright (c) 2026 Wing).
//
// A sent request glides to the top of the view and the space under it is
// held open, so the answer grows into that room and nothing scrolls line by
// line. An answer longer than the view is followed by a spring that stays a
// little above the end, so the newest line is not pressed against the edge.
// Scrolling up lets go of all of it.

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  reducedMotion:
    "resource:///modules/lazyvimium/ui/LazyvimiumAgentMotion.sys.mjs",
});

const GLIDE_MS = 380;
// Within this of the end, scrolling back down picks the end up again.
const STICK_PX = 70;
// The jump button shows beyond the first and hides only within the second,
// so it does not flicker during a gesture.
const JUMP_SHOW_PX = 320;
const JUMP_HIDE_PX = 2;
const JUMP_DELAY_MS = 150;
// The spring, per 60 fps frame.
const DAMPING = 0.7;
const STIFFNESS = 0.05;
const MASS = 1.25;
const FRAME_MS = 1000 / 60;
const MAX_FRAMES = 8;
const GROWTH_SMOOTHING = 0.12;
// How far above the end it chases, for each frame of growth, and at most.
const LEAD_FRAMES = 9;
const MAX_LEAD_PX = 32;

/**
 * @param {number} t From 0 to 1.
 * @returns {number} Eased out, as cubic-bezier(.5, 1, .89, 1).
 */
function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

/**
 * One step of the follow spring.
 *
 * @param {{position: number, velocity: number, growth: number}} state
 * @param {number} target The scroll position of the end.
 * @param {number} frames How many 60 fps frames passed, at most 1 per call.
 * @returns {{position: number, velocity: number, growth: number}}
 */
export function followStep({ position, velocity, growth }, target, frames) {
  const chase = target - Math.min(growth * LEAD_FRAMES, MAX_LEAD_PX);
  const distance = Math.max(chase - position, 0);
  const next =
    velocity +
    frames * ((DAMPING * velocity + STIFFNESS * distance) / MASS - velocity);
  return {
    position: Math.min(position + (next + growth) * frames, target),
    velocity: next,
    growth,
  };
}

/**
 * The room to hold open under a request so that it can rest at the top.
 *
 * @param {number} view The height the conversation shows.
 * @param {number} content From the request's top to the end of what is under
 *   it.
 * @param {number} lane The room that is always kept at the end.
 * @returns {number}
 */
export function runwayHeight(view, content, lane) {
  return Math.max(lane, view - content + lane);
}

export class LazyvimiumAgentFollow {
  #window;
  #log;
  #foot;
  #lane;
  #onJump;
  // "end" follows the end, "held" keeps the request at the top, "free" is
  // wherever the reader went.
  #mode = "end";
  #prompt = null;
  // How tall the request and its answer were when last measured.
  #heldContent = 0;
  #gliding = false;
  #glideFrame = 0;
  #springFrame = 0;
  #position = 0;
  #velocity = 0;
  #growth = 0;
  #lastTarget = 0;
  #lastFrame = 0;
  #written = 0;
  // Where the last scroll event left it, to tell which way it went.
  #lastTop = 0;
  #jumpShown = false;
  #jumpTimer = null;

  /**
   * @param {Window} window
   * @param {Element} log What scrolls.
   * @param {object} options
   * @param {Element} options.foot The last child of the log; its height is
   *   the room held open.
   * @param {number} options.lane The foot's height at rest.
   * @param {(shown: boolean) => void} options.onJump The jump button should
   *   show or hide.
   */
  constructor(window, log, { foot, lane, onJump }) {
    this.#window = window;
    this.#log = log;
    this.#foot = foot;
    this.#lane = lane;
    this.#onJump = onJump;
    log.addEventListener("wheel", event => this.#onWheel(event), {
      passive: true,
    });
    log.addEventListener("scroll", () => this.#onScroll());
  }

  get #end() {
    return Math.max(0, this.#log.scrollHeight - this.#log.clientHeight);
  }

  get #away() {
    return this.#end - this.#log.scrollTop;
  }

  // The request's resting place: the log's own padding above it.
  get #promptTop() {
    const padding = parseFloat(
      this.#window.getComputedStyle(this.#log).paddingTop
    );
    return Math.max(0, this.#prompt.offsetTop - padding);
  }

  #write(position) {
    this.#written = position;
    this.#log.scrollTop = position;
  }

  /**
   * A request was just added: bring it to the top and hold the room under
   * it. Call once its row is in the log.
   *
   * @param {Element} prompt
   */
  sent(prompt) {
    this.#stopSpring();
    this.#cancelGlide();
    this.#prompt = prompt;
    this.#mode = "held";
    this.#heldContent = 0;
    this.#hold();
    const from = this.#log.scrollTop;
    const to = this.#promptTop;
    if (lazy.reducedMotion(this.#window) || Math.abs(to - from) < 1) {
      this.#write(to);
      return;
    }
    const window = this.#window;
    const started = window.performance.now();
    this.#gliding = true;
    const glide = now => {
      const t = Math.min(1, (now - started) / GLIDE_MS);
      // Measured each frame: the answer may arrive during the glide.
      this.#write(from + (this.#promptTop - from) * easeOutQuad(t));
      if (t < 1) {
        this.#glideFrame = window.requestAnimationFrame(glide);
        return;
      }
      this.#gliding = false;
      // An answer may have outgrown the view on the way up.
      this.update();
    };
    this.#glideFrame = window.requestAnimationFrame(glide);
  }

  // Size the room under the request. An answer that outgrows the view stops
  // needing it: one streaming in is followed to its end, but one that landed
  // whole stays put, to be read from its start. #prompt stays set, as a glide
  // may still be on its way to it.
  #hold() {
    const log = this.#log;
    const content = this.#foot.offsetTop - this.#prompt.offsetTop;
    const padding = parseFloat(this.#window.getComputedStyle(log).paddingTop);
    const view = log.clientHeight - padding * 2;
    const room = runwayHeight(view, content, this.#lane);
    const landedWhole = content - this.#heldContent > view / 2;
    this.#heldContent = content;
    this.#foot.style.minHeight = `${room}px`;
    if (room <= this.#lane) {
      this.#foot.style.minHeight = "";
      this.#mode = landedWhole ? "free" : "end";
    }
  }

  /**
   * The content changed: call after each redraw of the log.
   */
  update() {
    if (this.#mode == "held") {
      this.#hold();
    }
    if (this.#mode == "end" && !this.#gliding) {
      this.#startSpring();
    }
    this.#syncJump();
  }

  /**
   * The turn ended: what was held for the answer is no longer needed once
   * it is out of view, and it never moves what is on screen.
   */
  release() {
    if (this.#mode == "held") {
      return;
    }
    this.#foot.style.minHeight = "";
  }

  /**
   * Show the end now, for another conversation or the jump button.
   *
   * @param {object} [options]
   * @param {boolean} [options.smooth]
   */
  toEnd({ smooth = false } = {}) {
    this.#cancelGlide();
    this.#prompt = null;
    this.#mode = "end";
    this.#foot.style.minHeight = "";
    if (smooth && !lazy.reducedMotion(this.#window)) {
      this.#startSpring();
    } else {
      this.#stopSpring();
      this.#write(this.#end);
    }
    this.#syncJump();
  }

  #cancelGlide() {
    this.#gliding = false;
    this.#window.cancelAnimationFrame(this.#glideFrame);
  }

  #letGo() {
    this.#cancelGlide();
    this.#stopSpring();
    this.#mode = "free";
    this.#prompt = null;
  }

  #onWheel(event) {
    if (event.deltaY < 0) {
      this.#letGo();
      this.#syncJump();
    }
  }

  #onScroll() {
    const top = this.#log.scrollTop;
    const movedDown = top > this.#lastTop;
    this.#lastTop = top;
    // Up by anything but this code: the scrollbar or a key.
    if (this.#mode != "free" && !this.#gliding && top < this.#written - 2) {
      if (this.#away > STICK_PX) {
        this.#letGo();
      }
    } else if (this.#mode == "free" && movedDown && this.#away <= STICK_PX) {
      // Only on the way down: a small step up also ends near the end, and
      // taking that for a return would pull the reader straight back.
      this.#mode = "end";
      this.#foot.style.minHeight = "";
      this.#startSpring();
    }
    this.#syncJump();
  }

  #startSpring() {
    const log = this.#log;
    const target = this.#end;
    if (this.#springFrame) {
      return;
    }
    if (Math.abs(target - log.scrollTop) < 0.5) {
      this.#written = log.scrollTop;
      this.#lastTarget = target;
      return;
    }
    if (lazy.reducedMotion(this.#window)) {
      this.#write(target);
      return;
    }
    this.#position = log.scrollTop;
    this.#lastFrame = this.#window.performance.now();
    this.#lastTarget = target;
    this.#springFrame = this.#window.requestAnimationFrame(now =>
      this.#springTick(now)
    );
  }

  #stopSpring() {
    this.#window.cancelAnimationFrame(this.#springFrame);
    this.#springFrame = 0;
    this.#velocity = 0;
    this.#growth = 0;
  }

  #springTick(now) {
    this.#springFrame = 0;
    const target = this.#end;
    const frames = Math.min(
      MAX_FRAMES,
      Math.max(1, (now - this.#lastFrame) / FRAME_MS)
    );
    this.#lastFrame = now;
    const grown = target - this.#lastTarget;
    this.#lastTarget = target;
    this.#growth =
      grown < -1
        ? 0
        : this.#growth +
          GROWTH_SMOOTHING * (Math.max(grown, 0) / frames - this.#growth);
    let state = {
      position: this.#position,
      velocity: this.#velocity,
      growth: this.#growth,
    };
    for (let left = frames; left > 0; left -= 1) {
      state = followStep(state, target, Math.min(1, left));
    }
    this.#position = state.position;
    this.#velocity = state.velocity;
    if (target - state.position < 0.5 && this.#growth < 0.05) {
      this.#write(target);
      this.#stopSpring();
      return;
    }
    this.#write(state.position);
    this.#springFrame = this.#window.requestAnimationFrame(next =>
      this.#springTick(next)
    );
  }

  #syncJump() {
    const window = this.#window;
    const away = this.#away;
    const free = this.#mode == "free";
    if (this.#jumpShown) {
      if (!free || away <= JUMP_HIDE_PX) {
        window.clearTimeout(this.#jumpTimer);
        this.#jumpTimer = null;
        this.#jumpShown = false;
        this.#onJump(false);
      }
    } else if (free && away > JUMP_SHOW_PX && !this.#jumpTimer) {
      this.#jumpTimer = window.setTimeout(() => {
        this.#jumpTimer = null;
        if (this.#mode == "free" && this.#away > JUMP_SHOW_PX) {
          this.#jumpShown = true;
          this.#onJump(true);
        }
      }, JUMP_DELAY_MS);
    }
  }
}
