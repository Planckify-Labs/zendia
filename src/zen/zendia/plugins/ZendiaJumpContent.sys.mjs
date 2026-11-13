// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { ZendiaCaptcha } from "resource:///modules/zendia/core/ZendiaCaptcha.sys.mjs";
import { ZendiaControls } from "resource:///modules/zendia/core/ZendiaControls.sys.mjs";
import { ZendiaDom } from "resource:///modules/zendia/core/ZendiaDom.sys.mjs";
import {
  assignLabels,
  findMatches,
} from "resource:///modules/zendia/core/ZendiaJumpLabels.sys.mjs";
import { ZendiaPageText } from "resource:///modules/zendia/core/ZendiaPageText.sys.mjs";
import { ZendiaKeys } from "resource:///modules/zendia/core/ZendiaKeys.sys.mjs";
import { hintLabels } from "resource:///modules/zendia/ui/ZendiaHints.sys.mjs";
import { LABELS } from "resource:///modules/zendia/ui/ZendiaPicker.sys.mjs";
import {
  askFrame,
  captchaAreas,
  PointerPad,
  plainRect,
} from "resource:///modules/zendia/plugins/ZendiaPointerContent.sys.mjs";
import { reveal } from "resource:///modules/zendia/plugins/ZendiaVisualContent.sys.mjs";

const HTML_NS = "http://www.w3.org/1999/xhtml";

// The colors of the browser's own jump labels, and a blue for paragraphs.
const LABEL_BACKGROUND = "#a25772";
const PARAGRAPH_BACKGROUND = "#3d59a1";
const LABEL_TEXT = "#eef5ff";
// The letters of a label already pressed: the palette's yellow and ink.
const TYPED_BACKGROUND = "#ffc777";
const TYPED_TEXT = "#1b1d2b";
const MATCH_BACKGROUND = "rgba(255, 199, 119, 0.4)";
const TARGET_OUTLINE = "rgba(162, 87, 114, 0.55)";

// A CAPTCHA challenge stays open between clicks. It is read again this long
// after one, for the images that change, and then at this pace, for a new
// challenge after a failed check; it is over when it has been gone for
// VACANT_POLLS reads in a row.
const CHALLENGE_SETTLE_MS = 350;
const CHALLENGE_POLL_MS = 900;
const VACANT_POLLS = 3;

const MAX_SEGMENTS = 3000;
const MAX_MATCHES = 500;
const NOT_TEXT = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "SELECT"]);

function style(element, properties) {
  // Through the CSSOM, which a page's CSP does not block.
  Object.assign(element.style, properties);
}

function distance(rect, from) {
  return Math.hypot(
    rect.left + rect.width / 2 - from.x,
    rect.top + rect.height / 2 - from.y
  );
}

