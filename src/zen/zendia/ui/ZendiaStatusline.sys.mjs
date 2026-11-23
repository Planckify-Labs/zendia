// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import {
  MASCOT_COLORS,
  MASCOT_EDGE,
  MASCOT_FACE,
  MASCOT_MODES,
  MASCOT_MORPH_MS,
  MASCOT_VIEWBOX,
  mascotFrame,
  mixColor,
} from "resource:///modules/zendia/ui/ZendiaMascot.sys.mjs";
import { ZendiaTheme } from "resource:///modules/zendia/ui/ZendiaTheme.sys.mjs";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";

// The mode colors are the theme's mode-<key> roles, in their dark variant:
// the mascot is as bright in both of Zen's themes.
const MODES = {
  n: "NORMAL",
  i: "INSERT",
  v: "VISUAL",
  e: "EXPLORER",
  t: "TOOLBAR",
  l: "LIBRARY",
  w: "WINDOW",
};

// Zendia's own panels and popups. The indicator keeps clear of any of them
// that shows, wherever it is and however wide it has been made.
const ZENDIA_SURFACES = [
  "#zendia-agents-dock",
  "#zendia-agent-dock",
  "#zendia-webchat-dock",
  ".zendia-picker",
  "#zendia-which-key",
  "#zendia-model-card",
  "#zendia-explorer-focus",
  "#zendia-toolbar-focus",
  "#zendia-library-focus",
].join(", ");
// How far it keeps from a panel and from the page's edges, and how finely it
// looks for a place, in pixels.
const CLEARANCE = 12;
const SEARCH_STEP = 8;
// After a change it looks again once the panels' slide in or out is over.
const SETTLE_MS = 420;

// How long a switch from one mode to another takes, in milliseconds.
const MORPH_MS = MASCOT_MORPH_MS;

// When it shows. After a change it stays up this long, then rests: shrunk to
// a small badge in its corner ("shrink", the default), gone ("change"), or,
// with "always", up all along, though shrunk in a window narrower than
// SMALL_WINDOW. While the page scrolls it ducks out of sight, back this long
// after the scrolling stops. The pointer this near raises it.
const ACTIVE_MS = 2000;
const SCROLL_SETTLE_MS = 500;
const NEAR_PX = 64;
const REST_SCALE = 0.4;
const SMALL_WINDOW = 700;
export const STATUSLINE_SHOW = ["shrink", "always", "change"];

/**
 * A spring with a little jelly in it: pulled toward `target` by `k`, slowed
 * by `c`.
 *
 * @param {number} x
 * @param {number} k
 * @param {number} c
 */
function jelly(x, k, c) {
  return { x, v: 0, target: x, k, c };
}

const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
const middleOf = points =>
  points.reduce(
    ([x, y], [px, py]) => [x + px / points.length, y + py / points.length],
    [0, 0]
  );
const areaOf = points =>
  Math.abs(
    points.reduce((sum, [x, y], i) => {
      const [nx, ny] = points[(i + 1) % points.length];
      return sum + x * ny - nx * y;
    }, 0)
  ) / 2;

function rgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}

/**
 * The mode indicator in a browser window: the mode of the selected tab's
 * page and whatever has been typed towards a mapping. The mode is shown by
 * Zendia's mascot (ZendiaMascot.sys.mjs) among its six mode cells, with the
 * mode's cell in the lead, the mode's color and pose, and the mode's letter.
 * A switch morphs it into the next mode's drawing, and now and then it blinks.
 *
 * It is up, full size, for a while after a change (a mode, a tab, the window
 * coming back), while a mapping is half typed and while the pointer is near.
 * Then it rests, as the "zendia.statusline.show" pref says, and it ducks out
 * of sight while the page scrolls and while a video plays fullscreen. Its
 * "presence" attribute says which: active, resting, tucked or gone. It comes
 * together cell by cell and comes apart the same way, and grows and shrinks
 * one cell after another, each at its own pace, like living cells.
 */
