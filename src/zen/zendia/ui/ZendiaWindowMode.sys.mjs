// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { ZendiaDom } from "resource:///modules/zendia/core/ZendiaDom.sys.mjs";
import { lastUsed } from "resource:///modules/zendia/plugins/ZendiaTabs.sys.mjs";
import { ZendiaHints } from "resource:///modules/zendia/ui/ZendiaHints.sys.mjs";

const HTML_NS = "http://www.w3.org/1999/xhtml";

const SIDES = ["left", "right", "top", "bottom"];

// What a tab brought into the split does at each side of a pane, as the
// label of a tab dragged there says.
const ADD_LABELS = {
  left: "Split left",
  right: "Split right",
  top: "Split above",
  bottom: "Split below",
};

// What a pane or tab carried to an edge of the split does there.
const EDGE_LABELS = {
  left: "Move to left edge",
  right: "Move to right edge",
  top: "Move to top",
  bottom: "Move to bottom",
};
const ADD_EDGE_LABELS = {
  left: "Split at left edge",
  right: "Split at right edge",
  top: "Split at top",
  bottom: "Split at bottom",
};

const centerOf = rect => [
  (rect.left + rect.right) / 2,
  (rect.top + rect.bottom) / 2,
];

/**
 * Zendia's window mode ("w"), LazyVim's window hydra for the split view:
 * every pane's chip shows, numbered, and the keys do what the pointer does
 * to the panes. A pane can be picked up and carried to a side of another or
 * onto it, and a tab from the space brought in at a side of any pane; the
 * place it would land shows as a drag shows it, with the same labels.
 *
 * Keys the mode has no use for leave it and do their usual job, so it never
 * holds on to the keyboard.
 */
export class ZendiaWindowMode {
  mode = "w";
  leavesOnUnmapped = true;

  #window;
  #onChange;
  #open = false;
  #controller = null;
  #focusSink = null;
  /**
   * What is being carried, while something is.
   *
   * @type {{tab: Element, place: Function|null, targets: object[], index: number}|null}
   */
  #carry = null;
  // Whether the mode opened only to carry something, and goes once it lands.
  #closeAfterCarry = false;
  /** @type {ZendiaHints|null} The window picker's labels, while they show. */
  #hints = null;

  /**
   * @param {Window} window A browser window.
   * @param {object} options
   * @param {() => void} options.onChange Called when it opens or closes.
   */
  constructor(window, { onChange }) {
    this.#window = window;
    this.#onChange = onChange;
  }

  get isOpen() {
    return this.#open;
  }

  get carrying() {
    return !!this.#carry;
  }