function center(window) {
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/**
 * What a jump can go to: the controls of the page, or the words in it. A
 * source answers which targets a pattern matches.
 *
 * @typedef {object} JumpTarget
 * @property {*} id Stays the same for a target as the pattern grows, which
 *   keeps its label.
 * @property {DOMRect} rect Where it is on screen.
 * @property {string[]} nexts The characters that follow the matches.
 * @property {number} distance From where the user is looking, for which targets get labels first.
 * @property {(options: {newTab: boolean}) => void} pick Goes to the target.
 */

// The controls this frame last offered, by the ids a press asks for.
const gPressable = new WeakMap();

// A control keeps its id for as long as it lives, wherever the others move
// to: a label that is tied to the id would otherwise change hands when a
// control appears before it.
const gIds = new WeakMap();
let gNextId = 0;

const WIDGETS = ZendiaCaptcha.WIDGETS;

function idOf(element) {
  let id = gIds.get(element);
  if (!id) {
    id = `c${gNextId++}`;
    gIds.set(element, id);
  }
  return id;
}

// What a frame sends is not to be trusted: it may be another site's.
function isControlData(item) {
  return (
    typeof item?.id == "string" &&
    typeof item.text == "string" &&
    Array.isArray(item.frame) &&
    item.frame.every(id => Number.isSafeInteger(id)) &&
    ["left", "top", "width", "height"].every(key =>
      Number.isFinite(item.rect?.[key])
    )
  );
}

// The controls in the frames on screen, placed in this window. The frames
// of those frames are asked by them.
async function collectFrames(actor, window) {
  const found = await Promise.all(
    ZendiaControls.frames(window).map(async frame => {
      const box = frame.getBoundingClientRect();
      const left = box.left + frame.clientLeft;
      const top = box.top + frame.clientTop;
      const items = await askFrame(
        actor,
        window,
        frame.browsingContext.id,
        "Zendia:CollectControls"
      );
      return (Array.isArray(items) ? items : [])
        .filter(isControlData)
        .map(item => ({
          id: item.id,
          text: item.text.slice(0, 200),
          // From the address of the frame it is in, or of one above it.
          challenge:
            ZendiaCaptcha.isChallenge(frame.src) || item.challenge === true,
          captcha:
            ZendiaCaptcha.nameOf(frame.src) !== null || item.captcha === true,
          drag: item.drag === true,
          frame: [frame.browsingContext.id, ...item.frame],
          rect: plainRect(
            item.rect.left + left,
            item.rect.top + top,
            item.rect.width,
            item.rect.height
          ),
        }))
        .filter(({ rect }) => {
          // Only what shows inside the frame.
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          return (
            x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
          );
        });
    })
  );
  return found.flat();
}

/**
 * The controls of this frame and of the frames in it, for the jump of the
 * page they are all in.
 *
 * @param {object} actor
 * @param {Window} window
 * @returns {Promise<object[]>} Plain data: where each is in this window, its
 *   text, and the frames to go through to reach it.
 */
export async function collectControls(actor, window) {
  const pressable = new Map();
  const own = ZendiaControls.find(window).map(element => {
    const id = idOf(element);
    pressable.set(id, new WeakRef(element));
    const { left, top, width, height } = element.getBoundingClientRect();
    return {
      id,
      text: ZendiaControls.textOf(element),
      rect: { left, top, width, height },
      // Part of a CAPTCHA the page draws itself, and what to drag.
      captcha: !!element.closest(ZendiaCaptcha.WIDGETS),
      drag: ZendiaControls.isDraggable(window, element),
      frame: [],
    };
  });
  gPressable.set(window, pressable);
  return [...own, ...(await collectFrames(actor, window))];
}

/**
 * Press a control this frame, or a frame in it, offered.
 *
 * @param {object} actor
 * @param {Window} window
 * @param {{frame: number[], id: string, newTab: boolean}} target
 * @returns {Promise<boolean|null>} Whether it was a field, which took the
 *   focus rather than a press. Null if its frame did not answer.
 */
export async function pressControl(actor, window, target) {
  const { frame, id, newTab } = target ?? {};
  if (
    !Array.isArray(frame) ||
    !frame.every(each => Number.isSafeInteger(each)) ||
    typeof id != "string"
  ) {
    return false;
  }
  if (frame.length) {
    return askFrame(actor, window, frame[0], "Zendia:PressControl", {
      frame: frame.slice(1),
      id,
      newTab: !!newTab,
    });
  }
  const element = gPressable.get(window)?.get(id)?.deref();
  if (element?.isConnected) {
    return pressElement(window, element, { newTab: !!newTab });
  }
  return false;
}

// A picture to point at, as the one of an icon CAPTCHA, is a control only
// because it is listened to: a click on its middle is never what is asked.
function isPicture(rect) {
  return rect.width >= 150 && rect.height >= 100;
}

// The controls of the page, or with `scope`:
//   "challenge" just those of a CAPTCHA that asks for clicks,
//   "captcha" those of any part of a CAPTCHA, a checkbox and a badge too.
async function controlsSource(window, actor, { scope = "all" } = {}) {
  const from = center(window);
  // What is part of a CAPTCHA stays labeled between picks, can be held and
  // dragged, and, if it is a picture, is clicked at a point of it.
  const local = ZendiaControls.find(window).flatMap(element => {
    const inCaptcha = !!element.closest(WIDGETS);
    if (scope != "all" && !inCaptcha) {
      return [];
    }
    const rect = element.getBoundingClientRect();
    let text = null;
    return [
      {
        key: element,
        // Read when a pattern asks for it: the labels of hints mode never do,
        // and reading each control's text costs a layout of it.
        get text() {
          text ??= ZendiaControls.textOf(element);
          return text;
        },
        rect,
        challenge: inCaptcha,
        drag: inCaptcha && ZendiaControls.isDraggable(window, element),
        picture: inCaptcha && isPicture(rect),
        pick: options => pressElement(window, element, options),
      },
    ];
  });
  const remote = (await collectFrames(actor, window))
    .filter(
      item =>
        scope == "all" || (scope == "challenge" ? item.challenge : item.captcha)
    )
    .map(item => ({
      key: `${item.frame.join(".")}:${item.id}`,
      text: item.text,
      rect: item.rect,
      challenge: scope == "captcha" || item.challenge,
      drag: item.drag && (item.challenge || item.captcha),
      picture: (item.challenge || item.captcha) && isPicture(item.rect),
      pick: ({ newTab }) =>
        askFrame(actor, window, item.frame[0], "Zendia:PressControl", {
          frame: item.frame.slice(1),
          id: item.id,
          newTab,
        }),
    }));
  const items = [...local, ...remote];
  return {
    isText: false,
    // With nothing typed every control is a target, to be seen but not yet
    // labeled.
    matches(pattern) {
      return items.flatMap(item => {
        const { key, rect, challenge, drag, picture, pick } = item;
        const found = pattern ? findMatches(item.text, pattern) : [];
        if (pattern && !found.length) {
          return [];
        }
        return [
          {
            id: key,
            rect,
            nexts: found.map(match => match.next),
            distance: distance(rect, from),
            challenge,
            drag,
            picture,
            pick,
          },
        ];
      });
    },
  };
}

// Where the caret is on screen, if it is.
function caretPoint(window) {
  const selection = window.getSelection();
  if (!selection.focusNode) {
    return null;
  }
  try {
    const range = window.document.createRange();
    range.setStart(selection.focusNode, selection.focusOffset);
    const rect = range.getBoundingClientRect();
    return rect.height ? { x: rect.left, y: rect.top } : null;
  } catch {
    return null;
  }
}

function textSource(window, actor) {
  const from = caretPoint(window) ?? center(window);
  const segments = [];
  for (const node of ZendiaDom.deepTextNodes(
    window.document.body ?? window.document.documentElement
  )) {
    if (segments.length >= MAX_SEGMENTS) {
      break;
    }
    const parent = ZendiaDom.composedParent(node);
    if (
      !node.data.trim() ||
      !parent ||
      NOT_TEXT.has(parent.tagName) ||
      !parent.checkVisibility()
    ) {
      continue;
    }
    const box = parent.getBoundingClientRect();
    if (
      box.bottom > 0 &&
      box.top < window.innerHeight &&
      box.right > 0 &&
      box.left < window.innerWidth
    ) {
      segments.push(node);
    }
  }
  return {
    isText: true,
    matches(pattern) {
      const targets = [];
      for (const node of segments) {
        for (const match of findMatches(node.data, pattern)) {
          const range = window.document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + pattern.length);
          const rect = range.getBoundingClientRect();
          if (
            rect.width &&
            rect.bottom > 0 &&
            rect.top < window.innerHeight &&
            rect.right > 0 &&
            rect.left < window.innerWidth
          ) {
            targets.push({
              id: `${segments.indexOf(node)}:${match.index}`,
              rect,
              nexts: [match.next],
              distance: distance(rect, from),
              pick: () => moveCaret(window, actor, node, match.index),
            });
          }
          if (targets.length >= MAX_MATCHES) {
            return targets;
          }
        }
      }
      return targets;
    },
  };
}

