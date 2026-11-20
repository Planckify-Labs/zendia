// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The agent panel: a glass panel at the side of the tab to ask the user's
// agent something about it, with the conversation above the request. It
// slides in from its side, left or right, and lays out one of three ways,
// picked in its header:
//
// - float: a card over the page, until it is closed;
// - slide: against the side of the page, hiding as Zen's compact sidebar
//   does once the mouse leaves it; a handle at that side brings it back;
// - split: beside the tab, which narrows to make room, as a split view
//   pane. When the tab, or its narrowest split view pane, would get too
//   narrow, it lays out as float (or slide, after
//   zendia.agent.split-fallback) until there is room again.
//
// Dragging its edge on the page's side widens it, never narrower than it
// first opens; beside the tab, only as far as the tab keeps room.
//
// Closed, a pill keeps showing that the agent is working on the tab or has
// finished.

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ATTACH_MAX_BYTES: "resource:///modules/zendia/agent/ZendiaAgents.sys.mjs",
  ATTACH_MAX_FILES: "resource:///modules/zendia/agent/ZendiaAgents.sys.mjs",
  ZendiaAgents: "resource:///modules/zendia/agent/ZendiaAgents.sys.mjs",
  ZendiaCaptchaAgent:
    "resource:///modules/zendia/captcha/ZendiaCaptchaAgent.sys.mjs",
  ZendiaCaptchaWatch:
    "resource:///modules/zendia/captcha/ZendiaCaptchaWatch.sys.mjs",
  ZendiaDockFrame: "resource:///modules/zendia/ui/ZendiaDockFrame.sys.mjs",
  agentColor: "resource:///modules/zendia/agent/ZendiaAgents.sys.mjs",
  inputKindOf: "resource:///modules/zendia/agent/ZendiaAgents.sys.mjs",
  agentIcon: "resource:///modules/zendia/agent/ZendiaAgentIcons.sys.mjs",
  iconIsMono: "resource:///modules/zendia/agent/ZendiaAgentIcons.sys.mjs",
  iconIsTile: "resource:///modules/zendia/agent/ZendiaAgentIcons.sys.mjs",
  iconIsFull: "resource:///modules/zendia/agent/ZendiaAgentIcons.sys.mjs",
  ZendiaAgentInstructions:
    "resource:///modules/zendia/agent/ZendiaAgentInstructions.sys.mjs",
  ZendiaAgentInstructionsView:
    "resource:///modules/zendia/ui/ZendiaAgentInstructionsView.sys.mjs",
  formatSize:
    "resource:///modules/zendia/ui/ZendiaAgentInstructionsView.sys.mjs",
  mediaKind:
    "resource:///modules/zendia/ui/ZendiaAgentInstructionsView.sys.mjs",
  ZendiaAgentFollow: "resource:///modules/zendia/ui/ZendiaAgentFollow.sys.mjs",
  ZendiaAgentModelCard:
    "resource:///modules/zendia/ui/ZendiaAgentModelCard.sys.mjs",
  effortLabel: "resource:///modules/zendia/ui/ZendiaAgentModelCard.sys.mjs",
  Veil: "resource:///modules/zendia/ui/ZendiaAgentMotion.sys.mjs",
  WorkingRing: "resource:///modules/zendia/ui/ZendiaAgentMotion.sys.mjs",
  rollText: "resource:///modules/zendia/ui/ZendiaAgentMotion.sys.mjs",
  seedOf: "resource:///modules/zendia/ui/ZendiaAgentMotion.sys.mjs",
  workingWord: "resource:///modules/zendia/ui/ZendiaAgentMotion.sys.mjs",
  ZendiaAgentUiView: "resource:///modules/zendia/ui/ZendiaAgentUiView.sys.mjs",
  hideFloat: "resource:///modules/zendia/ui/ZendiaPicker.sys.mjs",
  showFloat: "resource:///modules/zendia/ui/ZendiaPicker.sys.mjs",
  ZendiaPicker: "resource:///modules/zendia/ui/ZendiaPicker.sys.mjs",
  ZendiaTheme: "resource:///modules/zendia/ui/ZendiaTheme.sys.mjs",
  ZendiaWebChatDictation:
    "resource:///modules/zendia/webchat/ZendiaWebChatDictation.sys.mjs",
  ZendiaKeys: "resource:///modules/zendia/core/ZendiaKeys.sys.mjs",
  renderMarkdown: "resource:///modules/zendia/ui/ZendiaMarkdown.sys.mjs",
});

const HTML_NS = "http://www.w3.org/1999/xhtml";
// The key held to dictate, from anywhere in the window: the panel opens,
// it listens while the key is down and finishes when it is let go.
const PREF_HOLD_KEY = "zendia.dictation.hold-key";
const DEFAULT_HOLD_KEY = "<A-Space>";
const MODIFIER_NAMES = { C: "Ctrl", A: "Alt", S: "Shift", D: "Super" };
const MODIFIER_KEYS = {
  C: ["Control"],
  A: ["Alt"],
  S: ["Shift"],
  D: ["Meta", "OS", "Super"],
};

// <A-Space> as the user reads it: Alt+Space.
function holdKeyLabel(token) {
  const match = /^<((?:[CASD]-)*)(.+)>$/.exec(token);
  if (!match) {
    return token;
  }
  const modifiers = match[1]
    .split("-")
    .filter(Boolean)
    .map(letter => MODIFIER_NAMES[letter]);
  return [...modifiers, match[2]].join("+");
}
// The kinds of picture the clipboard may hold, in the order tried.
const IMAGE_FLAVORS = ["image/png", "image/jpeg", "image/gif"];
const STEP_ICONS = { running: "◌", done: "✓", failed: "✕" };
// The lane under the conversation that the working row sits in. It stays
// when the row leaves, so the end of a turn moves nothing (zendia.css).
const FOOT_LANE = 32;

