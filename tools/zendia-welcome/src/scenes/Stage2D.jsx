// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Framed 2D visual stage for each onboarding chapter. Carries the chapter's
// mode tint, quiet Voronoi hairline arcs echoing the logo, and an accessible
// Pause / Play toggle for auto-running motion previews (WCAG 2.2.2).

export function Stage2D({
  accent,
  still = false,
  looping = true,
  paused = false,
  onTogglePause,
  caption,
  children,
}) {
  return (
    <div className="z2d-stage-shell" style={{ "--stage-accent": accent }}>
      <div className="z2d-stage-backdrop" aria-hidden="true">
        <svg className="z2d-stage-ornament" viewBox="0 0 720 520" preserveAspectRatio="xMidYMid slice">
          <circle cx="620" cy="70" r="210" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.16" />
          <circle cx="620" cy="70" r="142" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.1" />
          <circle cx="80" cy="460" r="185" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.14" />
        </svg>
      </div>

      <div className="z2d-stage-viewport">{children}</div>

      {caption && <div className="z2d-stage-caption">{caption}</div>}

      {looping && !still && onTogglePause && (
        <button
          type="button"
          className="z2d-motion-toggle"
          onClick={onTogglePause}
          aria-label={paused ? "Play preview animation" : "Pause preview animation"}
          title={paused ? "Play preview" : "Pause preview"}
        >
          {paused ? (
            <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3.2 2.2L11.6 7L3.2 11.8Z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
              <rect x="2.6" y="2.2" width="3" height="9.6" rx="1.2" fill="currentColor" />
              <rect x="8.4" y="2.2" width="3" height="9.6" rx="1.2" fill="currentColor" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
