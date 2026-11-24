// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Chapter 4 (Move in): three crisp 2D sub-scenes driven by whichever fieldset
// the user is focusing: Import, Search engine, or Default browser.

import { Browser2D } from "./Browser2D.jsx";
import { clamp01, easeInOut, easeOut, lerp, span, spring, useClock } from "../motion.js";

function ImportSubScene({ theme, source, vim, still, paused, frozenAt }) {
  const LOOP = 5.4;
  const t = useClock({ duration: LOOP, pose: 2.0, still, paused, frozenAt });
  const importing = !!source;

  const tokens = [
    { color: theme.modes.t, kind: "star" },
    { color: theme.modes.l, kind: "clock" },
    { color: theme.modes.n, kind: "key" },
  ];

  return (
    <svg className="z2d-scene-svg" viewBox="0 0 660 436" role="img" aria-label="Browser import preview">
      {/* Previous browser card (glides in on the left when a source is picked) */}
      <g
        transform={`translate(${importing ? 26 : -170} 124)`}
        opacity={importing ? 1 : 0}
        style={{ transition: "transform 380ms cubic-bezier(0.22,1,0.36,1), opacity 260ms ease" }}
      >
        <rect x="0" y="0" width="166" height="176" rx="20" fill={theme.surface} stroke={theme.border} strokeWidth="1.6" />
        <rect x="0" y="0" width="166" height="32" rx="20" fill={theme.raised} />
        <circle cx="18" cy="16" r="3.5" fill={theme.muted} opacity="0.55" />
        <circle cx="30" cy="16" r="3.5" fill={theme.muted} opacity="0.55" />
        <circle cx="42" cy="16" r="3.5" fill={theme.muted} opacity="0.55" />
        <rect x="52" y="54" width="62" height="62" rx="18" fill="#ffffff" stroke={theme.border} strokeWidth="1.2" />
        {source?.image && <image href={source.image} x="65" y="67" width="36" height="36" />}
        <text
          x="83"
          y="144"
          textAnchor="middle"
          fill={theme.text}
          fontSize="13"
          fontWeight="700"
          fontFamily="system-ui, sans-serif"
        >
          {source?.name ?? ""}
        </text>
      </g>

      {/* Zendia browser receiving data (shifts right when importing) */}
      <g
        transform={`translate(${importing ? 242 : 76} ${importing ? 72 : 52}) scale(${importing ? 0.65 : 0.85})`}
        style={{ transition: "transform 420ms cubic-bezier(0.22,1,0.36,1)" }}
      >
        <Browser2D theme={theme} x={0} y={0} scale={1} clipId="import-b2d" vim={vim ? 1 : 0} mode="l" />
      </g>

      {/* Curved transfer arc + bookmark/history/password tokens */}
      {importing && (
        <g>
          <path
            d="M174 196 Q246 86 314 196"
            fill="none"
            stroke={theme.modes.l}
            strokeWidth="2.2"
            strokeDasharray="6 7"
            opacity="0.55"
          />
          {tokens.map((tok, i) => {
            const p = (t / LOOP + i / tokens.length) % 1;
            if (p > 0.78) {
              return null;
            }
            const u = easeInOut(p / 0.78);
            // Quadratic Bezier point along (174, 196) -> (246, 86) -> (314, 196)
            const inv = 1 - u;
            const tx = inv * inv * 174 + 2 * inv * u * 246 + u * u * 314;
            const ty = inv * inv * 196 + 2 * inv * u * 86 + u * u * 196;
            const s = Math.min(1, p / 0.1) * Math.min(1, (0.78 - p) / 0.1);
            return (
              <g key={tok.kind} transform={`translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${s.toFixed(3)})`}>
                <rect x="-20" y="-20" width="40" height="40" rx="13" fill={tok.color} stroke={theme.ink} strokeWidth="2.2" />
                {tok.kind === "star" && (
                  <path
                    d="M0 -9 L2.6 -3.2 L9 -2.5 L4.2 1.8 L5.5 8.2 L0 4.9 L-5.5 8.2 L-4.2 1.8 L-9 -2.5 L-2.6 -3.2 Z"
                    fill={theme.ink}
                  />
                )}
                {tok.kind === "clock" && (
                  <g fill="none" stroke={theme.ink} strokeWidth="2.4" strokeLinecap="round">
                    <circle cx="0" cy="0" r="8" />
                    <path d="M0 -4.5 L0 0 L3.5 2.5" />
                  </g>
                )}
                {tok.kind === "key" && (
                  <g fill="none" stroke={theme.ink} strokeWidth="2.4" strokeLinecap="round">
                    <circle cx="-4" cy="0" r="4" />
                    <path d="M0 0 L9 0 M6 0 L6 4" />
                  </g>
                )}
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}

function SearchSubScene({ theme, engine, vim, still, paused, frozenAt }) {
  const LOOP = 5.8;
  const QUERY = "vim keys";
  const TYPE_START = 0.9;
  const TYPE_STEP = 0.12;
  const SUBMIT = TYPE_START + QUERY.length * TYPE_STEP + 0.65;
  const t = useClock({ duration: LOOP, pose: 2.3, still, paused, frozenAt });

  const open = spring(span(t, 0.25, 0.45)) * (1 - span(t, SUBMIT, 0.16));
  const typedCount = Math.max(0, Math.min(QUERY.length, Math.floor((t - TYPE_START) / TYPE_STEP) + 1));
  const queryText = t >= TYPE_START ? QUERY.slice(0, typedCount) : "";
  const pageMix = span(t, SUBMIT + 0.08, 0.24) * (1 - span(t, LOOP - 0.5, 0.4));

  return (
    <svg className="z2d-scene-svg" viewBox="0 0 660 436" role="img" aria-label="Search engine preview">
      <Browser2D
        theme={theme}
        x={30}
        y={28}
        scale={1}
        clipId="search-b2d"
        vim={vim ? 1 : 0}
        mode="l"
        pageVariant={0}
        nextPageVariant={2}
        pageMix={pageMix}
      >
        {/* Floating Zen pill address bar */}
        {open > 0.02 && (
          <g
            transform={`translate(220 ${lerp(136, 120, open).toFixed(1)}) scale(${lerp(0.92, 1, open).toFixed(3)})`}
            opacity={clamp01(open * 1.4).toFixed(2)}
          >
            <rect
              x="-166"
              y="-24"
              width="332"
              height="48"
              rx="24"
              fill={theme.surface}
              stroke={theme.modes.l}
              strokeWidth="2"
            />
            <circle cx="-138" cy="0" r="14" fill="#ffffff" stroke={theme.border} strokeWidth="1" />
            {engine?.iconURL && <image href={engine.iconURL} x="-147" y="-9" width="18" height="18" />}
            <text
              x="-114"
              y="5"
              fill={theme.text}
              fontSize="14.5"
              fontWeight="600"
              fontFamily="system-ui, sans-serif"
            >
              {queryText}
            </text>
            {/* Blinking text caret */}
            <rect
              x={-112 + queryText.length * 8.1}
              y="-9"
              width="2"
              height="18"
              rx="1"
              fill={theme.modes.l}
              opacity={Math.sin(t * 7) > -0.1 ? "1" : "0.15"}
            />
            {/* Engine badge pill on the right */}
            {engine?.name && (
              <g transform="translate(88 -11)">
                <rect x="0" y="0" width="66" height="22" rx="11" fill={theme.modes.l} opacity="0.2" />
                <text
                  x="33"
                  y="14.5"
                  textAnchor="middle"
                  fill={theme.modeText.l}
                  fontSize="9.5"
                  fontWeight="700"
                  fontFamily="system-ui, sans-serif"
                >
                  {engine.name.slice(0, 9)}
                </text>
              </g>
            )}
          </g>
        )}
      </Browser2D>
    </svg>
  );
}

function DefaultSubScene({ theme, enabled, vim, still, paused, frozenAt }) {
  const LOOP = 5.2;
  const CLICK = 1.0;
  const FLIGHT = 0.95;
  const t = useClock({ duration: LOOP, pose: 1.7, still, paused, frozenAt });

  const fly = easeInOut(span(t, CLICK, FLIGHT));
  const landed = t > CLICK + FLIGHT;
  const reset = 1 - span(t, LOOP - 0.5, 0.4);
  const opened = landed && enabled ? reset : 0;

  const startX = 114;
  const startY = 236;
  const goalX = enabled ? 378 : 374;
  const goalY = enabled ? 228 : 114;
  const lx = lerp(startX, goalX, fly);
  const ly = lerp(startY, goalY, fly) - Math.sin(fly * Math.PI) * 74;

  return (
    <svg className="z2d-scene-svg" viewBox="0 0 660 436" role="img" aria-label="Default browser link opening preview">
      {/* Chat / other app card on the left */}
      <g transform="translate(24 106)">
        <rect x="0" y="0" width="164" height="224" rx="20" fill={theme.surface} stroke={theme.border} strokeWidth="1.5" />
        <rect x="16" y="18" width="64" height="8" rx="4" fill={theme.muted} opacity="0.45" />
        <rect x="16" y="42" width="116" height="44" rx="13" fill={theme.pageSoft} />
        <rect x="28" y="56" width="82" height="6" rx="3" fill={theme.muted} opacity="0.55" />
        <rect x="28" y="68" width="54" height="6" rx="3" fill={theme.muted} opacity="0.4" />

        <rect x="16" y="98" width="132" height="60" rx="13" fill={theme.pageSoft} />
        <rect x="28" y="112" width="90" height="6" rx="3" fill={theme.muted} opacity="0.55" />
        {/* Clickable link pill */}
        <rect x="28" y="128" width="104" height="20" rx="10" fill={theme.modes.e} />
        <rect x="40" y="135.5" width="76" height="5" rx="2.5" fill={theme.ink} opacity="0.82" />
      </g>

      {/* Other browser card (prominent when Default = NO, tucked behind when YES) */}
      <g
        transform={`translate(${enabled ? 304 : 246} ${enabled ? 38 : 120}) scale(${enabled ? 0.72 : 1})`}
        opacity={enabled ? 0.45 : 1}
        style={{ transition: "transform 380ms cubic-bezier(0.22,1,0.36,1), opacity 280ms ease" }}
      >
        <rect x="0" y="0" width="256" height="170" rx="18" fill={theme.raised} stroke={theme.border} strokeWidth="1.5" />
        <rect x="14" y="16" width="66" height="16" rx="6" fill={theme.surface} />
        <rect x="14" y="44" width="228" height="112" rx="10" fill={theme.surface} opacity="0.7" />
      </g>

      {/* Zendia browser (front & center when Default = YES, stepped back when NO) */}
      <g
        transform={`translate(${enabled ? 226 : 318} ${enabled ? 96 : 246}) scale(${enabled ? 0.67 : 0.44})`}
        opacity={enabled ? 1 : 0.55}
        style={{ transition: "transform 380ms cubic-bezier(0.22,1,0.36,1), opacity 280ms ease" }}
      >
        <Browser2D
          theme={theme}
          x={0}
          y={0}
          scale={1}
          clipId="default-b2d"
          vim={vim ? 1 : 0}
          mode="l"
          tabIndex={opened > 0.5 ? 2 : 0}
          pageVariant={0}
          nextPageVariant={2}
          pageMix={opened * span(t, CLICK + FLIGHT, 0.2)}
        />
      </g>

      {/* Flying link capsule */}
      {t > CLICK && !landed && (
        <g transform={`translate(${lx.toFixed(1)} ${ly.toFixed(1)}) scale(${easeOut((t - CLICK) / 0.14).toFixed(3)})`}>
          <rect x="-46" y="-13" width="92" height="26" rx="13" fill={theme.modes.e} stroke={theme.ink} strokeWidth="2" />
          <circle cx="-30" cy="0" r="4" fill={theme.ink} />
          <rect x="-20" y="-2.5" width="52" height="5" rx="2.5" fill={theme.ink} opacity="0.85" />
        </g>
      )}
    </svg>
  );
}

export function MoveInScene2D({ theme, focus, source, engine, defaultBrowser, vim, still, paused, frozenAt }) {
  if (focus === "search") {
    return <SearchSubScene theme={theme} engine={engine} vim={vim} still={still} paused={paused} frozenAt={frozenAt} />;
  }
  if (focus === "default") {
    return <DefaultSubScene theme={theme} enabled={defaultBrowser} vim={vim} still={still} paused={paused} frozenAt={frozenAt} />;
  }
  return <ImportSubScene theme={theme} source={source} vim={vim} still={still} paused={paused} frozenAt={frozenAt} />;
}
