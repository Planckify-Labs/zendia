// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The first and the last page: the window on its own under an open sky.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { BrowserModel, defaultBrowserState } from "../BrowserModel.jsx";
import { BRAND, paintGraffiti } from "../graffiti.js";
import { Card } from "../parts.jsx";
import { Set, useFraming, useLoop, useStage } from "../Stage.jsx";
import { CEL } from "../kit.js";

/**
 * @param {object} props
 * @param {boolean} props.vim Whether the window shows vim mode.
 * @param {boolean} [props.wide] The scene has the whole card: the window
 *   stands to the right, clear of the title.
 */
export function HeroScene({ vim, wide }) {
  const { theme, still } = useStage();
  const time = useLoop(60, 4);
  const frame = useFraming();
  const browser = useRef({ ...defaultBrowserState(), vim: vim ? 1 : 0 });
  const window = useRef();
  const pointer = useMemo(() => new THREE.Vector2(), []);

  useFrame((state, delta) => {
    const t = time.current;
    browser.current.vim = vim ? 1 : 0;
    browser.current.scrollA = 60 + Math.sin(t * 0.35) * 60;
    window.current.position.y = 3.5 + Math.sin(t * 0.9) * 0.08;
    window.current.rotation.y = -0.2 + Math.sin(t * 0.4) * 0.03;
    if (!still) {
      pointer.lerp(state.pointer, 1 - Math.exp(-delta * 3));
    }
    frame({
      target: [wide ? -3.2 : 0, 3.3, 0],
      direction: [-0.3 + pointer.x * 0.08, 0.1 + pointer.y * 0.05, 1],
      width: wide ? 17 : 10.5,
      height: 7.4,
    });
  }, -1);

  return (
    <Set accent={CEL.pink} second={CEL.cyan}>
      {/* The start page: Zendia's name, painted on a panel behind the window. */}
      {wide && (
        <Card
          width={7.4}
          height={3.9}
          depth={0.3}
          radius={0.08}
          color={BRAND.snow}
          line={0.05}
          paint={paintGraffiti}
          position={[-6.9, 5.75, -3.4]}
          rotation={[0.03, 0.36, -0.02]}
          scale={0.78}
        />
      )}
      <group ref={window} position={[0, 3.5, 0]}>
        <BrowserModel theme={theme} state={browser} />
      </group>
    </Set>
  );
}
