// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Reusable crisp 2D SVG illustration of a Zendia browser window:
// Zen's vertical sidebar + pill address bar + essentials grid + sliding tabs,
// clean document viewport, floating real SVG Mascot statusline, Which-Key
// popup, and slide-in Agent dock.

import {
  MASCOT_COLORS,
  MASCOT_EDGE,
  MASCOT_FACE,
  MASCOT_VIEWBOX,
  mascotFrame,
} from "../../../../src/zen/zendia/ui/ZendiaMascot.sys.mjs";
import { clamp01, lerp, outlinePath, ringDashes } from "../motion.js";

const TABS = [
  { title: "Zendia guide", accent: "pink" },
  { title: "Release notes", accent: "blue" },
  { title: "Shortcuts", accent: "teal" },
  { title: "Workspace", accent: "purple" },
];

const WHICH_KEY_LEADER = [
  ["e", "Explorer", "blue"],
  ["a", "Agent", "pink"],
  ["f", "Find tab", "teal"],
  ["?", "All keys", "yellow"],
];

const WHICH_KEY_AI = [
  ["a", "Ask about tab", "pink"],
  ["s", "Switch agent", "blue"],
  ["c", "New chat", "green"],
];

/**
 * Miniature inline SVG Mascot inside the 2D browser statusline corner.
 */
function InlineMascot({ mode = "n", x, y, size = 38, scale = 1 }) {
  if (scale < 0.02) {
    return null;
  }
  const drawing = mascotFrame(mode);
  const box = MASCOT_VIEWBOX;
  const s = (size / box.width) * scale;
  const tx = x + (size * (1 - scale)) / 2 - box.x * s;
  const ty = y + (size * (1 - scale)) / 2 - box.y * s;
  const head = outlinePath(drawing.head);
  return (
    <g transform={`translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(4)})`}>
      <g fill={MASCOT_EDGE.color} stroke={MASCOT_EDGE.color} strokeWidth={MASCOT_EDGE.width} strokeLinejoin="round">
        {drawing.cells.map(c => (
          <path key={c.mode} d={outlinePath(c.points)} />
        ))}
        <path d={head} />
      </g>
      {drawing.cells.map(c => (
        <path key={c.mode} d={outlinePath(c.points)} fill={MASCOT_COLORS[c.mode]} />
      ))}
      <path d={head} fill={MASCOT_COLORS[mode] ?? MASCOT_COLORS.n} />
      <g fill="none" stroke={MASCOT_FACE} strokeLinecap="round">
        {drawing.eyes.map(({ points: [[x0, y0], [x1, y1]], width }, idx) => (
          <path key={idx} d={`M${x0} ${y0}L${x1} ${y1}`} strokeWidth={width} />
        ))}
      </g>
      {drawing.letters.map(l => (
        <path
          key={l.mode}
          d={l.d}
          fill={MASCOT_FACE}
          fillRule="evenodd"
          transform={`translate(${l.x} ${l.y}) rotate(${l.lean}) scale(${l.scale})`}
        />
      ))}
    </g>
  );
}

/**
 * Zendia's real 8-dash working ring rendered cleanly as SVG arcs.
 */
export function WorkingRingSVG({ cx, cy, r = 7.5, color, seconds = 0 }) {
  const dashes = ringDashes(seconds);
  return (
    <g fill="none" strokeLinecap="round">
      {dashes.map((dash, i) => {
        const a0 = ((dash.centre - dash.half) * Math.PI) / 180 - Math.PI / 2;
        const a1 = ((dash.centre + dash.half) * Math.PI) / 180 - Math.PI / 2;
        const x0 = cx + r * Math.cos(a0);
        const y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1);
        const y1 = cy + r * Math.sin(a1);
        return (
          <path
            key={i}
            d={`M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`}
            stroke={color}
            strokeWidth="1.9"
            opacity={(0.45 + dash.glow * 0.55).toFixed(2)}
          />
        );
      })}
    </g>
  );
}

