// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Dictation for the agent's panel, done by a chat site's own speech to text:
// Gemini's, or ChatGPT's when Gemini cannot. The site runs in a page nobody
// sees, in the container (and so the account) the web chat panel uses for
// it, with the browser's logins copied in (ZendiaWebChatCookies). Its
// dictation button is pressed there (ZendiaDictationChild), the site asks
// for the microphone with the browser's own prompt, shown where a tab's
// is, and what it writes into its message box is what the panel gets.
// Nothing is sent to the site.
//
// A site that wants the user signed in first gets a tab of its own, in the
// same container, to do it in.
//
// The page is loaded once per window, when the panel first opens, and kept:
// the next dictation starts on the page as it is, without loading it again.
//
// To see the pages at work, set zendia.dictation.debug, or start the
// browser with ZENDIA_DICTATION_DEBUG=1 (npm run dev:dictation): they show
// in a corner of the window, and every step is logged to the terminal and
// the Browser Console.

import { clearTimeout, setTimeout } from "resource://gre/modules/Timer.sys.mjs";
import {
  BROWSER,
  accountsOf,
  identityName,
} from "resource:///modules/zendia/webchat/ZendiaWebChatAccounts.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  SitePermissions: "resource:///modules/SitePermissions.sys.mjs",
  ZENDIA_WEBCHATS: "resource:///modules/zendia/webchat/ZendiaWebChats.sys.mjs",
  chatHosts: "resource:///modules/zendia/webchat/ZendiaWebChats.sys.mjs",
  useWebChatContainer:
    "resource:///modules/zendia/webchat/ZendiaWebChatCookies.sys.mjs",
  webChatContainerId:
    "resource:///modules/zendia/webchat/ZendiaWebChatCookies.sys.mjs",
  webChats: "resource:///modules/zendia/webchat/ZendiaWebChats.sys.mjs",
  webrtcUI: "resource:///modules/webrtcUI.sys.mjs",
});

const HTML_NS = "http://www.w3.org/1999/xhtml";

/** The sites dictation is done with, the first one that can. */
export const DICTATION_SITES = ["gemini", "chatgpt"];

const PREF_ACCOUNTS = "zendia.webchat.accounts";
const ACTOR = "ZendiaDictation";
const SHARE_PROMPT = "webRTC-shareDevices";

const POLL_MS = 200;
const QUERY_TIMEOUT_MS = 5000;
// A site that has not shown its dictation button by then has none.
const READY_TIMEOUT_MS = 25000;
// A sign-in button can show before the rest of the page: it has to stay.
const LOGIN_SETTLE_MS = 2500;
// The press asked for no microphone, and no prompt is up.
const CONNECT_TIMEOUT_MS = 12000;
// The prompt went and no microphone came: the user said no.
const REFUSED_AFTER_MS = 3000;
// After the site's own stop was pressed, it may keep the microphone while
// it finishes; it is taken from it only after this long.
const STOP_GRACE_MS = 6000;
// A press that is no longer wanted: what the site may still get by then is
// taken.
const RELEASE_AFTER_MS = 2000;
// What the site writes after the microphone is off is done once it has not
// changed for this long.
const SETTLE_MS = 1500;
// The microphone is off and the site wrote nothing for this long.
const NOTHING_HEARD_MS = 8000;
const FINISH_TIMEOUT_MS = 20000;
const MAX_TEXT = 20000;

const PREF_DEBUG = "zendia.dictation.debug";
// Whether the page loads when the panel first opens, before the mic is
// pressed.
const PREF_PRELOAD = "zendia.dictation.preload";
const ENV_DEBUG = "ZENDIA_DICTATION_DEBUG";

/**
 * @returns {boolean} Whether the dictation's pages show, and its steps are
 *   logged.
 */
export function dictationDebug() {
  return (
    Services.prefs.getBoolPref(PREF_DEBUG, false) ||
    !!Services.env.get(ENV_DEBUG)
  );
}

// The Browser Console's view of the steps, while debugging.
let gConsole = null;

