// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";
import { ZendiaActions } from "resource:///modules/zendia/core/ZendiaActions.sys.mjs";
import { ZendiaDom } from "resource:///modules/zendia/core/ZendiaDom.sys.mjs";
import { ZendiaKeyEngine } from "resource:///modules/zendia/core/ZendiaKeyEngine.sys.mjs";
import { ZendiaKeymap } from "resource:///modules/zendia/core/ZendiaKeymap.sys.mjs";
import { ZendiaKeys } from "resource:///modules/zendia/core/ZendiaKeys.sys.mjs";
import { ZendiaPlugins } from "resource:///modules/zendia/core/ZendiaPlugins.sys.mjs";
import {
  ZENDIA_SHARED_KEY,
  serializeConfig,
} from "resource:///modules/zendia/core/ZendiaShared.sys.mjs";
import { ZendiaKeymapsSpec } from "resource:///modules/zendia/config/ZendiaKeymaps.sys.mjs";
import { ZendiaOptions } from "resource:///modules/zendia/config/ZendiaOptions.sys.mjs";
import { ZendiaAgentSpec } from "resource:///modules/zendia/plugins/ZendiaAgent.sys.mjs";
import { ZendiaCoreSpec } from "resource:///modules/zendia/plugins/ZendiaCore.sys.mjs";
import { ZendiaEditSpec } from "resource:///modules/zendia/plugins/ZendiaEdit.sys.mjs";
import { EDIT_COMMANDS } from "resource:///modules/zendia/plugins/ZendiaEditContent.sys.mjs";
import { ZendiaExplorerSpec } from "resource:///modules/zendia/plugins/ZendiaExplorerSpec.sys.mjs";
import { ZendiaToolbarSpec } from "resource:///modules/zendia/plugins/ZendiaToolbarSpec.sys.mjs";
import { ZendiaFindSpec } from "resource:///modules/zendia/plugins/ZendiaFind.sys.mjs";
import { ZendiaInputsSpec } from "resource:///modules/zendia/plugins/ZendiaInputs.sys.mjs";
import { ZendiaJumpSpec } from "resource:///modules/zendia/plugins/ZendiaJump.sys.mjs";
import { ZendiaLibrarySpec } from "resource:///modules/zendia/plugins/ZendiaLibrary.sys.mjs";
import { ZendiaNavigationSpec } from "resource:///modules/zendia/plugins/ZendiaNavigation.sys.mjs";
import { ZendiaScrollSpec } from "resource:///modules/zendia/plugins/ZendiaScroll.sys.mjs";
import { ZendiaSessionSpec } from "resource:///modules/zendia/plugins/ZendiaSession.sys.mjs";
import { ZendiaTabsSpec } from "resource:///modules/zendia/plugins/ZendiaTabs.sys.mjs";
import { ZendiaExtensionsSpec } from "resource:///modules/zendia/plugins/ZendiaExtensionsSpec.sys.mjs";
import { ZendiaUblockSpec } from "resource:///modules/zendia/plugins/ZendiaUblockSpec.sys.mjs";
import { ZendiaUiSpec } from "resource:///modules/zendia/plugins/ZendiaUi.sys.mjs";
import { ZendiaVisualSpec } from "resource:///modules/zendia/plugins/ZendiaVisual.sys.mjs";
import { ZendiaWebChatSpec } from "resource:///modules/zendia/plugins/ZendiaWebChat.sys.mjs";
import { ZendiaWhichKeySpec } from "resource:///modules/zendia/plugins/ZendiaWhichKeySpec.sys.mjs";
import { ZendiaWindowsSpec } from "resource:///modules/zendia/plugins/ZendiaWindows.sys.mjs";
import { ZendiaYankSpec } from "resource:///modules/zendia/plugins/ZendiaYank.sys.mjs";
import { ZendiaZenCommandsSpec } from "resource:///modules/zendia/plugins/ZendiaZenCommands.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ActorManagerParent: "resource://gre/modules/ActorManagerParent.sys.mjs",
  CustomizableUI:
    "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
  ZendiaAgentDock: "resource:///modules/zendia/ui/ZendiaAgentDock.sys.mjs",
  ZendiaAgentsPanel: "resource:///modules/zendia/ui/ZendiaAgentsPanel.sys.mjs",
  ZendiaAgents: "resource:///modules/zendia/agent/ZendiaAgents.sys.mjs",
  ZendiaExplorer: "resource:///modules/zendia/ui/ZendiaExplorer.sys.mjs",
  ZendiaLibraryView: "resource:///modules/zendia/ui/ZendiaLibraryView.sys.mjs",
  ZendiaMenuKeys: "resource:///modules/zendia/ui/ZendiaMenuKeys.sys.mjs",
  ZendiaTheme: "resource:///modules/zendia/ui/ZendiaTheme.sys.mjs",
  ZendiaChatButton: "resource:///modules/zendia/ui/ZendiaChatButton.sys.mjs",
  ZendiaAgentsBar: "resource:///modules/zendia/ui/ZendiaAgentsButton.sys.mjs",
  ZendiaAgentsButton:
    "resource:///modules/zendia/ui/ZendiaAgentsButton.sys.mjs",
  ZendiaChatBar: "resource:///modules/zendia/ui/ZendiaChatButton.sys.mjs",
  ZendiaWebChatDock: "resource:///modules/zendia/ui/ZendiaWebChatDock.sys.mjs",
  ZendiaWebChatButton:
    "resource:///modules/zendia/ui/ZendiaWebChatButton.sys.mjs",
  ZendiaWebChatBar: "resource:///modules/zendia/ui/ZendiaWebChatButton.sys.mjs",
  ZendiaWebChatMenu: "resource:///modules/zendia/ui/ZendiaWebChatMenu.sys.mjs",
  ZendiaVimModeSwitch:
    "resource:///modules/zendia/ui/ZendiaVimModeSwitch.sys.mjs",
  ZendiaToolbar: "resource:///modules/zendia/ui/ZendiaToolbar.sys.mjs",
  ZendiaStatusline: "resource:///modules/zendia/ui/ZendiaStatusline.sys.mjs",
  ZendiaWhichKey: "resource:///modules/zendia/ui/ZendiaWhichKey.sys.mjs",
});

