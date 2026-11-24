// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Zendia's living 2D mascot, rendered directly from ZendiaMascot.sys.mjs's
// six-cell Voronoi geometry and jelly spring morphs. Supports:
//  - smooth jelly morphing between all six modes (n, i, v, e, t, l)
//  - cell-by-cell jelly bloom entrance (mirroring ZendiaStatusline.sys.mjs)
//  - natural periodic blinking & gentle pointer eye tracking
//  - interactive Voronoi cells (hover/click any cell to morph into its mode)
//  - subtle celebratory nudge bounce when a choice is toggled

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MASCOT_COLORS,
  MASCOT_EDGE,
  MASCOT_FACE,
  MASCOT_MODES,
  MASCOT_MORPH_MS,
  MASCOT_VIEWBOX,
  mascotFrame,
  mixColor,
} from "../../../src/zen/zendia/ui/ZendiaMascot.sys.mjs";
import { centroid, clamp01, outlinePath, spring } from "./motion.js";

const BLOOM_MS = 780;
const BLINK_MS = 165;
const NUDGE_MS = 380;

export function Mascot2D({
  pose = "n",
  still = false,
  bloom = false,
  blink = true,
  trackPointer = false,
  interactive = false,
  nudge = 0,
  onSelectPose,
  onHoverPose,
  className = "",
  ...props
}) {
  const svgRef = useRef(null);
  const shownPose = useRef(pose);
  const [morph, setMorph] = useState(() => ({ from: pose, to: pose, t: 1 }));
  const [bloomT, setBloomT] = useState(bloom && !still ? 0 : 1);
  const [blinkT, setBlinkT] = useState(0);
  const [nudgeT, setNudgeT] = useState(1);
  const [gaze, setGaze] = useState([0, 0]);
  const [hoveredCell, setHoveredCell] = useState(null);

  // Jelly morph whenever `pose` changes.
  useEffect(() => {
    const from = shownPose.current;
    shownPose.current = pose;
    if (from == pose || still) {
      setMorph({ from: pose, to: pose, t: 1 });
      return undefined;
    }
    const start = performance.now();
    let raf = 0;
    const step = now => {
      const t = clamp01((now - start) / MASCOT_MORPH_MS);
      setMorph({ from, to: pose, t });
      if (t < 1) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [pose, still]);

  // Cell-by-cell jelly bloom entrance (head first, then cells around the ring).
  useEffect(() => {
    if (!bloom || still) {
      setBloomT(1);
      return undefined;
    }
    const start = performance.now();
    let raf = 0;
    const step = now => {
      const t = clamp01((now - start) / BLOOM_MS);
      setBloomT(t);
      if (t < 1) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [bloom, still]);

  // Playful jelly hop when a user toggles an onboarding choice.
  const firstNudge = useRef(true);
  useEffect(() => {
    if (firstNudge.current) {
      firstNudge.current = false;
      return undefined;
    }
    if (!nudge || still) {
      return undefined;
    }
    const start = performance.now();
    let raf = 0;
    const step = now => {
      const t = clamp01((now - start) / NUDGE_MS);
      setNudgeT(t);
      if (t < 1) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [nudge, still]);

  // Natural periodic eye blink.
  useEffect(() => {
    if (!blink || still) {
      setBlinkT(0);
      return undefined;
    }
    let timeout = 0;
    let raf = 0;
    let alive = true;
    const schedule = () => {
      const delay = 2800 + Math.random() * 2800;
      timeout = window.setTimeout(() => {
        if (!alive) {
          return;
        }
        const start = performance.now();
        const run = now => {
          if (!alive) {
            return;
          }
          const p = clamp01((now - start) / BLINK_MS);
          // Asymmetric lid: quick shut, slightly gentler open.
          const shut = p < 0.42 ? p / 0.42 : 1 - (p - 0.42) / 0.58;
          setBlinkT(Math.sin(clamp01(shut) * Math.PI * 0.5));
          if (p < 1) {
            raf = requestAnimationFrame(run);
          } else {
            setBlinkT(0);
            schedule();
          }
        };
        raf = requestAnimationFrame(run);
      }, delay);
    };
    schedule();
    return () => {
      alive = false;
      clearTimeout(timeout);
      cancelAnimationFrame(raf);
    };
  }, [blink, still]);

  // Smooth spring-damped pointer gaze tracking.
  useEffect(() => {
    if (!trackPointer || still) {
      setGaze([0, 0]);
      return undefined;
    }
    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    let raf = 0;
    const onMove = event => {
      const el = svgRef.current;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const mag = Math.min(1, dist / 320);
      target.x = (dx / dist) * mag * 14;
      target.y = (dy / dist) * mag * 10;
      if (!raf) {
        raf = requestAnimationFrame(follow);
      }
    };
    const onLeave = event => {
      if (event.relatedTarget) {
        return;
      }
      target.x = 0;
      target.y = 0;
      if (!raf) {
        raf = requestAnimationFrame(follow);
      }
    };
    const follow = () => {
      current.x += (target.x - current.x) * 0.14;
      current.y += (target.y - current.y) * 0.14;
      setGaze([current.x, current.y]);
      if (Math.abs(target.x - current.x) > 0.08 || Math.abs(target.y - current.y) > 0.08) {
        raf = requestAnimationFrame(follow);
      } else {
        raf = 0;
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseout", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("mouseout", onLeave);
      cancelAnimationFrame(raf);
    };
  }, [trackPointer, still]);

  const drawing = mascotFrame(morph.from, morph.to, morph.t, { blink: blinkT });
  const bodyColor = mixColor(MASCOT_COLORS[morph.from], MASCOT_COLORS[morph.to], drawing.color);

  // Per-cell bloom transforms (head pops first, cells ripple clockwise from lead).
  const leadIndex = Math.max(0, MASCOT_MODES.indexOf(morph.to));
  const headCentre = useMemo(() => centroid(drawing.head), [drawing.head]);
  const headBloom = bloomT >= 1 ? 1 : spring(clamp01(bloomT / 0.45));

  const cellScales = drawing.cells.map((cell, index) => {
    const ringPos = (index - leadIndex + MASCOT_MODES.length) % MASCOT_MODES.length;
    const delay = 0.09 + ringPos * 0.075;
    const scale = bloomT >= 1 ? 1 : spring(clamp01((bloomT - delay) / 0.5));
    const hoverBoost = interactive && hoveredCell === cell.mode ? 1.045 : 1;
    return { scale: Math.max(0, scale) * hoverBoost, center: centroid(cell.points) };
  });

  const letterBloom = bloomT >= 1 ? 1 : spring(clamp01((bloomT - 0.52) / 0.48));

  // Subtle vertical squash-and-stretch hop on nudge.
  const nudgeWave = nudgeT < 1 ? Math.exp(-5.5 * nudgeT) * Math.sin(Math.PI * 2.2 * nudgeT) : 0;
  const nudgeSx = 1 - nudgeWave * 0.06;
  const nudgeSy = 1 + nudgeWave * 0.07;
  const nudgeTy = -Math.max(0, nudgeWave) * 24;

  const scaleAbout = (s, [cx, cy]) =>
    Math.abs(s - 1) < 0.001 ? undefined : `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${s.toFixed(3)}) translate(${(-cx).toFixed(1)} ${(-cy).toFixed(1)})`;

  const wholeTransform =
    Math.abs(nudgeWave) < 0.001
      ? undefined
      : `translate(512 ${(512 + nudgeTy).toFixed(1)}) scale(${nudgeSx.toFixed(3)} ${nudgeSy.toFixed(3)}) translate(-512 -512)`;

  const headPath = outlinePath(drawing.head);
  const cellPaths = drawing.cells.map(cell => outlinePath(cell.points));
  const box = MASCOT_VIEWBOX;

  return (
    <svg
      ref={svgRef}
      className={`zen-welcome-mascot ${interactive ? "is-interactive" : ""} ${className}`}
      viewBox={`${box.x - 16} ${box.y - 16} ${box.width + 32} ${box.height + 32}`}
      aria-hidden="true"
      {...props}
    >
      <g transform={wholeTransform}>
        {/* Ink outline edge beneath all cells & head — Zendia's signature crisp seam. */}
        <g fill={MASCOT_EDGE.color} stroke={MASCOT_EDGE.color} strokeWidth={MASCOT_EDGE.width} strokeLinejoin="round">
          {drawing.cells.map((cell, i) => (
            <path
              key={cell.mode}
              d={cellPaths[i]}
              transform={scaleAbout(cellScales[i].scale, cellScales[i].center)}
              display={cellScales[i].scale < 0.01 ? "none" : undefined}
            />
          ))}
          <path
            d={headPath}
            transform={scaleAbout(headBloom, headCentre)}
            display={headBloom < 0.01 ? "none" : undefined}
          />
        </g>

        {/* Six Voronoi mode cells */}
        {drawing.cells.map((cell, i) => (
          <path
            key={cell.mode}
            className={interactive ? "z2d-mascot-cell" : undefined}
            d={cellPaths[i]}
            fill={MASCOT_COLORS[cell.mode]}
            transform={scaleAbout(cellScales[i].scale, cellScales[i].center)}
            display={cellScales[i].scale < 0.01 ? "none" : undefined}
            onMouseOver={
              interactive
                ? () => {
                    setHoveredCell(cell.mode);
                    onHoverPose?.(cell.mode);
                  }
                : undefined
            }
            onMouseOut={interactive ? () => setHoveredCell(null) : undefined}
            onClick={interactive ? () => onSelectPose?.(cell.mode) : undefined}
          />
        ))}

        {/* Visor head + bolt antenna */}
        <g transform={scaleAbout(headBloom, headCentre)} display={headBloom < 0.01 ? "none" : undefined}>
          <path d={headPath} fill={bodyColor} />
          <g fill="none" stroke={MASCOT_FACE} strokeLinecap="round">
            {drawing.eyes.map(({ points: [[x0, y0], [x1, y1]], width }, index) => (
              <path
                key={index}
                d={`M${(x0 + gaze[0]).toFixed(1)} ${(y0 + gaze[1]).toFixed(1)}L${(x1 + gaze[0]).toFixed(1)} ${(y1 + gaze[1]).toFixed(1)}`}
                strokeWidth={width}
              />
            ))}
          </g>
        </g>

        {/* Carved rounded-cell letter on the leading cell */}
        {letterBloom > 0.01 &&
          drawing.letters.map(letter => (
            <path
              key={letter.mode}
              d={letter.d}
              fill={MASCOT_FACE}
              fillRule="evenodd"
              pointerEvents="none"
              transform={`translate(${letter.x} ${letter.y}) rotate(${letter.lean}) scale(${(letter.scale * letterBloom).toFixed(3)})`}
            />
          ))}
      </g>
    </svg>
  );
}
