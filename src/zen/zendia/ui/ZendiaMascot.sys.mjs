// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Zendia's mascot, as shapes. It is a flat neon creature cut from hard
// angles: a visor of a head in the color of the mode, two shard eyes with a
// lit iris, a bolt of lightning for an antenna, all with a second edge
// showing behind, as a misprinted sticker has.
//
// It has one drawing for each mode, held like a cel, and in each it is
// doing what the mode is for:
//   n  at rest: antenna up, splinters breaking off its corner
//   i  writing: brows down, eyes on a text caret it has beside it, what it
//      has typed so far under it
//   v  selecting: eyes wide, mouth open, the corners of a selection around
//      it and its antenna split in two
//   e  in the explorer: looking over at a stack of tabs it holds out toward
//      the sidebar, antenna pointing there
//   t  at the toolbar: looking up at a strip of buttons above its head
//   l  in the library: lids lowered over an open book
//
// This file only describes the drawings, with no way of drawing them, so
// that the statusline (as SVG) and the onboarding's preview (on a canvas,
// tools/zendia-welcome) show the same creature.

export const MASCOT_SIZE = { width: 60, height: 52 };

// The parts of a drawing name their paint; whoever draws picks the colors
// (see mascotColors).
const BODY = "body";
const EDGE = "edge";
const INK = "ink";
const WHITE = "white";
const GLOW = "glow";

const HEAD = [
  [10, 20],
  [42, 15],
  [51, 23],
  [47, 39],
  [16, 42],
  [7, 31],
];

// The eyes: where each sits, and its size.
const EYES = [
  [21, 29],
  [36, 27],
];

// The antenna: a bolt, drawn from its foot.
const BOLT = [
  [0, 1],
  [4.5, -9],
  [1, -8.4],
  [7, -19],
  [10.5, -18],
  [5.5, -7.4],
  [9.5, -8.2],
  [3.4, 2.4],
];

const quad = (x, y, width, height, slant = 0) => [
  [x, y + slant],
  [x + width, y],
  [x + width, y + height],
  [x, y + height + slant],
];
const diamond = (cx, cy, rx, ry) => [
  [cx, cy - ry],
  [cx + rx, cy],
  [cx, cy + ry],
  [cx - rx, cy],
];

// Each pose: where the eyes look and how large they are, the antenna (its
// foot, its turn in degrees, its size; a second one for VISUAL), the mouth,
// and what the mode adds around the head, from back to front.
const POSES = {
  n: {
    look: [0, 0],
    eye: [9.5, 8.5],
    antennas: [[41, 16, 0, 1]],
    mouth: quad(26, 36.4, 6, 1.7, 0.6),
    behind: [
      {
        paint: EDGE,
        points: [
          [6, 14],
          [12, 11.5],
          [9.5, 17],
        ],
      },
      {
        paint: EDGE,
        points: [
          [15, 9],
          [18.5, 7.6],
          [17.4, 12],
        ],
      },
    ],
  },
  i: {
    look: [1.2, 1.5],
    eye: [9.5, 8],
    antennas: [[39, 16, 38, 0.85]],
    // A small open mouth: it is spelling the words out.
    mouth: diamond(29.5, 37, 2.6, 2),
    brows: -1,
    front: [
      // The caret, an I-beam, on the side it writes toward.
      { paint: WHITE, points: quad(54.2, 21, 2.6, 22), line: true },
      { paint: WHITE, points: quad(51.4, 19.4, 8.2, 2.4), line: true },
      { paint: WHITE, points: quad(51.4, 41.6, 8.2, 2.4), line: true },
      // What it has typed.
      { paint: BODY, points: quad(14, 46.6, 7, 2.6, 0.5), line: true },
      { paint: BODY, points: quad(24, 46, 9, 2.6, 0.5), line: true },
      { paint: BODY, points: quad(36, 45.2, 5, 2.6, 0.4), line: true },
    ],
  },
  v: {
    look: [0, 0],
    eye: [11.5, 10.5],
    antennas: [
      [40, 16, -16, 0.95],
      [44, 18, 34, 0.8],
    ],
    mouth: [
      [25, 35.6],
      [33, 34.8],
      [31.4, 38.8],
      [26.6, 39.2],
    ],
    behind: [
      // The stretch it has selected, behind it.
      { paint: GLOW, points: quad(1, 24, 58, 13, 1.6) },
    ],
    front: [
      // The corners of the selection.
      {
        paint: WHITE,
        points: [
          [2, 9],
          [13, 9],
          [13, 12],
          [5, 12],
          [5, 19],
          [2, 19],
        ],
        line: true,
      },
      {
        paint: WHITE,
        points: [
          [58, 49],
          [47, 49],
          [47, 46],
          [55, 46],
          [55, 39],
          [58, 39],
        ],
        line: true,
      },
    ],
  },
  e: {
    look: [-2, 0.3],
    eye: [9.5, 8.5],
    antennas: [[38, 16, -68, 1]],
    // A smirk, tilted toward the tabs.
    mouth: [
      [25, 36],
      [31, 37.4],
      [31, 38.9],
      [25, 37.5],
    ],
    front: [
      // Tabs, stacked as they are in the sidebar; the one it is on is lit.
      { paint: BODY, points: quad(0, 21.6, 9, 4, -0.5), line: true },
      { paint: WHITE, points: quad(0, 27.6, 9, 4, -0.5), line: true },
      { paint: WHITE, points: quad(0, 33.6, 9, 4, -0.5), line: true },
    ],
  },
  t: {
    look: [0, -1.9],
    eye: [9.5, 9],
    antennas: [[45, 19, 14, 1.15]],
    mouth: quad(27, 36.6, 4.4, 1.6, 0.4),
    brows: 1,
    front: [
      // The toolbar above it, with its buttons.
      {
        paint: WHITE,
        points: [
          [9, 4.6],
          [40, 2],
          [40.4, 9],
          [9.4, 11.6],
        ],
        line: true,
      },
      { paint: INK, points: diamond(15, 7.6, 1.7, 1.7) },
      { paint: INK, points: diamond(21.5, 7, 1.7, 1.7) },
      {
        paint: BODY,
        points: [
          [27, 5.4],
          [36.6, 4.6],
          [36.9, 7.8],
          [27.3, 8.6],
        ],
        line: true,
      },
    ],
  },
  l: {
    look: [0.3, 1.7],
    eye: [9.5, 8.5],
    antennas: [[43, 18, 112, 0.85]],
    mouth: quad(27, 36.6, 4, 1.5, 0.3),
    lids: 0.46,
    front: [
      // An open book under its chin, with a ribbon marking the place.
      {
        paint: WHITE,
        points: [
          [11, 43.4],
          [29, 45.4],
          [29, 51.4],
          [10, 48.8],
        ],
        line: true,
      },
      {
        paint: WHITE,
        points: [
          [29, 45.4],
          [48, 42],
          [49.6, 47.6],
          [29, 51.4],
        ],
        line: true,
      },
      {
        paint: GLOW,
        points: [
          [38, 44],
          [41, 43.4],
          [41.6, 51],
          [39.8, 49.4],
          [38.6, 51.4],
        ],
      },
    ],
  },
};