const ZENDIA_STYLESHEET = "resource:///modules/zendia/ui/zendia.css";

/**
 * The built-in specs, in the order LazyVim imports its own.
 */
export const ZENDIA_SPECS = [
  ZendiaCoreSpec,
  ZendiaScrollSpec,
  ZendiaTabsSpec,
  ZendiaNavigationSpec,
  ZendiaInputsSpec,
  ZendiaEditSpec,
  ZendiaJumpSpec,
  ZendiaVisualSpec,
  ZendiaYankSpec,
  ZendiaFindSpec,
  ZendiaWindowsSpec,
  ZendiaExplorerSpec,
  ZendiaToolbarSpec,
  ZendiaLibrarySpec,
  ZendiaAgentSpec,
  ZendiaWebChatSpec,
  ZendiaExtensionsSpec,
  ZendiaUblockSpec,
  ZendiaUiSpec,
  ZendiaSessionSpec,
  ZendiaZenCommandsSpec,
  ZendiaWhichKeySpec,
  ZendiaKeymapsSpec,
];

function windowOf(browser) {
  return browser?.documentGlobal ?? null;
}

// LazyVim keeps the UI out of the way of the text. With vim mode on, the
// browser starts in Zen's compact mode hiding both the sidebar and the
// toolbar. These are defaults: what the user picks in Zen's menu still wins.
const VIM_MODE_DEFAULTS = {
  "zen.view.compact.enable-at-startup": true,
  "zen.view.compact.hide-tabbar": true,
  "zen.view.compact.hide-toolbar": true,
};

// The modes of the browser UI's own buffers, the sidebar's explorer, the
// top bar and the library, which run in the parent: their keys are typed in
// the browser UI, not in a page.
const CHROME_MODES = ["e", "t", "l"];
// The owner of the normal mode <leader> keys copied into those modes.
const INHERITED_OWNER = "chrome-leader";

const NORMAL_STATE = Object.freeze({
  mode: "n",
  tokens: [],
  count: null,
  group: null,
  field: false,
});

// Browser shortcuts marked reserved="true" never reach the page, so the
// content actor cannot take them; the parent does when the page's mode maps
// them. Ctrl+W, for one, would otherwise close the tab while typing.
// On macOS the reserved ones use Cmd, and Ctrl+W already reaches the page.
const RESERVED_TOKENS = new Set(
  ["w", "t", "n", "S-w", "S-n"].map(
    key => `<${AppConstants.platform == "macosx" ? "D" : "C"}-${key}>`
  )
);

/**
 * Read the user's zendia.json, the counterpart of LazyVim's lazyvim.json
 * and lua/config/keymaps.lua:
 *
 *   {
 *     "extras": ["ublock"],
 *     "plugins": [{ "name": "scroll", "opts": { "step": 80 } }],
 *     "keymaps": [["n", "<C-n>", "tabs.next"], ["n", "<S-l>", false]]
 *   }
 *
 * @param {*} data
 * @returns {{extras: string[], overrides: object[]}}
 */
export function parseUserConfig(data) {
  if (typeof data != "object" || data === null || Array.isArray(data)) {
    throw new Error("Zendia: zendia.json must hold an object");
  }
  const { extras = [], plugins = [], keymaps = [] } = data;
  if (!Array.isArray(extras) || extras.some(name => typeof name != "string")) {
    throw new Error('Zendia: "extras" must be a list of names');
  }
  if (!Array.isArray(plugins)) {
    throw new Error('Zendia: "plugins" must be a list of specs');
  }
  if (!Array.isArray(keymaps)) {
    throw new Error('Zendia: "keymaps" must be a list of keys');
  }
  const overrides = [...plugins];
  if (keymaps.length) {
    overrides.push({ name: "user", priority: 1000, keys: keymaps });
  }
  return { extras, overrides };
}

class ZendiaService {
  actions = new ZendiaActions();
  /** @type {ZendiaKeymap|null} */
  keymap = null;
  /** @type {ZendiaPlugins|null} */
  plugins = null;
  /** The report of the last plugin load, for the health page. */
  report = null;
  /** Why zendia.json could not be used, if it could not. */
  userConfigError = null;

  #initialized = false;
  #version = 0;
  #user = { extras: [], overrides: [] };
  #zenCommands = [];
  /** @type {WeakMap<Element, object>} */
  #states = new WeakMap();
  /**
   * The statusline, which-key popup, explorer, toolbar and menu keys of each
   * browser window, with the key engine of its explorer and toolbar modes,
   * keyed by document, which a browser element reaches as ownerDocument.
   *
   * @type {Map<Document, {statusline: object, whichKey: object, explorer: object, toolbar: object, library: object, menuKeys: object, engine: ZendiaKeyEngine|null}>}
   */
  #windows = new Map();