export class ZendiaStatusline {
  #element;
  #keys;
  #mascot;
  // The parts of the mascot's drawing that move: the six cells, the head and
  // antenna, the ink edge under them, the eyes and the mode's letter.
  #parts;
  #drawn;
  // The mode the mascot is in (or on its way to), and its body's color.
  #shown = "n";
  #shownColor = MASCOT_COLORS.n;
  #morph = null;
  #blinkTimer = null;
  // The first drawing is put down at once; later ones morph.
  #painted = false;
  // Where the pointer came onto it, kept clear until the pointer leaves, or null.
  #pointerZone = null;
  // How far it stands from its corner, to keep clear of the pointer and panels.
  #offset = { x: 0, y: 0 };
  #placeQueued = false;
  #settleTimer = null;
  #mutations;
  #resizes;
  #root;
  #window;
  #color;
  // Whether vim mode shows it at all, and how it rests (STATUSLINE_SHOW).
  #visible = false;
  #show = "shrink";
  // What keeps it up: a recent change, a half typed mapping, the pointer near,
  // and what puts it away: the page scrolling.
  #activeUntil = 0;
  #restTimer = null;
  #typing = false;
  #near = false;
  #scrolling = false;
  #scrollTimer = null;
  #announcer;
  // Its jelly: how far each part has popped in, each part's size, and the
  // size of the whole. It starts popped out, and comes together when shown.
  #out = true;
  #restSize = 1;
  #presence = {
    head: jelly(0, 560, 20),
    cells: MASCOT_MODES.map(() => jelly(0, 500, 18)),
    letter: jelly(0, 600, 21),
  };
  #sizes = {
    whole: jelly(1, 300, 31),
    head: jelly(1, 320, 21),
    cells: MASCOT_MODES.map(() => jelly(1, 320, 21)),
  };
  // Where each part's middle is and how big each cell is, from the drawing.
  #middles = {
    cells: MASCOT_MODES.map(() => [512, 512]),
    head: [512, 512],
    letter: [512, 512],
  };
  #areas = MASCOT_MODES.map(() => 1);
  #springFrame = null;
  #fullscreen;
  #popTimers = [];
  #resizeTimers = [];

  /**
   * @param {Window} window A browser window.
   */
  constructor(window) {
    const document = window.document;
    this.#window = window;
    this.#root = document.documentElement;
    const create = (tag, className) => {
      const element = document.createElementNS(HTML_NS, tag);
      element.className = className;
      return element;
    };
    this.#element = document.createElementNS(HTML_NS, "div");
    this.#element.id = "zendia-statusline";
    // zendia.css draws it and picks the corner, away from the sidebar.
    this.#element.style.display = "flex";

    this.#keys = create("span", "zendia-statusline-keys");
    this.#mascot = document.createElementNS(SVG_NS, "svg");
    this.#mascot.setAttribute("class", "zendia-mascot");
    const box = MASCOT_VIEWBOX;
    this.#mascot.setAttribute(
      "viewBox",
      `${box.x} ${box.y} ${box.width} ${box.height}`
    );
    this.#mascot.setAttribute("aria-hidden", "true");
    this.#parts = this.#buildMascot(document);

    // Each mode it switches to is said once to screen readers.
    this.#announcer = create("span", "zendia-statusline-announce");
    this.#announcer.setAttribute("aria-live", "polite");

    this.#element.append(this.#keys, this.#mascot, this.#announcer);
    (document.getElementById("browser") ?? document.documentElement).append(
      this.#element
    );

    // It never takes the pointer, so it cannot be hovered the usual way:
    // the window's own pointer moves are watched instead.
    window.addEventListener("mousemove", this.#onPointerMove, {
      passive: true,
    });
    this.#root.addEventListener("mouseleave", this.#onPointerLeave);

    // Panels open, close, move and change width: each time, it finds its place
    // again. Its own changes (the mascot morphing) do not count.
    this.#mutations = new window.MutationObserver(records => {
      if (records.some(record => !this.#element.contains(record.target))) {
        this.#queuePlace();
      }
    });
    this.#mutations.observe(document.getElementById("browser") ?? this.#root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["hidden", "style", "class", "open"],
    });
    this.#resizes = new window.ResizeObserver(() => this.#queuePlace());
    window.addEventListener("resize", this.#onResize);
    // A tab switched to, or the window coming back, shows the mode it is in.
    window.addEventListener("TabSelect", this.#onWake);
    window.addEventListener("activate", this.#onWake);
    // A video going fullscreen.
    this.#fullscreen = new window.MutationObserver(() => this.#refresh());
    this.#fullscreen.observe(this.#root, {
      attributes: true,
      attributeFilter: ["inDOMFullscreen"],
    });
    this.#element.setAttribute("presence", "gone");
    this.#applyJelly();
  }

  #onResize = () => {
    this.#queuePlace();
    this.#refresh();
  };

  #onWake = () => this.#wake();

  /**
   * How it rests once things are quiet: "shrink", "always" or "change".
   *
   * @param {string} show
   */
  setShow(show) {
    const next = STATUSLINE_SHOW.includes(show) ? show : "shrink";
    if (next != this.#show) {
      this.#show = next;
      this.#wake();
    }
  }

  /**
   * The selected tab's page scrolled: it ducks out of sight until the
   * scrolling has stopped.
   */
  scrolled() {
    const window = this.#window;
    window.clearTimeout(this.#scrollTimer);
    this.#scrollTimer = window.setTimeout(() => {
      this.#scrolling = false;
      this.#refresh();
    }, SCROLL_SETTLE_MS);
    if (!this.#scrolling) {
      this.#scrolling = true;
      this.#refresh();
    }
  }

  /**
   * Something happened: it comes up for a while.
   */
  #wake() {
    const window = this.#window;
    this.#activeUntil = window.performance.now() + ACTIVE_MS;
    window.clearTimeout(this.#restTimer);
    this.#restTimer = window.setTimeout(() => this.#refresh(), ACTIVE_MS + 20);
    this.#refresh();
  }

  /**
   * @returns {"active"|"resting"|"tucked"|"gone"}
   */
  #presenceNow() {
    const window = this.#window;
    if (!this.#visible || this.#root.hasAttribute("inDOMFullscreen")) {
      return "gone";
    }
    if (this.#scrolling) {
      return "tucked";
    }
    if (
      this.#typing ||
      this.#near ||
      window.performance.now() < this.#activeUntil
    ) {
      return "active";
    }
    if (this.#show == "always") {
      return window.innerWidth < SMALL_WINDOW ? "resting" : "active";
    }
    return this.#show == "change" ? "gone" : "resting";
  }

  #refresh() {
    const presence = this.#presenceNow();
    this.#element.setAttribute("presence", presence);
    const out = presence == "tucked" || presence == "gone";
    // It comes apart at the size it is, and comes back at the size it rests at.
    if (!out) {
      this.#resizeTo(presence == "resting" ? REST_SCALE : 1);
    }
    this.#popOut(out);
  }

  /**
   * Pops it in or out. In, the head comes first, then the cells one by one
   * round the ring from the mode's own, then its letter; out, the other way
   * round, a little quicker.
   *
   * @param {boolean} out
   */
  #popOut(out) {
    if (out == this.#out) {
      return;
    }
    this.#out = out;
    this.#element.toggleAttribute("away", out);
    const window = this.#window;
    this.#popTimers.forEach(timer => window.clearTimeout(timer));
    this.#popTimers = [];
    const at = (ms, set) =>
      this.#popTimers.push(
        window.setTimeout(() => {
          set();
          this.#kick();
        }, ms)
      );
    const order = this.#ringOrder();
    const presence = this.#presence;
    if (out) {
      at(0, () => (presence.letter.target = 0));
      [...order]
        .reverse()
        .forEach((i, k) =>
          at(15 + k * 14, () => (presence.cells[i].target = 0))
        );
      at(30 + order.length * 14, () => (presence.head.target = 0));
    } else {
      at(0, () => (presence.head.target = 1));
      order.forEach((i, k) =>
        at(35 + k * 22, () => (presence.cells[i].target = 1))
      );
      at(55 + order.length * 22, () => (presence.letter.target = 1));
    }
  }

  /**
   * Grows or shrinks it. Shrinking, its cells shrink one after another round
   * the ring from the mode's own, then the whole draws together; growing, the
   * whole opens out first and the cells swell into place one after another.
   * Smaller cells are quicker and bigger ones heavier, and each settles with
   * a gentle bounce.
   *
   * @param {number} size
   */
  #resizeTo(size) {
    if (size == this.#restSize) {
      return;
    }
    const shrinking = size < this.#restSize;
    this.#restSize = size;
    const window = this.#window;
    this.#resizeTimers.forEach(timer => window.clearTimeout(timer));
    this.#resizeTimers = [];
    const sizes = this.#sizes;
    const all = [sizes.whole, sizes.head, ...sizes.cells];
    if (this.#out) {
      // Out of sight, it only takes its new size for when it comes back.
      for (const spring of all) {
        Object.assign(spring, { x: size, v: 0, target: size });
      }
      this.#applyJelly();
      return;
    }
    const at = (ms, set) =>
      this.#resizeTimers.push(
        window.setTimeout(() => {
          set();
          this.#kick();
        }, ms)
      );
    const mean = this.#areas.reduce((a, b) => a + b, 0) / this.#areas.length;
    const order = this.#ringOrder();
    const cellsFrom = shrinking ? 0 : 70;
    const gap = 55;
    // The whole holds until its turn.
    sizes.whole.target = sizes.whole.x;
    at(shrinking ? 160 : 0, () => (sizes.whole.target = size));
    order.forEach((i, k) =>
      at(cellsFrom + k * gap, () => {
        const cell = sizes.cells[i];
        cell.k = 320 * Math.sqrt(mean / this.#areas[i]);
        cell.c = 2 * 0.6 * Math.sqrt(cell.k);
        cell.target = size;
      })
    );
    at(shrinking ? cellsFrom + order.length * gap : 0, () => {
      sizes.head.target = size;
    });
  }

  // The cells in order round the ring, from the mode's own.
  #ringOrder() {
    const lead = Math.max(0, MASCOT_MODES.indexOf(this.#shown));
    return MASCOT_MODES.map((_, k) => (lead + k) % MASCOT_MODES.length);
  }

  #springs() {
    const { head, cells, letter } = this.#presence;
    const sizes = this.#sizes;
    return [head, ...cells, letter, sizes.whole, sizes.head, ...sizes.cells];
  }

  // Runs the springs until they rest.
  #kick() {
    const window = this.#window;
    if (this.#springFrame !== null) {
      return;
    }
    let last = window.performance.now();
    const step = now => {
      const dt = Math.min(0.032, Math.max(0, (now - last) / 1000));
      last = Math.max(last, now);
      let moving = false;
      for (const spring of this.#springs()) {
        spring.v +=
          (spring.k * (spring.target - spring.x) - spring.c * spring.v) * dt;
        spring.x += spring.v * dt;
        if (
          Math.abs(spring.v) > 0.002 ||
          Math.abs(spring.target - spring.x) > 0.001
        ) {
          moving = true;
        } else {
          spring.x = spring.target;
          spring.v = 0;
        }
      }
      this.#applyJelly();
      this.#springFrame = moving ? window.requestAnimationFrame(step) : null;
    };
    this.#springFrame = window.requestAnimationFrame(step);
  }

  /**
   * Puts the springs on the drawing. A part scales about its own middle by
   * how far it has popped in and its size against the whole's, squashes
   * against the speed it pops at, and bulges out from the head while it
   * swells (and in while it shrinks). The whole scales from its corner.
   */
  #applyJelly() {
    const parts = this.#parts;
    const sizes = this.#sizes;
    const whole = Math.max(sizes.whole.x, 0.05);
    this.#element.style.scale =
      Math.abs(whole - 1) < 0.001 ? "" : whole.toFixed(3);
    const [hx, hy] = this.#middles.head;
    MASCOT_MODES.forEach((_, i) => {
      const [cx, cy] = this.#middles.cells[i];
      const size = sizes.cells[i];
      this.#jelly(
        [parts.edgeCellGroups[i], parts.cellGroups[i]],
        this.#presence.cells[i],
        this.#middles.cells[i],
        (Math.atan2(cy - hy, cx - hx) * 180) / Math.PI,
        clamp((size.v / whole) * 0.03, 0.07),
        size.x / whole
      );
    });
    this.#jelly(
      [parts.edgeHeadGroup, parts.body],
      this.#presence.head,
      this.#middles.head,
      90,
      clamp((sizes.head.v / whole) * 0.02, 0.05),
      sizes.head.x / whole
    );
    // The letter rides on the mode's own cell.
    const lead = this.#ringOrder()[0];
    this.#jelly(
      [parts.letters],
      this.#presence.letter,
      this.#middles.letter,
      90,
      0,
      sizes.cells[lead].x / whole
    );
  }

  #jelly(groups, presence, [cx, cy], angle, bulge, size) {
    const scale = Math.max(0, presence.x) * size;
    const squash = clamp(presence.v * 0.035, 0.25);
    const along = scale * (1 + squash + bulge);
    const across = scale * (1 - squash - bulge * 0.8);
    const still = Math.abs(along - 1) < 0.001 && Math.abs(across - 1) < 0.001;
    const transform = still
      ? null
      : `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${angle.toFixed(1)}) ` +
        `scale(${along.toFixed(3)} ${across.toFixed(3)}) ` +
        `rotate(${(-angle).toFixed(1)}) translate(${(-cx).toFixed(1)} ${(-cy).toFixed(1)})`;
    for (const group of groups) {
      if (transform) {
        group.setAttribute("transform", transform);
      } else {
        group.removeAttribute("transform");
      }
      if (scale < 0.01) {
        group.setAttribute("display", "none");
      } else {
        group.removeAttribute("display");
      }
    }
  }

  /**
   * The indicator sits over the page, and now and then over something the
   * user wants: with the pointer on it, it steps aside toward the page's
   * other bottom corner, and comes back once the pointer has left the place
   * it stood in.
   *
   * @param {MouseEvent} event
   */
  #onPointerMove = event => {
    if (this.#element.style.display == "none") {
      return;
    }
    const inside = (rect, margin) =>
      event.clientX >= rect.left - margin &&
      event.clientX <= rect.right + margin &&
      event.clientY >= rect.top - margin &&
      event.clientY <= rect.bottom + margin;
    // The pointer nearing where it stands, at full size, raises it.
    const element = this.#element;
    const left = element.offsetLeft + this.#offset.x;
    const top = element.offsetTop + this.#offset.y;
    const near =
      !this.#pointerZone &&
      inside(
        {
          left,
          top,
          right: left + element.offsetWidth,
          bottom: top + element.offsetHeight,
        },
        NEAR_PX
      );
    if (near != this.#near) {
      this.#near = near;
      // It stays up a while after the pointer goes.
      if (near) {
        this.#refresh();
      } else {
        this.#wake();
      }
    }
    if (this.#out) {
      return;
    }
    if (!this.#pointerZone) {
      const rect = this.#element.getBoundingClientRect();
      if (inside(rect, 0)) {
        this.#pointerZone = rect;
        this.#element.setAttribute("aside", "");
        this.#place();
      }
    } else if (!inside(this.#pointerZone, 8)) {
      this.#comeBack();
    }
  };

  #onPointerLeave = () => {
    if (this.#near) {
      this.#near = false;
      this.#wake();
    }
    this.#comeBack();
  };

  #comeBack() {
    if (this.#pointerZone) {
      this.#pointerZone = null;
      this.#element.removeAttribute("aside");
      this.#place();
    }
  }

  #queuePlace = () => {
    const window = this.#window;
    if (!this.#placeQueued) {
      this.#placeQueued = true;
      window.requestAnimationFrame(() => {
        this.#placeQueued = false;
        this.#place();
      });
    }
    window.clearTimeout(this.#settleTimer);
    this.#settleTimer = window.setTimeout(() => this.#place(), SETTLE_MS);
  };

  /**
   * Zendia's panels showing in the window, as the rectangles to keep clear of.
   *
   * @returns {DOMRect[]}
   */
  #panels() {
    const window = this.#window;
    const rects = [];
    for (const element of this.#root.querySelectorAll(ZENDIA_SURFACES)) {
      if (element.hidden || this.#element.contains(element)) {
        continue;
      }
      const style = window.getComputedStyle(element);
      if (
        style.display == "none" ||
        style.visibility == "hidden" ||
        style.opacity == "0"
      ) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width >= 1 && rect.height >= 1) {
        rects.push(rect);
        // Dragging a panel wider moves nothing in the DOM but its size.
        this.#resizes.observe(element);
      }
    }
    return rects;
  }

  /**
   * Finds where to stand: its corner when that is clear, otherwise the
   * nearest clear place along the bottom of the page (then a little higher,
   * if the whole bottom is taken), keeping clear of every Zendia panel
   * showing and of where the pointer is. With the pointer on it, it looks
   * from the page's other corner first, as it always has.
   */
  #place() {
    if (this.#element.style.display == "none") {
      return;
    }
    // Its corner, from its layout box: the slide it may be in the middle of
    // moves only what is painted.
    const element = this.#element;
    const home = {
      x: element.offsetLeft,
      y: element.offsetTop,
      width: element.offsetWidth,
      height: element.offsetHeight,
    };
    const page = (
      this.#window.gBrowser?.tabpanels ?? this.#root
    ).getBoundingClientRect();
    const obstacles = this.#panels();
    const panelsInTheWay = !!obstacles.length;
    if (this.#pointerZone) {
      obstacles.push(this.#pointerZone);
    }
    const clear = (x, y) =>
      obstacles.every(
        o =>
          x + home.width + CLEARANCE <= o.left ||
          x - CLEARANCE >= o.right ||
          y + home.height + CLEARANCE <= o.top ||
          y - CLEARANCE >= o.bottom
      );

    let spot = { x: home.x, y: home.y };
    if (!clear(home.x, home.y)) {
      const minX = page.left + CLEARANCE;
      const maxX = Math.max(minX, page.right - CLEARANCE - home.width);
      const minY = page.top + CLEARANCE;
      const toTheRight = this.#root.hasAttribute("zen-right-side");
      const from = this.#pointerZone
        ? { x: toTheRight ? maxX : minX, y: home.y }
        : home;
      let best = null;
      let bestDistance = Infinity;
      for (let y = home.y; y >= minY; y -= SEARCH_STEP) {
        // Higher rows cannot beat a place already found nearer.
        if ((home.y - y) * 1.5 > bestDistance) {
          break;
        }
        for (let x = minX; x <= maxX; x += SEARCH_STEP) {
          if (clear(x, y)) {
            const distance = Math.hypot(x - from.x, (y - from.y) * 1.5);
            if (distance < bestDistance) {
              bestDistance = distance;
              best = { x, y };
            }
          }
        }
      }
      if (best) {
        spot = best;
      }
    }
    this.#offset = { x: spot.x - home.x, y: spot.y - home.y };
    this.#element.style.setProperty(
      "--zendia-statusline-x",
      `${Math.round(this.#offset.x)}px`
    );
    this.#element.style.setProperty(
      "--zendia-statusline-y",
      `${Math.round(this.#offset.y)}px`
    );
    this.#element.toggleAttribute(
      "dodging",
      panelsInTheWay && (this.#offset.x != 0 || this.#offset.y != 0)
    );
  }

  /**
   * @param {{mode: string, tokens?: string[], count?: number|null, group?: string|null, visual?: boolean}} state
   *   `visual` shows a selection made in another mode, like the explorer's.
   */
  update({ mode, tokens = [], count = null, group = null, visual = false }) {
    const key = visual ? "v" : mode;
    const label = MODES[key] ?? mode.toUpperCase();
    const color = ZendiaTheme.hex(`mode-${key}`) ?? ZendiaTheme.hex("warning");
    // The mascot alone shows the mode; its name is only for screen readers.
    this.#element.setAttribute("aria-label", label);
    const switched = this.#painted && key != this.#element.getAttribute("mode");
    if (switched) {
      this.#announcer.textContent = label;
    }
    if (`${key} ${color}` != this.#drawn) {
      this.#drawn = `${key} ${color}`;
      this.#element.setAttribute("mode", key);
      this.#element.style.setProperty("--zendia-mascot-color", color);
      this.#drawMascot(key, color);
      if (this.#blinkTimer === null) {
        this.#scheduleBlink();
      }
    }
    if (color != this.#color) {
      this.#paintWindow(color);
    }
    const typed = `${count ?? ""}${tokens.join("")}`;
    this.#keys.textContent = group ? `${typed} +${group}` : typed;
    this.#element.toggleAttribute("typing", !!typed);
    const finished = this.#typing && !typed;
    this.#typing = !!typed;
    if (switched || finished) {
      this.#wake();
    } else {
      this.#refresh();
    }
  }

  /**
   * The mascot's drawing, built once; #paint moves it.
   *
   * @param {Document} document
   */
  #buildMascot(document) {
    const make = (tag, attributes, parent) => {
      const element = document.createElementNS(SVG_NS, tag);
      for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, value);
      }
      parent.append(element);
      return element;
    };
    // The ink edge, under everything: the cells and the mascot again, outlined.
    const edge = make(
      "g",
      {
        fill: MASCOT_EDGE.color,
        stroke: MASCOT_EDGE.color,
        "stroke-width": MASCOT_EDGE.width,
        "stroke-linejoin": "round",
      },
      this.#mascot
    );
    // Each part in a group of its own (and its edge in another, under all the
    // fills), so each pops, grows and shrinks on its own.
    const edgeCellGroups = MASCOT_MODES.map(() => make("g", {}, edge));
    const edgeCells = edgeCellGroups.map(group => make("path", {}, group));
    const edgeHeadGroup = make("g", {}, edge);
    const edgeHead = make("path", {}, edgeHeadGroup);
    const cellGroups = MASCOT_MODES.map(() => make("g", {}, this.#mascot));
    const cells = cellGroups.map(group =>
      make("path", { class: "zendia-mascot-cell" }, group)
    );
    const body = make("g", {}, this.#mascot);
    const head = make("path", { class: "zendia-mascot-head" }, body);
    const face = make("g", { fill: "none", "stroke-linecap": "round" }, body);
    const eyes = [0, 1].map(() => make("path", {}, face));
    const letters = make("g", {}, this.#mascot);
    return {
      edgeCellGroups,
      edgeCells,
      edgeHeadGroup,
      edgeHead,
      cellGroups,
      cells,
      body,
      head,
      face,
      eyes,
      letters,
    };
  }

  /**
   * Draws one frame of the mascot: at rest in a mode, or partway from one
   * mode to another.
   *
   * @param {string} from
   * @param {string} to
   * @param {number} t
   * @param {string} fromColor The mascot's color in `from`.
   * @param {string} toColor The mascot's color in `to`.
   * @param {number} [blink]
   */
  #paint(from, to, t, fromColor, toColor, blink = 0) {
    const frame = mascotFrame(from, to, t, { blink });
    const outline = list =>
      "M" +
      list.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") +
      "Z";
    frame.cells.forEach(({ mode, points }, i) => {
      const d = outline(points);
      this.#parts.cells[i].setAttribute("d", d);
      this.#parts.cells[i].setAttribute(
        "fill",
        ZendiaTheme.hex(`mode-${mode}`) ?? MASCOT_COLORS[mode]
      );
      this.#parts.edgeCells[i].setAttribute("d", d);
      this.#middles.cells[i] = middleOf(points);
      this.#areas[i] = areaOf(points);
    });
    this.#middles.head = middleOf(frame.head);
    const lastLetter = frame.letters.at(-1);
    if (lastLetter) {
      this.#middles.letter = [lastLetter.x, lastLetter.y];
    }
    const head = outline(frame.head);
    this.#parts.head.setAttribute("d", head);
    this.#parts.head.setAttribute(
      "fill",
      mixColor(fromColor, toColor, frame.color)
    );
    this.#parts.edgeHead.setAttribute("d", head);
    const ink = ZendiaTheme.hex("statusline-background") ?? MASCOT_FACE;
    this.#parts.face.setAttribute("stroke", ink);
    frame.eyes.forEach(({ points: [[x0, y0], [x1, y1]], width }, i) => {
      const eye = this.#parts.eyes[i];
      eye.setAttribute(
        "d",
        `M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`
      );
      eye.setAttribute("stroke-width", width.toFixed(1));
    });
    const document = this.#mascot.ownerDocument;
    this.#parts.letters.replaceChildren(
      ...frame.letters.map(({ d, x, y, lean, scale }) => {
        const letter = document.createElementNS(SVG_NS, "path");
        letter.setAttribute("d", d);
        letter.setAttribute("fill", ink);
        letter.setAttribute("fill-rule", "evenodd");
        letter.setAttribute(
          "transform",
          `translate(${x} ${y}) rotate(${lean}) scale(${scale.toFixed(2)})`
        );
        return letter;
      })
    );
  }

  #reducedMotion() {
    return this.#window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /**
   * Morphs the mascot into a mode's drawing, in the mode's color: the cells
   * reshape like jelly around the new lead, the color blends, the antenna
   * bends into its new pose, the eyes follow, and the letter changes. From
   * partway through a switch it goes on from where it is.
   *
   * @param {string} mode
   * @param {string} color
   */
  #drawMascot(mode, color) {
    const window = this.#window;
    const from = this.#shown;
    const fromColor = this.#morph?.color ?? this.#shownColor;
    if (this.#morph) {
      window.cancelAnimationFrame(this.#morph.frame);
    }
    this.#shown = mode;
    this.#shownColor = color;
    if (
      !this.#painted ||
      this.#reducedMotion() ||
      (from == mode && fromColor == color)
    ) {
      this.#painted = true;
      this.#morph = null;
      this.#paint(mode, mode, 1, color, color);
      return;
    }
    const start = window.performance.now();
    const morph = { color: fromColor };
    const step = now => {
      // A frame's time can be a little earlier than the switch.
      const t = Math.min(1, Math.max(0, (now - start) / MORPH_MS));
      this.#paint(from, mode, t, fromColor, color);
      morph.color = mixColor(fromColor, color, t);
      if (t < 1) {
        morph.frame = window.requestAnimationFrame(step);
      } else {
        this.#morph = null;
      }
    };
    this.#morph = morph;
    morph.frame = window.requestAnimationFrame(step);
  }

  /**
   * Now and then it blinks, so it looks alive between switches.
   */
  #scheduleBlink() {
    this.#window.clearTimeout(this.#blinkTimer);
    this.#blinkTimer = this.#window.setTimeout(
      () => this.#blink(),
      2600 + Math.random() * 3400
    );
  }

  #blink() {
    const window = this.#window;
    if (
      !this.#morph &&
      !this.#out &&
      this.#element.style.display != "none" &&
      !this.#reducedMotion()
    ) {
      const start = window.performance.now();
      const step = now => {
        if (this.#morph) {
          return;
        }
        const t = Math.min(1, Math.max(0, (now - start) / 180));
        const mode = this.#shown;
        this.#paint(
          mode,
          mode,
          1,
          this.#shownColor,
          this.#shownColor,
          Math.sin(Math.PI * t)
        );
        if (t < 1) {
          window.requestAnimationFrame(step);
        }
      };
      window.requestAnimationFrame(step);
    }
    this.#scheduleBlink();
  }

  /**
   * @param {boolean} visible
   */
  setVisible(visible) {
    // The inline display: flex would win over the hidden attribute.
    this.#element.style.display = visible ? "flex" : "none";
    this.#root.toggleAttribute("zendia-mode", visible);
    if (visible == this.#visible) {
      return;
    }
    this.#visible = visible;
    if (visible) {
      this.#queuePlace();
      // It comes together, and shows its mode for a while.
      this.#wake();
    } else {
      // Hidden at once, so it comes together again when it is next shown.
      this.#out = true;
      this.#element.toggleAttribute("away", true);
      this.#element.setAttribute("presence", "gone");
      this.#presence.head.x = this.#presence.letter.x = 0;
      this.#presence.head.target = this.#presence.letter.target = 0;
      for (const cell of this.#presence.cells) {
        cell.x = cell.target = cell.v = 0;
      }
      this.#presence.head.v = this.#presence.letter.v = 0;
      this.#popTimers.forEach(timer => this.#window.clearTimeout(timer));
      this.#popTimers = [];
      this.#applyJelly();
    }
  }

  destroy() {
    if (this.#morph) {
      this.#window.cancelAnimationFrame(this.#morph.frame);
    }
    const window = this.#window;
    if (this.#springFrame !== null) {
      window.cancelAnimationFrame(this.#springFrame);
    }
    for (const timer of [
      this.#blinkTimer,
      this.#settleTimer,
      this.#restTimer,
      this.#scrollTimer,
      ...this.#popTimers,
      ...this.#resizeTimers,
    ]) {
      window.clearTimeout(timer);
    }
    this.#mutations.disconnect();
    this.#resizes.disconnect();
    this.#fullscreen.disconnect();
    window.removeEventListener("resize", this.#onResize);
    window.removeEventListener("TabSelect", this.#onWake);
    window.removeEventListener("activate", this.#onWake);
    this.#window.removeEventListener("mousemove", this.#onPointerMove);
    this.#root.removeEventListener("mouseleave", this.#onPointerLeave);
    this.#element.remove();
    this.#root.removeAttribute("zendia-mode");
    this.#root.style.removeProperty("--zendia-mode-background");
    this.#root.style.removeProperty("--zendia-mode-background-toolbar");
  }

  /**
   * Color the window and its sidebar the way a Zen space theme with the mode
   * color as its only dot would, so the opacity and blending of the space
   * still apply and the sidebar keeps matching the frame.
   *
   * @param {string} color
   */
  #paintWindow(color) {
    const picker = this.#window.gZenThemePicker;
    const dot = [{ c: rgb(color) }];
    const algo = picker?.useAlgo;
    this.#root.style.setProperty(
      "--zendia-mode-background",
      picker?.getGradient(dot) ?? color
    );
    this.#root.style.setProperty(
      "--zendia-mode-background-toolbar",
      picker?.getGradient(dot, true) ?? color
    );
    if (picker) {
      picker.useAlgo = algo;
      // Before the theme picker exists the raw color is only a placeholder.
      this.#color = color;
    }
  }
}
