// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// A mouse for the keyboard, for the CAPTCHAs that nothing can label: a
// picture to click on a point of, a slider or a piece to drag, a button to
// hold down. A grid of labels over the CAPTCHA picks the point; the keys then
// click there, or hold the mouse down and move it by steps.

import { ZendiaCaptcha } from "resource:///modules/zendia/core/ZendiaCaptcha.sys.mjs";
import { ZendiaControls } from "resource:///modules/zendia/core/ZendiaControls.sys.mjs";
import { ZendiaKeys } from "resource:///modules/zendia/core/ZendiaKeys.sys.mjs";
import { hintLabels } from "resource:///modules/zendia/ui/ZendiaHints.sys.mjs";
import { LABELS } from "resource:///modules/zendia/ui/ZendiaPicker.sys.mjs";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const LABEL_BACKGROUND = "#232136";
const LABEL_TEXT = "#eef5ff";
const CELL_OUTLINE = "rgba(162, 87, 114, 0.55)";
const AREA_OUTLINE = "rgba(255, 199, 119, 0.8)";

// A frame that does not answer is left out rather than waited for.
const FRAME_TIMEOUT_MS = 1000;

// About how wide a cell of the grid is, and the most cells there may be (two
// letters make 576 labels).
const CELL_SIZE = 40;
const MAX_CELLS = 24 * 24;
// A cell is split into this many columns and rows to point more finely.
const REFINE = 4;
// How far a key moves a held pointer, in CSS pixels: h j k l the least, [ ]
// a little more, H J K L the most. A move of a longer way is made in steps
// of PATH_STEP.
const FINE_STEP = 2;
const STEP = 0.5;
const FAR_STEP = 6;
const PATH_STEP = 12;
// A drag moves like a hand does, not in one jump.
const MOVE_PAUSE_MS = 8;

const MOUSE_TYPES = new Set(["mousemove", "mousedown", "mouseup"]);

export function plainRect(left, top, width, height) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

/**
 * A message to another frame of the page, through the parent, which only
 * passes it to frames of this page.
 *
 * @param {object} actor
 * @param {Window} window
 * @param {number} bcId
 * @param {string} name
 * @param {*} [data]
 * @returns {Promise<*>} The answer, or null if it did not come.
 */
export function askFrame(actor, window, bcId, name, data) {
  return Promise.race([
    actor
      .sendQuery("Zendia:FrameQuery", { bcId, name, data })
      .catch(() => null),
    new Promise(resolve =>
      window.setTimeout(() => resolve(null), FRAME_TIMEOUT_MS)
    ),
  ]);
}

function boxOf(frame) {
  const box = frame.getBoundingClientRect();
  return plainRect(
    box.left + frame.clientLeft,
    box.top + frame.clientTop,
    frame.clientWidth,
    frame.clientHeight
  );
}

const isArea = item =>
  ["left", "top", "width", "height"].every(key =>
    Number.isFinite(item?.[key])
  ) &&
  item.width > 0 &&
  item.height > 0;

// Of rects, those that no other holds.
function outermost(rects) {
  return rects.filter(
    rect =>
      !rects.some(
        other =>
          other !== rect &&
          other.left <= rect.left &&
          other.top <= rect.top &&
          other.right >= rect.right &&
          other.bottom >= rect.bottom &&
          (other.width > rect.width || other.height > rect.height)
      )
  );
}

/**
 * Where the CAPTCHAs are in this window: the frames of the services, found
 * by their address, and the widgets a page draws itself. The frames in the
 * frames are asked for theirs.
 *
 * @param {object} actor
 * @param {Window} window
 * @returns {Promise<{left: number, top: number, width: number, height: number}[]>}
 *   Plain rects in this window, none inside another.
 */