  get userConfigPath() {
    return PathUtils.join(PathUtils.profileDir, "zendia", "zendia.json");
  }

  init() {
    if (this.#initialized) {
      return;
    }
    this.#initialized = true;
    this.#applyVimModeDefaults();
    lazy.ZendiaAgents.zendia = this;
    this.keymap = new ZendiaKeymap({ leader: ZendiaOptions.leader });
    this.plugins = new ZendiaPlugins({
      actions: this.actions,
      keymap: this.keymap,
    });
    this.#registerActor();
    this.reload();
    for (const pref of [
      ZendiaOptions.PREF_ENABLED,
      ZendiaOptions.PREF_LEADER,
      ZendiaOptions.PREF_TIMEOUTLEN,
      ZendiaOptions.PREF_STATUSLINE,
      ZendiaOptions.PREF_STATUSLINE_SHOW,
    ]) {
      Services.prefs.addObserver(pref, this);
    }
    this.loadUserConfig();
  }

  observe(subject, topic, data) {
    if (topic != "nsPref:changed") {
      return;
    }
    switch (data) {
      case ZendiaOptions.PREF_LEADER:
        this.keymap.setLeader(ZendiaOptions.leader);
        this.reload();
        break;
      case ZendiaOptions.PREF_TIMEOUTLEN:
        for (const ui of this.#windows.values()) {
          ui.engine = null;
        }
        this.#publish();
        break;
      case ZendiaOptions.PREF_STATUSLINE_SHOW:
        for (const ui of this.#windows.values()) {
          ui.statusline.setShow(ZendiaOptions.statuslineShow);
        }
        break;
      case ZendiaOptions.PREF_ENABLED:
      case ZendiaOptions.PREF_STATUSLINE:
        if (data == ZendiaOptions.PREF_ENABLED) {
          this.#applyVimModeDefaults();
        }
        for (const [document, ui] of this.#windows) {
          ui.statusline.setVisible(this.#statuslineVisibleIn(document));
          lazy.ZendiaVimModeSwitch.sync(document);
          ui.chatBar?.sync();
          if (!ZendiaOptions.enabled) {
            ui.explorer.close();
            ui.toolbar.close();
            ui.library.release();
            ui.whichKey.hide();
          }
        }
        break;
    }
  }

  /**
   * Load every spec again and publish the result to content processes.
   */
  reload() {
    this.report = this.plugins.load({
      specs: [
        ...ZENDIA_SPECS,
        { name: "zen-commands", opts: { commands: this.#zenCommands } },
      ],
      extras: this.#user.extras,
      overrides: this.#user.overrides,
    });
    this.#inheritLeaderKeys();
    for (const ui of this.#windows.values()) {
      if (!this.#activeBuffer(ui)) {
        ui.engine = null;
      }
    }
    this.#publish();
  }

  // The explorer and the toolbar are buffers with keys of their own, and the
  // <leader> keys work in them as anywhere else, the way LazyVim's explorer
  // keeps them.
  #inheritLeaderKeys() {
    const keymap = this.keymap;
    keymap.removeOwner(INHERITED_OWNER);
    const [leader] = ZendiaKeys.parse("<leader>", {
      leader: keymap.leader,
    });
    for (const mode of CHROME_MODES) {
      for (const mapping of keymap.list("n")) {
        if (mapping.tokens[0] == leader && !keymap.get(mode, mapping.lhs)) {
          keymap.set(mode, mapping.lhs, mapping.rhs, {
            desc: mapping.desc,
            owner: INHERITED_OWNER,
          });
        }
      }
      for (const group of keymap.groups("n")) {
        if (group.tokens[0] == leader) {
          keymap.group(mode, group.lhs, group.name, { owner: INHERITED_OWNER });
        }
      }
    }
  }

  async loadUserConfig() {
    const path = this.userConfigPath;
    try {
      if (!(await IOUtils.exists(path))) {
        return;
      }
      this.#user = parseUserConfig(await IOUtils.readJSON(path));
      this.userConfigError = null;
    } catch (e) {
      this.userConfigError = e;
      console.error(`Zendia: could not use ${path}`, e);
      return;
    }
    this.reload();
  }

  /**
   * Run a parent action a page asked for through a key. A content process
   * can only trigger actions the keymap points at.
   *
   * @param {Element} browser
   * @param {string} id
   * @param {object} args
   */
  async runFromKey(browser, id, args) {
    const action = this.actions.get(id);
    if (action?.where != "parent" || !this.keymap.maps(id)) {
      console.error(`Zendia: a page asked for unmapped action "${id}"`);
      return;
    }
    const window = windowOf(browser);
    if (!window?.gBrowser || this.#inOnboarding(window.document)) {
      return;
    }
    const { gBrowser } = window;
    const selected = gBrowser.selectedBrowser;
    try {
      await this.run(id, args, { browser });
      if (gBrowser.selectedBrowser != selected) {
        this.#leaveFields(gBrowser.selectedBrowser);
      }
    } catch (e) {
      console.error(`Zendia: "${id}" failed`, e);
    }
  }

  // Every frame of the page, since the field may be in any of them.
  #leaveFields(browser) {
    const contexts =
      browser.browsingContext?.getAllBrowsingContextsInSubtree() ?? [];
    for (const context of contexts) {
      try {
        context.currentWindowGlobal
          ?.getActor("ZendiaKeys")
          .sendAsyncMessage("Zendia:LeaveField");
      } catch {
        // No keys run in this frame.
      }
    }
  }

  /**
   * Run any action, the way the command line and agents will.
   *
   * @param {string} id
   * @param {object} [args]
   * @param {object} [target]
   * @param {Window} [target.window] Defaults to the most recent browser
   *   window.
   * @param {Element} [target.browser] Defaults to that window's selected
   *   browser.
   * @returns {Promise<*>}
   */
  run(id, args = {}, { window, browser } = {}) {
    window ??=
      windowOf(browser) ?? Services.wm.getMostRecentWindow("navigator:browser");
    browser ??= window.gBrowser.selectedBrowser;
    const owner = this.actions.get(id)?.owner;
    return this.actions.run(
      id,
      {
        window,
        browser,
        gBrowser: window.gBrowser,
        opts: this.plugins.get(owner)?.opts ?? {},
        zendia: this,
        runContent: (action, contentArgs) =>
          browser.browsingContext.currentWindowGlobal
            .getActor("ZendiaKeys")
            .sendQuery("Zendia:RunContent", {
              id: action.id,
              args: contentArgs,
            }),
      },
      args
    );
  }

  /**
   * @param {Element} browser
   * @param {object} state What the page's key engine reported.
   * @param {string} state.mode
   * @param {string[]} state.tokens
   * @param {number|null} state.count
   * @param {string|null} state.group
   * @param {boolean} state.field Whether a page field has focus.
   */
  /**
   * A page scrolled: the mode indicator of its window ducks out of sight, if
   * the page is the one it shows the mode of.
   *
   * @param {Element} browser
   */
  pageScrolled(browser) {
    const window = windowOf(browser);
    const ui = this.#windows.get(browser.ownerDocument);
    if (window?.gBrowser && ui && this.#keyedBrowser(window, ui) == browser) {
      ui.statusline.scrolled();
    }
  }

  updateState(browser, { mode, tokens, count, group, field } = {}) {
    const text = (value, max) =>
      typeof value == "string" ? value.slice(0, max) : null;
    const state = {
      mode: text(mode, 16) ?? "n",
      tokens: Array.isArray(tokens)
        ? tokens.slice(0, 16).map(token => text(token, 16) ?? "")
        : [],
      count: Number.isSafeInteger(count) && count > 0 ? count : null,
      group: text(group, 32),
      field: field === true,
    };
    this.#states.set(browser, state);
    const window = windowOf(browser);
    const ui = this.#windows.get(browser.ownerDocument);
    if (
      window?.gBrowser &&
      ui &&
      this.#keyedBrowser(window, ui) == browser &&
      !this.#activeBuffer(ui)
    ) {
      this.#showState(ui, state);
    }
  }

  /**
   * Show every key of the current mode in which-key, for `<leader>?`: the
   * page's, or the explorer's or toolbar's while one is open.
   *
   * @param {Window} window
   * @param {Element} browser
   */
  showAllKeys(window, browser) {
    const ui = this.#windows.get(window.document);
    if (ui) {
      const mode = this.#activeBuffer(ui)?.mode ?? this.stateFor(browser).mode;
      ui.whichKey.showAll(this.keymap, mode);
    }
  }

  /**
   * @param {Window} window
   * @returns {object|null} The window's ZendiaExplorer.
   */
  explorerFor(window) {
    return this.#windows.get(window.document)?.explorer ?? null;
  }

  /**
   * @param {Window} window
   * @returns {object|null} The window's ZendiaToolbar.
   */
  toolbarFor(window) {
    return this.#windows.get(window.document)?.toolbar ?? null;
  }

  /**
   * @param {Window} window
   * @returns {object|null} The window's ZendiaLibraryView.
   */
  libraryFor(window) {
    return this.#windows.get(window.document)?.library ?? null;
  }

  /**
   * @param {Window} window
   * @returns {object|null} The window's ZendiaAgentDock.
   */
  agentDockFor(window) {
    return this.#windows.get(window.document)?.agent ?? null;
  }

  /**
   * @param {Window} window
   * @returns {object|null} The window's ZendiaAgentsPanel.
   */
  agentsPanelFor(window) {
    return this.#windows.get(window.document)?.agents ?? null;
  }

  /**
   * @param {Window} window
   * @returns {object|null} The window's ZendiaWebChatDock.
   */
  webChatDockFor(window) {
    return this.#windows.get(window.document)?.webchat ?? null;
  }

  // The browser UI buffer the keys go to, if one is open.
  #activeBuffer(ui) {
    return (
      [ui.explorer, ui.toolbar, ui.library].find(buffer => buffer?.isOpen) ??
      null
    );
  }

