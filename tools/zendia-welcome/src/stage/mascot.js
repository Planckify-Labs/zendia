// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Zendia's mascot on a canvas, inside its ring of modes. Its drawings are the
// browser's own (ZendiaMascot.sys.mjs), so the preview shows the creature the
// statusline will.

import {
  MASCOT_COLORS,
  MASCOT_EDGE,
  MASCOT_FACE,
  MASCOT_SIZE,
  MASCOT_STROKES,
  MASCOT_VIEWBOX,
  mascotFrame,
} from "../../../../src/zen/zendia/ui/ZendiaMascot.sys.mjs";

export { MASCOT_SIZE };

/**
 * Paints the mascot inside its ring, in its drawing for `mode`, with its
 * box's top left corner at (x, y), `scale` times its own size. `color` is its
 * body's color; the ring takes the modes' own.
 */
export function paintMascot(ctx, mode, color = MASCOT_COLORS[mode], x, y, scale = 1) {
  const frame = mascotFrame(mode);
  const box = MASCOT_VIEWBOX;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale((scale * MASCOT_SIZE.width) / box.width, (scale * MASCOT_SIZE.height) / box.height);
  ctx.translate(-box.x, -box.y);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const outlines = [
    [frame.head, MASCOT_STROKES.head],
    ...frame.antennas.map(antenna => [antenna, MASCOT_STROKES.antenna]),
  ];
  // The ink edge first, under everything, then the ring and the silhouette.
  for (const [ink, extra] of [
    [true, MASCOT_EDGE.width],
    [false, 0],
  ]) {
    ctx.lineWidth = MASCOT_STROKES.ring + extra;
    for (const arc of frame.arcs) {
      ctx.strokeStyle = ink ? MASCOT_EDGE.color : MASCOT_COLORS[arc.mode];
      ctx.stroke(new Path2D(arc.d));
    }
    ctx.fillStyle = ctx.strokeStyle = ink ? MASCOT_EDGE.color : color;
    for (const [outline, width] of outlines) {
      ctx.beginPath();
      outline.forEach(([px, py], index) => (index ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.lineWidth = width + extra;
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.strokeStyle = MASCOT_FACE;
  for (const { points, width } of frame.face) {
    if (!width) {
      continue;
    }
    ctx.beginPath();
    points.forEach(([px, py], index) => (index ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.lineWidth = width;
    ctx.stroke();
  }
  ctx.restore();
}
