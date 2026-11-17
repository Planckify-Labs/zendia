// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The way to the web chat panel with the mouse: an icon button like Chat's
// (ZendiaChatButton.sys.mjs), a toolbar widget the user can add, move or
// take out. Only its icon shows, the name is in the tooltip.

import { ZendiaOptions } from "resource:///modules/zendia/config/ZendiaOptions.sys.mjs";
import { PREF_SINGLE_TOOLBAR } from "resource:///modules/zendia/ui/ZendiaChatButton.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  CustomizableUI:
    "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
});

const WIDGET_ID = "zendia-webchat-button";
const LABEL = "Web chat";

let gRegistered = false;

function singleToolbar() {
  return Services.prefs.getBoolPref(PREF_SINGLE_TOOLBAR, true);
}

function tooltip({ open, name }) {
  if (open) {
    return "Close web chat";
  }
  const key = ZendiaOptions.enabled ? " (<leader>aw)" : "";
  return `Chat with ${name ?? "ChatGPT, Claude, Gemini and more"} on the web${key}`;
}

export const ZendiaWebChatButton = {
  WIDGET_ID,

  /**
   * Add the widget, once per session.
   *
   * @param {object} options
   * @param {(window: Window) => void} options.onToggle Called on a click.
   */
  register({ onToggle }) {
    if (gRegistered) {
      return;
    }
    gRegistered = true;
    lazy.CustomizableUI.createWidget({
      id: WIDGET_ID,
      type: "button",
      label: LABEL,
      tooltiptext: "Chat with ChatGPT, Claude, Gemini and more on the web",
      localized: false,
      // With Zen's single toolbar the rows around the sidebar are full (Chat
      // already leaves the space switcher little room): there it waits in
      // the palette of Customize Toolbar, and the agent panel's header has a
      // button for it. The top bar of the multiple toolbars has room.
      defaultArea: singleToolbar() ? null : lazy.CustomizableUI.AREA_NAVBAR,
      overflows: false,
      onCommand: event => onToggle(event.target.documentGlobal),
    });
  },
};

/**
 * The web chat button of one window, showing the panel's state.
 */
export class ZendiaWebChatBar {
  #window;
  #dock;

  /**
   * @param {Window} window A browser window.
   * @param {object} options
   * @param {object} options.dock The window's ZendiaWebChatDock.
   */
  constructor(window, { dock }) {
    this.#window = window;
    this.#dock = dock;
    this.sync();
  }

  /**
   * Show the panel's state on the button: pressed while it is open, a dot in
   * the site's color while a page of it loads with the panel closed.
   */
  sync() {
    const button = this.#window.document.getElementById(WIDGET_ID);
    if (!button) {
      return;
    }
    const status = this.#dock.status;
    button.setAttribute("aria-pressed", String(status.open));
    button.setAttribute("tooltiptext", tooltip(status));
    button.toggleAttribute("running", status.loading && !status.open);
    button.style.setProperty("--zendia-agent-color", status.color);
  }
}
