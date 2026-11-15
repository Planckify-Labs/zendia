// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Zendia's mascot on a canvas. Its drawings are the browser's own
// (ZendiaMascot.sys.mjs), so the preview shows the creature the statusline
// will.

import { MASCOT_SIZE, mascotColors, mascotShapes } from "../../../../src/zen/zendia/ui/ZendiaMascot.sys.mjs";

export { MASCOT_SIZE };

/**
 * Paints the mascot's drawing for `mode` with its box's top left corner at
 * (x, y), `scale` times its own size.
 */
export function paintMascot(ctx, mode, color, x, y, scale = 1) {
  const colors = mascotColors(color);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.lineJoin = "miter";
  for (const { paint, points, line } of mascotShapes(mode)) {
    ctx.beginPath();
    points.forEach(([px, py], index) => (index ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = colors[paint];
    ctx.fill();
    if (line) {
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }
  }
  ctx.restore();
}