export async function captchaAreas(actor, window) {
  const found = await Promise.all(
    ZendiaControls.frames(window).map(async frame => {
      const box = boxOf(frame);
      if (ZendiaCaptcha.nameOf(frame.src) !== null) {
        return [box];
      }
      const nested = await askFrame(
        actor,
        window,
        frame.browsingContext.id,
        "Zendia:CollectAreas"
      );
      return (Array.isArray(nested) ? nested : [])
        .filter(isArea)
        .map(({ left, top, width, height }) =>
          plainRect(box.left + left, box.top + top, width, height)
        )
        .filter(
          rect =>
            rect.right > box.left &&
            rect.left < box.right &&
            rect.bottom > box.top &&
            rect.top < box.bottom
        );
    })
  );
  const widgets = [];
  try {
    for (const element of window.document.querySelectorAll(
      ZendiaCaptcha.WIDGETS
    )) {
      const rect = element.getBoundingClientRect();
      if (
        element.checkVisibility() &&
        rect.width >= 20 &&
        rect.height >= 20 &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight
      ) {
        widgets.push(plainRect(rect.left, rect.top, rect.width, rect.height));
      }
    }
  } catch {
    // A selector this page's engine does not know.
  }
  return outermost([...found.flat(), ...widgets]);
}

/**
 * Move, press or release the mouse at a point of this window, in the frame
 * that is there. A drag keeps to the frame it began in by passing `frame`,
 * the chain this answered with before.
 *
 * @param {object} actor
 * @param {Window} window
 * @param {{type: string, x: number, y: number, buttons: number,
 *   frame?: number[]}} data
 * @returns {Promise<number[]|null>} The frames it went through, outermost
 *   first, or null if one did not answer.
 */
export async function pointerAt(actor, window, data) {
  const { type, x, y, buttons, frame } = data ?? {};
  if (
    !MOUSE_TYPES.has(type) ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isSafeInteger(buttons ?? 0) ||
    (frame !== undefined &&
      !(Array.isArray(frame) && frame.every(id => Number.isSafeInteger(id))))
  ) {
    return null;
  }
  const frames = ZendiaControls.frames(window);
  let inner;
  if (frame) {
    inner = frame.length
      ? frames.find(each => each.browsingContext.id == frame[0])
      : null;
    if (frame.length && !inner) {
      return null;
    }
  } else {
    // The topmost frame that holds the point.
    inner = frames.findLast(each => {
      const box = boxOf(each);
      return x >= box.left && x < box.right && y >= box.top && y < box.bottom;
    });
  }
  if (inner) {
    const box = boxOf(inner);
    const id = inner.browsingContext.id;
    const reply = await askFrame(actor, window, id, "Zendia:Pointer", {
      type,
      x: x - box.left,
      y: y - box.top,
      buttons: buttons ?? 0,
      frame: frame ? frame.slice(1) : undefined,
    });
    return Array.isArray(reply) &&
      reply.every(each => Number.isSafeInteger(each))
      ? [id, ...reply]
      : null;
  }
  window.synthesizeMouseEvent(
    type,
    x,
    y,
    type == "mousemove"
      ? { buttons: buttons ?? 0 }
      : { button: 0, buttons: buttons ?? 0, clickCount: 1 }
  );
  return [];
}

function style(element, properties) {
  Object.assign(element.style, properties);
}

/**
 * The mouse, driven by keys, over the CAPTCHAs of a page.
 *
 * Choosing a point: a label of two letters for a cell of the grid, then, to
 * point more finely, one for a part of it (<CR> takes the middle of the cell).
 * With `click` a point is clicked. With `drag` the first point is where the
 * mouse is pressed; h j k l (H J K L farther) then move it, `.` takes it to
 * another point of the grid, <CR> lets go and <Esc> lets go where it began.
 */
export class PointerPad {
  #window;
  #actor;
  #areas;
  #drag;
  #cells = [];
  #labels = [];
  #typed = "";
  // Choosing: the cells, a part of one, or moving what is held.
  #stage = "cells";
  #cell = null;
  #parts = [];
  #held = null;
  #queue = Promise.resolve();
  #done = false;
  #root = null;
  // Where the user is asked next to point to.
  #moveTo = false;
  #onFinish = null;
  // The places of a board the held piece can be put on, and their labels.
  #lattice = null;
  #latticeLabels = [];

