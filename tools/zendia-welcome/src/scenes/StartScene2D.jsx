// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Start screen visual: Zendia's living six-cell emblem. The mascot blooms
// cell-by-cell on entry, follows the pointer with its eyes, blinks naturally,
// and morphs smoothly into any of the six vim modes when a cell or mode pill
// is hovered or clicked.

import { useState } from "react";
import { Mascot2D } from "../Mascot2D.jsx";
import { MODE_META, MODE_ORDER } from "../motion.js";
import { sound } from "../sound.js";

export function StartScene2D({ theme, still = false }) {
  const [pose, setPose] = useState("n");
  const active = MODE_META[pose] ?? MODE_META.n;
  const activeColor = theme.dark ? active.color : active.colorLight;

  const pickPose = (nextPose, playAudio = false) => {
    setPose(prev => {
      if (prev !== nextPose && playAudio) {
        sound.playMode(nextPose);
      }
      return nextPose;
    });
  };

  return (
    <div className="z2d-start-emblem" style={{ "--emblem-accent": activeColor }}>
      {/* Soft concentric Voronoi halo echoing the logo's hairline gaps */}
      <div className="z2d-emblem-rings" aria-hidden="true">
        <svg viewBox="0 0 420 420" className="z2d-emblem-ring-svg">
          <circle cx="210" cy="210" r="176" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="6 10" opacity="0.34" />
          <circle cx="210" cy="210" r="144" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.18" />
        </svg>
      </div>

      {/* The interactive living mascot */}
      <div className="z2d-emblem-creature">
        <Mascot2D
          pose={pose}
          still={still}
          bloom={!still}
          blink={!still}
          trackPointer={!still}
          interactive
          onHoverPose={p => pickPose(p, true)}
          onSelectPose={p => {
            setPose(p);
            sound.playMode(p);
          }}
          className="z2d-emblem-svg"
        />
      </div>

      {/* Six accessible mode pills matching the six cells of the logo */}
      <div className="z2d-mode-pills" role="group" aria-label="Preview mascot modes">
        {MODE_ORDER.map(key => {
          const meta = MODE_META[key];
          const isCurrent = pose === key;
          const swatch = theme.dark ? meta.color : meta.colorLight;
          return (
            <button
              key={key}
              type="button"
              className="z2d-mode-pill"
              data-active={isCurrent ? "" : undefined}
              style={{ "--pill-color": swatch }}
              onClick={() => {
                setPose(key);
                sound.playMode(key);
              }}
              onMouseEnter={() => pickPose(key, true)}
              onFocus={() => setPose(key)}
              aria-pressed={isCurrent}
            >
              <span className="z2d-mode-dot" aria-hidden="true" />
              <span>{meta.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
