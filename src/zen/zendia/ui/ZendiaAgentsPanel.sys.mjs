// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The agents panel: every conversation with an agent, in every window, in
// one list at the side of the tab (the left, unless zendia.agents.side says
// otherwise). Each row is one agent's work: what the user asked, what it is
// doing now, the tab it works on and how far its work list got. Rows sit in
// groups: what waits on the user (a permission, a CAPTCHA, a blocked item,
// an error), what works, what finished since the user last looked, and the
// rest (ZendiaAgentRoster).
//
// A row opens its tab with the chat beside it; a permission is answered in
// the row; a peek shows the last steps without leaving the tab in front;
// and an agent is stopped or dismissed from here. The keys, while the list
// has them: j/k move, Enter opens, Space peeks, y/n answer, x stops, d
// dismisses, Esc closes.
//
// It lays out as the chat panel does (ZendiaDockFrame): float, slide or
// split, under zendia.agents.layout, side and width. Closed, a pill at its
// side says when an agent waits on the user.

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  GROUP_TITLES: "resource:///modules/zendia/agent/ZendiaAgentRoster.sys.mjs",
  ZendiaAgents: "resource:///modules/zendia/agent/ZendiaAgents.sys.mjs",
  ZendiaCaptcha: "resource:///modules/zendia/core/ZendiaCaptcha.sys.mjs",
  ZendiaCaptchaWatch:
    "resource:///modules/zendia/captcha/ZendiaCaptchaWatch.sys.mjs",
  ZendiaDockFrame: "resource:///modules/zendia/ui/ZendiaDockFrame.sys.mjs",
  ZendiaTheme: "resource:///modules/zendia/ui/ZendiaTheme.sys.mjs",
  agentColor: "resource:///modules/zendia/agent/ZendiaAgents.sys.mjs",
  agentIcon: "resource:///modules/zendia/agent/ZendiaAgentIcons.sys.mjs",
  hideFloat: "resource:///modules/zendia/ui/ZendiaPicker.sys.mjs",
  ZendiaPicker: "resource:///modules/zendia/ui/ZendiaPicker.sys.mjs",
  iconIsFull: "resource:///modules/zendia/agent/ZendiaAgentIcons.sys.mjs",
  iconIsMono: "resource:///modules/zendia/agent/ZendiaAgentIcons.sys.mjs",
  iconIsTile: "resource:///modules/zendia/agent/ZendiaAgentIcons.sys.mjs",
  liveTabOf: "resource:///modules/zendia/agent/ZendiaAgents.sys.mjs",
  recentActivity: "resource:///modules/zendia/agent/ZendiaAgentRoster.sys.mjs",
  shortDuration: "resource:///modules/zendia/agent/ZendiaAgentRoster.sys.mjs",
  showFloat: "resource:///modules/zendia/ui/ZendiaPicker.sys.mjs",
  sortRoster: "resource:///modules/zendia/agent/ZendiaAgentRoster.sys.mjs",
  stateOf: "resource:///modules/zendia/agent/ZendiaAgentRoster.sys.mjs",
  summarize: "resource:///modules/zendia/agent/ZendiaAgentRoster.sys.mjs",
  titleOf: "resource:///modules/zendia/agent/ZendiaAgentRoster.sys.mjs",
});

const HTML_NS = "http://www.w3.org/1999/xhtml";
const DEFAULT_FAVICON = "chrome://global/skin/icons/defaultFavicon.svg";
const STEP_ICONS = { running: "◌", done: "✓", failed: "✕" };
// Text streams in a delta at a time: the list redraws at most this often.
const RENDER_MS = 120;

let gRowIds = 0;

export class ZendiaAgentsPanel {
  #window;
  #frame;
  #root;
  #list;
  #empty;
  #pill;
  #handle;
  #onChange;
  #onStatus;
  #openChat;
  // Each conversation's row: {row, parts, key}.
  #rows = new WeakMap();
  // Each group's heading.
  #heads = new Map();
  // The rows drawn last, in order: {conversation, state}.
  #entries = [];
  // The conversation under the cursor, and the ones peeked into.
  #cursor = null;
  #peeked = new WeakSet();
  #renderTimer = null;
  #clock = null;
  #picking = false;

