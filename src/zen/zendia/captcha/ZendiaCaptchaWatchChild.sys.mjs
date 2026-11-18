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

/**
 * The part of the page the challenge is in, for the subagent's shot of it:
 * the frame that asks for clicks, else the service's frame, else the widget
 * the page drew, the first of them with a size. Scrolled into view first,
 * for the shot and the user. The rect is of this frame's own viewport; the
 * subagent snapshots from this frame's global, so a challenge in a
 * sub-frame needs no coordinates moved.
 *
 * @param {Window} window
 * @returns {{left: number, top: number, width: number, height: number,
 *   viewWidth: number, viewHeight: number, scrollX: number, scrollY: number,
 *   challenge: boolean, frame: boolean}|null}
 *   Where it is in this frame's viewport, with the viewport's size and
 *   scroll (the shot is taken in the document's coordinates), whether it is
 *   the part that asks for clicks and whether it is a frame (not a page
 *   widget); or null when the page has none.
 */
export function challengeRect(window) {
  const document = window.document;
  const frames = [
    ...document.querySelectorAll("iframe[src], frame[src]"),
  ].filter((frame) => ZendiaCaptcha.nameOf(frame.src));
  let widget = null;
  try {
    widget = document.querySelector(ZendiaCaptcha.WIDGETS);
  } catch {
    // A selector this page's engine does not know.
  }
  const candidates = [
    ...new Set([
      frames.find((frame) => ZendiaCaptcha.isChallenge(frame.src)),
      frames[0],
      widget,
    ]),
  ].filter(Boolean);
  for (const element of candidates) {
    element.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "instant",
    });
    const rect = element.getBoundingClientRect();
    // A hidden one is none: no size, or parked out of the viewport the way
    // a collapsed challenge frame is.
    if (
      !rect.width ||
      !rect.height ||
      rect.bottom <= 0 ||
      rect.right <= 0 ||
      rect.top >= window.innerHeight ||
      rect.left >= window.innerWidth
    ) {
      continue;
    }
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      viewWidth: window.innerWidth,
      viewHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      challenge:
        element == frames.find((frame) => ZendiaCaptcha.isChallenge(frame.src)),
      frame: frames.includes(element),
    };
  }
  return null;
}

/**
 * Open the challenge, from inside its own checkbox widget: the click on
 * "I'm not a robot" the user would have to make, made for them, so the
 * subagent's shot and their finish start at the challenge. Only the
 * widget frames answer; a challenge already open, a checkbox already
 * checked and the invisible kinds are left alone.
 *
 * @param {Window} window
 * @param {boolean} [peek] Only say whether the checkbox is checked; never
 *   click.
 * @returns {{opened: boolean, name: string}|{passed: boolean}|null}
 */
export function openChallenge(window, peek = false) {
  const document = window.document;
  const url = document.documentURI ?? "";
  const name = ZendiaCaptcha.nameOf(url);
  if (!name || ZendiaCaptcha.isChallenge(url)) {
    return null;
  }
  // The services whose widget is a checkbox to click (reCAPTCHA, hCaptcha,
  // Yandex). The managed and invisible ones have nothing to open.
  if (ZendiaCaptcha.kindOf(url) != "checkbox") {
    return null;
  }
  const control =
    document.querySelector("#recaptcha-anchor") ??
    document.querySelector("#checkbox") ??
    document.querySelector("[role='checkbox']") ??
    document.querySelector("input[type='checkbox']");
  if (!control) {
    return null;
  }
  if (control.getAttribute("aria-checked") == "true") {
    return { passed: true };
  }
  if (peek) {
    return null;
  }
  control.click();
  return { opened: true, name };
}

/**
 * Whether the challenge is drawn, seen from inside its own frame: the
 * document is complete and every picture in it loaded — the frame is in
 * the page with its final size long before the grid it shows is. Only a
 * challenge frame answers.
 *
 * @param {Window} window
 * @returns {{drawn: boolean}|null}
 */
export function challengeDrawn(window) {
  const document = window.document;
  if (!ZendiaCaptcha.isChallenge(document.documentURI ?? "")) {
    return null;
  }
  const images = [...(document.images ?? [])];
  if (images.length) {
    return {
      drawn: images.every((image) => image.complete && image.naturalWidth > 0),
    };
  }
  // Canvas- and markup-drawn challenges: content is there once the
  // document is.
  const body = document.body;
  const content =
    body?.querySelector("canvas, button, [role='button'], input, table") ||
    body?.textContent.trim();
  return { drawn: document.readyState == "complete" && !!content };
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

  // The service asks for a look at pages that were open before it started,
  // and the subagent for where the challenge is, or to open it.
  receiveMessage(message) {
    if (message.name == "Zendia:CaptchaWatch:Scan") {
      this.#scan();
      this.#watch();
    }
    if (message.name == "Zendia:CaptchaWatch:Rect") {
      return challengeRect(this.contentWindow);
    }
    if (message.name == "Zendia:CaptchaWatch:Open") {
      return openChallenge(this.contentWindow, message.data?.peek === true);
    }
    if (message.name == "Zendia:CaptchaWatch:Drawn") {
      return challengeDrawn(this.contentWindow);
    }
    return undefined;
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
