// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { ZendiaPopupHints } from "resource:///modules/zendia/core/ZendiaPopupHints.sys.mjs";

// An extension's popup, in the browser's panel: once it has loaded the
// parent says whether it was opened from the keys, and only then do its
// controls get labels. Opened with the mouse, it has none until `s` asks.
export class ZendiaPopupChild extends JSWindowActorChild {
  #hints = null;

  handleEvent(event) {
    if (event.type == "DOMContentLoaded" && !this.browsingContext.parent) {
      this.sendAsyncMessage("ZendiaPopup:Loaded");
    }
  }

  receiveMessage({ name, data }) {
    if (name == "ZendiaPopup:Hints" && !this.#hints && this.contentWindow) {
      this.#hints = new ZendiaPopupHints(this.contentWindow, data.colors);
    }
  }

  didDestroy() {
    this.#hints?.destroy();
    this.#hints = null;
  }
}
