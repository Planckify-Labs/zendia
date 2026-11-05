/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// The motion primitives in a real chrome window: the rolling word, the
// streaming veil and the working ring.

const { Veil, WorkingRing, reducedMotion, rollText } =
  ChromeUtils.importESModule(
    "resource:///modules/lazyvimium/ui/LazyvimiumAgentMotion.sys.mjs"
  );

const XHTML = "http://www.w3.org/1999/xhtml";

function h(tag, ...children) {
  const element = document.createElementNS(XHTML, tag);
  element.append(...children);
  return element;
}

// A stage that is on screen, so layout, animations and the visibility
// observer behave as they do in the browser.
function stage() {
  const element = h("div");
  element.style.cssText =
    "position: fixed; top: 80px; left: 80px; z-index: 100000;" +
    "font: 20px monospace; background: white; color: black;";
  document.documentElement.appendChild(element);
  registerCleanupFunction(() => element.remove());
  return element;
}

const glyphs = element => [
  ...element.querySelectorAll(".lazyvimium-roll-glyph"),
];

function assertPlain(element, text, message) {
  Assert.equal(element.textContent, text, `${message}: text`);
  Assert.equal(element.childNodes.length, 1, `${message}: one child`);
  Assert.equal(element.firstChild.nodeType, Node.TEXT_NODE, `${message}: text`);
  Assert.equal(glyphs(element).length, 0, `${message}: no glyph spans`);
  Assert.equal(element.dataset.rollText, text, `${message}: logical text`);
}

add_task(async function test_roll_first_call_is_plain() {
  const root = stage();
  const word = h("span");
  root.append(word);
  rollText(word, "Thinking…");
  assertPlain(word, "Thinking…", "first call");
  Assert.equal(word.getAnimations().length, 0, "nothing animates");

  const empty = h("span");
  root.append(empty);
  rollText(empty, "");
  rollText(empty, "Reading…");
  assertPlain(empty, "Reading…", "empty old text");
  Assert.equal(empty.getAnimations().length, 0, "an empty word does not roll");

  rollText(word, "Thinking…");
  assertPlain(word, "Thinking…", "same text");
  Assert.equal(word.getAnimations({ subtree: true }).length, 0);
  root.remove();
});

add_task(async function test_roll_changes_only_the_middle() {
  const root = stage();
  const label = h("span");
  root.append(label);
  rollText(label, "Read it");
  rollText(label, "Seed it");

  Assert.equal(label.dataset.rollText, "Seed it", "the logical text is kept");
  const spans = glyphs(label);
  Assert.deepEqual(
    spans.map(span => span.textContent).sort(),
    ["R", "S", "a", "e", "e", "e"],
    "'Rea' out and 'See' in; the shared 'd it' does not roll"
  );
  Assert.ok(
    [...label.childNodes].some(
      node => node.nodeType === Node.TEXT_NODE && node.data === "d it"
    ),
    "as one plain text node"
  );
  Assert.greaterOrEqual(
    label.getAnimations({ subtree: true }).length,
    2,
    "the glyphs animate"
  );

  await TestUtils.waitForCondition(
    () => !label.querySelector(".lazyvimium-roll-glyph"),
    "the roll ends"
  );
  assertPlain(label, "Seed it", "after the roll");
  Assert.equal(label.style.overflow, "", "styles are given back");
  Assert.equal(label.style.whiteSpace, "");
  Assert.equal(label.style.display, "");
  root.remove();
});

add_task(async function test_roll_in_a_block_that_changes_width() {
  const root = stage();
  const label = h("div");
  label.style.display = "inline-block";
  root.append(label);
  rollText(label, "Hi");
  rollText(label, "Hello there");
  Assert.ok(glyphs(label).length > 0, "rolling");
  const widthAnimation = label
    .getAnimations()
    .find(animation => animation.effect.getTiming().duration === 200);
  Assert.ok(widthAnimation, "the width glides over 200 ms");
  await TestUtils.waitForCondition(
    () => !glyphs(label).length,
    "the roll ends"
  );
  assertPlain(label, "Hello there", "after the roll");
  root.remove();
});

