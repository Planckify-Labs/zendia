// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Watches the pages the browser opens and says when a CAPTCHA is on one:
// a frame of a known service, a loader script, a widget the page drew
// itself, a challenge it draws with no service to know it by, the answer
// field of a solved one, or a trap field of the form.
// The page's own actor does the reading (ZendiaCaptchaWatchChild); this
// service keeps what was found per tab, logs it, and puts up a doorhanger,
// so a detection is seen without anyone asking for it.
//
// It only watches and names. Acting on what it finds is the user's part,
// with the keys (jump.captcha), as it is for the agent.
//
// It watches live: every frame reads where its CAPTCHA is at (asking,
// checking, solved; ZendiaCaptcha.STATES) and reports again when that
// changes, so a pass, an expiry or a new ask on the same page is announced
// as it happens, and so is the CAPTCHA going away.

import { ZendiaCaptcha } from "resource:///modules/zendia/core/ZendiaCaptcha.sys.mjs";
import { clearTimeout, setTimeout } from "resource://gre/modules/Timer.sys.mjs";

const PARENT_URI =
  "resource:///modules/zendia/captcha/ZendiaCaptchaWatchParent.sys.mjs";
const CHILD_URI =
  "resource:///modules/zendia/captcha/ZendiaCaptchaWatchChild.sys.mjs";

// zendia.captcha.watch: whether pages are watched at all.
export const PREF_WATCH = "zendia.captcha.watch";
// zendia.captcha.watch.notify: whether a finding puts up a doorhanger. Off
// by default; the dev profile turns it on (scripts/zendia-dev-prefs.sh), so
// only dev runs show it. The Browser Console line is written either way.
export const PREF_NOTIFY = "zendia.captcha.watch.notify";

// The most a page may tell: reports come from content processes.
const MAX_DETECTIONS = 50;
const MAX_URL = 2048;
const MAX_TEXT = 256;

// How long a frame that went is waited for to come back before the tab is
// read without it: a service reloads its checkbox frame when its answer
// expires (reCAPTCHA does), and the new one reports within a second or so.
// Read at once, the tab would say no CAPTCHA for that second.
const REPLACE_WAIT_MS = 2000;

// The infobar's value, so a page's notice replaces its own on a rescan.
const NOTIFICATION_VALUE = "zendia-captcha-watch";

function text(value, max = MAX_TEXT) {
  return typeof value == "string" ? value.slice(0, max) : null;
}

// What a page sent, reduced to what the report keeps of it.
function sanitize(detections) {
  if (!Array.isArray(detections)) {
    return [];
  }
  return detections.slice(0, MAX_DETECTIONS).flatMap((detection) => {
    const signal = text(detection?.signal, 32);
    if (
      !["frame", "script", "widget", "own", "token", "honeypot"].includes(
        signal,
      )
    ) {
      return [];
    }
    return [
      {
        signal,
        name: text(detection.name, 64),
        kind: text(detection.kind, 64),
        challenge: detection.challenge === true,
        hidden: detection.hidden === true,
        detail: text(detection.detail),
      },
    ];
  });
}

// What a frame says its CAPTCHA is at, reduced to what is kept of it.
function sanitizeState(reading) {
  const state = text(reading?.state, 16);
  if (!ZendiaCaptcha.STATES.includes(state)) {
    return { state: "none" };
  }
  return {
    state,
    name: text(reading.name, 64),
    how: text(reading.how, 160),
  };
}

/**
 * One line for what a page holds, for the log and the doorhanger:
 * "reCAPTCHA (image, score); Kasada (sensor); 2 page widgets; page-drawn
 * image challenge "Select all images with buses"; token field
 * cf-turnstile-response; honeypot field website".
 *
 * @param {object[]} detections What scanPage found, sanitized.
 * @returns {string} Empty when there is nothing to say.
 */
