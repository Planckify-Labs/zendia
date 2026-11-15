// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The pieces the pages are built from. Text comes from Fluent: an element
// only carries its message's id, and the document's l10n fills it in.

import { useMemo } from "react";
import { MASCOT_SIZE, mascotColors, mascotShapes } from "../../../src/zen/zendia/ui/ZendiaMascot.sys.mjs";

/** An element whose text is the Fluent message `id`. */
export function T({ id, args, as: Tag = "span", ...props }) {
  return <Tag data-l10n-id={id} data-l10n-args={args ? JSON.stringify(args) : undefined} {...props} />;
}

/**
 * One choice of a group: a radio button drawn as a row.
 *
 * @param {object} props
 * @param {string} props.id
 * @param {string} props.group The radio group's name.
 * @param {boolean} props.checked
 * @param {() => void} props.onChoose
 * @param {string} [props.l10n] The label's Fluent id, or
 * @param {string} [props.text] the label itself (a product's name).
 * @param {string} [props.icon] A picture shown before the label, on a plate.
 * @param {React.ReactNode} [props.children] Shown at the row's end.
 */
export function Option({ id, group, checked, onChoose, l10n, text, icon, children, inputProps, className = "" }) {
  return (
    <label className={`zen-welcome-option ${className}`} htmlFor={id}>
      <input type="radio" id={id} name={group} checked={checked} onChange={onChoose} {...inputProps} />
      <span className="zen-welcome-option-radio" aria-hidden="true" />
      {icon && (
        <span className="zen-welcome-plate" aria-hidden="true">
          <img className="engine-icon" src={icon} alt="" />
        </span>
      )}
      {l10n ? (
        <T id={l10n} className="zen-welcome-option-label" />
      ) : (
        <span className="zen-welcome-option-label">{text}</span>
      )}
      {children}
    </label>
  );
}

/**
 * The two rows of a yes or no page.
 *
 * @param {object} props
 * @param {string} props.name The radios' ids are `<name>-yes` and
 *   `<name>-no`.
 * @param {string} props.l10n Their labels are `<l10n>-yes` and `<l10n>-no`.
 */
export function YesNo({ name, l10n, value, onChange }) {
  return (
    <div className="zen-welcome-pair" role="radiogroup">
      <Option id={`${name}-yes`} group={name} l10n={`${l10n}-yes`} checked={value} onChoose={() => onChange(true)} />
      <Option id={`${name}-no`} group={name} l10n={`${l10n}-no`} checked={!value} onChoose={() => onChange(false)} />
    </div>
  );
}

/** A key's name on a button that the key also presses. */
export function Key({ id }) {
  return <T as="kbd" id={id} className="zen-welcome-key" aria-hidden="true" />;
}

/**
 * Zendia's mascot in one of its drawings (ZendiaMascot.sys.mjs), as it is in
 * the browser's own mode indicator.
 */
export function Mascot({ pose, color, ...props }) {
  const colors = useMemo(() => mascotColors(color), [color]);
  const shapes = useMemo(() => mascotShapes(pose), [pose]);
  return (
    <svg
      className="zen-welcome-mascot"
      viewBox={`0 0 ${MASCOT_SIZE.width} ${MASCOT_SIZE.height}`}
      aria-hidden="true"
      // A new key restarts the jolt a new drawing arrives with.
      key={pose}
      {...props}
    >
      {shapes.map(({ paint, points, line }, index) => (
        <polygon
          key={index}
          points={points.map(point => point.join(",")).join(" ")}
          fill={colors[paint]}
          stroke={line ? colors.ink : undefined}
          strokeWidth={line ? 1.3 : undefined}
        />
      ))}
    </svg>
  );
}
