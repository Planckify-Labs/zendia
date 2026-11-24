// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Chapter 5 (Apps): a close-up 2D Zen vertical sidebar where every app picked
// springs into its rounded-cell Essential tile at the top while regular tabs
// smoothly glide down to make room.

import { Mascot2D } from "../Mascot2D.jsx";

const SIDEBAR_TABS = [
  { title: "Project roadmap", dot: "pink" },
  { title: "Design notes", dot: "blue" },
  { title: "Pull requests", dot: "green" },
  { title: "Documentation", dot: "teal" },
];

export function AppsScene2D({ theme, apps = [], vim = true, still = false }) {
  const count = apps.length;
  const rows = Math.max(1, Math.ceil(count / 3));
  const tabsOffset = rows * 68 + 18;

  return (
    <div className="z2d-apps-preview">
      <div className="z2d-apps-window" style={{ "--win-accent": theme.modes.i }}>
        {/* Left Zen sidebar closeup */}
        <div className="z2d-apps-sidebar">
          <div className="z2d-apps-chrome-bar">
            <span className="z2d-win-dot is-red" />
            <span className="z2d-win-dot is-yellow" />
            <span className="z2d-win-dot is-green" />
          </div>

          <div className="z2d-apps-urlbar">
            <span className="z2d-url-dot" />
            <span className="z2d-url-line" />
          </div>

          {/* Essentials tile grid */}
          <div className="z2d-apps-essentials-grid" aria-label="Pinned essentials preview">
            {count === 0
              ? [0, 1, 2].map(slot => <div key={slot} className="z2d-apps-slot-empty" />)
              : apps.map(app => (
                  <div
                    key={app.url}
                    className="z2d-apps-tile"
                    style={{ "--tile-color": app.color }}
                    title={app.name}
                  >
                    <img src={app.icon} alt="" />
                  </div>
                ))}
          </div>

          <div className="z2d-apps-divider" />

          {/* Regular tabs gliding neatly underneath */}
          <div className="z2d-apps-tabs" style={{ "--tabs-shift": `${tabsOffset}px` }}>
            {SIDEBAR_TABS.map((tab, index) => (
              <div key={tab.title} className={`z2d-apps-tab ${index === 0 ? "is-active" : ""}`}>
                <span className="z2d-apps-tab-dot" style={{ background: theme[tab.dot] }} />
                <span className="z2d-apps-tab-label">{tab.title}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right page peek */}
        <div className="z2d-apps-page">
          <div className="z2d-apps-page-pill" />
          <div className="z2d-apps-page-h1" />
          <div className="z2d-apps-page-h2" />
          <div className="z2d-apps-page-card">
            <div className="z2d-apps-page-card-line" />
            <div className="z2d-apps-page-card-line is-short" />
          </div>
          {vim && (
            <div className="z2d-apps-page-mascot">
              <Mascot2D pose="i" still={still} blink={false} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
