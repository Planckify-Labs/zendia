// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The way to the agents panel with the mouse: a toolbar widget beside Chat
// (ZendiaChatButton.sys.mjs), in the row below the sidebar with Zen's single
// toolbar, in the top bar with its multiple toolbars. The row below the
// sidebar is short of room, so it is an icon with no name, and the icon says
// how the agents are: a count of those at work, or in amber of those that
// wait on the user. In compact mode, while the row below the sidebar is out
// of sight, a button of its own shows it in the top bar that comes down, as
// Chat's does. It can be moved or removed like any other widget.

import { ZendiaOptions } from "resource:///modules/zendia/config/ZendiaOptions.sys.mjs";
import {
  CREATE_BUTTON,
  FOOT_AREA,
  PREF_SINGLE_TOOLBAR,
  ZendiaChatButton,
  hasCompactTopBar,
  homeArea,
  syncTopBarBox,
  topBarButton,
  watchLayout,
} from "resource:///modules/zendia/ui/ZendiaChatButton.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  CustomizableUI:
    "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
});

const WIDGET_ID = "zendia-agents-button";
const TOP_BAR_ID = "zendia-agents-topbar";
const LABEL = "Agents";

let gRegistered = false;

// Put the button in its home area: just before Chat, or before + when Chat
// is not there.
function moveHome() {
  const area = homeArea();
  const placements = lazy.CustomizableUI.getWidgetIdsInArea(area).filter(
    id => id != WIDGET_ID
  );
  const chat = placements.indexOf(ZendiaChatButton.WIDGET_ID);
  const create = placements.indexOf(CREATE_BUTTON);
  const at = chat != -1 ? chat : create;
  lazy.CustomizableUI.addWidgetToArea(
    WIDGET_ID,
    area,
    at == -1 ? undefined : at
  );
}

/**
 * The tooltip for the agents' state.
 *
 * @param {{open: boolean, working: number, waiting: number,
 *   first: {name: string, label: string}|null}} status
 * @returns {string}
 */
export function agentsTooltip({ open, working, waiting, first }) {
  if (open) {
    return "Close agents";
  }
  const key = ZendiaOptions.enabled ? " (<leader>aA)" : "";
  if (waiting == 1 && first) {
    return `${first.name}: ${first.label.toLowerCase()}. Open agents${key}`;
  }
  if (waiting) {
    return `${waiting} agents need you. Open agents${key}`;
  }
  if (working) {
    return `${working == 1 ? "1 agent" : `${working} agents`} working. Open agents${key}`;
  }
  return `All your agents${key}`;
}

// Show the agents' state on a button: pressed while the panel is open, and
// unless it is open a badge of those that wait (in amber), else of those at
// work.
function paint(button, status) {
  button.setAttribute("aria-pressed", String(status.open));
  button.setAttribute("tooltiptext", agentsTooltip(status));
  const count = status.open ? 0 : status.waiting || status.working;
  if (count) {
    button.setAttribute("zendia-count", count > 9 ? "9+" : String(count));
  } else {
    button.removeAttribute("zendia-count");
  }
  button.toggleAttribute("waiting", !status.open && !!status.waiting);
  button.toggleAttribute(
    "working",
    !status.open && !status.waiting && !!status.working
  );
}

export const ZendiaAgentsButton = {
  WIDGET_ID,
  TOP_BAR_ID,

  /**
   * Add the widget, once per session, beside Chat.
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
      tooltiptext: "All your agents",
      localized: false,
      defaultArea: homeArea(),
      // Kept in sight rather than in an overflow menu.
      overflows: false,
      onCommand: event => onToggle(event.target.documentGlobal),
    });
    // A new widget lands at the end of its area; it belongs before Chat.
    if (!placedBefore) {
      moveHome();
    }
    // It follows the layout from one home to the other, as Chat does, but
    // stays wherever the user moved it.
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
 * The agents button of one window: the widget, and the button in the
 * compact top bar.
 */
export class ZendiaAgentsBar {
  #window;
  #panel;
  #button;

  /**
   * @param {Window} window A browser window.
   * @param {object} options
   * @param {object} options.panel The window's ZendiaAgentsPanel.
   * @param {() => void} options.onToggle Called on a click.
   */
  constructor(window, { panel, onToggle }) {
    this.#window = window;
    this.#panel = panel;
    this.#button = topBarButton(window, {
      id: TOP_BAR_ID,
      label: LABEL,
      onCommand: onToggle,
      first: true,
    });
    watchLayout(window, WIDGET_ID, () => this.sync());
    this.sync();
  }

  /**
   * Show the agents' state and the window's layout on the button.
   */
  sync() {
    const status = this.#panel.status;
    const hasTopBar = hasCompactTopBar(this.#window, WIDGET_ID);
    const widget = this.#window.document.getElementById(WIDGET_ID);
    if (widget) {
      paint(widget, status);
      // In the row below the sidebar only while the top bar cannot have it.
      widget.hidden =
        hasTopBar &&
        lazy.CustomizableUI.getPlacementOfWidget(WIDGET_ID)?.area == FOOT_AREA;
    }
    paint(this.#button, status);
    this.#button.hidden = !hasTopBar;
    syncTopBarBox(this.#window);
  }
}