function turned(points, [x, y, degrees, scale]) {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle) * scale;
  const sin = Math.sin(angle) * scale;
  return points.map(([px, py]) => [
    x + px * cos - py * sin,
    y + px * sin + py * cos,
  ]);
}

const moved = (points, dx, dy) => points.map(([x, y]) => [x + dx, y + dy]);

// An eye is a shard: a slanted quadrilateral with its sharp corner outward.
function shard(cx, cy, [width, height], side, grow = 1) {
  const w = (width * grow) / 2;
  const h = (height * grow) / 2;
  return [
    [cx - side * w, cy - h * 0.45],
    [cx + side * w * 0.25, cy - h],
    [cx + side * w, cy + h * 0.2],
    [cx - side * w * 0.35, cy + h],
  ];
}

/**
 * The mascot's drawing for a mode.
 *
 * @param {string} mode A mode's key; unknown ones get NORMAL's drawing.
 * @returns {Array<{paint: string, points: number[][], line?: boolean}>}
 *   Polygons from back to front, in MASCOT_SIZE's box. `line` asks for an
 *   ink line around the shape.
 */
export function mascotShapes(mode) {
  const pose = POSES[mode] ?? POSES.n;
  const bolts = pose.antennas.map(antenna => turned(BOLT, antenna));
  const shapes = [
    ...(pose.behind ?? []),
    // The second edge, behind the creature.
    { paint: EDGE, points: moved(HEAD, 2.4, 2.8) },
    ...bolts.map(bolt => ({ paint: EDGE, points: moved(bolt, 2, 2.2) })),
    ...bolts.map(bolt => ({ paint: BODY, points: bolt, line: true })),
    { paint: BODY, points: HEAD, line: true },
  ];
  EYES.forEach(([cx, cy], index) => {
    // The eyes' sharp corners point outward.
    const side = index ? 1 : -1;
    const [width, height] = pose.eye;
    const [lx, ly] = pose.look;
    shapes.push(
      { paint: INK, points: shard(cx, cy, pose.eye, side, 1.3) },
      { paint: WHITE, points: shard(cx, cy, pose.eye, side) },
      {
        paint: GLOW,
        points: diamond(cx + lx, cy + ly, width * 0.3, height * 0.36),
      },
      {
        paint: INK,
        points: diamond(cx + lx, cy + ly, width * 0.12, height * 0.2),
      }
    );
    if (pose.lids) {
      // A lowered lid: the head's color over the top of the eye.
      const top = cy - height * 0.7;
      const bottom = cy - height / 2 + height * pose.lids;
      shapes.push({
        paint: BODY,
        points: [
          [cx - width * 0.75, top],
          [cx + width * 0.75, top],
          [cx + width * 0.75, bottom - 0.8],
          [cx - width * 0.75, bottom + 0.8],
        ],
      });
    }
    if (pose.brows) {
      // A brow over each eye: drawn down toward the middle when it
      // concentrates (-1), raised when it looks up (1).
      const inner = cx - side * width * 0.5;
      const outer = cx + side * width * 0.6;
      const lift = pose.brows < 0 ? [1.6, -1.4] : [-2.4, -1.2];
      const y = cy - height * 0.82;
      shapes.push({
        paint: INK,
        points: [
          [inner, y + lift[0]],
          [outer, y + lift[1]],
          [outer, y + lift[1] + 1.7],
          [inner, y + lift[0] + 1.7],
        ],
      });
    }
  });
  shapes.push({ paint: INK, points: pose.mouth }, ...(pose.front ?? []));
  return shapes;
}

/**
 * The colors of the mascot's paints.
 *
 * @param {string} body The mode's color.
 * @returns {Record<string, string>}
 */
export function mascotColors(body) {
  return {
    [BODY]: body,
    [EDGE]: "#6a3fd8",
    [INK]: "#10111a",
    [WHITE]: "#ffffff",
    [GLOW]: "#22b8ff",
  };
}
