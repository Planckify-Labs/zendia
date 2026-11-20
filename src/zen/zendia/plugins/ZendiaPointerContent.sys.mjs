// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// A cursor for the keyboard, for the CAPTCHAs that nothing can label: a
// picture to click on points of, a slider or a piece to drag, a button to
// hold down. Labels over the CAPTCHA move the cursor; the keys then nudge
// it, click, or hold the mouse down and move it.

import { ZendiaCaptcha } from "resource:///modules/zendia/core/ZendiaCaptcha.sys.mjs";
import { ZendiaControls } from "resource:///modules/zendia/core/ZendiaControls.sys.mjs";
import { ZendiaDom } from "resource:///modules/zendia/core/ZendiaDom.sys.mjs";
import { ZendiaKeys } from "resource:///modules/zendia/core/ZendiaKeys.sys.mjs";
import { LABELS } from "resource:///modules/zendia/ui/ZendiaPicker.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  ownChallenges:
    "resource:///modules/zendia/captcha/ZendiaCaptchaWatchChild.sys.mjs",
});

const HTML_NS = "http://www.w3.org/1999/xhtml";
const LABEL_BACKGROUND = "#232136";
const LABEL_TEXT = "#eef5ff";
const TYPED_TEXT = "#ffc777";
const CELL_OUTLINE = "rgba(162, 87, 114, 0.55)";
const AREA_OUTLINE = "rgba(255, 199, 119, 0.8)";
const RULER_LINE = "rgba(255, 199, 119, 0.8)";
const HELD_FILL = "rgba(255, 199, 119, 0.45)";

// How tall the band at the bottom of the window the prompt takes.
const PROMPT_BAND = 52;

// A frame that does not answer is left out rather than waited for.
const FRAME_TIMEOUT_MS = 1000;

// How far above its answer field the picture of a site's own CAPTCHA may be.
const OWN_CAPTCHA_LEVELS = 4;
// How far up a site's own CAPTCHA takes in the box around it, for its
// buttons (Rotate, Check, Reset), while the box stays about its size.
const OWN_CAPTCHA_WIDEN = 4;
// The smallest picture a site's own CAPTCHA draws: an icon is none.
const OWN_PICTURE_MIN = { width: 40, height: 24 };
// The fields of a form that a box around a CAPTCHA does not take in.
const OTHER_FIELDS =
  "input:not([type=hidden], [type=submit], [type=button], [type=reset], [type=image]), textarea, select";

// The letters of the cursor's labels: not h j k l, which move it, nor v,
// which holds the mouse down.
export const PAD_LETTERS = [...LABELS]
  .filter(letter => !"hjklv".includes(letter))
  .join("");

// About how wide a cell of the grid is, and the most cells there may be (as
// many as two letters label).
const CELL_SIZE = 40;
const MAX_CELLS = PAD_LETTERS.length ** 2;
// How far a key moves the cursor, in CSS pixels, times the count before it:
// h j k l 2, H J K L 10, the arrows 1 (10 with Shift).
const STEP = 2;
const FAR_STEP = 10;
const FINE_STEP = 1;
const STEPS = {
  h: [-STEP, 0],
  l: [STEP, 0],
  k: [0, -STEP],
  j: [0, STEP],
  H: [-FAR_STEP, 0],
  L: [FAR_STEP, 0],
  K: [0, -FAR_STEP],
  J: [0, FAR_STEP],
  "<Left>": [-FINE_STEP, 0],
  "<Right>": [FINE_STEP, 0],
  "<Up>": [0, -FINE_STEP],
  "<Down>": [0, FINE_STEP],
  "<S-Left>": [-FAR_STEP, 0],
  "<S-Right>": [FAR_STEP, 0],
  "<S-Up>": [0, -FAR_STEP],
  "<S-Down>": [0, FAR_STEP],
};
// How tall the ruler of a slider stands over its track, for its width: the
// picture above a track is about two thirds as tall as it is wide.
const RULER_HEIGHT = 0.7;
// Room above the piece's row for the ruler's letters, two rows of them.
const RULER_LABEL_ROOM = 30;
// A move of a longer way is made in steps of PATH_STEP, like a hand does.
const PATH_STEP = 12;
const MOVE_PAUSE_MS = 8;
// The challenge is looked for this long after a click, then at this pace;
// GONE_LOOKS looks without it and the cursor is over.
const WATCH_AFTER_CLICK_MS = 700;
const WATCH_MS = 900;
const GONE_LOOKS = 3;

const MOUSE_TYPES = new Set(["mousemove", "mousedown", "mouseup"]);
// A drag's stages to the touch event each also sends, so a slider or piece
// that only answers touch or pointer input (GeeTest's) is driven too.
const TOUCH_STAGES = {
  start: "touchstart",
  move: "touchmove",
  end: "touchend",
};

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

/**
 * Where a frame shows its document in this window, and at what scale: a
 * frame drawn scaled (a CSS transform, as sites shrink reCAPTCHA with)
 * shows it smaller or bigger than it lays it out.
 *
 * @param {Element} frame
 * @returns {{left: number, top: number, width: number, height: number,
 *   right: number, bottom: number, scaleX: number, scaleY: number}}
 */
