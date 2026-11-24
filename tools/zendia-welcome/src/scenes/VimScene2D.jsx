// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Chapter 1 (Keys): pure 2D choreographed Vim preview. A crisp 2D browser
// reacts to a tactile row of keycaps below it — scrolling, switching tabs,
// opening Which-Key, gliding into Explorer mode, sliding open the Agent dock,
// and returning calmly to Normal mode.

import { useEffect, useRef } from "react";
import { Browser2D } from "./Browser2D.jsx";
import { clamp01, easeInOut, easeOut, lerp, span, spring, track, useClock } from "../motion.js";
import { sound } from "../sound.js";

const LOOP = 18;
const POSE = 8.4;
// Start second of each of the 6 beats in App.jsx's VIM_KEYS list.
const BEATS = [0.4, 3.6, 6.8, 9.2, 12.2, 15.2];

const scrollTrack = track(0, [
  [0.8, 72, 0.32],
  [1.3, 144, 0.32],
  [1.8, 210, 0.32],
  [2.5, 132, 0.32],
  [3.0, 56, 0.32],
]);

const tabTrack = track(0, [
  [4.0, 1, 0.28, easeOut],
  [4.9, 2, 0.28, easeOut],
  [5.8, 1, 0.28, easeOut],
  [17.1, 0, 0.45, easeInOut],
]);

const whichKeyTrack = track(0, [
  [7.1, 1, 0.35, spring],
  [9.4, 0, 0.16, easeOut],
  [12.4, 1, 0.35, spring],
  [13.7, 0, 0.16, easeOut],
]);

const explorerTrack = track(0, [
  [9.4, 1, 0.22, easeOut],
  [11.6, 0, 0.2, easeOut],
]);

const explorerRowTrack = track(1, [
  [9.8, 2, 0.22, easeOut],
  [10.4, 3, 0.22, easeOut],
  [11.0, 2, 0.22, easeOut],
]);

const dockTrack = track(0, [
  [13.7, 1, 0.42, easeOut],
  [15.6, 0, 0.25, easeInOut],
]);

const KEYCAPS = [
  { id: "esc", label: "Esc", w: 48, hits: [[11.6], [15.5]] },
  { id: "shift", label: "⇧", w: 46, hits: [[3.9, 1.3], [5.7, 0.45]] },
  { id: "j", label: "j", w: 42, hits: [[0.8], [1.3], [1.8], [4.0], [4.9], [9.8], [10.4]] },
  { id: "k", label: "k", w: 42, hits: [[2.5], [3.0], [5.8], [11.0]] },
  { id: "space", label: "Space", w: 94, hits: [[7.1, 0.16], [9.1, 0.14], [12.4, 0.16]] },
  { id: "e", label: "e", w: 42, hits: [[9.4]] },
  { id: "a", label: "a", w: 42, hits: [[13.0], [13.6]] },
];

function keyPressed(hits, t) {
  let down = 0;
  for (const [at, hold = 0.16] of hits) {
    const dt = t - at;
    if (dt >= 0 && dt <= hold + 0.24) {
      const press = easeOut(dt / 0.05);
      const release = dt > hold ? easeOut((dt - hold) / 0.22) : 0;
      down = Math.max(down, press * (1 - release));
    }
  }
  return down;
}

function pageAt(t) {
  if (t < 4.0) return [0, 0, 0];
  if (t < 4.9) return [0, 1, span(t, 4.0, 0.24)];
  if (t < 5.8) return [1, 2, span(t, 4.9, 0.24)];
  if (t < 17.1) return [2, 1, span(t, 5.8, 0.24)];
  return [1, 0, span(t, 17.1, 0.35)];
}

function modeAt(t) {
  if (t >= 9.4 && t < 11.6) return "e";
  if (t >= 13.7 && t < 15.6) return "i";
  return "n";
}

function keysAt(t) {
  if ((t >= 7.1 && t < 9.4) || (t >= 12.4 && t < 13.0)) return "<Space>";
  if (t >= 13.0 && t < 13.7) return "<Space>a";
  return "";
}

