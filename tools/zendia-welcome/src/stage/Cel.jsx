// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { extend } from "@react-three/fiber";
import { forwardRef } from "react";
import { CelMaterial, outlineMaterial } from "./kit.js";

extend({ CelMaterial });

/**
 * A cel shaded solid: three tones, a highlight, a rim of light and an ink
 * line around it. `geometry` must have smooth normals (kit.js' loft and
 * slab, spheres, cylinders).
 */
export const Cel = forwardRef(function Cel(
  { geometry, color, line = 0.03, lineColor, shadow = true, gloss = 0.3, rim = 0.5, map, children, ...props },
  ref
) {
  return (
    <mesh ref={ref} geometry={geometry} castShadow={shadow} receiveShadow {...props}>
      <celMaterial args={[{ gloss, rim }]} color={color} {...(map ? { map } : null)} />
      {line > 0 && <mesh geometry={geometry} material={outlineMaterial(line, lineColor)} />}
      {children}
    </mesh>
  );
});