  // The page whose mode the statusline shows: the web chat's while it has
  // the focus, as its keys are its own, and the tab in front otherwise.
  #keyedBrowser(window, ui) {
    const focused = window.document.activeElement;
    if (focused?.localName == "browser" && ui.webchat?.isShowing(focused)) {
      return focused;
    }
    return window.gBrowser.selectedBrowser;
  }

  #stateOf(window, ui) {
    const buffer = this.#activeBuffer(ui);
    if (!buffer) {
      return this.stateFor(this.#keyedBrowser(window, ui));
    }
    return {
      // The library's search box is its insert mode.
      mode: buffer.inserting ? "i" : buffer.mode,
      ...this.#chromeEngine(window, ui).pending,
      field: false,
      visual: !!buffer.visual,
    };
  }

  #chromeEngine(window, ui) {
    if (!ui.engine) {
      ui.engine = new ZendiaKeyEngine({
        keymap: this.keymap,
        timeoutlen: ZendiaOptions.timeoutlen,
        waitForPrefix: !!this.plugins.get("which-key")?.loaded,
        onMatch: ({ mapping, count }) => {
          const action = this.actions.get(mapping.rhs);
          const args = count !== null && action?.params?.count ? { count } : {};
          this.run(mapping.rhs, args, { window }).catch(e =>
            console.error(`Zendia: "${mapping.rhs}" failed`, e)
          );
        },
        onStateChange: () => this.#showState(ui, this.#stateOf(window, ui)),
      });
      for (const mode of CHROME_MODES) {
        ui.engine.defineMode(mode, { counts: true, passUnmapped: true });
      }
    }
    const mode = this.#activeBuffer(ui)?.mode;
    if (mode && ui.engine.mode != mode) {
      ui.engine.setMode(mode);
    }
    return ui.engine;
  }

  // Keys typed while the explorer or the toolbar is open.
  #bufferKey(window, ui, buffer, event) {
    if (!event.isTrusted) {
      return;
    }
    const route = buffer.routeKey(event);
    if (route == "handled" || route == "other") {
      return;
    }
    if (this.#chromeEngine(window, ui).feed(ZendiaKeys.fromEvent(event))) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  #showState(ui, state) {
    if (!ui) {
      return;
    }
    ui.statusline.update(state);
    const whichKey = this.plugins.get("which-key");
    if (whichKey?.loaded && ZendiaOptions.enabled) {
      ui.whichKey.update(state, this.keymap, whichKey.opts.delay ?? 200);
    } else {
      ui.whichKey.hide();
    }
  }

  /**
   * Zen shows the compact sidebar on its empty tab, which it selects at
   * startup when nothing else is open. In vim mode the window boots with the
   * sidebar hidden instead, until the user's first key or click hands the
   * empty tab back to Zen's usual behavior.
   *
   * @param {Window} window
   */
  #bootWithSidebarHidden(window) {
    const compact = window.gZenCompactModeManager;
    const sidebar = compact?.sidebar;
    if (!ZendiaOptions.enabled || !sidebar) {
      return;
    }
    const hide = () => {
      if (compact.preference && sidebar.hasAttribute("zen-has-empty-tab")) {
        sidebar.removeAttribute("zen-has-empty-tab");
      }
    };
    const observer = new window.MutationObserver(hide);
    observer.observe(sidebar, {
      attributes: true,
      attributeFilter: ["zen-has-empty-tab"],
    });
    observer.observe(window.document.documentElement, {
      attributes: true,
      attributeFilter: ["zen-compact-mode"],
    });
    const stop = event => {
      if (!event.isTrusted) {
        return;
      }
      observer.disconnect();
      for (const type of ["keydown", "mousedown"]) {
        window.removeEventListener(type, stop, true);
      }
    };
    for (const type of ["keydown", "mousedown"]) {
      window.addEventListener(type, stop, true);
    }
    hide();
  }

  /**
   * @param {Element} browser
   * @returns {object}
   */
  stateFor(browser) {
    return this.#states.get(browser) ?? NORMAL_STATE;
  }

  #agentsWarmed = false;

  /**
   * @param {Window} window A browser window, after delayed startup.
   */
  onWindowReady(window) {
    this.init();
    const commands = [
      ...window.document.querySelectorAll("#zenCommandSet > command"),
    ]
      .map(command => command.id)
      .sort();
    if (commands.join() != this.#zenCommands.join()) {
      this.#zenCommands = commands;
      this.reload();
    }

    // Have the agents and the default one's models ready before the first
    // time the user opens the panel or a picker, in idle time.
    if (!this.#agentsWarmed) {
      this.#agentsWarmed = true;
      window.requestIdleCallback(() => lazy.ZendiaAgents.warm(), {
        timeout: 8000,
      });
    }

    lazy.ZendiaTheme.apply(window.document);
    window.windowUtils.loadSheetUsingURIString(
      ZENDIA_STYLESHEET,
      window.windowUtils.AUTHOR_SHEET
    );
    this.#bootWithSidebarHidden(window);
    const ui = {
      statusline: new lazy.ZendiaStatusline(window),
      whichKey: new lazy.ZendiaWhichKey(window),
      menuKeys: new lazy.ZendiaMenuKeys(window),
      explorer: null,
      toolbar: null,
      library: null,
      agent: null,
      agents: null,
      webchat: null,
      chatBar: null,
      agentsBar: null,
      webChatBar: null,
      engine: null,
    };
    const refresh = () => this.#showState(ui, this.#stateOf(window, ui));
    // One buffer of the browser UI is open at a time, and the agent dock
    // takes the keys from all of them.
    const onChange = buffer => {
      if (buffer.isOpen) {
        for (const other of [ui.explorer, ui.toolbar, ui.library]) {
          if (other != buffer) {
            other.close();
          }
        }
        // The agent's and the web chat's panels share the side of the tab:
        // one open closes the other. Beside the tab either stays for the
        // browser UI's other buffers, as a split view pane would.
        const docks = [ui.agent, ui.webchat];
        for (const dock of docks) {
          if (dock && dock != buffer) {
            if (docks.includes(buffer)) {
              dock.close();
            } else if (buffer != ui.agents) {
              dock.release();
            }
          }
        }
        // The agents panel stays beside the chat it opens, unless the two
        // would sit over each other at the same side of the page.
        const sharesSide = (a, b) =>
          a?.isOpen &&
          b?.isOpen &&
          a.side == b.side &&
          (a.layout != "split" || b.layout != "split");
        if (docks.includes(buffer)) {
          if (sharesSide(buffer, ui.agents)) {
            ui.agents.close();
          }
        } else if (buffer == ui.agents) {
          for (const dock of docks) {
            if (sharesSide(buffer, dock)) {
              dock.close();
            }
          }
        } else {
          ui.agents?.release();
        }
      }
      ui.engine?.reset();
      refresh();
    };
    ui.explorer = new lazy.ZendiaExplorer(window, {
      onChange: () => onChange(ui.explorer),
    });
    ui.toolbar = new lazy.ZendiaToolbar(window, {
      onChange: () => onChange(ui.toolbar),
    });
    ui.library = new lazy.ZendiaLibraryView(window, {
      onChange: () => onChange(ui.library),
    });
    ui.agent = new lazy.ZendiaAgentDock(window, {
      onChange: () => onChange(ui.agent),
      onStatus: () => ui.chatBar?.sync(),
      onSwitch: () =>
        this.run("webchat.toggle", {}, { window }).catch(console.error),
      onAgents: () =>
        this.run("agent.list", {}, { window }).catch(console.error),
    });
    ui.agents = new lazy.ZendiaAgentsPanel(window, {
      onChange: () => onChange(ui.agents),
      onStatus: () => ui.agentsBar?.sync(),
      openChat: browser => {
        const target = browser.documentGlobal;
        this.agentDockFor(target)?.open(browser);
      },
    });
    ui.webchat = new lazy.ZendiaWebChatDock(window, {
      onChange: () => {
        ui.webChatBar?.sync();
        onChange(ui.webchat);
      },
      onStatus: () => ui.webChatBar?.sync(),
      onSwitch: () =>
        this.run("agent.toggle", {}, { window }).catch(console.error),
    });
    this.#windows.set(window.document, ui);
    ui.statusline.setShow(ZendiaOptions.statuslineShow);
    // "Ask ChatGPT" in the page's and the tabs' menus, with vim mode off too.
    try {
      ui.webChatMenu = new lazy.ZendiaWebChatMenu(window, { dock: ui.webchat });
    } catch (e) {
      console.error("Zendia: the web chat menus failed", e);
    }
    ui.statusline.setVisible(this.#statuslineVisibleIn(window.document));
    // Once the toolbars are restored, which init() runs too early for. A
    // widget that fails must not take the keys down with it.
    try {
      const toggleChat = target =>
        this.run("agent.toggle", {}, { window: target }).catch(console.error);
      this.#dropSidebarButton();
      lazy.ZendiaVimModeSwitch.install(window);
      lazy.ZendiaChatButton.register({ onToggle: toggleChat });
      ui.chatBar = new lazy.ZendiaChatBar(window, {
        dock: ui.agent,
        onToggle: () => toggleChat(window),
      });
      // Beside Chat, so after it.
      const toggleAgents = target =>
        this.run("agent.list", {}, { window: target }).catch(console.error);
      lazy.ZendiaAgentsButton.register({ onToggle: toggleAgents });
      ui.agentsBar = new lazy.ZendiaAgentsBar(window, {
        panel: ui.agents,
        onToggle: () => toggleAgents(window),
      });
      const toggleWebChat = target =>
        this.run("webchat.toggle", {}, { window: target }).catch(console.error);
      lazy.ZendiaWebChatButton.register({ onToggle: toggleWebChat });
      ui.webChatBar = new lazy.ZendiaWebChatBar(window, { dock: ui.webchat });
    } catch (e) {
      console.error("Zendia: the toolbar widgets failed", e);
    }
    // The onboarding starts and ends after the window is ready.
    new window.MutationObserver(() => {
      ui.statusline.setVisible(this.#statuslineVisibleIn(window.document));
      ui.whichKey.hide();
    }).observe(window.document.documentElement, {
      attributes: true,
      attributeFilter: ["zen-welcome-stage"],
    });
    refresh();
    window.gBrowser.tabContainer.addEventListener("TabSelect", refresh);
    // The focus moving between the tab and the web chat's page changes whose
    // mode is shown.
    let keyed = null;
    window.addEventListener(
      "focusin",
      () => {
        const browser = this.#keyedBrowser(window, ui);
        if (browser != keyed) {
          keyed = browser;
          refresh();
        }
      },
      true
    );
    let unclaimed = null;
    window.addEventListener(
      "keydown",
      event => {
        if (this.#inOnboarding(window.document)) {
          return;
        }
        if (ui.whichKey.pinned) {
          ui.whichKey.hide();
        }
        // What is typed into the agent dock, or the agents panel, is theirs.
        if (
          ui.agent.contains(event.target) ||
          ui.agents.contains(event.target)
        ) {
          return;
        }
        // The browser's own fields, like the urlbar, are in insert mode while
        // they have the focus: its editing keys, Ctrl+W above all, are vim's
        // and not the browser's.
        if (this.#editChromeField(window, event)) {
          return;
        }
        if (ui.webchat.contains(event.target)) {
          // The web chat's page is a page like a tab's: the browser's own
          // shortcuts that its mode maps, <C-w> in a field, are its keys.
          this.#takeReservedKey(window, event);
          return;
        }
        // An open menu or panel takes the keys, with vim's j and k.
        if (ZendiaOptions.enabled && ui.menuKeys.active) {
          if (event.isTrusted) {
            ui.menuKeys.handleKey(event);
          }
          return;
        }
        const buffer = this.#activeBuffer(ui);
        if (buffer) {
          this.#bufferKey(window, ui, buffer, event);
        } else {
          this.#takeReservedKey(window, event);
          unclaimed = event;
        }
      },
      true
    );
    // After whatever has the focus, so this only sees keys the browser UI had
    // no use for. Who owns a key is settled above: a key that closes a buffer
    // or opens a menu must not look like nobody's once it gets here.
    window.addEventListener("keydown", event => {
      if (event == unclaimed) {
        this.#sendKeyToPage(window, event);
      }
      unclaimed = null;
    });
    window.addEventListener(
      "unload",
      () => {
        this.#windows.delete(window.document);
      },
      { once: true }
    );
  }

  // Nothing of the page has focus after a picker or a dialog closes, or with
  // a tab of the sidebar focused, and the page's actor never hears its keys.
  // The page gets the focus back along with the key, so the keys that follow
  // go to it directly.
  #sendKeyToPage(window, event) {
    const { document, gBrowser } = window;
    const target = event.target;
    if (
      !event.isTrusted ||
      event.defaultPrevented ||
      !ZendiaOptions.enabled ||
      (target.ownerDocument ?? target) != document ||
      ["browser", "iframe"].includes(target.localName) ||
      document.documentElement.hasAttribute("customizing") ||
      window.gDialogBox?.isOpen
    ) {
      return;
    }
    const active = ZendiaDom.deepActiveElement(document);
    const token = ZendiaKeys.fromEvent(event);
    // <Space> presses the control the keyboard moved to.
    if (
      !token ||
      ZendiaDom.isEditable(active) ||
      (token == "<Space>" && active?.matches(":focus-visible"))
    ) {
      return;
    }
    const browser = gBrowser.selectedBrowser;
    const { mode, tokens, count } = this.stateFor(browser);
    if (
      mode == "i" ||
      (!tokens.length &&
        !ZendiaKeys.isCountDigit(token, count !== null) &&
        !this.keymap.trie(mode).node([token]))
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    browser.focus();
    try {
      browser.browsingContext.currentWindowGlobal
        .getActor("ZendiaKeys")
        .sendAsyncMessage("Zendia:Key", { token });
    } catch {
      // A tab with nothing loaded yet has no keys to hear this one.
    }
  }

  /**
   * Run an editing key of insert mode in a field of the browser UI, as
   * ZendiaEditContent does in a page's.
   *
   * @param {Window} window
   * @param {KeyboardEvent} event
   * @returns {boolean} Whether the key was taken.
   */
  #editChromeField(window, event) {
    const { document } = window;
    if (!event.isTrusted || !ZendiaOptions.enabled) {
      return false;
    }
    const field = ZendiaDom.deepActiveElement(document);
    if (field?.ownerDocument != document || !ZendiaDom.isEditable(field)) {
      return false;
    }
    const token = ZendiaKeys.fromEvent(event);
    const command = token && EDIT_COMMANDS[this.keymap.get("i", token)?.rhs];
    if (!command) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    const controller =
      document.commandDispatcher.getControllerForCommand(command);
    if (controller?.isCommandEnabled(command)) {
      controller.doCommand(command);
    }
    return true;
  }

  #takeReservedKey(window, event) {
    const browser = event.target;
    if (
      !event.isTrusted ||
      !ZendiaOptions.enabled ||
      browser?.localName != "browser" ||
      !(
        window.gBrowser.getTabForBrowser(browser) ||
        this.webChatDockFor(window)?.isShowing(browser)
      )
    ) {
      return;
    }
    const token = ZendiaKeys.fromEvent(event);
    if (!RESERVED_TOKENS.has(token)) {
      return;
    }
    const state = this.stateFor(browser);
    if (state.tokens.length || (state.mode == "i" && !state.field)) {
      return;
    }
    const mapping = this.keymap.get(state.mode, token);
    if (typeof mapping?.rhs != "string") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.run(mapping.rhs, {}, { browser }).catch(e =>
      console.error(`Zendia: "${mapping.rhs}" failed`, e)
    );
  }

  // The onboarding looks like plain Zen: vim mode is offered there, not
  // assumed, so its mode indicator, the window's mode color and its keys in
  // the browser UI wait until the onboarding is over.
  // Firefox's "Show sidebars" button, which Firefox puts in the toolbar on
  // its own. With sidebar.revamp locked off it only opens Firefox's old
  // sidebar (Bookmarks, History) beside Zen's: taken out once per profile,
  // and left alone if the user puts it back.
  #dropSidebarButton() {
    const done = "zendia.ui.sidebar-button-removed";
    if (Services.prefs.getBoolPref(done, false)) {
      return;
    }
    Services.prefs.setBoolPref(done, true);
    if (lazy.CustomizableUI.getPlacementOfWidget("sidebar-button")) {
      lazy.CustomizableUI.removeWidgetFromArea("sidebar-button");
    }
  }

  #inOnboarding(document) {
    return document.documentElement.hasAttribute("zen-welcome-stage");
  }

  #statuslineVisibleIn(document) {
    return (
      ZendiaOptions.enabled &&
      ZendiaOptions.statusline &&
      !this.#inOnboarding(document)
    );
  }

  // Zen's own defaults, kept when vim mode's replace them.
  #zenDefaults = null;

  /**
   * Put vim mode's defaults for Zen's layout in place while it is on, and
   * Zen's own back when it is turned off. What the user set still wins.
   */
  #applyVimModeDefaults() {
    const defaults = Services.prefs.getDefaultBranch("");
    if (!this.#zenDefaults) {
      this.#zenDefaults = {};
      for (const name of Object.keys(VIM_MODE_DEFAULTS)) {
        this.#zenDefaults[name] = defaults.getBoolPref(name, false);
      }
    }
    const values = ZendiaOptions.enabled
      ? VIM_MODE_DEFAULTS
      : this.#zenDefaults;
    for (const [name, value] of Object.entries(values)) {
      defaults.setBoolPref(name, value);
    }
  }

  #registerActor() {
    lazy.ActorManagerParent.addJSWindowActors({
      ZendiaKeys: {
        parent: {
          esModuleURI:
            "resource:///modules/zendia/actors/ZendiaKeysParent.sys.mjs",
        },
        child: {
          esModuleURI:
            "resource:///modules/zendia/actors/ZendiaKeysChild.sys.mjs",
          events: {
            keydown: { capture: true },
            focusin: { capture: true },
            focusout: { capture: true },
            pageshow: {},
            copy: { capture: true },
            cut: { capture: true },
            // The user's own presses and scrolls, which an agent working
            // the tab waits out.
            pointerdown: { capture: true, passive: true, createActor: false },
            wheel: { capture: true, passive: true, createActor: false },
            // Its scrolling, which puts the mode indicator out of the way.
            scroll: { capture: true, passive: true, createActor: false },
          },
        },
        allFrames: true,
        // Tabs, and the popups, sidebars and embedded options pages of
        // extensions.
        messageManagerGroups: ["browsers", "webext-browsers"],
        // The parent checks everything a page sends: runFromKey only runs
        // mapped actions and updateState sanitizes the state.
        safeForUntrustedWebProcess: true,
        enablePreference: ZendiaOptions.PREF_ENABLED,
      },
      // The popups of extensions, whose browsers are in their own message
      // manager group: jump labels on their controls.
      ZendiaPopup: {
        parent: {
          esModuleURI:
            "resource:///modules/zendia/actors/ZendiaPopupParent.sys.mjs",
        },
        child: {
          esModuleURI:
            "resource:///modules/zendia/actors/ZendiaPopupChild.sys.mjs",
          events: {
            DOMContentLoaded: {},
          },
        },
        allFrames: true,
        messageManagerGroups: ["webext-browsers"],
        safeForUntrustedWebProcess: true,
        enablePreference: ZendiaOptions.PREF_ENABLED,
      },
      // The pages the agent shows in its panel, whose browsers are in their
      // own message manager group (ZendiaAgentUiView).
      ZendiaUi: {
        parent: {
          esModuleURI:
            "resource:///modules/zendia/actors/ZendiaUiParent.sys.mjs",
        },
        child: {
          esModuleURI:
            "resource:///modules/zendia/actors/ZendiaUiChild.sys.mjs",
          events: {
            DOMDocElementInserted: {},
            click: { capture: true },
          },
        },
        // The page is the frame of a shell document.
        allFrames: true,
        messageManagerGroups: ["zendia-ui"],
        // The parent checks every request again (ZendiaAgentUiView).
        safeForUntrustedWebProcess: true,
      },
      // The hidden pages of chat sites the agent's panel dictates with,
      // whose browsers are in their own message manager group
      // (ZendiaWebChatDictation).
      ZendiaDictation: {
        parent: {
          esModuleURI:
            "resource:///modules/zendia/actors/ZendiaDictationParent.sys.mjs",
        },
        child: {
          esModuleURI:
            "resource:///modules/zendia/actors/ZendiaDictationChild.sys.mjs",
        },
        messageManagerGroups: ["zendia-dictation"],
        // The parent takes only text from the page, and checks it again.
        safeForUntrustedWebProcess: true,
      },
      // Asking a chat site about a page: the tab's selection, text and
      // images, and the web chat panel's message box (ZendiaWebChatAsk).
      // Made only when asked, and with vim mode off too: the page's menu
      // asks as well.
      ZendiaWebChat: {
        parent: {
          esModuleURI:
            "resource:///modules/zendia/actors/ZendiaWebChatParent.sys.mjs",
        },
        child: {
          esModuleURI:
            "resource:///modules/zendia/actors/ZendiaWebChatChild.sys.mjs",
        },
        allFrames: true,
        messageManagerGroups: ["browsers"],
        // The page only ever answers, and the parent checks every answer.
        safeForUntrustedWebProcess: true,
      },
    });
  }

  #publish() {
    this.#version++;
    Services.ppmm.sharedData.set(
      ZENDIA_SHARED_KEY,
      serializeConfig({
        version: this.#version,
        timeoutlen: ZendiaOptions.timeoutlen,
        keymap: this.keymap,
        actions: this.actions,
        plugins: this.plugins,
      })
    );
    Services.ppmm.sharedData.flush();
  }
}

export const Zendia = new ZendiaService();
