// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The parent's side of the watch: hands a page's report to the service. The
// page itself is not trusted; the service sanitizes what it sent.
//
// A frame's finding is kept under its window global, one per document:
// when the document goes, so does its finding, whether or not its page
// said goodbye — a sub-frame in another process often cannot, as the page
// above it unloads.

import { ZendiaCaptchaWatch } from "resource:///modules/zendia/captcha/ZendiaCaptchaWatch.sys.mjs";

export class ZendiaCaptchaWatchParent extends JSWindowActorParent {
  #browser = null;
  #frame = null;

  receiveMessage(message) {
    const context = this.browsingContext;
    const browser = context?.top?.embedderElement;
    if (!browser) {
      return;
    }
    const frame = this.manager?.innerWindowId ?? context.id;
    this.#browser = browser;
    this.#frame = frame;
    switch (message.name) {
      case "Zendia:CaptchaWatch:Report":
        ZendiaCaptchaWatch.report(browser, {
          ...message.data,
          frame,
          top: context === context.top,
        });
        break;
      case "Zendia:CaptchaWatch:Gone":
        ZendiaCaptchaWatch.drop(browser, frame);
        break;
      case "Zendia:CaptchaWatch:Debug": {
        const { url, frames = [], scripts = [] } = message.data ?? {};
        console.log(
          `Zendia: CAPTCHA watch DEBUG [${url}]\n` +
            `  frames:\n${frames.map((src) => `    ${src}`).join("\n") || "    (none)"}\n` +
            `  scripts:\n${scripts.map((src) => `    ${src}`).join("\n") || "    (none)"}`,
        );
        break;
      }
    }
  }

  didDestroy() {
    if (this.#browser) {
      ZendiaCaptchaWatch.drop(this.#browser, this.#frame);
    }
  }
}