  /**
   * @param {Window} window A browser window.
   * @param {object} options
   * @param {() => void} options.onChange Called when it opens or closes.
   * @param {(browser: Element) => void} options.openChat Opens the chat
   *   panel on a tab of browser's window, once that tab is in front.
   * @param {() => void} [options.onStatus] Called when `status` may have
   *   changed.
   */
  constructor(window, { onChange, onStatus, openChat }) {
    this.#window = window;
    this.#onChange = onChange;
    this.#onStatus = onStatus;
    this.#openChat = openChat;
    const document = window.document;

    this.#frame = new lazy.ZendiaDockFrame(window, {
      id: "zendia-agents",
      label: "Agents",
      branch: "zendia.agents.",
      defaultWidth: 340,
      minWidth: 280,
      side: "left",
      // The slid-in list stays while the keys are in it.
      keepOpen: () =>
        this.#picking || this.#root.contains(document.activeElement),
      onLayout: () => this.#syncPill(),
      onCloseRequest: () => this.close(),
      onOpenRequest: options => this.open(options),
    });
    this.#root = this.#frame.root;
    this.#pill = this.#frame.pill;
    this.#handle = this.#frame.handle;

    const header = this.#create("div", "zendia-agent-header", this.#root);
    this.#create("span", "zendia-agents-title", header, "Agents");
    this.#create("span", "zendia-agent-spacer", header);
    this.#iconButton("new-chat", header, "New agent (a)").addEventListener(
      "click",
      () => this.newAgent()
    );
    this.#frame.addLayoutControls(header);
    this.#iconButton("close", header, "Close (Esc)").addEventListener(
      "click",
      () => this.close()
    );

    this.#list = this.#create("div", "zendia-agents-list", this.#root);
    this.#list.tabIndex = 0;
    this.#list.setAttribute("role", "listbox");
    this.#list.setAttribute("aria-label", "Agents");
    this.#list.addEventListener("keydown", event => this.#onKey(event));

    this.#empty = this.#create("div", "zendia-agents-empty", this.#list);
    this.#create(
      "div",
      "zendia-agent-empty-title",
      this.#empty,
      "No agents at work"
    );
    this.#create(
      "div",
      "zendia-agent-empty-detail",
      this.#empty,
      "Start one with + above, or on any tab with <leader>aa. Every agent you start shows up here, in any window."
    );

    const keys = this.#create("div", "zendia-agents-keys", this.#root);
    for (const [key, what] of [
      ["j k", "move"],
      ["⏎", "open"],
      ["␣", "peek"],
      ["x", "stop"],
      ["d", "dismiss"],
      ["a", "new"],
    ]) {
      const hint = this.#create("span", "", keys);
      this.#create("kbd", "zendia-agent-key", hint, key);
      hint.append(` ${what}`);
    }

    this.#pill.addEventListener("click", () => {
      this.#cursor =
        this.#entries.find(entry => entry.state.group == "attention")
          ?.conversation ?? this.#cursor;
      this.open();
    });

    const offRoster = lazy.ZendiaAgents.onRosterChange(() =>
      this.#queueRender()
    );
    // A CAPTCHA coming up or going changes what waits on the user.
    const offCaptcha = lazy.ZendiaCaptchaWatch.onDetect(() =>
      this.#queueRender()
    );
    const offTheme = lazy.ZendiaTheme.onChange(() => this.#queueRender());
    const tabs = window.gBrowser.tabContainer;
    const onTabs = () => this.#queueRender();
    // A tab closed takes its agent with it; a title or icon moves on.
    tabs.addEventListener("TabClose", onTabs);
    tabs.addEventListener("TabAttrModified", onTabs);
    window.addEventListener(
      "unload",
      () => {
        offRoster();
        offCaptcha();
        offTheme();
        window.clearTimeout(this.#renderTimer);
        window.clearInterval(this.#clock);
      },
      { once: true }
    );
    this.#frame.mount();
    this.#render();
  }

  get isOpen() {
    return this.#frame.isOpen;
  }

  /**
   * What the toolbar button shows: whether the panel is open, how many
   * agents work and how many wait on the user, and the first of those.
   *
   * @returns {{open: boolean, working: number, waiting: number,
   *   first: {name: string, label: string}|null}}
   */
  get status() {
    const waiting = this.#entries.filter(
      entry => entry.state.group == "attention"
    );
    return {
      open: this.isOpen,
      working: this.#entries.filter(entry => entry.state.group == "working")
        .length,
      waiting: waiting.length,
      first: waiting[0]
        ? {
            name: waiting[0].conversation.agent?.name ?? "An agent",
            label: waiting[0].state.label,
          }
        : null,
    };
  }

  /** The side it sits at: "left" or "right". */
  get side() {
    return this.#frame.side;
  }

  /** The layout in use: "float", "slide" or "split". */
  get layout() {
    return this.#frame.layout;
  }

  /**
   * @param {Node} node
   * @returns {boolean} Whether the node is part of the panel.
   */
  contains(node) {
    return this.#frame.contains(node);
  }

  /** Give the open panel the keys, in its list. */
  focus() {
    this.#list.focus();
  }

  getBoundingClientRect() {
    return this.#root.getBoundingClientRect();
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.focus] Give the list the keys.
   */
  open({ focus = true } = {}) {
    const wasOpen = this.isOpen;
    this.#frame.show();
    this.#render();
    if (!this.#clock) {
      // The rows' clocks.
      this.#clock = this.#window.setInterval(() => this.#syncTimes(), 1000);
    }
    if (focus) {
      this.#list.focus();
    }
    if (!wasOpen) {
      this.#onChange();
    }
  }

  close() {
    if (!this.isOpen) {
      return;
    }
    const focused = this.#root.contains(this.#window.document.activeElement);
    this.#frame.hide();
    this.#window.clearInterval(this.#clock);
    this.#clock = null;
    this.#syncPill();
    this.#onChange();
    if (focused) {
      this.#window.gBrowser.selectedBrowser.focus();
    }
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Another buffer of the browser UI takes the keys. Beside the tab the
   * list stays, as a split view pane would; over the page it goes.
   */
  release() {
    if (this.#frame.layout != "split") {
      this.close();
    }
  }

  #create(tag, className, parent, text) {
    const element = this.#window.document.createElementNS(HTML_NS, tag);
    if (className) {
      element.className = className;
    }
    if (text != null) {
      element.textContent = text;
    }
    parent?.append(element);
    return element;
  }

  /**
   * Start an agent with its chat open: on the tab in front when it has none
   * yet, else on a new tab beside it, so the agent there goes on as it was.
   */
  async newAgent() {
    const agent = await this.#pickAgent();
    if (!agent) {
      if (this.isOpen) {
        this.#list.focus();
      }
      return;
    }
    const { gBrowser } = this.#window;
    let browser = gBrowser.selectedBrowser;
    const own = lazy.ZendiaAgents.conversationFor(browser);
    if (
      own &&
      (own.running ||
        own.work ||
        own.messages.some(message => message.type == "user"))
    ) {
      // Not opened from the tab in front: an agent driving it would take a
      // tab its page opened as its own.
      const tab = gBrowser.addTrustedTab("about:blank", {
        relatedToCurrent: false,
        inBackground: false,
      });
      gBrowser.selectedTab = tab;
      browser = tab.linkedBrowser;
    }
    await lazy.ZendiaAgents.open(browser, { agent });
    this.#openChat(browser);
  }

  // The installed agent the user picks for a new session, or null.
  async #pickAgent() {
    const agents = await lazy.ZendiaAgents.agents({ refresh: true });
    const fallback = (await lazy.ZendiaAgents.defaultAgent())?.id;
    let index;
    this.#picking = true;
    try {
      index = await lazy.ZendiaPicker.open(this.#window, {
        title: "New agent",
        layout: "grid",
        items: agents.map(agent => ({
          icon: lazy.agentIcon(agent.id) ?? undefined,
          iconFill: lazy.iconIsTile(agent.id),
          color: lazy.agentColor(agent.id),
          label: agent.name,
          detail: agent.path
            ? [agent.version, agent.id == fallback && "default"]
                .filter(Boolean)
                .join(" · ")
            : "Not installed",
          dim: !agent.path,
          tooltip: agent.path ? undefined : agent.install,
        })),
      });
    } finally {
      this.#picking = false;
    }
    const agent = agents[index];
    return agent?.path ? agent : null;
  }

  #iconButton(className, parent, title) {
    const button = this.#create(
      "button",
      `zendia-agent-icon-button ${className}`,
      parent
    );
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    return button;
  }

  #queueRender() {
    if (this.#renderTimer) {
      return;
    }
    this.#renderTimer = this.#window.setTimeout(() => {
      this.#renderTimer = null;
      this.#render();
    }, RENDER_MS);
  }

  // The tab where the conversation's chat shows: the one it works on, else
  // another of its tabs whose chat it is.
  #homeOf(conversation) {
    const agents = lazy.ZendiaAgents;
    const tabs = [conversation.browser, ...conversation.tabs];
    const live = lazy.liveTabOf(conversation);
    return (
      tabs.find(
        browser =>
          browser?.isConnected &&
          agents.conversationFor(browser) === conversation &&
          !this.#tabOf(browser)?.closing
      ) ?? live
    );
  }

  #tabOf(browser) {
    return browser?.documentGlobal?.gBrowser?.getTabForBrowser(browser) ?? null;
  }

  #captchaHolds(conversation) {
    const browser = lazy.liveTabOf(conversation);
    const state = browser && lazy.ZendiaCaptchaWatch.lastFor(browser)?.state;
    return !!state && lazy.ZendiaCaptcha.holdsUp(state);
  }

  // Every conversation worth a row: one the user asked something of, or
  // whose agent is at work.
  #collect() {
    const entries = [];
    for (const conversation of lazy.ZendiaAgents.roster()) {
      if (
        !conversation.running &&
        !conversation.work &&
        !conversation.messages.some(message => message.type == "user")
      ) {
        continue;
      }
      entries.push({
        conversation,
        state: lazy.stateOf(conversation, {
          captchaHolds: this.#captchaHolds(conversation),
        }),
      });
    }
    return lazy.sortRoster(entries);
  }

  #render() {
    this.#entries = this.#collect();
    this.#syncPill();
    if (!this.isOpen) {
      return;
    }
    const entries = this.#entries;
    this.#list.setAttribute("aria-description", lazy.summarize(entries));
    this.#empty.hidden = !!entries.length;
    if (!entries.some(entry => entry.conversation === this.#cursor)) {
      this.#cursor = entries[0]?.conversation ?? null;
    }

    const wanted = [this.#empty];
    let group = null;
    for (const entry of entries) {
      if (entry.state.group != group) {
        group = entry.state.group;
        wanted.push(this.#headFor(group, entries));
      }
      wanted.push(this.#rowFor(entry));
    }
    // Moved only when the order changed: a node put back in place restarts
    // its animations.
    const current = [...this.#list.children];
    if (
      current.length != wanted.length ||
      current.some((node, i) => node !== wanted[i])
    ) {
      this.#list.replaceChildren(...wanted);
    }
    this.#syncCursor();
  }

  #headFor(group, entries) {
    let head = this.#heads.get(group);
    if (!head) {
      head = this.#create("div", "zendia-agents-group");
      head.setAttribute("group", group);
      head.setAttribute("role", "presentation");
      this.#heads.set(group, head);
    }
    const count = entries.filter(entry => entry.state.group == group).length;
    head.textContent = `${lazy.GROUP_TITLES[group]} · ${count}`;
    return head;
  }

  #logo(id) {
    const logo = this.#create("span", "zendia-agent-logo");
    const url = lazy.agentIcon(id, { mask: true });
    if (url) {
      logo.style.setProperty("--zendia-agent-logo", `url("${url}")`);
      logo.toggleAttribute("mono", lazy.iconIsMono(id));
      logo.toggleAttribute("tile", lazy.iconIsTile(id));
      logo.toggleAttribute("full", lazy.iconIsFull(id));
    } else {
      logo.setAttribute("none", "");
    }
    return logo;
  }

  // A conversation's row, built once and brought up to date in place.
  #rowFor({ conversation, state }) {
    let cached = this.#rows.get(conversation);
    if (!cached) {
      cached = this.#buildRow(conversation);
      this.#rows.set(conversation, cached);
    }
    const { row, parts } = cached;
    const agent = conversation.agent;
    const browser = lazy.liveTabOf(conversation);
    const tab = this.#tabOf(browser);
    const work = conversation.work;
    const confirm = conversation.pendingConfirm;
    const peeked = this.#peeked.has(conversation);
    const key = [
      agent?.id,
      state.group,
      state.kind,
      state.label,
      state.detail,
      tab?.label,
      tab?.image,
      browser?.documentGlobal == this.#window,
      conversation.tabs.size,
      work ? `${work.finalCount}/${work.items.length}` : "",
      confirm?.text ?? "",
      peeked,
      peeked ? conversation.messages.length : 0,
      peeked ? conversation.messages.at(-1)?.text : "",
      peeked ? conversation.messages.at(-1)?.status : "",
    ].join("\u0000");
    if (cached.key == key) {
      return row;
    }
    cached.key = key;

    row.setAttribute("group", state.group);
    row.setAttribute("kind", state.kind);
    row.setAttribute("aria-expanded", String(peeked));
    row.style.setProperty("--zendia-agent-color", lazy.agentColor(agent?.id));
    if (cached.agent != agent?.id) {
      cached.agent = agent?.id;
      parts.avatar.replaceChildren(this.#logo(agent?.id));
    }
    const title = lazy.titleOf(conversation) || "New conversation";
    parts.title.textContent = title;
    parts.title.title = title;
    parts.label.textContent = state.label;
    parts.detail.textContent = state.detail;
    parts.detail.title = state.detail;
    row.setAttribute(
      "aria-label",
      `${agent?.name ?? "Agent"}: ${title}. ${state.label}${state.detail ? `: ${state.detail}` : ""}`
    );

    parts.agent.textContent = agent?.name ?? "Agent";
    this.#syncTab(parts, conversation, browser, tab);
    this.#syncProgress(parts, work);

    const running = conversation.running;
    const stopping = state.kind == "stopping";
    parts.stop.hidden = !running;
    parts.stop.disabled = stopping;
    parts.stop.title = stopping ? "Stopping…" : "Stop (x)";
    parts.stop.setAttribute(
      "aria-label",
      stopping ? "Stopping" : `Stop ${agent?.name ?? "the agent"}`
    );
    parts.dismiss.disabled = running;
    parts.dismiss.title = running
      ? "Stop it first to dismiss it"
      : "Dismiss (d)";
    parts.peek.title = peeked
      ? "Hide steps (Space)"
      : "Peek at its steps (Space)";

    parts.confirm.hidden = !confirm;
    if (confirm) {
      parts.question.textContent = confirm.text;
    }

    parts.peekBox.hidden = !peeked;
    if (peeked) {
      this.#renderPeek(parts.peekBox, conversation);
    }
    this.#syncTime(conversation, parts, state);
    return row;
  }

  // The tab the agent works on: its icon and title, and how many more.
  #syncTab(parts, conversation, browser, tab) {
    if (!tab) {
      parts.favicon.src = DEFAULT_FAVICON;
      parts.tab.textContent = "Tab closed";
      parts.tab.title = "";
      return;
    }
    parts.favicon.src = tab.image || DEFAULT_FAVICON;
    const others = conversation.tabs.size - 1;
    const elsewhere =
      browser.documentGlobal != this.#window ? " · other window" : "";
    parts.tab.textContent = `${tab.label}${others > 0 ? ` +${others}` : ""}${elsewhere}`;
    parts.tab.title = browser.currentURI?.spec ?? tab.label;
  }

  // The work list's bar: done, then failed and skipped.
  #syncProgress(parts, work) {
    parts.progress.hidden = !work;
    if (!work) {
      return;
    }
    const done = work.count("done");
    const total = work.items.length || 1;
    parts.progressDone.style.width = `${(done / total) * 100}%`;
    parts.progressOther.style.width = `${((work.finalCount - done) / total) * 100}%`;
    parts.progress.title = work.progress();
  }

  #buildRow(conversation) {
    const row = this.#create("div", "zendia-agents-row");
    row.id = `zendia-agents-row-${++gRowIds}`;
    row.setAttribute("role", "option");
    const main = this.#create("div", "zendia-agents-main", row);
    const avatar = this.#create("span", "zendia-agents-avatar", main);
    const text = this.#create("div", "zendia-agents-text", main);
    const line = this.#create("div", "zendia-agents-line", text);
    const title = this.#create("span", "zendia-agents-name", line);
    const time = this.#create("span", "zendia-agents-time", line);
    const status = this.#create("div", "zendia-agents-status", text);
    const label = this.#create("span", "zendia-agents-label", status);
    const detail = this.#create("span", "zendia-agents-detail", status);
    const meta = this.#create("div", "zendia-agents-meta", text);
    const favicon = this.#create("img", "zendia-agents-favicon", meta);
    favicon.alt = "";
    const tab = this.#create("span", "zendia-agents-tab", meta);
    const agent = this.#create("span", "zendia-agents-agent", meta);
    const progress = this.#create("div", "zendia-agents-progress", text);
    const progressDone = this.#create("span", "done", progress);
    const progressOther = this.#create("span", "other", progress);

    // In the title's line, where the clock is until the row is pointed at.
    const actions = this.#create("div", "zendia-agents-actions", line);
    const action = (className, tooltip, run) => {
      const button = this.#iconButton(className, actions, tooltip);
      button.tabIndex = -1;
      button.addEventListener("click", event => {
        event.stopPropagation();
        this.#cursor = conversation;
        run();
        this.#list.focus();
      });
      return button;
    };
    const peek = action("zendia-agents-peek-button", "", () =>
      this.#togglePeek(conversation)
    );
    const dismiss = action("trash", "Dismiss (d)", () =>
      this.#dismiss(conversation)
    );

    // Always there while the agent works, not only under the mouse.
    const stop = this.#create("button", "zendia-agents-stop", main);
    stop.type = "button";
    stop.tabIndex = -1;
    stop.addEventListener("click", event => {
      event.stopPropagation();
      this.#cursor = conversation;
      conversation.stop();
      this.#list.focus();
    });

    const confirm = this.#create("div", "zendia-agents-confirm", row);
    const question = this.#create("div", "zendia-agents-question", confirm);
    const answers = this.#create(
      "div",
      "zendia-agent-confirm-actions",
      confirm
    );
    const answer = (allowed, word, key, primary) => {
      const button = this.#create(
        "button",
        `zendia-agent-button${primary ? " primary" : ""}`,
        answers
      );
      button.type = "button";
      button.tabIndex = -1;
      button.append(word, this.#create("kbd", "zendia-agent-key", null, key));
      button.addEventListener("click", event => {
        event.stopPropagation();
        conversation.pendingConfirm?.answer(allowed);
        this.#list.focus();
      });
    };
    answer(false, "Deny", "n", false);
    answer(true, "Allow", "y", true);

    const peekBox = this.#create("div", "zendia-agents-peek", row);

    main.addEventListener("click", () => {
      this.#cursor = conversation;
      this.#syncCursor();
      this.#open(conversation);
    });
    main.addEventListener("mousedown", event => {
      // The list keeps the keys; a click on a button is the button's.
      if (!event.target.closest("button")) {
        event.preventDefault();
        this.#list.focus();
      }
    });
    return {
      row,
      key: "",
      agent: null,
      parts: {
        avatar,
        title,
        time,
        label,
        detail,
        favicon,
        tab,
        agent,
        progress,
        progressDone,
        progressOther,
        peek,
        stop,
        dismiss,
        confirm,
        question,
        peekBox,
      },
    };
  }

  #renderPeek(box, conversation) {
    const activity = lazy.recentActivity(conversation.messages);
    if (!activity.length) {
      box.replaceChildren(
        this.#create(
          "div",
          "zendia-agents-peek-item",
          null,
          conversation.running ? "Getting started…" : "Nothing yet."
        )
      );
      return;
    }
    box.replaceChildren(
      ...activity.map(item => {
        const element = this.#create("div", "zendia-agents-peek-item");
        element.setAttribute("type", item.type);
        if (item.type == "step") {
          element.setAttribute("status", item.status);
          this.#create(
            "span",
            "zendia-agent-step-icon",
            element,
            STEP_ICONS[item.status] ?? "·"
          );
        }
        this.#create("span", "zendia-agents-peek-text", element, item.text);
        return element;
      })
    );
  }

  // How long a turn has run, or how long ago anything happened.
  #syncTime(conversation, parts, state) {
    const now = Date.now();
    const working = state.group == "working" && conversation.startedAt;
    const text = working
      ? lazy.shortDuration(now - conversation.startedAt)
      : lazy.shortDuration(now - conversation.updatedAt);
    parts.time.textContent = working || text == "now" ? text : `${text} ago`;
    parts.time.title = working ? "Working for" : "Last activity";
  }

  #syncTimes() {
    for (const { conversation, state } of this.#entries) {
      const cached = this.#rows.get(conversation);
      if (cached) {
        this.#syncTime(conversation, cached.parts, state);
      }
    }
  }

  #syncCursor() {
    let active = null;
    for (const { conversation } of this.#entries) {
      const row = this.#rows.get(conversation)?.row;
      const on = conversation === this.#cursor;
      row?.toggleAttribute("cursor", on);
      row?.setAttribute("aria-selected", String(on));
      if (on) {
        active = row;
      }
    }
    if (active) {
      this.#list.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    } else {
      this.#list.removeAttribute("aria-activedescendant");
    }
  }

  #move(delta, { to = null } = {}) {
    const conversations = this.#entries.map(entry => entry.conversation);
    if (!conversations.length) {
      return;
    }
    const index = conversations.indexOf(this.#cursor);
    const next =
      to ?? Math.min(conversations.length - 1, Math.max(0, index + delta));
    this.#cursor = conversations.at(next);
    this.#syncCursor();
  }

  #togglePeek(conversation, open = !this.#peeked.has(conversation)) {
    if (open) {
      this.#peeked.add(conversation);
    } else {
      this.#peeked.delete(conversation);
    }
    this.#render();
  }

  #dismiss(conversation) {
    if (conversation.running) {
      return;
    }
    const conversations = this.#entries.map(entry => entry.conversation);
    const index = conversations.indexOf(conversation);
    lazy.ZendiaAgents.dismiss(conversation);
    // The cursor stays where it was, on the row that came up into place.
    this.#cursor = conversations[index + 1] ?? conversations[index - 1] ?? null;
    this.#render();
  }

  // The conversation's tab, brought to the front (in its window and space),
  // with its chat beside it.
  async #open(conversation) {
    const browser = this.#homeOf(conversation);
    const tab = this.#tabOf(browser);
    if (!tab) {
      return;
    }
    const window = browser.documentGlobal;
    if (window != this.#window) {
      window.focus();
    }
    try {
      await window.gZenWorkspaces?.switchTabIfNeeded(tab);
    } catch (e) {
      console.error("Zendia: could not switch to the agent's space", e);
    }
    if (window.gBrowser.selectedTab != tab) {
      window.gBrowser.selectedTab = tab;
    }
    conversation.unseen = false;
    this.#openChat(browser);
  }

  #onKey(event) {
    if (
      event.target != this.#list ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }
    const conversation = this.#cursor;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    switch (event.key) {
      case "j":
      case "ArrowDown":
        this.#move(1);
        break;
      case "k":
      case "ArrowUp":
        this.#move(-1);
        break;
      case "g":
      case "Home":
        this.#move(0, { to: 0 });
        break;
      case "G":
      case "End":
        this.#move(0, { to: -1 });
        break;
      case "Enter":
      case "o":
        if (conversation) {
          this.#open(conversation);
        }
        break;
      case " ":
      case "l":
      case "ArrowRight":
      case "h":
      case "ArrowLeft":
        if (conversation) {
          const open =
            event.key == " "
              ? undefined
              : ["l", "ArrowRight"].includes(event.key);
          this.#togglePeek(conversation, open);
        }
        break;
      case "y":
      case "n":
        conversation?.pendingConfirm?.answer(event.key == "y");
        break;
      case "a":
        this.newAgent();
        break;
      case "x":
        conversation?.stop();
        break;
      case "d":
        if (conversation) {
          this.#dismiss(conversation);
        }
        break;
      case "Escape":
      case "q":
        this.close();
        break;
      default:
        return;
    }
    handled();
  }

  // Closed, the pill says what waits on the user; slid out, the handle at
  // the side shows there are agents, and whether one waits.
  #syncPill() {
    this.#onStatus?.();
    const entries = this.#entries;
    const waiting = entries.filter(entry => entry.state.group == "attention");
    const working = entries.some(entry => entry.state.group == "working");
    const slide = this.#frame.layout == "slide";
    const open = this.isOpen;

    this.#handle.hidden = open || !slide || !entries.length;
    this.#handle.toggleAttribute("running", working);
    this.#handle.toggleAttribute("unseen", !!waiting.length);
    this.#handle.style.setProperty(
      "--zendia-agent-color",
      waiting.length ? "var(--zendia-warning)" : "var(--zendia-accent)"
    );

    if (open || slide || !waiting.length) {
      lazy.hideFloat(this.#pill);
      return;
    }
    lazy.showFloat(this.#pill);
    const first = waiting[0];
    this.#pill.style.setProperty(
      "--zendia-agent-color",
      lazy.agentColor(first.conversation.agent?.id)
    );
    this.#pill.textContent =
      waiting.length == 1
        ? `${first.conversation.agent?.name ?? "An agent"}: ${first.state.label.toLowerCase()}`
        : `${waiting.length} agents need you`;
    this.#pill.title = "Open the agents panel (<leader>aA)";
  }
}
