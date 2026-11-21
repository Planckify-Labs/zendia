// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Asking a chat site about a page (ZendiaWebChatAsk), from both ends.
//
// In a tab: what is selected and the paragraph it is in, the page's text as
// reader view reads it, an image or a video's frame, the images on screen
// labeled for the keys, and the field a selection was in, to put the reply
// back in its place.
//
// In a page of the web chat panel: the site's message box, filled the way a
// paste would and sent with its own button, whether the site is still
// writing, and its last reply. The sites change their pages often, so each
// control is looked for by the site's own markup first, then by what it is
// called.

import { clearTimeout, setTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { ZendiaDom } from "resource:///modules/zendia/core/ZendiaDom.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ContentDOMReference: "resource://gre/modules/ContentDOMReference.sys.mjs",
  ReaderMode: "moz-src:///toolkit/components/reader/ReaderMode.sys.mjs",
});

const HTML_NS = "http://www.w3.org/1999/xhtml";

const MAX_SELECTION = 200_000;
const MAX_PAGE = 400_000;
const MAX_REPLY = 200_000;
const MAX_CONTEXT = 1500;
// The longest side of an image drawn here, in pixels.
const MAX_SIDE = 4096;
const MIN_IMAGE = 48;
const MAX_MARKS = 30;
const MARK_KEYS = "123456789abcdefghijklmnopqrstuvwxyz";

const POLL_MS = 200;
// How long the site may keep its send button off, while an image uploads.
const SEND_TIMEOUT_MS = 45000;
// A site that shows no send button by then is sent to with Enter.
const ENTER_AFTER_MS = 2500;
// A paste this long may become a file of the site's own, not text.
const LONG_PASTE = 3000;
// How long a site may take to take a message in once it was sent.
const CONFIRM_SENT_MS = 4000;
// How long a site may take to show an image it was given, and one it took
// the paste of.
const ATTACH_SHOWN_MS = 2500;
const ATTACH_TAKEN_MS = 5000;
// How long an upload may take, and how long after the image shows one may
// start.
const UPLOAD_TIMEOUT_MS = 60000;
const UPLOAD_SETTLE_MS = 600;
// The files waiting in a site's box: their previews, and the buttons that take
// them out.
const FILES_IN_BOX =
  "img[src^='blob:'], img[src^='data:image'], [aria-label*='remove' i][aria-label*='file' i], [aria-label*='remove' i][aria-label*='image' i]";
// What sites show of a file they were given.
const ATTACHMENT_SIGNS = [
  "img[src^='blob:']",
  "img[src^='data:image']",
  "[style*='blob:']",
  "[data-testid*='attachment' i]",
  "[data-testid*='file-preview' i]",
  "[class*='attachment' i]",
  "[class*='file-preview' i]",
  "[class*='upload' i] img",
  "[aria-label*='remove' i][aria-label*='file' i]",
  "[aria-label*='remove' i][aria-label*='image' i]",
];

const SEND_WORDS =
  /\bsend\b|\bsubmit\b|kirim|enviar|envoyer|senden|invia|verzend|отправ|送信|发送|傳送|전송/i;
const STOP_WORDS =
  /\bstop\b|interrupt|berhenti|hentikan|arr[eê]ter|detener|anhalten|interrompi|停止|중지|остановить/i;
const NOT_SEND_WORDS =
  /attach|upload|file|lampir|voice|dictat|\bmic|search|tool|model|plus|add|more|stop|cancel/i;

const MAKE_TRANSFER = `(function (parts) {
  const transfer = new DataTransfer();
  for (const part of parts) {
    transfer.items.add(new File([part.bytes], part.name, { type: part.type }));
  }
  return transfer;
})`;

const DISPATCH_FILES = `(function (target, type, parts) {
  const transfer = ${MAKE_TRANSFER}(parts);
  let event;
  if (type == "paste") {
    event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    for (const file of transfer.files) {
      event.clipboardData.items.add(file);
    }
  } else {
    event = new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer: transfer,
    });
  }
  target.dispatchEvent(event);
  return event.defaultPrevented;
})`;

const BLOCK =
  "p, li, td, th, dd, dt, blockquote, pre, h1, h2, h3, h4, h5, h6, figcaption, article, section, div";

/**
 * The chat sites' own markup. Every list is tried in order; what none of them
 * finds is looked for by what it is called.
 */
