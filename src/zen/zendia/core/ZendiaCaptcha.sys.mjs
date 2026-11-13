// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// What CAPTCHAs look like to the browser, and the arithmetic for solving one
// with the keyboard alone. Which frames are CAPTCHAs, by their address: the
// agent hands them to the user, and a jump stays open in the ones that ask
// for several clicks. Pointer and label arithmetic is here too, without any
// DOM, so it can be tested alone.

// `challenge` tells the frame that asks for clicks (a grid of images to
// pick from) from the ones that only host a checkbox or a badge. Without it,
// the whole service is a challenge.
const CAPTCHAS = [
  {
    name: "reCAPTCHA",
    frame: /google\.com\/recaptcha\/|recaptcha\.net\//,
    challenge: /\/bframe/,
  },
  {
    name: "hCaptcha",
    frame: /hcaptcha\.com\//,
    challenge: /frame=challenge/,
  },
  {
    name: "Cloudflare Turnstile",
    frame: /challenges\.cloudflare\.com\//,
    challenge: null,
  },
  {
    name: "Arkose",
    frame: /arkoselabs\.com\/|funcaptcha\.com\/|octocaptcha\.com\//,
    challenge: /./,
  },
  {
    name: "GeeTest",
    frame: /geetest\.com\/|geevisit\.com\/|geetest\.cn\//,
    challenge: /./,
  },
  {
    // The "Press & Hold" button and its puzzles.
    name: "HUMAN",
    frame:
      /px-cdn\.net\/|px-cloud\.net\/|perimeterx\.(?:net|com)\/|human\.com\/captcha/,
    challenge: /./,
  },
  {
    name: "DataDome",
    frame: /captcha-delivery\.com\/|datadome\.co\//,
    challenge: /./,
  },
  {
    name: "Yandex SmartCaptcha",
    frame: /smartcaptcha\.yandexcloud\.net\/|captcha\.yandex\./,
    challenge: /advanced/,
  },
  {
    name: "Tencent Captcha",
    frame: /captcha\.qcloud\.com\/|turing\.captcha\.gtimg\.com\//,
    challenge: /./,
  },
  {
    name: "NetEase Yidun",
    frame: /(?:c|captcha)\.dun\.163\.com\//,
    challenge: /./,
  },
  { name: "MTCaptcha", frame: /mtcaptcha\.com\//, challenge: null },
  {
    name: "Friendly Captcha",
    frame: /friendlycaptcha\.com\//,
    challenge: null,
  },
  { name: "AWS WAF", frame: /awswaf\.com\//, challenge: /./ },
  { name: "Lemin", frame: /leminnow\.com\//, challenge: /./ },
  { name: "KeyCAPTCHA", frame: /keycaptcha\.com\//, challenge: /./ },
];

// The CAPTCHAs that are not a frame of their own, but part of the page: a
// widget that scripts draw in, or a page that is only a check. What is
// inside matches counts as the CAPTCHA's.
const WIDGETS = [
  ".g-recaptcha",
  ".grecaptcha-badge",
  ".h-captcha",
  ".cf-turnstile",
  ".frc-captcha",
  "altcha-widget",
  ".altcha",
  ".mtcaptcha",
  "#mtcaptcha",
  ".mcaptcha__widget-container",
  "[class*='geetest_']",
  ".gt_holder",
  ".gt_popup",
  "[class*='yidun']",
  "[id*='tcaptcha']",
  "form[action*='validateCaptcha']",
  "#px-captcha",
  "#cf-challenge-running",
  "#challenge-stage",
  "#amzn-captcha-verify-button",
].join(",");

export const ZendiaCaptcha = {
  WIDGETS,

  /**
   * @param {string} url The address of a frame.
   * @returns {string|null} The service it belongs to, if it is a CAPTCHA's.
   */
  nameOf(url) {
    return CAPTCHAS.find(({ frame }) => frame.test(url))?.name ?? null;
  },

  /**
   * @param {string} url The address of a frame.
   * @returns {boolean} Whether it is the part of a CAPTCHA that asks for
   *   clicks, rather than the checkbox that opens it.
   */
  isChallenge(url) {
    const captcha = CAPTCHAS.find(({ frame }) => frame.test(url));
    return !!captcha?.challenge?.test(url);
  },

  /**
   * Labels that stay with their targets as the targets come and go: a
   * CAPTCHA changes under the user's eyes, and a label that moved between
   * two looks would be pressed by mistake. A target that had a label keeps
   * it while no other target has it; the rest take the labels left, all of
   * one length so that no label starts another.
   *
   * @param {*[]} keys What identifies each target, in the order they are
   *   labeled.
   * @param {Map<*, string>} kept The label each target had.
   * @param {string} alphabet The letters labels are made of.
   * @returns {string[]} A label per key.
   */
  stickyLabels(keys, kept, alphabet) {
    const letters = [...alphabet];
    const known = keys.map(key => kept.get(key) ?? null);
    const lengths = new Set(known.filter(Boolean).map(label => label.length));
    // What was kept cannot be mixed with labels of another length: start over.
    const length = lengths.size == 1 ? [...lengths][0] : null;
    const reuse = length !== null;
    const size = length ?? (keys.length <= letters.length ? 1 : 2);
    const labels = Array(keys.length).fill(null);
    const used = new Set();
    if (reuse) {
      known.forEach((label, i) => {
        if (label && !used.has(label)) {
          labels[i] = label;
          used.add(label);
        }
      });
    }
    const candidates = function* () {
      if (size == 1) {
        yield* letters;
      } else {
        for (const first of letters) {
          for (const second of letters) {
            yield first + second;
          }
        }
      }
    };
    const free = candidates();
    for (let i = 0; i < labels.length; i++) {
      if (labels[i]) {
        continue;
      }
      let next = free.next();
      while (!next.done && used.has(next.value)) {
        next = free.next();
      }
      if (next.done) {
        break;
      }
      labels[i] = next.value;
      used.add(next.value);
    }
    return labels;
  },

  /**
   * A grid over an area, for clicking where nothing has a label: the CAPTCHAs
   * that draw their picture in a canvas.
   *
   * @param {{left: number, top: number, width: number, height: number}} area
   * @param {number} cell About how wide and tall a cell should be.
   * @returns {{left: number, top: number, width: number, height: number}[]}
   *   The cells, row by row. The cells are as many as the area holds, and
   *   fill it exactly.
   */
  gridCells(area, cell) {
    const columns = Math.max(1, Math.round(area.width / cell));
    const rows = Math.max(1, Math.round(area.height / cell));
    return ZendiaCaptcha.splitRect(area, columns, rows);
  },

  /**
   * @param {{left: number, top: number, width: number, height: number}} rect
   * @param {number} columns
   * @param {number} rows
   * @returns {{left: number, top: number, width: number, height: number}[]}
   *   The parts, row by row.
   */
  splitRect(rect, columns, rows) {
    const width = rect.width / columns;
    const height = rect.height / rows;
    const parts = [];
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        parts.push({
          left: rect.left + column * width,
          top: rect.top + row * height,
          width,
          height,
        });
      }
    }
    return parts;
  },

  /**
   * @param {{left: number, top: number, width: number, height: number}} rect
   * @returns {{x: number, y: number}} Its middle.
   */
  middle(rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  },

  /**
   * The board a set of pieces sit on, when they sit on one: a CAPTCHA that
   * asks for pieces to be moved onto the empty places of a board draws the
   * places as nothing a script can point at, but the pieces show where the
   * lines of the board are and how far apart.
   *
   * @param {{left: number, top: number, width: number, height: number}[]}
   *   pieces
   * @returns {{left: number, top: number, width: number, height: number}[]|null}
   *   Every place of the board, row by row, or null if the pieces do not
   *   sit on a regular one.
   */
  lattice(pieces) {
    if (pieces.length < 3) {
      return null;
    }
    const axis = values => {
      const sorted = [...values].sort((a, b) => a - b);
      const lines = [];
      for (const value of sorted) {
        if (!lines.length || value - lines[lines.length - 1] > 4) {
          lines.push(value);
        }
      }
      return lines;
    };
    const centers = pieces.map(ZendiaCaptcha.middle);
    const xs = axis(centers.map(point => point.x));
    const ys = axis(centers.map(point => point.y));
    const gaps = lines => lines.slice(1).map((line, i) => line - lines[i]);
    const pitches = [...gaps(xs), ...gaps(ys)];
    if (!pitches.length) {
      return null;
    }
    const pitch = Math.min(...pitches);
    // A piece the board cannot hold the size of is not on it.
    const fits = lines =>
      lines.every(line => {
        const steps = (line - lines[0]) / pitch;
        return Math.abs(steps - Math.round(steps)) < 0.2;
      });
    if (pitch < 12 || !fits(xs) || !fits(ys)) {
      return null;
    }
    const width = pieces[0].width;
    const height = pieces[0].height;
    const columns = Math.round((xs[xs.length - 1] - xs[0]) / pitch) + 1;
    const rows = Math.round((ys[ys.length - 1] - ys[0]) / pitch) + 1;
    if (columns < 2 && rows < 2) {
      return null;
    }
    const cells = [];
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        cells.push({
          left: xs[0] + column * pitch - width / 2,
          top: ys[0] + row * pitch - height / 2,
          width,
          height,
        });
      }
    }
    return cells;
  },

  /**
   * The points between two, a few pixels apart: a drag is a path the page can
   * follow, not a jump, and a slider that only reads the last move would
   * still end where it should.
   *
   * @param {{x: number, y: number}} from
   * @param {{x: number, y: number}} to
   * @param {number} step The most a move may cover.
   * @returns {{x: number, y: number}[]} The points after `from`, up to and
   *   including `to`.
   */
  path(from, to, step) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const count = Math.max(1, Math.ceil(length / step));
    return Array.from({ length: count }, (_, i) => ({
      x: from.x + ((to.x - from.x) * (i + 1)) / count,
      y: from.y + ((to.y - from.y) * (i + 1)) / count,
    }));
  },
};
