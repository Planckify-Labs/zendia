// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The vim mode switch: lazyvimium's Neovim-style keys, on or off at any
// time, as the onboarding offers them. A row of the app menu, above Settings:
// it is rarely flipped, and the mode indicator already shows that vim mode is
// on, so it takes no room in a toolbar.

import { LazyvimiumOptions } from "resource:///modules/lazyvimium/config/LazyvimiumOptions.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  CustomizableUI:
    "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
});

const HTML_NS = "http://www.w3.org/1999/xhtml";
const ITEM_ID = "lazyvimium-appmenu-vim-mode";
const LABEL = "Vim mode";
// The agent panel's switch, whose knob moves inside its own track.
const SWITCH_CLASS = "lazyvimium-agent-switch";
// The toolbar widget this row replaced, still saved in older profiles.
const OLD_WIDGET_ID = "lazyvimium-vim-mode-button";

let gOldWidgetRemoved = false;

function tooltip(enabled) {
  return enabled
    ? "Neovim-style keys drive the browser. Click to turn them off."
    : "Click to drive the browser with Neovim-style keys.";
}

function syncItem(item) {
  const enabled = String(LazyvimiumOptions.enabled);
  item.setAttribute("aria-checked", enabled);
  item.querySelector(`.${SWITCH_CLASS}`).setAttribute("aria-checked", enabled);
  item.setAttribute("tooltiptext", tooltip(LazyvimiumOptions.enabled));
}

export const LazyvimiumVimModeSwitch = {
  ITEM_ID,

  /**
   * Add the row to a window's app menu. The menu is built the first time it
   * opens, so the row is too.
   *
   * @param {Window} window
   */
  install(window) {
    if (!gOldWidgetRemoved) {
      gOldWidgetRemoved = true;
      if (lazy.CustomizableUI.getPlacementOfWidget(OLD_WIDGET_ID)) {
        lazy.CustomizableUI.removeWidgetFromArea(OLD_WIDGET_ID);
      }
    }
    window.addEventListener("ViewShowing", event => {
      if (event.target.id != "appMenu-mainView") {
        return;
      }
      const document = window.document;
      const settings = document.getElementById("appMenu-settings-button");
      if (!settings) {
        return;
      }
      let item = document.getElementById(ITEM_ID);
      if (!item) {
        item = document.createXULElement("toolbarbutton");
        item.id = ITEM_ID;
        item.className = "subviewbutton";
        item.setAttribute("label", LABEL);
        item.setAttribute("role", "menuitemcheckbox");
        // The menu stays open to show the switch flip.
        item.setAttribute("closemenu", "none");
        item.addEventListener("command", () => this.toggle());
        settings.before(item);
        // In a panel it waits to be shown, and a child would take its place.
        item.render();
        const track = document.createElementNS(HTML_NS, "span");
        track.className = SWITCH_CLASS;
        item.append(track);
      }
      syncItem(item);
    });
  },

  toggle() {
    Services.prefs.setBoolPref(
      LazyvimiumOptions.PREF_ENABLED,
      !LazyvimiumOptions.enabled
    );
  },

  /**
   * Show the current state in a window's row, if it has one yet.
   *
   * @param {Document} document
   */
  sync(document) {
    const item = document.getElementById(ITEM_ID);
    if (item) {
      syncItem(item);
    }
  },
};
