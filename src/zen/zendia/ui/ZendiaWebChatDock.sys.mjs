// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The web chat panel: ChatGPT, Claude, Gemini, Kimi and the other chat sites
// as they are, in a panel at the side of the tab that lays out like the
// agent's (ZendiaDockFrame: float, slide or split, either side, resizable).
// A strip under the header picks the site; each one is a browser of its own
// that is made when it is first picked and kept, so a reply that is still
// coming in, a draft and the scroll position are where they were left, also
// while the panel is closed.
//
// Accounts: a site can have several (ZendiaWebChatAccounts.sys.mjs), each in
// a container of its own, so the panel can be another person than the tabs
// are, or two at once, while every other site's cookies are copied from the
// browser (ZendiaWebChatCookies.sys.mjs): signing in with Google offers the
// browser's Google accounts. A menu on the picked site's name switches them,
// adds one, or uses the browser's own state of the site instead.
//
// Asking (ask()): what a page's menu or keys ask about (ZendiaWebChatAsk) is
// written into a site's box and sent, in a new chat for each page asked
// about. The reply is watched while it comes in: a site that finishes out of
// sight gets a dot on the strip and on the panel's button, and a reply to a
// field's text can be put back in the field in one press.

import {
  BROWSER,
  MAIN,
  accountsOf,
  addAccount,
  identityName,
  removeAccount,
  selectAccount,
} from "resource:///modules/zendia/webchat/ZendiaWebChatAccounts.sys.mjs";

const HTML_NS = "http://www.w3.org/1999/xhtml";

const PREF_BRANCH = "zendia.webchat.";
const PREF_DEFAULT = "zendia.webchat.default";
const PREF_ACCOUNTS = "zendia.webchat.accounts";
const PREF_CUSTOM = "zendia.webchat.custom";
// The strip's row, which the pages' permission prompts (the microphone for
// dictation, notifications) are anchored to.
const ANCHOR_ID = "zendia-webchat-anchor";
// How long the logo covers a page that has not finished loading.
const PAINT_AFTER_MS = 6000;
// Each page asked about gets a chat of its own, unless this is off.
const PREF_CHAT_PER_PAGE = "zendia.webchat.ask.newChatPerPage";
// How long a site may take to show its box.
const READY_TIMEOUT_MS = 30000;
const LOAD_TIMEOUT_MS = 20000;
const PROBE_MS = 300;
const SETTLE_MS = 2000;
const MAX_DROPPED_FILES = 10;
const MAX_DROPPED_BYTES = 50 * 1024 * 1024;
const WATCH_MS = 1000;
// A reply nobody saw start by then is not coming.
const NO_REPLY_MS = 90000;
const REPLY_TIMEOUT_MS = 15 * 60000;

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ZendiaDockFrame: "resource:///modules/zendia/ui/ZendiaDockFrame.sys.mjs",
  fetchImage: "resource:///modules/zendia/webchat/ZendiaWebChatAsk.sys.mjs",
  ZendiaPicker: "resource:///modules/zendia/ui/ZendiaPicker.sys.mjs",
  ZendiaTheme: "resource:///modules/zendia/ui/ZendiaTheme.sys.mjs",
  chatHosts: "resource:///modules/zendia/webchat/ZendiaWebChats.sys.mjs",
  clearWebChatContainer:
    "resource:///modules/zendia/webchat/ZendiaWebChatCookies.sys.mjs",
  useWebChatContainer:
    "resource:///modules/zendia/webchat/ZendiaWebChatCookies.sys.mjs",
  webChatContainerId:
    "resource:///modules/zendia/webchat/ZendiaWebChatCookies.sys.mjs",
  webChatMirror:
    "resource:///modules/zendia/webchat/ZendiaWebChatCookies.sys.mjs",
  webChatIcon: "resource:///modules/zendia/webchat/ZendiaWebChatIcons.sys.mjs",
  webChatIconIsMono:
    "resource:///modules/zendia/webchat/ZendiaWebChatIcons.sys.mjs",
  webChats: "resource:///modules/zendia/webchat/ZendiaWebChats.sys.mjs",
  withCustomSite: "resource:///modules/zendia/webchat/ZendiaWebChats.sys.mjs",
  withoutCustomSite:
    "resource:///modules/zendia/webchat/ZendiaWebChats.sys.mjs",
});

export class ZendiaWebChatDock {
  #window;
  #frame;
  #root;
  #reloadButton;
  #tabButton;
  #strip;
  #addRow;
  #addInput;
  #addHint;
  #stage;
  #waitLogo;
  #promptAnchor;
  #empty;
  #onChange;
  #onStatus;
  #onSwitch;
  #chats = [];
  #hosts = [];
  #customJson = null;
  #accountsJson = "";
  #current = "";
  // The browser of each site's account that has been used, by site and
  // account: {chat, key, container, browser, listener, loading, painted,
  // url}.
  #views = new Map();
  // A picker, the menu or the address row is up: the slid-in panel stays.
  #picking = false;
  #menu;
  #menuButton;
  #menuAnchor = null;
  #menuOff = null;
  // The page takes the keys once the account in use is showing, after the
  // user chose it.
  #focusNext = false;
  #putBackButton;
  #dropHint;
  #dropHintTimer = null;
  #newChatButton;
  // Where the reply to a field's text goes back: {browser, frame, chatId}.
  #putBack = null;

