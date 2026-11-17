// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Inside the hidden page of a chat site the agent panel dictates with
// (ZendiaWebChatDictation): find the site's own dictation button, press it,
// and report what the site writes into its message box, which is what was
// said. Nothing is ever sent to the site: its send button is never pressed.
//
// The sites change their pages often, and translate them, so each control is
// looked for by the site's own markup first, then by what it is called.

import {
  clearInterval,
  clearTimeout,
  setInterval,
  setTimeout,
} from "resource://gre/modules/Timer.sys.mjs";

const MAX_TEXT = 20000;
// How long after the press a site that wants an account says so.
const LOGIN_CHECK_MS = 800;
const REPORT_DELAY_MS = 60;
const REPORT_EVERY_MS = 500;

// What dictation is called, in the languages the sites speak most, and
// the names of the microphone icon.
const MIC_WORDS =
  /dictat|dikte|diktier|dicter|dictar|dettat|\bmic\b|microphone|micr[oó]fono|microfone|mikrofon|микрофон|マイク|麦克风|麥克風|마이크|voice input|voice typing/i;
// The site's other voice buttons: a spoken conversation is not dictation.
const NOT_MIC_WORDS =
  /mode|start voice|\blive\b|speech-button|send|kirim|submit|cancel|stop|batal|berhenti/i;
// A button that would send the message to the site.
const SEND_WORDS =
  /\bsend\b|kirim|enviar|envoyer|senden|invia|verzend|отправ|送信|发送|傳送|전송/i;

const SITES = {
  gemini: {
    loginHosts: ["accounts.google.com"],
    composer: [
      "rich-textarea .ql-editor[contenteditable='true']",
      ".ql-editor[contenteditable='true']",
      "rich-textarea [contenteditable='true']",
      "[role='textbox'][contenteditable='true']",
    ],
    // Where what was said is read from: the box, even while the site makes
    // it read-only or hides it to listen.
    text: [
      "rich-textarea .ql-editor",
      ".ql-editor",
      "rich-textarea [contenteditable]",
      "[role='textbox'][contenteditable]",
    ],
    mic: [
      "speech-dictation-mic-button button",
      "button.speech_dictation_mic_button",
      "button[data-test-id*='mic' i]",
      "[data-test-id*='speech' i] button",
      "button:has(mat-icon[fonticon='mic'])",
      "button:has(mat-icon[data-mat-icon-name='mic'])",
    ],
    // Its microphone button stops what it starts.
    submit: [
      "speech-dictation-mic-button button",
      "button.speech_dictation_mic_button",
    ],
    cancel: [],
    signIn: [
      "a[href*='ServiceLogin']",
      "a[href*='accounts.google.com/signin']",
      "a[href*='accounts.google.com/v3/signin']",
    ],
    signedIn: [
      "a[href*='SignOutOptions']",
      "a[href*='accounts.google.com/SignOut']",
    ],
    loginDialog: [],
  },
  chatgpt: {
    loginHosts: ["auth.openai.com", "auth0.openai.com"],
    composer: [
      "#prompt-textarea[contenteditable='true']",
      "form[data-chatgpt-composer] .ProseMirror[contenteditable='true']",
      ".ProseMirror[contenteditable='true']",
      "textarea#prompt-textarea",
    ],
    text: [
      "#prompt-textarea",
      "form[data-chatgpt-composer] .ProseMirror",
      ".ProseMirror",
    ],
    mic: [
      "button[aria-label='Start dictation']",
      "button[aria-label='Dictate button']",
      "button[aria-label='Dictate']",
      "button[data-testid*='dictat' i]",
    ],
    submit: [
      "button[aria-label='Submit dictation']",
      "button[data-testid*='submit-dictation' i]",
    ],
    cancel: [
      "button[aria-label='Cancel dictation']",
      "button[aria-label='Stop dictation']",
      "button[data-testid*='cancel-dictation' i]",
    ],
    signIn: [
      "[data-testid='login-button']",
      "[data-testid='mobile-login-button']",
      "a[href*='auth.openai.com']",
    ],
    signedIn: [
      "[data-testid='accounts-profile-button']",
      "[data-testid='profile-button']",
    ],
    loginDialog: [
      "[role='dialog'] [data-testid='login-button']",
      "[role='dialog'] a[href*='auth']",
      "[data-testid='modal-no-auth-login']",
    ],
  },
};

