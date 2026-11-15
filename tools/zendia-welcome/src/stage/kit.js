// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// What every preview scene is made from: Zendia's colors, time helpers for
// animations that are a pure function of the clock (so a scene can be frozen
// at any moment), geometry, and canvases painted into textures.

import * as THREE from "three";

// ZendiaTheme.sys.mjs' palette (tokyonight), so the previews show the colors
// the browser will have.
const PALETTE = {
  base: ["#f5f6fa", "#1e2030"],
  raised: ["#e6e8f0", "#2a2d45"],
  border: ["#c4c8da", "#3b4261"],
  text: ["#1f2335", "#c8d3f5"],
  muted: ["#545c8a", "#8f98c4"],
  ink: ["#1b1d2b", "#1b1d2b"],
  night: ["#1a1b26", "#1a1b26"],
  snow: ["#c0caf5", "#c0caf5"],
  pink: ["#b0307f", "#fca7ea"],
  red: ["#c8174c", "#ff757f"],
  orange: ["#9c4f00", "#ff966c"],
  yellow: ["#7a5c14", "#ffc777"],
  green: ["#476628", "#c3e88d"],
  teal: ["#0b7461", "#4fd6be"],
  cyan: ["#00668a", "#86e1fc"],
  blue: ["#2160c4", "#82aaff"],
  purple: ["#7340cc", "#c099ff"],
  hint: ["#a25772", "#a25772"],
  hintText: ["#eef5ff", "#eef5ff"],
  // Web pages and the window around them.
  page: ["#ffffff", "#1e2030"],
  pageText: ["#1f2335", "#c8d3f5"],
  pageMuted: ["#545c8a", "#8f98c4"],
  pageRule: ["#dfe2ee", "#2f334d"],
  pageSoft: ["#eef0f7", "#2a2d45"],
  window: ["#dfe3f2", "#24263a"],
  float: ["#ffffff", "#1e2030"],
  floatEdge: ["#00000020", "#ffffff20"],
  tab: ["#ffffff", "#ffffff"],
  // The keyboard.
  cap: ["#eceef4", "#2a2d45"],
  capAlt: ["#d3d7e4", "#1f2133"],
  capText: ["#1f2335", "#c0caf5"],
  board: ["#b9bdcd", "#14151d"],
};

export const AGENT_COLORS = {
  claude: "#d97757",
  codex: "#10a37f",
  cursor: "#a3a3a3",
  antigravity: "#4285f4",
  opencode: "#f5a742",
  kiro: "#9046ff",
};

export function makeTheme(dark, accent) {
  const theme = { dark, accent: accent || (dark ? "#fca7ea" : "#b0307f") };
  for (const [name, pair] of Object.entries(PALETTE)) {
    theme[name] = pair[dark ? 1 : 0];
  }
  // The statusline's mode colors are the dark palette's on both themes: it
  // is always night with a bright mode chip.
  theme.modes = {
    n: PALETTE.pink[1],
    i: PALETTE.green[1],
    v: PALETTE.purple[1],
    e: PALETTE.blue[1],
  };
  return theme;
}

/* Time */

