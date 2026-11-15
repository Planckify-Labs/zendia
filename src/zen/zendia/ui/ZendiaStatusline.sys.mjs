// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import {
  MASCOT_SIZE,
  mascotColors,
  mascotShapes,
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

function rgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}

/**
 * The mode indicator in a browser window: the mode of the selected tab's
 * page and whatever has been typed towards a mapping. The mode is shown by
 * Zendia's mascot (ZendiaMascot.sys.mjs), which has a drawing for each mode
 * in that mode's color.
 */
export class ZendiaStatusline {
  #element;
  #mode;
  #keys;
  #mascot;
  #drawn;
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

    // The mode's name, on a tag under the mascot.
    this.#mode = create("span", "zendia-statusline-mode");
    this.#keys = create("span", "zendia-statusline-keys");
    this.#mascot = document.createElementNS(SVG_NS, "svg");
    this.#mascot.setAttribute("class", "zendia-mascot");
    this.#mascot.setAttribute(
      "viewBox",
      `0 0 ${MASCOT_SIZE.width} ${MASCOT_SIZE.height}`
    );
    this.#mascot.setAttribute("aria-hidden", "true");

    this.#element.append(this.#mode, this.#keys, this.#mascot);
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
    this.#mode.textContent = label;
    if (`${key} ${color}` != this.#drawn) {
      this.#drawn = `${key} ${color}`;
      this.#element.setAttribute("mode", key);
      this.#element.style.setProperty("--zendia-mascot-color", color);
      this.#drawMascot(key, color);
    }
    if (color != this.#color) {
      this.#paintWindow(color);
    }
    const typed = `${count ?? ""}${tokens.join("")}`;
    this.#keys.textContent = group ? `${typed} +${group}` : typed;
    this.#element.toggleAttribute("typing", !!typed);
  }

  /**
   * The mascot's drawing for a mode, in the mode's color. One drawing
   * replaces the other at once, as cels do; zendia.css jolts the new one
   * for a moment so that the change is seen.
   *
   * @param {string} mode
   * @param {string} color
   */
  #drawMascot(mode, color) {
    const colors = mascotColors(color);
    const document = this.#mascot.ownerDocument;
    this.#mascot.replaceChildren(
      ...mascotShapes(mode).map(({ paint, points, line }) => {
        const polygon = document.createElementNS(SVG_NS, "polygon");
        polygon.setAttribute(
          "points",
          points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")
        );
        polygon.setAttribute("fill", colors[paint]);
        if (line) {
          polygon.setAttribute("stroke", colors.ink);
          polygon.setAttribute("stroke-width", "1.3");
          polygon.setAttribute("stroke-linejoin", "miter");
        }
        return polygon;
      })
    );
    // Restart the jolt.
    this.#mascot.removeAttribute("changed");
    this.#mascot.getBoundingClientRect();
    this.#mascot.setAttribute("changed", "");
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