const WORD = /[\p{L}\p{N}_]+/gu;
// The most labels at once: two letters of the alphabet make 576.
const MAX_WORD_TARGETS = 560;

function onScreen(window, rect) {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.top < window.innerHeight &&
    rect.right > 0 &&
    rect.left < window.innerWidth
  );
}

/**
 * Every word and every paragraph on screen, for choosing where visual mode
 * starts or where it goes: a word label puts the cursor there and a
 * paragraph label selects the paragraph, so `y` after it yanks it.
 *
 * @param {Window} window
 * @param {object} actor
 * @param {{land: boolean}} options Whether a word label puts the cursor
 *   there, rather than growing the selection to it.
 */
function wordsSource(window, actor, { land }) {
  const page = new ZendiaPageText(window);
  const from = caretPoint(window) ?? center(window);
  const rangeOf = (start, end) => {
    const first = page.pointAt(start, "start");
    const last = page.pointAt(end, "end");
    if (!first || !last) {
      return null;
    }
    const range = window.document.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset);
    return range;
  };
  const targets = [];
  let lineStart = 0;
  for (const line of page.text.split("\n")) {
    const start = lineStart;
    lineStart += line.length + 1;
    if (!line.trim()) {
      continue;
    }
    const lineRange = rangeOf(start, start + line.length);
    const lineRect = lineRange?.getBoundingClientRect();
    if (!lineRect || !onScreen(window, lineRect)) {
      continue;
    }
    targets.push({
      id: `p${start}`,
      kind: "paragraph",
      rect: lineRect,
      nexts: [],
      distance: distance(lineRect, from),
      pick: () => {
        const selection = window.getSelection();
        const { startContainer, startOffset, endContainer, endOffset } =
          lineRange;
        selection.setBaseAndExtent(
          startContainer,
          startOffset,
          endContainer,
          endOffset
        );
        actor.setMode("v");
        reveal(window);
      },
    });
    for (const match of line.matchAll(WORD)) {
      const range = rangeOf(
        start + match.index,
        start + match.index + match[0].length
      );
      const rect = range?.getBoundingClientRect();
      if (rect && onScreen(window, rect)) {
        targets.push({
          id: `w${start + match.index}`,
          kind: "word",
          rect,
          nexts: [],
          distance: distance(rect, from),
          pick: () =>
            moveCaret(
              window,
              actor,
              range.startContainer,
              range.startOffset,
              !land
            ),
        });
      }
    }
  }
  return {
    isText: true,
    plain: true,
    // The paragraphs first, then the words nearest to where the user is.
    matches: () =>
      [
        ...targets.filter(target => target.kind == "paragraph"),
        ...targets
          .filter(target => target.kind == "word")
          .sort((a, b) => a.distance - b.distance),
      ].slice(0, MAX_WORD_TARGETS),
  };
}

