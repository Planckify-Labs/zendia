// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ExtensionParent: "resource://gre/modules/ExtensionParent.sys.mjs",
});

const HTML_NS = "http://www.w3.org/1999/xhtml";

// How long a key press has to open its popup before it is forgotten: the
// popup may wait for the panel and for its own page to load.
const EXPECT_MS = 4000;

// The window's popup the keys are about to open: { id, timer }.
const gExpected = new WeakMap();

// The windows that listen for popups opening.
const gListening = new WeakSet();

// The popups that were opened from the keys. A browser is made for every
// opening, so this holds for that opening only, whatever the page inside does.
const gOpenedByKeys = new WeakSet();

// The jump label colors of the window, as the sidebar's labels have them. A
// popup's page cannot see the window's variables, so they are resolved here.
function hintColors(window) {
  const document = window.document;
  const probe = document.createElementNS(HTML_NS, "div");
  probe.setAttribute(
    "style",
    "background: var(--lazyvimium-hint); color: var(--lazyvimium-hint-text);"
  );
  document.documentElement.append(probe);
  const { backgroundColor, color } = window.getComputedStyle(probe);
  probe.remove();
  return { background: backgroundColor, color };
}

// Only the popups of a toolbar button, not the hidden pages of extensions.
function isPopup(browser) {
  return browser?.getAttribute("webextension-view-type") == "popup";
}

function forget(window) {
  const expected = gExpected.get(window);
  if (expected) {
    window.clearTimeout(expected.timer);
    gExpected.delete(window);
  }
}

// The popup is on screen. It was opened from the keys if they were about to
// open this extension's, and that is spent on this one opening.
function onPopupLoaded(event) {
  const window = event.currentTarget;
  const expected = gExpected.get(window);
  const browser = event.target;
  if (!expected || expected.id != event.detail?.extension?.id) {
    return;
  }
  forget(window);
  if (!isPopup(browser)) {
    return;
  }
  gOpenedByKeys.add(browser);
  // The page may have loaded already, when the popup was preloaded as the
  // pointer went over its button.
  try {
    browser.browsingContext.currentWindowGlobal
      .getActor("LazyvimiumPopup")
      .offerHints();
  } catch {
    // The page is gone, or the actor is off.
  }
}

// Whether the extension's popup is open in the window, so that pressing its
// button closes it rather than opens it. One preloaded for a hover sits in a
// panel that is never shown.
function isOpen(window, id) {
  return [
    ...window.document.querySelectorAll(
      'browser[webextension-view-type="popup"]'
    ),
  ].some(
    browser =>
      browser.contentPrincipal?.addonId == id &&
      browser.closest("panel")?.state == "open" &&
      browser.checkVisibility()
  );
}

export const LazyvimiumPopupKeys = {
  /**
   * Say that the keys are pressing an extension's toolbar button, so that the
   * popup it opens gets jump labels. A popup opened any other way, with the
   * mouse, has none until `s` asks for them. Call it right before the press.
   *
   * @param {Window} window The browser window.
   * @param {string} id The extension's id.
   */
  expect(window, id) {
    forget(window);
    // The press closes an open popup, and nothing opens.
    if (isOpen(window, id)) {
      return;
    }
    if (!gListening.has(window)) {
      gListening.add(window);
      window.addEventListener("WebExtPopupLoaded", onPopupLoaded);
    }
    // A press that opens nothing, like a button that is disabled, leaves no
    // mark for a later click to find.
    const timer = window.setTimeout(() => gExpected.delete(window), EXPECT_MS);
    gExpected.set(window, { id, timer });
  },

  /**
   * Press an extension's toolbar button as a click does, for the keys.
   *
   * @param {Window} window The browser window.
   * @param {object} extension
   */
  trigger(window, extension) {
    this.expect(window, extension.id);
    try {
      lazy.ExtensionParent.apiManager.global
        .browserActionFor(extension)
        .triggerAction(window);
    } catch (e) {
      forget(window);
      throw e;
    }
  },
};

export class LazyvimiumPopupParent extends JSWindowActorParent {
  #loaded = false;

  receiveMessage({ name }) {
    if (name == "LazyvimiumPopup:Loaded") {
      this.#loaded = true;
      this.offerHints();
    }
  }

  /**
   * Give the page jump labels when its popup was opened from the keys. This
   * is asked when the page has loaded and when the popup is shown, whichever
   * comes last, since a page can load before the panel is opened.
   */
  offerHints() {
    const browser = this.browsingContext.top.embedderElement;
    if (this.#loaded && isPopup(browser) && gOpenedByKeys.has(browser)) {
      this.sendAsyncMessage("LazyvimiumPopup:Hints", {
        colors: hintColors(browser.documentGlobal),
      });
    }
  }
}
