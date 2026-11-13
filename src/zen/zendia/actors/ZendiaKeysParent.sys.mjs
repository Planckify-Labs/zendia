// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  Zendia: "resource:///modules/zendia/Zendia.sys.mjs",
  recordYank: "resource:///modules/zendia/plugins/ZendiaYank.sys.mjs",
  yankAt: "resource:///modules/zendia/plugins/ZendiaYank.sys.mjs",
});

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
        lazy.Zendia.updateState(browser, data);
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
    }
    return undefined;
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
