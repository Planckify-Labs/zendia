// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Chapter 2 (Agent): the chosen coding agent works directly on the tab.
// Its colored cursor glides smoothly across the page with expanding click
// ripples, its tab wears its brand ring, and its panel shows Zendia's real
// eight-dash working ring.

import { Browser2D } from "./Browser2D.jsx";
import { clamp01, easeInOut, easeOut, lerp, span, track, useClock } from "../motion.js";

const LOOP = 8.4;
const POSE = 2.1;

// Stops in the Browser2D page viewport's local coordinate system (440 x 356).
const STOPS = [
  { at: 0.2, x: 240, y: 240, click: null },
  { at: 1.2, x: 146, y: 142, click: 1.7 },
  { at: 3.4, x: 192, y: 274, click: 3.9 },
  { at: 5.8, x: 118, y: 158, click: 6.3 },
];

const scrollTrack = track(0, [
  [1.85, 108, 0.6, easeInOut],
  [4.05, 0, 0.01],
]);

export function AgentScene2D({ theme, agent, vim, still, paused, frozenAt }) {
  const t = useClock({ duration: LOOP, pose: POSE, still, paused, frozenAt });
  const who = agent ?? { name: "Your agent", color: theme.modes.e };
  const turned = t >= 4.05;
  const resetFade = 1 - span(t, LOOP - 0.5, 0.4);
  const pageMix = turned ? Math.min(span(t, 4.05, 0.24), resetFade) : 0;

  // Compute cursor position along smooth eased segments.
  const idx = Math.max(0, STOPS.findLastIndex(stop => t >= stop.at));
  const to = STOPS[idx];
  const from = STOPS[Math.max(0, idx - 1)];
  const move = easeInOut(span(t, to.at, 0.65));
  const px = lerp(from.x, to.x, move);
  const py = lerp(from.y, to.y, move);

  // Active click ripple
  const clicked = STOPS.findLast(stop => stop.click != null && t >= stop.click);
  const clickAge = clicked ? t - clicked.click : 9;
  const rippleProgress = clickAge < 0.55 ? easeOut(clickAge / 0.55) : 0;
  const pressing = clickAge >= 0 && clickAge < 0.14;

  return (
    <svg className="z2d-scene-svg" viewBox="0 0 660 436" role="img" aria-label="Coding agent working on browser tab preview">
      <Browser2D
        theme={theme}
        x={30}
        y={28}
        scale={1}
        clipId="agent-b2d"
        vim={vim ? 1 : 0}
        mode="e"
        tabIndex={turned && resetFade > 0.5 ? 1 : 0}
        scrollY={turned ? 0 : scrollTrack(t)}
        pageVariant={0}
        nextPageVariant={1}
        pageMix={pageMix}
        dock={1}
        agent={who}
        agentTime={t}
        tabGlowColor={who.color}
      >
        {/* Expanding click ripple rings */}
        {clickAge < 0.55 && clicked && (
          <g transform={`translate(${clicked.x} ${clicked.y})`}>
            <circle
              r={(8 + rippleProgress * 28).toFixed(1)}
              fill="none"
              stroke={who.color}
              strokeWidth="2.4"
              opacity={(clamp01(1 - rippleProgress) * 0.9).toFixed(2)}
            />
            <circle
              r={(4 + rippleProgress * 14).toFixed(1)}
              fill={who.color}
              opacity={(clamp01(1 - rippleProgress) * 0.28).toFixed(2)}
            />
          </g>
        )}

        {/* Agent cursor + name pill */}
        <g transform={`translate(${px.toFixed(1)} ${py.toFixed(1)}) scale(${pressing ? 0.88 : 1})`}>
          {/* Crisp 2D cursor arrow */}
          <path
            d="M0 0L0 19L5.2 14.4L8.8 22L11.8 20.6L8.2 13L14.5 12.6Z"
            fill={who.color}
            stroke={theme.ink}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          {/* Trailing agent chip */}
          <g transform="translate(15 16)">
            <rect
              x="0"
              y="0"
              width={Math.max(58, who.name.length * 6.8 + 18)}
              height="21"
              rx="10.5"
              fill={who.color}
              stroke={theme.ink}
              strokeWidth="1.4"
            />
            <text
              x={Math.max(58, who.name.length * 6.8 + 18) / 2}
              y="14"
              textAnchor="middle"
              fill={theme.ink}
              fontSize="10"
              fontWeight="800"
              fontFamily="system-ui, sans-serif"
            >
              {who.name}
            </text>
          </g>
        </g>
      </Browser2D>
    </svg>
  );
}
