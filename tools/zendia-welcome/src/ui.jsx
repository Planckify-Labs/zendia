// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The pieces the pages are built from. Text comes from Fluent: an element
// only carries its message's id, and the document's l10n fills it in.

import { useEffect, useRef, useState } from "react";
import {
  MASCOT_COLORS,
  MASCOT_EDGE,
  MASCOT_FACE,
  MASCOT_MORPH_MS,
  MASCOT_VIEWBOX,
  mascotFrame,
  mixColor,
} from "../../../src/zen/zendia/ui/ZendiaMascot.sys.mjs";

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
 * Zendia's mascot inside its ring, in its drawing for `pose`, as it is in the
 * browser's mode indicator (ZendiaMascot.sys.mjs). A new pose morphs in the
 * way the browser's does: the arcs slide, the color blends and the face bends
 * into the new one.
 */
const MORPH_MS = MASCOT_MORPH_MS;

export function Mascot({ pose, still = false, ...props }) {
  const [frame, setFrame] = useState(() => ({ from: pose, to: pose, t: 1 }));
  const shown = useRef(pose);
  useEffect(() => {
    const from = shown.current;
    shown.current = pose;
    if (from == pose || still || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setFrame({ from: pose, to: pose, t: 1 });
      return undefined;
    }
    const start = performance.now();
    let raf;
    const step = now => {
      const t = Math.min(1, Math.max(0, (now - start) / MORPH_MS));
      setFrame({ from, to: pose, t });
      if (t < 1) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [pose, still]);

  const { from, to, t } = frame;
  const drawing = mascotFrame(from, to, t);
  const body = mixColor(MASCOT_COLORS[from], MASCOT_COLORS[to], drawing.color);
  const outline = list => "M" + list.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") + "Z";
  const head = outline(drawing.head);
  const box = MASCOT_VIEWBOX;
  return (
    <svg
      className="zen-welcome-mascot"
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      aria-hidden="true"
      {...props}
    >
      <g fill={MASCOT_EDGE.color} stroke={MASCOT_EDGE.color} strokeWidth={MASCOT_EDGE.width} strokeLinejoin="round">
        {drawing.cells.map(cell => (
          <path key={cell.mode} d={outline(cell.points)} />
        ))}
        <path d={head} />
      </g>
      {drawing.cells.map(cell => (
        <path key={cell.mode} d={outline(cell.points)} fill={MASCOT_COLORS[cell.mode]} />
      ))}
      <path d={head} fill={body} />
      <g fill="none" stroke={MASCOT_FACE} strokeLinecap="round">
        {drawing.eyes.map(({ points: [[x0, y0], [x1, y1]], width }, index) => (
          <path key={index} d={`M${x0} ${y0}L${x1} ${y1}`} strokeWidth={width} />
        ))}
      </g>
      {drawing.letters.map(letter => (
        <path
          key={letter.mode}
          d={letter.d}
          fill={MASCOT_FACE}
          fillRule="evenodd"
          transform={`translate(${letter.x} ${letter.y}) rotate(${letter.lean}) scale(${letter.scale})`}
        />
      ))}
    </svg>
  );
}