// The cursor goes to the match: the selection grows to it in visual mode,
// and from normal mode visual mode starts there, for `viw` and its kind.
function moveCaret(window, actor, node, offset, extend = true) {
  const selection = window.getSelection();
  if (extend && actor.engine?.mode == "v" && selection.rangeCount) {
    selection.extend(node, offset);
  } else {
    selection.collapse(node, offset);
    actor.setMode("v");
  }
  reveal(window);
}

// Whether it was a field, which takes the focus rather than a press.
function pressElement(window, element, { newTab }) {
  if (ZendiaDom.isEditable(element)) {
    element.focus();
    return true;
  }
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  // The mouse input a user's would be, for the handlers that listen to
  // mousedown rather than click.
  const modifiers = newTab ? Ci.nsIDOMWindowUtils.MODIFIER_CONTROL : 0;
  window.synthesizeMouseEvent("mousemove", x, y, {});
  for (const type of ["mousedown", "mouseup"]) {
    window.synthesizeMouseEvent(type, x, y, {
      button: 0,
      clickCount: 1,
      modifiers,
    });
  }
  return false;
}

/**
 * Jump labels in a page. Typing characters narrows the targets to those that
 * contain them and labels what is left; typing a label (with Shift: in a new
 * tab) goes there. In `hints` mode every target is labeled at once and keys
 * only pick a label, as in the browser's own pickers.
 *
 * With `challengeSource` (hints mode), picking a control of a CAPTCHA
 * challenge does not end the jump: the labels stay, on the challenge alone,
 * for as many picks as it takes, until <Esc> or until the challenge is gone.
 */
class JumpSession {
  #window;
  #makeSource;
  #source;
  #hints;
  #pattern = "";
  #typed = "";
  #shown = [];
  #labels = [];
  #previous = new Map();
  #root = null;
  #done = false;
  #redraw = 0;
  #generation = 0;
  #challengeSource;
  #actor;
  // Whether a pick in a challenge has made this a jump that stays.
  #staying = false;
  // Until the labels follow the challenge, the keys wait: they would pick
  // from labels that are about to change.
  #switching = false;
  #pollTimer = 0;
  #vacant = 0;
  #signature = "";
  // The label of each target of a jump that stays, kept for as long as the
  // target is there: the labels the user has seen are not to change.
  #kept = new Map();
  // The mouse for the keyboard, while it has the keys.
  #pad = null;
  #passes = false;
  // The board of a gobang CAPTCHA, once found.
  #board = null;

  constructor(
    window,
    makeSource,
    source,
    {
      hints = false,
      challengeSource = null,
      staying = false,
      actor = null,
    } = {}
  ) {
    this.#window = window;
    this.#makeSource = makeSource;
    this.#source = source;
    this.#hints = hints;
    this.#challengeSource = challengeSource;
    this.#actor = actor;
    this.#staying = staying && hints;
    if (this.#staying) {
      this.#makeSource = challengeSource ?? makeSource;
    }
    window.addEventListener("pagehide", this);
    window.addEventListener("resize", this);
    window.addEventListener("mousedown", this, true);
    // Labels follow the page as it scrolls.
    window.addEventListener("scroll", this, true);
    this.#update();
    if (this.#hints && !this.#shown.length) {
      this.finish();
    } else if (this.#staying) {
      this.#schedulePoll(CHALLENGE_POLL_MS);
    }
  }

  get done() {
    return this.#done;
  }

  // Whether the key last given was not for this jump but for the keymap: the
  // jump is over, and the key goes on.
  get passesKey() {
    return this.#passes;
  }

  handleEvent(event) {
    if (event.type == "pagehide") {
      this.finish();
    } else if (event.type == "mousedown") {
      // A click elsewhere ends the jump, or its labels would go on taking
      // the keys. A challenge is solved with clicks too, so it stays.
      if (!this.#staying) {
        this.finish();
      }
    } else {
      this.#queueUpdate();
    }
  }