add_task(async function test_roll_survives_being_called_mid_roll() {
  const root = stage();
  const label = h("span");
  root.append(label);
  rollText(label, "Alpha one");
  rollText(label, "Alpha two");
  Assert.equal(glyphs(label).length, 6, "three glyphs out, three in");
  rollText(label, "Alpha six");
  Assert.equal(label.dataset.rollText, "Alpha six");
  Assert.equal(
    glyphs(label).length,
    6,
    "the old roll is gone: only 'two' leaving and 'six' arriving"
  );
  Assert.deepEqual(
    glyphs(label)
      .map(span => span.textContent)
      .sort(),
    ["i", "o", "s", "t", "w", "x"],
    "no glyph of 'one' is left over"
  );
  rollText(label, "Alpha six");
  Assert.equal(glyphs(label).length, 0, "the same text cancels the roll");
  assertPlain(label, "Alpha six", "same text mid-roll");

  rollText(label, "Beta");
  rollText(label, "Gamma");
  rollText(label, "Delta");
  await TestUtils.waitForCondition(
    () => !glyphs(label).length,
    "the last roll ends"
  );
  assertPlain(label, "Delta", "after three quick changes");
  Assert.equal(
    label.getAnimations({ subtree: true }).length,
    0,
    "no animation is left"
  );
  root.remove();
});

add_task(async function test_roll_text_is_plain_when_not_connected() {
  const label = h("span");
  rollText(label, "one");
  rollText(label, "two");
  assertPlain(label, "two", "a detached element");
});

// Rows the way the dock renders them: every render replaces the children.
function render(row, ...children) {
  row.replaceChildren(...children);
}
const veilSpans = row => [...row.querySelectorAll("span.lazyvimium-veil")];
const spanTexts = row => veilSpans(row).map(span => span.textContent);

add_task(async function test_veil_wraps_only_the_new_suffix() {
  const root = stage();
  const veil = new Veil(window);
  const row = h("div");
  root.append(row);

  render(row, h("p", "Hello"));
  veil.update(row);
  Assert.equal(veilSpans(row).length, 0, "the first update never fades");

  render(row, h("p", "Hello world"));
  veil.update(row);
  Assert.deepEqual(spanTexts(row), [" world"], "only the new suffix");
  Assert.equal(row.textContent, "Hello world", "the text is untouched");
  const animation = veilSpans(row)[0].getAnimations()[0];
  Assert.equal(animation.effect.getTiming().duration, 400, "first chunk");
  Assert.equal(
    animation.effect.getKeyframes().length,
    9,
    "the nine alpha keyframes"
  );
  Assert.ok(
    animation.effect.getKeyframes().every(frame => !("transform" in frame)),
    "it only fades, nothing moves"
  );

  await TestUtils.waitForCondition(
    () => !veilSpans(row).length,
    "the fade ends and the wrapper goes"
  );
  Assert.equal(row.textContent, "Hello world");
  render(row, h("p", "Hello world"));
  veil.update(row);
  Assert.equal(veilSpans(row).length, 0, "a settled chunk never fades again");
  root.remove();
});

add_task(async function test_veil_redraw_continues_the_fade() {
  const root = stage();
  const veil = new Veil(window);
  const row = h("div");
  root.append(row);
  render(row, h("p", "Hello"));
  veil.update(row);
  render(row, h("p", "Hello world"));
  veil.update(row);

  const firstSpan = veilSpans(row)[0];
  const first = firstSpan.getAnimations()[0];
  await TestUtils.waitForCondition(
    () => first.currentTime > 60,
    "the fade advances"
  );
  const before = first.currentTime;
  Assert.less(before, 400, "still fading");

  // The dock renders the same text again, which drops the span.
  render(row, h("p", "Hello world"));
  Assert.equal(veilSpans(row).length, 0, "a render drops the wrappers");
  veil.update(row);
  Assert.deepEqual(spanTexts(row), [" world"], "update puts the fade back");
  const second = veilSpans(row)[0].getAnimations()[0];
  Assert.notEqual(second, first, "a new animation");
  Assert.greaterOrEqual(
    second.currentTime,
    before,
    "it continues where the fade was, not from zero"
  );
  const resumed = second.currentTime;
  await TestUtils.waitForCondition(
    () => second.currentTime > resumed + 20,
    "and keeps advancing"
  );

  // Another update without a render does not stack wrappers.
  veil.update(row);
  veil.update(row);
  Assert.ok(veilSpans(row).length <= 1, "no nested wrappers");
  Assert.equal(row.textContent, "Hello world");
  root.remove();
});

