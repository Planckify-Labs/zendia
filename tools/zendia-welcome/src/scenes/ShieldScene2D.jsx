// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Chapter 3 (Shield): ad cards glide toward the browser. With blocking on,
// a visor-shaped Zendia shield deflects each card cleanly into dissolving
// dots; with blocking off, the banners land and cover the page.

import { useEffect, useRef } from "react";
import { Browser2D } from "./Browser2D.jsx";
import { clamp01, easeInOut, easeOut, lerp, span, spring, useClock } from "../motion.js";
import { sound } from "../sound.js";

const LOOP = 7.2;
const POSE = 3.1;
const FLIGHT = 1.05;

const ADS = [
  { at: 0.4, toX: 350, toY: 82, w: 146, h: 48, colorKey: "yellow", label: "BANNER AD" },
  { at: 1.5, toX: 258, toY: 168, w: 132, h: 74, colorKey: "pink", label: "POPUP" },
  { at: 2.6, toX: 382, toY: 222, w: 140, h: 52, colorKey: "orange", label: "TRACKER" },
  { at: 3.7, toX: 274, toY: 274, w: 158, h: 46, colorKey: "purple", label: "PROMO" },
];

export function ShieldScene2D({ theme, enabled, vim, still, paused, frozenAt }) {
  const t = useClock({ duration: LOOP, pose: POSE, still, paused, frozenAt });
  const resetClear = span(t, LOOP - 0.65, 0.35);
  const lastHitIndex = useRef(-1);

  const hitNow = enabled ? ADS.findLastIndex(ad => t >= ad.at + FLIGHT * 0.44) : -1;
  useEffect(() => {
    if (hitNow !== lastHitIndex.current) {
      lastHitIndex.current = hitNow;
      if (hitNow >= 0 && !still && !paused && frozenAt == null) {
        sound.playDeflect();
      }
    }
  }, [hitNow, still, paused, frozenAt]);

  let nearestImpact = 9;

  const renderedAds = ADS.map((ad, index) => {
    const age = t - ad.at;
    if (age <= 0 || resetClear >= 1) {
      return null;
    }
    const fly = easeInOut(span(t, ad.at, FLIGHT));
    const impactAt = 0.44;
    const clampedFly = enabled ? Math.min(fly, impactAt) : fly;
    const startX = 656;
    const startY = ad.toY - 26 + (index % 2 ? 28 : -20);
    const x = lerp(startX, ad.toX, clampedFly);
    const y = lerp(startY, ad.toY, clampedFly);
    const rot = (1 - clampedFly) * (index % 2 ? 9 : -8);

    const impacted = enabled && fly >= impactAt;
    const sinceImpact = impacted ? Math.max(0, age - FLIGHT * impactAt) : 0;
    if (impacted) {
      nearestImpact = Math.min(nearestImpact, sinceImpact);
    }
    const dissolve = impacted ? clamp01(sinceImpact / 0.24) : 0;
    const alpha = (1 - resetClear) * (1 - dissolve);
    const scale = (1 - dissolve * 0.42) * (1 - resetClear * 0.3);
    const fill = theme.modes[ad.colorKey] ?? theme[ad.colorKey];

    return (
      <g key={ad.label}>
        {alpha > 0.02 && (
          <g
            transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)}) scale(${scale.toFixed(3)})`}
            opacity={alpha.toFixed(2)}
          >
            <rect
              x={-ad.w / 2}
              y={-ad.h / 2}
              width={ad.w}
              height={ad.h}
              rx="12"
              fill={fill}
              stroke={theme.ink}
              strokeWidth="2"
            />
            <text
              x="0"
              y="4.5"
              textAnchor="middle"
              fill={theme.ink}
              fontSize="12"
              fontWeight="800"
              letterSpacing="0.06em"
              fontFamily="ui-monospace, monospace"
            >
              {ad.label}
            </text>
          </g>
        )}

        {/* Crisp 2D burst dots when deflected by the shield */}
        {impacted && sinceImpact < 0.38 && (
          <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
            {[0, 1, 2, 3, 4, 5].map(dot => {
              const angle = (dot / 6) * Math.PI * 2 + index * 0.4;
              const p = easeOut(sinceImpact / 0.38);
              const dist = 10 + p * 34;
              return (
                <circle
                  key={dot}
                  cx={(Math.cos(angle) * dist).toFixed(1)}
                  cy={(Math.sin(angle) * dist).toFixed(1)}
                  r={(4.5 * (1 - p * 0.7)).toFixed(1)}
                  fill={fill}
                  opacity={(1 - p).toFixed(2)}
                />
              );
            })}
          </g>
        )}
      </g>
    );
  });

  const shieldPulse = enabled && nearestImpact < 0.28 ? 1 + Math.sin((1 - nearestImpact / 0.28) * Math.PI) * 0.08 : 1;
  const shieldScale = enabled ? spring(1) * shieldPulse : 0;

  return (
    <svg className="z2d-scene-svg" viewBox="0 0 660 436" role="img" aria-label="Ad blocking shield preview">
      <Browser2D
        theme={theme}
        x={22}
        y={28}
        scale={0.96}
        clipId="shield-b2d"
        vim={vim ? 1 : 0}
        mode="t"
      />

      {/* Organic curved barrier arc when ad blocking is on */}
      {enabled && (
        <g opacity="0.85">
          <path
            d="M472 52 Q522 210 472 372"
            fill="none"
            stroke={theme.modes.t}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="8 8"
            opacity={nearestImpact < 0.25 ? "0.95" : "0.45"}
          />
          <path
            d="M460 66 Q506 210 460 358"
            fill="none"
            stroke={theme.modes.l}
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.32"
          />
        </g>
      )}

      {/* Incoming ads */}
      {renderedAds}

      {/* Rounded-visor Zendia shield badge */}
      <g
        transform={`translate(494 212) scale(${shieldScale.toFixed(3)})`}
        opacity={enabled ? 1 : 0}
        style={{ transition: "opacity 220ms ease, transform 320ms cubic-bezier(0.22,1,0.36,1)" }}
      >
        {/* Outer ink edge echoing mascot geometry */}
        <path
          d="M0 -48 L39 -32 L39 4 Q36 38 0 54 Q-36 38 -39 4 L-39 -32 Z"
          fill={theme.ink}
          stroke={theme.ink}
          strokeWidth="9"
          strokeLinejoin="round"
        />
        {/* Soft yellow-teal body */}
        <path
          d="M0 -44 L35 -29 L35 3 Q32 34 0 49 Q-32 34 -35 3 L-35 -29 Z"
          fill={theme.modes.t}
        />
        {/* Checkmark */}
        <path
          d="M-14 2 L-4 13 L17 -12"
          fill="none"
          stroke={theme.ink}
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