/**
 * Clean abstract web page content inside the browser viewport.
 */
function DocumentContent({ theme, variant = 0, scrollY = 0, width = 446 }) {
  const accent = variant === 0 ? theme.pink : variant === 1 ? theme.blue : theme.teal;
  const second = variant === 0 ? theme.teal : variant === 1 ? theme.purple : theme.yellow;
  return (
    <g transform={`translate(0 ${(-scrollY).toFixed(1)})`}>
      {/* Hero pill tag + heading block */}
      <rect x="28" y="28" width="76" height="14" rx="7" fill={accent} opacity="0.24" />
      <rect x="38" y="32.5" width="56" height="5" rx="2.5" fill={accent} />

      <rect x="28" y="54" width={width - 140} height="16" rx="6" fill={theme.text} opacity="0.88" />
      <rect x="28" y="78" width={width - 210} height="13" rx="5" fill={theme.text} opacity="0.52" />

      {/* Feature callout card */}
      <rect x="28" y="108" width={width - 56} height="74" rx="14" fill={theme.pageSoft} />
      <rect x="44" y="124" width="38" height="38" rx="11" fill={accent} opacity="0.24" />
      <circle cx="63" cy="143" r="9" fill={accent} />
      <rect x="96" y="128" width="150" height="9" rx="4.5" fill={theme.text} opacity="0.8" />
      <rect x="96" y="145" width={width - 180} height="7" rx="3.5" fill={theme.muted} opacity="0.55" />
      <rect x="96" y="159" width={width - 230} height="7" rx="3.5" fill={theme.muted} opacity="0.4" />

      {/* Text paragraphs */}
      {[204, 222, 240].map((y, i) => (
        <rect
          key={y}
          x="28"
          y={y}
          width={width - 56 - i * 42}
          height="8"
          rx="4"
          fill={theme.muted}
          opacity={0.48 - i * 0.06}
        />
      ))}

      {/* Two side-by-side cards below the fold */}
      <rect x="28" y="268" width={(width - 70) / 2} height="86" rx="13" fill={theme.pageSoft} />
      <rect x="42" y="284" width="44" height="8" rx="4" fill={second} />
      <rect x="42" y="302" width={(width - 126) / 2} height="7" rx="3.5" fill={theme.muted} opacity="0.55" />
      <rect x="42" y="317" width={(width - 160) / 2} height="7" rx="3.5" fill={theme.muted} opacity="0.4" />

      <rect x={28 + (width - 70) / 2 + 14} y="268" width={(width - 70) / 2} height="86" rx="13" fill={theme.pageSoft} />
      <rect x={42 + (width - 70) / 2 + 14} y="284" width="52" height="8" rx="4" fill={accent} />
      <rect x={42 + (width - 70) / 2 + 14} y="302" width={(width - 126) / 2} height="7" rx="3.5" fill={theme.muted} opacity="0.55" />
      <rect x={42 + (width - 70) / 2 + 14} y="317" width={(width - 160) / 2} height="7" rx="3.5" fill={theme.muted} opacity="0.4" />

      {/* Lower lines visible when scrolled */}
      {[376, 394, 412, 434, 452].map((y, i) => (
        <rect
          key={y}
          x="28"
          y={y}
          width={width - 56 - (i % 3) * 54}
          height="8"
          rx="4"
          fill={theme.muted}
          opacity="0.42"
        />
      ))}
    </g>
  );
}

/**
 * Pure 2D SVG Zendia browser window (600 x 376 internal layout).
 */
