// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Zendia's mascot on a canvas, among its six mode cells. Its drawings are the
// browser's own (ZendiaMascot.sys.mjs), so the preview shows the creature the
// statusline will.

import {
  MASCOT_COLORS,
  MASCOT_EDGE,
  MASCOT_FACE,
  MASCOT_SIZE,
  MASCOT_VIEWBOX,
  mascotFrame,
} from "../../../../src/zen/zendia/ui/ZendiaMascot.sys.mjs";

export { MASCOT_SIZE };

/**
 * Paints the mascot among its six mode cells, in its drawing for `mode`, with
 * its box's top left corner at (x, y), `scale` times its own size. `color` is
 * the mascot's; the cells take the modes' own.
 */
export function paintMascot(ctx, mode, color = MASCOT_COLORS[mode], x, y, scale = 1) {
  const frame = mascotFrame(mode);
  const box = MASCOT_VIEWBOX;
  const shape = pts => {
    ctx.beginPath();
    pts.forEach(([px, py], index) => (index ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
  };
  ctx.save();
  ctx.translate(x, y);
  ctx.scale((scale * MASCOT_SIZE.width) / box.width, (scale * MASCOT_SIZE.height) / box.height);
  ctx.translate(-box.x, -box.y);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // The ink edge first, under everything, then the cells and the mascot.
  ctx.fillStyle = ctx.strokeStyle = MASCOT_EDGE.color;
  ctx.lineWidth = MASCOT_EDGE.width;
  for (const pts of [...frame.cells.map(c => c.points), frame.head]) {
    shape(pts);
    ctx.fill();
    ctx.stroke();
  }
  for (const cell of frame.cells) {
    ctx.fillStyle = MASCOT_COLORS[cell.mode];
    shape(cell.points);
    ctx.fill();
  }
  ctx.fillStyle = color;
  shape(frame.head);
  ctx.fill();
  ctx.strokeStyle = MASCOT_FACE;
  for (const { points, width } of frame.eyes) {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    ctx.lineTo(...points[1]);
    ctx.stroke();
  }
  ctx.fillStyle = MASCOT_FACE;
  for (const letter of frame.letters) {
    ctx.save();
    ctx.translate(letter.x, letter.y);
    ctx.rotate((letter.lean * Math.PI) / 180);
    ctx.scale(letter.scale, letter.scale);
    ctx.fill(new Path2D(letter.d), "evenodd");
    ctx.restore();
  }
  ctx.restore();
}
