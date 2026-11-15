// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// ZENDIA, as a piece painted on a wall panel: letters cut from hard angles
// and leaning forward, filled in three hard bands of Zendia's pink, purple
// and blue, lined in ink over a thrown shadow, haloed in cyan, and running
// where the paint was heavy. The mascot is tagged above it.
//
// There is no font in this: each letter is a polygon drawn here, so the
// piece is Zendia's own and needs no asset.

import { paintMascot } from "./mascot.js";

// Every color of the piece is one of Zendia's own, as ZendiaTheme.sys.mjs
// has them, unchanged: pink, the brand's accent and the color of NORMAL
// mode, over purple and blue for the letters' three tones; cyan for the
// halo; night for the ink; snow and muted for the panel it is painted on.
export const BRAND = {
  night: "#1a1b26",
  snow: "#c0caf5",
  muted: "#8f98c4",
  pink: "#fca7ea",
  purple: "#c099ff",
  blue: "#82aaff",
  cyan: "#86e1fc",
};

// Each letter in a box 104 tall: its outline, then any counter (the hole of
// D and A), and its width.
const LETTERS = {
  Z: { width: 82, shapes: [[[0, 2], [74, -6], [72, 22], [36, 76], [78, 70], [82, 100], [-6, 106], [-2, 80], [38, 24], [4, 30]]] },
  E: { width: 72, shapes: [[[0, 0], [66, -6], [62, 20], [27, 23], [27, 40], [56, 37], [53, 61], [27, 63], [27, 79], [68, 74], [70, 102], [-3, 106]]] },
  N: { width: 84, shapes: [[[0, 106], [-3, 0], [25, -5], [53, 55], [51, -3], [78, -8], [80, 102], [55, 107], [27, 47], [29, 103]]] },
  D: {
    width: 84,
    shapes: [
      [[0, 0], [47, -6], [78, 21], [80, 75], [49, 105], [-3, 106]],
      [[27, 24], [42, 21], [53, 33], [53, 68], [42, 81], [27, 81]],
    ],
  },
  I: { width: 36, shapes: [[[4, -2], [33, -7], [31, 105], [2, 103]]] },
  A: {
    width: 90,
    shapes: [
      [[27, -4], [56, -8], [88, 105], [60, 103], [54, 83], [29, 85], [23, 106], [-5, 103]],
      [[41, 28], [48, 61], [33, 62]],
    ],
  },
};
const WORD = "ZENDIA";
const GAP = 9;
const LEAN = 0.2;

function random(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

// The word as paths, leaning, with each long edge broken once so that no
// line of it is quite straight.
function wordPaths(scale) {
  const next = random(5);
  const paths = [];
  const feet = [];
  let x = 0;
  for (const letter of WORD) {
    const { width, shapes } = LETTERS[letter];
    const path = new Path2D();
    for (const shape of shapes) {
      const points = [];
      shape.forEach(([px, py], index) => {
        const [qx, qy] = shape[(index + 1) % shape.length];
        points.push([px, py]);
        const length = Math.hypot(qx - px, qy - py);
        if (length > 36) {
          const at = 0.35 + next() * 0.3;
          const push = (next() - 0.5) * 9;
          points.push([
            px + (qx - px) * at + ((qy - py) / length) * push,
            py + (qy - py) * at - ((qx - px) / length) * push,
          ]);
        }
      });
      points.forEach(([px, py], index) => {
        const sx = (x + px - (py - 52) * LEAN) * scale;
        const sy = py * scale;
        index ? path.lineTo(sx, sy) : path.moveTo(sx, sy);
      });
      path.closePath();
    }
    paths.push(path);
    // Where paint can run from: under the letter's foot.
    feet.push([(x + width * (0.2 + next() * 0.6) - 52 * LEAN) * scale, 100 * scale]);
    x += width + GAP;
  }
  return { paths, feet, width: (x - GAP) * scale };
}

function drip(ctx, x, y, width, length, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - width, y - 6);
  ctx.lineTo(x + width, y - 6);
  ctx.lineTo(x + width * 0.55, y + length);
  ctx.arc(x, y + length, width * 0.55, 0, Math.PI);
  ctx.closePath();
  ctx.fill();
}

