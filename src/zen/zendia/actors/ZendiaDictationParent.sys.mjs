// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// What the hidden page of a dictation reports goes to the dictation that
// made it, which checks it again: the page runs in a web content process.

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  dictationFor:
    "resource:///modules/zendia/webchat/ZendiaWebChatDictation.sys.mjs",
});

export class ZendiaDictationParent extends JSWindowActorParent {
  receiveMessage({ name, data }) {
    const browser = this.browsingContext.top.embedderElement;
    if (browser) {
      lazy.dictationFor(browser)?.receive(browser, name, data);
    }
  }
}