  /**
   * @param {object} actor
   * @param {Window} window
   * @param {object} options
   * @param {{left: number, top: number, width: number, height: number}[]} options.areas
   *   Where the grid goes.
   * @param {boolean} options.drag Whether the first point is pressed and held.
   * @param {{x: number, y: number}} [options.grab] A point to hold at once.
   * @param {{left: number, top: number, width: number, height: number}[]|null} [options.lattice]
   *   The places of a board the held piece can be put on.
   * @param {?() => void} [options.onFinish] Called when the pad is over.
   */
  constructor(
    actor,
    window,
    { areas, drag, grab, lattice = null, onFinish = null }
  ) {
    this.#onFinish = onFinish;
    this.#actor = actor;
    this.#window = window;
    this.#areas = areas;
    this.#drag = drag;
    this.#buildCells();
    if (lattice?.length) {
      this.#lattice = lattice;
      this.#latticeLabels = hintLabels(lattice.length);
    }
    if (grab) {
      // With a board to put the piece on, its places are labeled at once.
      this.#stage = this.#lattice ? "drop" : "move";
      this.#enqueue(() => this.#grab(grab));
    }
    this.#draw();
  }

  get done() {
    return this.#done;
  }

  #buildCells() {
    let size = CELL_SIZE;
    let cells;
    do {
      cells = this.#areas.flatMap(area => ZendiaCaptcha.gridCells(area, size));
      size *= 1.5;
    } while (cells.length > MAX_CELLS);
    this.#cells = cells;
    this.#labels = hintLabels(cells.length);
  }

  #enqueue(task) {
    this.#queue = this.#queue.then(task).catch(() => {});
    return this.#queue;
  }

  handleKey(event) {
    const token = ZendiaKeys.fromEvent(event);
    if (!token || this.#done) {
      return;
    }
    if (token == "<Esc>") {
      this.#escape();
    } else if (this.#stage == "drop") {
      this.#dropKey(token);
    } else if (this.#stage == "move" && !this.#moveTo) {
      this.#moveKey(token);
    } else if (token == "<BS>") {
      this.#back();
    } else if (this.#stage == "parts") {
      this.#partKey(token);
    } else if (token.length == 1) {
      this.#cellKey(token.toLowerCase());
    }
  }

  // The places of a board, one label each: the piece goes to the one typed
  // and is let go of there.
  #dropKey(token) {
    if (token == ".") {
      this.#moveTo = true;
      this.#typed = "";
      this.#stage = "cells";
    } else if (token == "<BS>") {
      this.#typed = this.#typed.slice(0, -1);
    } else if (token.length == 1) {
      const typed = this.#typed + token.toLowerCase();
      const index = this.#latticeLabels.indexOf(typed);
      if (index != -1) {
        const at = ZendiaCaptcha.middle(this.#lattice[index]);
        this.#typed = "";
        this.#enqueue(async () => {
          await this.#dragTo(at);
          await this.#release(at);
          this.#held = null;
        }).then(() => this.finish());
        this.#stage = "move";
      } else if (this.#latticeLabels.some(label => label.startsWith(typed))) {
        this.#typed = typed;
      }
    }
    this.#draw();
  }

  #escape() {
    if (this.#stage == "drop") {
      // No place chosen: the keys move the piece by steps instead.
      this.#typed = "";
      this.#stage = "move";
      this.#draw();
    } else if (this.#stage == "parts") {
      this.#back();
    } else if (this.#stage == "cells" && this.#typed) {
      this.#typed = "";
      this.#draw();
    } else if (this.#stage == "cells" && this.#moveTo) {
      // Back to moving what is held.
      this.#moveTo = false;
      this.#stage = "move";
      this.#draw();
    } else if (this.#held) {
      this.#enqueue(() => this.#release(this.#held?.start)).then(() => {
        this.#held = null;
        this.finish();
      });
    } else {
      this.finish();
    }
  }

  #back() {
    if (this.#stage == "parts") {
      this.#stage = "cells";
      this.#cell = null;
    } else {
      this.#typed = this.#typed.slice(0, -1);
    }
    this.#draw();
  }

  #cellKey(char) {
    const typed = this.#typed + char;
    const index = this.#labels.indexOf(typed);
    if (index != -1) {
      this.#typed = "";
      this.#cell = this.#cells[index];
      this.#parts = ZendiaCaptcha.splitRect(this.#cell, REFINE, REFINE);
      this.#stage = "parts";
    } else if (this.#labels.some(label => label.startsWith(typed))) {
      this.#typed = typed;
    }
    this.#draw();
  }

  #partKey(token) {
    if (token == "<CR>") {
      this.#point(ZendiaCaptcha.middle(this.#cell));
    } else if (token.length == 1) {
      const index = [...LABELS].indexOf(token.toLowerCase());
      if (index != -1 && index < this.#parts.length) {
        this.#point(ZendiaCaptcha.middle(this.#parts[index]));
      }
    }
  }

  // A point was chosen.
  #point(point) {
    this.#stage = "cells";
    this.#cell = null;
    this.#typed = "";
    if (this.#held) {
      this.#moveTo = false;
      this.#stage = "move";
      this.#enqueue(() => this.#dragTo(point));
    } else if (this.#drag) {
      this.#stage = "move";
      this.#enqueue(() => this.#grab(point));
    } else {
      this.#enqueue(() => this.#click(point));
    }
    this.#draw();
  }

  #moveKey(token) {
    const steps = {
      h: [-STEP, 0],
      l: [STEP, 0],
      k: [0, -STEP],
      j: [0, STEP],
      H: [-FAR_STEP, 0],
      L: [FAR_STEP, 0],
      K: [0, -FAR_STEP],
      J: [0, FAR_STEP],
      "[": [-FINE_STEP, 0],
      "]": [FINE_STEP, 0],
      "<Left>": [-STEP, 0],
      "<Right>": [STEP, 0],
      "<Up>": [0, -STEP],
      "<Down>": [0, STEP],
      "<S-Left>": [-FAR_STEP, 0],
      "<S-Right>": [FAR_STEP, 0],
    };
    if (token == "<CR>" || token == "<Space>") {
      // Letting go ends the drag, and the pad with it.
      this.#enqueue(() => this.#release(this.#held?.at)).then(() => {
        this.#held = null;
        this.finish();
      });
    } else if (token == ".") {
      this.#moveTo = true;
      this.#stage = "cells";
      this.#draw();
    } else if (steps[token] && this.#held) {
      const [dx, dy] = steps[token];
      const { at } = this.#held;
      this.#enqueue(() => this.#dragTo({ x: at.x + dx, y: at.y + dy }));
      // Shown at once, ahead of the mouse that follows it.
      this.#held.at = { x: at.x + dx, y: at.y + dy };
      this.#draw();
    }
  }

  async #send(type, point, buttons) {
    return pointerAt(this.#actor, this.#window, {
      type,
      x: point.x,
      y: point.y,
      buttons,
      frame: this.#held?.chain,
    });
  }

  // A press in a frame moves the focus into it, where the keys that follow
  // would not reach this pad.
  #refocus() {
    try {
      const focused = this.#window.document.activeElement;
      if (focused?.browsingContext) {
        focused.blur();
      }
      this.#window.focus();
    } catch {
      // The window is already gone.
    }
  }

  async #click(point) {
    await this.#send("mousemove", point, 0);
    await this.#send("mousedown", point, 1);
    await this.#send("mouseup", point, 0);
    this.#refocus();
  }

  async #grab(point) {
    await this.#send("mousemove", point, 0);
    const chain = await this.#send("mousedown", point, 1);
    this.#held = { chain: chain ?? undefined, start: point, at: point };
    this.#refocus();
    this.#draw();
  }

  async #dragTo(point) {
    if (!this.#held) {
      return;
    }
    const from = this.#held.walked ?? this.#held.start;
    for (const next of ZendiaCaptcha.path(from, point, PATH_STEP)) {
      await this.#send("mousemove", next, 1);
      await new Promise(resolve =>
        this.#window.setTimeout(resolve, MOVE_PAUSE_MS)
      );
    }
    this.#held.walked = point;
    this.#held.at = point;
  }

  async #release(point) {
    if (!this.#held) {
      return;
    }
    if (
      point &&
      (point.x != this.#held.walked?.x || point.y != this.#held.walked?.y)
    ) {
      await this.#dragTo(point);
    }
    await this.#send("mouseup", point ?? this.#held.start, 0);
    this.#refocus();
  }

  finish() {
    if (this.#done) {
      return;
    }
    this.#done = true;
    this.#onFinish?.();
    if (this.#held) {
      // Never leave the mouse down in a page.
      const held = this.#held;
      this.#held = null;
      pointerAt(this.#actor, this.#window, {
        type: "mouseup",
        x: held.at.x,
        y: held.at.y,
        buttons: 0,
        frame: held.chain,
      }).catch(() => {});
    }
    try {
      this.#root?.remove();
    } catch {
      // The window is already gone.
    }
    this.#root = null;
  }

  #draw() {
    const document = this.#window.document;
    this.#root?.remove();
    const root = document.createElementNS(HTML_NS, "div");
    root.style.cssText =
      "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
    for (const area of this.#areas) {
      this.#box(root, area, `2px dashed ${AREA_OUTLINE}`);
    }
    let prompt;
    if (this.#stage == "drop") {
      this.#crosshair(root);
      this.#lattice.forEach((place, i) => {
        const label = this.#latticeLabels[i];
        if (label.startsWith(this.#typed)) {
          this.#box(root, place, `1px solid ${CELL_OUTLINE}`);
          this.#tag(root, place, label);
        }
      });
      prompt = "put it on · a label drops it · Esc move by keys · . any point";
    } else if (this.#stage == "move") {
      this.#crosshair(root);
      prompt = this.#held
        ? "drag · hjkl 0.5px · [ ] 2px · HJKL 6px · . point · Enter release · Esc cancel"
        : "…";
    } else if (this.#stage == "parts") {
      this.#box(root, this.#cell, `2px solid ${CELL_OUTLINE}`);
      this.#parts.forEach((part, i) => {
        this.#box(root, part, `1px solid ${CELL_OUTLINE}`);
        this.#tag(root, part, [...LABELS][i]);
      });
      prompt = "point · letter picks · Enter the middle · Esc back";
    } else {
      this.#cells.forEach((cell, i) => {
        const label = this.#labels[i];
        if (label.startsWith(this.#typed)) {
          this.#box(root, cell, `1px solid ${CELL_OUTLINE}`);
          this.#tag(root, cell, label);
        }
      });
      const verb = this.#held || this.#drag ? "drag" : "click";
      prompt = `${verb} · two letters pick a cell · Esc leave`;
    }
    this.#prompt(root, prompt);
    this.#root = root;
    document.documentElement.append(root);
  }

  #box(root, rect, outline) {
    const box = this.#window.document.createElementNS(HTML_NS, "div");
    style(box, {
      position: "absolute",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      boxSizing: "border-box",
      outline,
      outlineOffset: "-1px",
    });
    root.append(box);
  }

  #tag(root, rect, text) {
    const tag = this.#window.document.createElementNS(HTML_NS, "span");
    tag.textContent = text;
    style(tag, {
      position: "absolute",
      left: `${rect.left + 1}px`,
      top: `${rect.top + 1}px`,
      padding: "0 2px",
      borderRadius: "3px",
      background: LABEL_BACKGROUND,
      color: LABEL_TEXT,
      font: "700 10px/13px ui-monospace, monospace",
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.4)",
    });
    root.append(tag);
  }

  #crosshair(root) {
    const at = this.#held?.at;
    if (!at) {
      return;
    }
    const dot = this.#window.document.createElementNS(HTML_NS, "div");
    style(dot, {
      position: "absolute",
      left: `${at.x - 7}px`,
      top: `${at.y - 7}px`,
      width: "14px",
      height: "14px",
      boxSizing: "border-box",
      borderRadius: "50%",
      border: `2px solid ${AREA_OUTLINE}`,
      background: "rgba(35, 33, 54, 0.6)",
    });
    root.append(dot);
  }

  #prompt(root, text) {
    const tag = this.#window.document.createElementNS(HTML_NS, "span");
    tag.textContent = text;
    style(tag, {
      position: "absolute",
      left: "50%",
      bottom: "16px",
      transform: "translateX(-50%)",
      padding: "2px 10px",
      borderRadius: "6px",
      background: LABEL_BACKGROUND,
      color: LABEL_TEXT,
      font: "700 13px/20px ui-monospace, monospace",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.4)",
    });
    root.append(tag);
  }
}
