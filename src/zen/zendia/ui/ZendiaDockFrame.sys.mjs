// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The frame of a panel at the side of the tab, shared by the agent panel
// (ZendiaAgentDock) and the web chat panel (ZendiaWebChatDock), so the two
// lay out, resize and move alike. The frame owns the glass root, the pill
// and handle that sit beside it, and everything about where they are:
//
// - float: a card over the page, until it is closed;
// - slide: against the side of the page, hiding as Zen's compact sidebar
//   does once the mouse leaves it; a handle at that side brings it back;
// - split: beside the tab, which narrows to make room, as a split view
//   pane. When the tab, or its narrowest split view pane, would get too
//   narrow, it lays out as float (or slide, after <branch>split-fallback)
//   until there is room again.
//
// Dragging its edge on the page's side widens it, never narrower than it
// first opens; beside the tab, only as far as the tab keeps room.
//
// What goes inside the root, and what the pill and handle say, is the
// owner's. The prefs are <branch>layout, side, width and split-fallback
// (zendia.agent. and zendia.webchat.). The look is zendia.css's, which
// styles the ids <id>-dock, <id>-pill and <id>-handle.

const HTML_NS = "http://www.w3.org/1999/xhtml";

export const DOCK_LAYOUTS = {
  float: "Floating over the page",
  slide: "Slide in from the side, hide when the mouse leaves",
  split: "Side by side with the tab",
};

// A page narrower than this beside the docked panel is too cramped to use.
const MIN_PANE_WIDTH = 420;
// A floating panel's inset on each side (zendia.css).
const FLOAT_INSET = 10;
// How long the slid-in panel stays once the mouse leaves it, and how long the
// mouse rests on the handle before it slides in, after Zen's compact sidebar
// (zen.view.compact.sidebar-keep-hover.duration, hover-hack-delay).
const KEEP_HOVER_MS = 400;
const HANDLE_HOVER_MS = 100;
// Zen's compact sidebar spring (compact-mode/sidebar.inc.css), sampled
// coarser.
const SPRING =
  "linear(0, 0.0388 4%, 0.1313 8%, 0.2498 12%, 0.3757 16%, 0.497 20%, 0.6068 24%, 0.7018 28%, 0.781 32%, 0.8448 36%, 0.8948 40%, 0.9327 44%, 0.9603 48%, 0.9804 52%, 0.994 56%, 1.0025 60%, 1.0075 64%, 1.0101 68%, 1.0109 72%, 1.0104 76%, 1.0084 84%, 1.0045 95%, 1)";

export class ZendiaDockFrame {
  #window;
  #branch;
  #minWidth;
  #defaultSide;
  #defaultWidth;
  #keepOpen;
  #onLayout;
  #onPrefs;
  #onCloseRequest;
  #onOpenRequest;
  #host;
  #root;
  #pill;
  #handle;
  #grip;
  #layoutButtons = new Map();
  #sideButton = null;
  #open = false;
  #closing = false;
  #animation = null;
  #prefs;
  // The layout in use: the one picked, or its fallback while a split has no
  // room.
  #layout;
  #hovered = false;
  #hideTimer = null;
  #handleTimer = null;
  #layoutQueued = false;
  #resizing = false;
  #mounted = false;

