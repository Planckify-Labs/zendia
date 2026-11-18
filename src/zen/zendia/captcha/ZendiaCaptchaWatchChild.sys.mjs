// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The page's side of the watch: on every page shown, read what the page
// holds through the detection layer and report the findings up. Every frame
// reads itself; a CAPTCHA's own frame is also named by its address to the
// page above it. The subagent asks the same reader where the challenge is,
// to open it and to tell when it is drawn.

import { ZendiaCaptcha } from "resource:///modules/zendia/core/ZendiaCaptcha.sys.mjs";

// The least a side of what is shown can be: smaller is a sensor's pixel or
// an invisible mode's strip, nothing to look at.
const MIN_SIDE = 20;
// The least a side of a challenge's picture can be: smaller is an icon.
const PICTURE_SIDE = 40;
// A widget smaller than this is a button of a bigger card (AWS WAF's
// Begin, HUMAN's Press & Hold): the shot takes the card around it.
const SMALL_WIDTH = 200;
const SMALL_HEIGHT = 50;
// The most a box around a challenge's prompt or widget may be: about the
// size of the services' popups. Bigger is the page around it.
const BOX_MAX_WIDTH = 520;
const BOX_MAX_HEIGHT = 720;
// How far up a box is looked for, from a prompt and from a small widget.
const PROMPT_LEVELS = 6;
const WIDGET_LEVELS = 4;
// How much bigger than a widget the card around it may be.
const WIDGET_GROWTH = 4;
// How far above a picture its answer field may be, for a site's own text
// CAPTCHA.
const OWN_CAPTCHA_LEVELS = 4;
// A candidate that covers nearly all of the view is a mask or a page, not
// the challenge, while anything smaller is found.
const MOSTLY_VIEW = 0.9;
// The most a prompt's line may be, and how far up it is looked for: the
// prompt split over a few elements, not the whole challenge's text.
const LINE_MAX = 80;
const LINE_LEVELS = 2;
// The most of a page read for prompts and loader addresses.
const MAX_PROMPT_TEXTS = 200;
const MAX_OWN = 5;
const MAX_INLINE_SCRIPTS = 100;
const MAX_INLINE_TEXT = 50000;
const MAX_INLINE_URLS = 50;
// The most elements read for where a challenge's popup reaches.
const MAX_EXTENT_ELEMENTS = 2000;

// What a challenge has to be acted on: a prompt next to none of these is
// text about CAPTCHAs, not one.
const CONTROLS =
  "img, canvas, svg, video, button, input:not([type=hidden]), select, [role=button], [role=checkbox], [role=slider], [draggable=true], [tabindex]";
const ANSWER_FIELDS =
  "input:not([type]), input[type=text], input[type=tel], input[type=number], input[type=search], textarea";
// Where a prompt is not: a link, a page heading, what the page does not
// show as text.
const NOT_PROMPT = "a[href], h1, h2, option, [hidden], [aria-hidden=true]";

const VISIBILITY = { opacityProperty: true, visibilityProperty: true };

/**
 * The frames of a document, those inside shadow roots too: Turnstile and
 * others draw theirs in a closed one that no selector reaches, but every
 * frame is a child browsing context its embedder can be asked for.
 *
 * @param {Window} window
 * @returns {Element[]}
 */
export function framesOf(window) {
  const document = window.document;
  const frames = new Set(document.querySelectorAll("iframe, frame"));
  try {
    for (const child of window.browsingContext?.children ?? []) {
      const element = child.embedderElement;
      if (element && element.ownerDocument == document) {
        frames.add(element);
      }
    }
  } catch {
    // A window that is going away.
  }
  return [...frames];
}

// The address a frame was given. A frame with none is the page's own.
function srcOf(frame) {
  return frame.src || frame.getAttribute("src") || "";
}

/**
 * Whether an element is something to look at: drawn (not hidden, not
 * transparent), big enough, and in the page where a scroll reaches it — a
 * closed challenge is often parked far above or left of the page.
 *
 * @param {Window} window
 * @param {Element} element
 * @returns {boolean}
 */
