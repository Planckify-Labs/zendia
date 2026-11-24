// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The card the composer's model chip opens, for the mouse: how hard the model
// thinks on a slider, its context window, and a searchable list of models.
// <leader>am keeps the keyboard picker. Layout and timing are ported from
// Zeron's compact picker (zeronsh/zeron, MIT, Copyright (c) 2026 Wing).
//
// The card only offers what the agent's CLI can honour, so a model with no
// levels has no slider and a context size that cannot be chosen is shown as
// plain text.

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ZendiaAgents: "resource:///modules/zendia/agent/ZendiaAgents.sys.mjs",
  reducedMotion: "resource:///modules/zendia/ui/ZendiaAgentMotion.sys.mjs",
  rollText: "resource:///modules/zendia/ui/ZendiaAgentMotion.sys.mjs",
});

const HTML_NS = "http://www.w3.org/1999/xhtml";

const EFFORT_LABELS = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
  ultra: "Ultra",
};

// The thumb's center never comes closer to the rail's ends than this, so at
// each end the thumb sits flush with the rail (zendia.css).
const THUMB_INSET = 20;
// The card's distance from the chip and from the window's edges.
const CHIP_GAP = 6;
const EDGE_MARGIN = 8;
// Below this much room over the chip, the card opens under it.
const MIN_ROOM_ABOVE = 180;
const SUBMENU_GAP = 5;
const SUBMENU_WIDTH = 232;
// How long the submenu waits for the pointer to cross the gap to it.
const SUBMENU_LINGER_MS = 300;
const PAGE_FADE_MS = 200;

/**
 * @param {string} effort A level as the CLI names it.
 * @returns {string} What to call it.
 */
export function effortLabel(effort) {
  return (
    EFFORT_LABELS[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1)
  );
}

/**
 * @param {number} tokens
 * @returns {string} The size as people say it: 200K, 1M.
 */
export function formatTokens(tokens) {
  return tokens >= 1000000
    ? `${Math.round(tokens / 100000) / 10}M`
    : `${Math.round(tokens / 1000)}K`;
}

/**
 * Where a pointer on the rail sits, from 0 to 1.
 *
 * @param {number} x From the rail's left edge.
 * @param {number} width The rail's width.
 * @returns {number}
 */
export function railFraction(x, width) {
  const run = width - 2 * THUMB_INSET;
  return run > 0 ? Math.min(1, Math.max(0, (x - THUMB_INSET) / run)) : 0;
}

/**
 * Models matching a search, best first: the name's start, then anywhere in
 * the name, then the id or description.
 *
 * @param {{id: string, name: string, detail?: string}[]} rows
 * @param {string} query
 * @returns {object[]}
 */
export function searchModels(rows, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return rows;
  }
  const rank = row => {
    const name = row.name.toLowerCase();
    if (name.startsWith(needle)) {
      return 0;
    }
    if (name.includes(needle)) {
      return 1;
    }
    return `${row.id} ${row.detail ?? ""}`.toLowerCase().includes(needle)
      ? 2
      : -1;
  };
  return rows
    .map((row, index) => ({ row, index, rank: rank(row) }))
    .filter(({ rank: found }) => found >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ row }) => row);
}

export class ZendiaAgentModelCard {
  #window;
  #onChange;
  #onClose;
  #anchor = null;
  #agent = null;
  // The list to pick from: {id, name, detail?, note?}.
  #rows = [];
  #root = null;
  #page = null;
  #submenu = null;
  #submenuTimer = null;
  #contextRow = null;
  #slider = null;
  #title = null;
  // The level shown, by its place on the rail.
  #index = 0;
  #efforts = [];
  #onList = false;
  #active = 0;
  #shown = [];
  #search = null;
  #listBox = null;
  #listDetail = null;
  #subActive = 0;

  /**
   * @param {Window} window A browser window.
   * @param {object} options
   * @param {() => void} options.onChange A pick changed what the chip shows.
   * @param {() => void} options.onClose The card closed.
   */
  constructor(window, { onChange, onClose }) {
    this.#window = window;
    this.#onChange = onChange;
    this.#onClose = onClose;
  }

  get isOpen() {
    return !!this.#root;
  }

