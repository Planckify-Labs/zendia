// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { ZendiaControls } from "resource:///modules/zendia/core/ZendiaControls.sys.mjs";
import { ZendiaDom } from "resource:///modules/zendia/core/ZendiaDom.sys.mjs";
import { labelElements } from "resource:///modules/zendia/plugins/ZendiaJumpContent.sys.mjs";

const FIELDS =
  "input, textarea, select, [contenteditable='true'], [contenteditable='']";

// Fields whose tops are this close sit on the same row.
const ROW_TOLERANCE = 4;

function isShown(element) {
  if (
    !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  ) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isField(element) {
  return (
    element.matches(FIELDS) && ZendiaDom.isEditable(element) && isShown(element)
  );
}

function inReadingOrder(elements) {
  return elements
    .map(element => ({ element, rect: element.getBoundingClientRect() }))
    .sort((a, b) =>
      Math.abs(a.rect.top - b.rect.top) > ROW_TOLERANCE
        ? a.rect.top - b.rect.top
        : a.rect.left - b.rect.left
    )
    .map(({ element }) => element);
}

/**
 * The page's editable fields in reading order.
 *
 * @param {Document} document
 * @returns {Element[]}
 */
function fields(document) {
  return inReadingOrder([...ZendiaDom.deepElements(document)].filter(isField));
}

/**
 * The fields in the window that a user can see, in reading order: one under a
 * dialog is no choice.
 *
 * @param {Window} window
 * @returns {Element[]}
 */
function fieldsToChoose(window) {
  return inReadingOrder(ZendiaControls.find(window).filter(isField));
}

function inViewport(element, window) {
  const rect = element.getBoundingClientRect();
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  );
}

function focusField(element) {
  element.focus();
  try {
    // Continue typing after what is there, as `A` would in vim.
    const end = element.value?.length;
    if (end !== undefined) {
      element.setSelectionRange(end, end);
    }
  } catch {
    // Some input types (email, number) have no selection.
  }
}

function step({ document, window }, offset) {
  const list = fields(document);
  if (!list.length) {
    return;
  }
  const current = list.indexOf(ZendiaDom.deepActiveElement(document));
  let index;
  if (current == -1) {
    // Nothing focused: start from what is on screen.
    const onScreen = list.findIndex(element => inViewport(element, window));
    const start = onScreen == -1 ? 0 : onScreen;
    index = offset > 0 ? start + offset - 1 : start + offset;
  } else {
    index = current + offset;
  }
  focusField(list[((index % list.length) + list.length) % list.length]);
}

function first({ actor, document, window }, { count = 1 }) {
  const visible = fields(document).filter(element =>
    inViewport(element, window)
  );
  if (!visible.length) {
    // No field to type in: pass keys to the page, like `I`.
    actor.setMode("i", { explicit: true });
    return;
  }
  focusField(visible[Math.min(count, visible.length) - 1]);
}

export const actions = {
  "input.first": first,

  // A count says which field, and one field needs no choosing. Agents have
  // `input.first`: labels would wait for keys they do not press.
  "input.choose": async function (context, { count }) {
    const { actor, window } = context;
    const choices = count === undefined ? fieldsToChoose(window) : [];
    if (choices.length > 1) {
      await labelElements(
        actor,
        window,
        () => fieldsToChoose(window),
        focusField
      );
    } else if (choices.length) {
      focusField(choices[0]);
    } else {
      // A field that something clear lies over is still the one to type in.
      first(context, { count });
    }
  },

  "input.last": function ({ actor, document }, { count = 1 }) {
    const last = actor.lastInput;
    if (last && ZendiaDom.isEditable(last) && isShown(last)) {
      focusField(last);
      return;
    }
    const list = fields(document);
    if (list.length) {
      focusField(list[Math.min(count, list.length) - 1]);
    }
  },

  "input.next": (context, { count = 1 }) => step(context, count),
  "input.prev": (context, { count = 1 }) => step(context, -count),
};