function formatElapsed(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// How long something took, as the working row and a finished group say it.
function formatDuration(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export class ZendiaAgentDock {
  #window;
  #frame;
  #root;
  #log;
  #input;
  #agentChip;
  #modelChip;
  #modelLogo;
  #modelName;
  #modelEffort;
  #modelCard;
  #tabChip;
  #attachRow;
  #mediaWarning;
  // The warning's key the user already saw, so a second Enter sends.
  #mediaAck = "";
  #chipAgent = "";
  #sendButton;
  #instructionsButton;
  // The header's CAPTCHA summary button.
  #captchaButton;
  #mic;
  // Speech to text, by a chat site's own (ZendiaWebChatDictation).
  #dictation;
  // What the dictation says about itself, shown instead of the hint:
  // {state, message, warning}.
  #dictationStatus = null;
  // The text around where the dictation writes, and what it wrote.
  #dictated = null;
  // Send was pressed while dictating: the request goes once the site has
  // written down what it heard.
  #sendAfterDictation = false;
  // The dictation wrote something.
  #dictationHeard = false;
  // The dictation key is held down: {code, modifiers, started}, where
  // started is whether holding it started the dictation.
  #hold = null;
  // The key was let go while the microphone prompt was up: once allowed,
  // the dictation ends rather than listen with nobody holding the key.
  #endWhenListening = false;
  #instructions;
  // What the user attached to the request they are writing: {name, size,
  // path} for a file on disk, {name, size, bytes} for a pasted one.
  #attachments = [];
  // Why the last file was not attached, shown instead of the hint until the
  // next key.
  #notice = "";
  #hint;
  // The end of the conversation: the lane with the working row, the two
  // rings and how the conversation scrolls.
  #foot;
  #working;
  #workingWord;
  #workingClock;
  #workingRing;
  #stepRing;
  // The running step's icon that holds #stepRing.
  #stepRingHolder = null;
  #follow;
  #veil;
  #jump;
  // A request sent from here that has not been seen in the log yet.
  #glideNext = false;
  // The conversation's end shows at once on the next draw.
  #jumpNext = true;
  // When each turn really started, for the clock: the time waiting for the
  // agent to start does not count. Conversation -> {sent, at}.
  #turnStarts = new WeakMap();
  // Each run of steps by its first message.
  #groups = new WeakMap();
  #pill;
  #handle;
  #uiView;
  #conversation = null;
  #unsubscribe = null;
  #timer = null;
  #onChange;
  #onStatus;
  #onSwitch;
  #onAgents;
  #picking = false;
  #renderQueued = false;
  // Each message's row, and what it showed when it was built.
  #rows = new WeakMap();

  /**
   * @param {Window} window A browser window.
   * @param {object} options
   * @param {() => void} options.onChange Called when the dock opens or
   *   closes.
   * @param {() => void} [options.onStatus] Called when `status` may have
   *   changed.
   * @param {() => void} [options.onSwitch] Called by the header's web chat
   *   button, which swaps this panel for the web chat's.
   * @param {() => void} [options.onAgents] Called by the header's agents
   *   button, which shows every agent's work (ZendiaAgentsPanel).
   */
  constructor(window, { onChange, onStatus, onSwitch, onAgents }) {
    this.#window = window;
    this.#onChange = onChange;
    this.#onStatus = onStatus;
    this.#onSwitch = onSwitch;
    this.#onAgents = onAgents;
    const document = window.document;
    const create = (tag, className, parent) => {
      const element = document.createElementNS(HTML_NS, tag);
      if (className) {
        element.className = className;
      }
      parent?.append(element);
      return element;
    };
    const roundButton = (className, parent, title) => {
      const button = create(
        "button",
        `zendia-agent-round-button ${className}`,
        parent
      );
      button.title = title;
      button.setAttribute("aria-label", title);
      // A click leaves the keys where the user was typing.
      button.addEventListener("mousedown", event => event.preventDefault());
      return button;
    };
    const iconButton = (className, parent, title) => {
      const button = create(
        "button",
        `zendia-agent-icon-button ${className}`,
        parent
      );
      button.title = title;
      button.setAttribute("aria-label", title);
      return button;
    };

    this.#frame = new lazy.ZendiaDockFrame(window, {
      id: "zendia-agent",
      label: "Ask your agent",
      branch: "zendia.agent.",
      // The conversation waits on the user, a picker is up, or the user
      // dictates: the slid-in panel stays.
      keepOpen: () =>
        this.#picking ||
        !!this.#conversation?.pendingConfirm ||
        !!this.#dictation?.active,
      onLayout: () => this.#syncPill(),
      // The model chip.
      onPrefs: () => this.#queueRender(),
      onCloseRequest: () => this.close(),
      onOpenRequest: options =>
        this.open(this.#window.gBrowser.selectedBrowser, options),
    });
    this.#root = this.#frame.root;
    this.#pill = this.#frame.pill;
    this.#handle = this.#frame.handle;

    const header = create("div", "zendia-agent-header", this.#root);
    this.#agentChip = create("button", "zendia-agent-chip", header);
    this.#agentChip.title = "Pick an agent (Tab cycles)";
    this.#agentChip.addEventListener("click", () => this.pickAgent());
    create("span", "zendia-agent-spacer", header);
    iconButton("agents", header, "All agents (<leader>aA)").addEventListener(
      "click",
      () => this.#onAgents?.()
    );
    iconButton("new-chat", header, "New chat (<leader>an)").addEventListener(
      "click",
      () =>
        this.reset(
          this.#conversation?.browser ?? this.#window.gBrowser.selectedBrowser
        )
    );
    this.#captchaButton = iconButton(
      "captcha",
      header,
      "Summarize the CAPTCHA found on this tab"
    );
    this.#captchaButton.hidden = true;
    this.#captchaButton.addEventListener("click", () => this.#runCaptcha());
    iconButton("web-chat", header, "Web chat (<leader>aw)").addEventListener(
      "click",
      () => this.#onSwitch?.()
    );
    this.#frame.addLayoutControls(header);
    iconButton("close", header, "Close (Esc)").addEventListener("click", () =>
      this.close()
    );

    this.#log = create("div", "zendia-agent-log", this.#root);
    this.#log.setAttribute("role", "log");
    this.#log.setAttribute("aria-live", "polite");
    this.#uiView = new lazy.ZendiaAgentUiView(window, {
      onPrompt: text => this.#askFromPage(text),
    });

    this.#foot = create("div", "zendia-agent-foot");
    this.#working = create("div", "zendia-agent-working", this.#foot);
    this.#working.setAttribute("role", "status");
    this.#workingRing = new lazy.WorkingRing(window, { size: 16 });
    this.#working.append(this.#workingRing.element);
    this.#workingWord = create(
      "span",
      "zendia-agent-working-word",
      this.#working
    );
    this.#workingClock = create(
      "span",
      "zendia-agent-working-clock",
      this.#working
    );
    this.#stepRing = new lazy.WorkingRing(window, { size: 12 });
    this.#veil = new lazy.Veil(window);
    this.#follow = new lazy.ZendiaAgentFollow(window, this.#log, {
      foot: this.#foot,
      lane: FOOT_LANE,
      onJump: shown => this.#jump.toggleAttribute("shown", shown),
    });

    const composer = create("div", "zendia-agent-composer", this.#root);
    this.#jump = create("button", "zendia-agent-jump", composer);
    this.#jump.type = "button";
    this.#jump.addEventListener("mousedown", event => event.preventDefault());
    this.#jump.addEventListener("click", () =>
      this.#follow.toEnd({ smooth: true })
    );
    this.#tabChip = create("div", "zendia-agent-tab", composer);
    this.#attachRow = create("div", "zendia-agent-attachments", composer);
    this.#attachRow.hidden = true;
    this.#mediaWarning = create("div", "zendia-agent-media-warning", composer);
    this.#mediaWarning.hidden = true;
    this.#mediaWarning.setAttribute("role", "alert");
    this.#input = create("textarea", "zendia-agent-input", composer);
    this.#input.rows = 1;
    this.#input.setAttribute("aria-label", "Ask your agent");
    this.#input.addEventListener("keydown", event => {
      // What the last dictation said goes with the next key, as a notice.
      if (this.#dictationStatus && !this.#dictation.active) {
        this.#dictationStatus = null;
        this.#queueRender();
      }
      this.#onKey(event);
    });
    this.#input.addEventListener("input", () => {
      this.#fitInput();
      this.#syncComposer();
    });
    // Pasting anywhere in the panel: text goes into the box as usual, files,
    // pictures and files copied in a file manager are attached.
    this.#root.addEventListener("paste", event => this.#onPaste(event));
    const bar = create("div", "zendia-agent-composer-bar", composer);
    const attach = roundButton("attach", bar, "Attach files");
    attach.addEventListener("click", () => this.#pickFiles());
    create("span", "zendia-agent-spacer", bar);
    // The mouse's way to the model; <leader>am keeps the keyboard picker.
    this.#modelChip = create("button", "zendia-agent-model", bar);
    this.#modelChip.type = "button";
    this.#modelChip.setAttribute("aria-haspopup", "dialog");
    this.#modelLogo = create(
      "span",
      "zendia-agent-model-logo",
      this.#modelChip
    );
    this.#modelName = create(
      "span",
      "zendia-agent-model-name",
      this.#modelChip
    );
    this.#modelEffort = create(
      "span",
      "zendia-agent-model-effort",
      this.#modelChip
    );
    this.#modelChip.addEventListener("mousedown", event =>
      event.preventDefault()
    );
    this.#modelChip.addEventListener("click", () => this.#toggleModelCard());
    this.#modelCard = new lazy.ZendiaAgentModelCard(window, {
      onChange: () => this.#renderModel(),
      onClose: ({ refocus }) => {
        this.#picking = false;
        if (refocus && this.#open) {
          this.#input.focus();
        }
      },
    });
    this.#instructionsButton = roundButton(
      "instructions",
      bar,
      "Agent instructions"
    );
    this.#instructionsButton.addEventListener("click", () =>
      this.#instructions.open()
    );
    // Speech to text, done by Gemini's dictation, or ChatGPT's.
    this.#mic = roundButton("mic", bar, "Dictate");
    this.#mic.setAttribute("aria-pressed", "false");
    this.#dictation = new lazy.ZendiaWebChatDictation(window, {
      onState: status => this.#onDictationState(status),
      onText: text => this.#onDictationText(text),
      onFocusLost: () => {
        if (this.#open) {
          this.#input.focus();
        }
      },
    });
    this.#mic.addEventListener("click", () => this.#toggleDictation());
    this.#syncMicTitle();
    // Before the window's other key handlers, the vim keys among them: the
    // dictation key is never typed into the page or the panel.
    window.addEventListener("keydown", event => this.#onHoldKeyDown(event), {
      capture: true,
    });
    window.addEventListener("keyup", event => this.#onHoldKeyUp(event), {
      capture: true,
    });
    // A key let go in another window never comes back as a keyup.
    window.addEventListener("blur", () => this.#releaseHold());
    this.#sendButton = roundButton("send", bar, "Send (Enter)");
    this.#sendButton.addEventListener("click", () => {
      if (this.#conversation?.running) {
        this.#conversation.stop();
      } else {
        this.#send();
      }
    });
    this.#hint = create("div", "zendia-agent-hint", composer);
    // Files dropped anywhere on the panel.
    this.#root.addEventListener("dragover", event => {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
        this.#root.setAttribute("dragging", "");
      }
    });
    this.#root.addEventListener("dragleave", event => {
      if (!this.#root.contains(event.relatedTarget)) {
        this.#root.removeAttribute("dragging");
      }
    });
    this.#root.addEventListener("drop", event => {
      this.#root.removeAttribute("dragging");
      if (event.dataTransfer?.files.length) {
        event.preventDefault();
        this.#attachDomFiles(event.dataTransfer.files);
      }
    });

    this.#instructions = new lazy.ZendiaAgentInstructionsView(window, {
      parent: this.#root,
      onPicking: busy => {
        this.#picking = busy;
      },
      onClose: () => {
        if (this.#open) {
          this.#input.focus();
        }
      },
    });
    const offInstructions = lazy.ZendiaAgentInstructions.subscribe(() =>
      this.#syncInstructions()
    );
    lazy.ZendiaAgentInstructions.load();
    window.addEventListener("unload", offInstructions, { once: true });

    this.#pill.addEventListener("click", () =>
      this.open(this.#window.gBrowser.selectedBrowser)
    );

    this.#window.gBrowser.tabContainer.addEventListener("TabSelect", () =>
      this.#onTabSelect()
    );
    const offTheme = lazy.ZendiaTheme.onChange(() => {
      this.#queueRender();
      this.#syncPill();
    });
    window.addEventListener(
      "unload",
      () => {
        offTheme();
        window.clearInterval(this.#timer);
      },
      { once: true }
    );
    // Last: the layout draws the pill, which reads all of the above.
    this.#frame.mount();
  }

  get #open() {
    return this.#frame.isOpen;
  }

  get isOpen() {
    return this.#open;
  }

  /** The side it sits at: "left" or "right". */
  get side() {
    return this.#frame.side;
  }

  /**
   * What the rest of the window shows of the selected tab's conversation.
   *
   * @returns {{open: boolean, running: boolean, unseen: boolean,
   *   color: string, name: string|undefined}}
   */
  get status() {
    const conversation = lazy.ZendiaAgents.conversationFor(
      this.#window.gBrowser.selectedBrowser
    );
    return {
      open: this.#open,
      running: !!conversation?.running,
      unseen: !!conversation?.unseen,
      color: lazy.agentColor(conversation?.agent.id),
      name: conversation?.agent.name,
    };
  }

  /**
   * The layout in use, which is the one picked unless a split has no room.
   *
   * @returns {"float"|"slide"|"split"}
   */
  get layout() {
    return this.#frame.layout;
  }

  /**
   * Open the dock on a tab, with its conversation.
   *
   * @param {Element} browser
   * @param {object} [options]
   * @param {boolean} [options.focus] Give it the keys.
   */
  async open(browser, { focus = true } = {}) {
    this.#frame.show();
    // The dictation's page loads while the panel is up, so the mic is ready
    // when pressed.
    this.#dictation.warmUp();
    this.#syncPill();
    this.#onChange();
    const conversation = await lazy.ZendiaAgents.open(browser);
    if (!this.#open || this.#window.gBrowser.selectedBrowser != browser) {
      return;
    }
    this.#bind(conversation);
    if (conversation) {
      conversation.unseen = false;
    }
    this.#render();
    if (focus) {
      this.#input.focus();
    }
  }

  close() {
    if (!this.#open) {
      return;
    }
    const focused = this.#root.contains(this.#window.document.activeElement);
    // Closed first: the instructions' close hands the keys to the input only
    // while the dock is open.
    this.#frame.hide();
    this.#instructions.close();
    // The mic's prompt has nowhere to open: what was said so far stays.
    this.#dictation.stop();
    this.#syncPill();
    this.#onChange();
    // Only hand the keys back when the dock had them, not when another
    // buffer opening closed it.
    if (focused) {
      this.#window.gBrowser.selectedBrowser.focus();
    }
  }

  /**
   * Another buffer of the browser UI takes the keys. A panel beside the tab
   * stays, as a split view pane would; one over the page goes.
   */
  release() {
    if (this.#frame.layout != "split") {
      this.close();
    }
  }

  /**
   * @param {Node} node
   * @returns {boolean} Whether the node is part of the dock.
   */
  contains(node) {
    return this.#frame.contains(node);
  }

  /**
   * @param {Element} browser
   */
  toggle(browser) {
    if (this.#open) {
      this.close();
    } else {
      this.open(browser);
    }
  }

  stop() {
    this.#conversation?.stop();
  }

  /**
   * Start over on the tab: stop the turn and forget the conversation.
   *
   * @param {Element} browser
   */
  reset(browser) {
    lazy.ZendiaAgents.reset(browser);
    // The tab in front may have had the chat too (the agent moved on from
    // it to another tab), or one of its own: either way the new chat is the
    // one of the tab the user is looking at.
    const selected = this.#window.gBrowser.selectedBrowser;
    if (selected != browser) {
      lazy.ZendiaAgents.reset(selected);
    }
    this.#bind(null);
    this.open(selected);
  }

  /**
   * Open the tab's conversation log, or the folder of all of them, in a new
   * tab next to it.
   *
   * @param {Element} browser
   */
  async openLog(browser) {
    const log = lazy.ZendiaAgents.conversationFor(browser)?.log;
    await log?.flush();
    const dir = lazy.ZendiaAgents.logDir;
    await IOUtils.makeDirectory(dir, { ignoreExisting: true });
    const path = log?.path ?? dir;
    this.#window.openTrustedLinkIn(PathUtils.toFileURI(path), "tab", {
      relatedToCurrent: true,
    });
  }

  /**
   * Choose the agent for this tab, and for new ones.
   */
  async pickAgent() {
    const agents = await lazy.ZendiaAgents.agents({ refresh: true });
    const current = this.#conversation?.agent.id;
    // The picker is not part of the panel: moving to it must not hide it.
    this.#picking = true;
    let index;
    try {
      index = await lazy.ZendiaPicker.open(this.#window, {
        title: "Agents",
        layout: "grid",
        items: agents.map(agent => ({
          icon: lazy.agentIcon(agent.id) ?? undefined,
          iconFill: lazy.iconIsTile(agent.id),
          color: lazy.agentColor(agent.id),
          label: agent.name,
          detail: agent.path
            ? [agent.version, agent.id == current && "current"]
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
    if (!agent?.path) {
      this.#input.focus();
      return;
    }
    lazy.ZendiaAgents.setDefaultAgent(agent.id);
    this.#conversation?.setAgent(agent);
    // The new agent's models are what the next picker shows.
    lazy.ZendiaAgents.models(agent);
    if (this.#open) {
      this.#render();
      this.#input.focus();
    } else {
      this.open(this.#window.gBrowser.selectedBrowser);
    }
  }

  /**
   * Choose the model the tab's agent runs with, from the ones its CLI lists;
   * it applies from the next request, in this conversation too.
   */
  async pickModel() {
    const agent =
      this.#conversation?.agent ?? (await lazy.ZendiaAgents.defaultAgent());
    if (!agent) {
      return;
    }
    const current = lazy.ZendiaAgents.modelFor(agent.id);
    const needs = this.#attachedKinds();
    const items = await this.#modelList(agent);
    this.#picking = true;
    let index;
    try {
      index = await lazy.ZendiaPicker.open(this.#window, {
        title: needs.length
          ? `${agent.name} models · attached ${needs.join(" and ")}`
          : `${agent.name} models`,
        items: items.map(model => ({
          label: `${model.name}${model.id == current ? "  ·  current" : ""}`,
          detail: [model.id, this.#inputNote(model, needs), model.detail]
            .filter(Boolean)
            .join(" · "),
        })),
      });
    } finally {
      this.#picking = false;
    }
    const model = items[index];
    if (model) {
      lazy.ZendiaAgents.setModel(agent.id, model.id);
      this.#renderModel();
    }
    if (this.#open) {
      this.#input.focus();
    }
  }

  // The models to pick from, the ones that read what is attached first.
  // Remembered lists answer at once; only a first-ever ask waits for the CLI,
  // and says so.
  async #modelList(agent) {
    const current = lazy.ZendiaAgents.modelFor(agent.id);
    const asked = lazy.ZendiaAgents.models(agent);
    const slow = this.#window.setTimeout(() => {
      this.#modelName.textContent = "listing models…";
      this.#modelEffort.hidden = true;
    }, 150);
    const models = await asked;
    this.#window.clearTimeout(slow);
    this.#renderModel();
    const needs = this.#attachedKinds();
    // Models that read it, then those not known to, then those that cannot.
    const rank = model => {
      if (!model.input) {
        return 1;
      }
      return needs.every(kind => model.input.includes(kind)) ? 2 : 0;
    };
    const ordered = needs.length
      ? models
          .map((model, i) => ({ model, i }))
          .sort((a, b) => rank(b.model) - rank(a.model) || a.i - b.i)
          .map(({ model }) => model)
      : models;
    const items = [
      { id: "", name: "Default", detail: `what ${agent.name}'s settings pick` },
      ...ordered,
    ];
    // A model picked before that the list no longer has stays pickable.
    if (current && !models.some(model => model.id == current)) {
      items.push({ id: current, name: current, detail: "" });
    }
    return items;
  }

  // The chip's card, which a second click closes.
  async #toggleModelCard() {
    if (this.#modelCard.isOpen) {
      this.#modelCard.close();
      return;
    }
    const agent = this.#conversation?.agent;
    if (!agent) {
      return;
    }
    const needs = this.#attachedKinds();
    const items = await this.#modelList(agent);
    // The card is not part of the panel: moving to it must not hide it.
    this.#picking = true;
    this.#modelCard.open(
      this.#modelChip,
      agent,
      items.map(model => {
        const note = this.#inputNote(model, needs);
        return { ...model, note, tone: note == "reads it" ? "good" : "warn" };
      })
    );
  }

  // What a model reads, for its row in the picker: when something attached
  // needs it, whether it does; else whether it sees pictures.
  #inputNote(model, needs) {
    if (!model.input) {
      return "";
    }
    if (needs.length) {
      const missing = needs.filter(kind => !model.input.includes(kind));
      return missing.length ? `cannot read ${missing.join(", ")}` : "reads it";
    }
    return model.input.includes("image") ? "" : "text only";
  }

  // The kinds of input the attached files need beyond text.
  #attachedKinds() {
    return [
      ...new Set(this.#attachments.map(lazy.inputKindOf).filter(Boolean)),
    ];
  }

  #renderModel() {
    const agent = this.#conversation?.agent;
    this.#modelChip.hidden = !agent;
    if (agent) {
      const id = lazy.ZendiaAgents.modelFor(agent.id);
      const model = lazy.ZendiaAgents.modelsNow(agent.id).find(
        known => known.id == id
      );
      const textOnly = !!model?.input && !model.input.includes("image");
      // Only a level that is really sent shows here.
      const { effort } = lazy.ZendiaAgents.optionsFor(agent.id);
      lazy.rollText(this.#modelName, id ? model?.name || id : "Default");
      lazy.rollText(this.#modelEffort, effort ? lazy.effortLabel(effort) : "");
      this.#modelEffort.hidden = !effort;
      this.#modelChip.toggleAttribute("text-only", textOnly);
      this.#modelChip.title = textOnly
        ? "This model reads text only, not pictures (Pick a model)"
        : "Pick a model (<leader>am)";
    }
    this.#syncMediaWarning();
  }

  // Attached pictures, video, audio or PDFs the model cannot read: say so
  // before the agent guesses from their names, and offer one that can.
  #mediaIssue() {
    const agent = this.#conversation?.agent;
    const kinds = this.#attachedKinds();
    const inputs = agent && lazy.ZendiaAgents.inputsOf(agent.id);
    if (!kinds.length || !inputs) {
      return null;
    }
    const blind = kinds.filter(kind => !inputs.includes(kind));
    if (!blind.length) {
      return null;
    }
    const picked = lazy.ZendiaAgents.modelFor(agent.id);
    const models = lazy.ZendiaAgents.modelsNow(agent.id);
    return {
      agent,
      blind,
      model: models.find(model => model.id == picked)?.name ?? picked,
      best: models.find(model =>
        blind.every(kind => model.input?.includes(kind))
      ),
      key: `${picked}|${blind.join()}`,
    };
  }

  #syncMediaWarning() {
    const issue = this.#mediaIssue();
    const box = this.#mediaWarning;
    box.hidden = !issue;
    if (!issue) {
      this.#mediaAck = "";
      box.replaceChildren();
      delete box.dataset.shown;
      return;
    }
    const shown = `${issue.key}|${issue.best?.id}|${this.#mediaAck == issue.key}`;
    if (box.dataset.shown == shown) {
      return;
    }
    box.dataset.shown = shown;
    box.toggleAttribute("nudge", this.#mediaAck == issue.key);
    const things = issue.blind
      .map(kind => (kind == "pdf" ? "PDFs" : `${kind}s`))
      .join(" or ");
    const text = this.#create("span", "zendia-agent-media-text");
    text.append(
      this.#create("b", "", issue.model),
      ` can't read ${things}. The agent would only get the file's name, so it can't tell what is in it.`
    );
    const actions = this.#create("span", "zendia-agent-media-actions");
    if (issue.best) {
      const swap = this.#create(
        "button",
        "zendia-agent-button primary",
        `Use ${issue.best.name}`
      );
      swap.title = "Switch to a model that can read it";
      swap.addEventListener("mousedown", event => event.preventDefault());
      swap.addEventListener("click", () => {
        lazy.ZendiaAgents.setModel(issue.agent.id, issue.best.id);
        this.#renderModel();
        this.#input.focus();
      });
      actions.append(swap);
    }
    const pick = this.#create("button", "zendia-agent-button", "Pick…");
    pick.title = "Choose another model";
    pick.addEventListener("mousedown", event => event.preventDefault());
    pick.addEventListener("click", () => this.pickModel());
    const anyway = this.#create("button", "zendia-agent-button", "Send anyway");
    anyway.addEventListener("mousedown", event => event.preventDefault());
    anyway.addEventListener("click", () => {
      this.#mediaAck = issue.key;
      this.#send();
    });
    actions.append(pick, anyway);
    box.replaceChildren(text, actions);
  }

  // Layout.

  // Conversation.

  #bind(conversation) {
    if (conversation == this.#conversation) {
      return;
    }
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#conversation = conversation;
    this.#jumpNext = true;
    this.#modelCard.close();
    if (conversation) {
      this.#unsubscribe = conversation.subscribe(() => this.#onConversation());
    }
  }

  #onConversation() {
    // The tab's chat changed under the panel: an agent working the tab took
    // it over from an empty one.
    const current = lazy.ZendiaAgents.conversationFor(
      this.#window.gBrowser.selectedBrowser
    );
    if (current && current != this.#conversation) {
      this.#bind(current);
    } else if (!current && this.#conversation?.discarded) {
      // Dismissed from the agents panel: the tab starts over.
      this.#bind(null);
      if (this.#open) {
        this.open(this.#window.gBrowser.selectedBrowser, { focus: false });
      } else {
        this.#syncPill();
      }
      return;
    }
    const conversation = this.#conversation;
    if (this.#open && conversation) {
      conversation.unseen = false;
    }
    if (conversation?.pendingConfirm && !this.#open) {
      // The agent waits on the user: show the question.
      this.open(conversation.browser);
      return;
    }
    // Text streams in a delta at a time: draw once a frame.
    this.#queueRender();
    this.#syncPill();
  }

  #onTabSelect() {
    const browser = this.#window.gBrowser.selectedBrowser;
    if (this.#open) {
      // Beside the tab the panel follows it without taking the keys, and so
      // it does while the agent works: the tab may be one it brought to the
      // front to type in.
      const running = lazy.ZendiaAgents.conversationFor(browser)?.running;
      this.open(browser, { focus: this.#frame.layout != "split" && !running });
    } else {
      this.#bind(lazy.ZendiaAgents.conversationFor(browser));
      this.#syncPill();
    }
    this.#syncCaptchaButton(browser);
  }

  // The header's CAPTCHA button: the subagent summarizes the watch's
  // finding on the tab now, as it does on its own after the agent's work.
  #runCaptcha() {
    const browser =
      this.#conversation?.browser ?? this.#window.gBrowser.selectedBrowser;
    lazy.ZendiaCaptchaAgent.runNow(browser).catch(e =>
      console.error("Zendia: the CAPTCHA button failed", e)
    );
  }

  // The button shows while the watch has a finding on the dock's tab.
  #syncCaptchaButton(browser) {
    this.#captchaButton.hidden = !lazy.ZendiaCaptchaWatch.lastFor(browser);
  }

  #onKey(event) {
    const conversation = this.#conversation;
    const empty = !this.#input.value;
    const pending = conversation?.pendingConfirm;
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
    const ctrl =
      event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
    let handled = true;
    if (this.#notice) {
      this.#notice = "";
      this.#queueRender();
    }
    if (event.key == "Escape") {
      if (this.#frame.layout == "split") {
        // Back to the page, as leaving a vim window; the panel stays.
        this.#window.gBrowser.selectedBrowser.focus();
      } else {
        this.close();
      }
    } else if (
      pending &&
      empty &&
      plain &&
      (event.key == "y" || event.key == "n")
    ) {
      pending.answer(event.key == "y");
    } else if (
      ((event.key.toLowerCase() == "v" && event.ctrlKey) ||
        (event.key == "Insert" && event.shiftKey)) &&
      !event.altKey &&
      !event.metaKey &&
      this.#clipboardHoldsFiles()
    ) {
      // A text box's own paste does nothing when the clipboard has no text
      // (a picture, a file copied in a file manager), so it is done here.
      this.#pasteFiles();
    } else if (event.key == "Enter" && !event.shiftKey) {
      this.#send();
    } else if (event.key == "c" && event.ctrlKey && conversation?.running) {
      conversation.stop();
    } else if (ctrl && ["w", "u", "h"].includes(event.key)) {
      // Insert mode's keys, not the browser's: Ctrl+W would close the tab.
      this.#deleteBack(event.key);
    } else if (event.key == "Tab" && plain) {
      this.#cycleAgent(event.shiftKey ? -1 : 1);
    } else {
      handled = false;
    }
    if (handled) {
      event.preventDefault();
    }
    // The page's keys never see what is typed here.
    event.stopPropagation();
  }

  // Ctrl+W deletes the word before the cursor, Ctrl+U the line up to it and
  // Ctrl+H a character, as in vim's insert mode.
  #deleteBack(key) {
    const input = this.#input;
    const end = input.selectionEnd;
    let start = input.selectionStart;
    if (start == end) {
      const before = input.value.slice(0, end);
      if (key == "w") {
        start = end - before.match(/(?:\w+|[^\w\s]+)?\s*$/)[0].length;
      } else if (key == "u") {
        start = before.lastIndexOf("\n") + 1;
      } else {
        start = Math.max(0, end - 1);
      }
      if (start == end && key != "h" && start > 0) {
        // At the start of a line, join it to the one before.
        start--;
      }
    }
    if (start == end) {
      return;
    }
    input.setSelectionRange(start, end);
    // Through the editor, so Ctrl+Z brings it back.
    if (!this.#window.document.execCommand("delete")) {
      input.setRangeText("", start, end, "end");
    }
    this.#fitInput();
  }

  async #cycleAgent(direction) {
    const conversation = this.#conversation;
    if (!conversation || conversation.running) {
      return;
    }
    const installed = (
      lazy.ZendiaAgents.knownAgents() ?? (await lazy.ZendiaAgents.agents())
    ).filter(agent => agent.path);
    const index = installed.findIndex(
      agent => agent.id == conversation.agent.id
    );
    const next =
      installed[(index + direction + installed.length) % installed.length];
    if (next) {
      lazy.ZendiaAgents.setDefaultAgent(next.id);
      conversation.setAgent(next);
      // So the model picker is ready by the time it is asked for.
      lazy.ZendiaAgents.models(next);
    }
  }

  // Attaching files.

  async #pickFiles() {
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(
      Ci.nsIFilePicker
    );
    picker.init(
      this.#window.browsingContext,
      "Attach files",
      Ci.nsIFilePicker.modeOpenMultiple
    );
    picker.appendFilters(Ci.nsIFilePicker.filterAll);
    // The dialog is not part of the panel: moving to it must not hide it.
    this.#picking = true;
    let result;
    try {
      result = await new Promise(resolve => picker.open(resolve));
    } finally {
      this.#picking = false;
    }
    if (result == Ci.nsIFilePicker.returnOK) {
      const paths = [];
      for (const files = picker.files; files.hasMoreElements(); ) {
        paths.push(files.getNext().QueryInterface(Ci.nsIFile).path);
      }
      await this.#attachPaths(paths);
    }
    if (this.#open) {
      this.#input.focus();
    }
  }

  // A paste into the panel. Files and pictures on the clipboard, and files
  // copied in a file manager, are attached; text is left to the box.
  #onPaste(event) {
    const data = event.clipboardData;
    // Another box of the panel (the instructions) takes its own paste.
    const field = event.target.closest?.("textarea, input");
    if (!data || !this.#conversation || (field && field != this.#input)) {
      return;
    }
    if (data.files.length) {
      event.preventDefault();
      this.#attachDomFiles(data.files);
      return;
    }
    const paths = this.#clipboardPaths(data);
    if (paths.length) {
      event.preventDefault();
      this.#attachPaths(paths);
    } else if (event.target != this.#input && data.getData("text/plain")) {
      // Pasted somewhere else in the panel: it is meant for the request.
      event.preventDefault();
      this.#input.focus();
      this.#input.setRangeText(
        data.getData("text/plain"),
        this.#input.selectionStart,
        this.#input.selectionEnd,
        "end"
      );
      this.#fitInput();
      this.#syncComposer();
    }
  }

  // Whether the clipboard has files or a picture and no text: the only
  // time the box's own paste has nothing to do. Files win over text (a
  // file manager also puts the file's path there); a picture does not (a
  // spreadsheet's cells come with one).
  #clipboardHoldsFiles() {
    const has = flavor =>
      Services.clipboard.hasDataMatchingFlavors(
        [flavor],
        Ci.nsIClipboard.kGlobalClipboard
      );
    try {
      return (
        has("application/x-moz-file") ||
        (!has("text/plain") && IMAGE_FLAVORS.some(has))
      );
    } catch {
      return false;
    }
  }

  // Attach what the clipboard holds: files by their paths, a picture by its
  // bytes.
  async #pasteFiles() {
    const read = flavor => {
      const transferable = Cc[
        "@mozilla.org/widget/transferable;1"
      ].createInstance(Ci.nsITransferable);
      transferable.init(null);
      transferable.addDataFlavor(flavor);
      Services.clipboard.getData(
        transferable,
        Ci.nsIClipboard.kGlobalClipboard
      );
      const data = {};
      transferable.getTransferData(flavor, data);
      return data.value;
    };
    const found = [];
    try {
      // A list of files, as a file manager puts it, else the first one.
      let list = "";
      try {
        list = read("text/uri-list")?.QueryInterface(Ci.nsISupportsString).data;
      } catch {
        // Not offered as a list.
      }
      for (const uri of (list ?? "").split(/\r?\n/)) {
        if (uri.startsWith("file://")) {
          found.push(
            Services.io.newURI(uri).QueryInterface(Ci.nsIFileURL).file.path
          );
        }
      }
      if (!found.length) {
        const file = read("application/x-moz-file")?.QueryInterface(Ci.nsIFile);
        if (file) {
          found.push(file.path);
        }
      }
    } catch {
      // No files; maybe a picture.
    }
    if (!found.length) {
      // A picture, through the async clipboard, which decodes what the
      // desktop offers.
      try {
        for (const item of await this.#window.navigator.clipboard.read()) {
          const type = item.types.find(kind => IMAGE_FLAVORS.includes(kind));
          if (type) {
            const blob = await item.getType(type);
            found.push({
              name: `pasted-image.${type.split("/")[1].replace("jpeg", "jpg")}`,
              size: blob.size,
              type,
              bytes: new Uint8Array(await blob.arrayBuffer()),
            });
          }
        }
      } catch {
        // Nothing readable.
      }
    }
    if (found.length) {
      await this.#attachPaths(found);
    } else {
      this.#refuse("", "Nothing on the clipboard could be attached");
      this.#queueRender();
    }
  }

  // Where the files a file manager copied are: the browser's own flavor
  // first, then the URI lists desktops put on the clipboard.
  #clipboardPaths(data) {
    const paths = new Set();
    try {
      for (let i = 0; i < (data.mozItemCount ?? 0); i++) {
        const file = data.mozGetDataAt("application/x-moz-file", i);
        if (file?.path) {
          paths.add(file.path);
        }
      }
    } catch {
      // Not a file.
    }
    if (!paths.size) {
      const uris = [
        data.getData("text/uri-list"),
        data.getData("x-special/gnome-copied-files"),
      ]
        .join("\n")
        .split(/\r?\n/)
        .filter(line => line.startsWith("file://"));
      for (const uri of uris) {
        try {
          paths.add(
            Services.io.newURI(uri).QueryInterface(Ci.nsIFileURL).file.path
          );
        } catch {
          // Not a local file.
        }
      }
    }
    return [...paths];
  }

  // Dropped or pasted files: the browser's own know where they live; a
  // picture from the clipboard does not, so its bytes are kept.
  async #attachDomFiles(files) {
    const found = [];
    for (const file of files) {
      if (file.mozFullPath) {
        found.push(file.mozFullPath);
      } else if (file.size > lazy.ATTACH_MAX_BYTES) {
        this.#refuse(file.name, "is over 25 MB");
      } else {
        found.push({
          name: file.name || "pasted-file",
          size: file.size,
          type: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
      }
    }
    await this.#attachPaths(found);
  }

  async #attachPaths(found) {
    for (const item of found) {
      if (this.#attachments.length >= lazy.ATTACH_MAX_FILES) {
        this.#refuse(
          "",
          `Only ${lazy.ATTACH_MAX_FILES} files go with a request`
        );
        break;
      }
      if (typeof item != "string") {
        this.#attachments.push(item);
        continue;
      }
      const name = PathUtils.filename(item);
      let info;
      try {
        info = await IOUtils.stat(item);
      } catch (e) {
        this.#refuse(name, "could not be read");
        continue;
      }
      if (info.type == "directory") {
        this.#refuse(name, "is a folder");
      } else if (info.size > lazy.ATTACH_MAX_BYTES) {
        this.#refuse(name, "is over 25 MB");
      } else if (!this.#attachments.some(file => file.path == item)) {
        this.#attachments.push({ name, size: info.size, path: item });
      }
    }
    this.#renderAttachments();
    this.#syncComposer();
    this.#queueRender();
  }

  #refuse(name, why) {
    this.#notice = name ? `${name} ${why}` : why;
  }

  #removeAttachment(file) {
    this.#releasePreviews([file]);
    this.#attachments = this.#attachments.filter(other => other != file);
    this.#renderAttachments();
    this.#syncComposer();
  }

  #renderAttachments() {
    this.#syncMediaWarning();
    this.#attachRow.hidden = !this.#attachments.length;
    this.#attachRow.replaceChildren(
      ...this.#attachments.map(file => {
        const kind = lazy.mediaKind(file);
        if (kind) {
          return this.#renderTile(file, kind);
        }
        const chip = this.#create("span", "zendia-agent-attachment");
        const name = this.#create(
          "span",
          "zendia-agent-attachment-name",
          file.name
        );
        const size = this.#create(
          "span",
          "zendia-agent-attachment-size",
          lazy.formatSize(file.size)
        );
        const remove = this.#create("button", "zendia-agent-attachment-x");
        remove.title = `Remove ${file.name}`;
        remove.setAttribute("aria-label", remove.title);
        remove.addEventListener("mousedown", event => event.preventDefault());
        remove.addEventListener("click", () => this.#removeAttachment(file));
        chip.title = file.path ?? file.name;
        chip.append(name, size, remove);
        return chip;
      })
    );
  }

  // A picture or video: a rounded preview of it, not a chip.
  #renderTile(file, kind) {
    const tile = this.#create("span", "zendia-agent-attachment-tile");
    tile.setAttribute("kind", kind);
    tile.title = `${file.name} · ${lazy.formatSize(file.size)}`;
    file.url ??= file.path
      ? PathUtils.toFileURI(file.path)
      : this.#window.URL.createObjectURL(
          new this.#window.Blob([file.bytes], { type: file.type })
        );
    const media = this.#create(kind == "image" ? "img" : "video");
    media.setAttribute("alt", file.name);
    if (kind == "video") {
      // Its first frame; it never plays.
      media.muted = true;
      media.preload = "metadata";
      media.src = `${file.url}#t=0.1`;
    } else {
      media.src = file.url;
    }
    const remove = this.#create("button", "zendia-agent-attachment-x");
    remove.title = `Remove ${file.name}`;
    remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("mousedown", event => event.preventDefault());
    remove.addEventListener("click", () => this.#removeAttachment(file));
    tile.append(media, remove);
    return tile;
  }

  // The copies of pasted pictures the previews were made from.
  #releasePreviews(files) {
    for (const file of files) {
      if (file.bytes && file.url) {
        this.#window.URL.revokeObjectURL(file.url);
      }
    }
  }

  // The send button: it sends what is written or attached, and stops the
  // agent while it works.
  #syncComposer() {
    const conversation = this.#conversation;
    const running = !!conversation?.running;
    // While dictating there is something to send, even before the site
    // wrote it down.
    const dictating = ["listening", "finishing"].includes(
      this.#dictation?.state
    );
    const ready =
      !!conversation &&
      (dictating || !!this.#input.value.trim() || !!this.#attachments.length);
    this.#sendButton.toggleAttribute("running", running);
    this.#sendButton.disabled = !running && !ready;
    let title = "Send (Enter)";
    if (running) {
      title = "Stop (Ctrl+C)";
    } else if (dictating) {
      title = this.#sendAfterDictation
        ? "Sends once the dictation is written down"
        : "Finish dictation and send (Enter)";
    }
    this.#sendButton.title = title;
    this.#sendButton.setAttribute("aria-label", this.#sendButton.title);
  }

  #syncInstructions() {
    const count = lazy.ZendiaAgentInstructions.activeCount;
    this.#instructionsButton.toggleAttribute("active", count > 0);
    this.#instructionsButton.title = count
      ? `Agent instructions · ${count} on`
      : "Agent instructions";
    this.#instructionsButton.setAttribute(
      "aria-label",
      this.#instructionsButton.title
    );
  }

  #send() {
    const dictation = this.#dictation;
    if (dictation.state == "connecting") {
      // Nothing said yet: what is in the box goes as it is.
      dictation.cancel();
    } else if (dictation.active) {
      // Send while dictating finishes it, and sends once what was said is
      // in the box.
      this.#sendAfterDictation = true;
      if (dictation.state == "listening") {
        dictation.stop();
      }
      this.#syncComposer();
      this.#queueRender();
      return;
    }
    const conversation = this.#conversation;
    const text = this.#input.value.trim();
    const files = this.#attachments;
    if (!conversation || (!text && !files.length) || conversation.running) {
      return;
    }
    // A model that cannot read what is attached: the first Enter shows why
    // (the warning above the box), the second sends.
    const issue = this.#mediaIssue();
    if (issue && this.#mediaAck != issue.key) {
      this.#mediaAck = issue.key;
      this.#syncMediaWarning();
      this.#hint.textContent = `${issue.model} can't read these · Enter again to send anyway`;
      this.#hint.setAttribute("warning", "");
      return;
    }
    this.#input.value = "";
    this.#attachments = [];
    this.#releasePreviews(files);
    this.#renderAttachments();
    this.#fitInput();
    this.#syncComposer();
    // The page takes focus while the agent types and presses keys in it;
    // the dock stays open, and <leader>aa comes back to it.
    if (this.#window.gBrowser.selectedBrowser == conversation.browser) {
      conversation.browser.focus();
    }
    this.#glideNext = true;
    conversation
      .send(
        text,
        files.map(({ name, path, bytes }) => ({ name, path, bytes }))
      )
      .catch(e => {
        console.error("Zendia: the agent turn failed", e);
      });
  }

  /**
   * A request from a page the agent shows in the panel
   * (ZendiaUiParent).
   *
   * @param {Element} browser The page's browser.
   * @param {string} name
   * @param {object} data
   * @returns {true|string} true, or why not.
   */
  uiRequest(browser, name, data) {
    return this.#uiView.request(browser, name, data);
  }

  // A page's follow-up question, sent as if the user typed it.
  #askFromPage(text) {
    const conversation = this.#conversation;
    if (!conversation) {
      return "no agent to ask.";
    }
    if (conversation.running) {
      return `${conversation.agent.name} is still working; ask again when it is done.`;
    }
    this.#glideNext = true;
    conversation.send(text).catch(e => {
      console.error("Zendia: the agent turn failed", e);
    });
    return true;
  }

  // Dictation.

  get #holdKey() {
    return Services.prefs.getStringPref(PREF_HOLD_KEY, DEFAULT_HOLD_KEY);
  }

  #syncMicTitle(title = "Dictate") {
    const label =
      title == "Dictate"
        ? `Dictate (hold ${holdKeyLabel(this.#holdKey)})`
        : title;
    this.#mic.title = label;
    this.#mic.setAttribute("aria-label", label);
  }

  #isHoldKey(event) {
    return (
      event.isTrusted &&
      !!this.#holdKey &&
      lazy.ZendiaKeys.fromEvent(event) == this.#holdKey
    );
  }

  #onHoldKeyDown(event) {
    if (this.#hold && event.code == this.#hold.code) {
      // The key repeats while it is held.
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!this.#isHoldKey(event) || event.repeat) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const token = this.#holdKey;
    this.#hold = {
      code: event.code,
      modifiers: (/^<((?:[CASD]-)*)/.exec(token)?.[1] ?? "")
        .split("-")
        .filter(Boolean)
        .flatMap(letter => MODIFIER_KEYS[letter]),
      started: false,
    };
    this.#startHold(this.#hold);
  }

  async #startHold(hold) {
    if (this.#dictation.active) {
      // Already dictating, from the mic: letting go does not end it.
      return;
    }
    if (!this.#open) {
      await this.open(this.#window.gBrowser.selectedBrowser);
    } else {
      this.#input.focus();
    }
    // Let go while the panel was opening.
    if (this.#hold != hold || this.#dictation.active) {
      return;
    }
    if (!this.#conversation) {
      this.#notice = "No agent to dictate to.";
      this.#queueRender();
      return;
    }
    hold.started = true;
    this.#endWhenListening = false;
    this.#toggleDictation();
  }

  #onHoldKeyUp(event) {
    const hold = this.#hold;
    if (
      !hold ||
      (event.code != hold.code && !hold.modifiers.includes(event.key))
    ) {
      return;
    }
    if (event.code == hold.code) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    this.#releaseHold();
  }

  #releaseHold() {
    const hold = this.#hold;
    if (!hold) {
      return;
    }
    this.#hold = null;
    const dictation = this.#dictation;
    if (!hold.started || !dictation.active) {
      return;
    }
    const key = holdKeyLabel(this.#holdKey);
    if (dictation.state == "listening") {
      dictation.stop();
    } else if (dictation.prompting) {
      // The prompt stays for the user to answer; the next hold dictates.
      this.#endWhenListening = true;
    } else if (dictation.state == "connecting") {
      dictation.cancel();
      this.#notice = `Hold ${key} until it says “Speak now”.`;
      this.#queueRender();
    } else {
      this.#queueRender();
    }
  }

  #toggleDictation() {
    if (!this.#dictation.active) {
      if (!this.#conversation) {
        return;
      }
      // Where it writes: at the cursor, or over what is selected.
      const input = this.#input;
      this.#dictated = {
        before: input.value.slice(0, input.selectionStart),
        after: input.value.slice(input.selectionEnd),
      };
      this.#notice = "";
      this.#sendAfterDictation = false;
      this.#dictationHeard = false;
    }
    this.#dictation.toggle();
    this.#input.focus();
  }

  #onDictationState({ state, message, warning }) {
    const mic = this.#mic;
    const active = state != "idle";
    mic.toggleAttribute("connecting", state == "connecting");
    mic.toggleAttribute("recording", state == "listening");
    mic.toggleAttribute("finishing", state == "finishing");
    mic.setAttribute("aria-pressed", String(active));
    this.#syncMicTitle(
      {
        connecting: "Cancel dictation",
        listening: "Finish dictation",
        finishing: "Writing it down…",
      }[state] ?? "Dictate"
    );
    if (state == "listening" && this.#endWhenListening) {
      // Allowed after the key was let go: nothing was said yet.
      this.#endWhenListening = false;
      this.#dictation.cancel();
      this.#notice = `The microphone is allowed. Hold ${holdKeyLabel(this.#holdKey)} and speak.`;
      this.#queueRender();
      return;
    }
    if (state == "listening" && this.#hold?.started) {
      message = message.replace(
        "mic finishes · Enter sends",
        `let go of ${holdKeyLabel(this.#holdKey)} to finish`
      );
    }
    // The box is the dictation's while it writes into it.
    this.#input.readOnly = active;
    const shown =
      active && this.#sendAfterDictation
        ? `${message} · sends when done`
        : message;
    this.#dictationStatus = shown ? { state, message: shown, warning } : null;
    if (!active) {
      this.#dictated = null;
      this.#fitInput();
      const send = this.#sendAfterDictation && this.#dictationHeard;
      this.#sendAfterDictation = false;
      if (send) {
        this.#dictationStatus = null;
        this.#send();
      }
    }
    this.#syncComposer();
    this.#queueRender();
  }

  // What was said so far goes where the dictation started, all of it each
  // time: the site corrects what it heard as it goes.
  #onDictationText(text) {
    const range = this.#dictated;
    if (!range) {
      return;
    }
    const input = this.#input;
    const said = text.trim();
    this.#dictationHeard ||= !!said;
    const space = (left, right) =>
      left && right && !/\s$/.test(left) && !/^\s/.test(right) ? " " : "";
    const head = range.before + space(range.before, said);
    const tail = said ? space(said, range.after) + range.after : range.after;
    input.value = head + said + tail;
    const end = head.length + said.length;
    input.setSelectionRange(end, end);
    this.#fitInput();
    this.#syncComposer();
    if (this.#dictation.state == "listening") {
      this.#queueRender();
    }
  }

  #fitInput() {
    this.#input.style.height = "auto";
    this.#input.style.height = `${Math.min(this.#input.scrollHeight, 160)}px`;
  }

  // Drawing.

  #queueRender() {
    if (this.#renderQueued) {
      return;
    }
    this.#renderQueued = true;
    this.#window.requestAnimationFrame(() => {
      this.#renderQueued = false;
      this.#render();
    });
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

  // A button that puts `text()` on the clipboard and says so.
  #copyButton(text, label = "Copy", className = "") {
    const button = this.#create(
      "button",
      `zendia-agent-copy ${className}`.trim()
    );
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    // A click keeps the selection and the typing focus where they were.
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", () => {
      Cc["@mozilla.org/widget/clipboardhelper;1"]
        .getService(Ci.nsIClipboardHelper)
        .copyString(text());
      button.setAttribute("copied", "");
      button.title = "Copied";
      this.#window.setTimeout(() => {
        button.removeAttribute("copied");
        button.title = label;
      }, 1400);
    });
    return button;
  }

  // The logo of an agent, drawn from a data URL: one shape in the text
  // color for the monochrome ones, a picture for the rest.
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

  // The agent chip: its logo, name and a caret, redrawn only when the agent
  // changes.
  #renderChip(agent) {
    if (this.#chipAgent == (agent?.id ?? "")) {
      return;
    }
    this.#chipAgent = agent?.id ?? "";
    this.#agentChip.replaceChildren(
      this.#logo(agent?.id),
      this.#create("span", "zendia-agent-chip-name", agent?.name ?? "No agent"),
      this.#create("span", "zendia-agent-chip-caret")
    );
    this.#modelLogo.replaceChildren(this.#logo(agent?.id));
  }

  #installName(agent) {
    const name = this.#create("span", "zendia-agent-install-name");
    name.append(this.#logo(agent.id), agent.name);
    return name;
  }

  // Make a box's children exactly these, leaving the ones already in place
  // alone, so a streaming answer redraws only itself and a selection
  // elsewhere survives.
  #syncChildren(box, rows) {
    let child = box.firstChild;
    for (const row of rows) {
      if (row == child) {
        child = child.nextSibling;
      } else {
        box.insertBefore(row, child);
      }
    }
    while (child) {
      const next = child.nextSibling;
      child.remove();
      child = next;
    }
  }

  // The conversation's rows: steps in a row share a group that folds.
  #conversationRows(conversation, messages) {
    const rows = [];
    let run = [];
    const endRun = live => {
      if (run.length) {
        rows.push(this.#groupFor(run, live));
        run = [];
      }
    };
    for (const message of messages) {
      if (message.type == "step" || message.type == "tool") {
        run.push(message);
        continue;
      }
      endRun(false);
      const streaming =
        !!conversation.running &&
        message.type == "agent" &&
        message == messages.at(-1);
      rows.push(this.#rowFor(message, streaming));
    }
    endRun(!!conversation.running);
    return rows;
  }

  #groupFor(run, live) {
    let group = this.#groups.get(run[0]);
    if (!group) {
      group = {
        root: this.#create("div", "zendia-agent-group"),
        head: this.#create("button", "zendia-agent-group-head"),
        title: this.#create("span", "zendia-agent-group-title"),
        fold: this.#create("div", "zendia-agent-group-fold"),
        body: this.#create("div", "zendia-agent-group-body"),
        // Only a group seen working knows how long it took.
        startedAt: live ? Date.now() : 0,
        endedAt: 0,
        // What the reader chose, which outlasts the group folding itself.
        chosen: null,
        open: false,
      };
      group.head.type = "button";
      group.head.addEventListener("mousedown", event => event.preventDefault());
      group.head.addEventListener("click", () => {
        group.chosen = !group.open;
        this.#syncGroup(group);
      });
      group.head.append(
        group.title,
        this.#create("span", "zendia-agent-group-chevron")
      );
      group.body.addEventListener("scroll", () =>
        group.body.toggleAttribute("scrolled", group.body.scrollTop > 0)
      );
      group.fold.append(group.body);
      group.root.append(group.head, group.fold);
      this.#groups.set(run[0], group);
    }
    const known = new Set(group.body.children);
    const rows = run.map(message => this.#rowFor(message, false));
    for (const row of rows) {
      // Only what arrives while the reader watches slides in.
      row.toggleAttribute("fresh", live && !known.has(row));
    }
    // The steps box keeps to its newest step while the agent works, unless
    // the reader scrolled up to read an older one.
    const body = group.body;
    const atEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 8;
    this.#syncChildren(body, rows);
    if (live && atEnd) {
      body.scrollTop = body.scrollHeight;
    }
    if (group.live && !live) {
      group.endedAt = Date.now();
    }
    group.live = live;
    group.root.toggleAttribute("live", live);
    lazy.rollText(group.title, this.#groupTitle(group, run));
    this.#syncGroup(group);
    return group.root;
  }

  #syncGroup(group) {
    group.open = group.chosen ?? group.live;
    group.root.toggleAttribute("open", group.open);
    group.head.setAttribute("aria-expanded", String(group.open));
    // Rows clipped by the fold take no keys or clicks.
    group.fold.inert = !group.open;
  }

  // While it works, what it is doing; then, what it came to.
  #groupTitle(group, run) {
    if (group.live) {
      const last = run.at(-1);
      return last.type == "tool" ? `Used ${last.text}` : last.text;
    }
    const failed = run.filter(message => message.status == "failed").length;
    const steps = `${run.length} ${run.length == 1 ? "step" : "steps"}`;
    return [
      group.startedAt && group.endedAt
        ? `Worked for ${formatDuration(group.endedAt - group.startedAt)}`
        : "",
      steps,
      failed ? `${failed} failed` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  // The small ring goes on the step in flight; a redraw of that step takes
  // it off again.
  #placeStepRing() {
    const icons = this.#log.querySelectorAll(
      '[status="running"] > .zendia-agent-step-icon'
    );
    const icon = icons[icons.length - 1] ?? null;
    if (icon != this.#stepRingHolder && this.#stepRingHolder?.isConnected) {
      this.#stepRingHolder.textContent = STEP_ICONS.running;
    }
    this.#stepRingHolder = icon;
    if (icon) {
      if (this.#stepRing.element.parentNode != icon) {
        icon.replaceChildren(this.#stepRing.element);
      }
      this.#stepRing.start();
    } else {
      this.#stepRing.stop();
    }
  }

  #render() {
    const conversation = this.#conversation;
    const rows = [];
    const messages = conversation?.messages ?? [];
    if (!conversation) {
      rows.push(...this.#renderNoAgent());
    } else if (!messages.length) {
      rows.push(this.#renderEmpty(conversation.agent));
    } else {
      rows.push(...this.#conversationRows(conversation, messages));
      rows.push(this.#foot);
    }
    this.#syncChildren(this.#log, rows);
    this.#uiView.attach(this.#log);
    this.#placeStepRing();
    if (messages.length) {
      this.#scrollAfterRender(messages);
    }

    const agent = conversation?.agent;
    this.#renderChip(agent);
    this.#agentChip.style.setProperty(
      "--zendia-agent-color",
      lazy.agentColor(agent?.id)
    );
    this.#renderModel();
    const browser =
      conversation?.browser ?? this.#window.gBrowser.selectedBrowser;
    this.#tabChip.textContent =
      browser.contentTitle || browser.currentURI?.spec || "";
    this.#syncCaptchaButton(browser);
    this.#input.disabled = !conversation;
    let placeholder = "";
    let hint = `Enter send · Shift+Enter new line · Tab switch agent · Esc ${this.#frame.layout == "split" ? "back to the page" : "close"}`;
    if (conversation?.pendingConfirm) {
      hint = "y allow · n deny · Esc hide";
    } else if (conversation?.running) {
      placeholder = `${agent.name} is working on this tab…`;
      hint = "Ctrl+C stop · Esc hide, it keeps working";
    } else if (agent) {
      placeholder = `Ask ${agent.name} to do something on this tab`;
    }
    const dictation = this.#dictationStatus;
    if (this.#dictation.state == "listening" && !this.#input.value) {
      placeholder = "Listening… start speaking";
    }
    this.#input.placeholder = placeholder;
    this.#hint.textContent = this.#notice || dictation?.message || hint;
    this.#hint.toggleAttribute(
      "warning",
      !!this.#notice || !!dictation?.warning
    );
    this.#hint.toggleAttribute(
      "dictation",
      !this.#notice && !!dictation?.message && !dictation.warning
    );
    this.#root.toggleAttribute("running", !!conversation?.running);
    this.#jump.textContent = conversation?.running
      ? "New reply"
      : "Jump to latest";
    this.#syncComposer();
    this.#syncInstructions();
    this.#updateStatus();
  }

  #scrollAfterRender(messages) {
    if (this.#jumpNext) {
      this.#jumpNext = false;
      this.#glideNext = false;
      this.#follow.toEnd();
      return;
    }
    const prompt = this.#glideNext
      ? messages.findLast(message => message.type == "user")
      : null;
    if (prompt) {
      this.#glideNext = false;
      this.#follow.sent(this.#rows.get(prompt).row);
    } else {
      this.#follow.update();
    }
  }

  // A message's row, built again only when what it shows changed. An answer
  // that streams in keeps its row and has its Markdown drawn again.
  #rowFor(message, streaming) {
    const key = [
      message.type,
      message.status,
      message.detail,
      streaming,
      message.text,
      message.revision,
      message.files?.join("\u0001"),
    ].join("\u0000");
    const cached = this.#rows.get(message);
    if (cached?.key == key) {
      return cached.row;
    }
    let row = cached?.row;
    // An answer and a table or page keep their row: a page's browser and a
    // table's filter box live in it. So does a step, which would slide in
    // again when it finishes.
    if (!row || !["agent", "ui", "step"].includes(message.type)) {
      row = this.#create("div", "zendia-agent-message");
      row.setAttribute("type", message.type);
    }
    switch (message.type) {
      case "ui":
        this.#uiView.update(row, message);
        break;
      case "agent":
        row.classList.add("zendia-md");
        row.toggleAttribute("streaming", streaming);
        lazy.renderMarkdown(row, message.text, {
          partial: streaming,
          onLink: href =>
            this.#window.openWebLinkIn(href, "tab", { relatedToCurrent: true }),
        });
        // Only what just arrived fades in; a redraw continues a fade.
        this.#veil.update(row);
        if (!streaming && message.text.trim()) {
          // Each code block copies on its own; the whole answer copies as
          // the Markdown the agent wrote.
          for (const pre of row.querySelectorAll("pre")) {
            const code = pre.textContent;
            pre.append(this.#copyButton(() => code, "Copy code", "on-code"));
          }
          const actions = this.#create("div", "zendia-agent-actions");
          actions.append(
            this.#copyButton(() => message.text, "Copy answer", "labelled")
          );
          row.append(actions);
        }
        break;
      case "step": {
        row.setAttribute("status", message.status);
        row.replaceChildren(
          this.#create(
            "span",
            "zendia-agent-step-icon",
            STEP_ICONS[message.status] ?? "·"
          ),
          this.#create("span", "zendia-agent-step-title", message.text)
        );
        if (message.detail) {
          row.append(
            this.#create("span", "zendia-agent-step-detail", message.detail)
          );
        }
        break;
      }
      case "tool":
        row.textContent = `used ${message.text}`;
        break;
      case "user":
        row.append(this.#create("span", "", message.text));
        row.append(this.#copyButton(() => message.text, "Copy", "on-user"));
        if (message.files?.length) {
          const files = this.#create("span", "zendia-agent-sent-files");
          for (const name of message.files) {
            files.append(this.#create("span", "zendia-agent-attachment", name));
          }
          row.append(files);
        }
        break;
      case "confirm":
        this.#renderConfirm(row, message);
        break;
      default:
        row.textContent = message.text;
    }
    this.#rows.set(message, { key, row });
    return row;
  }

  // A question the agent waits on before something hard to undo: a card
  // with what it asks and the answers, which keys give too (y, n); once
  // answered, one quiet line of what was decided.
  #renderConfirm(row, message) {
    row.setAttribute("status", message.status);
    const name = this.#conversation?.agent?.name ?? "the agent";
    const pending = message.status == "pending";
    if (!pending) {
      const allowed = message.status == "allowed";
      row.replaceChildren(
        this.#create(
          "span",
          "zendia-agent-confirm-mark",
          allowed ? "\u2713" : "\u2715"
        ),
        this.#create(
          "span",
          "zendia-agent-confirm-done",
          `${allowed ? "Allowed" : "Declined"} \u00b7 ${message.text}`
        )
      );
      return;
    }
    const head = this.#create("div", "zendia-agent-confirm-head");
    head.append(
      this.#create("span", "zendia-agent-confirm-icon"),
      this.#create("span", "zendia-agent-confirm-label", "Permission needed")
    );
    const text = this.#create("div", "zendia-agent-confirm-text");
    text.append(
      `Allow ${name} to `,
      this.#create("strong", "", message.text),
      "?"
    );
    const button = (label, key, primary, allowed) => {
      const element = this.#create(
        "button",
        `zendia-agent-button${primary ? " primary" : ""}`
      );
      element.append(label, this.#create("kbd", "zendia-agent-key", key));
      element.addEventListener("mousedown", event => event.preventDefault());
      element.addEventListener("click", () => message.answer(allowed));
      return element;
    };
    const actions = this.#create("div", "zendia-agent-confirm-actions");
    actions.append(
      button("Deny", "N", false, false),
      button("Allow", "Y", true, true)
    );
    row.replaceChildren(head, text, actions);
  }

  #renderEmpty(agent) {
    const empty = this.#create("div", "zendia-agent-empty");
    const mark = this.#logo(agent.id);
    mark.classList.add("large");
    empty.append(
      mark,
      this.#create(
        "div",
        "zendia-agent-empty-title",
        `Ask ${agent.name} about this tab`
      ),
      this.#create(
        "div",
        "zendia-agent-empty-detail",
        "It reads the page, clicks, types and moves between pages for you, and asks before anything you have to allow."
      )
    );
    return empty;
  }

  #renderNoAgent() {
    const rows = [
      this.#create(
        "div",
        "zendia-agent-message",
        "No coding agent found on this computer. zendia works with the one you already use: install one, then look again."
      ),
    ];
    const list = this.#create("div", "zendia-agent-install");
    lazy.ZendiaAgents.agents().then(agents => {
      for (const agent of agents) {
        const row = this.#create("div", "zendia-agent-install-row");
        row.append(
          this.#installName(agent),
          this.#create("code", "", agent.install)
        );
        list.append(row);
      }
    });
    const again = this.#create(
      "button",
      "zendia-agent-button primary",
      "Look again"
    );
    again.addEventListener("click", async () => {
      await lazy.ZendiaAgents.agents({ refresh: true });
      this.open(this.#window.gBrowser.selectedBrowser);
    });
    rows.push(list, again);
    return rows;
  }

  // The row under the conversation: "Starting…" with no clock until the
  // agent really runs, then a word and a clock that start together and
  // never restart. Leaving, it only fades: its lane keeps its height.
  #syncWorking(conversation) {
    const running = !!conversation?.running;
    this.#working.toggleAttribute("shown", running);
    this.#foot.style.setProperty(
      "--zendia-agent-color",
      lazy.agentColor(conversation?.agent.id)
    );
    if (!running) {
      this.#workingRing.stop();
      this.#follow.release();
      return;
    }
    this.#workingRing.start();
    let turn = this.#turnStarts.get(conversation);
    if (conversation.run && turn?.sent != conversation.startedAt) {
      turn = { sent: conversation.startedAt, at: Date.now() };
      this.#turnStarts.set(conversation, turn);
    }
    if (turn?.sent != conversation.startedAt) {
      lazy.rollText(this.#workingWord, "Starting…");
      this.#workingClock.textContent = "";
      return;
    }
    const seconds = Math.floor((Date.now() - turn.at) / 1000);
    lazy.rollText(
      this.#workingWord,
      lazy.workingWord(lazy.seedOf(String(turn.sent)), seconds)
    );
    this.#workingClock.textContent = formatDuration(
      Math.max(1000, seconds * 1000)
    );
  }

  #updateStatus() {
    const conversation = this.#conversation;
    const running = !!conversation?.running;
    this.#syncWorking(conversation);
    if (running && !this.#timer) {
      this.#timer = this.#window.setInterval(() => {
        this.#updateStatus();
        this.#syncPill();
      }, 1000);
    } else if (!running && this.#timer) {
      this.#window.clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  // Under a closed dock, for the selected tab's conversation: the pill, or
  // the slid-out panel's handle at its side.
  #syncPill() {
    this.#onStatus?.();
    const conversation = lazy.ZendiaAgents.conversationFor(
      this.#window.gBrowser.selectedBrowser
    );
    const color = lazy.agentColor(conversation?.agent.id);
    const running = !!conversation?.running;
    const slide = this.#frame.layout == "slide";
    this.#handle.hidden =
      this.#open || !slide || !conversation?.messages.length;
    this.#handle.style.setProperty("--zendia-agent-color", color);
    this.#handle.toggleAttribute("running", running);
    this.#handle.toggleAttribute("unseen", !!conversation?.unseen);

    const show = !this.#open && !slide && (running || conversation?.unseen);
    if (!show) {
      lazy.hideFloat(this.#pill);
      return;
    }
    lazy.showFloat(this.#pill);
    this.#pill.style.setProperty("--zendia-agent-color", color);
    this.#pill.toggleAttribute("running", running);
    this.#pill.textContent = running
      ? `${conversation.agent.name} is working · ${formatElapsed(Date.now() - conversation.startedAt)}`
      : `${conversation.agent.name} finished · open`;
  }
}
