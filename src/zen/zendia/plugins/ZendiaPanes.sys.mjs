// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The keys between Zendia's panels (the agents panel, the agent's and the
// web chat's) and the page, as LazyVim's <C-h>/<C-l> go between windows and
// vim-tmux-navigator's <C-\> goes back to the last one.
//
// What is on screen makes a row: the panels at the left, the page, the
// panels at the right. <C-h> and <C-l> step along it. On the page they move
// between Zen's split view panes first (splits.focus*, left as it is), and
// step into a panel only when no pane is that way. <C-\> goes back to where
// the keys were before: from the page to the panel used last, from a panel
// to the page. At the end of the row a key does nothing: it never reaches
// the browser's own shortcut (Ctrl+L, the address bar).
//
// In a panel these keys are not the page's, so Zendia hands them here
// before the panel sees them (Zendia.sys.mjs), except <C-h> in a text field,
// which deletes a character as in insert mode: <Esc> leaves the chat box.

/**
 * Where the keys can go in a window: the page, or one of the panels.
 */
export class ZendiaPaneFocus {
  #window;
  #panels;
  // The places the keys went, the latest first: "page" or a panel.
  #recent = ["page"];

  /**
   * @param {Window} window
   * @param {object[]} panels The panels, each with isOpen, side,
   *   contains(node), focus() and getBoundingClientRect().
   */
  constructor(window, panels) {
    this.#window = window;
    this.#panels = panels.filter(Boolean);
    window.addEventListener(
      "focusin",
      event => {
        const place = this.placeOf(event.target);
        if (place && place != this.#recent[0]) {
          this.#recent = [
            place,
            ...this.#recent.filter(other => other != place),
          ];
        }
      },
      true
    );
  }

  /**
   * @param {Node} node
   * @returns {"page"|object|null} The panel the node is part of, "page" for
   *   a tab's page, or null for the rest of the browser UI.
   */
  placeOf(node) {
    if (!node) {
      return null;
    }
    const panel = this.#panels.find(
      candidate => candidate.isOpen && candidate.contains(node)
    );
    if (panel) {
      return panel;
    }
    return node.localName == "browser" &&
      this.#window.gBrowser.getTabForBrowser(node)
      ? "page"
      : null;
  }

  /**
   * Where the keys are now: a panel, or the page when they are anywhere
   * else.
   *
   * @returns {"page"|object}
   */
  get current() {
    return this.placeOf(this.#window.document.activeElement) ?? "page";
  }

  /**
   * Give the keys to the page or a panel beside the current place.
   *
   * @param {number} dx -1 left, 1 right.
   * @returns {boolean} Whether there was one that way.
   */
  step(dx) {
    const row = this.#row();
    const next = row[row.indexOf(this.current) + dx];
    if (!next) {
      return false;
    }
    this.#focus(next);
    return true;
  }

  /**
   * Give the keys back to where they were before: the page, or the panel
   * used last from the page.
   *
   * @returns {boolean} Whether there was a place to go back to.
   */
  last() {
    const current = this.current;
    const open = this.#row();
    const target = this.#recent.find(
      place => place != current && open.includes(place)
    );
    if (!target) {
      return false;
    }
    this.#focus(target);
    return true;
  }

  // The panels at the left, the page, the panels at the right, as they show.
  #row() {
    const open = this.#panels
      .filter(panel => panel.isOpen)
      .map(panel => ({ panel, x: panel.getBoundingClientRect().left }))
      .sort((a, b) => a.x - b.x);
    const at = side =>
      open.filter(({ panel }) => panel.side == side).map(({ panel }) => panel);
    return [...at("left"), "page", ...at("right")];
  }

  #focus(place) {
    if (place == "page") {
      this.#window.gBrowser.selectedBrowser.focus();
    } else {
      place.focus();
    }
  }
}

// From the page, a split view pane that way goes first; from a panel, or
// with no pane that way, the row of panels and page.
function go(dx, dy, split) {
  return {
    desc: {
      "-1,0": "Go to Left Window",
      "1,0": "Go to Right Window",
      "0,1": "Go to Lower Window",
      "0,-1": "Go to Upper Window",
    }[`${dx},${dy}`],
    agent: false,
    async run(context) {
      const { zendia, window } = context;
      const panes = zendia.panesFor(window);
      if (panes && panes.current != "page") {
        if (dx) {
          panes.step(dx);
        }
        return;
      }
      const tab = window.gBrowser.selectedTab;
      await zendia.run(split, {}, context);
      if (dx && window.gBrowser.selectedTab == tab) {
        panes?.step(dx);
      }
    },
  };
}

export const ZendiaPanesSpec = {
  name: "panes",
  actions: {
    "panes.focusLeft": go(-1, 0, "splits.focusLeft"),
    "panes.focusDown": go(0, 1, "splits.focusDown"),
    "panes.focusUp": go(0, -1, "splits.focusUp"),
    "panes.focusRight": go(1, 0, "splits.focusRight"),
    "panes.last": {
      desc: "Go to Last Window",
      agent: false,
      run: ({ zendia, window }) => zendia.panesFor(window)?.last(),
    },
  },
};
