// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Asking a chat site of the web chat panel about something on a page: a
// selection, an image, a video's frame, a link, the page, a part of the
// screen or several tabs. What it is about is gathered here, made into a
// prompt (ZendiaWebChatPrompts) and handed to the panel, which writes it into
// the site's box and sends it (ZendiaWebChatDock.ask).
//
// The page's menu (ZendiaWebChatMenu) and the keys (ZendiaWebChat's actions)
// both ask through here.

import { clearTimeout, setTimeout } from "resource://gre/modules/Timer.sys.mjs";
import {
  askPrompt,
  isImageKind,
  labelOf,
  languageChoices,
  languageName,
  parseRecentLanguages,
  promptsFor,
  render,
  templateValues,
  usesLanguage,
  webChatPrompts,
  withRecentLanguage,
} from "resource:///modules/zendia/webchat/ZendiaWebChatPrompts.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  NetUtil: "resource://gre/modules/NetUtil.sys.mjs",
  ReaderMode: "moz-src:///toolkit/components/reader/ReaderMode.sys.mjs",
  ZendiaPicker: "resource:///modules/zendia/ui/ZendiaPicker.sys.mjs",
  pickRegion: "resource:///modules/zendia/ui/ZendiaRegionPicker.sys.mjs",
});

const HTML_NS = "http://www.w3.org/1999/xhtml";

export const PREF_PROMPTS = "zendia.webchat.prompts";
export const PREF_LANGUAGES = "zendia.webchat.translate.recent";

const ACTOR = "ZendiaWebChat";
// The images every site takes as they are; others are sent as the screen
// shows them.
const SITE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
// The most pixels a picture of the screen has.
const MAX_PIXELS = 16_000_000;
const MAX_TABS = 12;

/**
 * Something on a page to ask about.
 *
 * @typedef {object} ZendiaAskWhat
 * @property {string} kind One of the prompts' KINDS.
 * @property {string} [text] The selection, or an image's alt text.
 * @property {string} [context] The paragraph the selection is in.
 * @property {string} [title] The page's title.
 * @property {string} [url] The page's address.
 * @property {string} [page] The page's text.
 * @property {Array<object>} [tabs] Each tab's {title, url, text}.
 * @property {Array<{name: string, type: string, bytes: ArrayBuffer}>} [files]
 *   The images to attach.
 * @property {string} topic The page it is about, which keeps its own chat.
 * @property {{browser: Element, frame: number}} [field] The field the text
 *   is in, for the reply to go back to.
 */

function text(value, max) {
  return typeof value == "string" ? value.slice(0, max) : "";
}

// A page's address without its fragment: the same page wherever it is
// scrolled to.
function topicOf(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return String(url ?? "");
  }
}

function extensionOf(type) {
  return (
    {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
    }[type] ?? "png"
  );
}

// A name of its own, so a chat site showing it is told from what it showed
// before.
function fileName(base, type) {
  const tag = Math.random().toString(36).slice(2, 7);
  return `${base}-${tag}.${extensionOf(type)}`;
}

function actorIn(context) {
  const global = context?.currentWindowGlobal;
  if (!global) {
    throw new Error("Zendia: the page is gone");
  }
  return global.getActor(ACTOR);
}

/** The prompts as the user has them. */
export function prompts() {
  return webChatPrompts(Services.prefs.getStringPref(PREF_PROMPTS, ""));
}

/**
 * The browser's own language, as a code a chat understands.
 *
 * @returns {string}
 */
export function ownLanguage() {
  const locale = Services.locale.appLocaleAsBCP47 || "en-US";
  return /^zh/i.test(locale) ? locale : locale.split("-")[0];
}

/** The languages used last, newest first. */
export function recentLanguages() {
  return parseRecentLanguages(Services.prefs.getStringPref(PREF_LANGUAGES, ""));
}

/** The language translations go to unless another is picked. */
export function defaultLanguage() {
  return recentLanguages()[0] ?? ownLanguage();
}

/** The languages to offer, the default one first. */
export function languages() {
  return languageChoices(recentLanguages(), ownLanguage());
}

/**
 * Remember a language picked to translate into.
 *
 * @param {string} code
 */
export function useLanguage(code) {
  Services.prefs.setStringPref(
    PREF_LANGUAGES,
    withRecentLanguage(recentLanguages(), code).join(",")
  );
}

