// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// A part of the page to ask a chat site about, cut out of the screen: what
// cannot be selected or right-clicked, a chart drawn on a canvas, a scanned
// PDF, a game. The mouse drags a box over the tab; Enter takes all of it and
// Esc lets it go.

const HTML_NS = "http://www.w3.org/1999/xhtml";
const MIN_SIDE = 8;

/**
 * Let the user mark a part of a tab.
 *
 * @param {Window} window A browser window.
 * @param {Element} browser The tab's browser.
 * @returns {Promise<{x: number, y: number, width: number, height: number}|null>}
 *   The part in the page's viewport, in the page's CSS pixels.
 */
export function pickRegion(window, browser) {
  const document = window.document;
  const bounds = browser.getBoundingClientRect();
  const zoom = browser.fullZoom || 1;
  const { promise, resolve } = Promise.withResolvers();

  const layer = document.createElementNS(HTML_NS, "div");
  layer.className = "zendia-region";
  layer.tabIndex = -1;
  layer.setAttribute("role", "application");
  layer.setAttribute(
    "aria-label",
    "Drag over what to ask about. Enter takes the whole view, Escape cancels."
  );
  Object.assign(layer.style, {
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
  });
  const box = document.createElementNS(HTML_NS, "div");
  box.className = "zendia-region-box";
  box.hidden = true;
  const hint = document.createElementNS(HTML_NS, "div");
  hint.className = "zendia-region-hint";
  hint.textContent =
    "Drag over what to ask about · Enter takes the whole view · Esc cancels";
  layer.append(box, hint);
  (
    document.getElementById("zen-main-app-wrapper") ?? document.documentElement
  ).append(layer);
  layer.focus();

  let start = null;
  let rect = null;
  const done = value => {
    layer.remove();
    window.removeEventListener("blur", cancel);
    resolve(value);
  };
  const cancel = () => done(null);
  const inLayer = event => ({
    x: Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width),
    y: Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height),
  });
  const toPage = ({ x, y, width, height }) => ({
    x: x / zoom,
    y: y / zoom,
    width: width / zoom,
    height: height / zoom,
  });

  layer.addEventListener("pointerdown", event => {
    if (event.button != 0) {
      cancel();
      return;
    }
    event.preventDefault();
    try {
      layer.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser does not track: the drag stays in the tab.
    }
    start = inLayer(event);
    rect = null;
  });
  layer.addEventListener("pointermove", event => {
    if (!start) {
      return;
    }
    const at = inLayer(event);
    rect = {
      x: Math.min(start.x, at.x),
      y: Math.min(start.y, at.y),
      width: Math.abs(at.x - start.x),
      height: Math.abs(at.y - start.y),
    };
    box.hidden = false;
    hint.hidden = true;
    layer.toggleAttribute("drawing", true);
    Object.assign(box.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  });
  layer.addEventListener("pointerup", () => {
    if (!start) {
      return;
    }
    start = null;
    if (rect && rect.width >= MIN_SIDE && rect.height >= MIN_SIDE) {
      done(toPage(rect));
    } else {
      box.hidden = true;
      hint.hidden = false;
      layer.removeAttribute("drawing");
    }
  });
  layer.addEventListener("contextmenu", event => {
    event.preventDefault();
    cancel();
  });
  layer.addEventListener("keydown", event => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key == "Escape") {
      cancel();
    } else if (event.key == "Enter") {
      done(toPage({ x: 0, y: 0, width: bounds.width, height: bounds.height }));
    }
  });
  window.addEventListener("blur", cancel, { once: true });
  return promise;
}
