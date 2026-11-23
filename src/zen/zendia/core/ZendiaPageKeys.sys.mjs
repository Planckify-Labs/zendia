// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { ZendiaKeys } from "resource:///modules/zendia/core/ZendiaKeys.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

const MODIFIER_KEYS = {
  C: { key: "Control", code: "ControlLeft", keyCode: 17 },
  A: { key: "Alt", code: "AltLeft", keyCode: 18 },
  D: { key: "Meta", code: "MetaLeft", keyCode: 91 },
  S: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
};

const KEY_CODES = {
  Escape: 27,
  Enter: 13,
  Tab: 9,
  Backspace: 8,
  " ": 32,
  Delete: 46,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  Insert: 45,
};

function keyCodeOf(key) {
  if (KEY_CODES[key]) {
    return KEY_CODES[key];
  }
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) {
    return 111 + Number(key.slice(1));
  }
  if (/^[a-z0-9]$/i.test(key)) {
    return key.toUpperCase().charCodeAt(0);
  }
  return 0;
}

/**
 * A page's normal-mode keys, run in the browser process while the page is
 * known to sit idle in normal mode: no field, no visual mode, no jump, nothing
 * half typed. A key bound for the browser then runs at once, however busy the
 * page's process is with loading. A key the page has a use for goes to it as
 * a real key press, in the order it was typed, and the page has the keys
 * until it says it is idle again.
 */
export class ZendiaPageKeys {
  #keymap;
  #whereOf;
  #run;
  #report;
  #options;
  /** @type {WeakMap<Element, object>} */
  #tabs = new WeakMap();
  /** @type {WeakMap<Window, nsITextInputProcessor>} */
  #processors = new WeakMap();
  #replaying = false;

  /**
   * @param {object} options
   * @param {() => object} options.keymap The current ZendiaKeymap.
   * @param {(id: string) => string|undefined} options.whereOf Where an action
   *   runs: "parent" or "content".
   * @param {(browser: Element, id: string) => void} options.run Run a parent
   *   action for the tab.
   * @param {(browser: Element, state: object) => void} options.report Show
   *   what is half typed, as the page would report it.
   * @param {() => {timeoutlen: number, waitForPrefix: boolean}} options.options
   */
  constructor({ keymap, whereOf, run, report, options }) {
    this.#keymap = keymap;
    this.#whereOf = whereOf;
    this.#run = run;
    this.#report = report;
    this.#options = options;
  }