// Gathering what to ask about.

/**
 * The selection in a frame of a tab.
 *
 * @param {BrowsingContext} frame
 * @param {Element} browser The tab's browser.
 * @returns {Promise<ZendiaAskWhat|null>} Null without a selection.
 */
export async function selectionIn(frame, browser) {
  const found = await actorIn(frame).sendQuery("ZendiaWebChat:Selection", {
    remember: true,
  });
  const selected = text(found?.text, 200_000);
  if (!selected.trim()) {
    return null;
  }
  return {
    kind: found.editable ? "editable" : "selection",
    text: selected,
    context: text(found.context, 1500),
    title: text(found.title, 300),
    url: text(found.url, 4096),
    topic: topicOf(browser.currentURI?.spec ?? found.url),
    field: found.editable ? { browser, frame: frame.id } : null,
  };
}

/**
 * The selection in a tab, in the frame that has the focus first.
 *
 * @param {Element} browser
 * @returns {Promise<ZendiaAskWhat|null>}
 */
export async function selectionOf(browser) {
  const top = browser.browsingContext;
  if (!top) {
    return null;
  }
  const focused = Services.focus.focusedContentBrowsingContext;
  const frames = top.getAllBrowsingContextsInSubtree();
  if (focused?.top == top) {
    frames.sort((a, b) => (b == focused) - (a == focused));
  }
  for (const frame of frames) {
    try {
      const found = await selectionIn(frame, browser);
      if (found) {
        return found;
      }
    } catch {
      // A frame that is gone, or another process's that is not ready.
    }
  }
  return null;
}

/**
 * The text of the page in a tab.
 *
 * @param {Element} browser
 * @returns {Promise<ZendiaAskWhat>}
 */
export async function pageOf(browser) {
  const url = browser.currentURI?.spec ?? "";
  let found = null;
  try {
    found = await actorIn(browser.browsingContext).sendQuery(
      "ZendiaWebChat:Page"
    );
  } catch (e) {
    console.warn("Zendia: could not read the page", e);
  }
  return {
    kind: "page",
    title: text(found?.title, 300) || browser.contentTitle || url,
    url: text(found?.url, 4096) || url,
    page: text(found?.text, 400_000),
    topic: topicOf(url),
  };
}

/**
 * The page a link goes to, read the way reader view reads it, in the tab's
 * container.
 *
 * @param {string} url
 * @param {Element} browser The tab the link is in.
 * @param {string} [label] What the link says.
 * @returns {Promise<ZendiaAskWhat>}
 */
export async function linkOf(url, browser, label = "") {
  let article = null;
  try {
    article = await lazy.ReaderMode.downloadAndParseDocument(
      url,
      browser.contentPrincipal?.originAttributes ?? {}
    );
  } catch (e) {
    // Redirected: the article comes with the address it ended at.
    article = e?.article ?? null;
    if (e?.newURL) {
      url = e.newURL;
    }
  }
  return {
    kind: "link",
    title: text(article?.title, 300) || label || url,
    url,
    page:
      text(article?.textContent, 400_000) ||
      "(The page could not be read here. Open the address to read it.)",
    topic: topicOf(url),
  };
}

/**
 * The pages of several tabs. A tab that is not loaded gives its title and
 * address only.
 *
 * @param {Array<Element>} tabs
 * @returns {Promise<ZendiaAskWhat>}
 */
export async function tabsOf(tabs) {
  const pages = await Promise.all(
    tabs.slice(0, MAX_TABS).map(async tab => {
      const browser = tab.linkedBrowser;
      const url = browser?.currentURI?.spec ?? "";
      const title = tab.label ?? url;
      if (!browser?.browsingContext?.currentWindowGlobal || !tab.linkedPanel) {
        return { title, url, text: "" };
      }
      try {
        const page = await pageOf(browser);
        return { title: page.title || title, url, text: page.page };
      } catch {
        return { title, url, text: "" };
      }
    })
  );
  return {
    kind: "tabs",
    tabs: pages,
    topic: `tabs:${pages.map(page => page.url).join(" ")}`,
  };
}

// Images.

/**
 * An image as it was loaded, with the cookies of the page it is in.
 *
 * @param {string} src
 * @param {nsIPrincipal} principal The page's.
 * @returns {Promise<{type: string, bytes: ArrayBuffer}|null>}
 */