/** Paints the piece over a panel of `width` by `height`. */
export function paintGraffiti(ctx, width, height) {
  const ink = BRAND.night;
  const mint = BRAND.cyan;

  // The panel: its seams and the heads of its bolts.
  ctx.strokeStyle = BRAND.muted;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width * 0.62, 0);
  ctx.lineTo(width * 0.62, height);
  ctx.moveTo(0, height * 0.14);
  ctx.lineTo(width, height * 0.14);
  ctx.stroke();
  ctx.fillStyle = BRAND.muted;
  for (const [bx, by] of [[0.6, 0.09], [0.64, 0.09], [0.6, 0.2], [0.64, 0.2], [0.04, 0.09], [0.96, 0.09]]) {
    ctx.beginPath();
    ctx.arc(width * bx, height * by, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const scale = 1.28;
  const { paths, feet, width: wordWidth } = wordPaths(scale);
  const next = random(9);
  ctx.save();
  ctx.translate((width - wordWidth) / 2 + 10, height * 0.4);
  ctx.rotate(-0.045);
  ctx.lineJoin = "miter";
  ctx.miterLimit = 4;

  // Mint thrown wide behind everything, and running.
  ctx.strokeStyle = ctx.fillStyle = mint;
  ctx.lineWidth = 30;
  for (const path of paths) {
    ctx.stroke(path);
    ctx.fill(path, "evenodd");
  }
  for (const [fx, fy] of feet) {
    drip(ctx, fx + 16, fy + 10, 5, 18 + next() * 46, mint);
  }

  // The shadow the letters throw, then their ink line.
  ctx.save();
  ctx.translate(9, 10);
  ctx.strokeStyle = ctx.fillStyle = ink;
  ctx.lineWidth = 10;
  for (const path of paths) {
    ctx.stroke(path);
    ctx.fill(path, "evenodd");
  }
  ctx.restore();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 11;
  for (const path of paths) {
    ctx.stroke(path);
  }

  // The fill, in three tones as a cel has: lit across the top, shaded at
  // the foot.
  for (const path of paths) {
    ctx.save();
    ctx.clip(path, "evenodd");
    ctx.fillStyle = BRAND.purple;
    ctx.fillRect(-60, -40, wordWidth + 140, 220);
    ctx.fillStyle = BRAND.pink;
    ctx.beginPath();
    ctx.moveTo(-60, -40);
    ctx.lineTo(wordWidth + 80, -40);
    ctx.lineTo(wordWidth + 80, 34);
    ctx.lineTo(-60, 58);
    ctx.fill();
    ctx.fillStyle = BRAND.blue;
    ctx.beginPath();
    ctx.moveTo(-60, 112);
    ctx.lineTo(wordWidth + 80, 88);
    ctx.lineTo(wordWidth + 80, 200);
    ctx.lineTo(-60, 200);
    ctx.fill();
    ctx.restore();
  }

  // Paint running from the feet of the letters.
  for (const [fx, fy] of feet) {
    const length = 22 + next() * 70;
    drip(ctx, fx, fy + 4, 6.5, length + 5, ink);
    drip(ctx, fx, fy + 2, 4, length, BRAND.blue);
  }

  // Splinters of ink and mint thrown off the ends.
  for (let i = 0; i < 9; i++) {
    const sx = next() < 0.5 ? -40 + next() * 30 : wordWidth + 6 + next() * 40;
    const sy = next() * 130;
    ctx.fillStyle = i % 3 ? ink : mint;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + 10 + next() * 12, sy - 4 + next() * 8);
    ctx.lineTo(sx + 3 + next() * 6, sy + 7 + next() * 6);
    ctx.fill();
  }
  ctx.restore();

  // The mascot, tagged above the word.
  ctx.save();
  ctx.translate(width * 0.13, height * 0.02);
  ctx.rotate(-0.12);
  paintMascot(ctx, "n", BRAND.pink, 0, 0, 2.5);
  ctx.restore();
}