  /**
   * @param {Window} window A browser window.
   * @param {object} options
   * @param {() => void} options.onChange Called when the panel opens or
   *   closes.
   * @param {() => void} [options.onStatus] Called when `status` may have
   *   changed.
   * @param {() => void} [options.onSwitch] Called by the header's agent
   *   button, which swaps this panel for the agent's.
   */
  constructor(window, { onChange, onStatus, onSwitch }) {
    this.#window = window;
    this.#onChange = onChange;
    this.#onStatus = onStatus;
    this.#onSwitch = onSwitch;
    const document = window.document;
    const create = (tag, className, parent) => {
      const element = document.createElementNS(HTML_NS, tag);
      if (className) {
        element.className = className;
      }
      parent?.append(element);
      return element;
    };
    const iconButton = (className, parent, title) => {
      const button = create(
        "button",
        `zendia-agent-icon-button ${className}`,
        parent
      );
      button.title = title;
      button.setAttribute("aria-label", title);
      // A click leaves the keys where they were.
      button.addEventListener("mousedown", event => event.preventDefault());
      return button;
    };

    this.#frame = new lazy.ZendiaDockFrame(window, {
      id: "zendia-webchat",
      label: "Web chat",
      branch: PREF_BRANCH,
      defaultWidth: 480,
      // The page inside has the keys while it has the focus: leaving the
      // panel then would take a reply or a draft away.
      keepOpen: () =>
        this.#picking ||
        !!this.#menuAnchor ||
        this.#root.contains(this.#window.document.activeElement),
      onLayout: () => this.#syncHandle(),
      onPrefs: () => this.#onPrefs(),
      onCloseRequest: () => this.close(),
      onOpenRequest: options => this.open(options),
    });
    this.#root = this.#frame.root;

    const header = create("div", "zendia-agent-header", this.#root);
    this.#newChatButton = iconButton(
      "new-chat",
      header,
      "New chat on every site (<leader>aN)"
    );
    this.#newChatButton.addEventListener("click", () =>
      this.newChat({ all: true })
    );
    this.#reloadButton = iconButton("reload", header, "Reload");
    this.#reloadButton.addEventListener("click", () => this.reload());
    this.#tabButton = iconButton("open-tab", header, "Open in a tab");
    this.#tabButton.addEventListener("click", () => this.openInTab());
    this.#menuButton = iconButton("accounts", header, "Accounts");
    this.#menuButton.setAttribute("aria-haspopup", "menu");
    this.#menuButton.addEventListener("click", () => this.toggleAccounts());
    this.#putBackButton = iconButton(
      "put-back",
      header,
      "Put the reply back in the page (<leader>aR)"
    );
    this.#putBackButton.hidden = true;
    this.#putBackButton.addEventListener("click", () => this.putReply());
    iconButton("to-agent", header, "Your agent (<leader>ap)").addEventListener(
      "click",
      () => this.#onSwitch?.()
    );
    create("span", "zendia-agent-spacer", header);
    this.#frame.addLayoutControls(header);
    iconButton("close", header, "Close").addEventListener("click", () =>
      this.close()
    );

    // The row, and in it the track the sites sit on.
    const row = create("div", "zendia-webchat-strip", this.#root);
    // PopupNotifications anchors to a XUL element.
    this.#promptAnchor = document.createXULElement("box");
    this.#promptAnchor.id = ANCHOR_ID;
    row.append(this.#promptAnchor);
    this.#strip = create("div", "zendia-webchat-track", row);
    this.#strip.setAttribute("role", "tablist");
    this.#strip.setAttribute("aria-label", "Chat sites");
    this.#strip.addEventListener("keydown", event => this.#onStripKey(event));

    this.#addRow = create("div", "zendia-webchat-add", this.#root);
    this.#addRow.hidden = true;
    this.#addInput = create("input", "zendia-webchat-add-input", this.#addRow);
    this.#addInput.type = "text";
    this.#addInput.placeholder = "Address of a chat site, like chat.mistral.ai";
    this.#addInput.spellcheck = false;
    this.#addInput.setAttribute("aria-label", "Address of a chat site");
    this.#addInput.addEventListener("keydown", event => this.#onAddKey(event));
    this.#addInput.addEventListener("input", () => {
      this.#addInput.removeAttribute("invalid");
      this.#addHint.textContent = "Enter adds it · Esc cancels";
    });
    this.#addHint = create("div", "zendia-webchat-add-hint", this.#addRow);
    this.#addHint.textContent = "Enter adds it · Esc cancels";

    this.#stage = create("div", "zendia-webchat-stage", this.#root);
    const bar = create("div", "zendia-webchat-bar", this.#stage);
    bar.setAttribute("aria-hidden", "true");
    const wait = create("div", "zendia-webchat-wait", this.#stage);
    wait.setAttribute("aria-hidden", "true");
    this.#waitLogo = create("span", "zendia-webchat-logo", wait);
    this.#empty = create("div", "zendia-webchat-empty", this.#stage);
    this.#empty.textContent = "No chat sites. Add one with +.";
    this.#empty.hidden = true;
    // Files dropped on the page, and images dragged from a tab, are attached
    // as files: the site would only get an image's address.
    this.#dropHint = create("div", "zendia-webchat-drop", this.#stage);
    this.#dropHint.hidden = true;
    for (const type of ["dragover", "drop", "dragleave"]) {
      this.#stage.addEventListener(type, event => this.#onDrag(event), true);
    }

    this.#menu = create("div", "zendia-webchat-menu", this.#root);
    this.#menu.hidden = true;
    this.#menu.setAttribute("role", "menu");
    this.#menu.addEventListener("keydown", event => this.#onMenuKey(event));

    this.#loadChats();
    this.#renderStrip();
    this.#syncChrome();

    window.gBrowser.tabContainer.addEventListener("TabSelect", () =>
      this.#onTabSelect()
    );
    const offTheme = lazy.ZendiaTheme.onChange(() => this.#syncChrome());
    window.addEventListener("unload", offTheme, { once: true });
    // Last: the layout draws the handle, which reads all of the above.
    this.#frame.mount();
  }

  get isOpen() {
    return this.#frame.isOpen;
  }

  /** The side it sits at: "left" or "right". */
  get side() {
    return this.#frame.side;
  }

  /**
   * @param {Element} browser
   * @returns {boolean} Whether the browser is a page of the panel that is in
   *   front now.
   */
  isShowing(browser) {
    return (
      this.#frame.isOpen &&
      [...this.#views.values()].some(
        view =>
          view.browser == browser &&
          !view.browser.hidden &&
          !view.browser.hasAttribute("parked")
      )
    );
  }

  // Permission prompts: a window's PopupNotifications shows the ones of the
  // tab in front, and keeps those of any other browser until it is. A page of
  // the panel is no tab, so its prompt (the microphone a dictation button
  // asks for) would never show, and the page would wait for ever. While the
  // panel shows a page, that page's prompts are the ones in front too.
  #allowPrompts() {
    const popups = this.#window.PopupNotifications;
    if (!popups || popups._zendiaWebChatPrompts) {
      return;
    }
    popups._zendiaWebChatPrompts = true;
    const isActiveBrowser = popups._isActiveBrowser;
    popups._isActiveBrowser = browser =>
      this.isShowing(browser) || isActiveBrowser.call(popups, browser);
  }

  // What was asked before the page changed is not asked any more, nor when
  // the panel goes: the tab's prompts are the ones to show again.
  #refreshPrompts(browser) {
    const popups = this.#window.PopupNotifications;
    if (browser) {
      popups?.locationChange(browser);
    }
    popups?.anchorVisibilityChange();
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
   * What the rest of the window shows of the panel.
   *
   * @returns {{open: boolean, loading: boolean, color: string,
   *   name: string|undefined}}
   */
  get status() {
    const chat = this.#currentChat();
    const views = [...this.#views.values()];
    const unseen = views.find(view => view.unseen);
    return {
      open: this.#frame.isOpen,
      loading: !!this.#viewOf(chat?.id)?.loading,
      // A site is writing a reply, or has one nobody saw yet.
      replying: views.some(view => view.pending),
      unseen: !!unseen,
      color: this.#colorOf(unseen?.chat ?? chat),
      name: chat?.name,
    };
  }

  /**
   * @param {Node} node
   * @returns {boolean} Whether the node is part of the panel.
   */
  contains(node) {
    return this.#frame.contains(node);
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
   * Open the panel on a chat site.
   *
   * @param {object} [options]
   * @param {string} [options.id] The site; the one last used by default.
   * @param {boolean} [options.focus] Give the page the keys.
   */
  async open({ id, focus = true } = {}) {
    if (id && this.#chats.some(chat => chat.id == id)) {
      this.#current = id;
      Services.prefs.setStringPref(PREF_DEFAULT, id);
    }
    this.#allowPrompts();
    this.#frame.show();
    this.#syncChrome();
    this.#onChange();
    await this.#showCurrent({ focus });
  }

  close() {
    if (!this.#frame.isOpen) {
      return;
    }
    const focused = this.#root.contains(this.#window.document.activeElement);
    this.#frame.hide();
    this.#hideAdd();
    this.#closeMenu();
    this.#refreshPrompts();
    this.#syncChrome();
    this.#onChange();
    // Only hand the keys back when the panel had them, not when another
    // buffer opening closed it.
    if (focused) {
      this.#window.gBrowser.selectedBrowser.focus();
    }
  }

  toggle() {
    if (this.#frame.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Show a chat site, opening the panel if it is closed.
   *
   * @param {string} id
   */
  select(id) {
    return this.open({ id });
  }

  /**
   * Choose the chat site with the picker.
   */
  async pick() {
    this.#picking = true;
    let index;
    try {
      index = await lazy.ZendiaPicker.open(this.#window, {
        title: "Web chats",
        layout: "grid",
        items: this.#chats.map(chat => ({
          icon: lazy.webChatIcon(chat),
          iconFill: chat.custom,
          color: this.#colorOf(chat),
          label: chat.name,
          detail: chat.id == this.#current ? "current" : "",
        })),
      });
    } finally {
      this.#picking = false;
    }
    const chat = this.#chats[index];
    if (chat) {
      this.select(chat.id);
    } else if (this.#frame.isOpen) {
      this.#viewOf(this.#current)?.browser.focus();
    }
  }

  /**
   * Start over with a new chat: on the site in front, or on every site that
   * was opened and is not on its start page already. What was asked there, the reply on its way and the reply to
   * put back are left behind with the old chat.
   *
   * @param {object} [options]
   * @param {boolean} [options.all]
   */
  async newChat({ all = false } = {}) {
    const front = this.#viewOf(this.#current);
    // A site never opened has no page to start over, and one on its start
    // page with nothing on its way and nothing in its box is fresh already.
    const opened = (all ? [...this.#views.values()] : [front]).filter(
      view => view?.started
    );
    const stale = await Promise.all(
      opened.map(async view => {
        if (view.pending || !isSameAddress(view.url, view.chat.url)) {
          return true;
        }
        const probe = await this.#probe(view);
        return !!(probe?.draft || probe?.files);
      })
    );
    const views = opened.filter((view, index) => stale[index]);
    for (const view of views) {
      view.watch++;
      view.pending = false;
      view.unseen = false;
      view.topic = "";
      view.topicUrl = "";
      view.browser.loadURI(Services.io.newURI(view.chat.url), {
        triggeringPrincipal:
          Services.scriptSecurityManager.getSystemPrincipal(),
      });
    }
    if (
      this.#putBack &&
      views.some(view => view.chat.id == this.#putBack.chatId)
    ) {
      this.#putBack = null;
    }
    this.#syncReplies();
    if (!front || !this.#frame.isOpen) {
      await this.open();
    } else {
      front.browser.focus();
    }
  }

  reload() {
    const view = this.#viewOf(this.#current);
    if (view) {
      view.browser.reload();
    } else {
      this.#showCurrent({ focus: true });
    }
  }

  /**
   * Continue the chat in a tab of the container it runs in, so it is the
   * same account.
   */
  openInTab() {
    const view = this.#viewOf(this.#current);
    const chat = this.#currentChat();
    const url = view?.url ?? chat?.url;
    if (!url || url == "about:blank") {
      return;
    }
    this.#window.openTrustedLinkIn(url, "tab", {
      userContextId: view?.container ?? 0,
    });
  }

  /**
   * Copy the browser's logins into every account's container again, over what
   * the accounts changed.
   */
  async syncLogins() {
    await lazy.webChatMirror()?.resync();
    this.#window.gZenUIManager?.showToast("zendia-webchat-synced-toast");
    // The page in front has the old logins.
    this.#viewOf(this.#current)?.browser.reload();
  }

  // Dropping.

  // What a drag brings that the panel attaches itself: files from outside
  // the browser, or an image dragged from a tab. Text, and links that are not
  // images, the page takes as it would anyway.
  #dropped(transfer) {
    if (!transfer) {
      return null;
    }
    const source = transfer.sourceTopWindowContext?.browsingContext;
    if (source?.embedderElement && this.contains(source.embedderElement)) {
      return null;
    }
    if (transfer.types.includes("Files") && !source) {
      return { kind: "files" };
    }
    const url = transfer.types.includes("application/x-moz-file-promise-url")
      ? transfer.getData("application/x-moz-file-promise-url")
      : "";
    return url ? { kind: "image", url, source } : null;
  }

  #onDrag(event) {
    const view = this.#viewOf(this.#current);
    const dropped =
      view && event.target == view.browser && this.#dropped(event.dataTransfer);
    if (event.type == "dragleave") {
      this.#hideDropHint(150);
      return;
    }
    if (!dropped) {
      return;
    }
    // Ours from here: the page does not get it.
    event.preventDefault();
    event.stopPropagation();
    if (event.type == "dragover") {
      event.dataTransfer.dropEffect = "copy";
      this.#dropHint.textContent =
        dropped.kind == "image"
          ? `Drop to attach the image to ${view.chat.name}`
          : `Drop to attach to ${view.chat.name}`;
      this.#dropHint.hidden = false;
      this.#hideDropHint(400);
      return;
    }
    this.#hideDropHint(0);
    this.#attachDropped(view, dropped, event.dataTransfer).catch(e =>
      console.error("Zendia: could not attach what was dropped", e)
    );
  }

  #hideDropHint(ms) {
    this.#window.clearTimeout(this.#dropHintTimer);
    this.#dropHintTimer = this.#window.setTimeout(() => {
      this.#dropHint.hidden = true;
    }, ms);
  }

  async #attachDropped(view, dropped, transfer) {
    let files = [];
    if (dropped.kind == "files") {
      // Read now: the transfer is gone once the drop is over.
      const list = [...transfer.files].slice(0, MAX_DROPPED_FILES);
      files = await Promise.all(
        list
          .filter(file => file.size <= MAX_DROPPED_BYTES)
          .map(async file => ({
            name: file.name,
            type: file.type || "application/octet-stream",
            bytes: await file.arrayBuffer(),
          }))
      );
    } else {
      const principal =
        dropped.source?.currentWindowGlobal?.documentPrincipal ??
        this.#window.gBrowser.selectedBrowser.contentPrincipal;
      const image = await lazy.fetchImage(dropped.url, principal);
      if (image) {
        const name =
          decodeURIComponent(
            new URL(dropped.url).pathname.split("/").pop() || ""
          ).replace(/[^\w.-]+/g, "_") || "image";
        files = [{ name, type: image.type, bytes: image.bytes }];
      }
    }
    const refused = () =>
      this.#window.gZenUIManager?.showToast(
        dropped.kind == "image"
          ? "zendia-webchat-no-attach-toast"
          : "zendia-webchat-no-file-toast",
        { l10nArgs: { site: view.chat.name } }
      );
    if (!files.length) {
      refused();
      return;
    }
    const result = await this.ask({
      chatId: view.chat.id,
      files,
      send: false,
      keepChat: true,
    });
    if (result?.reason == "no-attach") {
      refused();
    }
  }

  // Asking.

  /** The chat sites on the strip, in its order. */
  get chats() {
    return [...this.#chats];
  }

  /** The site in front, or the one that will be when the panel opens. */
  get currentChat() {
    return this.#currentChat();
  }

  /**
   * Write into a chat site's box, and send it.
   *
   * @param {object} options
   * @param {string} [options.chatId] The site; the one in front by default.
   * @param {string} [options.text]
   * @param {Array<{name: string, type: string, bytes: ArrayBuffer}>}
   *   [options.files] Images to attach.
   * @param {boolean} [options.send] Send it; otherwise it is left in the box
   *   with the keys there, for the user to finish.
   * @param {string} [options.topic] What it is about, the page's address: a
   *   page asked about for the first time gets a new chat.
   * @param {boolean} [options.background] Leave the site where it is on the
   *   strip, for a question asked of every site at once.
   * @param {boolean} [options.keepChat] Stay in the chat that is open, as a
   *   file dropped on it does.
   * @returns {Promise<{ok: boolean, sent?: boolean, reason?: string}>}
   */
  async ask({
    chatId,
    text = "",
    files = [],
    send = true,
    topic = "",
    background = false,
    keepChat = false,
  } = {}) {
    const chat =
      this.#chats.find(candidate => candidate.id == chatId) ??
      this.#currentChat();
    if (!chat) {
      return { ok: false, reason: "no-chat" };
    }
    if (!background || !this.#frame.isOpen) {
      await this.open({ id: background ? undefined : chat.id, focus: false });
    }
    const view = await this.#startView(chat, { park: background });
    if (!view) {
      return { ok: false, reason: "no-view" };
    }
    if (!keepChat) {
      await this.#chatFor(view, topic);
    }
    const probe = await this.#waitReady(view);
    // A page that just loaded shows its box before it is ready to take a
    // file: several sites asked at once all are.
    const settle = SETTLE_MS - (Date.now() - view.loadedAt);
    if (probe && settle > 0) {
      await sleep(this.#window, settle);
    }
    if (!probe) {
      // Most often the site wants the user signed in first.
      if (!background) {
        view.browser.focus();
      }
      return { ok: false, reason: "not-ready" };
    }
    let result;
    try {
      result = await this.#actorOf(view).sendQuery("ZendiaWebChat:Compose", {
        site: chat.id,
        text,
        files,
        send,
        // A draft left in the box would go with the question.
        clear: send,
        focus: !send,
      });
    } catch (e) {
      console.error("Zendia: could not write to the chat", e);
      result = { ok: false, reason: "gone" };
    }
    if (result?.ok) {
      view.topic = topic;
      // Left for the user to finish, it is sent whenever they are done.
      this.#watchReply(view, probe.replies, { patient: !result.sent });
      if (!result.sent && !background) {
        view.browser.focus();
      }
    }
    return result ?? { ok: false };
  }

  /**
   * Remember where the reply to a field's text goes back.
   *
   * @param {object|null} target
   * @param {Element} target.browser The tab's browser.
   * @param {number} target.frame The id of the field's browsing context.
   * @param {string} target.chatId The site asked.
   */
  setPutBack(target) {
    // Shown once the reply to it is written.
    this.#putBack = target
      ? {
          ...target,
          browser: Cu.getWeakReference(target.browser),
          written: false,
        }
      : null;
    this.#syncChrome();
  }

  /**
   * @param {Element} browser A tab's browser.
   * @returns {boolean} Whether a reply can go back into a field of it.
   */
  canPutBackInto(browser) {
    return !!this.#putBack?.written && this.#putBack.browser.get() == browser;
  }

  /**
   * Put the last reply of the site asked about a field's text in its place.
   *
   * @returns {Promise<boolean>}
   */
  async putReply() {
    const target = this.#putBack;
    const browser = target?.browser.get();
    const view = target && this.#viewOf(target.chatId);
    if (!browser || !view) {
      return false;
    }
    let reply = "";
    try {
      ({ text: reply } = await this.#actorOf(view).sendQuery(
        "ZendiaWebChat:Reply",
        { site: target.chatId }
      ));
    } catch (e) {
      console.error("Zendia: could not read the reply", e);
    }
    reply = unquote(reply);
    if (!reply) {
      return false;
    }
    const tab = this.#window.gBrowser.getTabForBrowser(browser);
    if (tab) {
      this.#window.gBrowser.selectedTab = tab;
    }
    browser.focus();
    try {
      const frame = BrowsingContext.get(target.frame);
      const { ok } = await frame.currentWindowGlobal
        .getActor("ZendiaWebChat")
        .sendQuery("ZendiaWebChat:Replace", { text: reply });
      return ok;
    } catch (e) {
      console.error("Zendia: could not put the reply back", e);
      return false;
    }
  }

  #actorOf(view) {
    const global = view.browser.browsingContext?.currentWindowGlobal;
    if (!global) {
      throw new Error("The chat page is not loaded");
    }
    return global.getActor("ZendiaWebChat");
  }

  async #probe(view) {
    try {
      return await this.#actorOf(view).sendQuery("ZendiaWebChat:Probe", {
        site: view.chat.id,
      });
    } catch {
      return null;
    }
  }

  // The page of the site's account in use, loading if it was not. One that
  // is not in front loads out of sight, but laid out as if it were.
  async #startView(chat, { park }) {
    const key = this.#accountsOf(chat.id).active;
    let view = this.#views.get(this.#viewKey(chat.id, key));
    if (!view) {
      const container = await this.#containerFor(chat, key);
      view =
        this.#views.get(this.#viewKey(chat.id, key)) ??
        this.#createView(chat, key, container);
    }
    if (!view.started) {
      if (park && chat.id != this.#current) {
        view.browser.hidden = false;
        view.browser.setAttribute("parked", "true");
      }
      view.started = true;
      view.browser.loadURI(Services.io.newURI(chat.url), {
        triggeringPrincipal:
          Services.scriptSecurityManager.getSystemPrincipal(),
      });
    }
    return view;
  }

  // A page asked about for the first time gets a new chat; the same page
  // asked about again keeps the one it was asked in.
  async #chatFor(view, topic) {
    if (!Services.prefs.getBoolPref(PREF_CHAT_PER_PAGE, true)) {
      return;
    }
    if (topic && topic == view.topic && view.url == view.topicUrl) {
      return;
    }
    if (isSameAddress(view.url, view.chat.url) || view.url == "about:blank") {
      return;
    }
    const loads = view.loads;
    view.browser.loadURI(Services.io.newURI(view.chat.url), {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    const started = Date.now();
    while (view.loads == loads && Date.now() - started < LOAD_TIMEOUT_MS) {
      await sleep(this.#window, PROBE_MS);
    }
  }

  async #waitReady(view) {
    const started = Date.now();
    while (Date.now() - started < READY_TIMEOUT_MS) {
      const probe = await this.#probe(view);
      if (probe?.ready) {
        return probe;
      }
      await sleep(this.#window, PROBE_MS);
    }
    return null;
  }

  // Watch the reply come in. One the user cannot see when it is done gets
  // a dot.
  async #watchReply(view, before, { patient = false } = {}) {
    const watch = ++view.watch;
    view.pending = !patient;
    view.unseen = false;
    this.#syncReplies();
    const started = Date.now();
    let begun = false;
    let last = null;
    let still = 0;
    while (view.watch == watch && this.#views.has(this.#keyOf(view))) {
      await sleep(this.#window, WATCH_MS);
      const elapsed = Date.now() - started;
      if (
        elapsed > REPLY_TIMEOUT_MS ||
        (!begun && !patient && elapsed > NO_REPLY_MS)
      ) {
        break;
      }
      const probe = await this.#probe(view);
      if (!probe) {
        continue;
      }
      view.topicUrl = probe.url;
      if (!begun && (probe.generating || probe.replies > before)) {
        begun = true;
        view.pending = true;
        this.#syncReplies();
      }
      if (!begun || probe.generating) {
        still = 0;
        last = probe.reply;
        continue;
      }
      still = probe.reply == last ? still + 1 : 0;
      last = probe.reply;
      if (still >= 2) {
        if (!this.isShowing(view.browser)) {
          view.unseen = true;
        }
        break;
      }
    }
    if (view.watch == watch) {
      view.pending = false;
      if (begun && this.#putBack?.chatId == view.chat.id) {
        this.#putBack.written = true;
      }
      this.#syncReplies();
    }
  }

  #keyOf(view) {
    return this.#viewKey(view.chat.id, view.key);
  }

  #syncReplies() {
    this.#syncStrip();
    this.#syncChrome();
    this.#onStatus?.();
  }

  // The sites.

  #currentChat() {
    return this.#chats.find(chat => chat.id == this.#current) ?? null;
  }

  // The accounts of a site, and the one in use.
  #accountsOf(chatId) {
    return accountsOf(this.#accountsJson, chatId);
  }

  #viewKey(chatId, accountKey) {
    return `${chatId}\u0000${accountKey}`;
  }

  // The page of the site's account in use, once it has been made.
  #viewOf(chatId) {
    return chatId
      ? (this.#views.get(
          this.#viewKey(chatId, this.#accountsOf(chatId).active)
        ) ?? null)
      : null;
  }

  // The site's own color, unless the user picked another in zendia.theme.
  #colorOf(chat) {
    return lazy.ZendiaTheme.agentColor(chat?.id, chat?.color);
  }

  // The user's sites and the built-in ones, and the one in front.
  #loadChats() {
    this.#customJson = Services.prefs.getStringPref(PREF_CUSTOM, "");
    this.#chats = lazy.webChats(this.#customJson);
    this.#hosts = lazy.chatHosts(this.#chats);
    const wanted =
      this.#current || Services.prefs.getStringPref(PREF_DEFAULT, "");
    this.#current = this.#chats.some(chat => chat.id == wanted)
      ? wanted
      : (this.#chats[0]?.id ?? "");
    this.#accountsJson = Services.prefs.getStringPref(PREF_ACCOUNTS, "");
    // A site taken off the panel takes its browsers with it.
    for (const [key, view] of [...this.#views]) {
      const chat = this.#chats.find(candidate => candidate.id == view.chat.id);
      if (!chat || chat.url != view.chat.url) {
        this.#destroyView(key);
      } else {
        view.chat = chat;
      }
    }
  }

  // The accounts as the pref has them now: one taken off takes its browser.
  #loadAccounts() {
    this.#accountsJson = Services.prefs.getStringPref(PREF_ACCOUNTS, "");
    for (const [key, view] of [...this.#views]) {
      const { accounts } = this.#accountsOf(view.chat.id);
      if (
        view.key != BROWSER &&
        !accounts.some(account => account.id == view.key)
      ) {
        this.#destroyView(key);
      }
    }
  }

  #onPrefs() {
    const customChanged =
      Services.prefs.getStringPref(PREF_CUSTOM, "") != this.#customJson;
    const accountsChanged =
      Services.prefs.getStringPref(PREF_ACCOUNTS, "") != this.#accountsJson;
    if (customChanged) {
      this.#loadChats();
      lazy.webChatMirror()?.refresh();
    } else if (accountsChanged) {
      this.#loadAccounts();
    }
    if (customChanged || accountsChanged) {
      this.#renderStrip();
      this.#closeMenu();
    }
    this.#syncChrome();
    if (this.#frame.isOpen && (customChanged || accountsChanged)) {
      const focus = this.#focusNext;
      this.#focusNext = false;
      this.#showCurrent({ focus });
    }
  }

  // The container an account's pages run in, with the cookies in it: the
  // account's own, kept in step with the browser's, or the tab in front's
  // for the browser's own state of the site.
  async #containerFor(chat, key) {
    const tabContainer = this.#window.gBrowser.selectedTab.userContextId ?? 0;
    if (key == BROWSER) {
      return tabContainer;
    }
    try {
      const container = lazy.webChatContainerId(identityName(chat.id, key));
      await lazy.useWebChatContainer({
        container,
        source: tabContainer,
        hosts: () => this.#hosts,
      });
      return container;
    } catch (e) {
      // The pages run in the tabs' container rather than not at all.
      console.error("Zendia: the web chat container failed", e);
      return tabContainer;
    }
  }

  async #showCurrent({ focus }) {
    const chat = this.#currentChat();
    this.#empty.hidden = !!chat;
    if (!chat) {
      return;
    }
    const key = this.#accountsOf(chat.id).active;
    const container = await this.#containerFor(chat, key);
    if (
      !this.#frame.isOpen ||
      chat.id != this.#current ||
      key != this.#accountsOf(chat.id).active
    ) {
      return;
    }
    const view =
      this.#views.get(this.#viewKey(chat.id, key)) ??
      this.#createView(chat, key, container);
    for (const other of this.#views.values()) {
      other.browser.hidden =
        other != view && !other.browser.hasAttribute("parked");
    }
    view.browser.removeAttribute("parked");
    view.unseen = false;
    this.#onStatus?.();
    this.#refreshPrompts();
    this.#syncChrome();
    if (!view.started) {
      view.started = true;
      view.browser.loadURI(Services.io.newURI(chat.url), {
        triggeringPrincipal:
          Services.scriptSecurityManager.getSystemPrincipal(),
      });
    }
    if (focus) {
      view.browser.focus();
    }
  }

  #createView(chat, key, container) {
    const document = this.#window.document;
    const browser = document.createXULElement("browser");
    for (const [name, value] of Object.entries({
      type: "content",
      remote: "true",
      maychangeremoteness: "true",
      disableglobalhistory: "true",
      // The page is a page of the browser like any tab's: its menus, saved
      // logins, microphone and full screen work.
      messagemanagergroup: "browsers",
      contextmenu: "contentAreaContextMenu",
      tooltip: "aHTMLTooltip",
      autocompletepopup: "PopupAutoComplete",
      nodefaultsrc: "true",
    })) {
      browser.setAttribute(name, value);
    }
    if (container) {
      browser.setAttribute("usercontextid", container);
    }
    // Where its permission prompts open.
    browser.popupnotificationanchor = this.#promptAnchor;
    browser.className = "zendia-webchat-browser";
    browser.hidden = true;
    this.#stage.append(browser);

    const view = {
      chat,
      key,
      container,
      browser,
      listener: null,
      loading: false,
      painted: false,
      paintTimer: null,
      started: false,
      url: chat.url,
      // Finished loads, for a wait on a new chat.
      loads: 0,
      loadedAt: 0,
      // The page asked about last, and the chat it was asked in.
      topic: "",
      topicUrl: "",
      // A reply is being written, or was and nobody saw it.
      pending: false,
      unseen: false,
      watch: 0,
    };
    view.listener = {
      QueryInterface: ChromeUtils.generateQI([
        "nsIWebProgressListener",
        "nsISupportsWeakReference",
      ]),
      onStateChange: (webProgress, request, flags) => {
        if (
          !webProgress.isTopLevel ||
          !(flags & Ci.nsIWebProgressListener.STATE_IS_NETWORK)
        ) {
          return;
        }
        if (flags & Ci.nsIWebProgressListener.STATE_START) {
          view.loading = true;
          // A page that keeps loading shows through after a while.
          this.#window.clearTimeout(view.paintTimer);
          view.paintTimer = this.#window.setTimeout(() => {
            view.painted = true;
            this.#syncChrome();
          }, PAINT_AFTER_MS);
        } else if (flags & Ci.nsIWebProgressListener.STATE_STOP) {
          view.loading = false;
          view.painted = true;
          view.loads++;
          view.loadedAt = Date.now();
          this.#window.clearTimeout(view.paintTimer);
        } else {
          return;
        }
        this.#syncChrome();
        this.#onStatus?.();
      },
      onLocationChange: (webProgress, request, location, flags) => {
        if (webProgress.isTopLevel && location) {
          view.url = location.spec;
          if (
            !(flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT)
          ) {
            this.#refreshPrompts(browser);
          }
        }
      },
    };
    try {
      browser.addProgressListener(
        view.listener,
        Ci.nsIWebProgress.NOTIFY_STATE_NETWORK |
          Ci.nsIWebProgress.NOTIFY_LOCATION
      );
    } catch (e) {
      // Without it the page still works, but for the loading bar.
      console.error("Zendia: no progress for a web chat", e);
    }
    this.#views.set(this.#viewKey(chat.id, key), view);
    return view;
  }

  #destroyView(key) {
    const view = this.#views.get(key);
    if (!view) {
      return;
    }
    this.#views.delete(key);
    this.#window.clearTimeout(view.paintTimer);
    try {
      view.browser.removeProgressListener(view.listener);
    } catch {
      // The browser is already gone.
    }
    view.browser.remove();
  }

  // The window's tab in front is in another container: the browser's logins
  // to copy are that one's.
  #onTabSelect() {
    if (this.#frame.isOpen) {
      lazy
        .webChatMirror()
        ?.setSource(this.#window.gBrowser.selectedTab.userContextId ?? 0);
    }
  }

  // The chrome around the page.

  #logo(chat, parent) {
    const logo = this.#window.document.createElementNS(HTML_NS, "span");
    logo.className = "zendia-webchat-logo";
    this.#paintLogo(logo, chat);
    parent?.append(logo);
    return logo;
  }

  #paintLogo(logo, chat) {
    const mono = !!chat && lazy.webChatIconIsMono(chat.id);
    logo.toggleAttribute("mono", mono);
    if (chat) {
      logo.style.setProperty(
        "--zendia-webchat-logo",
        `url("${lazy.webChatIcon(chat, { mask: mono })}")`
      );
    } else {
      logo.style.removeProperty("--zendia-webchat-logo");
    }
  }

  #renderStrip() {
    const document = this.#window.document;
    this.#strip.replaceChildren();
    for (const chat of this.#chats) {
      const item = document.createElementNS(HTML_NS, "div");
      item.className = "zendia-webchat-item";
      const tab = document.createElementNS(HTML_NS, "button");
      tab.className = "zendia-webchat-tab";
      tab.dataset.chat = chat.id;
      tab.setAttribute("role", "tab");
      tab.title = chat.name;
      tab.setAttribute("aria-label", chat.name);
      tab.style.setProperty("--zendia-webchat-color", this.#colorOf(chat));
      tab.addEventListener("mousedown", event => event.preventDefault());
      tab.addEventListener("click", () => {
        // The picked site's own name opens its accounts, when it has a choice.
        if (
          this.#frame.isOpen &&
          chat.id == this.#current &&
          this.#accountsOf(chat.id).multiple
        ) {
          this.toggleAccounts(tab);
        } else {
          this.select(chat.id);
        }
      });
      this.#logo(chat, tab);
      // The picked site's name opens out beside its logo, with the account
      // in use and a chevron when there is a choice of accounts.
      const label = document.createElementNS(HTML_NS, "span");
      label.className = "zendia-webchat-label";
      const text = document.createElementNS(HTML_NS, "span");
      for (const [className, content] of [
        ["zendia-webchat-name", chat.name],
        ["zendia-webchat-account", ""],
        ["zendia-webchat-chevron", ""],
      ]) {
        const part = document.createElementNS(HTML_NS, "span");
        part.className = className;
        part.textContent = content;
        text.append(part);
      }
      label.append(text);
      tab.append(label);
      item.append(tab);
      if (chat.custom) {
        const remove = document.createElementNS(HTML_NS, "button");
        remove.className = "zendia-webchat-remove";
        remove.title = `Remove ${chat.name}`;
        remove.setAttribute("aria-label", remove.title);
        remove.addEventListener("mousedown", event => event.preventDefault());
        remove.addEventListener("click", () => this.#removeSite(chat.id));
        item.append(remove);
      }
      this.#strip.append(item);
    }
    const add = document.createElementNS(HTML_NS, "button");
    add.className = "zendia-webchat-tab zendia-webchat-add-button";
    add.title = "Add a chat site";
    add.setAttribute("aria-label", add.title);
    add.addEventListener("mousedown", event => event.preventDefault());
    add.addEventListener("click", () => this.#toggleAdd());
    this.#strip.append(add);
    this.#syncStrip();
  }

  #syncStrip() {
    for (const tab of this.#strip.querySelectorAll("[data-chat]")) {
      const active = tab.dataset.chat == this.#current;
      tab.setAttribute("aria-selected", String(active));
      const views = [...this.#views.values()].filter(
        view => view.chat.id == tab.dataset.chat
      );
      tab.toggleAttribute(
        "replying",
        views.some(view => view.pending)
      );
      tab.toggleAttribute(
        "unseen",
        views.some(view => view.unseen)
      );
      tab.tabIndex = active ? 0 : -1;
      const state = this.#accountsOf(tab.dataset.chat);
      const menuable = active && state.multiple;
      tab.toggleAttribute("data-multiple", menuable);
      tab.querySelector(".zendia-webchat-account").textContent = menuable
        ? state.label
        : "";
      if (menuable) {
        tab.setAttribute("aria-haspopup", "menu");
        tab.setAttribute("aria-expanded", String(!!this.#menuAnchor));
      } else {
        tab.removeAttribute("aria-haspopup");
        tab.removeAttribute("aria-expanded");
      }
    }
  }

  #syncChrome() {
    const chat = this.#currentChat();
    const view = this.#viewOf(chat?.id);
    this.#syncStrip();
    this.#paintLogo(this.#waitLogo, chat);
    const color = this.#colorOf(chat);
    this.#root.style.setProperty("--zendia-webchat-color", color);
    this.#stage.toggleAttribute("loading", !!view?.loading);
    this.#stage.toggleAttribute("waiting", !!chat && !view?.painted);
    this.#reloadButton.disabled = !chat;
    this.#newChatButton.disabled = !chat;
    this.#tabButton.disabled = !chat;
    const putBack = this.#putBack;
    this.#putBackButton.hidden =
      !putBack?.written ||
      !putBack.browser.get() ||
      !this.#viewOf(putBack.chatId);
    this.#syncHandle();
  }

  // The slid-out panel's edge, once a chat was opened in this window.
  #syncHandle() {
    const handle = this.#frame.handle;
    handle.hidden =
      this.#frame.isOpen || this.#frame.layout != "slide" || !this.#views.size;
    handle.style.setProperty(
      "--zendia-agent-color",
      this.#colorOf(this.#currentChat())
    );
    handle.toggleAttribute(
      "running",
      [...this.#views.values()].some(v => v.loading || v.pending)
    );
  }

  #onStripKey(event) {
    if (event.key != "ArrowRight" && event.key != "ArrowLeft") {
      return;
    }
    const index = this.#chats.findIndex(chat => chat.id == this.#current);
    const next =
      this.#chats[
        (index + (event.key == "ArrowRight" ? 1 : -1) + this.#chats.length) %
          this.#chats.length
      ];
    if (next) {
      event.preventDefault();
      this.select(next.id).then(() =>
        this.#strip.querySelector(`[data-chat="${next.id}"]`)?.focus()
      );
    }
  }

  // The accounts of the site in front.

  /**
   * Open the menu of the picked site's accounts, or close it.
   *
   * @param {Element} [anchor] What the menu hangs under: the site's name on
   *   the strip by default.
   */
  toggleAccounts(anchor) {
    if (this.#menuAnchor) {
      this.#closeMenu();
    } else {
      this.#openMenu(anchor);
    }
  }

  #openMenu(anchor) {
    const chat = this.#currentChat();
    if (!chat || !this.#frame.isOpen) {
      return;
    }
    this.#buildMenu(chat);
    this.#menuAnchor =
      anchor ??
      this.#strip.querySelector(`[data-chat="${chat.id}"]`) ??
      this.#menuButton;
    this.#menu.hidden = false;
    this.#positionMenu();
    this.#menuButton.setAttribute("aria-expanded", "true");
    this.#syncStrip();
    // A press anywhere else puts it away.
    const document = this.#window.document;
    const away = event => {
      if (
        !this.#menu.contains(event.target) &&
        !this.#menuAnchor?.contains(event.target) &&
        !this.#menuButton.contains(event.target)
      ) {
        this.#closeMenu();
      }
    };
    document.addEventListener("mousedown", away, true);
    this.#menuOff = () => document.removeEventListener("mousedown", away, true);
    (
      this.#menu.querySelector('[aria-checked="true"]') ??
      this.#menu.querySelector(".zendia-webchat-menu-main")
    )?.focus();
  }

  #closeMenu({ refocus = false } = {}) {
    if (!this.#menuAnchor) {
      return;
    }
    this.#menuAnchor = null;
    this.#menu.hidden = true;
    this.#menuOff?.();
    this.#menuOff = null;
    this.#menuButton.setAttribute("aria-expanded", "false");
    this.#syncStrip();
    if (refocus) {
      this.#viewOf(this.#current)?.browser.focus();
    }
  }

  // Under the anchor, inside the panel.
  #positionMenu() {
    const root = this.#root.getBoundingClientRect();
    const anchor = this.#menuAnchor.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, anchor.left - root.left),
      Math.max(8, root.width - this.#menu.offsetWidth - 8)
    );
    this.#menu.style.top = `${anchor.bottom - root.top + 6}px`;
    this.#menu.style.left = `${left}px`;
  }

  #buildMenu(chat) {
    const document = this.#window.document;
    const state = this.#accountsOf(chat.id);
    const make = (tag, className, parent) => {
      const element = document.createElementNS(HTML_NS, tag);
      element.className = className;
      parent?.append(element);
      return element;
    };
    const row = (label, { role, checked, icon, onPick, remove }) => {
      const wrap = make("div", "zendia-webchat-menu-row", this.#menu);
      const main = make("button", "zendia-webchat-menu-main", wrap);
      main.setAttribute("role", role);
      main.tabIndex = -1;
      if (checked !== undefined) {
        main.setAttribute("aria-checked", String(checked));
      }
      make("span", `zendia-webchat-menu-icon ${icon ?? ""}`, main);
      make("span", "zendia-webchat-menu-label", main).textContent = label;
      main.addEventListener("click", onPick);
      if (remove) {
        main.dataset.removable = "true";
        const button = make("button", "zendia-webchat-menu-remove", wrap);
        button.tabIndex = -1;
        button.title = `Remove ${label}`;
        button.setAttribute("aria-label", button.title);
        button.addEventListener("click", remove);
      }
      return main;
    };
    this.#menu.replaceChildren();
    this.#menu.setAttribute("aria-label", `${chat.name} accounts`);
    for (const account of state.accounts) {
      const main = row(account.name, {
        role: "menuitemradio",
        checked: state.active == account.id,
        icon: "check",
        onPick: () => this.#useAccount(account.id),
        remove: account.id != MAIN ? () => this.#dropAccount(account.id) : null,
      });
      main.dataset.account = account.id;
    }
    make("div", "zendia-webchat-menu-separator", this.#menu).setAttribute(
      "role",
      "separator"
    );
    row("Add new account", {
      role: "menuitem",
      icon: "plus",
      onPick: () => this.#newAccount(),
    });
    row("Same as regular browsing", {
      role: "menuitemradio",
      checked: state.active == BROWSER,
      icon: "check",
      onPick: () => this.#useAccount(BROWSER),
    });
    // The accounts' logins are copies of the browser's: when one went wrong
    // (a site says something went wrong), this makes them again.
    if (state.active != BROWSER) {
      make("div", "zendia-webchat-menu-separator", this.#menu).setAttribute(
        "role",
        "separator"
      );
      row("Refresh logins from browser", {
        role: "menuitem",
        icon: "refresh",
        onPick: () => {
          this.#closeMenu();
          this.syncLogins();
        },
      });
    }
  }

  #onMenuKey(event) {
    const items = [...this.#menu.querySelectorAll(".zendia-webchat-menu-main")];
    const index = items.indexOf(this.#window.document.activeElement);
    let target = null;
    switch (event.key) {
      case "ArrowDown":
        target = items[(index + 1) % items.length];
        break;
      case "ArrowUp":
        target = items[(index - 1 + items.length) % items.length];
        break;
      case "Home":
        target = items[0];
        break;
      case "End":
        target = items.at(-1);
        break;
      case "Escape":
        this.#closeMenu({ refocus: true });
        break;
      case "Tab":
        this.#closeMenu();
        return;
      case "Delete":
      case "Backspace": {
        const account = items[index]?.dataset;
        if (account?.removable) {
          this.#dropAccount(account.account);
        }
        break;
      }
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    target?.focus();
  }

  // Use an account of the site, or the browser's own state of it.
  #useAccount(key) {
    const chat = this.#currentChat();
    if (!chat) {
      return;
    }
    const changed = selectAccount(this.#accountsJson, chat.id, key);
    this.#closeMenu();
    if (changed == this.#accountsJson) {
      this.#viewOf(chat.id)?.browser.focus();
      return;
    }
    // The pref's observer shows it, then the page takes the keys.
    this.#focusNext = true;
    Services.prefs.setStringPref(PREF_ACCOUNTS, changed);
  }

  #newAccount() {
    const chat = this.#currentChat();
    const added = chat && addAccount(this.#accountsJson, chat.id);
    this.#closeMenu();
    if (added) {
      this.#focusNext = true;
      Services.prefs.setStringPref(PREF_ACCOUNTS, added.json);
    }
  }

  // Take an account off the site, with what it kept.
  #dropAccount(id) {
    const chat = this.#currentChat();
    if (!chat) {
      return;
    }
    this.#closeMenu();
    this.#focusNext = true;
    Services.prefs.setStringPref(
      PREF_ACCOUNTS,
      removeAccount(this.#accountsJson, chat.id, id)
    );
    lazy.clearWebChatContainer(identityName(chat.id, id)).catch(console.error);
  }

  // Adding a site.

  #toggleAdd() {
    if (this.#addRow.hidden) {
      this.#addRow.hidden = false;
      this.#picking = true;
      this.#addInput.focus();
    } else {
      this.#hideAdd();
    }
  }

  #hideAdd() {
    if (this.#addRow.hidden) {
      return;
    }
    this.#addRow.hidden = true;
    this.#picking = false;
    this.#addInput.value = "";
    this.#addInput.removeAttribute("invalid");
  }

  #onAddKey(event) {
    if (event.key == "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.#hideAdd();
      this.#viewOf(this.#current)?.browser.focus();
    } else if (event.key == "Enter") {
      event.preventDefault();
      const added = lazy.withCustomSite(
        Services.prefs.getStringPref(PREF_CUSTOM, ""),
        this.#addInput.value.trim()
      );
      if (!added) {
        this.#addInput.setAttribute("invalid", "");
        this.#addHint.textContent =
          "Needs an https address, like chat.mistral.ai";
        return;
      }
      this.#hideAdd();
      // The pref's observer draws the strip, then the site opens.
      Services.prefs.setStringPref(PREF_CUSTOM, added.json);
      this.select(added.chat.id);
    }
  }

  #removeSite(id) {
    Services.prefs.setStringPref(
      PREF_CUSTOM,
      lazy.withoutCustomSite(Services.prefs.getStringPref(PREF_CUSTOM, ""), id)
    );
    if (Services.prefs.getStringPref(PREF_DEFAULT, "") == id) {
      Services.prefs.clearUserPref(PREF_DEFAULT);
    }
  }
}

function sleep(window, ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

// The same page of a site, whatever its query or a trailing slash.
function isSameAddress(a, b) {
  try {
    const one = new URL(a);
    const two = new URL(b);
    const path = url => url.pathname.replace(/\/+$/, "");
    return one.host == two.host && path(one) == path(two);
  } catch {
    return false;
  }
}

// A reply that kept the quotes the question set the text apart with.
function unquote(text) {
  const value = String(text ?? "").trim();
  const match = /^"{3}\n?([\s\S]*?)\n?"{3}$/.exec(value);
  return (match ? match[1] : value).trim();
}
