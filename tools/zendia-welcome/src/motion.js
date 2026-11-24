// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Shared 2D motion primitives, theme colors (synced with ZendiaTheme.sys.mjs),
// and clock hook for the onboarding's pure 2D SVG scenes.

import { useEffect, useRef, useState } from "react";

// Zendia's Tokyo Night palette (moon for dark, day for light).
const PALETTE = {
  base: ["#f5f6fa", "#1e2030"],
  raised: ["#e6e8f0", "#2a2d45"],
  surface: ["#ffffff", "#23263a"],
  border: ["#c4c8da", "#3b4261"],
  text: ["#1f2335", "#c8d3f5"],
  muted: ["#545c8a", "#8f98c4"],
  ink: ["#1a1b26", "#1a1b26"],
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
  // Browser chrome & document mockup tones
  windowBg: ["#e8ecf7", "#181a28"],
  sidebarBg: ["#dfe4f3", "#1a1c2b"],
  pageBg: ["#ffffff", "#202336"],
  pageSoft: ["#eff2fa", "#292d44"],
  pageLine: ["#d6dceb", "#343956"],
};

export const MODE_ORDER = ["n", "i", "v", "e", "t", "l"];

export const MODE_META = {
  n: { key: "n", name: "NORMAL", color: "#fca7ea", colorLight: "#b0307f" },
  i: { key: "i", name: "INSERT", color: "#c3e88d", colorLight: "#476628" },
  v: { key: "v", name: "VISUAL", color: "#c099ff", colorLight: "#7340cc" },
  e: { key: "e", name: "EXPLORER", color: "#82aaff", colorLight: "#2160c4" },
  t: { key: "t", name: "TOOLBAR", color: "#ffc777", colorLight: "#7a5c14" },
  l: { key: "l", name: "LIBRARY", color: "#4fd6be", colorLight: "#0b7461" },
};

export const AGENT_COLORS = {
  claude: "#d97757",
  codex: "#10a37f",
  cursor: "#a3a3a3",
  antigravity: "#4285f4",
  opencode: "#f5a742",
  kiro: "#9046ff",
};

export function makeTheme(dark) {
  const index = dark ? 1 : 0;
  const theme = { dark };
  for (const [name, pair] of Object.entries(PALETTE)) {
    theme[name] = pair[index];
  }
  // Mascot & mode cell pastels stay luminous in both themes (outlined in ink).
  theme.modes = {
    n: PALETTE.pink[1],
    i: PALETTE.green[1],
    v: PALETTE.purple[1],
    e: PALETTE.blue[1],
    t: PALETTE.yellow[1],
    l: PALETTE.teal[1],
  };
  // High-contrast mode colors for text & focus indicators in the active theme.
  theme.modeText = {
    n: PALETTE.pink[index],
    i: PALETTE.green[index],
    v: PALETTE.purple[index],
    e: PALETTE.blue[index],
    t: PALETTE.yellow[index],
    l: PALETTE.teal[index],
  };
  return theme;
}

/* Easing & spring primitives */

export const clamp01 = x => Math.min(1, Math.max(0, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = x => 1 - Math.pow(1 - clamp01(x), 3);
export const easeInOut = x => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
export const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
// Soft jelly spring that overshoots once gently and settles at 1.
export const spring = x => {
  const t = clamp01(x);
  if (t <= 0) {
    return 0;
  }
  if (t >= 1) {
    return 1;
  }
  return 1 - Math.exp(-6.8 * t) * Math.cos(10.5 * t) * (1 - t);
};
export const span = (t, start, duration) => clamp01((t - start) / duration);

/**
 * A piecewise-smooth timeline track.
 *
 * @param {number} initial
 * @param {Array<[number, number, number?, Function?]>} keys
 */
export function track(initial, keys) {
  return t => {
    let value = initial;
    for (const [time, target, duration = 0.35, ease = easeOut] of keys) {
      if (t < time) {
        break;
      }
      value = lerp(value, target, ease((t - time) / duration));
    }
    return value;
  };
}

/**
 * Blend two #rrggbb colors.
 */
export function mixHex(a, b, t) {
  const f = clamp01(t);
  const parse = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const ca = parse(a);
  const cb = parse(b);
  return (
    "#" +
    ca
      .map((v, i) =>
        Math.round(lerp(v, cb[i], f))
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}

/**
 * Convert [[x, y], ...] into a closed SVG path string.
 */
export function outlinePath(pts) {
  if (!pts?.length) {
    return "";
  }
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    d += `L${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`;
  }
  return d + "Z";
}

export function centroid(pts) {
  let x = 0;
  let y = 0;
  for (let i = 0; i < pts.length; i++) {
    x += pts[i][0];
    y += pts[i][1];
  }
  return [x / pts.length, y / pts.length];
}

/**
 * Zendia's real 8-dash working ring math (from ZendiaAgentMotion.sys.mjs).
 * Returns [{ centre, half, glow }] in degrees.
 */
const RING_RUN = 3.9;
const RING_REST = 0.9;
const RING_DASHES = 8;
const RING_HALF = 10.95;

function wrap180(degrees) {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

export function ringDashes(seconds) {
  const ph = ((seconds % (RING_RUN + RING_REST)) + (RING_RUN + RING_REST)) % (RING_RUN + RING_REST);
  const dashes = [];
  const running = ph > 0 && ph < RING_RUN;
  const tau = running ? ph / RING_RUN : 0;
  const lead = 720 * (0.5 - 0.5 * Math.cos(Math.PI * tau));
  const speed = Math.sin(Math.PI * tau);
  const amp = running ? smoothstep(0, 0.55, ph) * (1 - smoothstep(RING_RUN - 0.75, RING_RUN, ph)) : 0;
  const pull = lead - 14 * speed;
  for (let i = 0; i < RING_DASHES; i++) {
    const centre = (360 / RING_DASHES) * i;
    const dl = wrap180(pull - centre);
    const sigma = dl < 0 ? 26 : 40;
    const glow = amp * Math.exp((-dl * dl) / (sigma * sigma));
    dashes.push({
      centre: centre + Math.sign(dl) * 9 * glow,
      half: RING_HALF * (1 + 1.3 * glow),
      glow,
    });
  }
  return dashes;
}

/**
 * Smooth 2D RAF loop clock. Respects `still` (reduced motion), `paused`, and
 * `frozenAt` (for deterministic screenshots).
 */
export function useClock({ duration = 10, pose = 0, still = false, paused = false, frozenAt }) {
  const staticTime = frozenAt != null ? frozenAt : pose;
  const [t, setT] = useState(still || frozenAt != null ? staticTime : 0);
  const elapsedRef = useRef(still || frozenAt != null ? staticTime : 0);

  useEffect(() => {
    if (frozenAt != null) {
      elapsedRef.current = frozenAt;
      setT(frozenAt);
      return undefined;
    }
    if (still) {
      elapsedRef.current = pose;
      setT(pose);
      return undefined;
    }
    if (paused) {
      return undefined;
    }
    let last = performance.now();
    let raf = 0;
    const tick = now => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      elapsedRef.current = (elapsedRef.current + dt) % duration;
      setT(elapsedRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, pose, still, paused, frozenAt]);

  return t;
}
