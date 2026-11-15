// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Ad blocking: ads fly at the page. With blocking on they break on a shield
// in front of the window; with it off they land and pile over the text.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { BrowserModel, defaultBrowserState } from "../BrowserModel.jsx";
import { Card } from "../parts.jsx";
import { Set, useFraming, useLoop, useStage } from "../Stage.jsx";
import { CEL, easeInOut, font, lerp, span, text } from "../kit.js";

const LOOP = 7.5;
const FLIGHT = 0.9;
// When each ad sets off, the slot on the page it aims for (scene units,
// around the window's middle), and its size and color.
const ADS = [
  { at: 0.4, to: [1.9, 4.6], size: [2.4, 1.0], color: CEL.yellow },
  { at: 1.5, to: [-0.2, 3.3], size: [1.5, 1.5], color: CEL.pink },
  { at: 2.6, to: [2.4, 2.4], size: [1.8, 1.2], color: CEL.orange },
  { at: 3.7, to: [0.4, 1.7], size: [2.6, 0.8], color: CEL.teal },
  { at: 4.8, to: [0.9, 3.6], size: [1.3, 1.7], color: CEL.yellow },
];

const paintAd = (ctx, w, h) => text(ctx, "AD", w / 2, h / 2 + 2, CEL.ink, font(Math.min(w, h) * 0.5, 900), "center");

function shieldShape(scale) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 1.25 * scale);
  shape.lineTo(1.05 * scale, 0.85 * scale);
  shape.lineTo(1.05 * scale, -0.1 * scale);
  shape.quadraticCurveTo(0.95 * scale, -0.95 * scale, 0, -1.4 * scale);
  shape.quadraticCurveTo(-0.95 * scale, -0.95 * scale, -1.05 * scale, -0.1 * scale);
  shape.lineTo(-1.05 * scale, 0.85 * scale);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/**
 * @param {object} props
 * @param {boolean} props.enabled The page's choice: block ads or not.
 * @param {boolean} props.vim
 */
export function ShieldScene({ enabled, vim }) {
  const { theme, still } = useStage();
  const time = useLoop(LOOP, 3.2);
  const frame = useFraming();
  const browser = useRef(defaultBrowserState());
  const on = useRef(enabled ? 1 : 0);
  const ads = useRef([]);
  const shield = useRef();
  const shapes = useMemo(() => ({ edge: shieldShape(1.12), body: shieldShape(1), check: new THREE.Shape() }), []);
  const check = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(
      [new THREE.Vector3(-0.45, 0, 0), new THREE.Vector3(-0.12, -0.36, 0), new THREE.Vector3(0.5, 0.42, 0)],
      false,
      "catmullrom",
      0
    );
    return new THREE.TubeGeometry(curve, 16, 0.1, 6);
  }, []);

  useFrame((_, delta) => {
    const t = time.current;
    on.current = still ? (enabled ? 1 : 0) : lerp(on.current, enabled ? 1 : 0, 1 - Math.exp(-delta * 7));
    const blocking = on.current > 0.5;
    browser.current.vim = vim ? 1 : 0;
    const clear = span(t, LOOP - 0.7, 0.3);
    let lastHit = 9;

    ADS.forEach((ad, index) => {
      const node = ads.current[index];
      const age = t - ad.at;
      const fly = easeInOut(span(t, ad.at, FLIGHT));
      // On the way in it stops at the shield (z 1.7) or goes on to the page.
      const reach = blocking ? 0.62 : 1;
      const along = Math.min(fly, reach);
      node.visible = age > 0 && clear < 1;
      node.position.set(
        lerp(ad.to[0] + 7, ad.to[0], along),
        lerp(ad.to[1] + 3.5, ad.to[1], along),
        lerp(6, -0.9, along)
      );
      node.rotation.z = (1 - along) * (index % 2 ? 0.5 : -0.5);
      let scale = 1 - clear;
      if (blocking && fly >= reach) {
        // Broken on the shield: gone in three drawings.
        const since = age - FLIGHT * 0.56;
        scale *= Math.max(0, 1 - Math.floor(since / 0.06) * 0.4);
        lastHit = Math.min(lastHit, Math.max(0, since));
      }
      node.scale.setScalar(scale);
    });

    shield.current.position.y = lerp(-4, 3.3, easeInOut(on.current));
    shield.current.scale.setScalar(lastHit < 0.12 ? 1.1 : 1);
    frame({ target: [0.6, 3.3, 0.5], direction: [0.3, 0.15, 1], width: 11, height: 7.2 });
  }, -1);

  return (
    <Set accent={CEL.teal} second={CEL.green}>
      <BrowserModel theme={theme} state={browser} position={[0, 3.35, -1]} rotation={[-0.04, 0, 0]} />
      {ADS.map((ad, index) => (
        <Card
          key={index}
          ref={node => (ads.current[index] = node)}
          width={ad.size[0]}
          height={ad.size[1]}
          depth={0.12}
          radius={0.1}
          color={ad.color}
          paint={paintAd}
          visible={false}
        />
      ))}
      <group ref={shield} position={[2.6, 3.3, 1.7]} rotation={[0, -0.25, 0]}>
        <mesh geometry={shapes.edge} position={[0, 0, -0.02]}>
          <meshBasicMaterial color={CEL.ink} toneMapped={false} />
        </mesh>
        <mesh geometry={shapes.body}>
          <meshBasicMaterial color={CEL.paper} toneMapped={false} />
        </mesh>
        <mesh geometry={check} position={[0, 0, 0.02]}>
          <meshBasicMaterial color={CEL.ink} toneMapped={false} />
        </mesh>
      </group>
    </Set>
  );
}
