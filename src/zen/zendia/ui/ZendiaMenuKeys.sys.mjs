// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { ZendiaDom } from "resource:///modules/zendia/core/ZendiaDom.sys.mjs";
import { ZendiaKeys } from "resource:///modules/zendia/core/ZendiaKeys.sys.mjs";

// Keys that move through a menu or panel the way the arrow keys do.
const MENU_KEYS = {
  j: "ArrowDown",
  "<C-n>": "ArrowDown",
  "<C-j>": "ArrowDown",
  k: "ArrowUp",
  "<C-p>": "ArrowUp",
  "<C-k>": "ArrowUp",
  h: "ArrowLeft",
  l: "ArrowRight",
  q: "Escape",
};

const KEY_CODES = {
  ArrowDown: 40,
  ArrowUp: 38,
  ArrowLeft: 37,
  ArrowRight: 39,
  Escape: 27,
};

/** @type {WeakMap<Window, nsITextInputProcessor>} */
const processors = new WeakMap();

/**
 * Type a key the way the keyboard would, for browser UI that only listens
 * to the arrow keys and Escape. It is trusted, so it passes through the
 * window's key listeners like a real one.
 *
 * @param {Window} window
 * @param {"ArrowDown"|"ArrowUp"|"ArrowLeft"|"ArrowRight"|"Escape"} key
 */
export function sendKey(window, key) {
  let tip = processors.get(window);
  if (!tip) {
    tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(
      Ci.nsITextInputProcessor
    );
    processors.set(window, tip);
  }
  if (!tip.beginInputTransaction(window, () => true)) {
    return;
  }
  const keyEvent = new window.KeyboardEvent("", {
    key,
    code: key,
    keyCode: KEY_CODES[key],
  });
  tip.keydown(keyEvent);
  tip.keyup(keyEvent);
}

// Popups that take the keyboard: menus, and panels that are focused or
// navigate with the arrow keys (PanelMultiView, like the main menu).
// Autocomplete popups follow a field the user types in, and other
// noautofocus panels, like permission prompts, leave the keys with the
// page.
function isKeyNavigable(popup) {
  if (popup.localName == "menupopup") {
    return true;
  }
  return (
    popup.localName == "panel" &&
    !popup.getAttribute("type")?.startsWith("autocomplete") &&
    (popup.getAttribute("noautofocus") != "true" ||
      !!popup.querySelector("panelmultiview"))
  );
}

// Whether a panel shows an extension's page, like a toolbar button's popup.
// Its keys are that page's, as they are in a tab.
function showsExtensionPage(popup) {
  return [
    ...popup.querySelectorAll('browser[webextension-view-type="popup"]'),
  ].some(browser => browser.checkVisibility());
}

// How long after the page offers a translation its panel may open and still
// be the offer's: the panel opens once the page's language is looked up.
const OFFER_MS = 3000;

/**
 * vim keys in the window's open menus and panels: the main menu, context
 * menus, a toolbar button's dropdown. While one is open, keys belong to it;
 * j and k move like the arrow keys, l opens a submenu and h leaves it.
 *
 * A panel that opened on its own, like the translation a page offers, leaves
 * the keys with the page until the focus goes into it. <Esc> closes it, as
 * it closes any panel.
 */
export class ZendiaMenuKeys {
  #window;
  /** @type {Set<Element>} */
  #open = new Set();
  /** @type {WeakSet<Element>} */
  #unasked = new WeakSet();
  #offeredAt = -Infinity;

  /**
   * @param {Window} window A browser window.
   */
  constructor(window) {
    this.#window = window;
    window.addEventListener(
      "TranslationsParent:OfferTranslation",
      () => {
        this.#offeredAt = ChromeUtils.now();
      },
      true
    );
    window.addEventListener(
      "popupshown",
      event => {
        const popup = event.target;
        if (!isKeyNavigable(popup)) {
          return;
        }
        this.#open.add(popup);
        if (
          popup.id == "full-page-translations-panel" &&
          ChromeUtils.now() - this.#offeredAt < OFFER_MS
        ) {
          this.#offeredAt = -Infinity;
          this.#unasked.add(popup);
        } else {
          this.#unasked.delete(popup);
        }
      },
      true
    );
    window.addEventListener(
      "popuphidden",
      event => this.#open.delete(event.target),
      true
    );
  }

  /**
   * @returns {boolean} Whether a menu or panel is open, so keys are its.
   */
  get active() {
    for (const popup of this.#open) {
      if (!popup.isConnected || popup.state == "closed") {
        this.#open.delete(popup);
      }
    }
    const focused = this.#window.document.activeElement;
    return [...this.#open].some(
      popup =>
        !showsExtensionPage(popup) &&
        (!this.#unasked.has(popup) || popup.contains(focused))
    );
  }

  /**
   * Turn a vim key into the arrow key a menu understands. Keys typed into a
   * field in a panel are left alone.
   *
   * @param {KeyboardEvent} event
   */
  handleKey(event) {
    const document = this.#window.document;
    const key = MENU_KEYS[ZendiaKeys.fromEvent(event)];
    if (!key || ZendiaDom.isEditable(ZendiaDom.deepActiveElement(document))) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // Once the key being handled is done: a key cannot be sent while
    // another is still being dispatched.
    this.#window.setTimeout(() => sendKey(this.#window, key), 0);
  }
}
