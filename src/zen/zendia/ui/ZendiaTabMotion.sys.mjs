// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The page of the tab that is switched to slides into place, from below for
// a tab further down the sidebar and from above for one higher up. The motion
// starts when the page is actually on screen, never holds the keys, and gives
// way to key repeat: holding <S-j> switches as fast as it did without it.

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

const SLIDE_PX = 14;
const SLIDE_MS = 220;
const FADE_MS = 140;
const FADE_FROM = 0.35;
const EASE = "cubic-bezier(.22,1,.36,1)";
// Switches closer together than this are key repeat: they show at once.
const REPEAT_MS = 90;
// A page that takes longer than this to show comes in without the motion.
const PENDING_MS = 1500;

export class ZendiaTabMotion {
  #window;
  #reduced;
  // The switch waiting for its page to show: { panels, target, dir, at }.
  #pending = null;
  #animations = [];
  #lastSwitch = 0;

  constructor(window) {
    this.#window = window;
    this.#reduced = window.matchMedia(REDUCED_QUERY);
    const { gBrowser } = window;
    gBrowser.tabContainer.addEventListener("TabSelect", this);
    // The tab switcher marks the panel it shows once the page has painted,
    // which can be well after TabSelect.
    new window.MutationObserver(() => this.#onPanelShown()).observe(
      gBrowser.tabpanels,
      { attributes: true, attributeFilter: ["selectedIndex"] }
    );
  }

  handleEvent(event) {
    if (event.type == "TabSelect") {
      this.#onTabSelect(event.target, event.detail?.previousTab);
    }
  }

  #onTabSelect(tab, previous) {
    const now = this.#window.performance.now();
    const repeat = now - this.#lastSwitch < REPEAT_MS;
    this.#lastSwitch = now;
    this.#pending = null;
    if (repeat || !this.#shouldMove(tab, previous)) {
      this.#stop();
      return;
    }
    const target = this.#panelOf(tab);
    if (!target) {
      return;
    }
    const dir =
      previous.compareDocumentPosition(tab) &
      this.#window.Node.DOCUMENT_POSITION_FOLLOWING
        ? 1
        : -1;
    this.#pending = {
      panels: this.#panelsShownWith(tab),
      target,
      dir,
      at: now,
    };
    // A page that is ready may already be shown.
    this.#onPanelShown();
  }

  #onPanelShown() {
    const pending = this.#pending;
    if (!pending || !pending.target.classList.contains("deck-selected")) {
      return;
    }
    this.#pending = null;
    this.#stop();
    if (this.#window.performance.now() - pending.at > PENDING_MS) {
      return;
    }
    const slide = `translateY(${pending.dir * SLIDE_PX}px)`;
    for (const panel of pending.panels) {
      this.#animations.push(
        panel.animate(
          { transform: [slide, "none"] },
          { duration: SLIDE_MS, easing: EASE }
        ),
        panel.animate(
          { opacity: [FADE_FROM, 1] },
          { duration: FADE_MS, easing: "ease-out" }
        )
      );
    }
  }

  #stop() {
    for (const animation of this.#animations) {
      animation.cancel();
    }
    this.#animations = [];
  }

  #shouldMove(tab, previous) {
    const window = this.#window;
    if (
      !previous ||
      previous == tab ||
      !previous.isConnected ||
      this.#reduced.matches ||
      window.document.hidden ||
      window.document.documentElement.getAttribute("inDOMFullscreen") == "true"
    ) {
      return false;
    }
    // Zen moves its own way between spaces, into and out of a glance, and
    // to the empty tab the new tab page opens over.
    if (window.gZenWorkspaces?._animatingChange) {
      return false;
    }
    const space = t => t.getAttribute("zen-workspace-id");
    if (
      !tab.hasAttribute("zen-essential") &&
      !previous.hasAttribute("zen-essential") &&
      space(tab) != space(previous)
    ) {
      return false;
    }
    const glance = t =>
      t.hasAttribute("zen-glance-tab") || t.hasAttribute("glance-id");
    if (
      glance(tab) ||
      glance(previous) ||
      window.gZenGlanceManager?._animating ||
      tab.hasAttribute("zen-empty-tab")
    ) {
      return false;
    }
    // The panes of one split view are all on screen already.
    const group = this.#splitOf(tab);
    return !group || !group.tabs.includes(previous);
  }

  #splitOf(tab) {
    return (
      this.#window.gZenViewSplitter?._data?.find(split =>
        split.tabs.includes(tab)
      ) ?? null
    );
  }

  #panelOf(tab) {
    return this.#window.gBrowser.tabContainer.getRelatedElement(tab);
  }

  // The panels on screen once the tab is: its split view's, or its own.
  #panelsShownWith(tab) {
    const group = this.#splitOf(tab);
    const tabs = group?.zoomedTab ? [group.zoomedTab] : (group?.tabs ?? [tab]);
    return tabs.map(t => this.#panelOf(t)).filter(Boolean);
  }
}