export function describe(detections) {
  const services = new Map();
  for (const { signal, name, kind } of detections) {
    if ((signal == "frame" || signal == "script") && name) {
      const kinds = services.get(name) ?? new Set();
      if (kind) {
        kinds.add(kind);
      }
      services.set(name, kinds);
    }
  }
  const parts = [...services].map(
    ([name, kinds]) =>
      `${name}${kinds.size ? ` (${[...kinds].join(", ")})` : ""}`,
  );
  const widget = detections.find(({ signal }) => signal == "widget");
  if (widget?.detail) {
    parts.push(
      `${widget.detail} page widget${widget.detail == "1" ? "" : "s"}`,
    );
  }
  for (const { kind, detail } of detections.filter(
    ({ signal }) => signal == "own",
  )) {
    parts.push(
      `page-drawn ${kind ? `${kind} ` : ""}challenge${detail ? ` "${detail.slice(0, 80)}"` : ""}`,
    );
  }
  const details = (signal) =>
    detections
      .filter((detection) => detection.signal == signal && detection.detail)
      .map(({ detail }) => detail);
  const tokens = details("token");
  if (tokens.length) {
    parts.push(
      `token field${tokens.length == 1 ? "" : "s"} ${tokens.join(", ")}`,
    );
  }
  const traps = details("honeypot");
  if (traps.length) {
    parts.push(
      `honeypot field${traps.length == 1 ? "" : "s"} ${traps.join(", ")}`,
    );
  }
  return parts.join("; ");
}

/**
 * @param {object[]} detections
 * @returns {string} What stays the same between two looks at the same page,
 *   so a page is not announced twice.
 */
export function signatureOf(detections) {
  return detections
    .map(({ signal, name, kind, detail, hidden }) =>
      [signal, name ?? "", kind ?? "", detail ?? "", hidden ? "hidden" : ""].join(
        ":",
      ),
    )
    .sort()
    .join("|");
}

class ZendiaCaptchaWatchService {
  #initialized = false;
  // Per tab, what each of its frames last reported, keyed by the frame's
  // browsing-context id: a CAPTCHA may sit in a sub-frame, even a
  // cross-origin one, so every frame's finding counts toward the tab's.
  #frames = new WeakMap();
  // The merged finding of each tab, for the tests and the curious.
  #last = new WeakMap();
  // The signature last announced for a tab, so the same finding is not
  // announced again as frames report and re-report.
  #announced = new WeakMap();
  // What of it the notice was last put up for: the finding, not its state.
  #noticed = new WeakMap();
  // Who hears of a tab's new finding: the CAPTCHA subagent.
  #listeners = new Set();

  init() {
    if (this.#initialized || !Services.prefs.getBoolPref(PREF_WATCH, true)) {
      return;
    }
    this.#initialized = true;
    const { ActorManagerParent } = ChromeUtils.importESModule(
      "resource://gre/modules/ActorManagerParent.sys.mjs",
    );
    ActorManagerParent.addJSWindowActors({
      ZendiaCaptchaWatch: {
        parent: { esModuleURI: PARENT_URI },
        child: {
          esModuleURI: CHILD_URI,
          events: { pageshow: {}, pagehide: {} },
        },
        // Every frame reads itself: a CAPTCHA inside a sub-frame, including a
        // cross-origin one the top page cannot see into, is found this way.
        allFrames: true,
        messageManagerGroups: ["browsers"],
        // The parent sanitizes everything a page sends (sanitize()).
        safeForUntrustedWebProcess: true,
      },
    });
    this.#scanOpenTabs();
  }