export function VimScene2D({ theme, enabled, still, paused, frozenAt, onBeat }) {
  const t = useClock({ duration: LOOP, pose: POSE, still, paused, frozenAt });
  const lastBeat = useRef(-1);

  const beatNow = enabled ? BEATS.findLastIndex(start => t >= start) : -1;
  useEffect(() => {
    if (beatNow !== lastBeat.current) {
      lastBeat.current = beatNow;
      onBeat?.(beatNow);
      if (beatNow >= 0 && !still && !paused && frozenAt == null) {
        sound.playPreviewKey(modeAt(t));
      }
    }
  }, [beatNow, onBeat, still, paused, frozenAt]);

  const on = enabled ? 1 : 0;
  const mode = enabled ? modeAt(t) : "n";
  const modeColor = theme.modes[mode];
  const [pageVariant, nextPageVariant, pageMix] = enabled ? pageAt(t) : [0, 0, 0];
  const scrollY = enabled && t < 4.9 ? scrollTrack(Math.min(t, 3.8)) : 0;

  // Total keycaps row width for centering beneath the browser
  const gap = 8;
  const rowWidth = KEYCAPS.reduce((sum, k) => sum + k.w, 0) + gap * (KEYCAPS.length - 1);
  let cursorX = (660 - rowWidth) / 2;

  return (
    <svg className="z2d-scene-svg" viewBox="0 0 660 472" role="img" aria-label="Vim keyboard navigation preview">
      <Browser2D
        theme={theme}
        x={30}
        y={14}
        scale={1}
        clipId="vim-b2d"
        vim={on}
        mode={mode}
        tabIndex={enabled ? tabTrack(t) : 0}
        scrollY={scrollY}
        pageVariant={pageVariant}
        nextPageVariant={nextPageVariant}
        pageMix={pageMix}
        explorer={enabled ? explorerTrack(t) : 0}
        explorerRow={explorerRowTrack(t)}
        whichKey={enabled ? whichKeyTrack(t) : 0}
        whichKeyPage={t >= 13.0 && t < 14.2 ? "ai" : "leader"}
        typedKeys={enabled ? keysAt(t) : ""}
        dock={enabled ? dockTrack(t) : 0}
        agent={{ name: "Agent", color: theme.modes.i }}
        agentTime={t}
      />

      {/* Tactile 2D keycap bar resting neatly below the window */}
      <g
        transform={`translate(0 ${enabled ? 410 : 422})`}
        opacity={enabled ? 1 : 0.34}
        style={{ transition: "opacity 240ms ease, transform 320ms cubic-bezier(0.22,1,0.36,1)" }}
      >
        {KEYCAPS.map(cap => {
          const x = cursorX;
          cursorX += cap.w + gap;
          const down = enabled ? keyPressed(cap.hits, t) : 0;
          const pressY = down * 3.5;
          const active = down > 0.15;
          return (
            <g key={cap.id} transform={`translate(${x.toFixed(1)} 0)`}>
              {/* Keycap base */}
              <rect x="0" y="5" width={cap.w} height="34" rx="10" fill={theme.ink} opacity={theme.dark ? "0.85" : "0.22"} />
              {/* Keycap top */}
              <rect
                x="0"
                y={pressY.toFixed(1)}
                width={cap.w}
                height="34"
                rx="10"
                fill={active ? modeColor : theme.surface}
                stroke={active ? modeColor : theme.border}
                strokeWidth="1.5"
              />
              {/* Crisp press ripple */}
              {active && (
                <rect
                  x={(-down * 4).toFixed(1)}
                  y={(pressY - down * 4).toFixed(1)}
                  width={(cap.w + down * 8).toFixed(1)}
                  height={(34 + down * 8).toFixed(1)}
                  rx="13"
                  fill="none"
                  stroke={modeColor}
                  strokeWidth="1.5"
                  opacity={(clamp01(1 - down * 0.4) * 0.65).toFixed(2)}
                />
              )}
              <text
                x={cap.w / 2}
                y={(21 + pressY).toFixed(1)}
                textAnchor="middle"
                fill={active ? theme.ink : theme.text}
                fontSize="12.5"
                fontWeight="700"
                fontFamily="ui-monospace, monospace"
              >
                {cap.label}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