const SITES = {
  chatgpt: {
    composer: [
      "#prompt-textarea[contenteditable='true']",
      "form[data-chatgpt-composer] .ProseMirror[contenteditable='true']",
      ".ProseMirror[contenteditable='true']",
      "textarea#prompt-textarea",
    ],
    send: [
      "button[data-testid='send-button']",
      "#composer-submit-button",
      "button[data-composer-submit]",
      "button[aria-label='Send prompt']",
    ],
    stop: [
      "button[data-testid='stop-button']",
      "button[aria-label='Stop streaming']",
      "button[data-composer-submit][aria-label='Stop generating']",
    ],
    streaming: [
      "[data-message-role='assistant'][data-assistant-content-started]:not([data-message-complete])",
    ],
    reply: [
      "[data-message-author-role='assistant'] .markdown",
      "[data-message-author-role='assistant']",
      "[data-message-role='assistant']",
    ],
  },
  claude: {
    composer: [
      "[data-testid='chat-input'] [contenteditable='true']",
      "[data-testid='chat-input'][contenteditable='true']",
      "div.ProseMirror[contenteditable='true']",
      "fieldset [contenteditable='true']",
    ],
    send: [
      "button[aria-label='Send message']",
      "button[aria-label='Send Message']",
      "button[data-testid='send-button']",
    ],
    stop: [
      "button[aria-label='Stop response']",
      "button[aria-label='Stop Response']",
      "button[data-testid='stop-button']",
    ],
    streaming: ["[data-is-streaming='true']"],
    reply: [
      "[data-is-streaming] .font-claude-response",
      ".font-claude-response",
      "[data-testid='assistant-message']",
    ],
  },
  gemini: {
    composer: [
      "rich-textarea .ql-editor[contenteditable='true']",
      ".ql-editor[contenteditable='true']",
      "rich-textarea [contenteditable='true']",
    ],
    send: [
      "button.send-button:not(.stop)",
      "button[aria-label='Send message']",
      "button[data-test-id='send-button']",
    ],
    stop: [
      "button.send-button.stop",
      "button[aria-label='Stop response']",
      "button[aria-label='Stop generating']",
    ],
    streaming: [],
    reply: [
      "model-response message-content",
      "model-response .markdown",
      ".model-response-text",
    ],
  },
  kimi: {
    composer: [
      ".chat-input-editor[contenteditable='true']",
      ".chat-input [contenteditable='true']",
      "[contenteditable='true'][role='textbox']",
      "textarea",
    ],
    send: [
      ".send-button-container:not(.disabled) .send-button",
      ".send-button",
      "[data-testid='msh-chatinput-send-button']",
    ],
    stop: [".send-button-container.stop", "[class*='stop-button']"],
    streaming: [],
    reply: [
      ".segment-assistant .markdown",
      ".chat-content-item-assistant .markdown",
      ".segment-assistant",
    ],
  },
  grok: {
    composer: [
      "div.tiptap[contenteditable='true']",
      ".ProseMirror[contenteditable='true']",
      "textarea[aria-label]",
      "textarea",
    ],
    send: [
      "button[data-testid='chat-submit']",
      "button[data-composer-action='send']",
      "button[type='submit'][aria-label='Submit']",
      "button[aria-label='Submit']",
      "button[type='submit']",
    ],
    stop: [
      "button[aria-label='Stop model response']",
      "button[data-composer-action='stop']",
    ],
    streaming: [],
    reply: [
      "[id^='response-'] .response-content-markdown",
      ".message-bubble .response-content-markdown",
      ".response-content-markdown",
    ],
  },
  deepseek: {
    composer: ["textarea#chat-input", "textarea"],
    send: [],
    stop: [],
    streaming: [],
    reply: [".ds-markdown"],
  },
  perplexity: {
    composer: [
      "#ask-input[contenteditable='true']",
      "div[contenteditable='true'][role='textbox']",
      "textarea",
    ],
    send: [
      "button[data-testid='submit-button']",
      "button[aria-label='Submit']",
    ],
    stop: [
      "button[data-testid='stop-generating-response-button']",
      "button[aria-label='Stop']",
    ],
    streaming: [],
    reply: ["[id^='markdown-content'] .prose", ".prose"],
  },
  copilot: {
    composer: [
      "textarea#userInput",
      "textarea[data-testid='composer-input']",
      "textarea",
    ],
    send: [
      "button[data-testid='submit-button']",
      "button[aria-label='Submit message']",
    ],
    stop: [
      "button[data-testid='stop-button']",
      "button[aria-label='Interrupt message']",
    ],
    streaming: [],
    reply: ["[data-content='ai-message']"],
  },
};