add_task(async function test_veil_appends_rewrites_and_baseline() {
  const root = stage();
  const veil = new Veil(window);
  const row = h("div");
  root.append(row);

  render(row, h("p", "Hello"));
  veil.update(row);
  render(row, h("p", "Hello world"));
  veil.update(row);
  render(row, h("p", "Hello world again"));
  veil.update(row);
  Assert.deepEqual(
    spanTexts(row),
    [" world", " again"],
    "both chunks fade, the settled head does not"
  );
  Assert.equal(row.textContent, "Hello world again");

  // The parser rewrote part of the tail: the fades of the common prefix stay
  // and only the changed tail is veiled again.
  render(row, h("p", "Hello wor!"));
  veil.update(row);
  Assert.deepEqual(
    spanTexts(row).sort(),
    ["!", " wor"].sort(),
    "the prefix keeps its fade, the changed tail fades anew"
  );

  // Baseline: text already on screen must not dissolve.
  render(row, h("p", "Hello wor! and a whole lot more that was already here"));
  veil.update(row, { baseline: true });
  Assert.equal(veilSpans(row).length, 0, "baseline records without a fade");
  render(row, h("p", "Hello wor! and a whole lot more that was already here."));
  veil.update(row);
  Assert.deepEqual(spanTexts(row), ["."], "only what comes after the baseline");
  root.remove();
});

add_task(async function test_veil_across_nodes_and_buttons() {
  const root = stage();
  const veil = new Veil(window);
  const row = h("div");
  root.append(row);

  const copy = () => h("button", "Copy");
  render(row, h("p", "Hello "), copy());
  veil.update(row);
  render(row, h("p", "Hello ", h("b", "bold"), " end"), copy());
  veil.update(row);
  Assert.deepEqual(spanTexts(row), ["bold", " end"], "across inline nodes");
  Assert.equal(row.querySelector("b").firstChild.className, "lazyvimium-veil");
  Assert.equal(
    row.querySelector("button span"),
    null,
    "text in a button is left alone"
  );

  // The button's own text changing is not new text.
  await TestUtils.waitForCondition(
    () => !veilSpans(row).length,
    "the fades end"
  );
  render(row, h("p", "Hello ", h("b", "bold"), " end"), h("button", "Copied"));
  veil.update(row);
  Assert.equal(veilSpans(row).length, 0, "a button label does not fade");
  root.remove();
});

add_task(async function test_veil_clear() {
  const root = stage();
  const veil = new Veil(window);
  const row = h("div");
  root.append(row);
  render(row, h("p", "Hello"));
  veil.update(row);
  render(row, h("p", "Hello world"));
  veil.update(row);
  Assert.equal(veilSpans(row).length, 1);
  veil.clear(row);
  Assert.equal(veilSpans(row).length, 0, "clear leaves no spans");
  Assert.equal(row.textContent, "Hello world");
  Assert.equal(row.getAnimations({ subtree: true }).length, 0);

  // The row is forgotten: its next update is a first one again.
  render(row, h("p", "Hello world, more"));
  veil.update(row);
  Assert.equal(
    veilSpans(row).length,
    0,
    "forgotten rows start from a baseline"
  );
  veil.clear(row);
  veil.clear(h("div"));
  root.remove();
});

add_task(async function test_veil_empty_first_row_fades_what_comes() {
  const root = stage();
  const veil = new Veil(window);
  const row = h("div");
  root.append(row);
  render(row);
  veil.update(row);
  render(row, h("p", "First words"));
  veil.update(row);
  Assert.deepEqual(
    spanTexts(row),
    ["First words"],
    "text after an empty start"
  );
  veil.clear(row);
  root.remove();
});

// A window for the ring that counts its frame requests. The browser asks for
// frames too, so counting on the real window would count its own.
function countedWindow() {
  const counter = { calls: 0 };
  counter.window = {
    document: window.document,
    get devicePixelRatio() {
      return window.devicePixelRatio;
    },
    matchMedia: query => window.matchMedia(query),
    getComputedStyle: element => window.getComputedStyle(element),
    IntersectionObserver: window.IntersectionObserver,
    requestAnimationFrame(callback) {
      counter.calls++;
      return window.requestAnimationFrame(callback);
    },
    cancelAnimationFrame: id => window.cancelAnimationFrame(id),
  };
  return counter;
}