export function isShown(window, element) {
  try {
    if (!element.checkVisibility(VISIBILITY)) {
      return false;
    }
  } catch {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return (
    rect.width >= MIN_SIDE &&
    rect.height >= MIN_SIDE &&
    rect.right + window.scrollX > 0 &&
    rect.bottom + window.scrollY > 0
  );
}

/**
 * The part of an element that is seen: inside the viewport and inside every
 * ancestor that clips it (overflow other than visible). An absolutely
 * placed element is clipped only from its containing block up, a fixed one
 * by the viewport alone.
 *
 * @param {Window} window
 * @param {Element} element
 * @param {DOMRect|object} [rect] The part of it to cut; all of it by
 *   default.
 * @param {object} [options]
 * @param {boolean} [options.viewport] Whether the viewport cuts it too.
 * @returns {{left: number, top: number, width: number, height: number}|null}
 *   In the viewport's coordinates; null when nothing of it is seen.
 */
export function visibleRect(
  window,
  element,
  rect = element.getBoundingClientRect(),
  { viewport = true } = {},
) {
  const document = window.document;
  let left = viewport ? Math.max(rect.left, 0) : rect.left;
  let top = viewport ? Math.max(rect.top, 0) : rect.top;
  let right = viewport ? Math.min(rect.right, window.innerWidth) : rect.right;
  let bottom = viewport
    ? Math.min(rect.bottom, window.innerHeight)
    : rect.bottom;
  let node = element;
  while (node && right > left && bottom > top) {
    const position = window.getComputedStyle(node)?.position;
    if (position == "fixed") {
      break;
    }
    const parent =
      position == "absolute" ? node.offsetParent : node.parentElement;
    if (
      !parent ||
      parent == document.body ||
      parent == document.documentElement
    ) {
      break;
    }
    const style = window.getComputedStyle(parent);
    if (style) {
      const box = parent.getBoundingClientRect();
      const innerLeft = box.left + parent.clientLeft;
      const innerTop = box.top + parent.clientTop;
      if (style.overflowX != "visible") {
        left = Math.max(left, innerLeft);
        right = Math.min(right, innerLeft + parent.clientWidth);
      }
      if (style.overflowY != "visible") {
        top = Math.max(top, innerTop);
        bottom = Math.min(bottom, innerTop + parent.clientHeight);
      }
    }
    node = parent;
  }
  return right > left && bottom > top
    ? { left, top, width: right - left, height: bottom - top }
    : null;
}

/**
 * Where an element and what it shows are, together: a challenge a page
 * draws often opens as a popup placed outside its box (a bubble under its
 * checkbox), drawn by it all the same. The shown descendants' boxes are
 * joined to its own; an element with too many to read is its box alone.
 *
 * @param {Window} window
 * @param {Element} element
 * @returns {{left: number, top: number, right: number, bottom: number,
 *   width: number, height: number}}
 */
export function extentOf(window, element) {
  let { left, top, right, bottom } = element.getBoundingClientRect();
  const descendants = element.querySelectorAll("*");
  if (descendants.length <= MAX_EXTENT_ELEMENTS) {
    for (const child of descendants) {
      const rect = child.getBoundingClientRect();
      // A popup is the size of one; bigger is a backdrop over the page,
      // however clear.
      if (
        rect.width < 1 ||
        rect.height < 1 ||
        rect.width > BOX_MAX_WIDTH ||
        rect.height > BOX_MAX_HEIGHT ||
        (rect.left >= left &&
          rect.top >= top &&
          rect.right <= right &&
          rect.bottom <= bottom) ||
        !child.checkVisibility(VISIBILITY)
      ) {
        continue;
      }
      // What a box around it cuts off is not shown: a slider's piece
      // parked in a strip that hides it.
      const seen = visibleRect(window, child, rect, { viewport: false });
      if (!seen) {
        continue;
      }
      left = Math.min(left, seen.left);
      top = Math.min(top, seen.top);
      right = Math.max(right, seen.left + seen.width);
      bottom = Math.max(bottom, seen.top + seen.height);
    }
  }
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

// The box around an element that holds the rest of its challenge: up the
// ancestors while they stay the size of a challenge, and never the form
// or the page around it. With `growth`, no bigger than that many times the
// element's own area: a widget's card and its instructions, not the
// column it sits in.
function boxAround(window, element, levels, growth = Infinity) {
  const document = window.document;
  const own = element.getBoundingClientRect();
  const most = own.width * own.height * growth;
  let box = element;
  let node = element.parentElement;
  for (let level = 0; node && level < levels; level++) {
    if (
      node == document.body ||
      node == document.documentElement ||
      node.localName == "form"
    ) {
      break;
    }
    const rect = node.getBoundingClientRect();
    if (
      rect.width > BOX_MAX_WIDTH ||
      rect.height > BOX_MAX_HEIGHT ||
      rect.width * rect.height > most
    ) {
      break;
    }
    box = node;
    node = node.parentElement;
  }
  return box;
}

// The widgets of the services on the page, the outer one of those inside
// one another: GeeTest's classes match a dozen elements of one widget.
// With `all`, every one: a popup that opens inside a mask over the whole
// page is one of the inner ones.
function widgetsOf(window, all = false) {
  try {
    const found = [
      ...window.document.querySelectorAll(ZendiaCaptcha.WIDGETS),
    ];
    return all
      ? found
      : found.filter(
          (element) => !element.parentElement?.closest(ZendiaCaptcha.WIDGETS),
        );
  } catch {
    // A selector this page's engine does not know.
    return [];
  }
}

// The texts that could be a challenge's prompt, without reading every text
// of the page: those with one of the prompt words, read by the engine.
function promptTexts(document) {
  const lower =
    "translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')";
  const words = ZendiaCaptcha.PROMPT_WORDS.map(
    (word) => `contains(${lower}, '${word}')`,
  ).join(" or ");
  const query =
    `//body//text()[string-length(normalize-space(.)) > 3 and ` +
    `string-length(.) < ${ZendiaCaptcha.PROMPT_MAX * 3} and (${words}) and ` +
    `not(ancestor::script or ancestor::style or ancestor::noscript or ` +
    `ancestor::template or ancestor::textarea or ancestor::title)]`;
  try {
    const found = document.evaluate(
      query,
      document,
      null,
      7, // ORDERED_NODE_SNAPSHOT_TYPE
      null,
    );
    const texts = [];
    for (let i = 0; i < Math.min(found.snapshotLength, MAX_PROMPT_TEXTS); i++) {
      texts.push(found.snapshotItem(i));
    }
    return texts;
  } catch {
    // A document XPath cannot read.
    return [];
  }
}

const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

// The challenges told by a prompt in the page's text.
function textPrompts(window, found) {
  const document = window.document;
  for (const text of promptTexts(document)) {
    let element = text.parentElement;
    if (
      !element ||
      element.closest(NOT_PROMPT) ||
      !element.checkVisibility(VISIBILITY)
    ) {
      continue;
    }
    // The prompt may be split over a few elements ("Select all images
    // with <b>crosswalks</b>"): its words are tested alone, and the line
    // it is part of is the one told.
    const kind =
      ZendiaCaptcha.promptKind(text.data) ??
      ZendiaCaptcha.promptKind(element.textContent);
    if (!kind) {
      continue;
    }
    const matched = element;
    for (
      let level = 0;
      level < LINE_LEVELS &&
      element.parentElement &&
      element.parentElement != document.body &&
      clean(element.parentElement.textContent).length <= LINE_MAX;
      level++
    ) {
      element = element.parentElement;
    }
    // A service's widget is found as one already.
    if (element.closest(ZendiaCaptcha.WIDGETS)) {
      continue;
    }
    const box = boxAround(window, element, PROMPT_LEVELS);
    if (!isShown(window, box) || !box.querySelector(CONTROLS)) {
      continue;
    }
    // The line as it shows, if it shows the prompt; the prompt's own text
    // where the line around it hides it.
    const line = clean(element.innerText);
    const own = clean(matched.innerText || text.data);
    found.push({ box, kind, prompt: line.includes(own) ? line : own });
  }
}

// The challenges told by a field's placeholder or a picture's label.
function labelPrompts(window, found) {
  const document = window.document;
  // A prompt that is only a field's placeholder or a picture's label: a
  // text challenge's "Enter text from image" field, next to its picture.
  for (const element of document.querySelectorAll(
    "input[placeholder], input[aria-label], textarea[placeholder], img[alt], canvas[aria-label]",
  )) {
    const label =
      element.getAttribute("placeholder") ||
      element.getAttribute("aria-label") ||
      element.getAttribute("alt");
    const kind = ZendiaCaptcha.promptKind(label);
    if (
      !kind ||
      kind == "checkbox" ||
      element.closest(ZendiaCaptcha.WIDGETS) ||
      !element.checkVisibility(VISIBILITY)
    ) {
      continue;
    }
    const box = boxAround(window, element, PROMPT_LEVELS);
    if (
      isShown(window, box) &&
      (kind != "text" || box.querySelector("img, canvas, svg"))
    ) {
      found.push({ box, kind, prompt: clean(label) });
    }
  }
}

// The text CAPTCHAs a site makes itself, told by their picture's names.
function namedPictures(window, found) {
  const document = window.document;
  // A site's own text CAPTCHA: a picture named as one, and the field its
  // answer is typed in near it. A field alone is too often a code sent by
  // mail; a picture alone, one in an article about CAPTCHAs.
  for (const picture of document.querySelectorAll("img, canvas")) {
    const names = ["src", "alt", "id", "class", "name", "title", "aria-label"]
      .map((name) => picture.getAttribute(name) ?? "")
      .join(" ");
    if (
      !ZendiaCaptcha.namesOwnCaptcha(names) ||
      picture.closest(ZendiaCaptcha.WIDGETS) ||
      !isShown(window, picture)
    ) {
      continue;
    }
    let box = picture.parentElement;
    for (
      let level = 0;
      box && level < OWN_CAPTCHA_LEVELS && !box.querySelector(ANSWER_FIELDS);
      level++
    ) {
      box = box.parentElement;
    }
    if (!box?.querySelector(ANSWER_FIELDS)) {
      continue;
    }
    // A picture and a field that only a whole section holds together are
    // not one CAPTCHA.
    const { width, height } = box.getBoundingClientRect();
    if (width <= BOX_MAX_WIDTH && height <= BOX_MAX_HEIGHT) {
      found.push({ box, kind: "text", prompt: "picture and answer field" });
    }
  }
}

// Of the challenges found, one per box.
function oneEach(found) {
  // One per box, the outer of those inside one another, told by the prompt
  // that says the most: a checkbox phrase is the least, for the challenge
  // it opens may come up inside the checkbox's box.
  const rank = ({ kind }) => (kind == "checkbox" ? 1 : 0);
  const kept = [];
  for (const item of found) {
    const other = kept.find(
      ({ box }) => box == item.box || box.contains(item.box) || item.box.contains(box),
    );
    if (!other) {
      kept.push({ ...item });
      continue;
    }
    if (item.box.contains(other.box)) {
      other.box = item.box;
    }
    if (rank(item) < rank(other)) {
      other.kind = item.kind;
      other.prompt = item.prompt;
    }
  }
  // Boxes grown into one another while merging.
  return kept
    .filter(
      (item) =>
        !kept.some((other) => other !== item && other.box.contains(item.box)),
    );
}

/**
 * The challenges a page draws itself, with no service frame or class to
 * know them by: a prompt that says what the challenge asks ("Select all
 * images with crosswalks", "Slide the piece into place") next to something
 * to act on, a field or picture labeled with one, and a site's own text
 * CAPTCHA, a picture named as one with its answer field. Each is the box
 * that holds it.
 *
 * @param {Window} window
 * @returns {{box: Element, kind: string, prompt: string}[]}
 */
export function ownChallenges(window) {
  // Inside a service's own frame, its prompt is the service's: the page
  // above names it by the frame's address.
  if (!window.document?.body || isCaptchaFrame(window)) {
    return [];
  }
  const found = [];
  textPrompts(window, found);
  labelPrompts(window, found);
  namedPictures(window, found);
  return oneEach(found).slice(0, MAX_OWN);
}

// What an inline script loads, by the addresses in its text: an ES module
// importing a CAPTCHA's SDK from a CDN (Friendly Captcha's) has no src to
// read. A script's addresses are read once.
const inlineUrls = new WeakMap();
const URLS = /https?:\/\/[^\s"'`<>()\\]+/g;

function scriptUrls(document) {
  const urls = new Set();
  for (const script of document.scripts) {
    if (script.src) {
      urls.add(script.src);
    }
  }
  for (const link of document.querySelectorAll(
    "link[rel=modulepreload][href], link[rel=preload][as=script][href]",
  )) {
    urls.add(link.href);
  }
  let read = 0;
  for (const script of document.querySelectorAll("script:not([src])")) {
    if (/json|template|html/i.test(script.type)) {
      continue;
    }
    if (++read > MAX_INLINE_SCRIPTS) {
      break;
    }
    let found = inlineUrls.get(script);
    if (!found) {
      found = [
        ...script.text.slice(0, MAX_INLINE_TEXT).matchAll(URLS),
      ]
        .slice(0, MAX_INLINE_URLS)
        .map(([url]) => url);
      inlineUrls.set(script, found);
    }
    for (const url of found) {
      urls.add(url);
    }
  }
  return [...urls];
}

/**
 * What of a page is a CAPTCHA's, seen from the page itself: the frames of
 * the services (by their address), the loader scripts (by theirs), the
 * widgets the page drew, the challenges it draws itself, the answer fields
 * of solved ones, and the trap fields of its forms. A frame that is not
 * shown says so (hidden): a closed challenge, an invisible mode's helper.
 * Only the widgets that are shown count.
 *
 * @param {Window} window
 * @returns {{signal: string, name?: string, kind?: string, challenge?: boolean, hidden?: boolean, detail?: string}[]}
 */
export function scanPage(window) {
  const document = window.document;
  const detections = [];
  for (const frame of framesOf(window)) {
    const src = srcOf(frame);
    const name = src && ZendiaCaptcha.nameOf(src);
    if (name) {
      detections.push({
        signal: "frame",
        name,
        kind: ZendiaCaptcha.kindOf(src),
        challenge: ZendiaCaptcha.isChallenge(src),
        hidden: !isShown(window, frame),
        detail: src.slice(0, 200),
      });
    }
  }
  for (const url of scriptUrls(document)) {
    const name = ZendiaCaptcha.nameOfScript(url);
    if (name) {
      detections.push({
        signal: "script",
        name,
        kind: ZendiaCaptcha.kindOfScript(url),
        detail: url.slice(0, 200),
      });
    }
  }
  const widgets = widgetsOf(window).filter((element) =>
    isShown(window, element),
  ).length;
  if (widgets) {
    detections.push({ signal: "widget", detail: String(widgets) });
  }
  for (const { kind, prompt } of ownChallenges(window)) {
    detections.push({ signal: "own", kind, detail: prompt.slice(0, 200) });
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

// Whether this document is itself a CAPTCHA's frame, seen from inside.
function isCaptchaFrame(window) {
  return (
    window.parent != window &&
    !!ZendiaCaptcha.nameOf(window.document.documentURI ?? "")
  );
}

// Whether the pictures an element holds are loaded, those that are shown.
function picturesLoaded(window, element) {
  const images = [
    ...(element.localName == "img" ? [element] : []),
    ...element.querySelectorAll("img"),
  ].filter((image) => image.checkVisibility(VISIBILITY));
  return images.every((image) => image.complete && image.naturalWidth > 0);
}

// How many pictures big enough to be a challenge's an element shows,
// loaded: what a puzzle that opens shows once it is past its spinner.
function picturesShown(window, element) {
  let count = 0;
  for (const picture of [
    element,
    ...element.querySelectorAll("img, canvas, video, svg image"),
  ]) {
    if (!["img", "canvas", "video", "image"].includes(picture.localName)) {
      continue;
    }
    const { width, height } = picture.getBoundingClientRect();
    if (
      width >= PICTURE_SIDE &&
      height >= PICTURE_SIDE &&
      picture.checkVisibility(VISIBILITY) &&
      (picture.localName != "img" ||
        (picture.complete && picture.naturalWidth > 0))
    ) {
      count++;
    }
  }
  return count;
}

/**
 * The part of the page the challenge is in, for the subagent's shot of it.
 * Looked for in this order, each shown one of a kind before the next kind:
 * the frames that ask for clicks, the services' other frames, the widgets
 * the page drew (the parts of one too, for a popup inside a mask), and the
 * challenges it draws itself, open ones before their checkboxes. Of a
 * kind, the biggest that is not a mask
 * over the whole view. A small widget is taken with the card around it. Scrolled into view first, for the shot and the
 * user, and cut to what is seen of it. The rect is of this frame's own
 * viewport; the subagent snapshots from this frame's global, so a challenge
 * in a sub-frame needs no coordinates moved.
 *
 * @param {Window} window
 * @returns {{left: number, top: number, width: number, height: number,
 *   fullWidth: number, fullHeight: number, viewWidth: number,
 *   viewHeight: number, scrollX: number, scrollY: number,
 *   challenge: boolean, frame: boolean, own: boolean, inside: boolean,
 *   drawn: boolean, frameId: number|null}|null}
 *   What is seen of it in this frame's viewport, with its whole size, the
 *   viewport's size and scroll (the shot is taken in the document's
 *   coordinates); whether it is the part that asks for clicks, a frame,
 *   one the page draws itself, and whether this document is a CAPTCHA's
 *   frame itself; whether its pictures are loaded, and the frame's browsing
 *   context, for asking it whether it is drawn. Null when the page has none.
 */
export function challengeRect(window) {
  const document = window.document;
  if (!document?.documentElement) {
    return null;
  }
  const frames = framesOf(window).filter((frame) =>
    ZendiaCaptcha.nameOf(srcOf(frame)),
  );
  const own = ownChallenges(window);
  const kinds = [
    frames.filter((frame) => ZendiaCaptcha.isChallenge(srcOf(frame))),
    frames.filter((frame) => !ZendiaCaptcha.isChallenge(srcOf(frame))),
    widgetsOf(window, true),
    // A challenge the page draws, open (it asks to pick, type, slide),
    // before the checkbox that opens one.
    own.filter(({ kind }) => kind != "checkbox").map(({ box }) => box),
    own.filter(({ kind }) => kind == "checkbox").map(({ box }) => box),
  ];
  const view = window.innerWidth * window.innerHeight;
  for (const [kind, elements] of kinds.entries()) {
    const shown = elements
      .filter((element) => isShown(window, element))
      .map((element) => {
        const { width, height } = element.getBoundingClientRect();
        return { element, area: width * height };
      })
      .sort((a, b) => b.area - a.area);
    const ordered = [
      ...shown.filter(({ area }) => area < view * MOSTLY_VIEW),
      ...shown.filter(({ area }) => area >= view * MOSTLY_VIEW),
    ];
    for (const { element } of ordered) {
      let target = element;
      if (kind == 2) {
        // A small widget is a button of a bigger card, taken whole; a
        // bigger one is taken with the instructions next to it.
        const { width, height } = element.getBoundingClientRect();
        target =
          width < SMALL_WIDTH || height < SMALL_HEIGHT
            ? boxAround(window, element, WIDGET_LEVELS)
            : boxAround(window, element, WIDGET_LEVELS, WIDGET_GROWTH);
      }
      const isFrame = kind <= 1;
      // What a page draws reaches as far as its popups; a frame is its box.
      const reach = () =>
        isFrame ? target.getBoundingClientRect() : extentOf(window, target);
      target.scrollIntoView({
        block: reach().height > window.innerHeight ? "start" : "center",
        inline: "nearest",
        behavior: "instant",
      });
      // A popup under its checkbox may still be out of view: the page is
      // scrolled to the middle of the two, or to their top if they do not
      // fit.
      let full = reach();
      if (full.top < 0 || full.bottom > window.innerHeight) {
        window.scrollBy({
          top:
            full.top -
            Math.max(0, (window.innerHeight - full.height) / 2),
          behavior: "instant",
        });
        full = reach();
      }
      const rect = visibleRect(window, target, full);
      if (!rect || rect.width < MIN_SIDE || rect.height < MIN_SIDE) {
        continue;
      }
      return {
        ...rect,
        fullWidth: full.width,
        fullHeight: full.height,
        viewWidth: window.innerWidth,
        viewHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        challenge: kind == 0 || kind == 3,
        frame: isFrame,
        own: kind >= 3,
        inside: isCaptchaFrame(window),
        drawn: isFrame || picturesLoaded(window, target),
        pictures: isFrame ? null : picturesShown(window, target),
        frameId: isFrame ? (element.browsingContext?.id ?? null) : null,
      };
    }
  }
  return null;
}

// The names a checkbox gets in a page that draws its own: rc-cb, hc-cb,
// cap-check, checkbox. A state (checked) is not one.
const CHECKBOX_NAMES = /(?:^|[-_])(?:check(?:box)?|cb|tick)(?:$|[-_])/i;
// The names of a checkbox, or of what holds it, once it is ticked.
const CHECKED_NAMES =
  /(?:^|[-_])(?:checked|is-checked|done|success|verified|passed|solved)(?:$|[-_])/i;
// What a click lands on: the element that takes it, around the words.
const CLICKABLE = "button, [role=button], [role=checkbox], label, [tabindex], [onclick]";

// Whether an element can be clicked by the user: shown, with some size.
function clickable(window, element) {
  try {
    if (!element.checkVisibility(VISIBILITY)) {
      return false;
    }
  } catch {
    return false;
  }
  const { width, height } = element.getBoundingClientRect();
  return width >= 8 && height >= 8;
}

/**
 * The checkbox of a challenge drawn in the page, or of a service's widget
 * there: what the user would click to open the challenge. A real checkbox
 * first, then a control labeled as one ("Verify that you are human"), then
 * an element named as one (the deepest of them), then the words that say
 * it ("I'm not a robot", "Click to verify").
 *
 * @param {Window} window
 * @param {Element} root
 * @returns {Element|null}
 */
export function checkboxOf(window, root) {
  const shown = (element) => clickable(window, element);
  const real = [
    ...root.querySelectorAll("[role=checkbox], input[type=checkbox]"),
  ].find(shown);
  if (real) {
    return real;
  }
  for (const element of root.querySelectorAll("[aria-label], [title]")) {
    const label =
      element.getAttribute("aria-label") || element.getAttribute("title");
    if (shown(element) && ZendiaCaptcha.promptKind(label) == "checkbox") {
      return element;
    }
  }
  const named = [root, ...root.querySelectorAll("[class], [id]")].filter(
    (element) =>
      (CHECKBOX_NAMES.test(element.id) ||
        [...element.classList].some((name) => CHECKBOX_NAMES.test(name))) &&
      shown(element),
  );
  const deepest = named.find(
    (element) => !named.some((other) => other != element && element.contains(other)),
  );
  if (deepest) {
    return deepest;
  }
  for (const element of root.querySelectorAll("*")) {
    if (
      element.childElementCount <= 2 &&
      shown(element) &&
      ZendiaCaptcha.promptKind(element.innerText) == "checkbox"
    ) {
      const target = element.closest(CLICKABLE);
      return target && root.contains(target) ? target : element;
    }
  }
  return null;
}

// Whether a checkbox says it is ticked: its state, or a name it or what
// holds it takes once the check passed.
function isChecked(control) {
  if (
    control.getAttribute("aria-checked") == "true" ||
    control.checked === true
  ) {
    return true;
  }
  return [control, control.parentElement].some(
    (element) =>
      element && [...element.classList].some((name) => CHECKED_NAMES.test(name)),
  );
}

// The checkbox frame of a service (reCAPTCHA, hCaptcha, Yandex), from
// inside it. Never a top page: a service's own website is none. The
// managed and invisible ones have nothing to open.
function frameCheckbox(window, peek) {
  if (window.parent == window) {
    return null;
  }
  const document = window.document;
  const url = document.documentURI ?? "";
  const name = ZendiaCaptcha.nameOf(url);
  if (
    !name ||
    ZendiaCaptcha.isChallenge(url) ||
    ZendiaCaptcha.kindOf(url) != "checkbox"
  ) {
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
    return { checkbox: true };
  }
  control.click();
  return { opened: true, name };
}

// The checkbox of a challenge the page draws itself, or of a service's
// widget drawn in the page (Lemin's "I'm Human", GeeTest's "Click to
// verify"). Not once a challenge is open, not inside a service's frame
// (frameCheckbox's), and not the widgets whose click is the check itself
// (ZendiaCaptcha.NOT_OPENED).
function pageCheckbox(window, peek) {
  if (isCaptchaFrame(window)) {
    return null;
  }
  const own = ownChallenges(window);
  if (own.some(({ kind }) => kind != "checkbox")) {
    return null;
  }
  const roots = [
    ...own.map(({ box }) => ({ root: box, name: "page" })),
    ...widgetsOf(window)
      .filter(
        (widget) =>
          isShown(window, widget) &&
          !widget.matches(ZendiaCaptcha.NOT_OPENED) &&
          !widget.querySelector("iframe, frame"),
      )
      .map((widget) => ({ root: widget, name: "widget" })),
  ];
  for (const { root, name } of roots) {
    // AWS WAF's Begin button is its widget, and what opens its puzzle.
    const control = root.matches("button, [role=button], input[type=button]")
      ? root
      : checkboxOf(window, root);
    if (!control) {
      continue;
    }
    if (isChecked(control)) {
      return { passed: true };
    }
    if (peek) {
      return { checkbox: true };
    }
    control.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "instant",
    });
    control.click();
    return { opened: true, name };
  }
  return null;
}

/**
 * Open the challenge from its checkbox: the click on "I'm not a robot" the
 * user would have to make, made for them, so the subagent's shot and their
 * finish start at the challenge. In a service's checkbox frame, and in a
 * page for the checkboxes it draws and the service widgets drawn in it. A
 * challenge already open, a checkbox already checked and the invisible
 * kinds are left alone.
 *
 * @param {Window} window
 * @param {boolean} [peek] Only say whether there is a checkbox and whether
 *   it is checked; never click.
 * @returns {{opened: boolean, name: string}|{passed: boolean}|{checkbox: boolean}|null}
 */
export function openChallenge(window, peek = false) {
  return frameCheckbox(window, peek) ?? pageCheckbox(window, peek);
}

/**
 * Whether a CAPTCHA's frame is drawn, seen from inside it: the document is
 * complete and every picture shown in it loaded — the frame is in the page
 * with its final size long before the grid it shows is. A challenge frame
 * answers; with `any`, every frame of a service does (a widget the
 * subagent shoots as it is).
 *
 * @param {Window} window
 * @param {boolean} [any]
 * @returns {{drawn: boolean}|null}
 */
export function challengeDrawn(window, any = false) {
  const document = window.document;
  const url = document.documentURI ?? "";
  if (
    !(any ? ZendiaCaptcha.nameOf(url) : ZendiaCaptcha.isChallenge(url)) ||
    window.parent == window
  ) {
    return null;
  }
  const body = document.body;
  if (document.readyState != "complete" || !body) {
    return { drawn: false };
  }
  const images = [...(document.images ?? [])].filter((image) =>
    image.checkVisibility(VISIBILITY),
  );
  if (images.length) {
    return {
      drawn: images.every((image) => image.complete && image.naturalWidth > 0),
    };
  }
  // Canvas- and markup-drawn challenges: content is there once the
  // document is. Turnstile's is all in a closed shadow root.
  const content =
    body.querySelector("canvas, button, [role='button'], input, table") ||
    body.textContent.trim() ||
    [body, ...body.querySelectorAll("*")].some(
      (element) => element.openOrClosedShadowRoot,
    );
  return { drawn: !!content };
}

// How long the page has to stop adding frames and scripts before it is read
// again: a CAPTCHA's script draws its frames after the page is shown, and a
// challenge often only opens on a click.
const RESCAN_DELAY_MS = 500;
// The most often a page whose elements are shown and hidden is read again:
// a challenge is often in the page from the start, hidden until it opens,
// and an animated page changes styles all the time.
const RESHOW_DELAY_MS = 1000;
// Looks again after a page is shown, for what is drawn where no change is
// seen: a widget in a shadow root.
const LATE_LOOKS_MS = [1500, 4000];

const WATCHED = new Set(["iframe", "frame", "script", "input", "textarea"]);
const SHOWN_BY = ["style", "class", "hidden", "open", "aria-hidden"];

// Whether a change to the page could have brought a CAPTCHA with it.
function bringsCaptcha(records) {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (
        node.nodeType == 1 &&
        (WATCHED.has(node.localName) ||
          node.querySelector?.("iframe, frame, script, input, textarea, img, canvas"))
      ) {
        return true;
      }
    }
  }
  return false;
}

// Whether a change shows or hides something, or puts text in.
function showsSomething(records) {
  return records.some(
    (record) =>
      record.type == "attributes" ||
      (record.type == "childList" && record.addedNodes.length),
  );
}

export class ZendiaCaptchaWatchChild extends JSWindowActorChild {
  #observer = null;
  #timer = null;
  #reshowTimer = null;
  #lateTimers = [];
  // What was last reported, so a look that finds the same says nothing,
  // and one that finds the CAPTCHA gone says so.
  #sent = "[]";

  handleEvent(event) {
    switch (event.type) {
      case "pageshow":
        this.#scan({ force: true });
        this.#watch();
        break;
      case "pagehide":
        this.#unwatch();
        this.#sent = "[]";
        this.sendAsyncMessage("Zendia:CaptchaWatch:Gone");
        break;
    }
  }

  // The service asks for a look at pages that were open before it started,
  // and the subagent for where the challenge is, or to open it.
  receiveMessage(message) {
    if (message.name == "Zendia:CaptchaWatch:Scan") {
      this.#scan({ force: true });
      this.#watch();
    }
    if (message.name == "Zendia:CaptchaWatch:Rect") {
      return challengeRect(this.contentWindow);
    }
    if (message.name == "Zendia:CaptchaWatch:Open") {
      return openChallenge(this.contentWindow, message.data?.peek === true);
    }
    if (message.name == "Zendia:CaptchaWatch:Drawn") {
      return challengeDrawn(this.contentWindow, message.data?.any === true);
    }
    return undefined;
  }

  didDestroy() {
    this.#unwatch();
  }

  #scan({ force = false } = {}) {
    if (!this.document) {
      return;
    }
    const detections = scanPage(this.contentWindow);
    const sent = JSON.stringify(detections);
    if (force ? detections.length : sent != this.#sent) {
      this.sendAsyncMessage("Zendia:CaptchaWatch:Report", {
        url: this.document.documentURI,
        detections,
      });
    }
    this.#sent = sent;
    // A dev-only audit of coverage: every frame and script the page holds,
    // so what the layer does not yet name can be seen next to what it does.
    if (
      force &&
      Services.prefs.getBoolPref("zendia.captcha.watch.debug", false)
    ) {
      this.sendAsyncMessage("Zendia:CaptchaWatch:Debug", {
        url: this.document.documentURI,
        frames: framesOf(this.contentWindow).map(srcOf),
        scripts: scriptUrls(this.document).filter((src) =>
          /^https?:/.test(src),
        ),
      });
    }
  }

  #watch() {
    const window = this.contentWindow;
    if (this.#observer || !window?.document.documentElement) {
      return;
    }
    this.#observer = new window.MutationObserver((records) => {
      if (bringsCaptcha(records)) {
        window.clearTimeout(this.#timer);
        this.#timer = window.setTimeout(() => this.#scan(), RESCAN_DELAY_MS);
      } else if (showsSomething(records) && !this.#reshowTimer) {
        // Not pushed back by the next change, as the debounce above is:
        // an animation changes styles faster than any delay.
        this.#reshowTimer = window.setTimeout(() => {
          this.#reshowTimer = null;
          this.#scan();
        }, RESHOW_DELAY_MS);
      }
    });
    this.#observer.observe(window.document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: SHOWN_BY,
    });
    this.#lateTimers = LATE_LOOKS_MS.map((delay) =>
      window.setTimeout(() => this.#scan(), delay),
    );
  }

  #unwatch() {
    this.#observer?.disconnect();
    this.#observer = null;
    try {
      const window = this.contentWindow;
      window?.clearTimeout(this.#timer);
      window?.clearTimeout(this.#reshowTimer);
      for (const timer of this.#lateTimers) {
        window?.clearTimeout(timer);
      }
    } catch {
      // The window is already gone.
    }
    this.#timer = null;
    this.#reshowTimer = null;
    this.#lateTimers = [];
  }
}