const GENERIC = {
  composer: [
    "[contenteditable='true'][role='textbox']",
    ".ProseMirror[contenteditable='true']",
    "[contenteditable='true']",
    "textarea",
  ],
  send: [],
  stop: [],
  streaming: [],
  reply: [
    "[data-message-author-role='assistant']",
    "[data-message-role='assistant']",
    "[class*='markdown']",
    ".prose",
  ],
};

function siteOf(id) {
  return SITES[id] ?? GENERIC;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function visible(element) {
  if (!element?.isConnected) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function enabled(element) {
  return (
    !element.disabled &&
    element.getAttribute("aria-disabled") != "true" &&
    !element.closest("[disabled], [aria-disabled='true']")
  );
}

function findShown(root, selectors) {
  for (const selector of selectors) {
    let found;
    try {
      found = root.querySelectorAll(selector);
    } catch {
      continue;
    }
    for (const element of found) {
      if (visible(element)) {
        return element;
      }
    }
  }
  return null;
}

function labelOf(element) {
  return [
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("data-testid"),
    element.getAttribute("data-test-id"),
    element.className?.baseVal ?? element.className,
  ]
    .filter(part => typeof part == "string" && part)
    .join(" ");
}

function buttonsIn(root) {
  return [...root.querySelectorAll("button, [role='button']")].filter(visible);
}

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
  if (!element) {
    return "";
  }
  const raw =
    element.localName == "textarea" || element.localName == "input"
      ? element.value
      : element.innerText;
  return withoutControls(String(raw ?? "").replace(/\u00a0/g, " "))
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// A reply's own text: its markdown when it has one, without the labels of
// the buttons in it (Copy, Learn more).
function replyText(element) {
  if (!element) {
    return "";
  }
  const body =
    element.querySelector(
      "[data-assistant-markdown-root], .markdown, [class*='markdown'], .prose"
    ) ?? element;
  const labels = new Set(
    [...body.querySelectorAll("button, [role='button']")]
      .map(button => textOf(button))
      .filter(Boolean)
  );
  return textOf(body)
    .split("\n")
    .filter(line => !labels.has(line.trim()))
    .join("\n")
    .trim();
}

function squash(text) {
  return String(text).replace(/\s+/g, "");
}

function isTextField(element) {
  return (
    element?.localName == "textarea" ||
    (element?.localName == "input" &&
      /^(text|search|url|email|tel|)$/i.test(element.type ?? ""))
  );
}

export class ZendiaWebChatChild extends JSWindowActorChild {
  // The field a selection that was asked about is in, to put the reply in
  // its place: {field, start, end} for a text field, {host, range} for an
  // editable element.
  #target = null;
  // The images labeled for the keys, by label.
  #marked = new Map();
  #marks = null;
  #sandbox = null;

  receiveMessage({ name, data }) {
    if (!this.document) {
      return null;
    }
    switch (name) {
      case "ZendiaWebChat:Selection":
        return this.#selection(!!data?.remember);
      case "ZendiaWebChat:Page":
        return this.#page();
      case "ZendiaWebChat:Image":
        return this.#image(data ?? {});
      case "ZendiaWebChat:MarkImages":
        return this.#markImages();
      case "ZendiaWebChat:UnmarkImages":
        this.#unmark();
        return null;
      case "ZendiaWebChat:Replace":
        return this.#replace(String(data?.text ?? ""));
      case "ZendiaWebChat:HasTarget":
        return this.#hasTarget();
      case "ZendiaWebChat:Probe":
        return this.#probe(siteOf(data?.site));
      case "ZendiaWebChat:Compose":
        return this.#compose(siteOf(data?.site), data ?? {});
      case "ZendiaWebChat:Reply":
        return { text: this.#lastReply(siteOf(data?.site)) };
    }
    return null;
  }

  didDestroy() {
    this.#unmark();
  }

  // The page.

  #where() {
    const document = this.document;
    return {
      title: document.title ?? "",
      url: document.URL,
      lang: document.documentElement?.lang ?? "",
    };
  }

  #selection(remember) {
    const window = this.contentWindow;
    const document = this.document;
    const field = ZendiaDom.deepActiveElement(document);
    let text = "";
    let editable = false;
    let anchor = null;
    if (isTextField(field) && field.selectionStart != field.selectionEnd) {
      const start = field.selectionStart;
      const end = field.selectionEnd;
      text = field.value.slice(start, end);
      editable = !field.readOnly && !field.disabled;
      anchor = field;
      if (remember && editable) {
        this.#target = { field: Cu.getWeakReference(field), start, end };
      }
    } else {
      const selection = window.getSelection();
      text = selection?.toString() ?? "";
      if (text && selection.rangeCount) {
        const range = selection.getRangeAt(0);
        const node = range.commonAncestorContainer;
        anchor = node.nodeType == node.ELEMENT_NODE ? node : node.parentElement;
        const host = anchor?.closest("[contenteditable]");
        editable = !!host?.isContentEditable;
        if (remember && editable) {
          this.#target = {
            host: Cu.getWeakReference(host),
            range: range.cloneRange(),
          };
        }
      }
    }
    if (remember && !editable) {
      this.#target = null;
    }
    let context = "";
    const block = anchor?.closest?.(BLOCK);
    if (block && !isTextField(anchor)) {
      context = textOf(block).slice(0, MAX_CONTEXT);
    } else if (isTextField(anchor)) {
      context = anchor.value.slice(0, MAX_CONTEXT);
    }
    return {
      ...this.#where(),
      text: withoutControls(text).slice(0, MAX_SELECTION),
      context,
      editable,
    };
  }

  async #page() {
    const document = this.document;
    const where = this.#where();
    let text = "";
    let byline = "";
    const watch = this.#youtube();
    if (watch) {
      text = watch;
    } else {
      try {
        const article = await lazy.ReaderMode.parseDocument(document);
        if (article?.textContent?.trim().length > 200) {
          text = article.textContent;
          byline = article.byline ?? "";
          if (article.title) {
            where.title = article.title;
          }
        }
      } catch (e) {
        console.warn("Zendia: reader view could not read the page", e);
      }
    }
    if (!text) {
      text = textOf(document.body ?? document.documentElement);
    }
    text = withoutControls(text)
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n\s*\n+/g, "\n\n")
      .trim();
    return {
      ...where,
      byline,
      text: text.slice(0, MAX_PAGE),
      selection:
        this.contentWindow.getSelection()?.toString().slice(0, 1) ?? "",
    };
  }

  // A video's page: its title, description and, when the page shows it, its
  // transcript.
  #youtube() {
    const document = this.document;
    const { hostname, pathname } = this.contentWindow.location;
    if (!/(^|\.)youtube\.com$/.test(hostname) || pathname != "/watch") {
      return "";
    }
    const parts = [];
    const description = document.querySelector(
      "#description-inline-expander, #description"
    );
    if (description) {
      parts.push(`Description:\n${textOf(description)}`);
    }
    const segments = [
      ...document.querySelectorAll(
        "ytd-transcript-segment-renderer, transcript-segment-view-model"
      ),
    ]
      .map(segment => textOf(segment).replace(/\s*\n\s*/g, " "))
      .filter(Boolean);
    if (segments.length) {
      parts.push(`Transcript:\n${segments.join("\n")}`);
    } else {
      parts.push(
        "(The page does not show the transcript. Open it under the description for a fuller answer.)"
      );
    }
    return parts.join("\n\n");
  }

  // Images.

  async #image({ targetIdentifier, mark }) {
    let element = null;
    if (mark) {
      element = this.#marked.get(mark)?.get() ?? null;
    } else if (targetIdentifier) {
      try {
        element = lazy.ContentDOMReference.resolve(targetIdentifier);
      } catch {
        element = null;
      }
    }
    if (!element?.isConnected) {
      return null;
    }
    const window = this.contentWindow;
    const rect = element.getBoundingClientRect();
    const result = {
      src: element.currentSrc || element.src || "",
      alt: element.alt ?? element.getAttribute("aria-label") ?? "",
      video: element.localName == "video",
      // In the page and in the viewport, CSS pixels.
      rect: {
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
      },
      view: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      bytes: null,
      type: "",
    };
    try {
      const drawn = await this.#draw(element);
      if (drawn) {
        result.bytes = await drawn.arrayBuffer();
        result.type = drawn.type;
      }
    } catch (e) {
      // From another site without CORS: the parent takes it another way.
    }
    return result;
  }

  // The element's pixels as a file, when the page lets them be read.
  async #draw(element) {
    const document = this.document;
    let width;
    let height;
    switch (element.localName) {
      case "video":
        width = element.videoWidth;
        height = element.videoHeight;
        break;
      case "canvas":
        width = element.width;
        height = element.height;
        break;
      case "img":
        if (!element.complete) {
          return null;
        }
        width = element.naturalWidth;
        height = element.naturalHeight;
        break;
      default:
        return null;
    }
    if (!width || !height) {
      return null;
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const canvas = document.createElementNS(HTML_NS, "canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas
      .getContext("2d")
      .drawImage(element, 0, 0, canvas.width, canvas.height);
    const photo = element.localName == "video" || width * height > 2_000_000;
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob(
          blob => resolve(blob),
          photo ? "image/jpeg" : "image/png",
          0.92
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  // A label on each image on screen, for the keys to pick one.
  #markImages() {
    this.#unmark();
    const window = this.contentWindow;
    const document = this.document;
    const found = [];
    for (const element of document.querySelectorAll("img, video, canvas")) {
      const rect = element.getBoundingClientRect();
      if (
        rect.width < MIN_IMAGE ||
        rect.height < MIN_IMAGE ||
        rect.bottom < 0 ||
        rect.right < 0 ||
        rect.top > window.innerHeight ||
        rect.left > window.innerWidth ||
        !element.checkVisibility({ visibilityProperty: true })
      ) {
        continue;
      }
      found.push({ element, rect });
    }
    found.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const layer = document.createElementNS(HTML_NS, "div");
    layer.style.cssText =
      "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
    const marks = [];
    for (const [index, { element, rect }] of found
      .slice(0, MAX_MARKS)
      .entries()) {
      const key = MARK_KEYS[index];
      this.#marked.set(key, Cu.getWeakReference(element));
      const badge = document.createElementNS(HTML_NS, "div");
      badge.textContent = key;
      badge.style.cssText =
        `all: initial; position: fixed; left: ${Math.max(0, rect.left) + 6}px; ` +
        `top: ${Math.max(0, rect.top) + 6}px; min-width: 20px; padding: 2px 6px; ` +
        "box-sizing: border-box; border-radius: 6px; background: #ffc777; color: #1b1d2b; " +
        "font: 700 14px/18px ui-monospace, monospace; text-align: center; " +
        "box-shadow: 0 1px 6px rgba(0, 0, 0, 0.45);";
      const outline = document.createElementNS(HTML_NS, "div");
      outline.style.cssText =
        `all: initial; position: fixed; left: ${rect.left}px; top: ${rect.top}px; ` +
        `width: ${rect.width}px; height: ${rect.height}px; box-sizing: border-box; ` +
        "border: 2px solid #ffc777; border-radius: 4px;";
      layer.append(outline, badge);
      marks.push({
        key,
        alt: String(
          element.alt ||
            element.getAttribute("aria-label") ||
            element.title ||
            ""
        ).slice(0, 120),
        src: String(element.currentSrc || element.src || "").slice(0, 2048),
        kind: element.localName,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }
    if (marks.length) {
      document.documentElement.append(layer);
      this.#marks = layer;
    }
    return marks;
  }

  #unmark() {
    this.#marks?.remove();
    this.#marks = null;
  }

  // The field asked about.

  #hasTarget() {
    const target = this.#target;
    return !!(
      target?.field?.get()?.isConnected || target?.host?.get()?.isConnected
    );
  }

  #replace(text) {
    const target = this.#target;
    const document = this.document;
    const field = target?.field?.get();
    if (field?.isConnected) {
      field.focus();
      const end = Math.min(target.end, field.value.length);
      field.setSelectionRange(Math.min(target.start, end), end);
      if (!document.execCommand("insertText", false, text)) {
        field.setRangeText(
          text,
          field.selectionStart,
          field.selectionEnd,
          "end"
        );
        field.dispatchEvent(
          new this.contentWindow.InputEvent("input", {
            bubbles: true,
            inputType: "insertReplacementText",
          })
        );
      }
      // Asked again, the reply replaces this one.
      target.end = target.start + text.length;
      return { ok: true };
    }
    const host = target?.host?.get();
    if (host?.isConnected) {
      host.focus();
      const selection = this.contentWindow.getSelection();
      selection.removeAllRanges();
      selection.addRange(target.range);
      document.execCommand("insertText", false, text);
      this.#target = null;
      return { ok: true };
    }
    return { ok: false };
  }

  // A page of the web chat panel.

  #composer(site) {
    const document = this.document;
    const known = findShown(document, site.composer);
    if (known) {
      return known;
    }
    // The largest box that can be typed in.
    let best = null;
    let bestArea = 0;
    for (const element of document.querySelectorAll(
      "textarea, [contenteditable='true']"
    )) {
      if (
        !visible(element) ||
        element.parentElement?.closest("[contenteditable='true']")
      ) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      const area = rect.width * Math.max(rect.height, 24);
      if (area > bestArea) {
        best = element;
        bestArea = area;
      }
    }
    return best;
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

  #generating(site, composer) {
    const document = this.document;
    if (findShown(document, site.stop) || findShown(document, site.streaming)) {
      return true;
    }
    if (!composer) {
      return false;
    }
    return buttonsIn(this.#scopeOf(composer)).some(button =>
      STOP_WORDS.test(labelOf(button))
    );
  }

  #replies(site) {
    const document = this.document;
    for (const selector of site.reply) {
      let found;
      try {
        found = [...document.querySelectorAll(selector)];
      } catch {
        continue;
      }
      if (found.length) {
        return found;
      }
    }
    return [];
  }

  #lastReply(site) {
    const replies = this.#replies(site);
    return replyText(replies.at(-1)).slice(0, MAX_REPLY);
  }

  #probe(site) {
    const composer = this.#composer(site);
    const replies = this.#replies(site);
    return {
      url: this.document.URL,
      ready: !!composer,
      draft: composer ? textOf(composer).length : 0,
      // Files waiting in the box, which a new chat leaves behind.
      files: composer
        ? this.#scopeOf(composer).querySelectorAll(FILES_IN_BOX).length
        : 0,
      generating: this.#generating(site, composer),
      replies: replies.length,
      reply: replyText(replies.at(-1)).slice(0, MAX_REPLY),
    };
  }

  #sendButton(site, composer) {
    const document = this.document;
    const scope = this.#scopeOf(composer);
    for (const root of [scope, document]) {
      const known = findShown(root, site.send);
      if (known && !STOP_WORDS.test(labelOf(known))) {
        return known;
      }
    }
    const buttons = buttonsIn(scope);
    return (
      buttons.find(
        button =>
          SEND_WORDS.test(labelOf(button)) &&
          !STOP_WORDS.test(labelOf(button)) &&
          !NOT_SEND_WORDS.test(labelOf(button).replace(SEND_WORDS, ""))
      ) ??
      buttons.find(
        button =>
          button.getAttribute("type") == "submit" &&
          !STOP_WORDS.test(labelOf(button))
      ) ??
      null
    );
  }

  #caretAtEnd(composer) {
    composer.focus({ preventScroll: true });
    if (composer.localName == "textarea" || composer.localName == "input") {
      const end = composer.value.length;
      composer.setSelectionRange(end, end);
      return;
    }
    const selection = this.contentWindow.getSelection();
    selection.selectAllChildren(composer);
    selection.collapseToEnd();
  }

  #clear(composer) {
    if (!textOf(composer)) {
      return;
    }
    const document = this.document;
    this.#caretAtEnd(composer);
    if (composer.localName == "textarea") {
      composer.select();
    } else {
      this.contentWindow.getSelection().selectAllChildren(composer);
    }
    if (!document.execCommand("delete", false) || textOf(composer)) {
      if (composer.localName == "textarea") {
        composer.value = "";
      } else {
        const paragraph = document.createElement("p");
        paragraph.append(document.createElement("br"));
        composer.replaceChildren(paragraph);
      }
      composer.dispatchEvent(
        new this.contentWindow.InputEvent("input", {
          bubbles: true,
          inputType: "deleteContent",
        })
      );
    }
  }

  // A paste of the text, which the sites' editors take as the user's; the
  // editor's own insert when the site lets it through.
  async #insertText(site, composer, text) {
    const window = this.contentWindow;
    const document = this.document;
    const before = squash(textOf(composer));
    const probe = squash(text).slice(0, 40);
    const isIn = () => {
      const box = this.#composer(site) ?? composer;
      const after = squash(textOf(box));
      return after != before && after.includes(probe);
    };
    this.#caretAtEnd(composer);
    if (composer.localName != "textarea" && composer.localName != "input") {
      const paste = new window.ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataType: "text/plain",
        data: text,
      });
      composer.dispatchEvent(paste);
      if (isIn()) {
        return true;
      }
      if (paste.defaultPrevented) {
        // Some editors put the paste in a moment later.
        await sleep(POLL_MS);
        if (isIn()) {
          return true;
        }
        // A site that turns a long paste into a file of its own has it, and
        // the text is not in its box.
        if (text.length > LONG_PASTE) {
          return true;
        }
        // An editor that took the paste without a place to put it, in a
        // page that does not have the focus.
        composer = this.#composer(site) ?? composer;
        this.#caretAtEnd(composer);
      }
    }
    if (document.execCommand("insertText", false, text)) {
      return squash(textOf(composer)).includes(probe);
    }
    if (composer.localName == "textarea") {
      composer.value += text;
      composer.dispatchEvent(
        new window.InputEvent("input", {
          bubbles: true,
          inputType: "insertFromPaste",
        })
      );
      return true;
    }
    return false;
  }

  // A function run with the page's own principal: what privileged code puts
  // in a DataTransfer is hidden from the page, so the site would see an
  // empty paste.
  #inPage(source) {
    const window = this.contentWindow;
    this.#sandbox ??= Cu.Sandbox(window, {
      sandboxPrototype: window,
      sameZoneAs: window,
      wantXrays: false,
    });
    return Cu.evalInSandbox(source, this.#sandbox);
  }

  // Paste, or drop, the files on an element, as the page's own events.
  #dispatchFiles(target, type, files) {
    const dispatch = this.#inPage(DISPATCH_FILES);
    return dispatch(
      Cu.waiveXrays(target),
      type,
      Cu.cloneInto(files, this.#sandbox)
    );
  }

  // How much a site shows of the files given to it: their previews, their
  // names, its own chips for them. Only a change in it means anything.
  #attachments(names) {
    const document = this.document;
    let count = 0;
    for (const selector of ATTACHMENT_SIGNS) {
      try {
        count += document.querySelectorAll(selector).length;
      } catch {
        // A selector this engine does not know.
      }
    }
    const text = document.body?.innerText ?? "";
    for (const name of names) {
      count += text.split(name).length - 1;
    }
    return count;
  }

  async #shown(names, before, ms) {
    for (let waited = 0; waited < ms; waited += POLL_MS) {
      await sleep(POLL_MS);
      if (this.#attachments(names) > before) {
        return true;
      }
    }
    return false;
  }

  // An upload the site still shows going on beside its box.
  #uploading(composer) {
    const scope = this.#scopeOf(composer);
    return [
      ...scope.querySelectorAll(
        "[role='progressbar'], progress, [aria-busy='true'], [class*='spinner' i], [class*='uploading' i], [data-state='uploading']"
      ),
    ].some(visible);
  }

  // The files as the site's own: pasted, else chosen with its file input,
  // else dropped on the box. Each way counts only once the site shows the
  // file: a site may take a paste and do nothing with it, the more so while
  // it is still starting up.
  async #attach(site, composer, files) {
    const window = this.contentWindow;
    const names = files.map(file => file.name);
    const ways = [
      [
        "paste",
        box => {
          this.#caretAtEnd(box);
          return this.#dispatchFiles(box, "paste", files);
        },
      ],
      [
        "input",
        box => {
          const input =
            this.#scopeOf(box).querySelector(
              "input[type='file']:not([accept]), input[type='file'][accept*='image']"
            ) ?? this.document.querySelector("input[type='file']");
          if (!input) {
            return false;
          }
          const transfer = this.#inPage(MAKE_TRANSFER)(
            Cu.cloneInto(files, this.#sandbox)
          );
          input.files = transfer.files;
          for (const type of ["input", "change"]) {
            input.dispatchEvent(new window.Event(type, { bubbles: true }));
          }
          return true;
        },
      ],
      [
        "drop",
        box => {
          for (const type of ["dragenter", "dragover", "drop"]) {
            this.#dispatchFiles(box, type, files);
          }
          return true;
        },
      ],
    ];
    for (const [way, give] of ways) {
      const box = this.#composer(site) ?? composer;
      const before = this.#attachments(names);
      let taken;
      try {
        taken = give(box);
      } catch (e) {
        console.warn(`Zendia: giving the image by ${way} failed`, e);
        continue;
      }
      if (!taken && way != "paste") {
        continue;
      }
      // A site that took the paste may be slow to show it: given another way
      // too soon, it would get the image twice.
      if (
        await this.#shown(
          names,
          before,
          taken && way == "paste" ? ATTACH_TAKEN_MS : ATTACH_SHOWN_MS
        )
      ) {
        return way;
      }
    }
    return null;
  }

  // Until the site is done taking the files in: its send button may be on
  // while they upload, and what it sends then goes without them.
  async #uploaded(site, composer) {
    await sleep(UPLOAD_SETTLE_MS);
    const started = Date.now();
    while (Date.now() - started < UPLOAD_TIMEOUT_MS) {
      if (!this.#uploading(this.#composer(site) ?? composer)) {
        return;
      }
      await sleep(POLL_MS);
    }
  }

  #pressEnter(composer) {
    const window = this.contentWindow;
    composer.focus({ preventScroll: true });
    const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(
      Ci.nsITextInputProcessor
    );
    if (!tip.beginInputTransactionForTests(window)) {
      return false;
    }
    const event = new window.KeyboardEvent("", {
      key: "Enter",
      code: "Enter",
      keyCode: window.KeyboardEvent.DOM_VK_RETURN,
    });
    tip.keydown(event);
    tip.keyup(event);
    return true;
  }

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
    } else {
      element.click();
    }
  }

  // Sent is when the box empties or the reply starts. A site that only
  // asks the user to sign in when it is sent keeps the text in its box.
  async #confirmSent(site, result) {
    for (let waited = 0; waited < CONFIRM_SENT_MS; waited += POLL_MS) {
      await sleep(POLL_MS);
      const composer = this.#composer(site);
      if (
        !composer ||
        !textOf(composer) ||
        this.#generating(site, composer) ||
        this.#replies(site).length > result.before
      ) {
        return { ok: true, sent: true, ...result };
      }
    }
    return { ok: true, sent: false, reason: "not-sent", ...result };
  }

  async #compose(
    site,
    { text = "", files = [], send = true, clear = false, focus = false }
  ) {
    let composer = this.#composer(site);
    if (!composer) {
      return { ok: false, reason: "no-composer" };
    }
    const before = this.#replies(site).length;
    if (clear) {
      this.#clear(composer);
    }
    let attached = null;
    if (files.length) {
      // Null when the site took it no way: most often it wants the user
      // signed in.
      attached = await this.#attach(site, composer, files);
      composer = this.#composer(site) ?? composer;
      if (attached) {
        await this.#uploaded(site, composer);
        composer = this.#composer(site) ?? composer;
      }
    }
    if (text && !(await this.#insertText(site, composer, text))) {
      return { ok: false, reason: "no-insert", attached };
    }
    // A question about an image the site did not take waits for the user.
    if (files.length && !attached) {
      this.#caretAtEnd(this.#composer(site) ?? composer);
      return { ok: true, sent: false, attached, reason: "no-attach" };
    }
    if (!send) {
      if (focus) {
        this.#caretAtEnd(this.#composer(site) ?? composer);
      }
      return { ok: true, sent: false, attached };
    }
    const started = Date.now();
    let timer = null;
    try {
      while (Date.now() - started < SEND_TIMEOUT_MS) {
        composer = this.#composer(site) ?? composer;
        const button = this.#sendButton(site, composer);
        if (button && enabled(button)) {
          this.#press(button);
          const result = await this.#confirmSent(site, {
            how: "button",
            attached,
            before,
          });
          // A press the site did not take, Enter may.
          if (
            !result.sent &&
            this.#pressEnter(this.#composer(site) ?? composer)
          ) {
            return this.#confirmSent(site, { how: "enter", attached, before });
          }
          return result;
        }
        if (!button && !files.length && Date.now() - started > ENTER_AFTER_MS) {
          if (!this.#pressEnter(composer)) {
            return { ok: false, reason: "no-send", attached };
          }
          return this.#confirmSent(site, { how: "enter", attached, before });
        }
        await new Promise(resolve => {
          timer = setTimeout(resolve, POLL_MS);
        });
      }
    } finally {
      clearTimeout(timer);
    }
    return { ok: false, reason: "no-send", attached };
  }
}
