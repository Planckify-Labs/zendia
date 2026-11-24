// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Chapter 6 (Go): personalized 2D finale reflecting the user's real choices
// (vim mascot, ad shield, chosen agent, pinned essentials) with the celebratory
// twin-bolt Visual mascot radiating the six Voronoi mode colors.

import { Browser2D } from "./Browser2D.jsx";
import { Mascot2D } from "../Mascot2D.jsx";

export function GoScene2D({ theme, vim, ads, agent, essentials = [], still = false }) {
  return (
    <div className="z2d-go-preview">
      <div className="z2d-go-hero">
        <svg className="z2d-scene-svg z2d-go-browser-svg" viewBox="0 0 640 400" role="img" aria-label="Your configured Zendia browser">
          <Browser2D
            theme={theme}
            x={20}
            y={12}
            scale={1}
            clipId="go-b2d"
            vim={vim ? 1 : 0}
            mode="v"
            essentials={essentials.slice(0, 6)}
            tabGlowColor={agent?.color ?? null}
            agent={agent}
          />
        </svg>

        {/* Celebratory floating mascot emblem in bottom-left overlap */}
        <div className="z2d-go-mascot-badge" aria-hidden="true">
          <Mascot2D pose="v" still={still} bloom={!still} blink={!still} trackPointer={!still} />
        </div>
      </div>

      {/* Honest summary chips of what the user actually configured */}
      <div className="z2d-go-summary">
        <span className="z2d-go-chip" style={{ "--chip-color": theme.dark ? theme.modes.n : theme.modeText.n }}>
          <span className="z2d-go-chip-dot" aria-hidden="true" />
          {vim ? "Vim keys on" : "Standard shortcuts"}
        </span>
        {agent && (
          <span className="z2d-go-chip" style={{ "--chip-color": agent.color }}>
            <span className="z2d-go-chip-dot" aria-hidden="true" />
            {agent.name}
          </span>
        )}
        <span className="z2d-go-chip" style={{ "--chip-color": theme.dark ? theme.modes.t : theme.modeText.t }}>
          <span className="z2d-go-chip-dot" aria-hidden="true" />
          {ads ? "uBlock shield on" : "Ads allowed"}
        </span>
        {essentials.length > 0 && (
          <span className="z2d-go-chip" style={{ "--chip-color": theme.dark ? theme.modes.i : theme.modeText.i }}>
            <span className="z2d-go-chip-dot" aria-hidden="true" />
            {essentials.length} pinned {essentials.length === 1 ? "app" : "apps"}
          </span>
        )}
      </div>
    </div>
  );
}