// True once no new frame was requested since the last time it was asked.
function quiet(counter) {
  let previous = -1;
  return () => {
    const same = counter.calls === previous;
    previous = counter.calls;
    return same;
  };
}

function painted(canvas) {
  const data = canvas
    .getContext("2d")
    .getImageData(0, 0, canvas.width, canvas.height).data;
  let max = { alpha: 0, red: 0, green: 0 };
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > max.alpha) {
      max = { alpha: data[i + 3], red: data[i], green: data[i + 1] };
    }
  }
  return max;
}

add_task(async function test_ring_paints_and_stops_when_removed() {
  const root = stage();
  const frames = countedWindow();
  const ring = new WorkingRing(frames.window, { size: 16 });
  const canvas = ring.element;
  Assert.equal(canvas.localName, "canvas");
  Assert.ok(canvas.classList.contains("lazyvimium-working-ring"));
  const dpr = window.devicePixelRatio || 1;
  Assert.equal(canvas.width, Math.round(16 * dpr), "sized for the pixel ratio");
  Assert.equal(canvas.height, Math.round(16 * dpr));
  Assert.equal(canvas.style.width, "16px", "laid out at 16 CSS pixels");

  canvas.style.color = "rgb(200, 40, 40)";
  root.append(canvas);
  ring.start();
  const mark = painted(canvas);
  Assert.greater(mark.alpha, 0, "something is painted");
  Assert.greater(mark.red, mark.green, "in the element's color");

  const rest = canvas.toDataURL();
  await TestUtils.waitForCondition(
    () => frames.calls > 3,
    "the loop requests frames"
  );
  await TestUtils.waitForCondition(
    () => canvas.toDataURL() !== rest,
    "the dashes move during the run"
  );
  Assert.greater(painted(canvas).alpha, 0, "still painted");

  // Offscreen: no frames.
  canvas.remove();
  await TestUtils.waitForCondition(
    quiet(frames),
    "the loop stops when the canvas is removed",
    200,
    50
  );
  root.append(canvas);
  const stopped = frames.calls;
  await TestUtils.waitForCondition(
    () => frames.calls > stopped + 2,
    "and resumes when it is visible again"
  );

  ring.stop();
  await TestUtils.waitForCondition(
    quiet(frames),
    "stop ends the loop",
    200,
    50
  );
  ring.destroy();
  Assert.ok(!canvas.isConnected, "destroy removes the canvas");
  root.remove();
});

add_task(async function test_reduced_motion() {
  await SpecialPowers.pushPrefEnv({
    set: [["ui.prefersReducedMotion", 1]],
  });
  await TestUtils.waitForCondition(
    () => reducedMotion(window),
    "reduced motion is on"
  );
  const root = stage();

  const label = h("span");
  root.append(label);
  rollText(label, "Thinking…");
  rollText(label, "Reading…");
  assertPlain(label, "Reading…", "no roll");
  Assert.equal(label.getAnimations({ subtree: true }).length, 0);

  const veil = new Veil(window);
  const row = h("div");
  root.append(row);
  render(row, h("p", "Hello"));
  veil.update(row);
  render(row, h("p", "Hello world"));
  veil.update(row);
  Assert.equal(veilSpans(row).length, 0, "no veil");

  const frames = countedWindow();
  const ring = new WorkingRing(frames.window, { size: 16 });
  root.append(ring.element);
  ring.start();
  Assert.greater(painted(ring.element).alpha, 0, "the even dashes are drawn");
  const image = ring.element.toDataURL();
  await new Promise(resolve => setTimeout(resolve, 400));
  Assert.equal(frames.calls, 0, "no loop");
  Assert.equal(ring.element.toDataURL(), image, "and no change");
  ring.destroy();
  root.remove();

  await SpecialPowers.popPrefEnv();
  await TestUtils.waitForCondition(
    () => !reducedMotion(window),
    "reduced motion is off again"
  );
});
