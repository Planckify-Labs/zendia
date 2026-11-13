// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The way to the agent panel with the mouse, vim mode on or off. Chat is a
// toolbar widget, a toolbarbutton so the keys of the toolbar and the explorer
// reach it like any other button: in the top bar with Zen's multiple
// toolbars. With Zen's single toolbar the row above the sidebar is full
// (148px, its reload button already overflows), so it goes to the row below
// the sidebar instead, before the + button. It can be moved or removed like
// any other widget; where the user puts it is left alone.
//
// In compact mode the single toolbar still has a top bar, the strip with the
// window buttons that comes down when the mouse reaches the top edge. It is
// no toolbar area, so a button of its own shows Chat there, for as long as
// the widget is in the toolbars, and the row below the sidebar drops its own.

import { ZendiaOptions } from "resource:///modules/zendia/config/ZendiaOptions.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  CustomizableUI:
    "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
});

const WIDGET_ID = "zendia-chat-button";
const TOP_BAR_ID = "zendia-chat-topbar";
const LABEL = "Chat";
const PREF_SINGLE_TOOLBAR = "zen.view.use-single-toolbar";
const PREF_NO_WINDOW_CONTROLS = "zen.view.experimental-no-window-controls";
const PREF_IN_TITLEBAR = "browser.tabs.inTitlebar";
const FOOT_AREA = "zen-sidebar-foot-buttons";
// The foot row's + button, which Chat goes before.
const CREATE_BUTTON = "zen-create-new-button";

let gRegistered = false;

// Where Chat belongs in the current layout.
function homeArea() {
  return Services.prefs.getBoolPref(PREF_SINGLE_TOOLBAR, true)
    ? FOOT_AREA
    : lazy.CustomizableUI.AREA_NAVBAR;
}

// Put Chat in its home area: next to + in the foot row, at the end of the top
// bar.
function moveHome() {
  const area = homeArea();
  const placements = lazy.CustomizableUI.getWidgetIdsInArea(area).filter(
    id => id != WIDGET_ID
  );
  const create = placements.indexOf(CREATE_BUTTON);
  lazy.CustomizableUI.addWidgetToArea(
    WIDGET_ID,
    area,
    create == -1 ? undefined : create
  );
}

function tooltip({ open, running, unseen, name }) {
  if (open) {
    return "Close chat";
  }
  const key = ZendiaOptions.enabled ? " (<leader>aa)" : "";
  if (running) {
    return `${name} is working. Open chat${key}`;
  }
  if (unseen) {
    return `${name} finished. Open chat${key}`;
  }
  return `Chat with your agent about this tab${key}`;
}

// Show the agent panel's state on a Chat button: pressed while it is open, a
// dot in the agent's color while the agent works or has news.
function paint(button, status) {
  button.setAttribute("aria-pressed", String(status.open));
  button.setAttribute("tooltiptext", tooltip(status));
  button.toggleAttribute("running", status.running && !status.open);
  button.toggleAttribute("unseen", status.unseen && !status.open);
  button.style.setProperty("--zendia-agent-color", status.color);
}

export const ZendiaChatButton = {
  WIDGET_ID,
  TOP_BAR_ID,

  /**
   * Add the widget, once per session, where the layout has room for it.
   *
   * @param {object} options
   * @param {(window: Window) => void} options.onToggle Called on a click.
   */
  register({ onToggle }) {
    if (gRegistered) {
      return;
    }
    gRegistered = true;
    const placedBefore = !!lazy.CustomizableUI.getPlacementOfWidget(WIDGET_ID);
    lazy.CustomizableUI.createWidget({
      id: WIDGET_ID,
      type: "button",
      label: LABEL,
      tooltiptext: "Chat with your agent about this tab",
      localized: false,
      defaultArea: homeArea(),
      // Kept in sight rather than in an overflow menu.
      overflows: false,
      onCommand: event => onToggle(event.target.documentGlobal),
    });
    // A new widget lands at the end of its area; in the foot row it belongs
    // before +.
    if (!placedBefore) {
      moveHome();
    }
    // Zen's layout can change while the browser runs, or while it was closed:
    // a button saved in the top bar by a multiple-toolbar session must not
    // stay there once the single toolbar is back. It follows the layout from
    // one home to the other, but stays wherever the user moved it.
    const followLayout = () => {
      const area = lazy.CustomizableUI.getPlacementOfWidget(WIDGET_ID)?.area;
      const homes = [FOOT_AREA, lazy.CustomizableUI.AREA_NAVBAR];
      if (homes.includes(area) && area != homeArea()) {
        moveHome();
      }
    };
    followLayout();
    Services.prefs.addObserver(PREF_SINGLE_TOOLBAR, followLayout);
  },
};

