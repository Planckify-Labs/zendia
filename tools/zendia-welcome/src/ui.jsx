// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Shared UI primitives for the onboarding. Text comes from Fluent: an element
// only carries its message's id, and the document's l10n fills it in.

import { Mascot2D } from "./Mascot2D.jsx";

export { Mascot2D as Mascot };

/** An element whose text is the Fluent message `id`. */
export function T({ id, args, as: Tag = "span", ...props }) {
  return <Tag data-l10n-id={id} data-l10n-args={args ? JSON.stringify(args) : undefined} {...props} />;
}

/**
 * One choice of a group: a radio button drawn as a tactile rounded cell card.
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
