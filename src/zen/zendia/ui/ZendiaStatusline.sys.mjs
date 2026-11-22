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
};

// How long a switch from one mode to another takes, in milliseconds.
const MORPH_MS = MASCOT_MORPH_MS;

function rgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}

/**
 * The mode indicator in a browser window: the mode of the selected tab's
 * page and whatever has been typed towards a mapping. The mode is shown by
 * Zendia's mascot (ZendiaMascot.sys.mjs) among its six mode cells, with the
 * mode's cell in the lead, the mode's color and pose, and the mode's letter.
 * A switch morphs it into the next mode's drawing, and now and then it blinks.
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
  // Where it stood before it stepped aside from the pointer, or null.
  #home = null;
  #root;
  #window;
  #color;

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

    this.#element.append(this.#keys, this.#mascot);
    (document.getElementById("browser") ?? document.documentElement).append(
      this.#element
    );

    // It never takes the pointer, so it cannot be hovered the usual way:
    // the window's own pointer moves are watched instead.
    window.addEventListener("mousemove", this.#onPointerMove, {
      passive: true,
    });
    this.#root.addEventListener("mouseleave", this.#onPointerLeave);
  }

  /**
   * The indicator sits over the page, and now and then over something the
   * user wants: with the pointer on it, it steps aside to the other bottom
   * corner of the page, and comes back once the pointer has left the place
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
    if (!this.#home) {
      const rect = this.#element.getBoundingClientRect();
      if (inside(rect, 0)) {
        this.#stepAside(rect);
      }
    } else if (!inside(this.#home, 8)) {
      this.#comeBack();
    }
  };

  #onPointerLeave = () => this.#comeBack();

  #stepAside(home) {
    this.#home = home;
    const page = (
      this.#window.gBrowser?.tabpanels ?? this.#root
    ).getBoundingClientRect();
    // As far as the page's other side, less the margin it keeps there too.
    const distance = Math.max(0, page.width - home.width - 24);
    const toTheRight = this.#root.hasAttribute("zen-right-side");
    this.#element.style.setProperty(
      "--zendia-statusline-aside",
      `${toTheRight ? distance : -distance}px`
    );
    this.#element.setAttribute("aside", "");
  }

  #comeBack() {
    if (this.#home) {
      this.#home = null;
      this.#element.removeAttribute("aside");
    }
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
    const edgeCells = MASCOT_MODES.map(() => make("path", {}, edge));
    const edgeHead = make("path", {}, edge);
    const cells = MASCOT_MODES.map(() =>
      make("path", { class: "zendia-mascot-cell" }, this.#mascot)
    );
    const head = make("path", { class: "zendia-mascot-head" }, this.#mascot);
    const face = make(
      "g",
      { fill: "none", "stroke-linecap": "round" },
      this.#mascot
    );
    const eyes = [0, 1].map(() => make("path", {}, face));
    const letters = make("g", {}, this.#mascot);
    return { edgeCells, edgeHead, cells, head, face, eyes, letters };
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
    });
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
  }

  destroy() {
    if (this.#morph) {
      this.#window.cancelAnimationFrame(this.#morph.frame);
    }
    this.#window.clearTimeout(this.#blinkTimer);
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