export const clamp01 = x => Math.min(1, Math.max(0, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = x => 1 - Math.pow(1 - clamp01(x), 3);
export const easeInOut = x => {
  x = clamp01(x);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
// A spring that settles at 1 with one small overshoot.
export const spring = x => {
  x = clamp01(x);
  return 1 - Math.exp(-7 * x) * Math.cos(9 * x) * (1 - x);
};
// 0 before `start`, 1 after `start + duration`.
export const span = (t, start, duration) => clamp01((t - start) / duration);

/**
 * A value that moves to a new target at each of its keys.
 *
 * @param {number} initial Its value before the first key.
 * @param {Array<[number, number, number?, Function?]>} keys
 *   `[time, value, duration, ease]`, in order of time.
 * @returns {(t: number) => number}
 */
export function track(initial, keys) {
  return t => {
    let value = initial;
    for (const [time, target, duration = 0.3, ease = easeOut] of keys) {
      if (t < time) {
        break;
      }
      value = lerp(value, target, ease((t - time) / duration));
    }
    return value;
  };
}

/**
 * How far down a key is (0 to 1), given when it is pressed.
 *
 * @param {Array<[number, number?]>} presses `[time, held seconds]`
 * @param {number} t
 */
export function pressDepth(presses, t) {
  let depth = 0;
  for (const [time, held = 0.09] of presses) {
    const dt = t - time;
    if (dt < 0 || dt > held + 0.3) {
      continue;
    }
    const down = easeOut(dt / 0.05);
    const up = dt > held ? spring((dt - held) / 0.28) : 0;
    depth = Math.max(depth, down * (1 - up));
  }
  return depth;
}

/* Geometry */

function roundedShape(width, height, radius) {
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, width / 2, height / 2);
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.absarc(x + width - r, y + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x + width, y + height - r);
  shape.absarc(x + width - r, y + height - r, r, 0, Math.PI / 2, false);
  shape.lineTo(x + r, y + height);
  shape.absarc(x + r, y + height - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(x, y + r);
  shape.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return shape;
}

/**
 * A flat rounded rectangle centered on the origin, facing +z, with UVs that
 * span it once.
 */
export function roundedRect(width, height, radius, segments = 8) {
  const geometry = new THREE.ShapeGeometry(
    roundedShape(width, height, radius),
    segments
  );
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i++) {
    uv.setXY(
      i,
      position.getX(i) / width + 0.5,
      position.getY(i) / height + 0.5
    );
  }
  return geometry;
}

function ring(width, height, radius, segments) {
  const r = Math.max(0.0001, Math.min(radius, width / 2, height / 2));
  const points = [];
  const corners = [
    [width / 2 - r, height / 2 - r, 0],
    [-width / 2 + r, height / 2 - r, Math.PI / 2],
    [-width / 2 + r, -height / 2 + r, Math.PI],
    [width / 2 - r, -height / 2 + r, Math.PI * 1.5],
  ];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= segments; i++) {
      const angle = start + (i / segments) * (Math.PI / 2);
      points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }
  }
  return points;
}

/**
 * A solid made of rounded rectangles stacked along z and skinned, closed at
 * both ends. Its vertices are shared, so the normals are smooth all round:
 * that is what lets an outline be drawn by pushing the surface outwards.
 *
 * @param {Array<{w: number, h: number, r: number, z: number, y?: number}>} sections
 *   From back to front.
 */