export function frameBox(frame) {
  const box = frame.getBoundingClientRect();
  const scale = (drawn, laid) => {
    const value = laid ? drawn / laid : 1;
    return Number.isFinite(value) && value > 0 ? value : 1;
  };
  const scaleX = scale(box.width, frame.offsetWidth);
  const scaleY = scale(box.height, frame.offsetHeight);
  return {
    ...plainRect(
      box.left + frame.clientLeft * scaleX,
      box.top + frame.clientTop * scaleY,
      frame.clientWidth * scaleX,
      frame.clientHeight * scaleY
    ),
    scaleX,
    scaleY,
  };
}

/**
 * A rect of a frame's document, in this window.
 *
 * @param {object} box The frame's, from frameBox.
 * @param {{left: number, top: number, width: number, height: number}} rect
 * @returns {object}
 */
export function fromFrame(box, { left, top, width, height }) {
  return plainRect(
    box.left + left * box.scaleX,
    box.top + top * box.scaleY,
    width * box.scaleX,
    height * box.scaleY
  );
}

const boxOf = frameBox;

const isArea = item =>
  ["left", "top", "width", "height"].every(key =>
    Number.isFinite(item?.[key])
  ) &&
  item.width > 0 &&
  item.height > 0;

// The most elements of a widget looked at for where it draws.
const DRAWN_MAX = 400;

/**
 * Where an element draws, its shadow root and what overflows it included:
 * HUMAN's "Press & Hold" is drawn from a closed shadow root, outside the box
 * of the element that holds it.
 *
 * @param {Element} element
 * @returns {{left: number, top: number, width: number, height: number, right: number, bottom: number}}
 */
export function drawnRect(element) {
  const window = element.documentGlobal;
  const box = element.getBoundingClientRect();
  let { left, top, right, bottom } = box;
  // What the boxes between a descendant and the element clip it to: a
  // picture wider than its popup (Lemin's) shows only inside it.
  // The element's own clip counts; nothing above it does.
  const clips = new Map([[ZendiaDom.composedParent(element), null]]);
  const clipOf = node => {
    if (!node) {
      return null;
    }
    if (clips.has(node)) {
      return clips.get(node);
    }
    const above = clipOf(ZendiaDom.composedParent(node));
    let clip = above;
    const overflow = window.getComputedStyle(node);
    const clipsX = overflow && overflow.overflowX != "visible";
    const clipsY = overflow && overflow.overflowY != "visible";
    if (clipsX || clipsY) {
      const own = node.getBoundingClientRect();
      clip = {
        left: clipsX ? own.left : -Infinity,
        top: clipsY ? own.top : -Infinity,
        right: clipsX ? own.right : Infinity,
        bottom: clipsY ? own.bottom : Infinity,
      };
      if (above) {
        clip = {
          left: Math.max(clip.left, above.left),
          top: Math.max(clip.top, above.top),
          right: Math.min(clip.right, above.right),
          bottom: Math.min(clip.bottom, above.bottom),
        };
      }
    }
    clips.set(node, clip);
    return clip;
  };
  let looked = 0;
  const roots = [element, element.openOrClosedShadowRoot].filter(Boolean);
  for (const root of roots) {
    for (const each of ZendiaDom.deepElements(root)) {
      if (++looked > DRAWN_MAX) {
        break;
      }
      const rect = each.getBoundingClientRect();
      if (
        rect.width < 4 ||
        rect.height < 4 ||
        !each.checkVisibility({
          visibilityProperty: true,
          opacityProperty: true,
        })
      ) {
        continue;
      }
      const clip = clipOf(ZendiaDom.composedParent(each)) ?? {
        left: -Infinity,
        top: -Infinity,
        right: Infinity,
        bottom: Infinity,
      };
      const shown = {
        left: Math.max(rect.left, clip.left),
        top: Math.max(rect.top, clip.top),
        right: Math.min(rect.right, clip.right),
        bottom: Math.min(rect.bottom, clip.bottom),
      };
      if (shown.right - shown.left < 4 || shown.bottom - shown.top < 4) {
        continue;
      }
      left = Math.min(left, shown.left);
      top = Math.min(top, shown.top);
      right = Math.max(right, shown.right);
      bottom = Math.max(bottom, shown.bottom);
    }
  }
  // Only what is in the window can be pointed at.
  left = Math.max(left, 0);
  top = Math.max(top, 0);
  right = Math.min(right, window.innerWidth);
  bottom = Math.min(bottom, window.innerHeight);
  if (right <= left || bottom <= top) {
    return plainRect(box.left, box.top, box.width, box.height);
  }
  return plainRect(left, top, right - left, bottom - top);
}

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
 * The CAPTCHAs a site makes itself, with no service to know them by: a
 * picture of a text or a sum, and a field for the answer, known by their
 * names (ZendiaCaptcha.namesOwnCaptcha). Each is the smallest box that holds
 * a field and the picture it is for, or the field or picture alone.
 *
 * @param {Window} window
 * @returns {Element[]}
 */