  // The pages shown before the watch started (a restored session) had their
  // pageshow already: they are asked for a look now.
  #scanOpenTabs() {
    for (const window of Services.wm.getEnumerator("navigator:browser")) {
      for (const browser of window.gBrowser?.browsers ?? []) {
        for (const context of browser.browsingContext?.getAllBrowsingContextsInSubtree() ??
          []) {
          try {
            context.currentWindowGlobal
              ?.getActor("ZendiaCaptchaWatch")
              .sendAsyncMessage("Zendia:CaptchaWatch:Scan");
          } catch {
            // A frame with nothing loaded, or no actor there.
          }
        }
      }
    }
  }

  /**
   * The merged finding of a tab: what all its frames hold together.
   *
   * @param {Element} browser
   * @returns {{url: string, detections: object[], state: string, how: string|null, text: string, signature: string, at: number}|null}
   */
  lastFor(browser) {
    return this.#last.get(browser) ?? null;
  }

  /**
   * Called with the browser and the tab's merged finding when the finding
   * is new or its state changed, after the log line and the doorhanger;
   * and with a finding of state "none" and no detections when the CAPTCHA
   * went from the tab.
   *
   * @param {(browser: Element, record: object) => void} listener
   * @returns {() => void} Removes it.
   */
  onDetect(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * A report from one frame of a tab. Kept under that frame, merged with the
   * tab's other frames, then logged and shown when the merged finding is new.
   *
   * @param {Element} browser The tab the frame belongs to.
   * @param {{url: string, detections: object[], state?: object, frame?: number, top?: boolean}} report
   *   `state` is where the frame's CAPTCHA is at (captchaState).
   * @returns {object|null} The tab's merged finding, or null when it holds
   *   nothing.
   */
  report(browser, { url, detections, state, frame = 0, top = true } = {}) {
    if (!browser) {
      return null;
    }
    detections = sanitize(detections);
    state = sanitizeState(state);
    const frames = this.#frames.get(browser) ?? new Map();
    // A sub-frame that reads a state stands in for those that went
    // (drop()): they are let go now. The page's own report does not, as it
    // often comes in the gap, its frames having changed.
    if (top !== true && state.state != "none") {
      this.#letGo(frames);
    }
    // A checkbox frame may hold no finding of its own, only its state.
    if (detections.length || state.state != "none") {
      frames.set(frame, {
        url: text(url, MAX_URL) ?? "",
        detections,
        state,
        top: top === true,
      });
    } else if (!frames.delete(frame)) {
      // Nothing here and nothing was here: the tab is unchanged.
      return this.#last.get(browser) ?? null;
    }
    this.#frames.set(browser, frames);
    return this.#recompute(browser);
  }

  /**
   * A frame is gone (navigated away or closed): drop what it held and
   * recompute the tab.
   *
   * @param {Element} browser
   * @param {number} frame
   */
  drop(browser, frame) {
    const frames = this.#frames.get(browser);
    const gone = frames?.get(frame);
    // Nothing kept, or kept already till another stands in: a frame is
    // dropped twice, as its page hides and as its actor goes.
    if (!gone || gone.leaving) {
      return;
    }
    // A frame of a page that stays, which held a state, is most often being
    // replaced (a checkbox frame reloaded on an expiry): what it read stays
    // in the tab until a frame after it reads a state (report()), or for a
    // moment at most. The page itself going is read at once, and so are
    // the frames that stood in for others.
    const pageStays = [...frames.values()].some(
      (entry) => entry.top && entry !== gone,
    );
    if (!gone.top && pageStays && gone.state?.state != "none") {
      gone.leaving = setTimeout(() => {
        if (frames.get(frame) === gone) {
          frames.delete(frame);
          this.#recompute(browser);
        }
      }, REPLACE_WAIT_MS);
      return;
    }
    frames.delete(frame);
    if (gone.top) {
      this.#letGo(frames);
    }
    this.#recompute(browser);
  }

  // Lets the frames that went go, those kept till another stood in.
  #letGo(frames) {
    for (const [key, entry] of frames) {
      if (entry.leaving) {
        clearTimeout(entry.leaving);
        frames.delete(key);
      }
    }
  }

  // Merge every frame's findings into the tab's, drop duplicates, take the
  // state that asks most of the user, and announce the result if it
  // changed since last time, its state included.
  #recompute(browser) {
    const frames = this.#frames.get(browser);
    const merged = [];
    const seen = new Set();
    let url = "";
    let state = { state: "none" };
    for (const entry of frames?.values() ?? []) {
      if (entry.top || !url) {
        url = entry.url;
      }
      if (
        entry.state &&
        entry.state.state != state.state &&
        ZendiaCaptcha.stronger(state.state, entry.state.state) ==
          entry.state.state
      ) {
        state = entry.state;
      }
      for (const detection of entry.detections) {
        const key = signatureOf([detection]);
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(detection);
        }
      }
    }
    if (!merged.length && state.state == "none") {
      this.#last.delete(browser);
      // Whoever heard of the CAPTCHA hears it went: the page moved on, or
      // the page took the widget down once it passed.
      this.#noticed.delete(browser);
      if (this.#announced.delete(browser)) {
        this.#tell(browser, {
          url: browser.currentURI?.spec ?? "",
          detections: [],
          state: "none",
          how: "the CAPTCHA is gone from the page",
          text: "",
          signature: "",
          at: Date.now(),
        });
      }
      return null;
    }
    const signature = `${signatureOf(merged)}#${state.state}`;
    const record = {
      url,
      detections: merged,
      state: state.state,
      how: state.how ?? null,
      text: describe(merged) || state.name || "CAPTCHA",
      signature,
      at: Date.now(),
    };
    this.#last.set(browser, record);
    // The same finding is not announced twice as frames re-report.
    if (this.#announced.get(browser) == signature) {
      return record;
    }
    const found = signatureOf(merged);
    const before = this.#noticed.get(browser);
    this.#noticed.set(browser, found);
    this.#announced.set(browser, signature);
    console.log(
      `Zendia: CAPTCHA watch: ${record.text}, ${record.state}${record.how ? ` (${record.how})` : ""} [${record.url}]`
    );
    // The notice is for a CAPTCHA found, not for each turn of its state.
    if (before != found) {
      this.#notify(browser, record.text);
    }
    this.#tell(browser, record);
    return record;
  }

  #tell(browser, record) {
    for (const listener of this.#listeners) {
      try {
        listener(browser, record);
      } catch (e) {
        console.error("Zendia: CAPTCHA watch listener failed", e);
      }
    }
  }

  // The browser-UI window that holds a tab's browser. Its own ownerGlobal is
  // null when the browser is reached through an actor under Fission, so the
  // window is found through the window mediator instead.
  #windowFor(browser) {
    if (browser.ownerGlobal?.gBrowser) {
      return browser.ownerGlobal;
    }
    for (const window of Services.wm.getEnumerator("navigator:browser")) {
      if (window.gBrowser?.browsers?.includes(browser)) {
        return window;
      }
    }
    return null;
  }

  // A notice attached to the page that holds the CAPTCHA, in dev runs only.
  // An infobar from gBrowser's notification box, which shows even with the
  // toolbar hidden (vim mode hides it), unlike a doorhanger that must anchor
  // to an address-bar icon. Detection is the point; what to do about it is
  // left to the user.
  #notify(browser, found) {
    if (!Services.prefs.getBoolPref(PREF_NOTIFY, false)) {
      return;
    }
    try {
      const window = this.#windowFor(browser);
      const box = window?.gBrowser?.getNotificationBox(browser);
      if (!box) {
        return;
      }
      const existing = box.getNotificationWithValue?.(NOTIFICATION_VALUE);
      if (existing) {
        existing.remove();
      }
      box
        .appendNotification(
          NOTIFICATION_VALUE,
          {
            label: `CAPTCHA detected on this page: ${found}`,
            priority: box.PRIORITY_INFO_MEDIUM,
          },
          [],
        )
        .catch((e) =>
          console.error("Zendia: CAPTCHA watch could not show a notice", e),
        );
    } catch (e) {
      // No UI to tell it to (a test, or a window that is gone).
      console.error("Zendia: CAPTCHA watch could not show a notice", e);
    }
  }
}

export const ZendiaCaptchaWatch = new ZendiaCaptchaWatchService();
