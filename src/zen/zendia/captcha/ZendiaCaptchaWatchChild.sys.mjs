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
// A Gobang piece is 39 px.
const PICTURE_SIDE = 36;
// How big a service's widget is once its challenge is open: the popups
// are 300 px and up, a checkbox or button is far smaller.
const OPEN_SIDE = 260;
// How opaque a challenge is at the least once it is in: less is a fade.
const FADED = 0.95;
// The room left around each part of a challenge, inside it.
const PART_ROOM = 4;
// The most a side of a button's icon is.
const ICON_SIDE = 64;
// The least a side of the area a task is drawn in, found with no picture.
const TASK_SIDE = 100;
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
    // An ancestor that does not hold the element where it is drawn is no
    // box around it: a popup placed outside the button it opens from
    // (GeeTest's float mode) sits under the button's holder.
    const holds =
      rect.left <= own.left + 1 &&
      rect.top <= own.top + 1 &&
      rect.right >= own.right - 1 &&
      rect.bottom >= own.bottom - 1;
    if (
      !holds ||
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

// Whether the pictures an element holds are loaded, those that are shown:
// its images, and the background images it is painted with (reCAPTCHA's
// example picture, hCaptcha's tiles), which no element says the load of.
function picturesLoaded(window, element) {
  const images = [
    ...(element.localName == "img" ? [element] : []),
    ...element.querySelectorAll("img"),
  ].filter((image) => image.checkVisibility(VISIBILITY));
  return (
    images.every((image) => image.complete && image.naturalWidth > 0) &&
    backgroundsLoaded(window, element)
  );
}

// Per document, an image per background picture's address, loading it as
// the page does: complete once the page's own has loaded (or failed).
const backgroundProbes = new WeakMap();
const BACKGROUND_URLS = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;

function backgroundsLoaded(window, root) {
  let probes = backgroundProbes.get(window.document);
  if (!probes) {
    probes = new Map();
    backgroundProbes.set(window.document, probes);
  }
  const elements = [root, ...root.querySelectorAll("*")];
  if (elements.length > MAX_EXTENT_ELEMENTS) {
    return true;
  }
  for (const element of elements) {
    const painted = window.getComputedStyle(element)?.backgroundImage;
    if (!painted?.includes("url(")) {
      continue;
    }
    const { width, height } = element.getBoundingClientRect();
    if (width < MIN_SIDE || height < MIN_SIDE) {
      continue;
    }
    if (!element.checkVisibility(VISIBILITY)) {
      continue;
    }
    for (const [, , url] of painted.matchAll(BACKGROUND_URLS)) {
      let probe = probes.get(url);
      if (!probe) {
        // Ready once decoded, as the page paints it, or once it failed:
        // a picture that never comes is no wait.
        const image = new window.Image();
        probe = { ready: false };
        image.src = url;
        image.decode().then(
          () => (probe.ready = true),
          () => (probe.ready = true),
        );
        probes.set(url, probe);
      }
      if (!probe.ready) {
        return false;
      }
    }
  }
  return true;
}

// The names of what a challenge shows while it loads its task: a spinner,
// a loader, a skeleton.
const LOADER_NAMES =
  /(?:^|[-_\s])(?:loading|loader|spinner|spin|skeleton)(?:$|[-_\s])/i;
// What a challenge draws over its task that is no picture of it:
// GeeTest's "AI detect" scan, always laid over the board.
const OVERLAY_NAMES = /(?:^|[-_\s])ai[-_]?detect(?:$|[-_\s])/i;

// The names of an element, its id and classes.
const namesOf = (element) =>
  `${element.id} ${element.getAttribute?.("class") ?? ""}`;

// Whether an element is named and shown as a loader.
function isLoader(element) {
  return (
    LOADER_NAMES.test(namesOf(element)) && element.checkVisibility(VISIBILITY)
  );
}

// Whether a challenge is still loading its task: a loader shown in it, or
// a picture of it still fading or moving in (pieces that come one by one).
// It is shot once it is past that.
function loading(window, root) {
  const elements = [root, ...root.querySelectorAll("*")];
  if (elements.length > MAX_EXTENT_ELEMENTS) {
    return false;
  }
  for (const element of elements) {
    if (element == root) {
      continue;
    }
    const { width, height } = element.getBoundingClientRect();
    if (width < MIN_SIDE || height < MIN_SIDE) {
      continue;
    }
    if (isLoader(element)) {
      return true;
    }
  }
  return false;
}

// Whether an element is still on its way in: a fade or a slide that ends
// (a spinner that never does is no wait), of it, what it holds, or what
// holds it (hCaptcha fades in the box around its frame). A challenge shot
// mid-fade shows its pictures half drawn.
function arriving(element) {
  const ends = (animation) =>
    animation.playState == "running" &&
    Number.isFinite(animation.effect?.getComputedTiming().endTime);
  try {
    if (element.getAnimations({ subtree: true }).some(ends)) {
      return true;
    }
    // A fade a script runs is no animation; it shows as a box not yet
    // fully opaque.
    let opacity = 1;
    for (let node = element; node; node = node.parentElement) {
      if (node != element && node.getAnimations().some(ends)) {
        return true;
      }
      opacity *= Number(node.ownerGlobal?.getComputedStyle(node)?.opacity ?? 1);
    }
    if (opacity < FADED) {
      return true;
    }
  } catch {
    // An element that is going away.
  }
  return false;
}

// How many pictures big enough to be a challenge's an element shows,
// loaded: what a puzzle that opens shows once it is past its spinner. A
// box painted with a background image (GeeTest's) is one.
function picturesShown(window, element) {
  let count = 0;
  for (const picture of [element, ...element.querySelectorAll("*")]) {
    const tag = picture.localName;
    const painted =
      !["img", "canvas", "video", "image"].includes(tag) &&
      picture.childElementCount <= 1;
    if (!["img", "canvas", "video", "image"].includes(tag) && !painted) {
      continue;
    }
    const { width, height } = picture.getBoundingClientRect();
    if (
      width < PICTURE_SIDE ||
      height < PICTURE_SIDE ||
      !picture.checkVisibility(VISIBILITY) ||
      (painted &&
        !window
          .getComputedStyle(picture)
          ?.backgroundImage.startsWith("url("))
    ) {
      continue;
    }
    if (tag != "img" || (picture.complete && picture.naturalWidth > 0)) {
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
 * @param {boolean} [stay] Report where it is, without scrolling to it:
 *   the page's jump labels are drawn already, and a scroll would move
 *   them off what they name.
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
export function challengeRect(window, stay = false) {
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
      lastTargets.set(document, target);
      // What a page draws reaches as far as its popups; a frame is its box.
      const reach = () =>
        isFrame ? target.getBoundingClientRect() : extentOf(window, target);
      let full = reach();
      if (!stay) {
        target.scrollIntoView({
          block: full.height > window.innerHeight ? "start" : "center",
          inline: "nearest",
          behavior: "instant",
        });
        // A popup under its checkbox may still be out of view: the page is
        // scrolled to the middle of the two, or to their top if they do not
        // fit.
        full = reach();
        if (full.top < 0 || full.bottom > window.innerHeight) {
          window.scrollBy({
            top:
              full.top -
              Math.max(0, (window.innerHeight - full.height) / 2),
            behavior: "instant",
          });
          full = reach();
        }
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
        drawn:
          isFrame ||
          (picturesLoaded(window, target) &&
            !arriving(target) &&
            !loading(window, target)),
        arriving: arriving(target),
        pictures: isFrame ? null : picturesShown(window, target),
        frameId: isFrame ? (element.browsingContext?.id ?? null) : null,
      };
    }
  }
  return null;
}

/**
 * Where a child frame of this window sits, for moving a rect of its
 * document into this window's coordinates: the box of the element that
 * embeds it and the border inside the box, with this window's scroll and
 * view. The jump labels are drawn in the top page, so a shot that shows
 * them is taken there, of a challenge's rect moved up frame by frame.
 * Null when this window does not hold the child.
 *
 * @param {Window} window
 * @param {number} childId The child frame's browsing context id.
 * @returns {{left: number, top: number, clientLeft: number,
 *   clientTop: number, scrollX: number, scrollY: number,
 *   viewWidth: number, viewHeight: number}|null}
 */
export function embedderBox(window, childId) {
  const child = [...(window.browsingContext?.children ?? [])].find(
    (context) => context.id == childId,
  );
  const element = child?.embedderElement;
  if (!element) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  // A frame drawn scaled (a CSS transform, a zoom) shows its document at
  // that scale: a rect of it is scaled on the way up.
  const scaleX = element.offsetWidth ? rect.width / element.offsetWidth : 1;
  const scaleY = element.offsetHeight ? rect.height / element.offsetHeight : 1;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    clientLeft: element.clientLeft ?? 0,
    clientTop: element.clientTop ?? 0,
    scaleX: Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1,
    scaleY: Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    viewWidth: window.innerWidth,
    viewHeight: window.innerHeight,
  };
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

// The checkbox frame of a service (reCAPTCHA, hCaptcha, Yandex, Turnstile),
// from inside it. Never a top page: a service's own website is none. The
// invisible ones have nothing to open.
function frameCheckbox(window, peek) {
  if (window.parent == window) {
    return null;
  }
  const document = window.document;
  const url = document.documentURI ?? "";
  const name = ZendiaCaptcha.nameOf(url);
  const kind = ZendiaCaptcha.kindOf(url);
  if (
    !name ||
    ZendiaCaptcha.isChallenge(url) ||
    (kind != "checkbox" && kind != "managed")
  ) {
    return null;
  }
  if (kind == "managed") {
    return managedCheckbox(window, peek, name);
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

// Every element under a root, those in shadow roots too, open or closed:
// Turnstile draws all of its widget in a closed one.
function* deepElements(root) {
  for (const element of root.querySelectorAll("*")) {
    yield element;
    const shadow = element.openOrClosedShadowRoot;
    if (shadow) {
      yield* deepElements(shadow);
    }
  }
}

// What a managed widget's words say it is at: done and passed, done and
// failed (nothing more comes of it), or still checking.
const MANAGED_PASSED = /^(?:success!?|verified|you are verified)$/i;
const MANAGED_FAILED =
  /^(?:verification (?:failed|expired)|failed|expired|error)\b/i;

// Turnstile's "Verify you are human": a checkbox in a label, shown only
// when Cloudflare wants the click; its other states are words in the same
// widget. A managed check that shows no checkbox is running on its own.
function managedCheckbox(window, peek, name) {
  const document = window.document;
  let control = null;
  for (const element of deepElements(document)) {
    if (
      element.localName == "input" &&
      element.type == "checkbox" &&
      !control
    ) {
      const holder = element.closest("label") ?? element;
      if (clickable(window, holder)) {
        control = holder;
      }
    } else if (
      element.childElementCount == 0 &&
      element.checkVisibility(VISIBILITY)
    ) {
      const words = clean(element.textContent);
      if (MANAGED_PASSED.test(words)) {
        return { passed: true };
      }
      if (MANAGED_FAILED.test(words)) {
        return { done: true };
      }
    }
  }
  if (!control) {
    return null;
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
  // A service's challenge already open in the page (GeeTest's popup over
  // its button) is not clicked open again: a second click could close or
  // renew it.
  if (openWidget(window)) {
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

// A service's widget drawn in the page whose challenge is open: a popup
// the size of one (GeeTest's over its button), not a mask over the whole
// page.
function openWidget(window) {
  const view = window.innerWidth * window.innerHeight;
  return (
    widgetsOf(window, true).find((widget) => {
      const { width, height } = widget.getBoundingClientRect();
      return (
        width >= OPEN_SIDE &&
        height >= OPEN_SIDE &&
        width * height < view * MOSTLY_VIEW &&
        isShown(window, widget)
      );
    }) ?? null
  );
}

// Whether a frame of the page sits inside an element, its shadow roots
// included: Turnstile draws its frame in a closed one.
function holdsFrame(element, frames) {
  return frames.some((frame) => {
    for (let node = frame; node; node = node.parentNode ?? node.host) {
      if (node == element) {
        return true;
      }
    }
    return false;
  });
}

// The kinds of a service's frame that say nothing of their state to the
// page: a checkbox or managed widget reads its own from inside
// (frameState), the others run without the user.
const SELF_READ_KINDS = new Set([
  "checkbox",
  "managed",
  "proof-of-work",
  "score",
  "invisible",
]);

// The state of a service's checkbox frame, read from inside: its box
// ticked or not, a managed widget's words, or its spinner. A challenge
// frame cannot see whether it is shown: the page above says that.
function frameState(window) {
  const url = window.document.documentURI ?? "";
  const name = ZendiaCaptcha.nameOf(url);
  if (ZendiaCaptcha.isChallenge(url)) {
    return { state: "none" };
  }
  const answer = frameCheckbox(window, true);
  if (answer?.passed) {
    return { state: "solved", name, how: `${name} says the check passed` };
  }
  if (answer?.done) {
    return {
      state: "failed",
      name,
      how: `${name} says the check failed or expired`,
    };
  }
  if (answer?.checkbox) {
    return { state: "unchecked", name, how: `${name}'s checkbox is not ticked` };
  }
  // A managed widget with neither words nor a box is still checking, unless
  // it is drawn nowhere: an invisible mode's helper never says more.
  if (
    ZendiaCaptcha.kindOf(url) == "managed" &&
    window.innerWidth >= MIN_SIDE &&
    window.innerHeight >= MIN_SIDE
  ) {
    return { state: "checking", name, how: `${name} is checking on its own` };
  }
  return { state: "none" };
}

// The state of the CAPTCHAs a page shows: the challenges up in it, its
// checkboxes, and the answers solved ones left behind.
function pageState(window) {
  const document = window.document;
  let best = { state: "none" };
  const take = (reading) => {
    if (
      reading.state != best.state &&
      ZendiaCaptcha.stronger(best.state, reading.state) == reading.state
    ) {
      best = reading;
    }
  };
  const frames = framesOf(window);
  for (const frame of frames) {
    const src = srcOf(frame);
    const name = src && ZendiaCaptcha.nameOf(src);
    if (!name || !isShown(window, frame)) {
      continue;
    }
    if (ZendiaCaptcha.isChallenge(src)) {
      take({ state: "open", name, how: `${name}'s challenge is open` });
    } else if (!SELF_READ_KINDS.has(ZendiaCaptcha.kindOf(src))) {
      take({ state: "shown", name, how: `${name} is shown` });
    }
  }
  const own = ownChallenges(window);
  for (const { kind, prompt } of own) {
    if (kind != "checkbox") {
      take({
        state: "open",
        name: "page",
        how: `the page's challenge "${prompt.slice(0, 80)}" is shown`,
      });
    }
  }
  const popup = openWidget(window);
  if (popup && !holdsFrame(popup, frames)) {
    take({ state: "open", name: "widget", how: "a CAPTCHA's popup is open" });
  }
  const checkbox = pageCheckbox(window, true);
  if (checkbox?.checkbox) {
    take({
      state: "unchecked",
      name: "page",
      how: "its checkbox is not ticked",
    });
  } else if (checkbox?.passed) {
    take({ state: "solved", name: "page", how: "its checkbox is ticked" });
  }
  for (const field of document.querySelectorAll(
    "input[name], textarea[name]",
  )) {
    if (field.value && ZendiaCaptcha.isTokenField(field.name)) {
      take({
        state: "solved",
        how: `its answer field ${field.name.slice(0, 64)} is filled`,
      });
    }
  }
  const marked = [];
  for (const widget of document.querySelectorAll(ZendiaCaptcha.SOLVED_MARKS)) {
    if (
      ZendiaCaptcha.marksSolved({
        classes: widget.classList,
        state: widget.dataset.state,
      }) &&
      widget.checkVisibility()
    ) {
      marked.push(widget);
      take({ state: "solved", how: "its widget shows the success mark" });
    }
  }
  // Read nothing else: a widget of the page shown with no frame of its own
  // and no mark of a pass, or a checkbox challenge with no box to read,
  // still asks the user as far as the page tells.
  if (best.state == "none") {
    const shown = widgetsOf(window).some(
      (widget) =>
        isShown(window, widget) &&
        !holdsFrame(widget, frames) &&
        !marked.some((mark) => widget.contains(mark) || mark.contains(widget)),
    );
    if (shown || own.length) {
      take({ state: "shown", name: "page", how: "a CAPTCHA is shown" });
    }
  }
  return best;
}

/**
 * Where the CAPTCHAs of this document are at now, read live: whether one
 * asks the user (a challenge open, a box to tick), runs on its own, or is
 * solved. The watch reports it again whenever it changes, so whoever
 * follows the tab hears of a pass or a new ask without a reload. A
 * service's checkbox frame reads its own box or managed widget from
 * inside; a page reads what it shows and the answers solved ones left.
 *
 * @param {Window} window
 * @returns {{state: string, name?: string, how?: string}} `state` is one
 *   of ZendiaCaptcha.STATES; `how` says it in a few words.
 */
export function captchaState(window) {
  try {
    if (!window.document?.documentElement) {
      return { state: "none" };
    }
    return isCaptchaFrame(window) ? frameState(window) : pageState(window);
  } catch {
    // A window going away, or a page's element that breaks a read.
    return { state: "none" };
  }
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

// Per document, the element challengeRect last chose to shoot, for the
// parts of it the subagent asks for next.
const lastTargets = new WeakMap();

// The words that say what to do, in an instruction no prompt rule knows:
// "Choose all the bags", "Fit the piece to get verified".
const INSTRUCTION_WORDS =
  /\b(?:select|click|tap|pick|choose|drag|slide|move|type|enter|rotate|turn|fit|match|identify|find|solve|complete|press|hold|draw|connect|count|listen)\b/i;
// What a challenge says that is not its instruction.
const NOT_INSTRUCTION =
  /^(?:powered by|privacy|terms|help|feedback|report|reload|refresh|verify|skip|next|submit|confirm|ok|done|apply|select language|english)\b|©/i;
// The most an instruction says, and how much of a challenge it may cover.
const INSTRUCTION_MAX = 300;
const INSTRUCTION_SHARE = 0.45;

// The pictures of a challenge, where a script cannot read what they show:
// images, canvases, videos, big SVGs, and boxes painted with a background
// image (hCaptcha's tiles). Each with the part of it that is seen, for a
// tile is often a whole picture shifted inside a box that cuts it.
function picturesOf(window, root) {
  const pictures = [];
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (pictures.length > MAX_EXTENT_ELEMENTS) {
      break;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < PICTURE_SIDE || rect.height < PICTURE_SIDE) {
      continue;
    }
    const tag = element.localName;
    const picture =
      tag == "img" ||
      tag == "canvas" ||
      tag == "video" ||
      tag == "svg" ||
      (element.childElementCount <= 1 &&
        window.getComputedStyle(element)?.backgroundImage.startsWith("url("));
    // An icon of a button (reload, audio, help) is no picture of the task;
    // a tile that is a button is.
    const icon =
      rect.width < ICON_SIDE &&
      rect.height < ICON_SIDE &&
      element.closest("button, [role=button], a[href]");
    if (
      !picture ||
      icon ||
      isLoader(element) ||
      OVERLAY_NAMES.test(namesOf(element)) ||
      !element.checkVisibility(VISIBILITY)
    ) {
      continue;
    }
    const seen = visibleRect(window, element, rect, { viewport: false });
    if (seen && seen.width >= PICTURE_SIDE && seen.height >= PICTURE_SIDE) {
      pictures.push({ element, rect: seen });
    }
  }
  return pictures;
}

// An instruction's words as one line: "Select all images with" and
// "cars" on lines of their own join as one sentence, the next sentence
// after a stop.
function instructionText(element) {
  const lines = String(element.innerText ?? element.textContent ?? "")
    .split(/\n+/)
    .map((line) => clean(line))
    // A button's "+" or "×" in it says nothing.
    .filter((line) => /[\p{L}\p{N}]/u.test(line));
  let text = "";
  for (const line of lines) {
    if (!text) {
      text = line;
    } else if (/^[A-Z\u00C0-\u00DE]/.test(line) && !/[.!?:]$/.test(text)) {
      text += `. ${line}`;
    } else {
      text += ` ${line}`;
    }
  }
  return text.slice(0, INSTRUCTION_MAX);
}

/**
 * The instruction of a challenge, inside its root: the element whose
 * words say what to do. A prompt a rule knows first ("Select all images
 * with"), then words that say to do something ("Choose all the bags"),
 * then a field's placeholder ("Enter text from image"), then the first
 * words the challenge shows. Taken with the block they are in (the blue
 * header with its example picture), while that block stays a small part
 * of the challenge and holds no more than two of its pictures.
 *
 * @param {Window} window
 * @param {Element} root
 * @param {Element[]} pictures
 * @returns {{element: Element|null, text: string}|null}
 */
function instructionOf(window, root, pictures) {
  const texts = [];
  for (const element of root.querySelectorAll("*")) {
    if (
      element.closest("button, a, select, option, script, style, noscript") ||
      !element.checkVisibility(VISIBILITY)
    ) {
      continue;
    }
    const own = clean(
      [...element.childNodes]
        .filter((node) => node.nodeType == 3)
        .map((node) => node.data)
        .join(" "),
    );
    if (own.length >= 3 && !NOT_INSTRUCTION.test(own)) {
      texts.push({ element, own });
    }
  }
  const kindOf = ({ element, own }) =>
    ZendiaCaptcha.promptKind(own) ?? ZendiaCaptcha.promptKind(element.textContent);
  let found =
    texts.find((text) => kindOf(text) && kindOf(text) != "checkbox") ??
    texts.find(({ own }) => INSTRUCTION_WORDS.test(own));
  if (!found) {
    for (const field of root.querySelectorAll(
      "input[placeholder], textarea[placeholder], input[aria-label]",
    )) {
      const label =
        field.getAttribute("placeholder") || field.getAttribute("aria-label");
      if (INSTRUCTION_WORDS.test(label) && field.checkVisibility(VISIBILITY)) {
        return { element: null, text: clean(label).slice(0, INSTRUCTION_MAX) };
      }
    }
  }
  found ??= texts.find(({ element }) => !ZendiaCaptcha.promptKind(element.textContent));
  if (!found) {
    return null;
  }
  // How much of the challenge the instruction may cover: of all it shows,
  // popups included, for the root may be the checkbox they open from.
  const rootHeight = extentOf(window, root).height || window.innerHeight;
  const held = (element) =>
    pictures.filter((picture) => element.contains(picture)).length;
  // The biggest picture is the challenge's own: an instruction never holds
  // it, whatever example pictures it shows. Unless it is the only one: an
  // example, with the task drawn in no picture yet.
  const biggest =
    pictures.length > 1
      ? pictures
          .map((picture) => {
            const { width, height } = picture.getBoundingClientRect();
            return { picture, size: width * height };
          })
          .sort((a, b) => b.size - a.size)[0]?.picture
      : null;
  let block = found.element;
  for (
    let node = block.parentElement;
    node && node != root && root.contains(node);
    node = node.parentElement
  ) {
    const { height } = node.getBoundingClientRect();
    if (
      clean(node.textContent).length > INSTRUCTION_MAX ||
      height > rootHeight * INSTRUCTION_SHARE ||
      held(node) > 2 ||
      (biggest && node.contains(biggest)) ||
      node.querySelector("[role=slider], input:not([type=hidden]), textarea")
    ) {
      break;
    }
    block = node;
  }
  return { element: block, text: instructionText(block) };
}

// The biggest part of a challenge that is not its instruction, nor holds
// it, nor is nearly all of the challenge: where its task is drawn, when no
// picture says so.
function taskAreaOf(window, root, instruction) {
  const whole = extentOf(window, root);
  let best = null;
  for (const element of root.querySelectorAll("*")) {
    if (
      element.contains(instruction) ||
      instruction.contains(element) ||
      element.closest("button, a, form > input")
    ) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    const size = rect.width * rect.height;
    if (
      rect.width < TASK_SIDE ||
      rect.height < TASK_SIDE ||
      size > whole.width * whole.height * MOSTLY_VIEW ||
      size <= (best?.size ?? 0) ||
      !element.checkVisibility(VISIBILITY)
    ) {
      continue;
    }
    best = { element, rect, size };
  }
  return best && { element: best.element, rect: best.rect };
}

// The box a challenge's pictures sit on together: the nearest element
// holding every one of them, within the challenge's root. Where that box
// is too much (it holds the instruction, or is bigger than a challenge), a
// stray picture is to blame — a logo, the button the challenge opened
// from — and the box of the pictures alike in size (a board's pieces, a
// grid's tiles) is tried instead. None for a single picture, its own area.
function boardOf(window, root, elements, instruction) {
  const box = (members) => {
    if (members.length < 2) {
      return null;
    }
    let common = members[0].parentElement;
    while (common && !members.every((element) => common.contains(element))) {
      common = common.parentElement;
    }
    if (
      !common ||
      !(common == root || root.contains(common)) ||
      (instruction && common.contains(instruction)) ||
      !common.checkVisibility(VISIBILITY)
    ) {
      return null;
    }
    const whole = common.getBoundingClientRect();
    if (whole.width > BOX_MAX_WIDTH || whole.height > BOX_MAX_HEIGHT) {
      return null;
    }
    const rect = visibleRect(window, common, whole, { viewport: false });
    return rect && { element: common, rect };
  };
  const found = box(elements);
  if (found) {
    return found;
  }
  // The size most of the pictures share, within a quarter.
  const sizes = elements.map((element) => {
    const { width, height } = element.getBoundingClientRect();
    return { element, size: width * height };
  });
  const near = (a, b) => Math.abs(a - b) <= Math.max(a, b) / 4;
  let alike = [];
  for (const { size } of sizes) {
    const group = sizes.filter((other) => near(other.size, size));
    if (group.length > alike.length) {
      alike = group;
    }
  }
  return alike.length < elements.length
    ? box(alike.map(({ element }) => element))
    : null;
}

// The area's pictures, replaced by the board they sit on where there is
// one (boardOf).
function onBoard(window, root, area, instruction) {
  const board = boardOf(
    window,
    root,
    area.map(({ element }) => element),
    instruction,
  );
  if (board) {
    area.splice(0, area.length, board);
  }
}

/**
 * A challenge in two parts, for a picture of each and the words of one:
 * its instruction (what it asks, read from its text) and the area to act
 * on (the pictures: the grid, the puzzle, the distorted text; a slider
 * with its track). Read in a CAPTCHA's own frame from its whole document,
 * in a page from what challengeRect last chose there. Rects are in this
 * window's viewport, cut to it.
 *
 * @param {Window} window
 * @returns {{area: {left: number, top: number, width: number, height: number},
 *   instruction: {text: string, rect: object|null, pictures: number}|null,
 *   viewWidth: number, viewHeight: number, scrollX: number,
 *   scrollY: number}|null} Null when nothing in it is a picture.
 */
export function challengeParts(window) {
  const document = window.document;
  const last = lastTargets.get(document);
  let root = null;
  if (last?.isConnected) {
    root = last;
  } else if (isCaptchaFrame(window)) {
    root = document.body;
  }
  if (!root) {
    return null;
  }
  const pictures = picturesOf(window, root);
  const instruction = instructionOf(
    window,
    root,
    pictures.map(({ element }) => element),
  );
  const inInstruction = (element) =>
    !!instruction?.element?.contains(element);
  const area = pictures.filter(({ element }) => !inInstruction(element));
  if (!area.length && instruction?.element) {
    // Nothing a script can tell for a picture (a challenge drawn in a way
    // no element shows, or still loading its pictures): the biggest part
    // of the challenge apart from its instruction is where they go.
    const fallback = taskAreaOf(window, root, instruction.element);
    if (fallback) {
      area.push(fallback);
    }
  }
  if (!area.length) {
    return null;
  }
  // The area is the board the pictures sit on, not the pictures alone: a
  // board's empty places (Gobang's cells, a grid's blank tiles) are no
  // pictures, and the union of the filled ones leaves rows of the board
  // out.
  onBoard(window, root, area, instruction?.element ?? null);
  // Which of the area's parts are pictures, before a slider's track joins.
  const picturesOnly = new Set(area.map(({ element }) => element));
  // A slider is shot with its track, which is no picture.
  for (const control of root.querySelectorAll(
    "[role=slider], [class*=slider], [class*=track], [class*=handle]",
  )) {
    const rect = control.getBoundingClientRect();
    if (
      !inInstruction(control) &&
      rect.width >= MIN_SIDE &&
      rect.height >= MIN_SIDE &&
      rect.width <= BOX_MAX_WIDTH &&
      control.checkVisibility(VISIBILITY)
    ) {
      area.push({ element: control, rect });
    }
  }
  // Neither part reaches past the challenge: in a page, what it draws (its
  // popups included); in its own frame, the frame's view. A slider's strip
  // wider than its popup would bring the page behind in.
  const view = {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  };
  let bounds = view;
  if (root != document.body) {
    const drawn = extentOf(window, root);
    bounds = {
      left: Math.max(view.left, drawn.left),
      top: Math.max(view.top, drawn.top),
      right: Math.min(view.right, drawn.right),
      bottom: Math.min(view.bottom, drawn.bottom),
    };
  }
  const union = (rects) => {
    const left = Math.max(bounds.left, Math.min(...rects.map((r) => r.left)));
    const top = Math.max(bounds.top, Math.min(...rects.map((r) => r.top)));
    const right = Math.min(
      bounds.right,
      Math.max(...rects.map((r) => r.left + r.width)),
    );
    const bottom = Math.min(
      bounds.bottom,
      Math.max(...rects.map((r) => r.top + r.height)),
    );
    return right > left && bottom > top
      ? { left, top, width: right - left, height: bottom - top }
      : null;
  };
  let areaRect = union(area.map(({ rect }) => rect));
  if (!areaRect) {
    return null;
  }
  // The area stops where the instruction starts: a picture under the
  // header (GeeTest's), or a box drawn behind both (hCaptcha's), would
  // take the instruction in again. An instruction between the picture and
  // its slider (DataDome's "Slide right…") splits the area: the side with
  // more of the pictures is kept, whichever way the two sit.
  const told = instruction?.element?.getBoundingClientRect();
  if (
    told &&
    told.right > areaRect.left &&
    told.left < areaRect.left + areaRect.width &&
    told.bottom > areaRect.top &&
    told.top < areaRect.top + areaRect.height
  ) {
    const right = areaRect.left + areaRect.width;
    const bottom = areaRect.top + areaRect.height;
    // The ways to cut the instruction off: what is above it, below it, left
    // of it or right of it, each as a rect of the area.
    const cuts = [
      { ...areaRect, height: Math.max(0, told.top - areaRect.top) },
      {
        ...areaRect,
        top: Math.min(bottom, told.bottom),
        height: Math.max(0, bottom - Math.min(bottom, told.bottom)),
      },
      { ...areaRect, width: Math.max(0, told.left - areaRect.left) },
      {
        ...areaRect,
        left: Math.min(right, told.right),
        width: Math.max(0, right - Math.min(right, told.right)),
      },
    ];
    const picturesIn = (cut) =>
      area.reduce((sum, { element, rect }) => {
        if (!picturesOnly.has(element)) {
          return sum;
        }
        const wide =
          Math.min(cut.left + cut.width, rect.left + rect.width) -
          Math.max(cut.left, rect.left);
        const tall =
          Math.min(cut.top + cut.height, rect.top + rect.height) -
          Math.max(cut.top, rect.top);
        return sum + Math.max(0, wide) * Math.max(0, tall);
      }, 0);
    const kept = cuts
      .filter(({ width, height }) => width >= MIN_SIDE && height >= MIN_SIDE)
      .sort((a, b) => picturesIn(b) - picturesIn(a))[0];
    if (kept && picturesIn(kept) > 0) {
      areaRect = kept;
    }
  }
  // A little room around each part, inside the challenge still, and for
  // the area never into the instruction it was cut from.
  const pad = (rect, keepOut = null) => {
    let room =
      rect &&
      union([
        {
          left: rect.left - PART_ROOM,
          top: rect.top - PART_ROOM,
          width: rect.width + 2 * PART_ROOM,
          height: rect.height + 2 * PART_ROOM,
        },
      ]);
    if (room && keepOut) {
      let { left, top } = room;
      let right = left + room.width;
      let bottom = top + room.height;
      const overlaps = () =>
        keepOut.right > left &&
        keepOut.left < right &&
        keepOut.bottom > top &&
        keepOut.top < bottom;
      if (overlaps() && keepOut.bottom <= rect.top + 1) {
        top = Math.max(top, keepOut.bottom);
      }
      if (overlaps() && keepOut.top >= rect.top + rect.height - 1) {
        bottom = Math.min(bottom, keepOut.top);
      }
      if (overlaps() && keepOut.right <= rect.left + 1) {
        left = Math.max(left, keepOut.right);
      }
      if (overlaps() && keepOut.left >= rect.left + rect.width - 1) {
        right = Math.min(right, keepOut.left);
      }
      room = { left, top, width: right - left, height: bottom - top };
    }
    return room;
  };
  let said = null;
  if (instruction?.text) {
    const element = instruction.element;
    said = {
      text: instruction.text,
      rect: element ? pad(union([element.getBoundingClientRect()])) : null,
      pictures: element
        ? pictures.filter((picture) => element.contains(picture.element))
            .length
        : 0,
    };
  }
  return {
    area: pad(areaRect, told ?? null),
    // Whether it still shows a loader, or pictures on their way in: the
    // parts are shot once it does not.
    loading: loading(window, root),
    // Where every picture is, for telling a challenge that holds still
    // from one whose tiles a script is still moving in.
    still: pictures
      .map(({ rect }) =>
        [rect.left, rect.top, rect.width, rect.height].map(Math.round).join(),
      )
      .join("|"),
    instruction: said,
    viewWidth: window.innerWidth,
    viewHeight: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
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
  if (
    document.readyState != "complete" ||
    !body ||
    arriving(document.documentElement) ||
    loading(window, body)
  ) {
    return { drawn: false };
  }
  const images = [...(document.images ?? [])].filter((image) =>
    image.checkVisibility(VISIBILITY),
  );
  if (!backgroundsLoaded(window, body)) {
    return { drawn: false };
  }
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
// How often a page with a CAPTCHA reads its state again, for what changes
// with no change the observer sees: words in a closed shadow root
// (Turnstile's "Success!"), an answer field a script fills.
const STATE_POLL_MS = 1500;

const WATCHED = new Set(["iframe", "frame", "script", "input", "textarea"]);
// And a checkbox ticked, or a widget's state: the CAPTCHA's state changed.
const SHOWN_BY = [
  "style",
  "class",
  "hidden",
  "open",
  "aria-hidden",
  "aria-checked",
  "data-state",
];

// What a report of a page with no CAPTCHA would carry.
const NOTHING = JSON.stringify([[], { state: "none" }]);

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
  #stateTimer = null;
  // What was last reported, so a look that finds the same says nothing,
  // and one that finds the CAPTCHA gone says so.
  #sent = NOTHING;
  // The state last reported, for the poll to tell a change by.
  #state = "";

  handleEvent(event) {
    switch (event.type) {
      case "pageshow":
        this.#scan({ force: true });
        this.#watch();
        break;
      case "pagehide":
        this.#unwatch();
        this.#sent = NOTHING;
        this.#state = "";
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
      return challengeRect(this.contentWindow, message.data?.stay === true);
    }
    if (message.name == "Zendia:CaptchaWatch:Embedder") {
      return embedderBox(this.contentWindow, message.data?.childId);
    }
    if (message.name == "Zendia:CaptchaWatch:Open") {
      return openChallenge(this.contentWindow, message.data?.peek === true);
    }
    if (message.name == "Zendia:CaptchaWatch:Parts") {
      return challengeParts(this.contentWindow);
    }
    if (message.name == "Zendia:CaptchaWatch:Drawn") {
      return challengeDrawn(this.contentWindow, message.data?.any === true);
    }
    if (message.name == "Zendia:CaptchaWatch:State") {
      return captchaState(this.contentWindow);
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
    const state = captchaState(this.contentWindow);
    const found = detections.length || state.state != "none";
    const sent = JSON.stringify([detections, state]);
    if (force ? found : sent != this.#sent) {
      this.sendAsyncMessage("Zendia:CaptchaWatch:Report", {
        url: this.document.documentURI,
        detections,
        state,
      });
    }
    this.#sent = sent;
    this.#state = JSON.stringify(state);
    this.#followState(found);
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

  // While the page holds a CAPTCHA, its state is read again now and then,
  // and the page looked at again when it changed: a pass, an expiry or a
  // new ask is reported as it happens, with no reload.
  #followState(found) {
    const window = this.contentWindow;
    if (!found || !window) {
      window?.clearInterval(this.#stateTimer);
      this.#stateTimer = null;
      return;
    }
    if (this.#stateTimer) {
      return;
    }
    this.#stateTimer = window.setInterval(() => {
      if (
        this.document &&
        JSON.stringify(captchaState(this.contentWindow)) != this.#state
      ) {
        this.#scan();
      }
    }, STATE_POLL_MS);
  }

  #unwatch() {
    this.#observer?.disconnect();
    this.#observer = null;
    try {
      const window = this.contentWindow;
      window?.clearTimeout(this.#timer);
      window?.clearTimeout(this.#reshowTimer);
      window?.clearInterval(this.#stateTimer);
      for (const timer of this.#lateTimers) {
        window?.clearTimeout(timer);
      }
    } catch {
      // The window is already gone.
    }
    this.#timer = null;
    this.#reshowTimer = null;
    this.#stateTimer = null;
    this.#lateTimers = [];
  }
}
