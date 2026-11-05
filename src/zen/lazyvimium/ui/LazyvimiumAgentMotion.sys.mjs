// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Motion for the agent panel: the working ring, the streaming veil and the
// rolling word. The motion and its numbers are ported from zeronsh/zeron
// (MIT License, Copyright (c) 2026 Wing).

const XHTML = "http://www.w3.org/1999/xhtml";
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

// Ring: one run of 3.9 s, then 900 ms of rest, drawn at 30 fps.
const RING_RUN = 3.9;
const RING_REST = 0.9;
const RING_DASHES = 8;
const RING_HALF = 10.95;
const RING_FRAME_MS = 1000 / 30;

// Veil: how fast the first chunk fades, and the smoothing of the arrival gap.
const VEIL_EMA_SEED = 160;
const VEIL_CLASS = "lazyvimium-veil";

// Roll: per glyph duration, how much of it the stagger spreads over, and the
// width glide.
const ROLL_MS = 550;
const ROLL_STAGGER = 0.3;
const ROLL_GLIDE_MS = 200;
const ROLL_EASE = "cubic-bezier(.22,1,.36,1)";
const ROLL_GLIDE_EASE = "cubic-bezier(0,0,.58,1)";
const ROLL_GLYPH_CLASS = "lazyvimium-roll-glyph";
// Anything else (flex, grid, table) would lay the glyph spans out as items.
const ROLL_DISPLAYS = new Set([
  "inline",
  "block",
  "inline-block",
  "flow-root",
  "list-item",
]);
const ROLL_STYLES = [
  "display",
  "position",
  "overflow",
  "white-space",
  "box-sizing",
];