export function loft(sections, segments = 6) {
  const count = (segments + 1) * 4;
  const positions = [];
  const indices = [];
  // The flat ends get a ring of their own just inside the edge, so the edge's
  // rounded normal does not shade the whole face.
  const first = sections[0];
  const last = sections.at(-1);
  const inset = (s, by) => ({ ...s, w: s.w - by, h: s.h - by, r: s.r - by / 2 });
  const all = [inset(first, 0.02), ...sections, inset(last, 0.02)];
  for (const { w, h, r, z, y = 0 } of all) {
    for (const [px, py] of ring(w, h, r, segments)) {
      positions.push(px, py + y, z);
    }
  }
  for (let s = 0; s < all.length - 1; s++) {
    for (let i = 0; i < count; i++) {
      const a = s * count + i;
      const b = s * count + ((i + 1) % count);
      const c = a + count;
      const d = b + count;
      indices.push(a, b, d, a, d, c);
    }
  }
  const cap = (section, start, front) => {
    const center = positions.length / 3;
    positions.push(0, section.y ?? 0, section.z);
    for (let i = 0; i < count; i++) {
      const a = start + i;
      const b = start + ((i + 1) % count);
      indices.push(...(front ? [center, a, b] : [center, b, a]));
    }
  };
  cap(first, 0, false);
  cap(last, (all.length - 1) * count, true);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A rounded slab from z = -depth to 0 with a small bevel, facing +z. */
export function slab(width, height, depth, radius, bevel = depth * 0.12) {
  const b = Math.min(bevel, depth / 2);
  const section = (grow, z) => ({ w: width + grow * 2, h: height + grow * 2, r: radius + grow, z });
  return loft([section(-b, -depth), section(0, -depth + b), section(0, -b), section(-b, 0)]);
}

/* Cel shading, as an animation cel is painted: a shadow tone, a half tone
   and a lit tone with hard edges between them, a hard highlight, a rim of
   colored light along the silhouette, and an ink line made by drawing the
   object's back faces, pushed outwards, in ink. */

// The previews' colors are Zendia's own (ZendiaTheme.sys.mjs, tokyonight):
// its night for ink and surfaces, its hues a step more saturated so that
// they hold as cel paint next to the ink.
export const CEL = {
  ink: "#10111a",
  night: "#1a1b26",
  base: "#1e2030",
  raised: "#2a2d45",
  border: "#3b4261",
  paper: "#e4e9ff",
  pink: "#ff8de4",
  red: "#ff6677",
  orange: "#ff8f5c",
  yellow: "#ffc45a",
  green: "#b2ea68",
  teal: "#34dcc0",
  cyan: "#6edcff",
  blue: "#6f9dff",
  purple: "#b38cff",
};

let gradient;
export function toonGradient() {
  if (!gradient) {
    // Shadow, half tone, light. The shadow tone is whatever the ambient
    // light gives (Stage.jsx), the same as inside a cast shadow.
    gradient = new THREE.DataTexture(new Uint8Array([0, 0, 150, 255]), 4, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

// The rim light's color, shared by every cel material: a scene sets it to
// the color of its neon.
export const rimLight = { value: new THREE.Color(CEL.pink) };

/**
 * Toon shading with the highlight and the rim added. `gloss` is how bright
 * the highlight is (0 for none: large flat faces would flash whole).
 */
export class CelMaterial extends THREE.MeshToonMaterial {
  constructor({ gloss = 0.3, rim = 0.5, ...parameters } = {}) {
    super({ gradientMap: toonGradient(), ...parameters });
    this.celGloss = { value: gloss };
    this.celRim = { value: rim };
  }

  onBeforeCompile(shader) {
    shader.uniforms.celGloss = this.celGloss;
    shader.uniforms.celRim = this.celRim;
    shader.uniforms.celRimColor = rimLight;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        `uniform float celGloss;
        uniform float celRim;
        uniform vec3 celRimColor;
        void main() {`
      )
      .replace(
        "#include <opaque_fragment>",
        `vec3 celView = normalize(vViewPosition);
        #if NUM_DIR_LIGHTS > 0
          vec3 celHalf = normalize(directionalLights[0].direction + celView);
          outgoingLight += vec3(step(0.955, dot(normal, celHalf)) * celGloss);
        #endif
        float celEdge = 1.0 - clamp(dot(celView, normal), 0.0, 1.0);
        outgoingLight += celRimColor * step(0.72, celEdge) * celRim;
        #include <opaque_fragment>`
      );
  }

  customProgramCacheKey() {
    return "cel";
  }
}

const outlines = new Map();
/** The ink line's material, `thickness` in the object's own units. */
export function outlineMaterial(thickness, color = CEL.ink) {
  const key = `${thickness}|${color}`;
  if (!outlines.has(key)) {
    outlines.set(
      key,
      new THREE.ShaderMaterial({
        uniforms: { thickness: { value: thickness }, color: { value: new THREE.Color(color) } },
        vertexShader: `
          uniform float thickness;
          void main() {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * thickness, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 color;
          void main() {
            gl_FragColor = vec4(color, 1.0);
            #include <colorspace_fragment>
          }`,
        side: THREE.BackSide,
      })
    );
  }
  return outlines.get(key);
}

/* Painting */

const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, 'Noto Sans Mono', monospace";
const SANS = "system-ui, -apple-system, 'Segoe UI', 'Noto Sans', sans-serif";
export const font = (size, weight = 400, mono = false) =>
  `${weight} ${size}px ${mono ? MONO : SANS}`;

/**
 * A canvas of `width` by `height` CSS pixels, painted by `paint(ctx)` at
 * `scale` device pixels each, as a texture.
 */
export function paintTexture(width, height, scale, paint) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.textBaseline = "middle";
  paint(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function rrect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

export function fillRRect(ctx, x, y, width, height, radius, color) {
  rrect(ctx, x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
}

export function text(ctx, string, x, y, color, fontSpec, align = "left") {
  ctx.font = fontSpec;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(string, x, y);
  return ctx.measureText(string).width;
}

/** Wraps `string` to `width`; returns the y under the last line. */
export function paragraph(ctx, string, x, y, width, lineHeight, color, fontSpec) {
  ctx.font = fontSpec;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  let line = "";
  for (const word of string.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      line = word;
    } else {
      line = next;
    }
  }
  if (line) {
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

export const withAlpha = (hex, alpha) =>
  hex.slice(0, 7) +
  Math.round(clamp01(alpha) * 255)
    .toString(16)
    .padStart(2, "0");

export function mix(a, b, t) {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}