function isShown(element) {
  if (!element?.isConnected || element.disabled) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// The first element a selector finds, a shown one if there is one.
function findAny(root, selectors) {
  let hiddenOne = null;
  for (const selector of selectors) {
    for (const element of root.querySelectorAll(selector)) {
      if (isShown(element)) {
        return element;
      }
      hiddenOne ??= element;
    }
  }
  return hiddenOne;
}

// An element as a line of a debugging log.
function describe(element) {
  if (!element) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  const attributes = [
    "id",
    "aria-label",
    "title",
    "data-testid",
    "data-test-id",
  ]
    .map(name => [name, element.getAttribute(name)])
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}="${value.slice(0, 60)}"`);
  const className = String(
    element.className?.baseVal ?? element.className ?? ""
  )
    .trim()
    .slice(0, 80);
  if (className) {
    attributes.push(`class="${className}"`);
  }
  const icon = element.querySelector?.("mat-icon");
  if (icon) {
    attributes.push(
      `icon="${icon.getAttribute("fonticon") ?? icon.textContent.trim()}"`
    );
  }
  const parent = element.parentElement?.localName;
  return `<${element.localName} ${attributes.join(" ")}> in <${parent}> at ${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
}

function findShown(root, selectors) {
  for (const selector of selectors) {
    for (const element of root.querySelectorAll(selector)) {
      if (isShown(element)) {
        return element;
      }
    }
  }
  return null;
}

// What a button says it is, its icon's name included.
function labelOf(element) {
  const parts = [
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("data-testid"),
    element.getAttribute("data-test-id"),
    element.getAttribute("mattooltip"),
    element.className?.baseVal ?? element.className,
  ];
  for (const icon of element.querySelectorAll("mat-icon")) {
    parts.push(
      icon.getAttribute("fonticon"),
      icon.getAttribute("data-mat-icon-name"),
      icon.textContent
    );
  }
  return parts.filter(part => typeof part == "string" && part).join(" ");
}

function isSendLike(element) {
  const testId = element.getAttribute("data-testid") ?? "";
  return (
    element.id == "composer-submit-button" ||
    /send-button/i.test(testId) ||
    /send-button/i.test(element.getAttribute("data-test-id") ?? "") ||
    element.classList.contains("send-button") ||
    SEND_WORDS.test(element.getAttribute("aria-label") ?? "") ||
    SEND_WORDS.test(element.getAttribute("title") ?? "")
  );
}

function buttonsIn(root) {
  return [...root.querySelectorAll("button, [role='button']")].filter(isShown);
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

function textOf(element) {
  const raw =
    element.localName == "textarea" ? element.value : element.innerText;
  return withoutControls(String(raw ?? "").replace(/\u00a0/g, " "))
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export class ZendiaDictationChild extends JSWindowActorChild {
  #site = null;
  #composer = null;
  // The buttons near the box before the press: the ones dictation shows are
  // the others.
  #before = new Set();
  // Where the microphone button was, for a site that turns it into another.
  #micAt = null;
  #baseline = "";
  #last = null;
  #observer = null;
  #interval = null;
  #reportTimer = null;

  receiveMessage({ name, data }) {
    const site = SITES[data?.site];
    if (!site || !this.document) {
      return { state: "loading" };
    }
    switch (name) {
      case "ZendiaDictation:Probe":
        return this.#probe(site);
      case "ZendiaDictation:Start":
        return this.#start(site);
      case "ZendiaDictation:Stop":
        return this.#stop(site);
      case "ZendiaDictation:Cancel":
        return this.#cancel(site, !!data.live);
      case "ZendiaDictation:Finish":
        this.#unwatch();
        this.#clear(site);
        return {};
    }
    return null;
  }

  didDestroy() {
    this.#unwatch();
  }

  #onLoginHost(site) {
    const host = this.contentWindow?.location.hostname ?? "";
    return site.loginHosts.some(
      login => host == login || host.endsWith(`.${login}`)
    );
  }

  #probe(site) {
    const document = this.document;
    const url = this.contentWindow?.location.href ?? "";
    if (this.#onLoginHost(site)) {
      return { state: "login", url };
    }
    const signedOut =
      !!findShown(document, site.signIn) && !findShown(document, site.signedIn);
    const composer = findShown(document, site.composer);
    const mic = composer && this.#findMic(site, composer);
    const found = {
      url,
      signedOut,
      composer: describe(composer),
      mic: describe(mic),
    };
    if (mic) {
      return { state: "ready", ...found };
    }
    if (signedOut && document.readyState == "complete") {
      return { state: "login", ...found };
    }
    return { state: "loading", ...found };
  }

  // The site's box, as it is now: the site may make it read-only, hide it
  // or swap it while it listens.
  #box(site) {
    return (
      findShown(this.document, site.composer) ??
      findAny(this.document, site.text) ??
      (this.#composer?.isConnected ? this.#composer : null)
    );
  }

  // The buttons around the box, for a debugging log.
  #buttonsNear(site) {
    const box = this.#box(site);
    const scope = box ? this.#scopeOf(box) : this.document.body;
    return scope ? buttonsIn(scope).map(describe) : [];
  }

  // The box's part of the page: its form, or what holds the box and its
  // buttons.
  #scopeOf(composer) {
    const form = composer.closest("form");
    if (form) {
      return form;
    }
    let node = composer.parentElement;
    for (let depth = 0; node && depth < 8; depth++) {
      if (buttonsIn(node).length >= 2) {
        return node;
      }
      node = node.parentElement;
    }
    return this.document.body ?? this.document.documentElement;
  }

  #findMic(site, composer) {
    const scope = this.#scopeOf(composer);
    for (const root of [scope, this.document]) {
      const known = findShown(root, site.mic);
      if (known && !isSendLike(known)) {
        return known;
      }
    }
    return (
      buttonsIn(scope).find(button => {
        const label = labelOf(button);
        return (
          MIC_WORDS.test(label) &&
          !NOT_MIC_WORDS.test(label) &&
          !isSendLike(button)
        );
      }) ?? null
    );
  }

  async #start(site) {
    const document = this.document;
    const composer = findShown(document, site.composer);
    const mic = composer && this.#findMic(site, composer);
    if (!mic) {
      return { ok: false };
    }
    this.#site = site;
    this.#composer = composer;
    this.#clear(site);
    // A draft the site would not let go of is not part of what is said.
    this.#baseline = textOf(composer);
    this.#before = new Set(buttonsIn(this.#scopeOf(composer)));
    const rect = mic.getBoundingClientRect();
    this.#micAt = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    this.#last = null;
    const pressed = describe(mic);
    const how = this.#press(mic);
    this.#watch();
    await new Promise(resolve => setTimeout(resolve, LOGIN_CHECK_MS));
    if (this.#onLoginHost(site) || findShown(document, site.loginDialog)) {
      this.#unwatch();
      return { ok: false, login: true, pressed, how };
    }
    return { ok: true, pressed, how, buttons: this.#buttonsNear(site) };
  }

  // The button that ends dictation and keeps what was said.
  #submitButton(site) {
    const document = this.document;
    const known = findShown(document, site.submit);
    if (known) {
      return known;
    }
    const composer = this.#box(site);
    if (composer) {
      // One the press showed, the last in reading order: a check mark after
      // the recording's waveform.
      const shown = buttonsIn(this.#scopeOf(composer)).filter(
        button =>
          !this.#before.has(button) &&
          !isSendLike(button) &&
          !site.cancel.some(selector => button.matches(selector))
      );
      const last = shown.at(-1);
      if (last) {
        return last;
      }
    }
    // The microphone button itself, turned into its stop button.
    if (this.#micAt) {
      const hit = document.elementFromPoint(this.#micAt.x, this.#micAt.y);
      const button = hit?.closest("button, [role='button']");
      if (button && isShown(button) && !isSendLike(button)) {
        return button;
      }
    }
    return null;
  }

  #stop(site) {
    const buttons = this.#buttonsNear(site);
    const button = this.#submitButton(site);
    if (!button) {
      return { pressed: false, buttons };
    }
    const described = describe(button);
    const how = this.#press(button);
    return { pressed: true, button: described, how, buttons };
  }

  #cancel(site, live) {
    const button = findShown(this.document, site.cancel);
    if (button && !isSendLike(button)) {
      this.#press(button);
    } else if (live && !site.cancel.length) {
      // A site whose microphone button is its only control: pressed while
      // it does not listen, it would start.
      const stop = this.#submitButton(site);
      if (stop) {
        this.#press(stop);
      }
    }
    this.#unwatch();
    this.#clear(site);
    return {};
  }

  // Press like a user would, so the site takes it as one and may ask for the
  // microphone; a plain click when something lies over the button.
  #press(element) {
    const window = this.contentWindow;
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = this.document.elementFromPoint(x, y);
    if (hit && (hit == element || element.contains(hit))) {
      window.synthesizeMouseEvent("mousemove", x, y, {});
      for (const type of ["mousedown", "mouseup"]) {
        window.synthesizeMouseEvent(type, x, y, { button: 0, clickCount: 1 });
      }
      return "mouse";
    }
    element.click();
    return `click (covered by ${describe(hit)})`;
  }

  // Empty the site's box, without focusing it: the page is hidden, the keys
  // stay in the agent's panel.
  #clear(site) {
    const composer = this.#box(site);
    if (!composer || !textOf(composer)) {
      return;
    }
    const window = this.contentWindow;
    try {
      if (composer.localName == "textarea") {
        composer.value = "";
      } else {
        const paragraph = this.document.createElement("p");
        paragraph.append(this.document.createElement("br"));
        composer.replaceChildren(paragraph);
      }
      composer.dispatchEvent(
        new window.InputEvent("input", {
          bubbles: true,
          inputType: "deleteContent",
        })
      );
    } catch (e) {
      console.error("Zendia: could not empty the dictation box", e);
    }
  }

  #report() {
    this.#reportTimer = null;
    const site = this.#site;
    if (!site) {
      return;
    }
    const composer = this.#box(site);
    let text = composer ? textOf(composer) : "";
    if (this.#baseline && text.startsWith(this.#baseline)) {
      text = text.slice(this.#baseline.length).trim();
    }
    text = text.slice(0, MAX_TEXT);
    if (text != this.#last) {
      this.#last = text;
      this.sendAsyncMessage("ZendiaDictation:Text", { text });
    }
  }

  #watch() {
    this.#unwatch();
    const window = this.contentWindow;
    const schedule = () => {
      this.#reportTimer ??= setTimeout(() => this.#report(), REPORT_DELAY_MS);
    };
    this.#observer = new window.MutationObserver(schedule);
    this.#observer.observe(this.document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    // The site may swap its box for another one the observer misses.
    this.#interval = setInterval(() => this.#report(), REPORT_EVERY_MS);
  }

  #unwatch() {
    this.#observer?.disconnect();
    this.#observer = null;
    clearInterval(this.#interval);
    this.#interval = null;
    clearTimeout(this.#reportTimer);
    this.#reportTimer = null;
  }
}