  #tab(browser) {
    let tab = this.#tabs.get(browser);
    if (!tab) {
      tab = {
        browser,
        page: null,
        settled: false,
        generation: 0,
        asking: false,
        pending: [],
        timer: null,
        replay: null,
      };
      this.#tabs.set(browser, tab);
    }
    // A new page starts in normal mode, and a field cannot take the focus
    // before the user has done something in it: its keys can be run here
    // from the start, while it loads.
    const page = browser.browsingContext?.currentWindowGlobal ?? null;
    if (tab.page != page) {
      tab.page = page;
      this.#clear(tab);
      tab.settled = !!page;
      tab.generation++;
    }
    return tab;
  }

  /**
   * A key typed while the tab's page has the focus.
   *
   * @param {Window} window
   * @param {Element} browser
   * @param {KeyboardEvent} event
   * @returns {boolean} Whether it was taken here. A key that was not goes to
   *   the page as usual.
   */
  handleKey(window, browser, event) {
    if (this.#replaying) {
      return false;
    }
    const tab = this.#tab(browser);
    const token = ZendiaKeys.fromEvent(event);
    if (tab.replay) {
      // Keys typed before the ones handed to the page went out wait their
      // turn behind them.
      if (!token) {
        return false;
      }
      tab.replay.push(token);
      return true;
    }
    if (
      !token ||
      !tab.settled ||
      Services.focus.focusedContentBrowsingContext != browser.browsingContext
    ) {
      this.#passed(tab);
      return false;
    }
    return this.#feed(window, tab, token);
  }

  /**
   * A press in the tab's page, which may put a field in focus: it has the
   * keys until it says otherwise.
   *
   * @param {Element} browser
   */
  pointerDown(browser) {
    this.#passed(this.#tab(browser));
  }

  /**
   * The page reported its mode.
   *
   * @param {Element} browser
   * @param {{mode: string, tokens: string[], count: number|null, field: boolean}} state
   * @returns {boolean} Whether the report is what the tab shows: not while
   *   keys half typed here are, which the page knows nothing of.
   */
  pageState(browser, state) {
    const tab = this.#tab(browser);
    if (isIdle(state)) {
      if (tab.pending.length) {
        return false;
      }
      if (!tab.settled) {
        this.#ask(tab);
      }
      return true;
    }
    // A field took the focus, or the page's keys are half typed.
    this.#clear(tab);
    tab.settled = false;
    return true;
  }

  #feed(window, tab, token) {
    const trie = this.#keymap().trie("n");
    if (tab.pending.length && token == "<Esc>") {
      this.#clear(tab);
      this.#notify(tab);
      return true;
    }
    if (tab.pending.length && token == "<BS>") {
      tab.pending = tab.pending.slice(0, -1);
      this.#wait(window, tab, trie.node(tab.pending));
      this.#notify(tab);
      return true;
    }
    if (!tab.pending.length && ZendiaKeys.isCountDigit(token, false)) {
      // A count is the page's: it goes with whatever comes next.
      this.#passed(tab);
      return false;
    }
    const sequence = [...tab.pending, token];
    const node = trie.node(sequence);
    if (!node) {
      if (!tab.pending.length) {
        this.#passed(tab);
        return false;
      }
      // As the engine does: a complete shorter mapping runs, then the key
      // starts over on its own.
      const before = tab.pending;
      const shorter = trie.node(before)?.value;
      this.#clear(tab);
      this.#notify(tab);
      if (shorter && this.#whereOf(shorter.rhs) != "parent") {
        this.#handOff(window, tab, sequence);
        return true;
      }
      if (shorter) {
        this.#run(tab.browser, shorter.rhs);
      }
      return this.#feed(window, tab, token);
    }
    if (!node.children.size) {
      this.#clear(tab);
      this.#notify(tab);
      if (this.#whereOf(node.value.rhs) == "parent") {
        this.#run(tab.browser, node.value.rhs);
      } else if (sequence.length > 1) {
        this.#handOff(window, tab, sequence);
      } else {
        this.#passed(tab);
        return false;
      }
      return true;
    }
    if (!tab.pending.length && !this.#reachesParent(node)) {
      this.#passed(tab);
      return false;
    }
    tab.pending = sequence;
    this.#wait(window, tab, node);
    this.#notify(tab);
    return true;
  }

  #reachesParent(node) {
    if (node.value && this.#whereOf(node.value.rhs) == "parent") {
      return true;
    }
    for (const child of node.children.values()) {
      if (this.#reachesParent(child)) {
        return true;
      }
    }
    return false;
  }

  #wait(window, tab, node) {
    this.#cancelTimer(tab);
    if (!tab.pending.length) {
      return;
    }
    const { timeoutlen, waitForPrefix } = this.#options();
    if (waitForPrefix && !node?.value) {
      return;
    }
    tab.timer = lazy.setTimeout(() => {
      tab.timer = null;
      const sequence = tab.pending;
      const mapping = this.#keymap().trie("n").node(sequence)?.value;
      this.#clear(tab);
      this.#notify(tab);
      if (!mapping) {
        return;
      }
      if (this.#whereOf(mapping.rhs) == "parent") {
        this.#run(tab.browser, mapping.rhs);
      } else {
        this.#handOff(window, tab, sequence);
      }
    }, timeoutlen);
  }

  #cancelTimer(tab) {
    if (tab.timer !== null) {
      lazy.clearTimeout(tab.timer);
      tab.timer = null;
    }
  }

  #clear(tab) {
    this.#cancelTimer(tab);
    tab.pending = [];
  }

  #notify(tab) {
    const keymap = this.#keymap();
    this.#report(tab.browser, {
      mode: "n",
      tokens: [...tab.pending],
      count: null,
      group: tab.pending.length ? keymap.groupName("n", tab.pending) : null,
      field: false,
    });
  }

  // Keys this side took that turned out to be the page's: they are pressed
  // again for it once the key being handled is done, since a key cannot be
  // sent while another is being dispatched.
  #handOff(window, tab, tokens) {
    tab.settled = false;
    tab.replay = [...tokens];
    lazy.setTimeout(() => {
      const replay = tab.replay;
      tab.replay = null;
      if (!replay || !window.gBrowser?.getTabForBrowser(tab.browser)) {
        return;
      }
      this.#replaying = true;
      try {
        for (const token of replay) {
          this.#press(window, token);
        }
      } catch (e) {
        console.error("Zendia: keys for the page were lost", e);
      } finally {
        this.#replaying = false;
      }
      this.#passed(tab);
    }, 0);
  }

  #press(window, token) {
    const event = ZendiaKeys.tokenToEvent(token);
    if (!event) {
      return;
    }
    let tip = this.#processors.get(window);
    if (!tip) {
      tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(
        Ci.nsITextInputProcessor
      );
      this.#processors.set(window, tip);
    }
    if (!tip.beginInputTransaction(window, () => true)) {
      return;
    }
    const modifiers = [];
    if (event.ctrlKey) {
      modifiers.push(MODIFIER_KEYS.C);
    }
    if (event.altKey) {
      modifiers.push(MODIFIER_KEYS.A);
    }
    if (event.metaKey) {
      modifiers.push(MODIFIER_KEYS.D);
    }
    // Shift is in a printable character already.
    if (event.shiftKey && event.key.length > 1) {
      modifiers.push(MODIFIER_KEYS.S);
    }
    const make = init => new window.KeyboardEvent("", init);
    for (const modifier of modifiers) {
      tip.keydown(make(modifier));
    }
    const key = make({
      key: event.key,
      code: event.code || (event.key == " " ? "Space" : event.key),
      keyCode: keyCodeOf(event.key),
    });
    tip.keydown(key);
    tip.keyup(key);
    for (const modifier of modifiers.reverse()) {
      tip.keyup(make(modifier));
    }
  }

  // Something went to the page: it has the keys until it answers that it is
  // idle, after everything sent so far.
  #passed(tab) {
    tab.settled = false;
    tab.generation++;
    this.#ask(tab);
  }

  #ask(tab) {
    if (tab.asking) {
      return;
    }
    tab.asking = true;
    // After the key or press being handled has gone out to the page, so the
    // answer comes after the page has seen it.
    lazy.setTimeout(async () => {
      const generation = tab.generation;
      let idle = false;
      try {
        idle = await tab.browser.browsingContext?.currentWindowGlobal
          ?.getActor("ZendiaKeys")
          .sendQuery("Zendia:Idle");
      } catch {
        // The page is gone, or has no keys yet.
      }
      tab.asking = false;
      if (tab.generation != generation) {
        this.#ask(tab);
        return;
      }
      tab.settled = idle === true;
    }, 0);
  }
}

function isIdle(state) {
  return (
    state.mode == "n" &&
    !state.tokens?.length &&
    state.count === null &&
    !state.field
  );
}