  get #splitter() {
    return this.#window.gZenViewSplitter;
  }

  open() {
    if (this.#open) {
      this.refresh();
      return;
    }
    const window = this.#window;
    this.#open = true;
    window.document.documentElement.setAttribute("zendia-window-mode", "true");
    this.#controller = new window.AbortController();
    const { signal } = this.#controller;
    // A click ends the mode, but the chips it opened still work.
    window.addEventListener(
      "mousedown",
      event => {
        if (
          !event.target.closest?.(
            ".zen-view-splitter-header-container, menupopup, panel"
          )
        ) {
          this.close();
        }
      },
      { capture: true, signal }
    );
    window.addEventListener(
      "focusin",
      event => {
        if (event.target.localName == "browser") {
          window.setTimeout(() => this.#open && this.#focus(), 0);
        }
      },
      { capture: true, signal }
    );
    // The numbers follow the panes, however they changed.
    for (const type of [
      "TabSelect",
      "TabClose",
      "ZenViewSplitter:SplitViewActivated",
      "ZenViewSplitter:SplitViewDeactivated",
    ]) {
      window.addEventListener(
        type,
        () => window.requestAnimationFrame(() => this.refresh()),
        { signal }
      );
    }
    this.#focus();
    this.refresh();
    this.#onChange();
  }

  close() {
    if (!this.#open) {
      return;
    }
    const window = this.#window;
    this.#hints?.finish(null);
    this.#endCarry();
    this.#closeAfterCarry = false;
    this.#open = false;
    this.#controller.abort();
    window.document.documentElement.removeAttribute("zendia-window-mode");
    this.#splitter?.setPaneChipsShown(false);
    if (this.#focusSink?.contains(window.document.activeElement)) {
      window.gBrowser.selectedBrowser.focus();
    }
    this.#focusSink?.remove();
    this.#focusSink = null;
    this.#onChange();
  }

  /**
   * Who a key belongs to while the mode is on.
   *
   * @param {KeyboardEvent} event
   * @returns {"window"|"handled"|"other"}
   */
  routeKey(event) {
    if (this.#hints && !this.#hints.done) {
      this.#hints.handleKey(event);
      return "handled";
    }
    const document = this.#window.document;
    if (
      document.getElementById("zendia-picker") ||
      ZendiaDom.isEditable(ZendiaDom.deepActiveElement(document))
    ) {
      return "other";
    }
    return "window";
  }

  refresh() {
    if (!this.#open) {
      return;
    }
    this.#splitter?.setPaneChipsShown(true);
    if (this.#carry) {
      this.#showTarget();
    }
  }

  /**
   * Pick up the selected pane, to put it at a side of another pane, swap it
   * with one or move it to an edge. Nothing moves until the drop: the place
   * it would land shows until <CR> puts it there or <Esc> leaves it.
   *
   * @param {object} [options]
   * @param {string} [options.edge] Start at this edge of the split instead
   *   of over the middle of the pane used last.
   * @returns {boolean} Whether there was another pane to carry it to.
   */
  grab({ edge = null } = {}) {
    const { gBrowser } = this.#window;
    const tab = gBrowser.selectedTab;
    const panes = this.#splitter.panesInOrder();
    if (panes.length < 2 || !panes.includes(tab)) {
      return false;
    }
    const others = panes.filter(pane => pane != tab);
    const first = lastUsed(others) ?? others[0];
    this.#startCarry(
      tab,
      null,
      edge ? { edge } : { tab: first, side: "center" }
    );
    this.#splitter.setCarriedPane(tab);
    return true;
  }

  /**
   * Bring a tab into the split, at a side of any pane. It starts at the
   * right of the selected pane.
   *
   * @param {Element} tab
   * @param {(targetTab: Element, side: string, edge?: string) => void} place
   *   Puts the tab at that side of that pane, or, given an edge, at that
   *   edge of the split.
   */
  carryIn(tab, place) {
    const selected = this.#window.gBrowser.selectedTab;
    this.#startCarry(tab, place, { tab: selected, side: "right" });
  }

  #startCarry(tab, place, start) {
    if (!this.#open) {
      this.open();
      this.#closeAfterCarry = true;
    }
    const targets = this.#targets(place ? null : tab, !!place);
    const index = targets.findIndex(target =>
      start.edge
        ? target.edge == start.edge
        : !target.edge && target.tab == start.tab && target.side == start.side
    );
    this.#carry = { tab, place, targets, index: Math.max(0, index) };
    this.#showTarget();
    this.#onChange();
  }

  // The panes on screen with their places in percent of the split view; a
  // lone tab fills it.
  #panes() {
    const splitter = this.#splitter;
    const tabs = splitter.panesInOrder();
    if (!tabs.length) {
      const tab = this.#window.gBrowser.selectedTab;
      return [{ tab, left: 0, right: 100, top: 0, bottom: 100 }];
    }
    return tabs.map(tab => {
      const at = splitter.getSplitNodeFromTab(tab)?.positionToRoot ?? {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      };
      return {
        tab,
        left: at.left,
        right: 100 - at.right,
        top: at.top,
        bottom: 100 - at.bottom,
      };
    });
  }

  // Where a carried pane or tab can land: each side of every other pane,
  // and, for a pane, the middle of one to swap with it.
  #targets(carried, adding) {
    const targets = [];
    for (const pane of this.#panes()) {
      if (pane.tab == carried) {
        continue;
      }
      const width = pane.right - pane.left;
      const height = pane.bottom - pane.top;
      const halves = {
        left: { ...pane, right: pane.left + width / 2 },
        right: { ...pane, left: pane.left + width / 2 },
        top: { ...pane, bottom: pane.top + height / 2 },
        bottom: { ...pane, top: pane.top + height / 2 },
      };
      for (const side of SIDES) {
        targets.push({
          tab: pane.tab,
          side,
          rect: halves[side],
          label: adding ? ADD_LABELS[side] : "Move here",
        });
      }
      if (!adding) {
        targets.push({
          tab: pane.tab,
          side: "center",
          rect: pane,
          label: "Swap",
        });
      }
    }
    // The edges of the split, the whole height or width of it, with the
    // share the pane would take there.
    for (const edge of SIDES) {
      const share = this.#splitter.edgeShare(carried, edge) * 100;
      const rect = { left: 0, right: 100, top: 0, bottom: 100 };
      if (edge == "left") {
        rect.right = share;
      } else if (edge == "right") {
        rect.left = 100 - share;
      } else if (edge == "top") {
        rect.bottom = share;
      } else {
        rect.top = 100 - share;
      }
      targets.push({
        edge,
        rect,
        label: (adding ? ADD_EDGE_LABELS : EDGE_LABELS)[edge],
      });
    }
    return targets;
  }

  #showTarget() {
    const carry = this.#carry;
    const target = carry?.targets[carry.index];
    if (!target) {
      return;
    }
    const { rect } = target;
    this.#splitter.showDropPreview(
      {
        top: rect.top,
        right: 100 - rect.right,
        bottom: 100 - rect.bottom,
        left: rect.left,
      },
      target.label,
      carry.tab
    );
  }

  /**
   * Move the landing place to the nearest one in a direction, the way the
   * focus moves between panes.
   *
   * @param {number} dx -1 left, 1 right, 0 vertical.
   * @param {number} dy -1 up, 1 down, 0 horizontal.
   */
  moveTarget(dx, dy) {
    const carry = this.#carry;
    if (!carry) {
      return;
    }
    const [x, y] = centerOf(carry.targets[carry.index].rect);
    let best = -1;
    let bestScore = Infinity;
    carry.targets.forEach((target, i) => {
      // The edges are reached with H, J, K and L, not stepped onto.
      if (target.edge) {
        return;
      }
      const [tx, ty] = centerOf(target.rect);
      const along = dx ? (tx - x) * dx : (ty - y) * dy;
      const across = dx ? Math.abs(ty - y) : Math.abs(tx - x);
      if (along <= 0.5) {
        return;
      }
      const score = along + 2 * across;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0) {
      carry.index = best;
      this.#showTarget();
    }
  }

  /**
   * The window picker: a label on every pane's chip, and typing one goes to
   * that pane, or, while something is carried, moves where it would land
   * onto it. Any other key puts the labels away.
   */
  async pick() {
    // A carried pane cannot land on itself, so it gets no label.
    const carried = this.#carry?.place ? null : this.#carry?.tab;
    const panes = this.#splitter.panesInOrder().filter(tab => tab != carried);
    if (panes.length < (carried ? 1 : 2) || this.#hints) {
      return;
    }
    const opened = !this.#open;
    this.open();
    const chips = panes.map(tab => this.#splitter.paneChipOf(tab));
    if (chips.includes(null)) {
      return;
    }
    this.#hints = new ZendiaHints(chips);
    const index = await this.#hints.picked;
    this.#hints = null;
    if (!this.#open) {
      return;
    }
    const tab = panes[index];
    if (tab && this.#carry) {
      this.#targetTab(tab);
      return;
    }
    if (tab) {
      this.#window.gBrowser.selectedTab = tab;
    }
    // Opened for the pick alone: done once it is made.
    if (opened) {
      this.close();
      if (tab) {
        this.#splitter.flashPaneChip(tab);
      }
    }
  }

  // Move the landing place onto a pane: its middle for a pane, the same
  // side as now for a tab.
  #targetTab(tab) {
    const carry = this.#carry;
    const side = carry.place
      ? (carry.targets[carry.index].side ?? "right")
      : "center";
    const index = carry.targets.findIndex(
      target => !target.edge && target.tab == tab && target.side == side
    );
    if (index >= 0) {
      carry.index = index;
      this.#showTarget();
    }
  }

  /**
   * Move the landing place to an edge of the split.
   *
   * @param {"left"|"right"|"top"|"bottom"} edge
   */
  targetEdge(edge) {
    const carry = this.#carry;
    const index = carry?.targets.findIndex(target => target.edge == edge);
    if (index >= 0) {
      carry.index = index;
      this.#showTarget();
    }
  }

  /**
   * Put what is carried where the landing place is.
   */
  drop() {
    const carry = this.#carry;
    if (!carry) {
      return;
    }
    const target = carry.targets[carry.index];
    if (target.edge) {
      this.#dropAtEdge(target.edge);
      return;
    }
    this.#endCarry();
    if (carry.place) {
      carry.place(target.tab, target.side);
    } else {
      this.#splitter.movePane(carry.tab, target.tab, target.side);
      this.#window.gBrowser.selectedTab = carry.tab;
    }
    this.#afterCarry();
  }

  // Put what is carried at an edge of the split, the whole height or width
  // of it.
  #dropAtEdge(side) {
    const carry = this.#carry;
    if (!carry) {
      return;
    }
    this.#endCarry();
    const { gBrowser } = this.#window;
    if (carry.place) {
      carry.place(gBrowser.selectedTab, "right", side);
    } else {
      this.#splitter.movePaneToEdge(carry.tab, side);
      gBrowser.selectedTab = carry.tab;
    }
    this.#afterCarry();
  }

  /**
   * Put what is carried back where it was.
   */
  cancel() {
    if (!this.#carry) {
      return;
    }
    this.#endCarry();
    this.#afterCarry();
  }

  #endCarry() {
    if (!this.#carry) {
      return;
    }
    this.#carry = null;
    this.#splitter?.hideDropPreview();
    this.#splitter?.setCarriedPane(null);
  }

  #afterCarry() {
    if (this.#closeAfterCarry) {
      this.#closeAfterCarry = false;
      this.close();
      this.#splitter.flashPaneChip(this.#window.gBrowser.selectedTab);
      return;
    }
    this.refresh();
    this.#onChange();
  }

  #focus() {
    const document = this.#window.document;
    if (!this.#focusSink) {
      this.#focusSink = document.createElementNS(HTML_NS, "div");
      this.#focusSink.id = "zendia-window-focus";
      this.#focusSink.tabIndex = -1;
      this.#focusSink.setAttribute("role", "application");
      this.#focusSink.setAttribute("aria-label", "Window mode");
      (
        document.getElementById("tabbrowser-tabbox") ?? document.documentElement
      ).append(this.#focusSink);
    }
    this.#focusSink.focus();
  }
}