  #create(tag, className, text) {
    const element = this.#window.document.createElementNS(HTML_NS, tag);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  /**
   * @param {Element} anchor The chip it opens from.
   * @param {object} agent
   * @param {object[]} rows What the model list shows.
   */
  open(anchor, agent, rows) {
    this.close();
    const window = this.#window;
    const document = window.document;
    this.#anchor = anchor;
    this.#agent = agent;
    this.#rows = rows;
    this.#onList = false;
    const root = this.#create("div", "zendia-model-card");
    root.id = "zendia-model-card";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", `${agent.name} model`);
    root.tabIndex = -1;
    this.#root = root;
    root.addEventListener("keydown", this, true);
    window.addEventListener("mousedown", this, true);
    window.addEventListener("resize", this);
    this.#place();
    (document.getElementById("browser") ?? document.documentElement).append(
      root
    );
    this.#showPanel({ fade: false });
    anchor.setAttribute("aria-expanded", "true");
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.refocus] The caller moves the focus itself when
   *   false, as an outside click does.
   */
  close({ refocus = true } = {}) {
    const root = this.#root;
    if (!root) {
      return;
    }
    this.#closeSubmenu();
    this.#root = null;
    this.#page = null;
    const window = this.#window;
    window.removeEventListener("mousedown", this, true);
    window.removeEventListener("resize", this);
    root.removeEventListener("keydown", this, true);
    this.#anchor?.removeAttribute("aria-expanded");
    root.removeAttribute("id");
    root.inert = true;
    root.setAttribute("leaving", "");
    Promise.allSettled(root.getAnimations().map(a => a.finished)).then(() =>
      root.remove()
    );
    this.#onClose?.({ refocus });
  }

  handleEvent(event) {
    switch (event.type) {
      case "keydown":
        this.#onKey(event);
        break;
      case "resize":
        this.close();
        break;
      case "mousedown": {
        const target = event.target;
        const inside =
          this.#root?.contains(target) ||
          this.#submenu?.contains(target) ||
          // The chip's own click closes it, rather than closing and opening.
          this.#anchor?.contains(target);
        if (!inside) {
          this.close({ refocus: false });
        }
        break;
      }
    }
  }

