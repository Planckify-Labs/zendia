// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Watches the pages the browser opens and says when a CAPTCHA is on one:
// a frame of a known service, a loader script, a widget the page drew
// itself, the answer field of a solved one, or a trap field of the form.
// The page's own actor does the reading (ZendiaCaptchaWatchChild); this
// service keeps what was found per tab, logs it, and puts up a doorhanger,
// so a detection is seen without anyone asking for it.
//
// It only watches and names. Acting on what it finds is the user's part,
// with the keys (jump.captcha), as it is for the agent.

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
    if (!["frame", "script", "widget", "token", "honeypot"].includes(signal)) {
      return [];
    }
    return [
      {
        signal,
        name: text(detection.name, 64),
        kind: text(detection.kind, 64),
        challenge: detection.challenge === true,
        detail: text(detection.detail),
      },
    ];
  });
}

/**
 * One line for what a page holds, for the log and the doorhanger:
 * "reCAPTCHA (image, score); Kasada (sensor); 2 page widgets; token field
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
    .map(({ signal, name, kind, detail }) =>
      [signal, name ?? "", kind ?? "", detail ?? ""].join(":"),
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
   * @returns {{url: string, detections: object[], text: string, signature: string, at: number}|null}
   */
  lastFor(browser) {
    return this.#last.get(browser) ?? null;
  }

  /**
   * Called with the browser and the tab's merged finding when the finding
   * is new, after the log line and the doorhanger.
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
   * @param {{url: string, detections: object[], frame?: number, top?: boolean}} report
   * @returns {object|null} The tab's merged finding, or null when it holds
   *   nothing.
   */
  report(browser, { url, detections, frame = 0, top = true } = {}) {
    if (!browser) {
      return null;
    }
    detections = sanitize(detections);
    const frames = this.#frames.get(browser) ?? new Map();
    if (detections.length) {
      frames.set(frame, {
        url: text(url, MAX_URL) ?? "",
        detections,
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
    if (frames?.delete(frame)) {
      this.#recompute(browser);
    }
  }

  // Merge every frame's findings into the tab's, drop duplicates, and
  // announce the result if it changed since last time.
  #recompute(browser) {
    const frames = this.#frames.get(browser);
    const merged = [];
    const seen = new Set();
    let url = "";
    for (const entry of frames?.values() ?? []) {
      if (entry.top || !url) {
        url = entry.url;
      }
      for (const detection of entry.detections) {
        const key = signatureOf([detection]);
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(detection);
        }
      }
    }
    if (!merged.length) {
      this.#last.delete(browser);
      this.#announced.delete(browser);
      return null;
    }
    const signature = signatureOf(merged);
    const record = {
      url,
      detections: merged,
      text: describe(merged),
      signature,
      at: Date.now(),
    };
    this.#last.set(browser, record);
    // The same finding is not announced twice as frames re-report.
    if (this.#announced.get(browser) == signature) {
      return record;
    }
    this.#announced.set(browser, signature);
    console.log(`Zendia: CAPTCHA watch: ${record.text} [${record.url}]`);
    this.#notify(browser, record.text);
    for (const listener of this.#listeners) {
      try {
        listener(browser, record);
      } catch (e) {
        console.error("Zendia: CAPTCHA watch listener failed", e);
      }
    }
    return record;
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