  handleKey(event) {
    const token = ZendiaKeys.fromEvent(event);
    if (!token) {
      return;
    }
    if (this.#pad) {
      this.#pad.handleKey(event);
      return;
    }
    // Labels are letters: <C-l> and the like are the keymap's, not this
    // jump's.
    if (!this.#staying && (event.ctrlKey || event.altKey || event.metaKey)) {
      this.#passes = true;
      this.finish();
      return;
    }
    if (
      this.#staying &&
      !this.#shown.length &&
      !this.#switching &&
      token != "<Esc>"
    ) {
      // The challenge is over and the labels with it: the key is the user's
      // again, not this jump's.
      this.#passes = true;
      this.finish();
      return;
    }
    if (token == "<Esc>") {
      this.finish();
    } else if (this.#switching) {
      // Not yet.
    } else if (this.#challengeSource && (token == "." || token == ",")) {
      // "." clicks anywhere in the CAPTCHA, "," drags from anywhere in it.
      this.#point(token == ",");
    } else if (token == "<CR>") {
      this.#pickAt(0, { newTab: false });
    } else if (token == "<BS>") {
      this.#backspace();
    } else if (token == "<Space>" && !this.#hints) {
      this.#type(" ");
    } else if (token.length == 1) {
      this.#type(token);
    }
  }

  finish() {
    if (this.#done) {
      return;
    }
    this.#done = true;
    try {
      this.#window.removeEventListener("pagehide", this);
      this.#window.removeEventListener("resize", this);
      this.#window.removeEventListener("mousedown", this, true);
      this.#window.removeEventListener("scroll", this, true);
      this.#window.cancelAnimationFrame(this.#redraw);
      this.#window.clearTimeout(this.#pollTimer);
      const pad = this.#pad;
      this.#pad = null;
      pad?.finish();
      this.#root?.remove();
    } catch {
      // The window is already gone.
    }
    this.#root = null;
  }