export function Browser2D({
  theme,
  x = 0,
  y = 0,
  scale = 1,
  clipId = "b2d-page",
  vim = 1,
  mode = "n",
  tabIndex = 0,
  scrollY = 0,
  pageVariant = 0,
  nextPageVariant = 0,
  pageMix = 0,
  explorer = 0,
  explorerRow = 0,
  whichKey = 0,
  whichKeyPage = "leader",
  typedKeys = "",
  dock = 0,
  agent = null,
  agentTime = 0,
  tabGlowColor = null,
  essentials = [],
  children,
}) {
  const W = 600;
  const H = 376;
  const SIDEBAR_W = 140;
  const PAD = 10;
  const VIEW_X = SIDEBAR_W + PAD;
  const VIEW_Y = PAD;
  const VIEW_W = W - VIEW_X - PAD;
  const VIEW_H = H - PAD * 2;

  const essentialRows = essentials.length ? Math.ceil(essentials.length / 3) : 0;
  const tabsTop = 76 + essentialRows * 38 + (essentialRows ? 10 : 0);
  const dockW = 164;
  const dockOffset = (1 - clamp01(dock)) * (dockW + 20);
  const agentAccent = agent?.color ?? theme.pink;

  const wkRows = whichKeyPage === "ai" ? WHICH_KEY_AI : WHICH_KEY_LEADER;
  const modeColor = theme.modes[mode] ?? theme.modes.n;

  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(4)})`}>
      <defs>
        <clipPath id={clipId}>
          <rect x={VIEW_X} y={VIEW_Y} width={VIEW_W} height={VIEW_H} rx="13" />
        </clipPath>
        <filter id={`${clipId}-shadow`} x="-8%" y="-8%" width="116%" height="122%">
          <feDropShadow dx="0" dy="14" stdDeviation="16" floodColor="#0b0c14" floodOpacity={theme.dark ? "0.48" : "0.14"} />
        </filter>
      </defs>

      {/* Outer browser shell */}
      <g filter={`url(#${clipId}-shadow)`}>
        <rect
          x="0"
          y="0"
          width={W}
          height={H}
          rx="20"
          fill={theme.windowBg}
          stroke={vim > 0.3 ? modeColor : theme.border}
          strokeOpacity={vim > 0.3 ? 0.55 : 0.85}
          strokeWidth="1.6"
        />
      </g>

      {/* Sidebar background tint */}
      <rect x="1" y="1" width={SIDEBAR_W + 4} height={H - 2} rx="19" fill={theme.sidebarBg} />

      {/* Quiet window dots */}
      <circle cx="20" cy="21" r="4" fill={theme.red} opacity="0.72" />
      <circle cx="34" cy="21" r="4" fill={theme.yellow} opacity="0.72" />
      <circle cx="48" cy="21" r="4" fill={theme.green} opacity="0.72" />

      {/* Zen pill address bar in sidebar */}
      <rect x="14" y="38" width={SIDEBAR_W - 22} height="24" rx="12" fill={theme.surface} stroke={theme.border} strokeWidth="1" />
      <circle cx="26" cy="50" r="3.5" fill={modeColor} opacity="0.85" />
      <rect x="35" y="47.5" width="56" height="5" rx="2.5" fill={theme.muted} opacity="0.55" />

      {/* Essentials grid (if provided) */}
      {essentials.map((app, index) => {
        const col = index % 3;
        const row = Math.floor(index / 3);
        const tx = 14 + col * 40;
        const ty = 74 + row * 38;
        return (
          <g key={app.url || index} transform={`translate(${tx} ${ty})`}>
            <rect
              x="0"
              y="0"
              width="34"
              height="32"
              rx="10"
              fill={theme.dark ? "#ffffff" : "#ffffff"}
              stroke={app.color || theme.border}
              strokeWidth="1.5"
              strokeOpacity="0.65"
            />
            {app.icon && <image href={app.icon} x="9" y="8" width="16" height="16" />}
          </g>
        );
      })}

      {/* Sidebar tabs */}
      <g transform={`translate(14 ${tabsTop})`}>
        {/* Smooth sliding active tab pill */}
        <rect
          x="0"
          y={(tabIndex * 34).toFixed(1)}
          width={SIDEBAR_W - 22}
          height="28"
          rx="9"
          fill={theme.surface}
          stroke={tabGlowColor ? tabGlowColor : theme.border}
          strokeWidth={tabGlowColor ? "1.8" : "1"}
        />

        {/* Explorer mode blue focus ring */}
        {explorer > 0.02 && (
          <rect
            x="-1"
            y={(explorerRow * 34 - 1).toFixed(1)}
            width={SIDEBAR_W - 20}
            height="30"
            rx="10"
            fill={theme.modes.e}
            fillOpacity={(0.18 * explorer).toFixed(2)}
            stroke={theme.modes.e}
            strokeWidth="2"
            opacity={explorer.toFixed(2)}
          />
        )}

        {TABS.map((tab, i) => (
          <g key={tab.title} transform={`translate(0 ${i * 34})`}>
            <circle cx="13" cy="14" r="4" fill={theme[tab.accent]} opacity={Math.abs(tabIndex - i) < 0.5 ? "1" : "0.55"} />
            <rect
              x="24"
              y="11"
              width={52 + ((i * 17) % 24)}
              height="5.5"
              rx="2.75"
              fill={Math.abs(tabIndex - i) < 0.5 ? theme.text : theme.muted}
              opacity={Math.abs(tabIndex - i) < 0.5 ? "0.9" : "0.55"}
            />
          </g>
        ))}
      </g>

      {/* Main page viewport */}
      <rect x={VIEW_X} y={VIEW_Y} width={VIEW_W} height={VIEW_H} rx="13" fill={theme.pageBg} />

      <g clipPath={`url(#${clipId})`}>
        <g transform={`translate(${VIEW_X} ${VIEW_Y})`}>
          {/* Base document */}
          <g opacity={(1 - pageMix * 0.65).toFixed(2)}>
            <DocumentContent theme={theme} variant={pageVariant} scrollY={scrollY} width={VIEW_W} />
          </g>

          {/* Incoming document (slides smoothly up like ZendiaTabMotion!) */}
          {pageMix > 0.01 && (
            <g transform={`translate(0 ${((1 - pageMix) * 18).toFixed(1)})`} opacity={pageMix.toFixed(2)}>
              <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill={theme.pageBg} />
              <DocumentContent theme={theme} variant={nextPageVariant} scrollY={0} width={VIEW_W} />
            </g>
          )}

          {/* Custom scene overlays inside the page viewport */}
          {children}

          {/* Agent slide-in dock */}
          {dock > 0.01 && (
            <g transform={`translate(${(VIEW_W - dockW - 8 + dockOffset).toFixed(1)} 8)`} opacity={clamp01(dock * 1.4).toFixed(2)}>
              <rect
                x="0"
                y="0"
                width={dockW}
                height={VIEW_H - 16}
                rx="14"
                fill={theme.dark ? "#1b1d2e" : "#f7f8fc"}
                fillOpacity="0.96"
                stroke={agentAccent}
                strokeWidth="1.5"
                strokeOpacity="0.7"
              />
              {/* Dock header with real Zendia 8-dash working ring */}
              <WorkingRingSVG cx={19} cy={22} r={6.5} color={agentAccent} seconds={agentTime} />
              <text x="33" y="25.5" fill={theme.text} fontSize="10.5" fontWeight="700" fontFamily="system-ui, sans-serif">
                {agent?.name ?? "Agent"}
              </text>
              <line x1="12" y1="38" x2={dockW - 12} y2="38" stroke={theme.border} strokeWidth="1" opacity="0.6" />

              {/* User prompt bubble */}
              <rect x="28" y="48" width={dockW - 40} height="28" rx="9" fill={agentAccent} opacity="0.18" />
              <rect x="38" y="57" width={dockW - 64} height="5" rx="2.5" fill={theme.text} opacity="0.82" />
              <rect x="52" y="66" width={dockW - 78} height="4.5" rx="2.25" fill={theme.text} opacity="0.55" />

              {/* Agent reply lines */}
              <rect x="14" y="92" width={dockW - 36} height="6" rx="3" fill={theme.text} opacity="0.72" />
              <rect x="14" y="105" width={dockW - 50} height="5.5" rx="2.75" fill={theme.muted} opacity="0.62" />
              <rect x="14" y="118" width={dockW - 42} height="5.5" rx="2.75" fill={theme.muted} opacity="0.52" />
              <rect x="14" y="131" width={dockW - 74} height="5.5" rx="2.75" fill={theme.muted} opacity="0.42" />

              {/* Action status pill */}
              <rect x="14" y="152" width={dockW - 28} height="24" rx="8" fill={theme.pageSoft} />
              <circle cx="26" cy="164" r="3.5" fill={agentAccent} />
              <rect x="36" y="161.5" width="76" height="5" rx="2.5" fill={theme.text} opacity="0.7" />

              {/* Input bar at bottom of dock */}
              <rect x="12" y={VIEW_H - 58} width={dockW - 24} height="30" rx="10" fill={theme.surface} stroke={agentAccent} strokeWidth="1.2" strokeOpacity="0.6" />
              <rect x="22" y={VIEW_H - 46} width="56" height="5" rx="2.5" fill={theme.muted} opacity="0.5" />
              <rect
                x="82"
                y={VIEW_H - 50}
                width="2"
                height="13"
                rx="1"
                fill={agentAccent}
                opacity={Math.sin(agentTime * 6) > -0.1 ? "1" : "0.15"}
              />
            </g>
          )}

          {/* Which-Key popup — positioned cleanly above the statusline mascot */}
          {whichKey > 0.01 && (
            <g
              transform={`translate(${VIEW_W - 178} ${(VIEW_H - 168 + (1 - whichKey) * 14).toFixed(1)})`}
              opacity={whichKey.toFixed(2)}
            >
              <rect
                x="0"
                y="0"
                width="166"
                height={26 + wkRows.length * 20}
                rx="12"
                fill={theme.night}
                stroke={theme.modes.n}
                strokeWidth="1.2"
                strokeOpacity="0.45"
              />
              <text x="12" y="17" fill={theme.modes.n} fontSize="9.5" fontWeight="700" fontFamily="ui-monospace, monospace">
                {typedKeys || "<Space>"}
              </text>
              {wkRows.map(([k, label, col], idx) => (
                <g key={k} transform={`translate(12 ${25 + idx * 19.5})`}>
                  <rect x="0" y="0" width="18" height="14.5" rx="4" fill="#2a2d45" />
                  <text x="9" y="10.5" textAnchor="middle" fill={theme.modes[col] ?? theme[col]} fontSize="9" fontWeight="700" fontFamily="ui-monospace, monospace">
                    {k}
                  </text>
                  <text x="26" y="10.5" fill={theme.snow} fontSize="9.5" fontFamily="system-ui, sans-serif">
                    {label}
                  </text>
                </g>
              ))}
            </g>
          )}

          {/* Floating real Mascot statusline — dodges open Agent dock just like ZendiaStatusline */}
          {vim > 0.02 && (
            <g transform={`translate(${(-clamp01(dock) * (dockW + 12)).toFixed(1)} 0)`}>
              {typedKeys && (
                <g transform={`translate(${VIEW_W - 118} ${VIEW_H - 36})`}>
                  <rect x="0" y="0" width="60" height="22" rx="8" fill={theme.night} />
                  <text x="30" y="14.5" textAnchor="middle" fill={theme.snow} fontSize="9.5" fontWeight="700" fontFamily="ui-monospace, monospace">
                    {typedKeys}
                  </text>
                </g>
              )}
              <InlineMascot mode={mode} x={VIEW_W - 52} y={VIEW_H - 52} size={42} scale={vim} />
            </g>
          )}
        </g>
      </g>

      {/* Subtle crisp border over viewport */}
      <rect x={VIEW_X} y={VIEW_Y} width={VIEW_W} height={VIEW_H} rx="13" fill="none" stroke={theme.border} strokeWidth="1" opacity="0.45" />
    </g>
  );
}
