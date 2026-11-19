// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { ZendiaDom } from "resource:///modules/zendia/core/ZendiaDom.sys.mjs";

// What a user can press, type in or toggle, by its markup.
const CONTROLS = [
  // The controls of the browser's own pages, like its settings.
  "checkbox",
  "radio",
  "menulist",
  "richlistitem",
  "tab",
  "toolbarbutton",
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[role=button]",
  "[role=link]",
  "[role=checkbox]",
  "[role=switch]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=radio]",
  "[role=option]",
  "[role=combobox]",
  "[role=textbox]",
  "[role=slider]",
  "[contenteditable]:not([contenteditable=false])",
  "[tabindex]:not([tabindex='-1'])",
  "[onclick]",
].join(",");

// The cursors that say an element can be pressed, or dragged: a slider's
// handle has no markup to say so either.
const DRAG_CURSORS = new Set([
  "grab",
  "grabbing",
  "move",
  "all-scroll",
  "ew-resize",
  "e-resize",
  "w-resize",
  "col-resize",
]);
const HANDS = new Set(["pointer", ...DRAG_CURSORS]);
const DRAG_NAME =
  /slider|handle|knob|thumb|drag|puzzle|jigsaw|press-?(?:and-?)?hold/i;
// What a button to hold down says, and how much of its text is read.
const HOLD_WORDS =
  /\bpress\s*(?:&|and)\s*hold\b|\b(?:click|tap) and hold\b|\bhold (?:the|this) button\b/i;
const HOLD_TEXT_MAX = 80;
// The handles that slide along a track, by their names: GeeTest's
// slider_button, Tencent's tc-slider-normal, Yidun's yidun_slider.
const SLIDER_NAME = /slid|knob|thumb/i;

// A slider's handle by its shape, as its markup and cursor can be anything:
// a knob, flush with the end of a track that is much longer than it is
// thick. The track, if it is one.
function trackOf(element) {
  const knob = element.getBoundingClientRect();
  if (knob.height < 28 || knob.width < 28) {
    return null;
  }
  let track = ZendiaDom.composedParent(element);
  for (let level = 0; track && level < 3; level++) {
    const box = track.getBoundingClientRect?.();
    if (
      box &&
      box.width >= knob.width * 3 &&
      box.height >= knob.height * 0.5 &&
      box.height <= knob.height * 1.6 &&
      (Math.abs(knob.left - box.left) < 12 ||
        Math.abs(box.right - knob.right) < 12) &&
      // A row of buttons is not a track: a track has the handle alone.
      ![...track.querySelectorAll(CONTROLS)].some(
        other => other !== element && !element.contains(other)
      )
    ) {
      return box;
    }
    track = ZendiaDom.composedParent(track);
  }
  return null;
}

function sitsInATrack(element) {
  return !!trackOf(element);
}

const MIN_SIZE = 4;

/**
 * Whether a box is in the window and big enough to press. It costs next to
 * nothing, so it comes before everything else: a long page has far more
 * elements out of the window than in it.
 *
 * @param {Window} window
 * @param {DOMRect} rect
 * @returns {boolean}
 */
function isInWindow(window, rect) {
  return (
    rect.width >= MIN_SIZE &&
    rect.height >= MIN_SIZE &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  );
}

/**
 * Whether an element in the window shows and nothing covers it.
 *
 * @param {Window} window
 * @param {Element} element
 * @param {DOMRect} rect
 * @returns {boolean}
 */
function isShown(window, element, rect) {
  if (!element.checkVisibility()) {
    return false;
  }
  const hit = ZendiaDom.deepElementFromPoint(
    window.document,
    Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1),
    Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1)
  );
  return (
    !!hit &&
    (ZendiaDom.composedContains(element, hit) ||
      ZendiaDom.composedContains(hit, element) ||
      hit.closest("label")?.control === element)
  );
}

/**
 * The elements that may be in the window, found by asking the layout what is
 * drawn there rather than by reading the box of every element: a long feed
 * has thousands above and below the window, and reading those boxes cost more
 * than all the rest. The elements that hold what is drawn come too, as a
 * control may be drawn by its children alone, and so does the field of a label
 * in the window, which may take no clicks of its own.
 *
 * @param {Window} window
 * @param {Element} root The elements inside it, not it.
 * @returns {Set<Element>}
 */
function elementsOnScreen(window, root) {
  const inside = new Set();
  const outside = new Set();
  const fields = new Set();
  const nodes = window.windowUtils.nodesFromRect(
    0,
    0,
    0,
    window.innerWidth,
    window.innerHeight,
    0,
    false,
    true,
    false,
    1
  );
  for (const node of nodes) {
    // From the node up to one already seen, or to the root: the chain is
    // inside the root only if it got there.
    const chain = [];
    let each = node.nodeType == node.ELEMENT_NODE ? node : null;
    each ??= ZendiaDom.composedParent(node);
    for (
      ;
      each && each !== root && !inside.has(each) && !outside.has(each);
      each = ZendiaDom.composedParent(each)
    ) {
      chain.push(each);
    }
    const isInside = each === root || inside.has(each);
    for (const element of chain) {
      (isInside ? inside : outside).add(element);
      if (isInside && element.localName == "label" && element.control) {
        fields.add(element.control);
      }
    }
  }
  for (const field of fields) {
    if (ZendiaDom.composedContains(root, field) && field !== root) {
      inside.add(field);
    }
  }
  return inside;
}