/**
 * Chat in one window: the widget, and the button in the compact top bar.
 */
export class ZendiaChatBar {
  #window;
  #dock;
  #holder;
  #button;

  /**
   * @param {Window} window A browser window.
   * @param {object} options
   * @param {object} options.dock The window's ZendiaAgentDock.
   * @param {() => void} options.onToggle Called on a click.
   */
  constructor(window, { dock, onToggle }) {
    this.#window = window;
    this.#dock = dock;
    const document = window.document;
    // The toolbar's keys look for buttons inside the roots they are given.
    this.#holder = document.createXULElement("hbox");
    this.#holder.id = `${TOP_BAR_ID}-box`;
    this.#holder.hidden = true;
    this.#button = document.createXULElement("toolbarbutton");
    this.#button.id = TOP_BAR_ID;
    this.#button.className = "toolbarbutton-1";
    this.#button.setAttribute("label", LABEL);
    this.#button.addEventListener("command", onToggle);
    this.#holder.append(this.#button);
    const bar = document.getElementById("zen-appcontent-navbar-container");
    bar?.insertBefore(
      this.#holder,
      bar.querySelector(":scope > .titlebar-buttonbox-container")
    );

    const sync = () => this.sync();
    const observer = new window.MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        "zen-compact-mode",
        "zen-has-bookmarks",
        "zen-welcome-stage",
      ],
    });
    for (const pref of [PREF_NO_WINDOW_CONTROLS, PREF_IN_TITLEBAR]) {
      Services.prefs.addObserver(pref, sync);
    }
    const wrapper = document.getElementById("zen-appcontent-navbar-wrapper");
    if (wrapper) {
      observer.observe(wrapper, {
        attributes: true,
        attributeFilter: ["should-hide"],
      });
    }
    // Taken out of the toolbars by the user, or put back.
    const onWidget = id => {
      if (id == WIDGET_ID) {
        this.sync();
      }
    };
    const listener = { onWidgetAdded: onWidget, onWidgetRemoved: onWidget };
    lazy.CustomizableUI.addListener(listener);
    window.addEventListener(
      "unload",
      () => {
        lazy.CustomizableUI.removeListener(listener);
        for (const pref of [PREF_NO_WINDOW_CONTROLS, PREF_IN_TITLEBAR]) {
          Services.prefs.removeObserver(pref, sync);
        }
      },
      { once: true }
    );
    this.sync();
  }

  // Zen marks the strip with should-hide, which also covers a window with no
  // compact mode: there it never comes down.
  get #hasTopBar() {
    const document = this.#window.document;
    const root = document.documentElement;
    // Without window buttons in it, the strip stays shut unless the bookmarks
    // toolbar keeps it (vertical-tabs-topbar.inc.css).
    const staysShut =
      (Services.prefs.getBoolPref(PREF_NO_WINDOW_CONTROLS, false) ||
        Services.prefs.getIntPref(PREF_IN_TITLEBAR, 1) == 0) &&
      !root.hasAttribute("zen-has-bookmarks");
    return (
      root.getAttribute("zen-compact-mode") == "true" &&
      !root.hasAttribute("zen-welcome-stage") &&
      !staysShut &&
      !!document
        .getElementById("zen-appcontent-navbar-wrapper")
        ?.hasAttribute("should-hide") &&
      !!lazy.CustomizableUI.getPlacementOfWidget(WIDGET_ID)
    );
  }

  /**
   * Show the agent panel's state and the window's layout on Chat.
   */
  sync() {
    const status = this.#dock.status;
    const hasTopBar = this.#hasTopBar;
    const widget = this.#window.document.getElementById(WIDGET_ID);
    if (widget) {
      paint(widget, status);
      // One Chat is enough: the row below the sidebar only has it while the
      // top bar cannot. Moved anywhere else, it is the user's to keep.
      widget.hidden =
        hasTopBar &&
        lazy.CustomizableUI.getPlacementOfWidget(WIDGET_ID)?.area == FOOT_AREA;
    }
    paint(this.#button, status);
    this.#holder.hidden = !hasTopBar;
  }
}