export function fetchImage(src, principal) {
  let uri;
  try {
    uri = Services.io.newURI(src);
  } catch {
    return Promise.resolve(null);
  }
  if (!["http", "https", "data"].includes(uri.scheme)) {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    let channel;
    try {
      channel = lazy.NetUtil.newChannel({
        uri,
        loadingPrincipal: principal,
        securityFlags:
          Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
        contentPolicyType: Ci.nsIContentPolicy.TYPE_OTHER,
      });
    } catch (e) {
      console.warn("Zendia: could not fetch the image", e);
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      channel.cancel(Cr.NS_BINDING_ABORTED);
      resolve(null);
    }, FETCH_TIMEOUT_MS);
    lazy.NetUtil.asyncFetch(channel, (stream, status) => {
      clearTimeout(timer);
      try {
        const type = (channel.contentType || "").toLowerCase();
        if (!Components.isSuccessCode(status) || !type.startsWith("image/")) {
          resolve(null);
          return;
        }
        const size = stream.available();
        if (!size || size > MAX_IMAGE_BYTES) {
          resolve(null);
          return;
        }
        const bytes = lazy.NetUtil.readInputStream(stream, size);
        resolve({ type, bytes });
      } catch (e) {
        console.warn("Zendia: could not read the image", e);
        resolve(null);
      } finally {
        stream?.close();
      }
    });
  });
}

/**
 * A picture of what a page shows, as a PNG.
 *
 * @param {Window} window A browser window, to draw in.
 * @param {WindowGlobalParent} global The page's.
 * @param {{x: number, y: number, width: number, height: number}} rect
 * @param {object} options
 * @param {boolean} options.view The rect is in the viewport, not the page.
 * @param {number} [options.zoom] The page's zoom.
 * @returns {Promise<{type: string, bytes: ArrayBuffer}|null>}
 */
export async function snapshot(window, global, rect, { view, zoom = 1 }) {
  if (!rect.width || !rect.height) {
    return null;
  }
  let scale = window.devicePixelRatio * zoom;
  const pixels = rect.width * rect.height * scale * scale;
  if (pixels > MAX_PIXELS) {
    scale *= Math.sqrt(MAX_PIXELS / pixels);
  }
  const bitmap = await global.drawSnapshot(
    new window.DOMRect(rect.x, rect.y, rect.width, rect.height),
    scale,
    "rgb(255,255,255)",
    { drawView: view }
  );
  const canvas = window.document.createElementNS(HTML_NS, "canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise(resolve =>
    canvas.toBlob(resolve, "image/png")
  );
  return blob ? { type: "image/png", bytes: await blob.arrayBuffer() } : null;
}

/**
 * An image, a canvas or a video's frame on a page: the file it was loaded
 * from when the sites take it, else its pixels as the page can read them,
 * else as the screen shows it.
 *
 * @param {Window} window
 * @param {object} target
 * @param {BrowsingContext} target.frame
 * @param {Element} target.browser The tab's browser.
 * @param {object} [target.targetIdentifier] The context menu's target.
 * @param {string} [target.mark] A label of ZendiaWebChat:MarkImages.
 * @param {string} [target.src] The address the menu found.
 * @returns {Promise<ZendiaAskWhat|null>}
 */
export async function imageOf(
  window,
  { frame, browser, targetIdentifier, mark, src }
) {
  const global = frame.currentWindowGlobal;
  const info = await actorIn(frame).sendQuery("ZendiaWebChat:Image", {
    targetIdentifier,
    mark,
  });
  if (!info) {
    return null;
  }
  const address = src || text(info.src, 1_000_000);
  let file = null;
  if (!info.video && address) {
    const fetched = await fetchImage(address, global.documentPrincipal);
    if (fetched && SITE_TYPES.has(fetched.type)) {
      file = fetched;
    }
  }
  if (!file && info.bytes?.byteLength && SITE_TYPES.has(info.type)) {
    file = { type: info.type, bytes: info.bytes };
  }
  if (!file && info.rect) {
    try {
      file = await snapshot(window, global, info.rect, {
        view: false,
        zoom: browser.fullZoom || 1,
      });
    } catch (e) {
      console.error("Zendia: could not draw the image", e);
    }
  }
  if (!file) {
    return null;
  }
  const url = browser.currentURI?.spec ?? "";
  const kind = info.video ? "video" : "image";
  return {
    kind,
    text: text(info.alt, 500),
    title: browser.contentTitle || "",
    url,
    topic: topicOf(url),
    files: [
      {
        name: fileName(kind == "video" ? "frame" : "image", file.type),
        type: file.type,
        bytes: file.bytes,
      },
    ],
  };
}