export const ZendiaControls = {
  /**
   * The controls on screen, in document order.
   *
   * @param {Window} window
   * @returns {Element[]}
   */
  find(window) {
    const cursors = new Map();
    const cursorOf = element => {
      let cursor = cursors.get(element);
      if (cursor === undefined) {
        cursor = window.getComputedStyle(element).cursor;
        cursors.set(element, cursor);
      }
      return cursor;
    };
    const root = window.document.body ?? window.document.documentElement;
    // Only what is drawn in the window is looked at, so the cost is that of
    // the window, not of the page.
    const shown = [];
    for (const element of elementsOnScreen(window, root)) {
      const rect = element.getBoundingClientRect();
      if (!isInWindow(window, rect)) {
        continue;
      }
      const isControl = element.matches(CONTROLS);
      // A div with a click handler has no markup to say so, only a hand for
      // a cursor; its children share it.
      let isHand = false;
      if (!isControl) {
        const cursor = cursorOf(element);
        const parent = ZendiaDom.composedParent(element);
        isHand = HANDS.has(cursor) && !!parent && cursorOf(parent) != cursor;
      }
      if (
        (isControl || isHand) &&
        !element.disabled &&
        isShown(window, element, rect)
      ) {
        shown.push({ element, isHand });
      }
    }
    // A hand within a control, or within another hand, is not another target.
    const hands = new Set(
      shown.filter(item => item.isHand).map(i => i.element)
    );
    const found = new Set();
    for (const element of ZendiaDom.sortComposed(shown.map(i => i.element))) {
      let isInside = false;
      if (hands.has(element)) {
        for (
          let each = ZendiaDom.composedParent(element);
          each && !isInside;
          each = ZendiaDom.composedParent(each)
        ) {
          isInside = found.has(each);
        }
      }
      if (!isInside) {
        found.add(element);
      }
    }
    return [...found];
  },

  /**
   * Whether a control is dragged rather than clicked: a slider's handle, a
   * puzzle piece, a button to hold. Told by its cursor, its role and its
   * name, as there is no markup for it.
   *
   * @param {Window} window
   * @param {Element} element
   * @returns {boolean}
   */
  isDraggable(window, element) {
    return (
      DRAG_CURSORS.has(window.getComputedStyle(element).cursor) ||
      element.matches("[role=slider], [draggable=true]") ||
      DRAG_NAME.test(
        `${element.getAttribute("class") ?? ""} ${element.id ?? ""}`
      ) ||
      // A button that says it is to be held: HUMAN's "Press & Hold".
      HOLD_WORDS.test(
        `${element.getAttribute("aria-label") ?? ""} ${(element.textContent ?? "").slice(0, HOLD_TEXT_MAX)}`
      ) ||
      sitsInATrack(element)
    );
  },

  /**
   * The track a slider's handle goes along: the box that is much longer
   * than the handle and holds it at one end, or, for one known by its role
   * or name alone, the box it sits in.
   *
   * @param {Element} element The handle.
   * @returns {{left: number, top: number, width: number, height: number}|null}
   */
  trackOf(element) {
    const box =
      trackOf(element) ??
      ZendiaDom.composedParent(element)?.getBoundingClientRect?.();
    if (!box) {
      return null;
    }
    const { left, top, width, height } = box;
    return { left, top, width, height };
  },

  /**
   * Whether a control is a slider's handle, which only goes along its track:
   * by its role, its name, or a knob flush with the end of a track. A puzzle
   * piece moved anywhere is draggable but no slider.
   *
   * @param {Element} element
   * @returns {boolean}
   */
  isSlider(element) {
    return (
      element.matches("[role=slider], input[type=range]") ||
      SLIDER_NAME.test(
        `${element.getAttribute("class") ?? ""} ${element.id ?? ""}`
      ) ||
      sitsInATrack(element)
    );
  },

  /**
   * The frames on screen: what is in them is for their own page to find.
   *
   * @param {Window} window
   * @returns {Element[]}
   */
  frames(window) {
    // From the frames themselves: walking the page for them would cost what
    // `find` no longer does, on every scroll of a jump.
    const frames = window.browsingContext.children
      .map(child => child.embedderElement)
      .filter(element => element?.matches("iframe, frame"));
    return ZendiaDom.sortComposed(
      frames.filter(
        frame =>
          frame.browsingContext &&
          // A frame hidden with `visibility` (GeeTest's chat widget sits
          // over its slider so) takes no mouse input: the page under it does.
          frame.checkVisibility({ visibilityProperty: true }) &&
          frame.ownerGlobal.getComputedStyle(frame).pointerEvents != "none" &&
          isInWindow(window, frame.getBoundingClientRect())
      )
    );
  },

  /**
   * Top to bottom, then left to right.
   *
   * @param {Element[]} elements
   * @returns {Element[]}
   */
  inReadingOrder(elements) {
    const line = element => Math.round(element.getBoundingClientRect().top / 8);
    return [...elements].sort(
      (a, b) =>
        line(a) - line(b) ||
        a.getBoundingClientRect().left - b.getBoundingClientRect().left
    );
  },

  /**
   * What a control says to the user, for matching a pattern against.
   *
   * @param {Element} element
   * @returns {string}
   */
  textOf(element) {
    const text =
      element.getAttribute("aria-label") ||
      element.innerText ||
      element.value ||
      element.getAttribute("title") ||
      element.getAttribute("alt") ||
      element.getAttribute("placeholder") ||
      element.querySelector("img[alt]")?.getAttribute("alt") ||
      "";
    return String(text).replace(/\s+/g, " ").trim().slice(0, 200);
  },
};