  #backspace() {
    if (this.#hints ? this.#typed : this.#pattern) {
      if (this.#hints) {
        this.#typed = this.#typed.slice(0, -1);
      } else {
        this.#pattern = this.#pattern.slice(0, -1);
      }
      this.#update();
    } else {
      this.finish();
    }
  }

  #type(char) {
    if (this.#hints) {
      this.#typeHint(char);
      return;
    }
    // A label wins over a pattern character: labels are never the character
    // after a match, so one key cannot be both.
    const lower = char.toLowerCase();
    const index = this.#labels.indexOf(lower);
    if (index != -1 && this.#pattern) {
      this.#pickAt(index, { newTab: char != lower });
      return;
    }
    const target = this.#pattern + char;
    if (this.#source.matches(target).length) {
      this.#pattern = target;
      this.#update();
    }
  }

  #typeHint(char) {
    const typed = this.#typed + char.toLowerCase();
    const index = this.#labels.indexOf(typed);
    if (index != -1) {
      this.#pickAt(index, { newTab: char != char.toLowerCase() });
    } else if (this.#labels.some(label => label?.startsWith(typed))) {
      this.#typed = typed;
      this.#update();
    }
  }

  #pickAt(index, options) {
    const target = this.#shown[index];
    if (target?.challenge && this.#challengeSource) {
      this.#pickInChallenge(target, options);
      return;
    }
    this.finish();
    target?.pick(options);
  }

  // A pick that leaves the labels up for the next one: a CAPTCHA asks for
  // several images, and a check that fails asks again.
  async #pickInChallenge(target, options) {
    const first = !this.#staying;
    if (first) {
      // The labels the user has seen go with the challenge when the page is
      // left out, so that the one they type is the one they read.
      this.#kept = new Map(
        this.#shown.flatMap((each, i) =>
          each.challenge && this.#labels[i] ? [[each.id, this.#labels[i]]] : []
        )
      );
    }
    this.#staying = true;
    this.#typed = "";
    this.#switching = first;
    this.#makeSource = this.#challengeSource;
    // A slider's handle, a piece, a button to hold: the mouse is pressed on
    // it and the keys move it. It is known by its cursor and name, or said
    // by the label's last letter, typed as a capital.
    // So is a piece on a board with empty places: it is moved onto one. A
    // grid with no place to spare is of images to pick, and they are clicked.
    const board = this.#boardOf(target);
    const hold =
      target.drag ||
      options.newTab ||
      (board && board.places.length > board.pieces);
    if (hold || target.picture) {
      this.#switching = false;
      if (hold) {
        await this.#point(true, {
          grab: ZendiaCaptcha.middle(target.rect),
          lattice: board?.places ?? null,
        });
      } else {
        // A picture to point at: the grid goes over it alone.
        await this.#point(false, { areas: [target.rect] });
      }
      return;
    }
    let field = false;
    try {
      field = (await target.pick(options)) === true;
    } catch {
      // The frame is gone: the next read finds it so.
    }
    if (field) {
      // A field of the challenge has the focus now, for the user to type in.
      this.finish();
      return;
    }
    if (this.#done) {
      return;
    }
    // The click moved focus into the frame, where the keys would not reach
    // this jump.
    this.#refocus();
    if (first) {
      await this.#read(true);
      this.#switching = false;
    }
    this.#schedulePoll(CHALLENGE_SETTLE_MS);
  }

  // The mouse for the keyboard over the CAPTCHAs of the page: to click
  // where nothing has a label, or, with `drag`, to press the mouse at `grab`
  // (or at a point to choose) and move it with the keys.
  async #point(drag, { grab = null, areas = null, lattice = null } = {}) {
    this.#switching = true;
    if (!areas) {
      try {
        areas = await captchaAreas(this.#actor, this.#window);
      } catch {
        // The frames do not answer: the whole page will do.
        areas = [];
      }
    }
    this.#switching = false;
    if (this.#done) {
      return;
    }
    this.#refocus();
    if (!areas.length) {
      const { innerWidth, innerHeight } = this.#window;
      areas = [plainRect(0, 0, innerWidth, innerHeight)];
    }
    this.#root?.remove();
    this.#root = null;
    this.#pad = new PointerPad(this.#actor, this.#window, {
      areas,
      drag,
      grab,
      lattice,
      onFinish: () => this.#resume(),
    });
    this.#vacant = 0;
  }

  // The places of the board a piece sits on, found from the pieces that are
  // like it (a gobang CAPTCHA moves them onto its empty places), or null.
  #boardOf(target) {
    const { width, height } = target.rect;
    const alike = this.#shown
      .filter(
        each =>
          each.challenge &&
          !each.picture &&
          Math.abs(each.rect.width - width) <= width * 0.15 &&
          Math.abs(each.rect.height - height) <= height * 0.15
      )
      .map(each => each.rect);
    let places = ZendiaCaptcha.lattice(alike);
    // The board seen when most pieces were on it is kept: pieces that have
    // all moved to one side would show a smaller one.
    const near = (place, rect) =>
      Math.abs(place.left - rect.left) < rect.width / 2 &&
      Math.abs(place.top - rect.top) < rect.height / 2;
    if (
      this.#board &&
      alike.length &&
      alike.every(rect => this.#board.some(place => near(place, rect)))
    ) {
      places = this.#board;
    } else if (places) {
      this.#board = places;
    }
    return places ? { places, pieces: alike.length } : null;
  }

  // The mouse is let go of: the labels are back, as the clicks and drags
  // have left the page.
  #resume() {
    this.#pad = null;
    if (this.#done) {
      return;
    }
    this.#signature = "";
    if (this.#staying) {
      this.#schedulePoll(CHALLENGE_SETTLE_MS);
    } else {
      this.#queueUpdate();
    }
    this.#draw();
  }

  #refocus() {
    const window = this.#window;
    try {
      const focused = window.document.activeElement;
      if (focused?.browsingContext) {
        focused.blur();
      }
      window.focus();
    } catch {
      // The window is already gone.
    }
  }

  #schedulePoll(delay) {
    const window = this.#window;
    window.clearTimeout(this.#pollTimer);
    this.#pollTimer = window.setTimeout(async () => {
      // Not while the mouse is held: nothing to relabel, and the pad is
      // what the keys are for.
      if (!this.#pad) {
        await this.#read(false);
      }
      if (!this.#done) {
        this.#schedulePoll(CHALLENGE_POLL_MS);
      }
    }, delay);
  }

  // The challenge as it is now: new images, a new challenge after a failed
  // check, or none, once it was passed. Drawn again only if it changed.
  async #read(force) {
    const latest = ++this.#generation;
    const source = await this.#makeSource();
    if (this.#done || latest != this.#generation) {
      return;
    }
    const targets = source.matches("");
    this.#vacant = targets.length ? 0 : this.#vacant + 1;
    if (this.#vacant >= VACANT_POLLS) {
      this.finish();
      return;
    }
    const signature = targets
      .map(
        ({ id, rect }) =>
          `${id}@${Math.round(rect.left)},${Math.round(rect.top)}`
      )
      .join(" ");
    if (force || signature != this.#signature) {
      this.#signature = signature;
      this.#source = source;
      this.#update();
    }
  }

  #queueUpdate() {
    this.#window.cancelAnimationFrame(this.#redraw);
    this.#redraw = this.#window.requestAnimationFrame(async () => {
      const latest = ++this.#generation;
      const source = await this.#makeSource();
      // Not if the page moved again meanwhile, or the jump is over.
      if (!this.#done && latest == this.#generation) {
        this.#source = source;
        this.#update();
      }
    });
  }

  #update() {
    const targets = this.#source
      .matches(this.#pattern)
      .sort((a, b) => a.distance - b.distance);
    if (this.#hints) {
      this.#shown = targets.sort(
        (a, b) =>
          Math.round(a.rect.top / 8) - Math.round(b.rect.top / 8) ||
          a.rect.left - b.rect.left
      );
      if (this.#staying) {
        // Labels that stay with their targets, as a CAPTCHA changes.
        this.#labels = ZendiaCaptcha.stickyLabels(
          this.#shown.map(target => target.id),
          this.#kept,
          LABELS
        );
        this.#shown.forEach((target, i) =>
          this.#kept.set(target.id, this.#labels[i])
        );
      } else {
        this.#labels = hintLabels(this.#shown.length);
      }
    } else {
      this.#shown = targets;
      // Labels wait for the first character: until then every key would be
      // a label.
      this.#labels = this.#pattern
        ? assignLabels(targets.length, {
            skip: targets.flatMap(target => target.nexts),
            previous: targets.map(target => this.#previous.get(target.id)),
          })
        : targets.map(() => null);
      this.#previous = new Map(
        targets.map((target, i) => [target.id, this.#labels[i]])
      );
    }
    this.#draw();
  }

  #draw() {
    if (this.#pad) {
      return;
    }
    const window = this.#window;
    const document = window.document;
    this.#root?.remove();
    const root = document.createElementNS(HTML_NS, "div");
    root.style.cssText =
      "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
    this.#shown.forEach((target, i) => {
      const label = this.#labels[i];
      if (this.#hints && !label?.startsWith(this.#typed)) {
        return;
      }
      const { rect } = target;
      // A word is marked by its label alone; a paragraph by a bar along it.
      if (target.kind != "word") {
        const box = document.createElementNS(HTML_NS, "div");
        style(box, {
          position: "absolute",
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          height: `${rect.height}px`,
          boxSizing: "border-box",
        });
        if (target.kind == "paragraph") {
          style(box, {
            width: "3px",
            marginLeft: "-6px",
            borderRadius: "2px",
            background: PARAGRAPH_BACKGROUND,
          });
        } else if (this.#source.isText) {
          style(box, {
            width: `${rect.width}px`,
            borderRadius: "3px",
            background: MATCH_BACKGROUND,
          });
        } else {
          style(box, {
            width: `${rect.width}px`,
            borderRadius: "3px",
            outline: `1px solid ${TARGET_OUTLINE}`,
          });
        }
        root.append(box);
      }
      if (label) {
        root.append(this.#tag(label, target));
      }
    });
    if (!this.#hints) {
      root.append(this.#prompt(`› ${this.#pattern}`));
    } else if (this.#staying) {
      root.append(
        this.#prompt(
          "captcha · label clicks · Label (capital) holds · . click anywhere · , drag · Esc leave"
        )
      );
    }
    this.#root = root;
    document.documentElement.append(root);
  }

  // A word's label sits on its first letters, a paragraph's in the margin
  // beside it in its own color, and a typed match's after it.
  #tag(label, { rect, kind }) {
    const window = this.#window;
    const tag = window.document.createElementNS(HTML_NS, "span");
    const small = kind == "word" || kind == "paragraph";
    const padding = small ? 3 : 4;
    const typed = this.#hints ? this.#typed.length : 0;
    if (typed) {
      // What is pressed stands apart from what is left to press, up to the
      // label's edge.
      const pressed = window.document.createElementNS(HTML_NS, "span");
      pressed.textContent = label.slice(0, typed);
      style(pressed, {
        display: "inline-block",
        marginLeft: `-${padding}px`,
        paddingLeft: `${padding}px`,
        borderRadius: "4px 0 0 4px",
        background: TYPED_BACKGROUND,
        color: TYPED_TEXT,
      });
      tag.append(pressed, label.slice(typed));
    } else {
      tag.textContent = label;
    }
    const width = label.length * (small ? 6.5 : 7) + 8;
    let left = rect.left + 2;
    let top = rect.top + 2;
    if (kind == "paragraph") {
      left = rect.left - width - 8;
      top = rect.top;
    } else if (kind == "word") {
      top = rect.top + Math.max(0, (rect.height - 14) / 2);
      left = rect.left;
    } else if (this.#source.isText) {
      left = rect.right;
      top = rect.top;
    }
    style(tag, {
      position: "absolute",
      left: `${Math.max(0, Math.min(left, window.innerWidth - width))}px`,
      top: `${Math.max(0, Math.min(top, window.innerHeight - 18))}px`,
      padding: `0 ${padding}px`,
      borderRadius: "4px",
      background: kind == "paragraph" ? PARAGRAPH_BACKGROUND : LABEL_BACKGROUND,
      color: LABEL_TEXT,
      font: small
        ? "700 10px/14px ui-monospace, monospace"
        : "700 11px/16px ui-monospace, monospace",
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.4)",
    });
    return tag;
  }

  #prompt(text) {
    const tag = this.#window.document.createElementNS(HTML_NS, "span");
    tag.textContent = text;
    style(tag, {
      position: "absolute",
      left: "50%",
      bottom: "16px",
      transform: "translateX(-50%)",
      padding: "2px 10px",
      borderRadius: "6px",
      background: LABEL_BACKGROUND,
      color: LABEL_TEXT,
      font: "700 13px/20px ui-monospace, monospace",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.4)",
    });
    return tag;
  }
}

