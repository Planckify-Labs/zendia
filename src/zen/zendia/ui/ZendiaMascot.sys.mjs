// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Zendia's mascot, as shapes: the creature from the logo inside its ring of
// modes (tools/branding). The ring is Zen's, cut into the six modes
// in the colors the window takes for each. Every mode keeps its place on it,
// NORMAL at the top and the rest clockwise, and the current mode's arc grows
// where it sits while the others shorten away from it down to a dot. Inside
// is the mascot as one rounded silhouette, head and bolt antenna, with a face
// for each mode that carries the mode's letter:
//   n  at rest, winking, its grin an N laid on its side
//   i  typing: a determined brow, one eye turned into the text caret
//   v  selecting: one eye wide, the other the highlighted span, a V grin
//   e  in the explorer: leaning toward the tabs, the near eye an E
//   t  at the toolbar: tipped back, the open eye a T under its brow
//   l  in the library: reading, one eye a slanted L
//
// Between two modes it morphs: the arcs slide and grow, the color blends,
// the head leans and the antenna swings, and each feature of the face bends
// into its counterpart in the next face, brows first and the mouth last.
//
// This file only describes the drawings, with no way of drawing them, so
// that the statusline (as SVG) and the onboarding (as SVG and on a canvas,
// tools/zendia-welcome) show the same creature. Coordinates are the logo's
// 1024 grid; MASCOT_VIEWBOX is the part of it the drawing fills.

export const MASCOT_MODES = ["n", "i", "v", "e", "t", "l"];

// The size it is laid out at where a size in pixels is needed, and the box
// of the 1024 grid that size shows.
export const MASCOT_SIZE = { width: 60, height: 60 };
export const MASCOT_VIEWBOX = { x: 166, y: 166, width: 692, height: 692 };

// The mode colors in Zendia's dark theme, for drawing it outside a browser
// window; the window itself takes them from ZendiaTheme. The face is cut in
// the statusline's night color.
export const MASCOT_COLORS = {
  n: "#fca7ea",
  i: "#c3e88d",
  v: "#c099ff",
  e: "#82aaff",
  t: "#ffc777",
  l: "#4fd6be",
};
export const MASCOT_FACE = "#1a1b26";

// An edge in Zendia's ink drawn under the ring and the silhouette, so the
// pastels hold their own over light pages as well as dark ones; over a dark
// page it sinks into the page and the mascot looks as it does in the logo.
// `width` is added to each stroke's own.
export const MASCOT_EDGE = { color: "#1a1b26", width: 34 };

// Stroke widths: the ring's arcs and the silhouette's rounded outline.
export const MASCOT_STROKES = { ring: 86, head: 70, antenna: 31.5 };

const RING = { radius: 300, gap: 10 };
// How long each arc is, in degrees, by its distance around the ring from the
// current mode: the current one, its neighbours, the next two, the one
// opposite. The opposite slot holds only the gap and the round caps, a dot.
const SPAN = [108, 70.4, 42.4, 26.4];

const HEAD = [
  [396.1, 493.7],
  [591.3, 463.2],
  [646.2, 512.0],
  [621.8, 609.6],
  [432.7, 627.9],
  [377.8, 560.8],
];

