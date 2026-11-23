// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  Zendia: "resource:///modules/zendia/Zendia.sys.mjs",
  ZENDIA_CAPTURING_KEY: "resource:///modules/zendia/core/ZendiaShared.sys.mjs",
  recordYank: "resource:///modules/zendia/plugins/ZendiaYank.sys.mjs",
  yankAt: "resource:///modules/zendia/plugins/ZendiaYank.sys.mjs",
});

// The pages whose jump has the keys, by top browsing context id, as every
// content process reads them (ZENDIA_CAPTURING_KEY).
const gCapturing = new Set();

function publishCapturing() {
  Services.ppmm.sharedData.set(lazy.ZENDIA_CAPTURING_KEY, [...gCapturing]);
  Services.ppmm.sharedData.flush();
}

// A key a frame passes to its page's jump: only what a key event says, and
// no more of it than a key name takes.
function keyData(data) {
  const text = value =>
    typeof value == "string" && value.length <= 32 ? value : null;
  const key = text(data?.key);
  if (!key) {
    return null;
  }
  return {
    key,
    code: text(data.code) ?? "",
    ctrlKey: data.ctrlKey === true,
    altKey: data.altKey === true,
    metaKey: data.metaKey === true,
    shiftKey: data.shiftKey === true,
    altGraph: data.altGraph === true,
  };
}

// What a frame may ask of another frame of its page, and which content
// actions it may start in it.
const FRAME_QUERIES = new Set([
  "Zendia:CollectControls",
  "Zendia:CollectAreas",
  "Zendia:PressControl",
  "Zendia:Pointer",
  "Zendia:RunContent",
]);
const FRAME_ACTIONS = new Set(["jump.controls", "jump.hints", "jump.captcha"]);

// When the user last pressed a key, a button or the wheel in a tab, by its
// browser: an agent working the tab waits until the user pauses.
const gUserInput = new WeakMap();

/**
 * @param {Element} browser
 * @returns {number} When the user's own input last reached the tab's page
 *   (Date.now()), 0 if it never did.
 */
export function lastUserInput(browser) {
  return gUserInput.get(browser) ?? 0;
}

/**
 * The user's own key reached the tab without going to its page, which then
 * cannot report it.
 *
 * @param {Element} browser
 */
export function noteUserInput(browser) {
  gUserInput.set(browser, Date.now());
}

export class ZendiaKeysParent extends JSWindowActorParent {
  receiveMessage({ name, data }) {
    const browser = this.browsingContext.top.embedderElement;
    if (!browser) {
      return undefined;
    }
    switch (name) {
      case "Zendia:Run":
        return lazy.Zendia.runFromKey(browser, data.id, data.args);
      case "Zendia:State":
        lazy.Zendia.pageState(browser, data);
        break;
      case "Zendia:Yank":
        return lazy.recordYank(lazy.Zendia, browser, data);
      case "Zendia:YankAt":
        return lazy.yankAt(lazy.Zendia, data.index);
      case "Zendia:FrameQuery":
        return this.#askFrame(data);
      case "Zendia:RunInTop":
        return this.#runInTop(browser, data);
      case "Zendia:FrameIdle":
        this.#topActor(browser)?.sendAsyncMessage("Zendia:ResendState");
        break;
      case "Zendia:Capturing":
        this.#setCapturing(data?.on === true);
        break;
      case "Zendia:CaptureKey":
        this.#passKeyToTop(browser, data);
        break;
      case "Zendia:UserInput":
        gUserInput.set(browser, Date.now());
        break;
      case "Zendia:Scrolled":
        lazy.Zendia.pageScrolled(browser);
        break;
      case "Zendia:Escape":
        lazy.Zendia.pageEscaped(browser);
        break;
      // The user took the keys back from an agent's labels on this tab.
      case "Zendia:AgentCaptureDismissed":
        Services.obs.notifyObservers(browser, "zendia-agent-capture-dismissed");
        break;
    }
    return undefined;
  }

  didDestroy() {
    // The page is gone, and its jump with it.
    if (gCapturing.delete(this.browsingContext?.id)) {
      publishCapturing();
    }
  }

  // Only a page's top frame runs a jump that takes the keys of its frames.
  #setCapturing(on) {
    const id = this.browsingContext.id;
    if (this.browsingContext.parent || gCapturing.has(id) == on) {
      return;
    }
    if (on) {
      gCapturing.add(id);
    } else {
      gCapturing.delete(id);
    }
    publishCapturing();
  }

  // A key typed in a frame, while the page's jump has the keys.
  #passKeyToTop(browser, data) {
    const key = keyData(data);
    if (
      !key ||
      !this.browsingContext.parent ||
      !gCapturing.has(this.browsingContext.top.id)
    ) {
      return;
    }
    this.#topActor(browser)?.sendAsyncMessage("Zendia:CaptureKey", key);
  }

  #topActor(browser) {
    return browser.browsingContext?.currentWindowGlobal?.getActor("ZendiaKeys");
  }

  // A key typed in a frame runs its content action in the page, and the
  // page takes the focus, so the keys that follow go to it as well. Only
  // actions the keymap points at run, whatever the frame says.
  async #runInTop(browser, { id, args } = {}) {
    const action = lazy.Zendia.actions.get(id);
    if (
      action?.where != "content" ||
      !lazy.Zendia.keymap.maps(id) ||
      !this.#topActor(browser)
    ) {
      return;
    }
    try {
      await this.#topActor(browser).sendQuery("Zendia:TakeFocus");
      await lazy.Zendia.run(id, args ?? {}, { browser });
    } catch (e) {
      console.error(`Zendia: "${id}" failed`, e);
    }
  }

  // Pass a query to another frame of this page, which a page's frames may
  // do for each other; the data is a page's, so it is checked.
  #askFrame({ bcId, name, data } = {}) {
    const frame = Number.isSafeInteger(bcId) ? BrowsingContext.get(bcId) : null;
    if (
      !frame ||
      frame.top !== this.browsingContext.top ||
      !FRAME_QUERIES.has(name) ||
      (name == "Zendia:RunContent" &&
        (!FRAME_ACTIONS.has(data?.id) || frame.parent))
    ) {
      return null;
    }
    return frame.currentWindowGlobal
      ?.getActor("ZendiaKeys")
      .sendQuery(name, data);
  }
}