const WORKING_WORDS = [
  "Thinking",
  "Reading",
  "Pondering",
  "Tinkering",
  "Yanking",
  "Sifting",
  "Weaving",
  "Plotting",
  "Composing",
  "Untangling",
  "Distilling",
  "Sketching",
  "Buffering",
  "Hopping",
  "Threading",
  "Musing",
];
const WORD_ROTATE_SECONDS = 7;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Angle folded into [-180, 180).
function wrap180(degrees) {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/**
 * Common prefix and suffix of two strings, counted in code points so an
 * emoji is never cut in half, and never overlapping.
 *
 * @param {string} a
 * @param {string} b
 * @returns {{prefix: number, suffix: number}}
 */
export function sharedEnds(a, b) {
  const left = Array.from(a);
  const right = Array.from(b);
  const shortest = Math.min(left.length, right.length);
  let prefix = 0;
  while (prefix < shortest && left[prefix] === right[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix++;
  }
  return { prefix, suffix };
}

// Common prefix in UTF-16 units, backed off so it never ends inside a pair.
function commonPrefixUnits(a, b) {
  const shortest = Math.min(a.length, b.length);
  let n = 0;
  while (n < shortest && a.charCodeAt(n) === b.charCodeAt(n)) {
    n++;
  }
  if (n > 0 && n < shortest) {
    const code = a.charCodeAt(n - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      n--;
    }
  }
  return n;
}

/**
 * The nine alpha keyframes of the veil, 1 - (1 - p)^1.6 at p = 0, .125 ... 1.
 *
 * @returns {number[]}
 */
export function veilFrames() {
  const frames = [];
  for (let i = 0; i <= 8; i++) {
    frames.push(1 - Math.pow(1 - i / 8, 1.6));
  }
  return frames;
}

// Built once; every veil animation shares it.
const VEIL_KEYFRAMES = veilFrames().map(opacity => ({ opacity }));

/**
 * How long a chunk fades, from the smoothed gap between arrivals.
 *
 * @param {number} ema
 * @returns {number} milliseconds
 */
export function chunkDuration(ema) {
  return clamp(ema * 3, 120, 400);
}

/**
 * Smoothed gap between arrivals; a stall counts as at most a second.
 *
 * @param {number} ema
 * @param {number} gapMs
 * @returns {number}
 */
export function nextEma(ema, gapMs) {
  return ema * 0.7 + Math.min(gapMs, 1000) * 0.3;
}

/**
 * Fades run faster when several pile up behind a fast stream.
 *
 * @param {number} activeChunks
 * @returns {number}
 */
export function veilSpeed(activeChunks) {
  return activeChunks >= 3 ? 1 + 0.3 * (activeChunks - 2) : 1;
}

/**
 * The eight dashes of the working ring at a time inside the run. A lead laps
 * the ring twice; dashes near it lean toward it and stretch, and `glow` (0 to
 * 1) says how much, for brightening. Outside the run the dashes rest evenly.
 *
 * @param {number} ph seconds into the 3.9 s run
 * @returns {{centre: number, half: number, glow: number}[]} degrees
 */
export function ringDashes(ph) {
  const dashes = [];
  const running = ph > 0 && ph < RING_RUN;
  const tau = running ? ph / RING_RUN : 0;
  const lead = 720 * (0.5 - 0.5 * Math.cos(Math.PI * tau));
  const speed = Math.sin(Math.PI * tau);
  const amp = running
    ? smoothstep(0, 0.55, ph) * (1 - smoothstep(RING_RUN - 0.75, RING_RUN, ph))
    : 0;
  const pull = lead - 14 * speed;
  for (let i = 0; i < RING_DASHES; i++) {
    const centre = (360 / RING_DASHES) * i;
    const dl = wrap180(pull - centre);
    const sigma = dl < 0 ? 26 : 40;
    const glow = amp * Math.exp((-dl * dl) / (sigma * sigma));
    dashes.push({
      centre: centre + Math.sign(dl) * 9 * glow,
      half: RING_HALF * (1 + 1.3 * glow),
      glow,
    });
  }
  return dashes;
}

/**
 * A stable number for a piece of text, so a row keeps its word.
 *
 * @param {string} text
 * @returns {number}
 */
export function seedOf(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    n = (n * 31 + text.charCodeAt(i)) % 9973;
  }
  return n;
}

/**
 * The word shown while working; it changes every 7 seconds.
 *
 * @param {number} seed
 * @param {number} seconds
 * @returns {string} the word with a trailing ellipsis
 */
export function workingWord(seed, seconds) {
  const step = Math.floor(Math.max(seconds, 0) / WORD_ROTATE_SECONDS);
  return WORKING_WORDS[(seed + step) % WORKING_WORDS.length] + "…";
}

/**
 * @param {Window} window
 * @returns {boolean}
 */
export function reducedMotion(window) {
  return window.matchMedia(REDUCED_QUERY).matches;
}

// element -> { roll } once rollText has seen it; roll is the one in flight.
const rollStates = new WeakMap();

function setPlain(element, text) {
  if (element.textContent !== text) {
    element.textContent = text;
  }
  element.dataset.rollText = text;
}

// Drop everything a roll added and leave one plain text node.
function endRoll(element, state) {
  const roll = state.roll;
  state.roll = null;
  for (const animation of roll.animations) {
    animation.cancel();
  }
  for (const [prop, value] of roll.saved) {
    if (value) {
      element.style.setProperty(prop, value);
    } else {
      element.style.removeProperty(prop);
    }
  }
  element.replaceChildren(element.ownerDocument.createTextNode(roll.target));
  element.dataset.rollText = roll.target;
}

/**
 * Set an element's text. A change rolls only the middle that differs, glyph
 * by glyph; the shared head and tail stay still. At rest the element holds one
 * plain text node. `dataset.rollText` always has the logical text, because
 * textContent holds extra glyphs mid-roll.
 *
 * @param {Element} element
 * @param {string} text
 */
export function rollText(element, text) {
  text = String(text ?? "");
  let state = rollStates.get(element);
  if (!state) {
    state = { roll: null };
    rollStates.set(element, state);
    setPlain(element, text);
    return;
  }

  // A roll still running is cancelled; the next one starts from where its
  // text was heading, and the width from where it is drawn now.
  let old = element.textContent;
  let startWidth = null;
  if (state.roll) {
    startWidth = element.getBoundingClientRect().width;
    old = state.roll.target;
    endRoll(element, state);
  }

  const win = element.documentGlobal;
  if (
    !old ||
    old === text ||
    !element.isConnected ||
    element.childNodes.length !== 1 ||
    element.firstChild.nodeType !== 3 ||
    reducedMotion(win)
  ) {
    setPlain(element, text);
    return;
  }
  const computed = win.getComputedStyle(element);
  if (!ROLL_DISPLAYS.has(computed.display)) {
    setPlain(element, text);
    return;
  }

  const doc = element.ownerDocument;
  const oldGlyphs = Array.from(old);
  const newGlyphs = Array.from(text);
  const { prefix, suffix } = sharedEnds(old, text);
  const oldMiddle = oldGlyphs.slice(prefix, oldGlyphs.length - suffix);
  const newMiddle = newGlyphs.slice(prefix, newGlyphs.length - suffix);

  // Every measurement happens before the first write, so it costs one layout.
  const box = element.getBoundingClientRect();
  const oldWidth = startWidth ?? box.width;
  const textNode = element.firstChild;
  const range = doc.createRange();
  let unit = oldGlyphs.slice(0, prefix).join("").length;
  const leaving = [];
  for (const glyph of oldMiddle) {
    if (/\S/.test(glyph)) {
      range.setStart(textNode, unit);
      range.setEnd(textNode, unit + glyph.length);
      const rect = range.getBoundingClientRect();
      leaving.push({
        glyph,
        x: rect.left - box.left - element.clientLeft,
        y: rect.top - box.top - element.clientTop,
      });
    }
    unit += glyph.length;
  }

  const saved = ROLL_STYLES.map(prop => [
    prop,
    element.style.getPropertyValue(prop),
  ]);
  element.style.overflow = "clip";
  element.style.whiteSpace = "pre";
  element.style.boxSizing = "border-box";
  if (computed.display === "inline") {
    element.style.display = "inline-block";
  }
  if (computed.position === "static") {
    element.style.position = "relative";
  }

  const arriving = newMiddle.map(glyph => {
    const span = doc.createElementNS(XHTML, "span");
    span.className = ROLL_GLYPH_CLASS;
    span.style.display = "inline-block";
    span.style.whiteSpace = "pre";
    span.textContent = glyph;
    return span;
  });
  const gone = leaving.map(({ glyph, x, y }) => {
    const span = doc.createElementNS(XHTML, "span");
    span.className = ROLL_GLYPH_CLASS;
    span.setAttribute("aria-hidden", "true");
    span.style.position = "absolute";
    span.style.left = x + "px";
    span.style.top = y + "px";
    span.style.whiteSpace = "pre";
    span.style.pointerEvents = "none";
    span.textContent = glyph;
    return span;
  });
  const head = newGlyphs.slice(0, prefix).join("");
  const tail = newGlyphs.slice(newGlyphs.length - suffix).join("");
  element.replaceChildren(
    ...(head ? [doc.createTextNode(head)] : []),
    ...arriving,
    ...(tail ? [doc.createTextNode(tail)] : []),
    ...gone
  );

  const animations = [];
  const stagger = (i, count) => (ROLL_MS * ROLL_STAGGER * i) / count;
  const timing = (i, count) => ({
    duration: ROLL_MS,
    delay: stagger(i, count),
    easing: ROLL_EASE,
    fill: "both",
  });
  arriving.forEach((span, i) => {
    animations.push(
      span.animate(
        [
          {
            opacity: 0,
            transform: "translateY(.35em) scale(.6) rotate(2deg)",
            filter: "blur(.1em)",
          },
          {
            opacity: 1,
            transform: "translateY(0) scale(1) rotate(0deg)",
            filter: "blur(0)",
          },
        ],
        timing(i, arriving.length)
      )
    );
  });
  gone.forEach((span, i) => {
    animations.push(
      span.animate(
        [
          {
            opacity: 1,
            transform: "translateY(0) scale(1) rotate(0deg)",
            filter: "blur(0)",
          },
          {
            opacity: 0,
            transform: "translateY(-.35em) scale(.6) rotate(-2deg)",
            filter: "blur(.1em)",
          },
        ],
        timing(i, gone.length)
      )
    );
  });
  const newWidth = element.getBoundingClientRect().width;
  if (Math.abs(newWidth - oldWidth) > 0.5) {
    animations.push(
      element.animate(
        [{ width: oldWidth + "px" }, { width: newWidth + "px" }],
        { duration: ROLL_GLIDE_MS, easing: ROLL_GLIDE_EASE, fill: "both" }
      )
    );
  }

  const roll = { animations, saved, target: text };
  state.roll = roll;
  element.dataset.rollText = text;
  // A cancelled animation settles too; the check keeps a newer roll alive.
  Promise.allSettled(animations.map(animation => animation.finished)).then(
    () => {
      if (state.roll === roll) {
        endRoll(element, state);
      }
    }
  );
}

/**
 * The working indicator: eight dashes that a lead laps twice around the ring,
 * then a rest. A canvas, painted in the element's CSS `color`.
 */
export class WorkingRing {
  #window;
  #size;
  #canvas;
  #context;
  #reduced;
  #observer = null;
  #running = false;
  #visible = false;
  #raf = 0;
  #origin = -1;
  #lastDraw = -Infinity;
  #restDrawn = false;
  #ink = null;
  #inkKey = "";
  #dpr = 0;

  /**
   * @param {Window} window
   * @param {object} [options]
   * @param {number} [options.size] CSS pixels
   */
  constructor(window, { size = 16 } = {}) {
    this.#window = window;
    this.#size = size;
    this.#reduced = window.matchMedia(REDUCED_QUERY);
    const canvas = window.document.createElementNS(XHTML, "canvas");
    canvas.className = "lazyvimium-working-ring";
    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    canvas.style.flexShrink = "0";
    this.#canvas = canvas;
    this.#fit();
    this.#draw(0);
  }

  get element() {
    return this.#canvas;
  }

  start() {
    if (this.#running) {
      return;
    }
    this.#running = true;
    this.#fit();
    this.#origin = -1;
    this.#lastDraw = -Infinity;
    this.#restDrawn = false;
    this.#readInk();
    this.#draw(0);
    if (this.#reduced.matches) {
      return;
    }
    this.#visible = this.#canvas.isConnected;
    // A canvas that is detached or scrolled away needs no frames.
    this.#observer = new this.#window.IntersectionObserver(entries => {
      this.#visible = entries[entries.length - 1].isIntersecting;
      this.#schedule();
    });
    this.#observer.observe(this.#canvas);
    this.#schedule();
  }

  stop() {
    this.#running = false;
    this.#observer?.disconnect();
    this.#observer = null;
    if (this.#raf) {
      this.#window.cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    }
  }

  destroy() {
    this.stop();
    this.#canvas.remove();
  }

  // The backing store follows devicePixelRatio, the layout size does not.
  #fit() {
    const dpr = this.#window.devicePixelRatio || 1;
    if (dpr === this.#dpr) {
      return;
    }
    this.#dpr = dpr;
    this.#canvas.width = Math.round(this.#size * dpr);
    this.#canvas.height = Math.round(this.#size * dpr);
    this.#context = this.#canvas.getContext("2d");
  }

  #schedule() {
    if (this.#running && this.#visible && !this.#raf) {
      this.#raf = this.#window.requestAnimationFrame(this.#frame);
    }
  }

  #frame = timestamp => {
    this.#raf = 0;
    if (!this.#running || !this.#visible) {
      return;
    }
    this.#raf = this.#window.requestAnimationFrame(this.#frame);
    if (timestamp - this.#lastDraw < RING_FRAME_MS - 4) {
      return;
    }
    this.#lastDraw = timestamp;
    if (this.#origin < 0) {
      this.#origin = timestamp;
    }
    const t = ((timestamp - this.#origin) / 1000) % (RING_RUN + RING_REST);
    if (t >= RING_RUN) {
      // The rest is a still picture; paint it once.
      if (!this.#restDrawn) {
        this.#restDrawn = true;
        this.#draw(RING_RUN);
      }
      return;
    }
    if (this.#restDrawn) {
      // A new run: pick up a tint that a stylesheet may have changed.
      this.#readInk();
      this.#restDrawn = false;
    }
    this.#draw(t);
  };

  #readInk() {
    const color = this.#window.getComputedStyle(this.#canvas).color;
    if (!color || color === this.#inkKey) {
      return;
    }
    this.#inkKey = color;
    const parts = color.startsWith("rgb") ? color.match(/[\d.]+/g) : null;
    this.#ink =
      parts && parts.length >= 3
        ? {
            rgb: parts.slice(0, 3).map(Number),
            alpha: parts.length > 3 ? Number(parts[3]) : 1,
          }
        : null;
  }

  // Stretched dashes brighten by up to 60%, toward white on a light ink and
  // toward black on a dark one.
  #stroke(glow) {
    if (!this.#ink) {
      return this.#inkKey || "rgb(128, 128, 128)";
    }
    const { rgb, alpha } = this.#ink;
    const luminance =
      (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    const target = luminance > 0.5 ? 255 : 0;
    const t = 0.6 * glow;
    const [r, g, b] = rgb.map(c => Math.round(c + (target - c) * t));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  #draw(ph) {
    const ctx = this.#context;
    if (!ctx) {
      return;
    }
    const size = this.#size;
    // The shader's 24 unit grid: radius 10, stroke 2.
    const unit = size / 24;
    const radius = 10 * unit;
    const capDegrees = (unit / radius) * (180 / Math.PI);
    ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.lineWidth = 2 * unit;
    ctx.lineCap = "round";
    const rad = degrees => (degrees * Math.PI) / 180 - Math.PI / 2;
    for (const dash of ringDashes(ph)) {
      // The half angle counts the round caps, so the arc itself is shorter.
      const half = Math.max(dash.half - capDegrees, 0.01);
      ctx.strokeStyle = this.#stroke(dash.glow);
      ctx.beginPath();
      ctx.arc(
        size / 2,
        size / 2,
        radius,
        rad(dash.centre - half),
        rad(dash.centre + half)
      );
      ctx.stroke();
    }
  }
}