export function ownCaptchas(window) {
  const named = [];
  try {
    for (const element of window.document.querySelectorAll(
      "img, canvas, input:not([type=hidden]), textarea"
    )) {
      // The names first: they cost no layout, and few elements have them.
      if (
        !ZendiaCaptcha.namesOwnCaptcha(
          [
            "src",
            "alt",
            "id",
            "class",
            "name",
            "placeholder",
            "aria-label",
            "title",
          ]
            .map(name => element.getAttribute(name) ?? "")
            .join(" ")
        )
      ) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      const isField =
        element.localName == "input" || element.localName == "textarea";
      const least = isField ? { width: 20, height: 10 } : OWN_PICTURE_MIN;
      if (
        rect.width >= least.width &&
        rect.height >= least.height &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        element.checkVisibility() &&
        !element.closest(ZendiaCaptcha.WIDGETS) &&
        // A picture in a link goes somewhere: an icon of a page about
        // CAPTCHAs ("2Captcha Python SDK"), not one to solve.
        (isField || !element.closest("a[href]"))
      ) {
        named.push(element);
      }
    }
  } catch {
    // The window is already gone.
  }
  const pictures = named.filter(
    each => each.localName != "input" && each.localName != "textarea"
  );
  const fields = named.filter(each => !pictures.includes(each));
  const boxes = new Set();
  for (const field of fields) {
    // Up to the box that holds a picture too, if one is near.
    let box = field.parentElement;
    for (
      let level = 0;
      box &&
      level < OWN_CAPTCHA_LEVELS &&
      !pictures.some(each => box.contains(each));
      level++
    ) {
      box = box.parentElement;
    }
    boxes.add(
      box && pictures.some(each => box.contains(each))
        ? box
        : (field.parentElement ?? field)
    );
  }
  for (const picture of pictures) {
    if (![...boxes].some(box => box.contains(picture))) {
      boxes.add(picture.parentElement ?? picture);
    }
  }
  const widened = new Set([...boxes].filter(Boolean).map(widen));
  // And the challenges the watch knows a page draws itself, by what they
  // ask: "I'm not a robot", "Select all images with...", "Slide the piece".
  for (const box of drawnChallenges(window)) {
    widened.add(box);
  }
  // None inside another.
  return [...widened].filter(
    box => ![...widened].some(other => other !== box && other.contains(box))
  );
}

// How long the challenges a page draws are kept between two looks: a jump
// asks on every read of the page.
const DRAWN_CACHE_MS = 400;
const gDrawn = new WeakMap();

function drawnChallenges(window) {
  const now = Date.now();
  const cached = gDrawn.get(window);
  if (cached && now - cached.at < DRAWN_CACHE_MS) {
    return cached.boxes.filter(box => box.isConnected);
  }
  let boxes = [];
  try {
    boxes = lazy.ownChallenges(window).map(({ box }) => box);
  } catch {
    // The watch cannot read this page.
  }
  gDrawn.set(window, { at: now, boxes });
  return boxes;
}

// The box around a site's own CAPTCHA that holds its buttons too (Rotate
// left, Check, Reset): up while it stays about the size of the CAPTCHA, and
// no further than its form.
function widen(box) {
  const base = box.getBoundingClientRect();
  const { body, documentElement } = box.ownerDocument;
  let best = box;
  for (
    let each = box.parentElement, level = 0;
    each &&
    each != body &&
    each != documentElement &&
    level < OWN_CAPTCHA_WIDEN;
    each = each.parentElement, level++
  ) {
    const rect = each.getBoundingClientRect();
    if (
      rect.height > base.height * 2 + 120 ||
      rect.width * rect.height >
        Math.max(base.width * base.height * 12, 160000) ||
      // Not the rest of a form: a login's fields are not the CAPTCHA's, and
      // its answer field is the one Tab is to find.
      [...each.querySelectorAll(OTHER_FIELDS)].some(
        field => !box.contains(field)
      )
    ) {
      break;
    }
    best = each;
    if (each.localName == "form") {
      break;
    }
  }
  return best;
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
          fromFrame(box, { left, top, width, height })
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
    const all = [
      ...window.document.querySelectorAll(ZendiaCaptcha.WIDGETS),
      ...ownCaptchas(window),
    ];
    // The outermost of them: a GeeTest names every part of itself.
    const outer = all.filter(
      element =>
        !all.some(other => other !== element && other.contains(element))
    );
    for (const element of outer) {
      const rect = drawnRect(element);
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
 * Whether a CAPTCHA is still where some areas are: a challenge that was
 * passed, or closed, is gone from them.
 *
 * @param {object} actor
 * @param {Window} window
 * @param {{left: number, top: number, width: number, height: number}[]} areas
 * @returns {Promise<boolean>}
 */
export async function captchaIsThere(actor, window, areas) {
  const now = await captchaAreas(actor, window);
  return now.some(area => areas.some(each => meets(area, each)));
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
  const { type, x, y, buttons, frame, touch, agent } = data ?? {};
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
      x: (x - box.left) / box.scaleX,
      y: (y - box.top) / box.scaleY,
      buttons: buttons ?? 0,
      frame: frame ? frame.slice(1) : undefined,
      touch,
      agent: !!agent,
    });
    return Array.isArray(reply) &&
      reply.every(each => Number.isSafeInteger(each))
      ? [id, ...reply]
      : null;
  }
  // An agent's press never takes the user's focus or window.
  const mouse = () =>
    window.synthesizeMouseEvent(
      type,
      x,
      y,
      type == "mousemove"
        ? { buttons: buttons ?? 0 }
        : { button: 0, buttons: buttons ?? 0, clickCount: 1 }
    );
  if (agent) {
    ZendiaDom.agentMouse(window, mouse);
  } else {
    mouse();
  }
  // A drag's gesture is sent as touch too, next to the mouse, for a control
  // that listens only for touch or pointer events. Clicks and hovers, which
  // pass no stage, stay mouse only so a tap never double-fires a click.
  const touchType = TOUCH_STAGES[touch];
  if (touchType) {
    try {
      window.synthesizeTouchEvent(touchType, [
        { offsetX: x, offsetY: y, identifier: 0 },
      ]);
    } catch {
      // No touch support here; the mouse event still went.
    }
  }
  return [];
}