/**
 * A part of a tab the user marks.
 *
 * @param {Window} window
 * @param {Element} browser
 * @returns {Promise<ZendiaAskWhat|null>} Null when the user let it go.
 */
export async function regionOf(window, browser) {
  const rect = await lazy.pickRegion(window, browser);
  if (!rect) {
    return null;
  }
  // The overlay must not be in the picture.
  await new Promise(resolve =>
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))
  );
  const file = await snapshot(
    window,
    browser.browsingContext.currentWindowGlobal,
    rect,
    { view: true, zoom: browser.fullZoom || 1 }
  );
  if (!file) {
    return null;
  }
  const url = browser.currentURI?.spec ?? "";
  return {
    kind: "region",
    title: browser.contentTitle || "",
    url,
    topic: topicOf(url),
    files: [
      {
        name: fileName("screenshot", file.type),
        type: file.type,
        bytes: file.bytes,
      },
    ],
  };
}

/**
 * Label the images on screen, let the user pick one with its key, and take
 * it.
 *
 * @param {Window} window
 * @param {Element} browser
 * @returns {Promise<ZendiaAskWhat|null>}
 */
export async function pickImage(window, browser) {
  const frame = browser.browsingContext;
  const actor = actorIn(frame);
  const marks = (await actor.sendQuery("ZendiaWebChat:MarkImages")) ?? [];
  if (!marks.length) {
    actor.sendAsyncMessage("ZendiaWebChat:UnmarkImages");
    return null;
  }
  let index;
  try {
    index = await lazy.ZendiaPicker.open(window, {
      title: "Ask About an Image",
      items: marks.map(mark => {
        let host = "";
        try {
          host = new URL(mark.src).host;
        } catch {
          // A blob or a canvas.
        }
        return {
          key: mark.key,
          label:
            mark.alt ||
            `${mark.kind == "video" ? "Video" : "Image"} ${mark.key}`,
          detail: [`${mark.width}×${mark.height}`, host]
            .filter(Boolean)
            .join(" · "),
        };
      }),
    });
  } finally {
    try {
      actor.sendAsyncMessage("ZendiaWebChat:UnmarkImages");
    } catch {
      // The page went.
    }
  }
  const mark = marks[index];
  return mark ? imageOf(window, { frame, browser, mark: mark.key }) : null;
}

// Asking.

/**
 * Ask a chat site.
 *
 * @param {Window} window
 * @param {object} dock The window's ZendiaWebChatDock.
 * @param {ZendiaAskWhat} what
 * @param {object} prompt A ZendiaWebChatPrompt, or askPrompt(kind).
 * @param {object} [options]
 * @param {string} [options.lang] The language to translate into.
 * @param {string} [options.chatId] The site; the prompt's own, else the one
 *   in front.
 * @param {boolean} [options.all] Ask every site on the strip.
 * @param {boolean} [options.send] Send it; false leaves it in the box. The
 *   prompt's own by default.
 * @returns {Promise<object>} What the panel answered.
 */