// Each mode's lean (degrees, about the middle of the head), antenna, and
// face. A face is strokes, each in a slot so that a switch morphs a left eye
// into a left eye: a path (M, L, H, V and Q, absolute) or a dot.
const POSES = {
  n: {
    tilt: 0,
    antennas: [
      [
        [585.2, 475.4],
        [612.6, 414.4],
        [591.3, 418.1],
        [627.9, 353.4],
        [649.3, 359.5],
        [618.8, 424.2],
        [643.1, 419.3],
        [605.9, 483.9],
      ],
    ],
    face: [
      { slot: "leftEye", d: "M470 531V569", width: 42 },
      { slot: "leftBrow", d: "M444 501Q468 480 492 501", width: 16 },
      { slot: "rightEye", d: "M530 553Q556 508 582 553", width: 22 },
      { slot: "mouth", d: "M492 596L518 612L522 596L548 612", width: 16 },
    ],
  },
  i: {
    tilt: -5,
    antennas: [
      [
        [569.8, 473.4],
        [620.1, 446.9],
        [603.9, 438.2],
        [662.3, 414],
        [673.4, 429.3],
        [619.1, 456.6],
        [638, 466.1],
        [579.2, 490],
      ],
    ],
    face: [
      { slot: "leftEye", d: "M474 539V573", width: 44 },
      { slot: "leftBrow", d: "M426 498L500 518", width: 20 },
      { slot: "rightEye", d: "M561 497V581", width: 15 },
      { slot: "rightBrow", d: "M545 495L577 493", width: 13 },
      { slot: "rightEye", d: "M545 583L577 581", width: 13 },
      { slot: "mouth", d: "M506 614L548 608", width: 24 },
    ],
  },
  v: {
    tilt: 0,
    antennas: [
      [
        [580.7, 474.9],
        [589.8, 412],
        [571.3, 420.9],
        [587.7, 352.3],
        [608.8, 352.3],
        [597.9, 419.3],
        [618.9, 408.4],
        [601.9, 477.2],
      ],
      [
        [600.8, 485.5],
        [646.3, 457.4],
        [630.5, 450.2],
        [683.7, 423.7],
        [695.1, 437.3],
        [645.9, 466.6],
        [664.3, 474.2],
        [610.7, 500.5],
      ],
    ],
    face: [
      { slot: "leftEye", dot: [462, 548], width: 64 },
      { slot: "leftBrow", d: "M437 498Q462 474 487 498", width: 16 },
      { slot: "rightEye", d: "M526 540L588 532", width: 30 },
      { slot: "rightBrow", d: "M533 491Q558 470 583 491", width: 16 },
      { slot: "mouth", d: "M498 596L520 624L542 596", width: 18 },
    ],
  },
  e: {
    tilt: -7,
    antennas: [
      [
        [572.6, 471.6],
        [526.3, 423.3],
        [521.7, 444.4],
        [475.4, 386.3],
        [489.1, 368.8],
        [537.6, 421.3],
        [542.2, 396.8],
        [588.2, 455.6],
      ],
    ],
    face: [
      { slot: "leftEye", d: "M476 522H446V586H476", width: 18 },
      { slot: "leftEye", d: "M446 554H470", width: 18 },
      { slot: "leftBrow", d: "M426 502Q450 478 474 502", width: 16 },
      { slot: "rightEye", d: "M519 556Q540 520 561 556", width: 20 },
      { slot: "mouth", d: "M486 608L526 614", width: 20 },
    ],
  },
  t: {
    tilt: 6,
    antennas: [
      [
        [585.2, 475.4],
        [612.6, 414.4],
        [591.3, 418.1],
        [627.9, 353.4],
        [649.3, 359.5],
        [618.8, 424.2],
        [643.1, 419.3],
        [605.9, 483.9],
      ],
    ],
    face: [
      { slot: "leftBrow", d: "M436 504H506", width: 22 },
      { slot: "leftEye", d: "M471 504V572", width: 22 },
      { slot: "rightEye", d: "M533 549Q558 504 583 549", width: 22 },
      { slot: "rightBrow", d: "M537 495Q560 474 583 495", width: 14 },
      { slot: "mouth", dot: [520, 610], width: 36 },
    ],
  },
  l: {
    tilt: 4,
    antennas: [
      [
        [585.2, 475.4],
        [612.6, 414.4],
        [591.3, 418.1],
        [627.9, 353.4],
        [649.3, 359.5],
        [618.8, 424.2],
        [643.1, 419.3],
        [605.9, 483.9],
      ],
    ],
    face: [
      {
        slot: "leftEye",
        d: "M456 520V584H492",
        width: 22,
        rotate: [-10, 470, 556],
      },
      { slot: "rightEye", d: "M560 527V565", width: 42 },
      { slot: "rightBrow", d: "M534 497Q558 476 582 497", width: 16 },
      { slot: "mouth", d: "M500 607Q522 628 544 607", width: 18 },
    ],
  },
};

const SLOTS = ["leftBrow", "rightBrow", "leftEye", "rightEye", "mouth"];
// Brows move first, the eyes just after, the mouth a beat later.
const DELAY = {
  leftBrow: 0,
  rightBrow: 0,
  leftEye: 0.08,
  rightEye: 0.08,
  mouth: 0.2,
};
// Where a slot's missing stroke waits, with no width, until it is needed.
const HOME = {
  leftBrow: [468, 500],
  rightBrow: [556, 490],
  leftEye: [468, 556],
  rightEye: [556, 542],
  mouth: [520, 608],
};
const POINTS = 20;
const LEAN_PIVOT = [512, 545];
const BOUNCE_PIVOT = [512, 560];

