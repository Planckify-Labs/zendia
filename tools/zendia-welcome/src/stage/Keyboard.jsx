// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// A 60% keyboard whose keys go down when the scene says they are pressed.
// One unit is one key; it lies in the xy plane with its keys rising along z.

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Cel } from "./Cel.jsx";
import { CEL, font, loft, outlineMaterial, paintTexture, pressDepth, slab, text } from "./kit.js";

const ROWS = [
  [["esc", 1, "Esc"], ..."1234567890-=".split("").map(c => [c, 1]), ["backspace", 2, "⌫"]],
  [["tab", 1.5, "Tab"], ..."qwertyuiop[]".split("").map(c => [c, 1]), ["\\", 1.5]],
  [["caps", 1.75, "Caps"], ..."asdfghjkl;'".split("").map(c => [c, 1]), ["enter", 2.25, "Enter"]],
  [["shift", 2.25, "Shift"], ..."zxcvbnm,./".split("").map(c => [c, 1]), ["rshift", 2.75, "Shift"]],
  [["ctrl", 1.25, "Ctrl"], ["super", 1.25, "Super"], ["alt", 1.25, "Alt"], ["space", 6.25, ""], ["ralt", 1.25, "Alt"], ["fn", 1.25, "Fn"], ["menu", 1.25, "Menu"], ["rctrl", 1.25, "Ctrl"]],
];
export const KEYBOARD = { width: 15, depth: 5 };

const GAP = 0.09;
const HEIGHT = 0.46;
const TRAVEL = 0.2;

function capGeometry(units) {
  const w = units - GAP;
  const h = 1 - GAP;
  return loft([
    { w, h, r: 0.1, z: 0 },
    { w, h, r: 0.1, z: 0.08 },
    { w: w - 0.2, h: h - 0.2, r: 0.12, z: HEIGHT - 0.05, y: 0.03 },
    { w: w - 0.28, h: h - 0.28, r: 0.1, z: HEIGHT, y: 0.03 },
  ]);
}

function paintLegend(label, color) {
  const wide = label.length > 1;
  return paintTexture(wide ? 96 : 64, 64, 4, (ctx, width) => {
    text(ctx, label, width / 2, 33, color, font(wide ? 22 : 38, 800), "center");
  });
}

/**
 * @param {object} props
 * @param {{current: number}} props.time The scene's clock, in seconds.
 * @param {Record<string, Array<[number, number?]>>} props.presses
 *   When each key goes down, and for how long: `{ j: [[1, 0.1]] }`.
 * @param {{current: string}} props.flash The color a pressed key takes.
 */
export function Keyboard({ time, presses, flash, ...props }) {
  const keys = useMemo(() => {
    const list = [];
    ROWS.forEach((row, rowIndex) => {
      let x = -KEYBOARD.width / 2;
      for (const [id, units, label = id.toUpperCase()] of row) {
        list.push({
          id,
          units,
          label,
          x: x + units / 2,
          y: KEYBOARD.depth / 2 - rowIndex - 0.5,
          kind: id == "esc" || id == "enter" ? "accent" : units > 1 && id != "space" ? "modifier" : "alpha",
        });
        x += units;
      }
    });
    return list;
  }, []);

  const assets = useMemo(() => {
    const caps = new Map();
    const legends = new Map();
    for (const key of keys) {
      if (!caps.has(key.units)) {
        caps.set(key.units, capGeometry(key.units));
      }
      const color = key.kind == "modifier" ? CEL.paper : CEL.ink;
      const legend = `${key.label}|${color}`;
      if (key.label && !legends.has(legend)) {
        legends.set(legend, paintLegend(key.label, color));
      }
    }
    return {
      caps,
      legends,
      board: slab(KEYBOARD.width + 0.7, KEYBOARD.depth + 0.7, 0.7, 0.45, 0.1),
      well: slab(KEYBOARD.width + 0.16, KEYBOARD.depth + 0.16, 0.1, 0.12, 0.03),
      narrow: new THREE.PlaneGeometry(0.56, 0.56),
      wide: new THREE.PlaneGeometry(0.84, 0.56),
    };
  }, [keys]);
  useEffect(
    () => () => {
      for (const item of [...assets.caps.values(), ...assets.legends.values(), assets.board, assets.well, assets.narrow, assets.wide]) {
        item.dispose();
      }
    },
    [assets]
  );

  const colors = useMemo(
    () => ({
      alpha: new THREE.Color(CEL.paper),
      modifier: new THREE.Color("#4a5180"),
      accent: new THREE.Color(CEL.pink),
      flash: new THREE.Color(),
    }),
    []
  );
  const nodes = useRef(new Map());

  useFrame(() => {
    colors.flash.set(flash.current);
    for (const key of keys) {
      const node = nodes.current.get(key.id);
      const depth = presses[key.id] ? pressDepth(presses[key.id], time.current) : 0;
      node.position.z = -depth * TRAVEL;
      node.children[0].material.color.copy(colors[key.kind]).lerp(colors.flash, depth);
    }
  });

  return (
    <group {...props}>
      <Cel geometry={assets.board} color={CEL.raised} line={0.07} position={[0, 0, 0.12]} />
      <mesh geometry={assets.well} position={[0, 0, 0.14]} receiveShadow>
        <celMaterial args={[{ gloss: 0, rim: 0 }]} color={CEL.ink} />
      </mesh>
      {keys.map(key => (
        <group
          key={key.id}
          ref={node => {
            if (node) {
              nodes.current.set(key.id, node);
            }
          }}
        >
          <mesh geometry={assets.caps.get(key.units)} position={[key.x, key.y, 0.14]} castShadow>
            <celMaterial args={[{ gloss: 0.22, rim: 0.35 }]} />
            <mesh geometry={assets.caps.get(key.units)} material={outlineMaterial(0.035)} />
          </mesh>
          {key.label && (
            <mesh
              geometry={key.label.length > 1 ? assets.wide : assets.narrow}
              position={[key.x, key.y + 0.03, 0.14 + HEIGHT + 0.004]}
              scale={key.label.length > 1 ? 0.7 : 1}
            >
              <meshBasicMaterial
                map={assets.legends.get(`${key.label}|${key.kind == "modifier" ? CEL.paper : CEL.ink}`)}
                transparent
                toneMapped={false}
                depthWrite={false}
              />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}
