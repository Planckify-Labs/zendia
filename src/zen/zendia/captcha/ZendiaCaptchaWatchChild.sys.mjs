// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The page's side of the watch: on every page shown, read what the page
// holds through the detection layer and report the findings up. Only the
// top page reports; a CAPTCHA's own frame needs no watcher, for its address
// already says what it is to the page above it.

import { ZendiaCaptcha } from "resource:///modules/zendia/core/ZendiaCaptcha.sys.mjs";

/**
 * What of a page is a CAPTCHA's, seen from the page itself: the frames of
 * the services (by their address), the loader scripts (by theirs), the
 * widgets the page drew, the answer fields of solved ones, and the trap
 * fields of its forms.
 *
 * @param {Window} window
 * @returns {{signal: string, name?: string, kind?: string, challenge?: boolean, detail?: string}[]}
 */
export function scanPage(window) {
  const document = window.document;
  const detections = [];
  for (const frame of document.querySelectorAll("iframe[src], frame[src]")) {
    const src = frame.src;
    const name = ZendiaCaptcha.nameOf(src);
    if (name) {
      detections.push({
        signal: "frame",
        name,
        kind: ZendiaCaptcha.kindOf(src),
        challenge: ZendiaCaptcha.isChallenge(src),
        detail: src.slice(0, 200),
      });
    }
  }
  for (const script of document.scripts) {
    const name = script.src && ZendiaCaptcha.nameOfScript(script.src);
    if (name) {
      detections.push({
        signal: "script",
        name,
        kind: ZendiaCaptcha.kindOfScript(script.src),
        detail: script.src.slice(0, 200),
      });
    }
  }
  let widgets = 0;
  try {
    widgets = document.querySelectorAll(ZendiaCaptcha.WIDGETS).length;
  } catch {
    // A selector this page's engine does not know.
  }
  if (widgets) {
    detections.push({ signal: "widget", detail: String(widgets) });
  }
  for (const field of document.querySelectorAll(
    "input[name], textarea[name]",
  )) {
    const name = field.name.slice(0, 64);
    if (ZendiaCaptcha.isTokenField(name)) {
      detections.push({ signal: "token", detail: name });
      continue;
    }
    const visible =
      field.type != "hidden" && (field.checkVisibility?.() ?? true);
    if (ZendiaCaptcha.isHoneypotField(name, { visible })) {
      detections.push({ signal: "honeypot", kind: "honeypot", detail: name });
    }
  }
  return detections;
}

// How long the page has to stop adding frames and scripts before it is read
// again: a CAPTCHA's script draws its frames after the page is shown, and a
// challenge often only opens on a click.
const RESCAN_DELAY_MS = 500;

const WATCHED = new Set(["iframe", "frame", "script", "input", "textarea"]);

// Whether a change to the page could have brought a CAPTCHA with it.
function bringsCaptcha(records) {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (
        node.nodeType == 1 &&
        (WATCHED.has(node.localName) ||
          node.querySelector?.("iframe, frame, script, input, textarea"))
      ) {
        return true;
      }
    }
  }
  return false;
}

export class ZendiaCaptchaWatchChild extends JSWindowActorChild {
  #observer = null;
  #timer = null;

  handleEvent(event) {
    switch (event.type) {
      case "pageshow":
        this.#scan();
        this.#watch();
        break;
      case "pagehide":
        this.#unwatch();
        this.sendAsyncMessage("Zendia:CaptchaWatch:Gone");
        break;
    }
  }

  // The service asks for a look at pages that were open before it started.
  receiveMessage(message) {
    if (message.name == "Zendia:CaptchaWatch:Scan") {
      this.#scan();
      this.#watch();
    }
  }

  didDestroy() {
    this.#unwatch();
  }

  #scan() {
    if (!this.document) {
      return;
    }
    const detections = scanPage(this.contentWindow);
    if (detections.length) {
      this.sendAsyncMessage("Zendia:CaptchaWatch:Report", {
        url: this.document.documentURI,
        detections,
      });
    }
    // A dev-only audit of coverage: every frame and script the page holds,
    // so what the layer does not yet name can be seen next to what it does.
    if (Services.prefs.getBoolPref("zendia.captcha.watch.debug", false)) {
      this.sendAsyncMessage("Zendia:CaptchaWatch:Debug", {
        url: this.document.documentURI,
        frames: [
          ...this.document.querySelectorAll("iframe[src], frame[src]"),
        ].map((frame) => frame.src),
        scripts: [...this.document.scripts]
          .map((script) => script.src)
          .filter((src) => /^https?:/.test(src)),
      });
    }
  }

  #watch() {
    const window = this.contentWindow;
    if (this.#observer || !window?.document.documentElement) {
      return;
    }
    this.#observer = new window.MutationObserver((records) => {
      if (!bringsCaptcha(records)) {
        return;
      }
      window.clearTimeout(this.#timer);
      this.#timer = window.setTimeout(() => this.#scan(), RESCAN_DELAY_MS);
    });
    this.#observer.observe(window.document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  #unwatch() {
    this.#observer?.disconnect();
    this.#observer = null;
    try {
      this.contentWindow?.clearTimeout(this.#timer);
    } catch {
      // The window is already gone.
    }
    this.#timer = null;
  }
}