  /**
   * @param {Window} window A browser window.
   * @param {object} options
   * @param {string} options.id The panel's name: "zendia-agent" makes the
   *   ids zendia-agent-dock, zendia-agent-pill and zendia-agent-handle.
   * @param {string} options.label The root's accessible name.
   * @param {string} options.branch The pref branch, with its trailing dot.
   * @param {number} [options.defaultWidth] The width it first opens at.
   * @param {number} [options.minWidth] The narrowest it gets.
   * @param {"left"|"right"} [options.side] The side it sits at until
   *   <branch>side says otherwise.
   * @param {() => boolean} [options.keepOpen] Whether the slid-in panel
   *   waits on the user and must not hide.
   * @param {() => void} [options.onLayout] Called after the layout is
   *   applied: the owner draws the pill and handle.
   * @param {() => void} [options.onPrefs] Called after a pref of the branch
   *   changed and the layout followed.
   * @param {() => void} options.onCloseRequest The slid-in panel wants to
   *   hide: the owner closes it.
   * @param {(options: {focus: boolean}) => void} options.onOpenRequest The
   *   handle was used: the owner opens it.
   */
  constructor(
    window,
    {
      id,
      label,
      branch,
      defaultWidth = 420,
      minWidth = 420,
      side = "right",
      keepOpen = () => false,
      onLayout = () => {},
      onPrefs = () => {},
      onCloseRequest,
      onOpenRequest,
    }
  ) {
    this.#window = window;
    this.#branch = branch;
    this.#minWidth = minWidth;
    this.#defaultSide = side == "left" ? "left" : "right";
    this.#defaultWidth = Math.max(minWidth, defaultWidth);
    this.#keepOpen = keepOpen;
    this.#onLayout = onLayout;
    this.#onPrefs = onPrefs;
    this.#onCloseRequest = onCloseRequest;
    this.#onOpenRequest = onOpenRequest;
    this.#prefs = this.#readPrefs();
    this.#layout = this.#prefs.layout;

    const document = window.document;
    const create = tag => document.createElementNS(HTML_NS, tag);
    this.#root = create("div");
    this.#root.id = `${id}-dock`;
    this.#root.hidden = true;
    this.#root.setAttribute("role", "dialog");
    this.#root.setAttribute("aria-label", label);
    // A click on the panel's text then keeps the focus in the panel. Left to
    // itself it goes to the window, where Ctrl+C is a vim key the page takes,
    // and the selected text is never copied.
    this.#root.tabIndex = -1;

    this.#pill = create("button");
    this.#pill.id = `${id}-pill`;
    this.#pill.hidden = true;

    // The slid-out panel's edge: resting the mouse on it slides it back in.
    this.#handle = create("div");
    this.#handle.id = `${id}-handle`;
    this.#handle.hidden = true;
    this.#handle.addEventListener("mouseenter", () => {
      this.#handleTimer = this.#window.setTimeout(() => {
        this.#handleTimer = null;
        this.#onOpenRequest({ focus: false });
      }, HANDLE_HOVER_MS);
    });
    this.#handle.addEventListener("mouseleave", () => {
      this.#window.clearTimeout(this.#handleTimer);
      this.#handleTimer = null;
    });
    this.#handle.addEventListener("click", () =>
      this.#onOpenRequest({ focus: true })
    );
  }

  get root() {
    return this.#root;
  }

  get pill() {
    return this.#pill;
  }

  get handle() {
    return this.#handle;
  }

  get isOpen() {
    return this.#open;
  }

  /** The side it sits at, picked in <branch>side: "left" or "right". */
  get side() {
    return this.#prefs.side;
  }

  /**
   * The layout in use, which is the one picked unless a split has no room.
   *
   * @returns {"float"|"slide"|"split"}
   */
  get layout() {
    return this.#layout;
  }

  /**
   * @param {Node} node
   * @returns {boolean} Whether the node is part of the panel, its pill or
   *   its handle.
   */
  contains(node) {
    return (
      !!node &&
      (this.#root.contains(node) ||
        this.#pill.contains(node) ||
        this.#handle.contains(node))
    );
  }

  /**
   * Put the layout and side buttons in the header, after what is there.
   *
   * @param {Element} header
   */
  addLayoutControls(header) {
    const create = (tag, className) => {
      const element = this.#window.document.createElementNS(HTML_NS, tag);
      element.className = className;
      return element;
    };
    const iconButton = (className, title) => {
      const button = create("button", `zendia-agent-icon-button ${className}`);
      button.title = title;
      button.setAttribute("aria-label", title);
      return button;
    };
    const layouts = create("div", "zendia-agent-layouts");
    layouts.setAttribute("role", "group");
    layouts.setAttribute("aria-label", "Layout");
    for (const [layout, title] of Object.entries(DOCK_LAYOUTS)) {
      const button = iconButton(`layout-${layout}`, title);
      button.addEventListener("click", () =>
        Services.prefs.setStringPref(`${this.#branch}layout`, layout)
      );
      layouts.append(button);
      this.#layoutButtons.set(layout, button);
    }
    this.#sideButton = iconButton("side", "");
    this.#sideButton.addEventListener("click", () =>
      Services.prefs.setStringPref(
        `${this.#branch}side`,
        this.#prefs.side == "right" ? "left" : "right"
      )
    );
    header.append(layouts, this.#sideButton);
  }

  /**
   * Put the panel in the window, once its content is in the root. Nothing
   * is visible until show().
   */
  mount() {
    if (this.#mounted) {
      return;
    }
    this.#mounted = true;
    const window = this.#window;
    const document = window.document;

    this.#grip = document.createElementNS(HTML_NS, "div");
    this.#grip.className = "zendia-agent-grip";
    this.#grip.setAttribute("role", "separator");
    this.#grip.setAttribute("aria-orientation", "vertical");
    this.#grip.addEventListener("pointerdown", event =>
      this.#startResize(event)
    );
    this.#grip.addEventListener("dblclick", () =>
      Services.prefs.clearUserPref(`${this.#branch}width`)
    );
    this.#root.append(this.#grip);

    this.#root.addEventListener("mouseenter", () => {
      this.#hovered = true;
      this.cancelHide();
    });
    this.#root.addEventListener("mouseleave", () => {
      this.#hovered = false;
      this.#scheduleHide();
    });

    // Beside the tab box, where Zen's split view panes and sidebar sit.
    this.#host =
      document.getElementById("zen-tabbox-wrapper") ??
      document.getElementById("browser") ??
      document.documentElement;
    this.#host.append(this.#root, this.#pill, this.#handle);

    const relayout = () => this.#queueLayout();
    window.gBrowser.tabContainer.addEventListener("TabSelect", relayout);
    window.addEventListener("resize", relayout);
    window.addEventListener("ZenViewSplitter:SplitViewActivated", relayout);
    window.addEventListener("ZenViewSplitter:SplitViewDeactivated", relayout);
    const onPrefs = () => {
      this.#prefs = this.#readPrefs();
      this.#applyLayout();
      this.#onPrefs();
    };
    Services.prefs.addObserver(this.#branch, onPrefs);
    window.addEventListener(
      "unload",
      () => {
        Services.prefs.removeObserver(this.#branch, onPrefs);
        window.clearTimeout(this.#hideTimer);
        window.clearTimeout(this.#handleTimer);
      },
      { once: true }
    );
    this.#applyLayout();
  }

  /**
   * Show the panel, sliding it in.
   */
  show() {
    this.#open = true;
    this.cancelHide();
    if (!this.#root.hidden && !this.#closing) {
      return;
    }
    const wasHidden = this.#root.hidden;
    this.#closing = false;
    this.#root.hidden = false;
    this.#applyLayout();
    if (wasHidden || this.#animation) {
      this.#animate(true);
    }
  }

  /**
   * Hide the panel, sliding it out.
   */
  hide() {
    this.#open = false;
    this.cancelHide();
    this.#closing = true;
    this.#animate(false).then(() => {
      if (this.#closing) {
        this.#closing = false;
        this.#root.hidden = true;
        this.#applyLayout();
      }
    });
  }

  cancelHide() {
    if (this.#hideTimer) {
      this.#window.clearTimeout(this.#hideTimer);
      this.#hideTimer = null;
    }
  }

  /**
   * Layout again, now: the owner's content changed what fits.
   */
  relayout() {
    this.#applyLayout();
  }

  #readPrefs() {
    const branch = this.#branch;
    const layout = Services.prefs.getStringPref(`${branch}layout`, "float");
    const fallback = Services.prefs.getStringPref(
      `${branch}split-fallback`,
      "float"
    );
    return {
      layout: layout in DOCK_LAYOUTS ? layout : "float",
      side:
        Services.prefs.getStringPref(`${branch}side`, this.#defaultSide) ==
        "left"
          ? "left"
          : "right",
      width: Math.max(
        this.#minWidth,
        Services.prefs.getIntPref(`${branch}width`, this.#defaultWidth)
      ),
      fallback: fallback == "slide" ? "slide" : "float",
    };
  }

  // The widest the panel can be beside the tab while the tab, and each of
  // Zen's split view panes, keep their room.
  #splitMaxWidth() {
    const window = this.#window;
    const panels = window.gBrowser.tabpanels;
    const total = panels?.getBoundingClientRect().width;
    if (!total) {
      return Infinity;
    }
    const gap =
      parseFloat(
        window
          .getComputedStyle(window.document.documentElement)
          .getPropertyValue("--zen-element-separation")
      ) || 8;
    const docked =
      this.#layout == "split" && !this.#root.hidden
        ? this.#root.getBoundingClientRect().width + gap
        : 0;
    let share = 1;
    const splitter = window.gZenViewSplitter;
    if (splitter?.splitViewActive) {
      for (const tab of splitter._data[splitter.currentView]?.tabs ?? []) {
        const pane = tab.linkedBrowser?.closest(".browserSidebarContainer");
        const width = pane?.getBoundingClientRect().width;
        if (width) {
          share = Math.min(share, width / total);
        }
      }
    }
    // Each pane keeps its share of what the panel leaves of the tab box.
    return Math.floor(total + docked - gap - MIN_PANE_WIDTH / share);
  }

  // The widest the panel can get in the layout in use.
  #maxWidth() {
    return this.#layout == "split"
      ? this.#splitMaxWidth()
      : this.#host.clientWidth - 2 * FLOAT_INSET;
  }

  #queueLayout() {
    if (this.#layoutQueued || this.#prefs.layout != "split") {
      return;
    }
    this.#layoutQueued = true;
    this.#window.requestAnimationFrame(() => {
      this.#layoutQueued = false;
      this.#applyLayout();
    });
  }

  #applyLayout() {
    const { layout: picked, side, fallback } = this.#prefs;
    const splitMax = picked == "split" ? this.#splitMaxWidth() : Infinity;
    const layout = splitMax < this.#minWidth ? fallback : picked;
    const changed = layout != this.#layout;
    this.#layout = layout;
    for (const element of [this.#root, this.#pill, this.#handle]) {
      element.setAttribute("layout", layout);
      element.setAttribute("side", side);
    }
    // Beside the tab the panel gives up its width, down to its narrowest,
    // before the tab gets too narrow.
    const width =
      layout == "split"
        ? Math.min(this.#prefs.width, splitMax)
        : this.#prefs.width;
    if (!this.#resizing) {
      this.#root.style.setProperty("--zendia-agent-width", `${width}px`);
    }
    if (this.#grip) {
      const fixed = layout == "split" && splitMax <= this.#minWidth;
      this.#grip.toggleAttribute("disabled", fixed);
      this.#grip.setAttribute("aria-disabled", String(fixed));
      this.#grip.title = fixed
        ? "No room to widen it beside this tab: float it to make it wider"
        : "Drag to resize · double-click for the narrowest";
    }
    const fellBack = picked == "split" && layout != "split";
    this.#root.toggleAttribute("fallback", fellBack);
    for (const [name, button] of this.#layoutButtons) {
      button.setAttribute("aria-pressed", String(name == picked));
    }
    const split = this.#layoutButtons.get("split");
    if (split) {
      split.title = fellBack
        ? `${DOCK_LAYOUTS.split}: no room beside this tab, so it floats for now`
        : DOCK_LAYOUTS.split;
    }
    if (this.#sideButton) {
      const other = side == "right" ? "left" : "right";
      this.#sideButton.setAttribute("side", side);
      this.#sideButton.title = `Move to the ${other}`;
      this.#sideButton.setAttribute("aria-label", this.#sideButton.title);
    }
    if (changed && this.#open && !this.#closing) {
      this.#animate(true);
    }
    if (layout != "slide") {
      this.cancelHide();
    }
    this.#onLayout();
  }

  // Dragging the edge on the page's side widens or narrows the panel; the
  // width is kept for every layout once the mouse lets go.
  #startResize(event) {
    if (event.button != 0 || this.#grip.hasAttribute("disabled")) {
      return;
    }
    event.preventDefault();
    const grip = this.#grip;
    const startX = event.clientX;
    const start = Math.round(this.#root.getBoundingClientRect().width);
    const min = this.#minWidth;
    const max = Math.max(min, this.#maxWidth());
    const sign = this.#prefs.side == "right" ? -1 : 1;
    let width = start;
    const move = moved => {
      width = Math.round(
        Math.min(max, Math.max(min, start + sign * (moved.clientX - startX)))
      );
      this.#root.style.setProperty("--zendia-agent-width", `${width}px`);
    };
    // Letting go releases the capture, as does anything that steals it.
    const end = () => {
      grip.removeEventListener("pointermove", move);
      this.#resizing = false;
      this.#root.removeAttribute("resizing");
      if (width != start) {
        Services.prefs.setIntPref(`${this.#branch}width`, width);
      }
      if (!this.#hovered) {
        this.#scheduleHide();
      }
    };
    this.#resizing = true;
    this.#root.setAttribute("resizing", "");
    grip.setPointerCapture(event.pointerId);
    grip.addEventListener("pointermove", move);
    grip.addEventListener("lostpointercapture", end, { once: true });
  }

  // Slide in from the panel's side, or out to it. Beside the tab the panel
  // starts past the tab box's edge, its outer margin taking back its width,
  // so the page makes room as it comes in and its text never reflows.
  #animate(showing) {
    this.#animation?.cancel();
    this.#animation = null;
    const window = this.#window;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return Promise.resolve();
    }
    const left = this.#prefs.side == "left";
    const sign = left ? -1 : 1;
    const outer = left ? "marginLeft" : "marginRight";
    const gap =
      parseFloat(
        window.getComputedStyle(this.#root)[left ? "marginRight" : "marginLeft"]
      ) || 0;
    const keyframes =
      this.#layout == "split"
        ? [
            {
              [outer]: `${-this.#root.getBoundingClientRect().width - gap}px`,
              opacity: 0,
            },
            { [outer]: "0px", opacity: 1 },
          ]
        : [
            {
              transform: `translateX(calc(${sign} * (100% + 24px)))`,
              opacity: 0,
            },
            { transform: "translateX(0)", opacity: 1 },
          ];
    const animation = this.#root.animate(keyframes, {
      duration: showing ? 360 : 180,
      easing: showing ? SPRING : "cubic-bezier(0.4, 0, 1, 1)",
      direction: showing ? "normal" : "reverse",
    });
    this.#animation = animation;
    return animation.finished.then(
      () => {
        if (this.#animation == animation) {
          this.#animation = null;
        }
      },
      () => {}
    );
  }

  // The slid-in panel hides a moment after the mouse leaves it, unless it
  // waits on the user.
  #scheduleHide() {
    this.cancelHide();
    if (
      this.#layout != "slide" ||
      !this.#open ||
      this.#resizing ||
      this.#keepOpen()
    ) {
      return;
    }
    this.#hideTimer = this.#window.setTimeout(() => {
      this.#hideTimer = null;
      if (!this.#hovered && !this.#keepOpen()) {
        this.#onCloseRequest();
      }
    }, KEEP_HOVER_MS);
  }
}