async function begin(actor, window, makeSource, options) {
  const source = await makeSource();
  actor.startCapture(new JumpSession(window, makeSource, source, options));
}

/**
 * A label on each of some elements of this window, to choose one with the keys.
 *
 * @param {object} actor
 * @param {Window} window
 * @param {() => Element[]} find The elements, read again as the page scrolls.
 * @param {(element: Element) => void} pick
 * @returns {Promise<void>}
 */
export function labelElements(actor, window, find, pick) {
  const makeSource = () => {
    const from = center(window);
    const targets = find().map(element => {
      const rect = element.getBoundingClientRect();
      return {
        id: element,
        rect,
        nexts: [],
        distance: distance(rect, from),
        pick: () => pick(element),
      };
    });
    return { isText: false, matches: () => targets };
  };
  return begin(actor, window, makeSource, { hints: true });
}

// Labels for the controls of the whole page, frames included. They are
// drawn by its top window, so a key typed in a frame starts them there, and
// focus leaves the frame, so the keys that pick a label reach the top.
const labelControls = (id, options) => async context => {
  const { actor, window } = context;
  if (window.browsingContext.parent) {
    await actor.sendQuery("Zendia:FrameQuery", {
      bcId: window.browsingContext.top.id,
      name: "Zendia:RunContent",
      data: { id, args: {} },
    });
    return;
  }
  const focused = window.document.activeElement;
  if (focused?.browsingContext) {
    focused.blur();
    window.focus();
  }
  const { stayInChallenges, captcha, ...rest } = options ?? {};
  const makeSource = () =>
    controlsSource(window, actor, { scope: captcha ? "captcha" : "all" });
  const source = await makeSource();
  if (captcha && !source.matches("").length) {
    // Nothing to label: a picture drawn in a canvas, say. What is left is
    // the mouse.
    let areas = await captchaAreas(actor, window);
    if (!areas.length) {
      areas = [plainRect(0, 0, window.innerWidth, window.innerHeight)];
    }
    actor.startCapture(new PointerPad(actor, window, { areas, drag: false }));
    return;
  }
  actor.startCapture(
    new JumpSession(window, makeSource, source, {
      ...rest,
      actor,
      staying: !!captcha,
      challengeSource:
        stayInChallenges || captcha
          ? () =>
              controlsSource(window, actor, {
                scope: captcha ? "captcha" : "challenge",
              })
          : null,
    })
  );
};

const labelWords =
  land =>
  ({ actor, window }) =>
    begin(actor, window, () => wordsSource(window, actor, { land }), {
      hints: true,
    });

export const actions = {
  // Type some of a control's text, then its label.
  "jump.controls": labelControls("jump.controls"),

  // Every control labeled at once. In a CAPTCHA challenge the labels stay for
  // each image to be picked, and for the button that checks them.
  "jump.hints": labelControls("jump.hints", {
    hints: true,
    stayInChallenges: true,
  }),

  // Only the CAPTCHAs of the page, for solving one with the keys alone: its
  // controls are labeled and stay labeled between picks (an image, a check,
  // a new challenge); `.` clicks and `,` drags anywhere in it, for what
  // nothing labels, like a slider or a picture to point at.
  "jump.captcha": labelControls("jump.captcha", {
    hints: true,
    captcha: true,
  }),

  "jump.text": ({ actor, window }) =>
    begin(actor, window, () => textSource(window, actor)),

  // Every word and paragraph at once; the choice grows the selection.
  "jump.words": labelWords(false),

  // The same, for where visual mode starts: the choice puts the cursor.
  "jump.land": labelWords(true),
};