function style(element, properties) {
  Object.assign(element.style, properties);
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Whether two rects meet.
function meets(a, b) {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

// A #rrggbb color with an alpha, for the ghost's and a pad's soft fills.
// Anything else (a color that is already rgba) comes back as it is.
function fade(hex, alpha) {
  const value = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  if (!value) {
    return hex;
  }
  const [r, g, b] = value.slice(1).map(part => parseInt(part, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// The arrow the pad and the ghost share, its tip at {0, 0}.
function arrowCursor(document, fill) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "24");
  svg.setAttribute("viewBox", "0 0 18 24");
  style(svg, { overflow: "visible" });
  const arrow = document.createElementNS(SVG_NS, "path");
  arrow.setAttribute(
    "d",
    "M0 0 L0 17 L4.5 13 L7.5 20 L10.5 18.6 L7.6 12 L13 12 Z"
  );
  arrow.setAttribute("fill", fill);
  arrow.setAttribute("stroke", "#ffffff");
  arrow.setAttribute("stroke-width", "1.4");
  arrow.setAttribute("stroke-linejoin", "round");
  svg.append(arrow);
  return svg;
}

// How long an agent's press is marked on the page.
const GHOST_MS = 800;

/**
 * A moment's marker where an agent pressed the page: the arrow the pointer
 * pad draws, in the driving agent's own brand color, with a ring that grows
 * and fades. Drawn only, and gone in a blink: the OS pointer never moves
 * for it, so the user sees what an agent did without sharing their cursor.
 *
 * @param {Window} window
 * @param {object} options
 * @param {number} options.x In viewport CSS pixels.
 * @param {number} options.y In viewport CSS pixels.
 * @param {string} [options.color] The driving agent's color, from
 *   agentColor(); the pad's own amber without one.
 */
export function flashPointer(window, { x, y, color } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }
  try {
    const document = window.document;
    const tone = color ?? AREA_OUTLINE;
    const root = document.createElementNS(HTML_NS, "div");
    root.style.cssText =
      "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
    const ring = document.createElementNS(HTML_NS, "div");
    style(ring, {
      position: "absolute",
      left: `${x - 10}px`,
      top: `${y - 10}px`,
      width: "20px",
      height: "20px",
      boxSizing: "border-box",
      borderRadius: "50%",
      border: `2px solid ${tone}`,
      background: fade(tone, 0.35),
      transition: `transform ${GHOST_MS}ms ease-out, opacity ${GHOST_MS}ms ease-out`,
    });
    root.append(ring);
    const arrow = arrowCursor(document, tone);
    style(arrow, {
      position: "absolute",
      left: `${x}px`,
      top: `${y}px`,
      transition: `opacity ${GHOST_MS}ms ease-out`,
    });
    root.append(arrow);
    document.documentElement.append(root);
    // In the next frame, so the ring grows from the point rather than
    // appearing grown.
    window.requestAnimationFrame(() => {
      style(ring, { transform: "scale(2.2)", opacity: "0" });
      style(arrow, { opacity: "0" });
    });
    window.setTimeout(() => root.remove(), GHOST_MS + 100);
  } catch {
    // The window is already gone.
  }
}

/**
 * A cursor for the keyboard, over the CAPTCHAs of a page: for what nothing
 * labels, a picture to click on points of, a slider or a piece to drag, a
 * button to hold down. It is drawn where it is, and the page sees the mouse
 * move with it.
 *
 * Labels go where the cursor can jump to: a grid over the CAPTCHA, a ruler
 * along a slider, the places of a board. A label moves the cursor there (a
 * capital as its last letter clicks there too); h j k l move it 2px, H J K L
 * 10px, the arrows 1px, after a count as in vim; <Space> and <CR> click, or
 * let go of what is held; v presses the mouse and holds it, or lets go; <Tab>
 * goes through the labels it has, and none; <Esc> lets go where it began, or
 * gives the keys back.
 */
export class PointerPad {
  #window;
  #actor;
  #areas;
  // Whether the first jump presses the mouse and holds it (`,`).
  #drag;
  // Whether the pad began holding something (a slider, a piece): it is over
  // once that is let go of.
  #grabbed = false;
  #cursor;
  // The mouse as the keys asked for it: down since `start`, or up. The
  // press and the moves follow in the queue (#held is what they did), so a
  // key typed before a press is done still acts on what is held.
  #holding = null;
  #held = null;
  #typed = "";
  #count = "";
  // The ways to jump the cursor, each with its places and their labels.
  #layouts = [];
  // Which of them is shown; one past the last shows none.
  #layout = 0;
  #queue = Promise.resolve();
  #done = false;
  #root = null;
  #onFinish = null;
  // Presses the challenge's verify button, for <CR>.
  #onVerify = null;
  // Whether the challenge is still there, asked after a click and now and
  // then: once it is gone the pad is over.
  #isThere = null;
  #watchTimer = 0;
  #gone = 0;
  #notice = "";
  // A line the prompt always starts with.
  #banner = "";
  // The driving agent's own color, for the cursor: each agent's pad reads
  // at a glance as its own, in its tab-glow color.
  #color = null;
  // Whether an agent works this pad by message (Zendia:FeedToken) rather
  // than the user at the keys: the user's keys are never swallowed into it.
  #agentDriven = false;
  #resolveFinished;
  #finished = new Promise(resolve => (this.#resolveFinished = resolve));

  /**
   * @param {object} actor
   * @param {Window} window
   * @param {object} options
   * @param {{left: number, top: number, width: number, height: number}[]} options.areas
   *   Where the cursor goes, and the grid with it.
   * @param {boolean} options.drag Whether the first jump presses and holds.
   * @param {{x: number, y: number}} [options.grab] A point to hold at once.
   * @param {{left: number, top: number, width: number, height: number}} [options.grabRect]
   *   What is held there, a slider's handle with `slider`.
   * @param {boolean} [options.slider] Whether what is held slides along a
   *   track, and a ruler is laid along it.
   * @param {{left: number, top: number, width: number, height: number}} [options.track]
   *   The track it slides along.
   * @param {{left: number, top: number, width: number, height: number}} [options.piece]
   *   The piece a slider moves, for the ruler to say where it goes rather
   *   than the handle.
   * @param {{left: number, top: number, width: number, height: number}[]|null} [options.lattice]
   *   The places of a board the held piece can be put on.
   * @param {?() => Promise<boolean>} [options.isThere] Whether the CAPTCHA
   *   is still there.
   * @param {string} [options.notice] A line for the prompt to start with.
   * @param {?() => void} [options.onVerify] Presses the verify button: <CR>
   *   does, when nothing is held. Without it, <CR> clicks.
   * @param {?() => void} [options.onFinish] Called when the pad is over.
   * @param {string} [options.color] The driving agent's color, from
   *   agentColor(); the pad's own amber without one.
   * @param {boolean} [options.agentDriven] An agent works the pad by
   *   message: the user's keys are left to the page and the keymap.
   */
  constructor(
    actor,
    window,
    {
      areas,
      drag,
      grab = null,
      grabRect = null,
      slider = false,
      track = null,
      piece = null,
      lattice = null,
      isThere = null,
      notice = "",
      onVerify = null,
      onFinish = null,
      color = null,
      agentDriven = false,
    }
  ) {
    this.#onFinish = onFinish;
    this.#onVerify = onVerify;
    this.#actor = actor;
    this.#window = window;
    this.#areas = areas;
    this.#drag = drag;
    this.#isThere = isThere;
    this.#banner = notice;
    this.#color = color;
    this.#agentDriven = agentDriven;
    this.#cursor = grab ?? ZendiaCaptcha.middle(areas[0]);
    if (lattice?.length) {
      this.#layouts.push(this.#makeLayout("board", lattice));
    }
    if (grab && slider && grabRect) {
      const ruler = this.#rulerLayout(grab, grabRect, track, piece);
      if (ruler) {
        this.#layouts.push(ruler);
      }
    }
    this.#layouts.push(this.#gridLayout());
    if (grab) {
      this.#grabbed = true;
      this.#startHold();
    } else {
      // The page sees the mouse where the cursor starts.
      this.#enqueue(() => this.#send("mousemove", this.#cursor, 0));
    }
    this.#watch();
    this.#draw();
  }

  get done() {
    return this.#done;
  }

  // Whether an agent works this pad by message: ZendiaKeysChild leaves the
  // user's own keys to the page and the keymap, and <Esc> takes them back.
  get agentDriven() {
    return this.#agentDriven;
  }

  // Settles when the pad is over, however it ended.
  get finished() {
    return this.#finished;
  }

  // Where the cursor is, and whether the mouse is down there.
  get cursor() {
    return { ...this.#cursor, held: !!this.#holding };
  }

  #makeLayout(kind, rects, points = null) {
    return {
      kind,
      rects,
      points: points ?? rects.map(rect => ZendiaCaptcha.middle(rect)),
      labels: ZendiaCaptcha.labelsOf(rects.length, PAD_LETTERS),
    };
  }

  #gridLayout() {
    let size = CELL_SIZE;
    let cells;
    do {
      cells = this.#areas.flatMap(area => ZendiaCaptcha.gridCells(area, size));
      size *= 1.5;
    } while (cells.length > MAX_CELLS);
    return this.#makeLayout("grid", cells);
  }

  // A line across the picture for every stop of the slider, a letter each:
  // the line on the gap is where the piece goes. The stops go as far as the
  // track lets the handle; the lines stand over the picture above it.
  #rulerLayout(grab, handle, track, piece) {
    const area =
      this.#areas.find(each =>
        meets(each, { left: grab.x, top: grab.y, width: 1, height: 1 })
      ) ?? this.#areas[0];
    const along = track ?? area;
    const from = piece ? ZendiaCaptcha.middle(piece) : grab;
    const stops = ZendiaCaptcha.rulerStops(
      from,
      handle,
      along,
      PAD_LETTERS.length
    );
    if (!stops.length) {
      return null;
    }
    // The gap is on the piece's row: the lines stand there alone, and leave
    // the rest of the picture to be seen. Without a piece, over the picture
    // above the track.
    let top;
    let bottom;
    if (piece) {
      top = piece.top - RULER_LABEL_ROOM;
      bottom = piece.top + piece.height;
    } else {
      bottom = Math.min(handle.top, track?.top ?? handle.top) - 2;
      top = track ? bottom - track.width * RULER_HEIGHT : area.top;
    }
    top = Math.max(top, area.top, 0);
    const height = Math.max(20, bottom - top);
    const rects = stops.map(x => plainRect(x, top, 1, height));
    // The handle goes as far as the piece does.
    const points = stops.map(x => ({ x: grab.x + (x - from.x), y: grab.y }));
    return this.#makeLayout("ruler", rects, points);
  }

  get #shown() {
    return this.#layouts[this.#layout] ?? null;
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
    } else if (token == "<BS>") {
      if (this.#typed) {
        this.#typed = this.#typed.slice(0, -1);
      } else {
        this.#count = "";
      }
      this.#draw();
    } else if (token == "<Tab>") {
      this.#typed = "";
      this.#layout = (this.#layout + 1) % (this.#layouts.length + 1);
      this.#draw();
    } else if (/^\d$/.test(token) && !this.#typed) {
      this.#count = ZendiaCaptcha.growCount(this.#count, token);
      this.#draw();
    } else if (STEPS[token]) {
      const times = Number(this.#count || 1);
      this.#count = "";
      const [dx, dy] = STEPS[token];
      this.#moveTo({
        x: this.#cursor.x + dx * times,
        y: this.#cursor.y + dy * times,
      });
    } else if (token == "<Space>" || token == "<CR>") {
      this.#count = "";
      if (this.#holding) {
        this.#letGo();
      } else if (token == "<CR>" && this.#onVerify) {
        // As in the labels: <CR> checks what was picked. The cursor is put
        // away first, and the keys go back to the labels.
        const verify = this.#onVerify;
        this.finish();
        verify();
      } else {
        this.#click();
      }
    } else if (token == "v") {
      this.#count = "";
      if (this.#holding) {
        this.#letGo();
      } else {
        this.#startHold();
      }
    } else if (token.length == 1) {
      this.#labelKey(token);
    }
  }

  // A letter of a label: the cursor jumps once one is whole. Its last letter
  // a capital, the cursor clicks there, or lets go there.
  #labelKey(char) {
    const layout = this.#shown ?? this.#layouts[this.#layouts.length - 1];
    const typed = this.#typed + char.toLowerCase();
    const index = layout.labels.indexOf(typed);
    this.#count = "";
    if (index == -1) {
      if (layout.labels.some(label => label.startsWith(typed))) {
        this.#typed = typed;
        // Labels that were hidden show, to type the rest of one.
        if (!this.#shown) {
          this.#layout = this.#layouts.indexOf(layout);
        }
      }
      this.#draw();
      return;
    }
    this.#typed = "";
    const at = layout.points[index];
    const capital = char != char.toLowerCase();
    this.#moveTo(at);
    if (this.#holding) {
      // A board's place takes the piece, as the drop it is for.
      if (capital || layout.kind == "board") {
        this.#letGo();
      }
    } else if (capital) {
      this.#click();
    } else if (this.#drag) {
      // `,`: the first jump takes hold.
      this.#drag = false;
      this.#startHold();
    }
  }

  #escape() {
    if (this.#typed || this.#count) {
      this.#typed = "";
      this.#count = "";
      this.#draw();
    } else if (this.#holding) {
      // Back where it was taken, and let go: nothing moved.
      const start = this.#holding.start;
      this.#moveTo(start);
      this.#letGo({ end: true });
    } else {
      this.finish();
    }
  }

  // The cursor goes to a point of the window, dragging what is held.
  #moveTo(point) {
    const { innerWidth, innerHeight } = this.#window;
    const to = {
      x: Math.min(Math.max(point.x, 0), innerWidth - 1),
      y: Math.min(Math.max(point.y, 0), innerHeight - 1),
    };
    const from = this.#cursor;
    this.#cursor = to;
    this.#enqueue(async () => {
      if (this.#held) {
        await this.#dragTo(to);
      } else {
        // A hover goes the way a hand would too: some pages watch the way.
        for (const next of ZendiaCaptcha.path(from, to, PATH_STEP * 3)) {
          await this.#send("mousemove", next, 0);
        }
      }
    });
    this.#draw();
  }

  async #send(type, point, buttons, touch = null) {
    return pointerAt(this.#actor, this.#window, {
      type,
      x: point.x,
      y: point.y,
      buttons,
      frame: this.#held?.chain,
      touch,
      agent: this.#agentDriven,
    });
  }

  // A press in a frame moves the focus into it, where the keys that follow
  // would not reach this pad. An agent's keys reach the pad by message
  // (Zendia:FeedToken) and need no focus; pulling it would raise the window
  // over the user's work.
  #refocus() {
    if (this.#agentDriven) {
      return;
    }
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

  #click() {
    const at = { ...this.#cursor };
    this.#flash("click");
    this.#enqueue(async () => {
      await this.#send("mousemove", at, 0);
      await this.#send("mousedown", at, 1);
      await this.#send("mouseup", at, 0);
      this.#refocus();
    });
    this.#checkSoon();
  }

  #startHold() {
    this.#holding = { start: { ...this.#cursor } };
    this.#enqueue(() => this.#press());
    this.#draw();
  }

  async #press() {
    if (this.#done) {
      // Over before its turn came: never a mouse left down.
      return;
    }
    const at = { ...this.#cursor };
    await this.#send("mousemove", at, 0);
    const chain = await this.#send("mousedown", at, 1, "start");
    this.#held = { chain: chain ?? undefined, start: at, walked: at };
    this.#refocus();
    this.#draw();
  }

  async #dragTo(point) {
    if (!this.#held) {
      return;
    }
    const from = this.#held.walked;
    for (const next of ZendiaCaptcha.path(from, point, PATH_STEP)) {
      await this.#send("mousemove", next, 1, "move");
      await new Promise(resolve =>
        this.#window.setTimeout(resolve, MOVE_PAUSE_MS)
      );
    }
    this.#held.walked = point;
  }

  // The mouse comes up where the cursor is. A pad that began by holding
  // something is over with it; `end` ends any.
  #letGo({ end = false } = {}) {
    const over = end || this.#grabbed;
    this.#holding = null;
    this.#enqueue(async () => {
      if (!this.#held) {
        return;
      }
      const at = { ...this.#cursor };
      await this.#dragTo(at);
      await this.#send("mouseup", at, 0, "end");
      this.#held = null;
      this.#refocus();
      this.#draw();
    }).then(() => {
      if (over) {
        this.finish();
      } else {
        this.#checkSoon();
      }
    });
  }

  // A line in the prompt for a moment, for what the keys did.
  #flash(text) {
    this.#notice = text;
    this.#draw();
    this.#window.setTimeout(() => {
      if (this.#notice == text) {
        this.#notice = "";
        this.#draw();
      }
    }, 600);
  }

  // Whether the challenge went away, a moment after a click.
  #checkSoon() {
    if (!this.#isThere) {
      return;
    }
    this.#window.clearTimeout(this.#watchTimer);
    this.#watchTimer = this.#window.setTimeout(
      () => this.#watch(true),
      WATCH_AFTER_CLICK_MS
    );
  }

  // Now and then, whether the challenge is still there; three looks
  // without it and the pad is over.
  #watch(now = false) {
    if (!this.#isThere || this.#done) {
      return;
    }
    this.#window.clearTimeout(this.#watchTimer);
    const look = async () => {
      if (this.#done) {
        return;
      }
      let there = true;
      try {
        there = this.#holding ? true : await this.#isThere(this.#areas);
      } catch {
        // Not known: as if it were.
      }
      if (this.#done) {
        return;
      }
      this.#gone = there ? 0 : this.#gone + 1;
      if (this.#gone >= GONE_LOOKS) {
        this.finish();
        return;
      }
      this.#watchTimer = this.#window.setTimeout(look, WATCH_MS);
    };
    this.#watchTimer = this.#window.setTimeout(look, now ? 0 : WATCH_MS);
  }

  finish() {
    if (this.#done) {
      return;
    }
    this.#done = true;
    try {
      this.#window.clearTimeout(this.#watchTimer);
    } catch {
      // The window is already gone.
    }
    if (this.#held) {
      // Never leave the mouse down in a page.
      const held = this.#held;
      this.#held = null;
      pointerAt(this.#actor, this.#window, {
        type: "mouseup",
        x: this.#cursor.x,
        y: this.#cursor.y,
        buttons: 0,
        frame: held.chain,
        touch: "end",
        agent: this.#agentDriven,
      }).catch(() => {});
    }
    try {
      this.#root?.remove();
    } catch {
      // The window is already gone.
    }
    this.#root = null;
    this.#onFinish?.();
    this.#resolveFinished();
  }

  #draw() {
    if (this.#done) {
      return;
    }
    const document = this.#window.document;
    this.#root?.remove();
    const root = document.createElementNS(HTML_NS, "div");
    root.style.cssText =
      "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
    for (const area of this.#areas) {
      this.#box(root, area, `2px dashed ${AREA_OUTLINE}`);
    }
    const layout = this.#shown;
    if (layout) {
      layout.rects.forEach((rect, i) => {
        const label = layout.labels[i];
        if (!label.startsWith(this.#typed)) {
          return;
        }
        if (layout.kind == "ruler") {
          this.#line(root, rect);
          // Every other letter a row down, so that close ones do not touch.
          this.#tag(root, { ...rect, left: rect.left - 4 }, label, {
            dy: i % 2 ? 14 : 0,
          });
        } else {
          this.#box(root, rect, `1px solid ${CELL_OUTLINE}`);
          this.#tag(root, rect, label);
        }
      });
    }
    this.#pointer(root);
    this.#prompt(root, this.#promptText(layout));
    this.#root = root;
    document.documentElement.append(root);
  }

  #promptText(layout) {
    const parts = [];
    if (this.#agentDriven) {
      parts.push("agent");
    }
    if (this.#banner) {
      parts.push(this.#banner);
    }
    if (this.#notice) {
      parts.push(this.#notice);
    }
    if (this.#count) {
      parts.push(this.#count);
    }
    const kind = layout?.kind;
    if (this.#holding) {
      const what = {
        ruler: "slide · letter puts the piece on its line",
        board: "holding · label puts it there",
      };
      parts.push(
        what[kind] ?? "holding · label drags there · Label drops",
        "hjkl HJKL ←→ move",
        "Space/Enter drop",
        "Esc undo"
      );
    } else {
      parts.push(
        this.#drag
          ? "drag · label takes hold there"
          : "cursor · label moves · Label clicks",
        "hjkl HJKL ←→ move",
        "Space click",
        "v hold",
        ...(this.#onVerify ? ["Enter verify"] : []),
        "Esc labels"
      );
    }
    if (this.#layouts.length) {
      const next = this.#layouts[this.#layout + 1]?.kind ?? "none";
      parts.push(`Tab ${next == "none" ? "hide" : next}`);
    }
    return parts.join(" · ");
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

  // A ruler's line, light on dark and dark on light pictures alike.
  #line(root, rect) {
    const line = this.#window.document.createElementNS(HTML_NS, "div");
    style(line, {
      position: "absolute",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: "1px",
      height: `${rect.height}px`,
      background: RULER_LINE,
      boxShadow: "1px 0 0 rgba(35, 33, 54, 0.35)",
    });
    root.append(line);
  }

  #tag(root, rect, text, { dy = 0 } = {}) {
    const tag = this.#window.document.createElementNS(HTML_NS, "span");
    const typed = this.#typed.length;
    if (typed) {
      const pressed = this.#window.document.createElementNS(HTML_NS, "span");
      pressed.textContent = text.slice(0, typed);
      style(pressed, { color: TYPED_TEXT });
      tag.append(pressed, text.slice(typed));
    } else {
      tag.textContent = text;
    }
    style(tag, {
      position: "absolute",
      left: `${rect.left + 1}px`,
      top: `${rect.top + 1 + dy}px`,
      padding: "0 2px",
      borderRadius: "3px",
      background: LABEL_BACKGROUND,
      color: LABEL_TEXT,
      font: "700 10px/13px ui-monospace, monospace",
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.4)",
    });
    root.append(tag);
  }

  // The cursor: an arrow with its tip on the point, and a ring that fills
  // while the mouse is down.
  #pointer(root) {
    const document = this.#window.document;
    const { x, y } = this.#cursor;
    // An agent's pad is drawn in its own color, a user's in the pad's amber.
    const tone = this.#color ?? AREA_OUTLINE;
    const ring = document.createElementNS(HTML_NS, "div");
    const size = this.#holding ? 22 : 16;
    const held = this.#color ? fade(this.#color, 0.45) : HELD_FILL;
    style(ring, {
      position: "absolute",
      left: `${x - size / 2}px`,
      top: `${y - size / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
      boxSizing: "border-box",
      borderRadius: "50%",
      border: `2px solid ${tone}`,
      background: this.#holding ? held : "transparent",
    });
    root.append(ring);
    const svg = arrowCursor(document, this.#color ?? LABEL_BACKGROUND);
    style(svg, {
      position: "absolute",
      left: `${x}px`,
      top: `${y}px`,
    });
    root.append(svg);
  }

  #prompt(root, text) {
    const tag = this.#window.document.createElementNS(HTML_NS, "span");
    tag.textContent = text;
    // At the bottom, unless the cursor or what it goes over is there.
    const band = this.#window.innerHeight - PROMPT_BAND;
    const below =
      this.#cursor.y > band - 24 ||
      (this.#shown?.rects ?? []).some(rect => rect.top + rect.height > band);
    style(tag, {
      position: "absolute",
      left: "50%",
      [below ? "top" : "bottom"]: "16px",
      transform: "translateX(-50%)",
      width: "max-content",
      maxWidth: "90vw",
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