// A path's points, its curves flattened, then spaced evenly along it.
function sample({ d, dot, rotate }) {
  if (dot) {
    return Array.from({ length: POINTS }, () => dot.slice());
  }
  const tokens = d.match(/[MLHVQ]|-?\d+(?:\.\d+)?/g);
  const line = [];
  let x = 0;
  let y = 0;
  let command;
  for (let i = 0; i < tokens.length; ) {
    if (/[MLHVQ]/.test(tokens[i])) {
      command = tokens[i++];
      continue;
    }
    const n = k => +tokens[i + k];
    if (command == "M" || command == "L") {
      [x, y] = [n(0), n(1)];
      i += 2;
    } else if (command == "H") {
      x = n(0);
      i += 1;
    } else if (command == "V") {
      y = n(0);
      i += 1;
    } else if (command == "Q") {
      const [x0, y0, cx, cy, x1, y1] = [x, y, n(0), n(1), n(2), n(3)];
      for (let s = 1; s < 16; s++) {
        const t = s / 16;
        line.push([
          (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1,
          (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1,
        ]);
      }
      [x, y] = [x1, y1];
      i += 4;
    }
    line.push([x, y]);
  }
  const lengths = [0];
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    lengths.push(lengths[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = lengths.at(-1);
  let points = Array.from({ length: POINTS }, (_, k) => {
    const at = (total * k) / (POINTS - 1);
    let i = 1;
    while (i < line.length - 1 && lengths[i] < at) {
      i++;
    }
    const span = lengths[i] - lengths[i - 1] || 1;
    const t = (at - lengths[i - 1]) / span;
    const [a, b] = [line[i - 1], line[i]];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  });
  if (rotate) {
    points = points.map(p => turn(p, rotate[0], [rotate[1], rotate[2]]));
  }
  // Drawn left to right, or top to bottom, so no stroke flips over as it morphs.
  const [first, last] = [points[0], points.at(-1)];
  if (
    first[0] > last[0] + 2 ||
    (Math.abs(first[0] - last[0]) <= 2 && first[1] > last[1])
  ) {
    points.reverse();
  }
  return points;
}

function turn([x, y], degrees, [cx, cy]) {
  const a = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(a), Math.sin(a)];
  return [
    cx + (x - cx) * cos - (y - cy) * sin,
    cy + (x - cx) * sin + (y - cy) * cos,
  ];
}

// Each face as the same strokes in the same order: the longest stroke of a
// slot first, and a widthless stroke for each one this face does not have.
const FACES = (() => {
  const bySlot = {};
  for (const mode of MASCOT_MODES) {
    bySlot[mode] = Object.fromEntries(SLOTS.map(slot => [slot, []]));
    for (const stroke of POSES[mode].face) {
      const points = sample(stroke);
      const length = points.reduce(
        (sum, p, k) =>
          k
            ? sum + Math.hypot(p[0] - points[k - 1][0], p[1] - points[k - 1][1])
            : 0,
        0
      );
      bySlot[mode][stroke.slot].push({ points, width: stroke.width, length });
    }
    for (const slot of SLOTS) {
      bySlot[mode][slot].sort((a, b) => b.length - a.length);
    }
  }
  const count = Object.fromEntries(
    SLOTS.map(slot => [
      slot,
      Math.max(1, ...MASCOT_MODES.map(mode => bySlot[mode][slot].length)),
    ])
  );
  const faces = {};
  for (const mode of MASCOT_MODES) {
    faces[mode] = SLOTS.flatMap(slot => {
      const strokes = bySlot[mode][slot];
      const rest = strokes[0]
        ? strokes[0].points[Math.floor(POINTS / 2)]
        : HOME[slot];
      return Array.from({ length: count[slot] }, (_, k) => ({
        slot,
        ...(strokes[k] ?? {
          points: Array.from({ length: POINTS }, () => rest.slice()),
          width: 0,
        }),
      }));
    });
  }
  return faces;
})();

const clamp = t => Math.min(1, Math.max(0, t));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
// A soft overshoot, so a feature settles into place instead of stopping dead.
const settle = t => 1 + 2.6 * (t - 1) ** 3 + 1.6 * (t - 1) ** 2;

// Each mode's arc with `mode` current: its middle and its length, in degrees.
function layout(mode) {
  const current = MASCOT_MODES.indexOf(mode);
  const arcs = {};
  let start = -90 + 60 * current - SPAN[0] / 2;
  for (let k = 0; k < MASCOT_MODES.length; k++) {
    const length = SPAN[Math.min(k, MASCOT_MODES.length - k)];
    arcs[MASCOT_MODES[(current + k) % MASCOT_MODES.length]] = {
      middle: start + length / 2,
      length,
    };
    start += length;
  }
  return arcs;
}

function arcPath(middle, length) {
  const caps = (MASCOT_STROKES.ring / RING.radius) * (180 / Math.PI);
  // With nothing left but the round caps, a dot.
  const drawn = Math.max(0.02, length - RING.gap - caps);
  const point = degrees => {
    const a = (degrees * Math.PI) / 180;
    return `${(512 + RING.radius * Math.cos(a)).toFixed(2)} ${(512 + RING.radius * Math.sin(a)).toFixed(2)}`;
  };
  return `M${point(middle - drawn / 2)}A${RING.radius} ${RING.radius} 0 ${drawn > 180 ? 1 : 0} 1 ${point(middle + drawn / 2)}`;
}

/**
 * The drawing on its way from one mode to another, or at rest in one.
 *
 * @param {string} from The mode it leaves; unknown ones count as NORMAL.
 * @param {string} [to] The mode it goes to.
 * @param {number} [t] How far along, from 0 to 1.
 * @param {object} [options]
 * @param {number} [options.blink] How far its eyes are shut, from 0 to 1.
 * @returns {{
 *   arcs: Array<{mode: string, d: string}>,
 *   color: number,
 *   head: number[][],
 *   antennas: number[][][],
 *   face: Array<{points: number[][], width: number}>,
 * }}
 *   The ring's arcs, each to be stroked in its mode's color; how far the
 *   body's color has gone from `from`'s toward `to`'s; the silhouette's
 *   outline and its two antennas (the same one twice where there is one),
 *   filled and stroked in that color with round joins; and the face's
 *   strokes, in MASCOT_FACE with round caps and joins. In the 1024 grid.
 */
export function mascotFrame(from, to = from, t = 1, { blink = 0 } = {}) {
  from = POSES[from] ? from : "n";
  to = POSES[to] ? to : "n";
  t = clamp(t);
  const moving = from != to;
  const eased = moving ? ease(t) : 1;
  const settled = moving ? settle(t) : 1;

  const [before, after] = [layout(from), layout(to)];
  const arcs = MASCOT_MODES.map(mode => {
    const a = before[mode];
    let middle = after[mode].middle;
    // Around the short way.
    while (middle - a.middle > 180) {
      middle -= 360;
    }
    while (a.middle - middle > 180) {
      middle += 360;
    }
    return {
      mode,
      d: arcPath(
        lerp(a.middle, middle, eased),
        lerp(a.length, after[mode].length, eased)
      ),
    };
  });

  // A small squash and stretch on the way, and the lean of the new mode.
  const squash = 1 + 0.035 * Math.sin(Math.PI * t);
  const tilt = lerp(POSES[from].tilt, POSES[to].tilt, settled);
  const place = ([x, y]) =>
    turn(
      [
        BOUNCE_PIVOT[0] + (x - BOUNCE_PIVOT[0]) * squash,
        BOUNCE_PIVOT[1] + (y - BOUNCE_PIVOT[1]) * (2 - squash),
      ],
      tilt,
      LEAN_PIVOT
    );

  const antennasOf = mode => {
    const [first, second] = POSES[mode].antennas;
    return [first, second ?? first];
  };
  const [a0, a1] = [antennasOf(from), antennasOf(to)];
  const antennas = [0, 1].map(j =>
    a0[j].map((p, k) =>
      place([
        lerp(p[0], a1[j][k][0], settled),
        lerp(p[1], a1[j][k][1], settled),
      ])
    )
  );

  const face = FACES[from].map((stroke, k) => {
    const next = FACES[to][k];
    const local = moving
      ? settle(clamp((t - DELAY[stroke.slot]) / (1 - DELAY[stroke.slot])))
      : 1;
    let points = stroke.points.map((p, j) => [
      lerp(p[0], next.points[j][0], local),
      lerp(p[1], next.points[j][1], local),
    ]);
    // A blink shuts each eye toward its own middle, the way lids close.
    if (blink && (stroke.slot == "leftEye" || stroke.slot == "rightEye")) {
      const middle = points.reduce((sum, p) => sum + p[1] / POINTS, 0);
      points = points.map(([x, y]) => [
        x,
        middle + (y - middle) * (1 - 0.85 * blink),
      ]);
    }
    points = points.map(place);
    // A stroke with no length still needs two points for its round caps to
    // draw a dot.
    const [first, last] = [points[0], points.at(-1)];
    if (Math.hypot(last[0] - first[0], last[1] - first[1]) < 0.01) {
      points[points.length - 1] = [first[0] + 0.01, first[1]];
    }
    return {
      points,
      width: Math.max(0, lerp(stroke.width, next.width, clamp(local))),
    };
  });

  return { arcs, color: eased, head: HEAD.map(place), antennas, face };
}

/**
 * A color partway between two #rrggbb colors.
 *
 * @param {string} a
 * @param {string} b
 * @param {number} t From 0 (a) to 1 (b).
 * @returns {string}
 */
export function mixColor(a, b, t) {
  const channels = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const [from, to] = [channels(a), channels(b)];
  return `#${from
    .map((v, i) =>
      Math.round(lerp(v, to[i], clamp(t)))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}