function log(...parts) {
  if (!dictationDebug()) {
    return;
  }
  const line = parts
    .map(part => (typeof part == "string" ? part : JSON.stringify(part)))
    .join(" ");
  dump(`[zendia dictation] ${line}\n`);
  gConsole ??= console.createInstance({
    prefix: "Zendia dictation",
    maxLogLevel: "All",
  });
  gConsole.log(line);
}

// Each hidden page's dictation, for its actor.
const gDictations = new WeakMap();

/**
 * @param {Element} browser
 * @returns {ZendiaWebChatDictation|null} The dictation the hidden page is
 *   for.
 */
export function dictationFor(browser) {
  return gDictations.get(browser) ?? null;
}

// Text without control characters, but for tabs and line breaks.
function withoutControls(text) {
  let out = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code == 9 || code == 10 || (code >= 32 && code != 127)) {
      out += char;
    }
  }
  return out;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("no answer")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export class ZendiaWebChatDictation {
  #window;
  #onState;
  #onText;
  #onFocusLost;
  #host = null;
  // The hidden page of each site: {site, container, browser, frame, label,
  // home, run}.
  #views = new Map();
  // The pages being made, so two callers get the same one.
  #making = new Map();
  #state = "idle";
  // The page in use, from the press on.
  #view = null;
  // Each start and cancel is a new run; what an older one still waits on is
  // dropped.
  #run = 0;
  #text = "";
  #textAt = 0;
  #note = "";
  #streamTimer = null;

  /**
   * @param {Window} window A browser window.
   * @param {object} options
   * @param {(status: {state: string, site: object|null, message: string,
   *   warning: boolean}) => void} options.onState
   * @param {(text: string) => void} options.onText What was said so far,
   *   all of it each time.
   * @param {() => void} [options.onFocusLost] The hidden page took the keys.
   */
  constructor(window, { onState, onText, onFocusLost }) {
    this.#window = window;
    this.#onState = onState;
    this.#onText = onText;
    this.#onFocusLost = onFocusLost;
    const onDebug = () => this.#syncDebug();
    Services.prefs.addObserver(PREF_DEBUG, onDebug);
    window.addEventListener(
      "unload",
      () => {
        Services.prefs.removeObserver(PREF_DEBUG, onDebug);
        this.#destroyAll();
      },
      { once: true }
    );
  }

  /**
   * Load the first site's page ahead of the first dictation, so it is ready
   * by the time the mic is pressed. It stays loaded with the window.
   */
  async warmUp() {
    // Not in tests, which must not reach the real site, unless asked.
    if (!Services.prefs.getBoolPref(PREF_PRELOAD, !Cu.isInAutomation)) {
      return;
    }
    const site = this.#siteOf(DICTATION_SITES[0]);
    if (this.#views.has(site.id) || this.#making.has(site.id)) {
      return;
    }
    try {
      await this.#viewFor(site);
    } catch (e) {
      console.error("Zendia: the dictation page did not load", e);
    }
  }

  /** @returns {"idle"|"connecting"|"listening"|"finishing"} */
  get state() {
    return this.#state;
  }

  get active() {
    return this.#state != "idle";
  }

  /** Whether the site's microphone prompt is up, waiting on the user. */
  get prompting() {
    return (
      this.#state == "connecting" &&
      !!this.#view &&
      !!this.#promptOf(this.#view.browser)
    );
  }

  /** The microphone button: start, finish, or give up connecting. */
  toggle() {
    if (this.#state == "idle") {
      this.start();
    } else if (this.#state == "connecting") {
      this.cancel();
    } else if (this.#state == "listening") {
      this.stop();
    }
  }

  async start() {
    if (this.#state != "idle") {
      return;
    }
    const run = ++this.#run;
    log("start");
    this.#allowPrompts();
    this.#text = "";
    this.#textAt = Date.now();
    this.#note = "";
    const failed = [];
    for (const id of DICTATION_SITES) {
      const site = this.#siteOf(id);
      // Why the next site is tried, when the first could not.
      const why = this.#note ? `${this.#note} · ` : "";
      this.#emit(
        "connecting",
        site,
        `${why}Connecting to ${site.name} dictation…`
      );
      let result;
      let view = null;
      try {
        view = await this.#viewFor(site);
        if (run != this.#run) {
          return;
        }
        result = await this.#begin(view, run);
      } catch (e) {
        console.error(`Zendia: ${site.name} dictation failed`, e);
        result = "unavailable";
      }
      if (run != this.#run) {
        return;
      }
      if (result == "listening") {
        return;
      }
      if (result == "refused" || result == "blocked") {
        this.#end();
        const host = this.#hostOf(site);
        this.#emit(
          "idle",
          null,
          result == "blocked"
            ? `The microphone is blocked for ${host}. Allow it in the site's permissions to dictate.`
            : `${host} was not allowed to use the microphone.`,
          { warning: true }
        );
        return;
      }
      failed.push({ site, result, container: view?.container ?? 0 });
      this.#destroyView(id);
    }
    this.#end();
    const login = failed.find(entry => entry.result == "login");
    if (login) {
      this.#window.openTrustedLinkIn(login.site.url, "tab", {
        userContextId: login.container,
      });
      this.#emit(
        "idle",
        null,
        `Sign in to ${login.site.name} in the tab that opened, then press the mic again.`,
        { warning: true }
      );
      return;
    }
    this.#emit(
      "idle",
      null,
      "Dictation is not available: neither Gemini nor ChatGPT showed its microphone button.",
      { warning: true }
    );
  }

  /** Finish: the site turns what it heard into text, which is kept. */
  async stop() {
    if (this.#state == "connecting") {
      this.cancel();
      return;
    }
    const view = this.#view;
    if (this.#state != "listening" || !view) {
      return;
    }
    const run = this.#run;
    this.#emit("finishing", view.site, `${view.site.name} is writing it down…`);
    let pressed = false;
    if (this.#hasMicrophone(view.browser)) {
      try {
        const result = await this.#query(view, "Stop");
        pressed = !!result?.pressed;
        log("stop:", result);
      } catch {
        // The page is going: the microphone is taken below.
      }
    } else {
      log("stop: the site had already let go of the microphone");
    }
    await this.#finish(view, run, { pressed });
  }

  /** Give up: nothing of what was said is kept. */
  cancel() {
    if (this.#state == "idle") {
      return;
    }
    const view = this.#view;
    this.#run++;
    if (view) {
      this.#cancelPage(view);
    }
    this.#text = "";
    this.#end();
    this.#emit("idle", null, "");
  }

  /**
   * A message from a hidden page's actor.
   *
   * @param {Element} browser
   * @param {string} name
   * @param {object} data
   */
  receive(browser, name, data) {
    if (
      name != "ZendiaDictation:Text" ||
      this.#state == "idle" ||
      this.#view?.browser != browser ||
      typeof data?.text != "string"
    ) {
      return;
    }
    const text = withoutControls(data.text.slice(0, MAX_TEXT));
    if (text == this.#text) {
      return;
    }
    this.#text = text;
    this.#textAt = Date.now();
    log(`text (${text.length}):`, text.slice(0, 200));
    this.#onText(text);
  }

  // The steps.

  // The site as the web chat panel has it, or as built in when the user
  // took it off the panel.
  #siteOf(id) {
    return (
      lazy.webChats().find(chat => chat.id == id) ??
      lazy.ZENDIA_WEBCHATS.find(chat => chat.id == id)
    );
  }

  #hostOf(site) {
    try {
      return new URL(site.url).host;
    } catch {
      return site.name;
    }
  }

  // Load the site, wait for its dictation button, press it and wait for the
  // microphone.
  async #begin(view, run) {
    const ready = await this.#waitReady(view, run);
    if (ready != "ready") {
      return ready;
    }
    if (this.#microphoneBlocked(view.browser)) {
      return "blocked";
    }
    // From here the page's prompt shows on the panel.
    this.#view = view;
    view.run = run;
    let started = null;
    try {
      started = await this.#query(view, "Start");
    } catch (e) {
      // The page went away under the press.
      log("start: no answer from the page", String(e));
    }
    log(`${view.site.name} pressed:`, started);
    if (run != this.#run) {
      this.#release(view, run);
      return "cancelled";
    }
    let result = "listening";
    if (started?.login) {
      result = "login";
    } else if (!started?.ok) {
      result = "unavailable";
    } else {
      result = await this.#waitForMicrophone(view, run);
      if (run != this.#run) {
        this.#release(view, run);
        return "cancelled";
      }
    }
    if (result != "listening") {
      this.#view = null;
      this.#release(view, run);
      return result;
    }
    this.#emit("listening", view.site, this.#listeningMessage(view.site));
    this.#watchMicrophone(view, run);
    return "listening";
  }

  // A press that is no longer wanted: the site stops, and the microphone it
  // may still get is taken from it.
  #release(view, run) {
    // A newer press on the same page has it now.
    if (view.run != run) {
      return;
    }
    this.#cancelPage(view);
    this.#dismissPrompt(view.browser);
    const check = () => {
      if (
        view.run == run &&
        this.#view != view &&
        this.#hasMicrophone(view.browser)
      ) {
        this.#revoke(view.browser);
      }
    };
    check();
    setTimeout(check, RELEASE_AFTER_MS);
  }

  #listeningMessage(site) {
    const why = this.#note ? ` (${this.#note})` : "";
    return `Speak now · ${site.name} is listening${why} · mic finishes · Enter sends`;
  }

  async #waitReady(view, run) {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let loginSince = 0;
    let last = "";
    while (Date.now() < deadline) {
      if (run != this.#run) {
        return "cancelled";
      }
      this.#activate(view);
      let probe = null;
      try {
        probe = await this.#query(view, "Probe");
      } catch {
        // Not loaded yet, or between two pages.
      }
      if (run != this.#run) {
        return "cancelled";
      }
      const seen = JSON.stringify(probe);
      if (seen != last) {
        last = seen;
        log(`${view.site.name} probe:`, probe ?? "no page yet");
      }
      if (probe?.state == "ready") {
        // Where the site settled: the page to come back to next time.
        view.home = view.browser.currentURI;
        return "ready";
      }
      if (probe?.state == "login") {
        loginSince ||= Date.now();
        if (Date.now() - loginSince >= LOGIN_SETTLE_MS) {
          this.#note ||= `${view.site.name} needs you signed in`;
          return "login";
        }
      } else {
        loginSince = 0;
      }
      await sleep(POLL_MS * 2);
    }
    if (loginSince) {
      this.#note ||= `${view.site.name} needs you signed in`;
      return "login";
    }
    this.#note ||= `${view.site.name} is not available`;
    return "unavailable";
  }

  async #waitForMicrophone(view, run) {
    const since = Date.now();
    let prompted = false;
    let promptGone = 0;
    while (run == this.#run) {
      if (this.#hasMicrophone(view.browser)) {
        log(`${view.site.name} has the microphone`);
        return "listening";
      }
      if (this.#promptOf(view.browser)) {
        if (!prompted) {
          log(`${view.site.name} asks for the microphone`);
          this.#emit(
            "connecting",
            view.site,
            `Allow ${this.#hostOf(view.site)} to use the microphone`
          );
        }
        prompted = true;
        promptGone = 0;
      } else if (prompted) {
        promptGone ||= Date.now();
        if (Date.now() - promptGone > REFUSED_AFTER_MS) {
          return "refused";
        }
      } else if (Date.now() - since > CONNECT_TIMEOUT_MS) {
        // A site that asks for an account only once the button is pressed.
        const probe = await this.#query(view, "Probe").catch(() => null);
        if (probe?.signedOut || probe?.state == "login") {
          this.#note ||= `${view.site.name} needs you signed in`;
          return "login";
        }
        this.#note ||= `${view.site.name} did not start listening`;
        return "unavailable";
      }
      await sleep(POLL_MS);
    }
    return "cancelled";
  }

  // The site stopped listening on its own: what it heard is the text.
  #watchMicrophone(view, run) {
    const tick = () => {
      if (run != this.#run || this.#state != "listening") {
        return;
      }
      if (!this.#hasMicrophone(view.browser)) {
        this.#emit(
          "finishing",
          view.site,
          `${view.site.name} is writing it down…`
        );
        this.#finish(view, run, { pressed: true });
        return;
      }
      this.#streamTimer = setTimeout(tick, POLL_MS);
    };
    this.#streamTimer = setTimeout(tick, POLL_MS);
  }

  async #finish(view, run, { pressed }) {
    clearTimeout(this.#streamTimer);
    const stoppedAt = Date.now();
    let revoked = false;
    // When the site let go of the microphone: it may write what it heard
    // only then.
    let offAt = 0;
    let why = "timed out";
    while (run == this.#run) {
      const now = Date.now();
      const live = this.#hasMicrophone(view.browser);
      if (live) {
        offAt = 0;
        // The site's stop did not take: the microphone goes anyway.
        if (!revoked && (!pressed || now - stoppedAt > STOP_GRACE_MS)) {
          log(`${view.site.name} still has the microphone: taking it`);
          this.#revoke(view.browser);
          revoked = true;
        }
      } else {
        if (!offAt) {
          offAt = now;
          log(`${view.site.name} let go of the microphone`);
        }
        if (this.#text && now - Math.max(this.#textAt, offAt) >= SETTLE_MS) {
          why = "the text settled";
          break;
        }
        if (!this.#text && now - offAt >= NOTHING_HEARD_MS) {
          why = "nothing was written";
          break;
        }
      }
      if (now - stoppedAt >= FINISH_TIMEOUT_MS) {
        break;
      }
      await sleep(POLL_MS);
    }
    if (run != this.#run) {
      return;
    }
    const site = view.site;
    const heard = !!this.#text;
    log(`finished: ${why}; ${this.#text.length} characters`);
    this.#run++;
    this.#end();
    this.#emit(
      "idle",
      null,
      heard ? "" : `${site.name} did not hear anything.`,
      {
        warning: !heard,
      }
    );
  }

  // Back to rest: the microphone off, the prompt gone, the site's box empty.
  #end() {
    clearTimeout(this.#streamTimer);
    const view = this.#view;
    this.#view = null;
    this.#state = "idle";
    if (view) {
      if (this.#hasMicrophone(view.browser)) {
        this.#revoke(view.browser);
      }
      this.#query(view, "Finish")
        .catch(() => {})
        .finally(() => this.#deactivate(view));
      this.#dismissPrompt(view.browser);
    }
  }

  #emit(state, site, message, { warning = false } = {}) {
    this.#state = state;
    log(`${state}:`, message || "-");
    this.#syncLabels();
    this.#onState({ state, site, message, warning });
  }

  // Debugging: the pages show, each with what it is doing.
  #syncDebug() {
    const debug = dictationDebug();
    this.#host?.toggleAttribute("debug", debug);
    this.#syncLabels();
  }

  #syncLabels() {
    if (!this.#host?.hasAttribute("debug")) {
      return;
    }
    for (const view of this.#views.values()) {
      const state = view == this.#view ? this.#state : "kept";
      view.label.textContent = `${view.site.name} · ${state} · ${view.browser.currentURI?.spec ?? ""}`;
    }
  }

  // The pages.

  // The container the web chat panel uses for the site's account in use:
  // its own, kept in step with the browser's logins, or the tab's.
  async #containerFor(site) {
    const tabContainer = this.#window.gBrowser.selectedTab.userContextId ?? 0;
    const { active } = accountsOf(
      Services.prefs.getStringPref(PREF_ACCOUNTS, ""),
      site.id
    );
    if (active == BROWSER) {
      return tabContainer;
    }
    try {
      const container = lazy.webChatContainerId(identityName(site.id, active));
      await lazy.useWebChatContainer({
        container,
        source: tabContainer,
        hosts: () => lazy.chatHosts(lazy.webChats()),
      });
      return container;
    } catch (e) {
      console.error("Zendia: the dictation container failed", e);
      return tabContainer;
    }
  }

  // The site's page, made once and kept; two callers at once get the same
  // one.
  #viewFor(site) {
    let making = this.#making.get(site.id);
    if (!making) {
      making = this.#makeView(site).finally(() => this.#making.delete(site.id));
      this.#making.set(site.id, making);
    }
    return making;
  }

  async #makeView(site) {
    const container = await this.#containerFor(site);
    let view = this.#views.get(site.id);
    if (view && (view.container != container || view.site.url != site.url)) {
      log(`${site.name}: another account or address, a new page`);
      this.#destroyView(site.id);
      view = null;
    }
    if (!view) {
      view = this.#createView(site, container);
      this.#views.set(site.id, view);
      log(`${site.name}: loading ${site.url} in container ${container}`);
      return view;
    }
    if (view.browser.webProgress?.isLoadingDocument) {
      log(`${site.name}: still loading, as it is`);
    } else if (this.#atHome(view)) {
      log(`${site.name}: kept page, as it is`, view.browser.currentURI.spec);
    } else {
      // A chat the site opened, or its sign-in, is no place to dictate.
      log(
        `${site.name}: the page moved to ${view.browser.currentURI?.spec}, loading it again`
      );
      this.#load(view);
    }
    return view;
  }

  // Whether the page is still where the site settled when it was ready, or
  // where it was loaded before that.
  #atHome(view) {
    const at = view.browser.currentURI;
    if (!at || at.spec == "about:blank") {
      return false;
    }
    const home = view.home ?? Services.io.newURI(view.site.url);
    return at.host == home.host && at.filePath == home.filePath;
  }

  #createView(site, container) {
    const document = this.#window.document;
    if (!this.#host?.isConnected) {
      this.#host = document.createElementNS(HTML_NS, "div");
      this.#host.className = "zendia-dictation-host";
      // Nothing of the page is for the user to see, or a screen reader.
      this.#host.setAttribute("aria-hidden", "true");
      this.#host.toggleAttribute("debug", dictationDebug());
      (
        document.getElementById("zen-tabbox-wrapper") ??
        document.getElementById("browser") ??
        document.documentElement
      ).append(this.#host);
    }
    const frame = document.createElementNS(HTML_NS, "div");
    frame.className = "zendia-dictation-view";
    // What the page is doing, shown only while debugging.
    const label = document.createElementNS(HTML_NS, "div");
    label.className = "zendia-dictation-label";
    label.textContent = site.name;
    const browser = document.createXULElement("browser");
    for (const [name, value] of Object.entries({
      type: "content",
      remote: "true",
      maychangeremoteness: "true",
      disableglobalhistory: "true",
      // Its own group: only the dictation's actor (and the microphone's)
      // runs in it, not the tabs' keys and menus.
      messagemanagergroup: "zendia-dictation",
      nodefaultsrc: "true",
      tabindex: "-1",
    })) {
      browser.setAttribute(name, value);
    }
    if (container) {
      browser.setAttribute("usercontextid", container);
    }
    // No anchor of its own: its prompt opens where a tab's does, on the
    // address bar's microphone icon.
    browser.className = "zendia-dictation-browser";
    frame.append(label, browser);
    this.#host.append(frame);
    // The page focusing its box must not take the keys from the panel; while
    // debugging, it may, to be looked at and used.
    browser.addEventListener("focus", () => {
      if (!dictationDebug()) {
        this.#onFocusLost?.();
      }
    });
    gDictations.set(browser, this);
    const view = { site, container, browser, frame, label, home: null };
    this.#load(view);
    return view;
  }

  #load(view) {
    view.home = null;
    view.browser.loadURI(Services.io.newURI(view.site.url), {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
  }

  // A page that is not active has its timers slowed down and its
  // animations stopped: the site would be slow to show its button.
  #activate(view) {
    try {
      if (!view.browser.docShellIsActive) {
        view.browser.docShellIsActive = true;
      }
    } catch {
      // No browsing context yet.
    }
  }

  #deactivate(view) {
    // While debugging the page stays drawn, to be watched.
    if (this.#view == view || dictationDebug()) {
      return;
    }
    try {
      view.browser.docShellIsActive = false;
    } catch {
      // The page is gone.
    }
  }

  #destroyView(id) {
    const view = this.#views.get(id);
    if (!view) {
      return;
    }
    this.#views.delete(id);
    if (this.#view == view) {
      this.#view = null;
    }
    gDictations.delete(view.browser);
    this.#dismissPrompt(view.browser);
    view.frame.remove();
  }

  #destroyAll() {
    for (const id of [...this.#views.keys()]) {
      this.#destroyView(id);
    }
  }

  #query(view, name, data = {}) {
    const actor =
      view.browser.browsingContext?.currentWindowGlobal?.getActor(ACTOR);
    if (!actor) {
      return Promise.reject(new Error("no page"));
    }
    return withTimeout(
      actor.sendQuery(`ZendiaDictation:${name}`, {
        ...data,
        site: view.site.id,
      }),
      QUERY_TIMEOUT_MS
    );
  }

  // Stop the site's dictation without keeping it. Its stop button is pressed
  // only while it listens: on a site whose microphone button does both, it
  // would start it otherwise.
  #cancelPage(view) {
    return this.#query(view, "Cancel", {
      live: this.#hasMicrophone(view.browser),
    }).catch(() => {});
  }

  // The microphone.

  // A window's PopupNotifications shows the prompts of the tab in front
  // only. The hidden page's prompt for the microphone is shown too, as a
  // tab's would be, while it dictates.
  #allowPrompts() {
    const popups = this.#window.PopupNotifications;
    if (!popups || popups._zendiaDictationPrompts) {
      return;
    }
    popups._zendiaDictationPrompts = true;
    const isActiveBrowser = popups._isActiveBrowser;
    popups._isActiveBrowser = browser =>
      (this.#state != "idle" && this.#view?.browser == browser) ||
      isActiveBrowser.call(popups, browser);
  }

  // Take the hidden page's prompt away, and show the tab's own prompts and
  // address bar icons again in its place.
  #dismissPrompt(browser) {
    const popups = this.#window.PopupNotifications;
    const prompt = popups?.getNotification(SHARE_PROMPT, browser);
    if (prompt) {
      prompt.remove();
      popups.anchorVisibilityChange();
    }
  }

  #promptOf(browser) {
    return (
      this.#window.PopupNotifications?.getNotification(SHARE_PROMPT, browser) ??
      null
    );
  }

  #microphoneBlocked(browser) {
    try {
      const { state } = lazy.SitePermissions.getForPrincipal(
        browser.contentPrincipal,
        "microphone",
        browser
      );
      return state == lazy.SitePermissions.BLOCK;
    } catch {
      return false;
    }
  }

  #hasMicrophone(browser) {
    const context = browser.browsingContext;
    if (!context || !lazy.webrtcUI.browserHasStreams(browser)) {
      return false;
    }
    return (
      lazy.webrtcUI.getCombinedStateForBrowser(context.top).microphone ==
      Ci.nsIMediaManagerService.STATE_CAPTURE_ENABLED
    );
  }

  // Take the microphone from the page, as the browser's own "stop sharing"
  // does.
  #revoke(browser) {
    for (const stream of lazy.webrtcUI._streams) {
      if (stream.topBrowsingContext.embedderElement != browser) {
        continue;
      }
      const global = stream.browsingContext.currentWindowGlobal;
      const windowId = stream.state.windowId ?? global?.innerWindowId;
      try {
        global
          ?.getActor("WebRTC")
          .sendAsyncMessage("webrtc:StopSharing", String(windowId));
      } catch (e) {
        console.error("Zendia: could not stop the dictation's microphone", e);
      }
    }
  }
}