function unwrap(span) {
  veilAnimations.get(span)?.cancel();
  veilAnimations.delete(span);
  if (span.parentNode) {
    span.replaceWith(...span.childNodes);
  }
}

// span -> its animation, so nothing has to ask the document for animations.
const veilAnimations = new WeakMap();

// The row's text outside buttons, and the nodes it comes from, in order.
function collectText(row) {
  const walker = row.ownerDocument.createTreeWalker(row, 4 /* SHOW_TEXT */);
  const nodes = [];
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("button")) {
      continue;
    }
    nodes.push(node);
    text += node.data;
  }
  return { nodes, text };
}

/**
 * Fades newly streamed text in. The dock re-renders a row's markdown on every
 * change, which replaces its children, so nothing in the DOM survives. Call
 * `update` right after each render: the veil keeps the text it saw and the
 * chunks still fading per row, and puts the fades back on the new nodes at
 * the point they had reached.
 */
export class Veil {
  #window;
  #reduced;
  #rows = new WeakMap();

  /** @param {Window} window */
  constructor(window) {
    this.#window = window;
    this.#reduced = window.matchMedia(REDUCED_QUERY);
  }

  /**
   * @param {Element} row freshly rendered
   * @param {object} [options]
   * @param {boolean} [options.baseline] record the text without fading it
   */
  update(row, { baseline = false } = {}) {
    const state = this.#rows.get(row);
    if (state) {
      // A repeat update without a render: take the old wrappers off first.
      for (const span of state.spans) {
        unwrap(span);
      }
      state.spans = [];
    }
    const { nodes, text } = collectText(row);
    const now = this.#window.performance.now();
    if (!state || baseline || this.#reduced.matches) {
      // Text already on screen must never dissolve.
      this.#rows.set(row, {
        text,
        chunks: [],
        spans: [],
        ema: VEIL_EMA_SEED,
        lastChunk: null,
        speed: 1,
        synced: now,
      });
      return;
    }

    // Fade time moves at the speed chosen at the last update.
    const dt = now - state.synced;
    const common = commonPrefixUnits(state.text, text);
    let chunks = [];
    for (const chunk of state.chunks) {
      chunk.elapsed += dt * state.speed;
      // A rewrite keeps the fades of the prefix and drops the rest.
      if (chunk.start < common) {
        chunk.end = Math.min(chunk.end, common);
        chunks.push(chunk);
      }
    }
    if (text.length > common) {
      if (state.lastChunk !== null) {
        state.ema = nextEma(state.ema, now - state.lastChunk);
      }
      state.lastChunk = now;
      chunks.push({
        start: common,
        end: text.length,
        born: now,
        duration: chunkDuration(state.ema),
        elapsed: 0,
      });
    }
    chunks = chunks.filter(chunk => chunk.elapsed < chunk.duration);
    state.text = text;
    state.chunks = chunks;
    state.speed = veilSpeed(chunks.length);
    state.synced = now;
    if (chunks.length) {
      state.spans = this.#wrap(nodes, chunks, state.speed);
    }
  }

  /** @param {Element} row */
  clear(row) {
    this.#rows.delete(row);
    const spans = row.querySelectorAll("span." + VEIL_CLASS);
    for (const span of spans) {
      unwrap(span);
    }
    if (spans.length) {
      row.normalize();
    }
  }

  // Put each chunk's range in a span with the fade at its current point.
  #wrap(nodes, chunks, speed) {
    const doc = nodes[0]?.ownerDocument;
    const spans = [];
    let position = 0;
    let first = 0;
    for (const node of nodes) {
      const length = node.data.length;
      const end = position + length;
      while (first < chunks.length && chunks[first].end <= position) {
        first++;
      }
      const hits = [];
      for (let k = first; k < chunks.length && chunks[k].start < end; k++) {
        hits.push(chunks[k]);
      }
      // Whitespace between blocks has nothing to fade and no place for a span.
      if (hits.length && /\S/.test(node.data)) {
        // Last range first, so the offsets of the earlier ones hold.
        for (let k = hits.length - 1; k >= 0; k--) {
          const chunk = hits[k];
          const from = Math.max(chunk.start, position) - position;
          const to = Math.min(chunk.end, end) - position;
          if (to < node.length) {
            node.splitText(to);
          }
          const piece = from > 0 ? node.splitText(from) : node;
          const span = doc.createElementNS(XHTML, "span");
          span.className = VEIL_CLASS;
          piece.replaceWith(span);
          span.append(piece);
          const animation = span.animate(VEIL_KEYFRAMES, {
            duration: chunk.duration,
            easing: "linear",
            fill: "both",
          });
          animation.playbackRate = speed;
          animation.currentTime = chunk.elapsed;
          animation.onfinish = () => unwrap(span);
          veilAnimations.set(span, animation);
          spans.push(span);
        }
      }
      position = end;
    }
    return spans;
  }
}