export async function ask(window, dock, what, prompt, options = {}) {
  const lang = options.lang ?? defaultLanguage();
  if (options.lang && usesLanguage(prompt)) {
    useLanguage(options.lang);
  }
  const values = templateValues({ ...what, lang: languageName(lang) });
  // Left for the user to finish, the caret goes under what is there.
  const message =
    render(prompt.prompt, values).trim() +
    (prompt.send === false ? "\n\n" : "");
  const send = options.send ?? prompt.send !== false;
  const files = isImageKind(what.kind) ? (what.files ?? []) : [];
  const front = options.chatId ?? prompt.site ?? dock.currentChat?.id;
  const ids = options.all
    ? [
        dock.currentChat?.id,
        ...dock.chats
          .map(chat => chat.id)
          .filter(id => id != dock.currentChat?.id),
      ].filter(Boolean)
    : [front].filter(Boolean);
  if (what.field) {
    dock.setPutBack({ ...what.field, chatId: ids[0] });
  }
  const [first, ...others] = ids;
  const result = await dock.ask({
    chatId: first,
    text: message,
    // Each site gets its own copy: the bytes go to its page.
    files: files.map(file => ({ ...file, bytes: file.bytes.slice(0) })),
    send,
    topic: what.topic,
  });
  for (const chatId of others) {
    dock
      .ask({
        chatId,
        text: message,
        files: files.map(file => ({ ...file, bytes: file.bytes.slice(0) })),
        send: true,
        topic: what.topic,
        background: true,
      })
      .catch(e => console.error(`Zendia: asking ${chatId} failed`, e));
  }
  const site = dock.chats.find(chat => chat.id == first)?.name ?? "The chat";
  if (result?.reason == "no-attach") {
    window.gZenUIManager?.showToast("zendia-webchat-no-attach-toast", {
      l10nArgs: { site },
    });
  } else if (result?.reason == "not-ready" || result?.reason == "not-sent") {
    window.gZenUIManager?.showToast("zendia-webchat-not-ready-toast", {
      l10nArgs: { site },
    });
  } else if (!result?.ok) {
    console.warn("Zendia: the chat was not asked", result);
  }
  return result;
}

/**
 * The prompts offered for something, with their labels as shown.
 *
 * @param {ZendiaAskWhat|string} what Or just its kind.
 * @returns {Array<{prompt: object, label: string}>}
 */
export function offered(what) {
  const kind = typeof what == "string" ? what : what.kind;
  const lang = languageName(defaultLanguage());
  return promptsFor(prompts(), kind, {
    text: typeof what == "string" ? undefined : what.text,
  }).map(prompt => ({ prompt, label: labelOf(prompt, lang) }));
}

/**
 * Pick a prompt with the keys, and ask.
 *
 * @param {Window} window
 * @param {object} dock
 * @param {ZendiaAskWhat} what
 * @param {object} [options]
 * @param {boolean} [options.all] Ask every site on the strip.
 * @returns {Promise<object|null>}
 */
export async function pickAndAsk(window, dock, what, { all = false } = {}) {
  const choices = offered(what);
  if (!all) {
    choices.push({ prompt: askPrompt(what.kind), label: "Ask…" });
  }
  const many = !all && dock.chats.length > 1;
  const items = choices.map(({ prompt, label }) => ({
    label: prompt.group ? `${prompt.group}: ${label}` : label,
    key: prompt.key,
    detail: prompt.site
      ? (dock.chats.find(chat => chat.id == prompt.site)?.name ?? "")
      : "",
  }));
  if (many) {
    items.push({
      label: "Ask Every Site…",
      key: "*",
      detail: "the same prompt to each site on the strip",
    });
  }
  const index = await lazy.ZendiaPicker.open(window, {
    title: all
      ? "Ask Every Site"
      : `Ask ${dock.currentChat?.name ?? "the Chat"}`,
    items,
  });
  if (index === null || index === undefined) {
    return null;
  }
  if (many && index == choices.length) {
    return pickAndAsk(window, dock, what, { all: true });
  }
  const { prompt } = choices[index];
  if (usesLanguage(prompt)) {
    const codes = languages();
    const picked = await lazy.ZendiaPicker.open(window, {
      title: "Translate To",
      items: codes.map(code => ({ label: languageName(code), detail: code })),
    });
    if (picked === null || picked === undefined) {
      return null;
    }
    return ask(window, dock, what, prompt, { lang: codes[picked], all });
  }
  return ask(window, dock, what, prompt, { all });
}

/**
 * Find a prompt by id, offered for a kind.
 *
 * @param {string} id
 * @param {string} kind
 * @returns {object|null}
 */
export function promptById(id, kind) {
  if (id == "ask") {
    return askPrompt(kind);
  }
  return (
    prompts().find(prompt => prompt.id == id && prompt.on.includes(kind)) ??
    null
  );
}

/** All of the above, for a lazy getter. */
export const ZendiaWebChatAsk = {
  ask,
  defaultLanguage,
  fetchImage,
  imageOf,
  languages,
  linkOf,
  offered,
  ownLanguage,
  pageOf,
  pickAndAsk,
  pickImage,
  promptById,
  prompts,
  recentLanguages,
  regionOf,
  selectionIn,
  selectionOf,
  snapshot,
  tabsOf,
  useLanguage,
};