  // Over the chip with its right edge on the chip's, so the card stays put
  // while the chip's width changes; under it where there is no room above.
  #place() {
    const window = this.#window;
    const chip = this.#anchor.getBoundingClientRect();
    const root = this.#root;
    const above = chip.top - CHIP_GAP - EDGE_MARGIN;
    const below = window.innerHeight - chip.bottom - CHIP_GAP - EDGE_MARGIN;
    const up = above >= MIN_ROOM_ABOVE || above >= below;
    root.setAttribute("placement", up ? "above" : "below");
    root.style.setProperty(
      "--zendia-model-room",
      `${Math.max(0, up ? above : below)}px`
    );
    root.style.right = `${Math.max(EDGE_MARGIN, window.innerWidth - chip.right)}px`;
    if (up) {
      root.style.bottom = `${window.innerHeight - chip.top + CHIP_GAP}px`;
    } else {
      root.style.top = `${chip.bottom + CHIP_GAP}px`;
    }
  }

  // Swap the page: the old one goes at once, the new one fades in while the
  // card eases to its height, so nothing slides sideways.
  #swap(page, { fade }) {
    const root = this.#root;
    this.#closeSubmenu();
    if (this.#page) {
      root.replaceChildren(page);
    } else {
      root.append(page);
    }
    this.#page = page;
    root.style.height = `${page.offsetHeight}px`;
    if (fade && !lazy.reducedMotion(this.#window)) {
      page.animate(
        { opacity: [0, 1] },
        {
          duration: PAGE_FADE_MS,
          easing: "cubic-bezier(0, 0, 0.58, 1)",
        }
      );
    }
  }

  // The card's height follows its page when the page grows without a swap.
  #fit() {
    if (this.#root && this.#page) {
      this.#root.style.height = `${this.#page.offsetHeight}px`;
    }
  }

  // The first page.

  #showPanel({ fade = true } = {}) {
    this.#onList = false;
    this.#search = null;
    this.#listBox = null;
    this.#listDetail = null;
    const options = lazy.ZendiaAgents.optionsFor(this.#agent.id);
    const page = this.#create("div", "zendia-model-page");
    this.#efforts = options.efforts.length > 1 ? options.efforts : [];
    const name = options.model?.name ?? this.#modelName();
    page.append(this.#header(name, options));
    this.#slider = null;
    if (this.#efforts.length) {
      page.append(this.#effortSlider(options));
    }
    const context = this.#contextOption(options);
    if (context) {
      page.append(context);
    }
    this.#swap(page, { fade });
    (this.#slider ?? this.#root).focus();
  }

  #modelName() {
    const id = lazy.ZendiaAgents.modelFor(this.#agent.id);
    return this.#rows.find(row => row.id == id)?.name ?? (id || "Default");
  }

  #header(name, options) {
    const button = this.#create("button", "zendia-model-title");
    button.type = "button";
    button.addEventListener("click", () => this.#showList());
    const model = this.#create("span", "zendia-model-name");
    model.append(
      this.#create("span", "zendia-model-name-text", name),
      this.#create("span", "zendia-model-chevron")
    );
    if (this.#efforts.length) {
      this.#title = this.#create("span", "zendia-model-effort");
      lazy.rollText(this.#title, this.#effortTitle(options.effort));
      button.append(this.#title, model);
    } else {
      this.#title = null;
      button.setAttribute("single", "");
      button.append(model);
    }
    button.setAttribute("aria-label", `${name} · Change model`);
    return button;
  }

  // "Default" says the agent's own settings decide, which is true until a
  // level is picked.
  #effortTitle(effort) {
    return effort ? effortLabel(effort) : "Default";
  }

  #effortSlider(options) {
    const levels = this.#efforts;
    const slider = this.#create("div", "zendia-effort");
    this.#slider = slider;
    slider.tabIndex = 0;
    slider.setAttribute("role", "slider");
    slider.setAttribute("aria-label", "Reasoning effort");
    slider.setAttribute("aria-valuemin", "0");
    slider.setAttribute("aria-valuemax", String(levels.length - 1));
    slider.title = "Double-click to go back to the agent's own setting";
    this.#index = Math.max(0, levels.indexOf(options.shownEffort));
    const stops = () => {
      const row = this.#create("span", "zendia-effort-stops");
      for (const index of levels.keys()) {
        const dot = this.#create("span", "zendia-effort-stop");
        dot.style.setProperty(
          "--zendia-effort-stop",
          index / (levels.length - 1)
        );
        row.append(dot);
      }
      return row;
    };
    const fill = this.#create("span", "zendia-effort-fill");
    // The same dots again inside the fill: the fill's edge clips them, so a
    // dot turns over exactly as the front passes it.
    fill.append(stops());
    slider.append(stops(), fill, this.#create("span", "zendia-effort-thumb"));
    this.#setFraction(this.#index / (levels.length - 1));
    this.#describeSlider();
    slider.toggleAttribute("unset", !options.effort);

    const onMove = event => this.#dragTo(event);
    const onUp = event => {
      slider.releasePointerCapture?.(event.pointerId);
      slider.removeEventListener("pointermove", onMove);
      slider.removeEventListener("pointerup", onUp);
      slider.removeEventListener("pointercancel", onUp);
      slider.removeAttribute("dragging");
      // Eases from where the pointer left it to the level picked.
      this.#setFraction(this.#index / (levels.length - 1));
    };
    slider.addEventListener("pointerdown", event => {
      if (event.button != 0) {
        return;
      }
      event.preventDefault();
      slider.focus();
      slider.setPointerCapture?.(event.pointerId);
      slider.setAttribute("dragging", "");
      slider.addEventListener("pointermove", onMove);
      slider.addEventListener("pointerup", onUp);
      slider.addEventListener("pointercancel", onUp);
      this.#dragTo(event);
    });
    slider.addEventListener("dblclick", () => this.#clearEffort());
    return slider;
  }

  #setFraction(fraction) {
    this.#slider?.style.setProperty("--zendia-effort-f", fraction);
  }

  #describeSlider() {
    const level = this.#efforts[this.#index];
    // Each level has its role in the theme; one a CLI invents has the accent.
    this.#slider?.style.setProperty(
      "--zendia-effort-color",
      `var(--zendia-effort-${level}, var(--zendia-accent))`
    );
    this.#slider?.setAttribute("aria-valuenow", String(this.#index));
    this.#slider?.setAttribute("aria-valuetext", effortLabel(level));
  }

  // The thumb stays under the pointer, not on a stop, and the level changes
  // as it crosses each one.
  #dragTo(event) {
    const rail = this.#slider.getBoundingClientRect();
    const fraction = railFraction(event.clientX - rail.left, rail.width);
    this.#setFraction(fraction);
    this.#pickLevel(Math.round(fraction * (this.#efforts.length - 1)));
  }

  #pickLevel(index) {
    const level = this.#efforts[index];
    const saved = lazy.ZendiaAgents.effortFor(this.#agent.id);
    if (!level || (index == this.#index && saved == level)) {
      return;
    }
    this.#index = index;
    lazy.ZendiaAgents.setEffort(this.#agent.id, level);
    this.#slider.removeAttribute("unset");
    this.#describeSlider();
    if (this.#title) {
      lazy.rollText(this.#title, effortLabel(level));
    }
    this.#onChange();
  }

  #stepLevel(index) {
    const last = this.#efforts.length - 1;
    const next = Math.min(last, Math.max(0, index));
    this.#pickLevel(next);
    this.#setFraction(next / last);
  }

  #clearEffort() {
    lazy.ZendiaAgents.setEffort(this.#agent.id, "");
    const options = lazy.ZendiaAgents.optionsFor(this.#agent.id);
    this.#index = Math.max(0, this.#efforts.indexOf(options.shownEffort));
    this.#setFraction(this.#index / (this.#efforts.length - 1));
    this.#slider?.toggleAttribute("unset", !options.effort);
    this.#describeSlider();
    if (this.#title) {
      lazy.rollText(this.#title, this.#effortTitle(options.effort));
    }
    this.#onChange();
  }

  // The context window: a row that opens its choices, or plain text where
  // the size cannot be chosen.
  #contextOption(options) {
    const row = this.#create("div", "zendia-model-option");
    const label = this.#create("span", "", "Context window");
    this.#contextRow = null;
    if (options.contexts.length > 1) {
      const chosen =
        options.contexts.find(context => context.id == options.context) ??
        options.contexts[0];
      row.setAttribute("choice", "");
      row.setAttribute("role", "button");
      row.setAttribute("aria-haspopup", "menu");
      row.title = "Compacts the conversation when it reaches this size";
      row.append(
        label,
        this.#create("span", "zendia-model-value", chosen.label),
        this.#create("span", "zendia-model-chevron")
      );
      this.#contextRow = row;
      row.addEventListener("mouseenter", () => this.#openSubmenu());
      row.addEventListener("mouseleave", () => this.#lingerSubmenu());
      row.addEventListener("click", () =>
        this.#submenu ? this.#closeSubmenu() : this.#openSubmenu()
      );
      return row;
    }
    if (!options.contextTokens) {
      return null;
    }
    row.append(
      label,
      this.#create(
        "span",
        "zendia-model-value",
        formatTokens(options.contextTokens)
      )
    );
    return row;
  }

  #openSubmenu() {
    this.#window.clearTimeout(this.#submenuTimer);
    if (this.#submenu || !this.#contextRow) {
      return;
    }
    const window = this.#window;
    const options = lazy.ZendiaAgents.optionsFor(this.#agent.id);
    const menu = this.#create("div", "zendia-model-card");
    menu.setAttribute("submenu", "");
    menu.setAttribute("role", "menu");
    menu.addEventListener("mouseenter", () =>
      window.clearTimeout(this.#submenuTimer)
    );
    menu.addEventListener("mouseleave", () => this.#lingerSubmenu());
    this.#subActive = Math.max(
      0,
      options.contexts.findIndex(context => context.id == options.context)
    );
    options.contexts.forEach((context, index) => {
      const item = this.#create("div", "zendia-model-choice");
      item.setAttribute("role", "menuitemradio");
      item.append(this.#create("span", "", context.label));
      if (context.default) {
        item.append(this.#create("span", "zendia-model-tag", "Default"));
      }
      if (context.id == options.context) {
        item.setAttribute("selected", "");
        item.setAttribute("aria-checked", "true");
      }
      item.addEventListener("click", () => this.#pickContext(index));
      menu.append(item);
    });
    const row = this.#contextRow.getBoundingClientRect();
    const card = this.#root.getBoundingClientRect();
    const fits =
      card.right + SUBMENU_GAP + SUBMENU_WIDTH + EDGE_MARGIN <
      window.innerWidth;
    menu.style.top = `${row.top}px`;
    menu.style.left = fits
      ? `${card.right + SUBMENU_GAP}px`
      : `${Math.max(EDGE_MARGIN, card.left - SUBMENU_GAP - SUBMENU_WIDTH)}px`;
    this.#submenu = menu;
    this.#root.after(menu);
    this.#contextRow.setAttribute("open", "");
    this.#markChoice();
    // Kept inside the window: the row can sit near the bottom edge.
    const bottom = menu.getBoundingClientRect().bottom;
    const over = bottom + EDGE_MARGIN - window.innerHeight;
    if (over > 0) {
      menu.style.top = `${row.top - over}px`;
    }
  }

  #markChoice() {
    [...(this.#submenu?.children ?? [])].forEach((item, index) =>
      item.toggleAttribute("active", index == this.#subActive)
    );
  }

  // The pointer gets time to cross the gap between the row and the submenu.
  #lingerSubmenu() {
    this.#window.clearTimeout(this.#submenuTimer);
    this.#submenuTimer = this.#window.setTimeout(
      () => this.#closeSubmenu(),
      SUBMENU_LINGER_MS
    );
  }

  // Only the entrance animates: it is gone the moment it is not wanted.
  #closeSubmenu() {
    this.#window.clearTimeout(this.#submenuTimer);
    this.#submenu?.remove();
    this.#submenu = null;
    this.#contextRow?.removeAttribute("open");
  }

  #pickContext(index) {
    const options = lazy.ZendiaAgents.optionsFor(this.#agent.id);
    const context = options.contexts[index];
    if (!context) {
      return;
    }
    lazy.ZendiaAgents.setContext(this.#agent.id, context.id);
    this.#closeSubmenu();
    const value = this.#contextRow?.querySelector(".zendia-model-value");
    if (value) {
      lazy.rollText(value, context.label);
    }
    this.#onChange();
    (this.#slider ?? this.#root).focus();
  }

  // The list of models.

  #showList() {
    this.#onList = true;
    const page = this.#create("div", "zendia-model-page");
    page.setAttribute("list", "");
    const head = this.#create("div", "zendia-model-list-head");
    const back = this.#create("button", "zendia-model-back");
    back.type = "button";
    back.title = "Back (Esc)";
    back.setAttribute("aria-label", "Back");
    back.addEventListener("click", () => this.#showPanel());
    this.#search = this.#create("input", "zendia-model-search");
    this.#search.type = "text";
    this.#search.placeholder = "Search models…";
    this.#search.setAttribute("aria-label", "Search models");
    this.#search.addEventListener("input", () => this.#fillList());
    head.append(back, this.#search);
    this.#listBox = this.#create("div", "zendia-model-list");
    this.#listBox.setAttribute("role", "listbox");
    // What a tooltip would say, in the theme's colors and for the keys too.
    this.#listDetail = this.#create("div", "zendia-model-detail");
    page.append(head, this.#listBox, this.#listDetail);
    this.#fillList({ swap: page });
    this.#search.focus();
  }

  #fillList({ swap } = {}) {
    const current = lazy.ZendiaAgents.modelFor(this.#agent.id);
    this.#shown = searchModels(this.#rows, this.#search.value);
    const selected = this.#shown.findIndex(row => row.id == current);
    this.#active = Math.max(0, selected);
    // Headings group the list as it comes; a search ranks it instead.
    const grouped = !this.#search.value.trim();
    this.#listBox.replaceChildren(
      ...this.#shown.flatMap((row, index) => {
        const heading =
          grouped &&
          row.section &&
          row.section != this.#shown[index - 1]?.section
            ? [this.#create("div", "zendia-model-section", row.section)]
            : [];
        const item = this.#create("div", "zendia-model-row");
        item.setAttribute("role", "option");
        item.toggleAttribute("selected", row.id == current);
        item.setAttribute("aria-selected", String(row.id == current));
        item.append(this.#create("span", "zendia-model-row-name", row.name));
        if (row.note) {
          const tag = this.#create("span", "zendia-model-tag", row.note);
          tag.setAttribute("tone", row.tone ?? "");
          item.append(tag);
        }
        // Moved, not entered: a list opening under a resting pointer must not
        // take the highlight from the model in use.
        item.addEventListener("mousemove", () => {
          if (index != this.#active) {
            this.#markRow(index);
          }
        });
        item.addEventListener("click", () => this.#pickRow(index));
        return [...heading, item];
      })
    );
    if (!this.#shown.length) {
      this.#listBox.append(
        this.#create("div", "zendia-model-none", "No model matches")
      );
    }
    this.#markRow(this.#active, { scroll: true });
    if (swap) {
      this.#swap(swap, { fade: true });
      this.#markRow(this.#active, { scroll: true });
    } else {
      this.#fit();
    }
  }

  #markRow(index, { scroll = false } = {}) {
    const rows = this.#listBox?.querySelectorAll(".zendia-model-row");
    if (!rows?.length) {
      if (this.#listDetail) {
        this.#listDetail.textContent = "";
      }
      return;
    }
    this.#active = (index + rows.length) % rows.length;
    rows.forEach((row, at) =>
      row.toggleAttribute("active", at == this.#active)
    );
    const { id, detail } = this.#shown[this.#active];
    this.#listDetail.textContent = [id, detail].filter(Boolean).join(" · ");
    if (scroll) {
      rows[this.#active].scrollIntoView({ block: "nearest" });
    }
  }

  // Back to the first page, where the new model's levels now show.
  #pickRow(index) {
    const row = this.#shown[index];
    if (!row) {
      return;
    }
    lazy.ZendiaAgents.setModel(this.#agent.id, row.id);
    this.#onChange();
    this.#showPanel();
  }

  // Keys. Nothing reaches the page or vim mode while the card has focus.

  #onKey(event) {
    const { key, ctrlKey } = event;
    const cancel = key == "Escape" || (ctrlKey && (key == "c" || key == "["));
    let handled;
    if (this.#submenu) {
      handled = this.#onSubmenuKey(event, cancel);
    } else if (this.#onList) {
      handled = this.#onListKey(event, cancel);
    } else {
      handled = this.#onPanelKey(event, cancel);
    }
    // A key left to the search box still types: the editor acts on keypress.
    // Stopped here, keydown never reaches vim mode's bubble listener, which
    // would send it to the page and move the focus there.
    if (handled) {
      event.preventDefault();
    }
    event.stopPropagation();
  }

  #onSubmenuKey({ key, ctrlKey }, cancel) {
    const count = this.#submenu.children.length;
    if (cancel || key == "ArrowLeft" || key == "h") {
      this.#closeSubmenu();
    } else if (key == "Enter" || key == " ") {
      this.#pickContext(this.#subActive);
    } else if (key == "ArrowDown" || key == "j" || (ctrlKey && key == "n")) {
      this.#subActive = (this.#subActive + 1) % count;
      this.#markChoice();
    } else if (key == "ArrowUp" || key == "k" || (ctrlKey && key == "p")) {
      this.#subActive = (this.#subActive - 1 + count) % count;
      this.#markChoice();
    }
    return true;
  }

  #onListKey({ key, ctrlKey }, cancel) {
    if (cancel) {
      this.#showPanel();
    } else if (key == "Enter") {
      this.#pickRow(this.#active);
    } else if (key == "ArrowDown" || (ctrlKey && key == "n")) {
      this.#markRow(this.#active + 1, { scroll: true });
    } else if (key == "ArrowUp" || (ctrlKey && key == "p")) {
      this.#markRow(this.#active - 1, { scroll: true });
    } else {
      return false;
    }
    return true;
  }

  #onPanelKey({ key }, cancel) {
    const stepping = !!this.#efforts.length;
    if (cancel) {
      this.close();
    } else if (stepping && (key == "ArrowLeft" || key == "h")) {
      this.#stepLevel(this.#index - 1);
    } else if (stepping && (key == "ArrowRight" || key == "l")) {
      this.#stepLevel(this.#index + 1);
    } else if (stepping && (key == "Home" || key == "0")) {
      this.#stepLevel(0);
    } else if (stepping && (key == "End" || key == "$")) {
      this.#stepLevel(this.#efforts.length - 1);
    } else if (key == "c" && this.#contextRow) {
      this.#openSubmenu();
    } else if (
      key == "Enter" ||
      key == " " ||
      key == "ArrowDown" ||
      key == "ArrowUp" ||
      key == "j" ||
      key == "k"
    ) {
      this.#showList();
    }
    return true;
  }
}
